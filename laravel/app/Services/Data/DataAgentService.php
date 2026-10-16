<?php

namespace App\Services\Data;

use App\Models\DataConversationState;
use App\Models\DataQueryResult;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\AiServiceClient;
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
                'type' => 'dummy_data_report',
                'headline' => "Analyzed table '{$targetTable}': found {$report['dummy_count']} likely dummy/test records with {$report['confidence']} confidence.",
                'report' => $report,
                'connection' => ['id' => $connection->id, 'name' => $connection->name],
            ];
        }

        // 6. Natural Language Query Planning & Execution Pipeline
        $schemaSlice = $this->schemaLinker->slice($connection, $u);
        $tz = $connection->data_timezone ?: ($user->timezone ?: 'Asia/Kolkata');

        // Call AI planner service
        $plan = $this->aiClient->generateDataPlan([
            'utterance' => $u,
            'schema_slice' => $schemaSlice,
            'context' => [
                'active_connection' => $connection->name,
                'active_table' => $convState->active_table,
            ],
            'timezone' => $tz,
        ]);

        if (empty($plan) || !isset($plan['intent'])) {
            // Local fallback planner
            $plan = $this->fallbackPlan($u, $schemaSlice, $tz, $convState->active_table);
        }

        // Validate plan against live schema and access policy
        $valErrors = $this->validator->validate($connection, $plan);
        if (!empty($valErrors)) {
            // If validation fails, try to repair or return honest explanation
            return [
                'type' => 'error',
                'headline' => 'Query planning failed validation against live schema.',
                'errors' => $valErrors,
                'connection' => ['id' => $connection->id, 'name' => $connection->name],
            ];
        }

        // Compile to parameterized SQL
        $compiled = $this->compiler->compile($connection, $plan, $catalog);

        // Execute in read-only transaction
        $revealPii = !empty($options['reveal_pii']);
        $readResult = $this->readExecutor->execute($connection, $compiled['sql'], $compiled['bindings'], $revealPii);

        // Update active table
        $primaryTable = $compiled['primary_table'];
        $convState->update([
            'active_table' => $primaryTable,
            'last_query_plan' => $plan,
        ]);

        // Compose response
        $composed = AnswerComposer::compose($u, $plan, $readResult, $compiled['assumptions']);

        // Persist query result for re-inspection and caching
        $resultRecord = DataQueryResult::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'query_hash' => hash('sha256', $compiled['sql'] . json_encode($compiled['bindings'])),
            'user_question' => $u,
            'compiled_sql' => $compiled['sql'],
            'bindings' => $compiled['bindings'],
            'row_count' => $readResult['row_count'],
            'masked_rows' => $composed['rows'],
            'columns' => $composed['columns'],
            'assumptions' => $composed['assumptions'],
            'how_i_got_this' => $composed['diagnostics'],
            'expires_at' => now()->addDays(7),
        ]);

        $convState->update(['last_result_id' => $resultRecord->id]);

        return [
            'type' => 'data_query',
            'result_id' => $resultRecord->id,
            'headline' => $composed['headline'],
            'row_count' => $composed['row_count'],
            'columns' => $composed['columns'],
            'rows' => $composed['rows'],
            'diagnostics' => $composed['diagnostics'],
            'assumptions' => $composed['assumptions'],
            'connection' => ['id' => $connection->id, 'name' => $connection->name, 'driver' => $connection->driver],
            'active_table' => $primaryTable,
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

    protected function fallbackPlan(string $utterance, array $schemaSlice, string $timezone, ?string $activeTable): array
    {
        $u = strtolower($utterance);
        $tables = array_keys($schemaSlice['tables'] ?? []);

        // 1. Identify primary table
        $table = null;
        $tableKeywords = [
            'users' => ['user', 'customer', 'account', 'people', 'registered'],
            'orders' => ['order', 'purchase', 'sales', 'revenue'],
            'order_items' => ['order item', 'order_item', 'item in order', 'quantity of items', 'items sold'],
            'products' => ['product', 'item', 'stock', 'inventory', 'price'],
            'categories' => ['categor'],
            'payments' => ['payment', 'paid', 'transaction'],
            'posts' => ['post', 'article', 'blog', 'news'],
            'post_comments' => ['comment'],
            'audit_logs' => ['audit', 'log'],
            'page_views' => ['page_view', 'page view', 'visit'],
        ];

        foreach ($tableKeywords as $t => $keywords) {
            foreach ($keywords as $kw) {
                if (str_contains($u, $kw)) {
                    $table = $t;
                    break 2;
                }
            }
        }

        if (!$table) {
            $table = $activeTable && in_array($activeTable, $tables, true) ? $activeTable : ($tables[0] ?? 'users');
        }

        // 2. Identify intent and aggregations
        $intent = 'list';
        $select = [];
        $groupBy = [];
        $orderBy = [];
        $joins = [];
        $filters = [];
        $assumptions = [];
        $timeWindow = null;
        $limit = 50;

        // Resolve actual column names from schemaSlice
        $ordersTotalCol = isset($schemaSlice['tables']['orders']['columns']['total']) ? 'total' : 'total_amount';
        $orderItemsQtyCol = isset($schemaSlice['tables']['order_items']['columns']['qty']) ? 'qty' : 'quantity';
        $productsStockCol = isset($schemaSlice['tables']['products']['columns']['stock']) ? 'stock' : 'stock_quantity';
        $paymentsMethodCol = isset($schemaSlice['tables']['payments']['columns']['method']) ? 'method' : 'payment_method';
        $postsAuthorCol = isset($schemaSlice['tables']['posts']['columns']['author_id']) ? 'author_id' : 'user_id';

        if (str_contains($u, 'how many') || str_contains($u, 'count') || str_contains($u, 'total number')) {
            $intent = 'count';
            $select = [['column' => '*', 'table' => $table, 'agg' => 'count', 'alias' => 'total_count']];
        } elseif (str_contains($u, 'total revenue') || str_contains($u, 'total sales') || (str_contains($u, 'total') && str_contains($u, 'amount'))) {
            $intent = 'aggregate';
            $col = $table === 'orders' ? $ordersTotalCol : ($table === 'payments' ? 'amount' : 'price');
            $select = [['column' => $col, 'table' => $table, 'agg' => 'sum', 'alias' => 'total_sum']];
        } elseif (str_contains($u, 'total quantity') || str_contains($u, 'items sold')) {
            $intent = 'aggregate';
            $table = 'order_items';
            $select = [['column' => $orderItemsQtyCol, 'table' => $table, 'agg' => 'sum', 'alias' => 'total_quantity']];
        } elseif (str_contains($u, 'average') || str_contains($u, 'avg')) {
            $intent = 'aggregate';
            $col = $table === 'orders' ? $ordersTotalCol : 'price';
            $select = [['column' => $col, 'table' => $table, 'agg' => 'avg', 'alias' => 'average_value']];
        } elseif (str_contains($u, 'highest') || str_contains($u, 'most expensive') || str_contains($u, 'max price')) {
            $intent = 'list';
            $select = [['column' => '*', 'table' => $table]];
            $col = $table === 'orders' ? $ordersTotalCol : 'price';
            $orderBy = [['column' => $col, 'direction' => 'DESC', 'table' => $table]];
            $limit = 1;
        } elseif (str_contains($u, 'minimum') || str_contains($u, 'cheapest') || str_contains($u, 'min price')) {
            $intent = 'list';
            $select = [['column' => '*', 'table' => $table]];
            $col = $table === 'orders' ? $ordersTotalCol : 'price';
            $orderBy = [['column' => $col, 'direction' => 'ASC', 'table' => $table]];
            $limit = 1;
        } elseif (str_contains($u, 'minimum stock') || str_contains($u, 'lowest stock')) {
            $intent = 'list';
            $table = 'products';
            $select = [['column' => '*', 'table' => $table]];
            $orderBy = [['column' => $productsStockCol, 'direction' => 'ASC', 'table' => $table]];
            $limit = 1;
        } else {
            $select = [['column' => '*', 'table' => $table]];
        }

        // Top N / Limit detection
        if (preg_match('/top\s+(\d+)/i', $u, $m)) {
            $limit = (int) $m[1];
            if (empty($orderBy)) {
                $col = $table === 'products' ? 'price' : ($table === 'orders' ? $ordersTotalCol : 'id');
                $orderBy = [['column' => $col, 'direction' => 'DESC', 'table' => $table]];
            }
        } elseif (preg_match('/(?:recent|latest)\s+(\d+)/i', $u, $m)) {
            $limit = (int) $m[1];
            $orderBy = [['column' => 'created_at', 'direction' => 'DESC', 'table' => $table]];
        }

        // Group by detection
        if (str_contains($u, 'by region')) {
            $intent = 'aggregate';
            $groupBy = ['region'];
            $select = [
                ['column' => 'region', 'table' => $table],
                ['column' => '*', 'table' => $table, 'agg' => 'count', 'alias' => 'user_count'],
            ];
        } elseif (str_contains($u, 'by status')) {
            $intent = 'aggregate';
            $groupBy = ['status'];
            $select = [
                ['column' => 'status', 'table' => $table],
                ['column' => '*', 'table' => $table, 'agg' => 'count', 'alias' => 'item_count'],
            ];
        } elseif (str_contains($u, 'by category')) {
            $intent = 'aggregate';
            $groupBy = ['category_id'];
            $select = [
                ['column' => 'category_id', 'table' => $table],
                ['column' => '*', 'table' => $table, 'agg' => 'count', 'alias' => 'product_count'],
            ];
        } elseif (str_contains($u, 'by payment method') || str_contains($u, 'by payment_method')) {
            $intent = 'aggregate';
            $table = 'payments';
            $groupBy = [$paymentsMethodCol];
            $select = [
                ['column' => $paymentsMethodCol, 'table' => $table],
                ['column' => 'amount', 'table' => $table, 'agg' => 'sum', 'alias' => 'total_amount'],
            ];
        }

        // Value grounding & filters
        if (str_contains($u, 'rajasthan') || str_contains($u, 'region rj')) {
            $filters[] = ['column' => 'region', 'op' => '=', 'value' => 'RJ', 'table' => $table];
            $assumptions[] = "Mapped 'Rajasthan' to region code 'RJ'";
        } elseif (str_contains($u, 'maharashtra') || str_contains($u, 'region mh')) {
            $filters[] = ['column' => 'region', 'op' => '=', 'value' => 'MH', 'table' => $table];
            $assumptions[] = "Mapped 'Maharashtra' to region code 'MH'";
        } elseif (preg_match('/region\s*=\s*([a-z0-9_]+)/i', $u, $rm)) {
            $filters[] = ['column' => 'region', 'op' => '=', 'value' => strtoupper($rm[1]), 'table' => $table];
        }

        if (str_contains($u, 'completed')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'completed', 'table' => $table];
        } elseif (str_contains($u, 'cancelled')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'cancelled', 'table' => $table];
        } elseif (str_contains($u, 'processing')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'processing', 'table' => $table];
        } elseif (str_contains($u, 'pending')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'pending', 'table' => $table];
        } elseif (str_contains($u, 'active status') || str_contains($u, 'status is active') || str_contains($u, 'users where status is active')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'active', 'table' => $table];
        } elseif (str_contains($u, 'published posts') || str_contains($u, 'posts that are published')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'published', 'table' => 'posts'];
        } elseif (str_contains($u, 'draft posts') || str_contains($u, 'posts that are draft')) {
            $filters[] = ['column' => 'status', 'op' => '=', 'value' => 'draft', 'table' => 'posts'];
        }

        if (str_contains($u, 'out of stock') || str_contains($u, 'stock = 0')) {
            $table = 'products';
            $filters[] = ['column' => $productsStockCol, 'op' => '=', 'value' => 0, 'table' => 'products'];
        } elseif (str_contains($u, 'in stock')) {
            $table = 'products';
            $filters[] = ['column' => $productsStockCol, 'op' => '>', 'value' => 0, 'table' => 'products'];
        }

        if (preg_match('/price\s+(?:greater than|>)\s+(\d+(?:\.\d+)?)/i', $u, $pm)) {
            $filters[] = ['column' => 'price', 'op' => '>', 'value' => (float)$pm[1], 'table' => $table];
        } elseif (preg_match('/price\s+(?:less than|<)\s+(\d+(?:\.\d+)?)/i', $u, $pm)) {
            $filters[] = ['column' => 'price', 'op' => '<', 'value' => (float)$pm[1], 'table' => $table];
        }

        if (preg_match('/(?:user|by user)\s+(\d+)/i', $u, $um)) {
            $userIdVal = (int) $um[1];
            if ($table === 'posts') {
                $filters[] = ['column' => $postsAuthorCol, 'op' => '=', 'value' => $userIdVal, 'table' => 'posts'];
            } elseif ($table === 'users') {
                $filters[] = ['column' => 'id', 'op' => '=', 'value' => $userIdVal, 'table' => 'users'];
            } else {
                $filters[] = ['column' => 'user_id', 'op' => '=', 'value' => $userIdVal, 'table' => $table];
            }
        }

        if (preg_match('/(?:order|in order|for order)\s+(\d+)/i', $u, $om)) {
            $filters[] = ['column' => $table === 'orders' ? 'id' : 'order_id', 'op' => '=', 'value' => (int)$om[1], 'table' => $table];
        }

        if (preg_match('/(?:post|on post)\s+(\d+)/i', $u, $posm)) {
            $filters[] = ['column' => $table === 'posts' ? 'id' : 'post_id', 'op' => '=', 'value' => (int)$posm[1], 'table' => $table];
        }

        if (str_contains($u, 'credit_card') || str_contains($u, 'credit card')) {
            $table = 'payments';
            $filters[] = ['column' => $paymentsMethodCol, 'op' => '=', 'value' => 'credit_card', 'table' => 'payments'];
        }

        // Time window detection
        if (str_contains($u, 'today') || str_contains($u, 'new users')) {
            $timeWindow = [
                'column' => 'created_at',
                'from' => 'start_of_day',
                'to' => 'end_of_day',
                'timezone' => $timezone,
                'label' => 'today',
            ];
            $assumptions[] = "Assumed 'created_at' in timezone '{$timezone}' for 'today'";
        } elseif (str_contains($u, 'yesterday')) {
            $timeWindow = [
                'column' => 'created_at',
                'from' => 'start_of_yesterday',
                'to' => 'end_of_yesterday',
                'timezone' => $timezone,
                'label' => 'yesterday',
            ];
            $assumptions[] = "Assumed 'created_at' in timezone '{$timezone}' for 'yesterday'";
        } elseif (str_contains($u, 'last 7 days')) {
            $timeWindow = [
                'column' => 'created_at',
                'from' => '7_days_ago',
                'to' => 'now',
                'timezone' => $timezone,
                'label' => 'last 7 days',
            ];
            $assumptions[] = "Assumed 'created_at' in timezone '{$timezone}' for 'last 7 days'";
        } elseif (str_contains($u, 'this week')) {
            $timeWindow = [
                'column' => 'created_at',
                'from' => 'start_of_week',
                'to' => 'now',
                'timezone' => $timezone,
                'label' => 'this week',
            ];
            $assumptions[] = "Assumed 'created_at' in timezone '{$timezone}' for 'this week'";
        } elseif (str_contains($u, 'this month')) {
            $timeWindow = [
                'column' => 'created_at',
                'from' => 'start_of_month',
                'to' => 'now',
                'timezone' => $timezone,
                'label' => 'this month',
            ];
            $assumptions[] = "Assumed 'created_at' in timezone '{$timezone}' for 'this month'";
        }

        // Joins detection
        if (str_contains($u, 'user details') || str_contains($u, 'user name') || str_contains($u, 'author name')) {
            $joins[] = ['from' => $table, 'to' => 'users', 'via_fk' => 'user_id'];
        } elseif (str_contains($u, 'category') && $table === 'products') {
            $joins[] = ['from' => 'products', 'to' => 'categories', 'via_fk' => 'category_id'];
        } elseif (str_contains($u, 'product name') && $table === 'order_items') {
            $joins[] = ['from' => 'order_items', 'to' => 'products', 'via_fk' => 'product_id'];
        } elseif (str_contains($u, 'payment details') && $table === 'orders') {
            $joins[] = ['from' => 'orders', 'to' => 'payments', 'via_fk' => 'order_id'];
        }

        return [
            'intent' => $intent,
            'tables' => array_values(array_unique(array_merge([$table], array_column($joins, 'to')))),
            'select' => $select,
            'filters' => $filters,
            'joins' => $joins,
            'group_by' => $groupBy,
            'order_by' => $orderBy,
            'time_window' => $timeWindow,
            'limit' => $limit,
            'assumptions' => $assumptions,
        ];
    }
}
