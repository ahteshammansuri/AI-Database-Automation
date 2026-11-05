<?php

namespace App\Services\Data;

use App\Jobs\AnalyzeTableInsightsJob;
use App\Models\DbConnection;
use App\Models\ModelRole;
use App\Models\SchemaTableInsight;
use App\Services\Agent\ModelSelector;
use App\Services\AiServiceClient;
use App\Services\AiUsage;
use Illuminate\Support\Facades\Log;
use PDO;

/**
 * The customer's model reads each table it is about to fill (in the background, the first time the table is used and
 * again whenever its columns change): what every column stores (title, body, image stored as the id of an upload, a
 * coded status ...), what each stored code means (1 = Published), and which table an id-only column points to. The
 * reading uses the customer's planner model, embeddings and their FAISS knowledge index (AI service
 * /v1/schema/interpret-table) and is validated here against the live schema before anything uses it.
 *
 * Used by SchemaRelations (links and value names everywhere), TargetTableInspector (column kinds for automations
 * and manual publishing) and the media row builder.
 */
class TableInsightService
{
    /** Roles the AI service may give a column (must match ai_service/app/services/schema_interpreter.py). */
    public const ROLES = [
        'title', 'slug', 'summary', 'body', 'seo_title', 'seo_description', 'keywords', 'image', 'image_reference',
        'file_reference', 'status', 'type', 'flag', 'link', 'datetime', 'url', 'number', 'contact', 'json', 'code', 'text',
        'internal', 'file_url', 'file_path', 'file_name', 'file_extension', 'file_mime', 'file_kind', 'file_size',
        'image_width', 'image_height',
    ];

    public const FILE_ROLES = ['file_url', 'file_path', 'file_name', 'file_extension', 'file_mime', 'file_kind', 'file_size', 'image_width', 'image_height'];

    /** A pending reading older than this is treated as lost (worker restarted) and started again. */
    private const PENDING_MINUTES = 20;
    private const MAX_VALUES = 15;
    /** Columns the model is asked about per step (small, so a slow local model answers within one job). */
    private const BATCH = 4;

    public function __construct(
        private TargetConnector $connector,
        private AiServiceClient $ai,
    ) {}

    /** Fingerprint of a table's columns: a reading is redone when it changes. */
    public static function hash(array $meta): string
    {
        $parts = [];
        foreach ($meta['columns'] ?? [] as $name => $c) {
            $parts[] = $name . '|' . ($c['raw_type'] ?? $c['data_type'] ?? '') . '|' . (empty($c['nullable']) ? 0 : 1) . '|' . implode(',', (array) ($c['enum'] ?? []));
        }
        return sha1(implode(';', $parts));
    }

    /** Every reading of a connection, by table name: what SchemaRelations merges into the catalog. */
    public function forConnection(DbConnection $connection): array
    {
        $out = [];
        foreach (SchemaTableInsight::where('connection_id', $connection->id)->where('user_id', $connection->user_id)->get() as $i) {
            $out[$i->table_name] = [
                'status' => $i->status,
                'source' => $i->source,
                'hash' => $i->schema_hash,
                'model' => $i->model,
                'summary' => $i->insights['summary'] ?? null,
                'columns' => (array) ($i->insights['columns'] ?? []),
                'analyzed_at' => $i->analyzed_at?->toIso8601String(),
                'error' => $i->error,
            ];
        }
        return $out;
    }

