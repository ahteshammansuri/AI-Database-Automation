<?php

namespace App\Services\Data;

use App\Models\DataConversationState;
use App\Models\DataQueryResult;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\AiServiceClient;
use App\Services\Agent\ModelSelector;
use Illuminate\Support\Str;

class DataAgentService
{
    public function __construct(
        protected LiveSchemaService $schemaService,
        protected SchemaLinker $schemaLinker,
        protected QueryPlanValidator $validator,
        protected QueryCompiler $compiler,
        protected ReadExecutor $readExecutor,
        protected DummyDataDetector $dummyDetector,
        protected AiServiceClient $aiClient,
        protected DataAccessPolicy $policy
    ) {}

    /**
     * Process a natural language question about database structure or data.
     */
    public function ask(User $user, string $utterance, ?int $connectionId = null, array $options = []): array
    {
        $res = $this->answer($user, $utterance, $connectionId, $options);
        // Every reply says plainly whether it answered (tools and the UI rely on it).
        $res['success'] ??= ($res['type'] ?? '') !== 'error';
        $res['message'] ??= $res['headline'] ?? $res['question'] ?? ($res['success'] ? 'Done.' : 'The question could not be answered.');

        return $res;
    }

    protected function answer(User $user, string $utterance, ?int $connectionId, array $options): array
    {
        $u = trim($utterance);
        $uLower = strtolower($u);

        // 1. Resolve Connection
        $resolvedConn = $this->resolveConnection($user, $utterance, $connectionId);
        if (isset($resolvedConn['needs_clarification'])) {
            return $resolvedConn;
        }
        /** @var DbConnection $connection */
        $connection = $resolvedConn['connection'];

        // Update conversation state active connection
        $convState = DataConversationState::firstOrCreate(['user_id' => $user->id]);
        $convState->update(['active_connection_id' => $connection->id]);

        $catalog = $this->schemaService->getCatalog($connection);
        $tables = $catalog['tables'] ?? [];
        $foreignKeys = $catalog['foreign_keys'] ?? [];

        // 2. Fast-path: "How many tables" / Schema Overview
        if (preg_match('/how many tables|list tables|show tables|all tables/i', $uLower)) {
            $tableNames = array_keys($tables);
            $count = count($tableNames);
            return [
                'success' => true,
                'message' => "Your database '{$connection->name}' has {$count} tables.",
                'type' => 'schema_overview',
                'headline' => "Your database '{$connection->name}' has {$count} tables.",
                'tables' => $tableNames,
                'connection' => ['id' => $connection->id, 'name' => $connection->name, 'driver' => $connection->driver],
                'diagnostics' => [
                    'source' => 'live_schema_introspection',
                    'engine' => $catalog['database_type'] ?? $connection->driver,
                    'total_tables' => $count,
                ],
            ];
        }

        // 3. Fast-path: "Which table stores user data / order data"
        if (preg_match('/which table stores|where is (?:the )?(?:user|customer|account|order|product) data/i', $uLower)) {
            return $this->answerTableDiscovery($connection, $uLower, $catalog);
        }

        // 4. Fast-path: "How are X and Y related" / Relationships
        if (preg_match('/how are (\w+) and (\w+) related|relationship between (\w+) and (\w+)|fk graph/i', $uLower, $m)) {
            return $this->answerRelationships($connection, $uLower, $catalog);
        }

        // 5. Fast-path: "Dummy / test data detection"
        if (preg_match('/dummy|test data|fake data|seeded data/i', $uLower)) {
            // Find target table
            $targetTable = $this->findBestMatchingTable($tables, $uLower, $convState->active_table ?: 'users');
            $report = $this->dummyDetector->detect($connection, $targetTable);
            return [
                'success' => true,
                'message' => "Analyzed table '{$targetTable}': found {$report['dummy_count']} likely dummy/test records.",
                'type' => 'dummy_data_report',
                'headline' => "Analyzed table '{$targetTable}': found {$report['dummy_count']} likely dummy/test records with {$report['confidence']} confidence.",
                'report' => $report,
                'connection' => ['id' => $connection->id, 'name' => $connection->name],
            ];
        }

        // 6. Everything else: one model-written SELECT through the validated read gate.
        return $this->answerWithSql($user, $connection, $convState, $u, $catalog, $options);
    }