    /**
     * Start reading the table in the background when there is no current reading (none yet, the columns changed, a
     * previous attempt was lost, or $force). Returns what the UI shows.
     */
    public function ensure(DbConnection $connection, string $table, array $meta, bool $force = false, bool $dispatch = true): array
    {
        if (($meta['class'] ?? null) === 'blocked' || !config('data_agent.table_insights', true)) {
            return ['status' => 'unavailable', 'table' => $table];
        }
        $hash = self::hash($meta);
        $row = SchemaTableInsight::firstOrNew(['connection_id' => $connection->id, 'table_name' => $table], ['user_id' => $connection->user_id]);
        $lost = $row->status === 'pending' && $row->updated_at && $row->updated_at->lt(now()->subMinutes(self::PENDING_MINUTES));
        $current = $row->exists && $row->schema_hash === $hash && in_array($row->status, ['ready', 'pending'], true) && !$lost;
        // A reading that failed a moment ago (AI service down) is not retried on every page view.
        $resting = $row->exists && $row->status === 'failed' && $row->schema_hash === $hash && $row->updated_at?->gt(now()->subMinutes(10));
        if ($force || (!$current && !$resting)) {
            $insights = (array) ($row->insights ?? []);
            unset($insights['queue']);
            $row->fill(['user_id' => $connection->user_id, 'schema_hash' => $hash, 'status' => 'pending', 'error' => null, 'insights' => $insights ?: null]);
            $row->touch();
            $row->save();
            if ($dispatch) {
                AnalyzeTableInsightsJob::dispatch($connection->id, $connection->user_id, $table);
            }
            $row->refresh();
        }
        return $this->state($row);
    }

    public function state(SchemaTableInsight $row): array
    {
        return [
            'table' => $row->table_name,
            'status' => $row->status,
            'source' => $row->source,
            'model' => $row->model,
            'summary' => $row->insights['summary'] ?? null,
            'columns' => (object) ($row->insights['columns'] ?? []),
            'problems' => $row->insights['problems'] ?? [],
            'progress' => isset($row->insights['total']) ? ['read' => max(0, (int) $row->insights['total'] - count((array) ($row->insights['queue'] ?? []))), 'total' => (int) $row->insights['total']] : null,
            'error' => $row->error,
            'analyzed_at' => $row->analyzed_at?->toIso8601String(),
        ];
    }