    /** Attempts per question: the first query plus up to two corrections with the real error. */
    protected const MAX_SQL_ATTEMPTS = 3;
    protected const MAX_ROWS = 200;

    /**
     * Answer a question with a SELECT written by the user's model, accepted only if the read gate
     * validates it against the readable live schema (AST, single SELECT, allow-listed tables and
     * functions, no secret columns, forced LIMIT) and the database runs it read-only. A rejected query
     * is retried with the exact error. Never substitutes a different query when it cannot answer.
     */
    protected function answerWithSql(User $user, DbConnection $connection, DataConversationState $convState, string $question, array $catalog, array $options): array
    {
        $connInfo = ['id' => $connection->id, 'name' => $connection->name, 'driver' => $connection->driver];
        $slice = $this->schemaLinker->slice($connection, $question, ['max_tables' => 6]);
        $readable = $this->readableSchema($connection, $catalog);
        // Real keys let the gate catch joins that would inflate counts and sums (fan-out).
        $relations = array_values(array_filter(array_map(fn ($fk) => [
            'table' => $fk['table'] ?? null, 'columns' => $fk['columns'] ?? [], 'ref_table' => $fk['ref_table'] ?? null, 'ref_columns' => $fk['ref_columns'] ?? [],
        ], $catalog['foreign_keys'] ?? []), fn ($fk) => isset($readable[$fk['table']], $readable[$fk['ref_table']])));
        $primaryKeys = array_filter(array_map(fn ($t) => (array) ($t['primary_key'] ?? []), array_intersect_key($catalog['tables'] ?? [], $readable)));
        $dialect = in_array(strtolower((string) ($connection->driver ?: 'mysql')), ['pgsql', 'postgres', 'postgresql'], true) ? 'postgres' : 'mysql';
        $tz = $connection->data_timezone ?: ($user->timezone ?? null) ?: 'UTC';
        $model = $options['model'] ?? ModelSelector::for($user);
        $revealPii = !empty($options['reveal_pii']);
        $previous = [];
        $softRepaired = false;

        for ($attempt = 1; $attempt <= self::MAX_SQL_ATTEMPTS; $attempt++) {
            $written = $this->aiClient->writeSelectSql([
                'question' => $question,
                'schema_slice' => $slice,
                'dialect' => $dialect,
                'timezone' => $tz,
                'previous' => $previous,
                'provider' => $model['provider'] ?? null,
                'model' => $model['model'] ?? null,
                'api_key' => $model['api_key'] ?? null,
            ]);
            if (empty($written['success'])) {
                return $this->failure($written['error_category'] ?? 'MODEL_UNAVAILABLE',
                    'I could not work out a query for that: ' . ($written['error'] ?? 'the model did not answer') . ' Nothing was guessed.',
                    $connInfo, $previous);
            }
            $sql = trim((string) ($written['sql'] ?? ''));
            if ($sql === '') {
                $ask = $written['clarification'] ?: 'The tables I can read do not hold that information.';
                return ['success' => true, 'type' => 'clarification', 'headline' => $ask, 'message' => $ask,
                    'tables_considered' => array_keys($slice['tables'] ?? []), 'connection' => $connInfo];
            }

            $gate = $this->aiClient->validateSelect($sql, $dialect, $readable, self::MAX_ROWS, $relations, $primaryKeys, null, $question);
            if (!empty($gate['gate_unavailable'])) {
                return $this->failure('AI_SERVICE_UNREACHABLE', 'The query safety check is not reachable, so nothing was run.', $connInfo, $previous);
            }
            if (empty($gate['valid'])) {
                $previous[] = ['sql' => $sql, 'error' => implode(' ', (array) ($gate['errors'] ?? ['rejected']))];
                continue;
            }

            // Filters the question never asked for, or a ranking question answered without sorting: one
            // rewrite with the exact issue. If the model insists, the answer still states its real filter.
            $issues = [];
            if (!empty($gate['unasked_filters'])) {
                $issues[] = 'The question does not ask to filter on ' . implode(' AND ', array_map('strval', (array) $gate['unasked_filters']))
                    . '; remove those conditions unless the user asked for them.';
            }
            if (!empty($gate['ranks_child_rows'])) {
                $r = (array) $gate['ranks_child_rows'];
                $issues[] = "The question ranks {$r['entity']}, but the query sorts individual {$r['child']} rows; GROUP BY the {$r['entity']} id "
                    . "and SUM (or COUNT) {$r['child']}.{$r['column']} per {$r['entity']}, then ORDER BY that total.";
            }
            if (!empty($gate['missing_order'])) {
                $issues[] = 'The question asks for a ranking (top / most / least) but the query does not sort by the ranked value; aggregate it and ORDER BY it.';
            }
            if ($issues && !$softRepaired && $attempt < self::MAX_SQL_ATTEMPTS) {
                $softRepaired = true;
                $previous[] = ['sql' => $sql, 'error' => implode(' ', $issues)];
                continue;
            }

            // Access policy on the tables the query really reads (blocked tables are refused and audited).
            try {
                $this->policy->assertCanRead($connection, (array) ($gate['tables'] ?? []));
            } catch (DataException $e) {
                return $this->failure($e->errorCode ?: 'TABLE_BLOCKED', $e->getMessage(), $connInfo, $previous);
            }

            $read = $this->readExecutor->execute($connection, (string) $gate['sql'], [], $revealPii);
            if (empty($read['success'])) {
                $previous[] = ['sql' => $sql, 'error' => 'The database rejected it: ' . mb_substr((string) ($read['error'] ?? ''), 0, 300)];
                continue;
            }

            // A top-N that ended inside a tie hides tied rows: run the same validated query wider.
            $tie = self::tieInfo($read['rows'] ?? []);
            if ($tie && $tie['all_tied'] && ($read['row_count'] ?? 0) >= (int) ($gate['limit'] ?? PHP_INT_MAX) && (int) ($gate['limit'] ?? 0) < 50) {
                $wide = $this->aiClient->validateSelect($sql, $dialect, $readable, self::MAX_ROWS, $relations, $primaryKeys, 50);
                $wideRead = !empty($wide['valid']) ? $this->readExecutor->execute($connection, (string) $wide['sql'], [], $revealPii) : null;
                if (!empty($wideRead['success'])) {
                    [$read, $gate] = [$wideRead, $wide + ['notes' => $gate['notes'] ?? []]];
                }
            }

            return $this->composeAnswer($user, $connection, $convState, $question, $read, $gate, $written, $attempt);
        }

        $last = end($previous);
        return $this->failure('QUERY_NOT_ANSWERED',
            'I could not build a valid query for that after ' . self::MAX_SQL_ATTEMPTS . ' attempts. Last problem: ' . ($last['error'] ?? 'unknown') . ' Nothing was guessed.',
            $connInfo, $previous);
    }

    /** Readable tables and columns for the gate: blocked tables and secret columns are left out. */
    protected function readableSchema(DbConnection $connection, array $catalog): array
    {
        $schema = [];
        foreach ($catalog['tables'] ?? [] as $table => $meta) {
            if ($this->policy->getTableClass($connection, (string) $table) === 'blocked') {
                continue;
            }
            $cols = array_values(array_filter(array_keys($meta['columns'] ?? []), fn ($c) => !ColumnClassifier::isSecret((string) $c)));
            if ($cols) {
                $schema[$table] = $cols;
            }
        }

        return $schema;
    }

    /**
     * Ranking results: the measure is the last numeric column that is not an id; rows sharing the top
     * value are a tie. Returns null when there is nothing to compare.
     */
    public static function tieInfo(array $rows): ?array
    {
        if (count($rows) < 2) {
            return null;
        }
        $cols = array_keys($rows[0]);
        $measure = self::measureColumn($rows);
        if ($measure === null) {
            return null;
        }
        $label = self::labelColumn($rows, $measure) ?? $cols[0];
        $top = (float) $rows[0][$measure];
        $tied = array_values(array_filter($rows, fn ($r) => (float) $r[$measure] === $top));
        if (count($tied) < 2) {
            return null;
        }

        return ['measure' => $measure, 'value' => $rows[0][$measure], 'names' => array_map(fn ($r) => (string) $r[$label], $tied),
            'all_tied' => count($tied) === count($rows)];
    }