    /**
     * One step of the reading (queued job): the first step reads the columns by meaning (embeddings, seconds) and lists
     * the columns the model must look at; every next step asks the model about a few of them, validates the answer
     * and saves it, so results appear while the rest is still being read. Returns true when more steps are needed.
     */
    public function analyze(DbConnection $connection, string $table): bool
    {
        // Every model call of this step ends before the job's time limit (AnalyzeTableInsightsJob::$timeout).
        $deadline = microtime(true) + AnalyzeTableInsightsJob::STEP_SECONDS;
        $schema = app(LiveSchemaService::class);
        $catalog = $schema->getCatalog($connection, true);
        $meta = $catalog['tables'][$table] ?? null;
        $row = SchemaTableInsight::firstOrNew(['connection_id' => $connection->id, 'table_name' => $table], ['user_id' => $connection->user_id]);
        if (!$meta || ($meta['class'] ?? null) === 'blocked') {
            if ($row->exists) {
                $row->delete();
            }
            return false;
        }

        $hash = self::hash($meta);
        $state = (array) ($row->insights ?? []);
        $continuing = $row->exists && $row->status === 'pending' && $row->schema_hash === $hash && isset($state['queue']);
        $user = $connection->user;
        $model = ModelSelector::for($user, ModelRole::ROLE_PLANNER);
        // Stored values and examples go only to a local model, or to a cloud model the customer allowed to see results.
        $cloud = in_array(strtolower((string) $model['provider']), ModelSelector::CLOUD_PROVIDERS, true);
        $withData = !$cloud || ($user->privacy_mode ?? 'local_only') === 'cloud_with_results';

        try {
            $payload = $this->request($connection, $catalog, $table, $withData);
            $focus = $continuing ? array_slice((array) $state['queue'], 0, self::BATCH) : [];
            $res = AiUsage::using($connection->user_id, 'schema_insight', $connection, fn () => $this->ai->interpretTable($payload + [
                'focus' => $focus,
                'provider' => $model['provider'],
                'model' => $model['model'],
                'api_key' => $model['api_key'],
                'user_id' => $connection->user_id,
            ]));
        } catch (\Throwable $e) {
            Log::info("[TableInsight] {$table} on connection {$connection->id}: " . $e->getMessage());
            $row->fill(['user_id' => $connection->user_id, 'schema_hash' => $hash, 'status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 500)])->save();
            return false;
        }

        if (!$continuing) {
            $state = ['summary' => null, 'columns' => [], 'queue' => array_values((array) ($res['open_columns'] ?? [])), 'problems' => []];
            $state['total'] = count($state['queue']);
        }
        $state['hints'] = $res['hints'] ?? ($state['hints'] ?? []);
        $state['media_tables'] = $res['media_tables'] ?? ($state['media_tables'] ?? []);
        $state['with_values'] = $withData;
        $answered = $this->validate($connection, $catalog, $table, (array) ($res['columns'] ?? []), $payload['columns'],
            ['model' => $model, 'with_data' => $withData, 'deadline' => $deadline]);
        $problems = array_values(array_filter((array) ($res['problems'] ?? [])));
        if ($continuing) {
            $state['columns'] = $answered + (array) $state['columns'];
            $state['queue'] = array_values(array_slice((array) $state['queue'], self::BATCH));
            $state['summary'] = $state['summary'] ?: (mb_substr((string) ($res['summary'] ?? ''), 0, 300) ?: null);
        }
        $state['problems'] = array_slice(array_values(array_unique(array_merge((array) ($state['problems'] ?? []), $problems))), -5);
        // The model could not answer (not reachable, too slow): stop here instead of retrying every batch.
        $stopped = $continuing && !$answered && $problems;
        $more = !$stopped && !empty($state['queue']);

        $row->fill([
            'user_id' => $connection->user_id,
            'schema_hash' => $hash,
            // Stopped before the model answered anything (too slow, busy): failed, so it is tried again after a rest.
            'status' => $more ? 'pending' : ($stopped && !$state['columns'] ? 'failed' : 'ready'),
            'source' => $state['columns'] ? 'model' : 'embeddings',
            'model' => $state['columns'] ? trim($model['provider'] . ' ' . ($model['model'] ?? '')) : ($res['embedding_backend'] ?? null),
            'insights' => $state,
            'error' => $stopped ? mb_substr(implode(' ', $problems), 0, 500) : null,
            'analyzed_at' => now(),
        ])->save();
        if ($answered) {
            $schema->forget($connection);
        }
        if (!$more) {
            // A table its images are kept in is read next, so new images can be stored there.
            foreach ((array) $state['columns'] as $c) {
                $ref = $c['references_table'] ?? null;
                if (($c['role'] ?? null) === 'image_reference' && $ref && isset($catalog['tables'][$ref])) {
                    // A new reason to read it: an earlier failed attempt does not have to rest first.
                    $failed = SchemaTableInsight::where('connection_id', $connection->id)->where('table_name', $ref)->where('status', 'failed')->exists();
                    $this->ensure($connection, $ref, $catalog['tables'][$ref], $failed);
                }
            }
        }
        if (!$more && $state['columns']) {
            // The table's profile in the knowledge index now says what its columns mean.
            $snapshot = \App\Models\SchemaSnapshot::where('connection_id', $connection->id)->orderByDesc('id')->first();
            $entry = collect($snapshot?->schema_payload['tables'] ?? [])->firstWhere('name', $table);
            if ($entry) {
                \App\Jobs\IndexTableProfilesJob::dispatch($connection, [$entry]);
            }
        }
        return $more;
    }

    /** What the AI service is told: columns with their known links, bounded value counts and examples, other tables. */
    private function request(DbConnection $connection, array $catalog, string $table, bool $withData): array
    {
        $meta = $catalog['tables'][$table];
        $pk = (array) ($meta['primary_key'] ?? []);
        $links = [];
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            // Links the AI found earlier are not repeated as facts, so a new reading is its own.
            if (count($fk['columns'] ?? []) === 1 && ($fk['source'] ?? 'declared') !== 'ai') {
                $links[$fk['columns'][0]] = $fk['ref_table'] . '.' . $fk['ref_columns'][0];
            }
        }

        $valueCols = [];
        $sampleCols = [];
        foreach ($meta['columns'] as $name => $c) {
            $family = $c['family'] ?? '';
            if (!$withData || in_array($name, $pk, true) || isset($links[$name]) || ColumnClassifier::classify((string) $name)['class'] !== 'standard') {
                continue;
            }
            if (in_array($family, ['integer', 'boolean'], true) || ($family === 'string' && (int) ($c['max_length'] ?? 255) <= 64) || $family === 'enum') {
                $valueCols[] = $name;
            } elseif ($family === 'string' && (int) ($c['max_length'] ?? 255) <= 500) {
                $sampleCols[] = $name;
            }
        }
        [$values, $samples] = ($valueCols || $sampleCols) ? $this->observe($connection, $table, $valueCols, $sampleCols) : [[], []];

        $columns = [];
        foreach ($meta['columns'] as $name => $c) {
            if (ColumnClassifier::isSecret((string) $name) || ($c['family'] ?? '') === 'binary') {
                continue;
            }
            $columns[] = array_filter([
                'name' => $name,
                'type' => $c['raw_type'] ?? $c['data_type'] ?? '',
                'family' => $c['family'] ?? 'other',
                'nullable' => (bool) ($c['nullable'] ?? true),
                'default' => $c['default'] ?? null,
                'is_pk' => in_array($name, $pk, true),
                'link' => $links[$name] ?? null,
                'enum' => $c['enum'] ?? [],
                'comment' => $c['comment'] ?? '',
                'values' => $values[$name] ?? null,
                'samples' => $samples[$name] ?? null,
            ], fn ($v) => $v !== null && $v !== [] && $v !== '');
        }

        $insights = $this->forConnection($connection);
        $others = [];
        foreach ($catalog['tables'] as $name => $t) {
            if ($name === $table || ($t['class'] ?? null) === 'blocked' || count($t['primary_key'] ?? []) !== 1) {
                continue;
            }
            $roles = array_column((array) ($insights[$name]['columns'] ?? []), 'role');
            $others[] = [
                'name' => $name,
                'description' => 'key ' . $t['primary_key'][0] . '; columns: ' . implode(', ', array_slice(array_keys($t['columns']), 0, 20))
                    . ($t['label_column'] ?? null ? "; rows named by {$t['label_column']}" : ''),
                'key' => $t['primary_key'][0],
                'columns' => array_slice(array_map('strval', array_keys($t['columns'])), 0, 20),
                'media' => (bool) array_intersect($roles, self::FILE_ROLES),
            ];
        }

        return ['table' => $table, 'columns' => $columns, 'other_tables' => array_slice($others, 0, 600), 'budget_seconds' => 450];
    }

    /** Bounded reads: up to 15 distinct values (with counts) of short columns, 3 examples of longer text columns. */
    private function observe(DbConnection $connection, string $table, array $valueCols, array $sampleCols): array
    {
        try {
            return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $valueCols, $sampleCols) {
                $qt = $dialect->quoteIdentifier($table);
                $values = [];
                foreach ($valueCols as $col) {
                    $qc = $dialect->quoteIdentifier($col);
                    $rows = $pdo->query("SELECT v, COUNT(*) AS n FROM (SELECT {$qc} AS v FROM {$qt} WHERE {$qc} IS NOT NULL LIMIT 5000) s GROUP BY v ORDER BY n DESC LIMIT " . (self::MAX_VALUES + 1))->fetchAll(PDO::FETCH_ASSOC);
                    if ($rows && count($rows) <= self::MAX_VALUES) {
                        $values[$col] = array_map(fn ($r) => ['value' => is_numeric($r['v']) && (string) (int) $r['v'] === (string) $r['v'] ? (int) $r['v'] : mb_substr((string) $r['v'], 0, 64), 'count' => (int) $r['n']], $rows);
                    }
                }
                $samples = [];
                foreach ($sampleCols as $col) {
                    $qc = $dialect->quoteIdentifier($col);
                    $vals = $pdo->query("SELECT v FROM (SELECT {$qc} AS v FROM {$qt} WHERE {$qc} IS NOT NULL AND {$qc} <> '' LIMIT 200) s GROUP BY v LIMIT 3")->fetchAll(PDO::FETCH_COLUMN);
                    if ($vals) {
                        $samples[$col] = array_map(fn ($v) => mb_substr((string) $v, 0, 80), $vals);
                    }
                }
                return [$values, $samples];
            }, 6000);
        } catch (\Throwable) {
            return [[], []];
        }
    }

    /**
     * Keep what fits the live schema: existing columns, known roles, real tables of a compatible key whose keys the
     * stored values actually are, observed values.
     */
    private function validate(DbConnection $connection, array $catalog, string $table, array $answer, array $sent, array $context): array
    {
        $meta = $catalog['tables'][$table];
        $sentBy = [];
        foreach ($sent as $c) {
            $sentBy[$c['name']] = $c;
        }
        $out = [];
        foreach ($answer as $name => $a) {
            $col = $meta['columns'][$name] ?? null;
            $role = $a['role'] ?? null;
            if (!$col || !is_array($a) || !in_array($role, self::ROLES, true) || !isset($sentBy[$name])) {
                continue;
            }
            $ref = null;
            $refName = $a['references_table'] ?? null;
            if (is_string($refName) && $refName !== $table && isset($catalog['tables'][$refName])) {
                $target = $catalog['tables'][$refName];
                $pk = $target['primary_key'][0] ?? null;
                $fam = fn ($f) => $f === 'integer' ? 'integer' : (in_array($f, ['string', 'uuid'], true) ? 'string' : $f);
                if ($pk && count($target['primary_key']) === 1 && ($target['class'] ?? null) !== 'blocked'
                    && $fam($col['family'] ?? '') === $fam($target['columns'][$pk]['family'] ?? '')
                    && $this->valuesMatch($connection, $table, (string) $name, $refName)) {
                    $ref = $refName;
                }
            }
            if ($ref !== null && in_array($col['family'] ?? '', ['integer', 'uuid'], true) && in_array($role, ['image', 'file_url', 'file_path', 'file_name'], true)) {
                $role = $role === 'image' ? 'image_reference' : 'file_reference'; // a picture kept in another table, stored by id
            }
            if ($ref !== null && $role === 'link' && in_array($a['meaning_role'] ?? null, ['status', 'type', 'flag'], true)
                && !empty($sentBy[$name]['values']) && $context['with_data'] && microtime(true) < $context['deadline'] - 30) {
                // The model's own meaning reads like a code ("Item visibility status"): the rows the stored values
                // would point to decide whether it is a link or a code that only happens to equal some ids.
                $judged = $this->judgeLink($connection, $catalog, $table, (string) $name, $a, $ref, (array) $sentBy[$name]['values'], $context);
                if ($judged['decision'] === 'code') {
                    [$ref, $role] = [null, $a['meaning_role']];
                    $a['value_names'] = $judged['value_names'] + (array) ($a['value_names'] ?? []);
                }
            }
            if (in_array($role, ['image_reference', 'file_reference', 'link'], true) && $ref === null) {
                // An id that points nowhere real is not a link: drop the claim and keep the role its meaning reads as.
                $closest = $a['meaning_role'] ?? null;
                $role = is_string($closest) && in_array($closest, self::ROLES, true) && !in_array($closest, ['image_reference', 'file_reference', 'link'], true)
                    && self::kindFor($closest, $col) !== false
                    ? $closest : (in_array($col['family'] ?? '', ['integer'], true) ? 'number' : 'text');
            }
            if (self::kindFor($role, $col) === false) {
                continue; // the role does not fit the column's type (a body in an integer column)
            }
            $observed = array_map(fn ($v) => (string) $v['value'], (array) ($sentBy[$name]['values'] ?? []));
            $observed = array_merge($observed, array_map('strval', (array) ($col['enum'] ?? [])));
            $names = [];
            foreach ((array) ($a['value_names'] ?? []) as $value => $label) {
                $value = (string) $value;
                $label = trim((string) $label);
                if (in_array($value, $observed, true) && $label !== '' && mb_strlen($label) <= 40) {
                    $names[$value] = $label;
                }
            }
            $out[$name] = [
                'role' => $role,
                'meaning' => mb_substr(trim((string) ($a['meaning'] ?? '')), 0, 200),
                'references_table' => $ref,
                'value_names' => $names,
                'values' => (array) ($sentBy[$name]['values'] ?? []),
            ];
        }
        return $out;
    }

    /**
     * Link or code: the stored values next to the names of the rows they would point to, judged by the customer's model
     * (only when values may be shown to it). No names to show, no time left or no answer: the link stands.
     */
    private function judgeLink(DbConnection $connection, array $catalog, string $table, string $column, array $answer, string $ref, array $values, array $context): array
    {
        $values = array_slice($values, 0, self::MAX_VALUES);
        $probe = $catalog;
        $probe['tables'][$table]['foreign_keys'] = [['columns' => [$column], 'ref_table' => $ref, 'ref_columns' => [$catalog['tables'][$ref]['primary_key'][0]]]];
        try {
            $labels = app(LinkedRecords::class)->labels($connection, $probe, $table, array_map(fn ($v) => [$column => $v['value']], $values), [$column])[$column] ?? [];
            if (!$labels) {
                return ['decision' => 'link', 'value_names' => []];
            }
            $model = $context['model'];
            $res = AiUsage::using($connection->user_id, 'schema_insight', $connection, fn () => $this->ai->checkLink([
                'table' => $table,
                'column' => $column,
                'meaning' => (string) ($answer['meaning'] ?? ''),
                'ref_table' => $ref,
                'rows' => array_map(fn ($v) => ['value' => $v['value'], 'count' => $v['count'] ?? null, 'label' => $labels[(string) $v['value']] ?? null], $values),
                'budget_seconds' => (int) max(10, min(90, $context['deadline'] - microtime(true) - 15)),
                'provider' => $model['provider'],
                'model' => $model['model'],
                'api_key' => $model['api_key'],
            ]));
        } catch (\Throwable $e) {
            Log::info("[TableInsight] link check {$table}.{$column} on connection {$connection->id}: " . $e->getMessage());
            return ['decision' => 'link', 'value_names' => []];
        }
        return ['decision' => ($res['decision'] ?? null) === 'code' ? 'code' : 'link', 'value_names' => (array) ($res['value_names'] ?? [])];
    }

    /**
     * A link the model claims stands only when the column's stored values are keys of that table (bounded sample read
     * in Laravel; nothing is sent to the model). No values yet, or no way to check, leaves the claim standing.
     */
    private function valuesMatch(DbConnection $connection, string $table, string $column, string $refTable): bool
    {
        try {
            $result = app(LinkedRecords::class)->check($connection, $table, $column, [$refTable])['results'][0] ?? null;
        } catch (\Throwable $e) {
            return true;
        }
        return ($result['verdict'] ?? null) !== 'no_match';
    }

    /**
     * The column kind an automation uses for an AI role (TargetTableInspector kinds), null when the role adds nothing
     * to what the type says, false when the role does not fit the column's type.
     */
    public static function kindFor(string $role, array $col): string|false|null
    {
        $family = $col['family'] ?? '';
        $text = in_array($family, ['string', 'text'], true);
        return match ($role) {
            'title', 'slug', 'summary', 'body', 'keywords', 'url', 'contact', 'image' => $text ? ($role === 'image' ? 'image' : $role) : false,
            'seo_title' => $text ? 'meta_title' : false,
            'seo_description' => $text ? 'meta_description' : false,
            'image_reference' => in_array($family, ['integer', 'string', 'uuid'], true) ? 'image' : false,
            'number', 'file_size', 'image_width', 'image_height' => in_array($family, ['integer', 'decimal'], true) ? 'number' : false,
            'flag' => in_array($family, ['integer', 'boolean'], true) ? 'boolean' : false,
            'datetime' => in_array($family, ['date', 'time', 'timestamp_tz', 'timestamp_naive', 'integer'], true) ? null : false,
            'json' => in_array($family, ['json', 'text', 'string'], true) ? 'json' : false,
            default => null,
        };
    }
}