    /**
     * Plain factual sentence for a result, plus the names/numbers a reply must contain.
     *
     * @return array{0: string, 1: list<string>}
     */
    public static function describeResult(array $rows, int $count, int $limit = 0, ?array $orderBy = null): array
    {
        if ($count === 0) {
            return ['The query ran and returned no rows.', []];
        }
        $fmt = fn ($v) => is_numeric($v) ? (string) (0 + $v) : (string) $v;
        $human = fn (string $col) => trim(str_replace('_', ' ', $col));
        $first = $rows[0];
        if ($count === 1 && count($first) === 1) {
            $col = array_key_first($first);
            return [ucfirst($human($col)) . ": {$fmt($first[$col])}.", [$fmt($first[$col])]];
        }
        if (($orderBy === null || in_array(self::measureColumn($rows), $orderBy, true)) && ($tie = self::tieInfo($rows))) {
            $names = array_slice($tie['names'], 0, 12);
            $more = $tie['all_tied'] && $limit && $count >= $limit ? ' (there may be more beyond these)' : '';
            $dir = self::rankWord($rows, $tie['measure']);
            return ["It is a tie: " . count($tie['names']) . " share the {$dir} {$human($tie['measure'])} ({$fmt($tie['value'])} each): " . implode(', ', $names)
                . (count($tie['names']) > 12 ? ', …' : '') . "{$more}.", array_merge([$fmt($tie['value'])], $names)];
        }
        $measure = self::measureColumn($rows);
        $label = $measure ? self::labelColumn($rows, $measure) : null;
        // Ranking words only when the query really sorts by that value (a plain list is not a ranking).
        $ranked = $orderBy === null || in_array($measure, $orderBy, true);
        if ($measure && $label && count($rows) >= 2 && $ranked) {
            $next = $rows[1];
            $dir = self::rankWord($rows, $measure);
            return ["{$first[$label]} has the {$dir} {$human($measure)}: {$fmt($first[$measure])} (next: {$next[$label]} with {$fmt($next[$measure])}).",
                [(string) $first[$label], $fmt($first[$measure])]];
        }
        $text = collect($first)->map(fn ($v, $k) => "{$k}: " . (is_scalar($v) || $v === null ? var_export($v, true) : json_encode($v)))->take(8)->implode(', ');

        return [$count === 1 ? "Result: {$text}." : "{$count} rows. First: {$text}.", []];
    }

    /** "highest" when rows are sorted descending by the measure, else "lowest". */
    protected static function rankWord(array $rows, string $measure): string
    {
        $values = array_map(fn ($r) => (float) $r[$measure], $rows);
        return end($values) <= $values[0] ? 'highest' : 'lowest';
    }

    protected static function measureColumn(array $rows): ?string
    {
        foreach (array_reverse(array_keys($rows[0] ?? [])) as $c) {
            if (!preg_match('/(^id$|_id$)/i', $c) && collect($rows)->every(fn ($r) => is_numeric($r[$c] ?? null))) {
                return $c;
            }
        }

        return null;
    }

    protected static function labelColumn(array $rows, string $measure): ?string
    {
        return collect(array_keys($rows[0]))->first(fn ($c) => $c !== $measure
            && collect($rows)->every(fn ($r) => is_string($r[$c] ?? null) && !is_numeric($r[$c]) && !str_contains((string) $r[$c], '***')));
    }

    protected function composeAnswer(User $user, DbConnection $connection, DataConversationState $convState, string $question,
                                     array $read, array $gate, array $written, int $attempt): array
    {
        $rows = array_slice($read['rows'] ?? [], 0, 50);
        $count = (int) ($read['row_count'] ?? 0);
        $tables = array_values((array) ($gate['tables'] ?? []));
        $orderBy = array_key_exists('order_by', $gate) ? (array) $gate['order_by'] : null; // null: sort unknown
        [$headline, $facts] = self::describeResult($rows, $count, (int) ($gate['limit'] ?? 0), $orderBy);
        if (!empty($gate['where'])) {
            $headline .= ' (Counted only rows where ' . mb_substr(str_replace('`', '', (string) $gate['where']), 0, 200) . '.)';
        }
        $assumptions = array_values(array_merge((array) ($written['assumptions'] ?? []), (array) ($gate['notes'] ?? [])));
        $diagnostics = [
            'sql' => $read['sql'] ?? $gate['sql'],
            'execution_time_ms' => $read['execution_time_ms'] ?? null,
            'assumptions' => $assumptions,
            'tables' => $tables,
            'attempts' => $attempt,
        ];

        $convState->update(['active_table' => $tables[0] ?? null, 'last_query_plan' => ['sql' => $diagnostics['sql']]]);
        $record = DataQueryResult::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'query_hash' => hash('sha256', (string) $diagnostics['sql']),
            'user_question' => $question,
            'compiled_sql' => $diagnostics['sql'],
            'bindings' => [],
            'row_count' => $count,
            'masked_rows' => $rows,
            'columns' => $read['columns'] ?? [],
            'assumptions' => $assumptions,
            'how_i_got_this' => $diagnostics,
            'expires_at' => now()->addDays(7),
        ]);
        $convState->update(['last_result_id' => $record->id]);

        return [
            'success' => true,
            'type' => 'data_query',
            'result_id' => $record->id,
            'headline' => $headline,
            'message' => $headline,
            // Names and numbers any reply built from this result must contain (checked by Orbit).
            'facts' => $facts,
            'row_count' => $count,
            'columns' => $read['columns'] ?? [],
            'rows' => $rows,
            'diagnostics' => $diagnostics,
            'assumptions' => $assumptions,
            'connection' => ['id' => $connection->id, 'name' => $connection->name, 'driver' => $connection->driver],
            'active_table' => $tables[0] ?? null,
        ];
    }

    protected function failure(string $category, string $message, array $connInfo, array $attempts = []): array
    {
        return [
            'success' => false,
            'type' => 'error',
            'error_category' => $category,
            'error' => $message,
            'headline' => $message,
            'connection' => $connInfo,
            'attempts' => array_map(fn ($a) => ['sql' => mb_substr($a['sql'], 0, 400), 'error' => mb_substr($a['error'], 0, 300)], $attempts),
        ];
    }

    /**
     * Resolve connection with multi-connection disambiguation.
     */
    protected function resolveConnection(User $user, string $utterance, ?int $connectionId): array
    {
        $connections = DbConnection::where('user_id', $user->id)->where('is_active', true)->get();
        if ($connections->isEmpty()) {
            return [
                'success' => false,
                'error_category' => 'NO_CONNECTION',
                'error' => 'No active database connections found. Please connect your database first in the Connections tab.',
                'type' => 'no_connection',
                'headline' => 'No active database connections found. Please connect your database first in the Connections tab.',
            ];
        }

        if ($connectionId) {
            $conn = $connections->firstWhere('id', $connectionId);
            if ($conn) return ['connection' => $conn];
        }

        // Check if user specifically mentioned connection name in utterance
        $uLower = strtolower($utterance);
        foreach ($connections as $c) {
            if (str_contains($uLower, strtolower($c->name))) {
                return ['connection' => $c];
            }
        }

        // Check active connection in conversation state
        $state = DataConversationState::where('user_id', $user->id)->first();
        if ($state && $state->active_connection_id) {
            $conn = $connections->firstWhere('id', $state->active_connection_id);
            if ($conn) return ['connection' => $conn];
        }

        // If only 1 connection, use it
        if ($connections->count() === 1) {
            return ['connection' => $connections->first()];
        }

        // Multiple connections and no active established: ask user
        return [
            'success' => true,
            'message' => 'You have several connected databases: ' . $connections->pluck('name')->implode(', ') . '. Ask the user which one to use.',
            'type' => 'disambiguation',
            'needs_clarification' => true,
            'question' => 'You have multiple connected databases. Which database would you like to query?',
            'options' => $connections->map(fn($c) => [
                'id' => $c->id,
                'name' => $c->name,
                'driver' => $c->driver,
            ])->values()->all(),
        ];
    }

    protected function answerTableDiscovery(DbConnection $connection, string $u, array $catalog): array
    {
        $tables = $catalog['tables'] ?? [];
        $candidates = [];

        foreach ($tables as $tName => $tMeta) {
            $score = 0;
            $evidence = [];
            $cols = $tMeta['columns'] ?? [];

            if (str_contains($u, 'user') || str_contains($u, 'customer') || str_contains($u, 'account')) {
                if (isset($cols['email'])) { $score += 10; $evidence[] = "has 'email' column"; }
                if (isset($cols['password_hash']) || isset($cols['password'])) { $score += 10; $evidence[] = "has password credential column"; }
                if (isset($cols['name']) || isset($cols['full_name']) || isset($cols['usr_nm'])) { $score += 5; $evidence[] = "has name column"; }
                if (str_contains($tName, 'user') || str_contains($tName, 'acct') || str_contains($tName, 'customer')) {
                    $score += 8;
                    $evidence[] = "table name indicates user entities";
                }
            } elseif (str_contains($u, 'order')) {
                if (isset($cols['order_number']) || isset($cols['order_no'])) { $score += 10; $evidence[] = "has 'order_number' column"; }
                if (isset($cols['total_amount']) || isset($cols['subtotal'])) { $score += 8; $evidence[] = "has currency/amount columns"; }
                if (str_contains($tName, 'order')) { $score += 8; $evidence[] = "table name indicates orders"; }
            }

            if ($score > 0) {
                $candidates[] = [
                    'table' => $tName,
                    'score' => $score,
                    'evidence' => $evidence,
                    'approx_rows' => $tMeta['approx_row_count'] ?? 0,
                    'columns' => array_keys($cols),
                ];
            }
        }

        usort($candidates, fn($a, $b) => $b['score'] <=> $a['score']);
        $best = $candidates[0] ?? null;

        if (!$best) {
            return [
                'type' => 'table_discovery',
                'headline' => "Could not determine a matching table with high confidence.",
                'candidates' => [],
            ];
        }

        $headline = "Table '{$best['table']}' stores this data (confidence: high, based on " . implode(', ', $best['evidence']) . "; approx {$best['approx_rows']} rows).";
        return [
            'type' => 'table_discovery',
            'headline' => $headline,
            'best_match' => $best,
            'candidates' => $candidates,
            'connection' => ['id' => $connection->id, 'name' => $connection->name],
        ];
    }

    protected function answerRelationships(DbConnection $connection, string $u, array $catalog): array
    {
        $fks = $catalog['foreign_keys'] ?? [];
        $relevant = [];

        foreach ($fks as $fk) {
            $t1 = strtolower($fk['table']);
            $t2 = strtolower($fk['ref_table']);
            if (str_contains($u, $t1) || str_contains($u, $t2)) {
                $relevant[] = $fk;
            }
        }

        if (empty($relevant)) {
            return [
                'type' => 'relationships',
                'headline' => "No direct foreign key relationships found matching your question in database '{$connection->name}'.",
                'relationships' => [],
            ];
        }

        $explanations = [];
        foreach ($relevant as $r) {
            $cols = implode(', ', $r['columns']);
            $refCols = implode(', ', $r['ref_columns']);
            $explanations[] = "Table `{$r['table']}` references `{$r['ref_table']}` via (`{$cols}`) -> (`{$refCols}`).";
        }

        return [
            'type' => 'relationships',
            'headline' => implode(" ", $explanations),
            'relationships' => $relevant,
            'connection' => ['id' => $connection->id, 'name' => $connection->name],
        ];
    }

    protected function findBestMatchingTable(array $tables, string $u, string $default): string
    {
        foreach (array_keys($tables) as $t) {
            if (str_contains($u, strtolower($t))) {
                return $t;
            }
        }
        return isset($tables[$default]) ? $default : (array_key_first($tables) ?: 'users');
    }
}
