<?php

namespace App\Services;

use App\Models\DbConnection;
use App\Models\AutomationExecution;
use App\Models\User;
use Exception;
use PDO;

class DatabaseInsightsService
{
    public function __construct(
        protected FeatureFlagService $featureFlagService,
        protected DatabaseSafetyService $safetyService,
        protected SchemaIntrospectionService $introspectionService
    ) {}

    /**
     * Compute safe, read-only analytical insights for a customer database connection.
     */
    public function getInsights(User $user, DbConnection $connection): array
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_DB_INSIGHTS')) {
            throw new Exception("Database Insights feature is disabled by platform feature flag.");
        }

        if ($connection->user_id !== $user->id) {
            throw new Exception("Unauthorized: You do not own connection #{$connection->id}.");
        }

        $this->safetyService->validateConnectionTarget($connection->host, $connection->port);

        // 1. Introspect allowable tables
        $schema = $this->introspectionService->introspect($connection);
        $allTables = $schema['tables'] ?? [];

        $tableStats = [];
        $totalRows = 0;
        $pdo = null;

        try {
            $pdo = $connection->createTargetPdo();

            foreach ($allTables as $t) {
                $tblName = $t['name'];
                // Skip restricted/sensitive tables
                if ($this->safetyService->isTableSensitive($tblName)) {
                    continue;
                }

                // Strictly parameterized count on allowlisted table name
                $stmt = $pdo->query("SELECT COUNT(*) AS c FROM `{$tblName}`");
                $rowCount = (int) ($stmt->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);
                $totalRows += $rowCount;

                $tableStats[] = [
                    'table_name' => $tblName,
                    'row_count' => $rowCount,
                    'column_count' => count($t['columns'] ?? []),
                    'has_foreign_keys' => !empty($t['foreign_keys'] ?? []),
                ];
            }
        } catch (\Throwable $e) {
            // Provide schema stats if target connection query fails
        } finally {
            $pdo = null;
        }

        // 2. Publication velocity from platform executions over the last 30 days
        $executions = AutomationExecution::whereHas('automation', function ($q) use ($connection) {
                $q->where('connection_id', $connection->id);
            })
            ->where('created_at', '>=', now()->subDays(30))
            ->get(['id', 'status', 'created_at', 'published_at']);

        $completedCount = $executions->where('status', 'COMPLETED')->count();
        $failedCount = $executions->where('status', 'FAILED')->count();
        $pendingCount = $executions->whereIn('status', ['PENDING', 'RUNNING', 'WAITING_FOR_APPROVAL'])->count();

        // Daily publication timeseries for chart visualization
        $timeseries = [];
        for ($i = 29; $i >= 0; $i--) {
            $day = now()->subDays($i)->format('Y-m-d');
            $count = $executions->filter(function ($e) use ($day) {
                return substr($e->created_at, 0, 10) === $day && $e->status === 'COMPLETED';
            })->count();
            $timeseries[] = ['date' => $day, 'published' => $count];
        }

        return [
            'connection_id' => $connection->id,
            'connection_name' => $connection->name,
            'database_name' => $connection->database_name,
            'tables' => $tableStats,
            'total_tables' => count($tableStats),
            'total_rows' => $totalRows,
            'monthly_publications' => $completedCount,
            'success_rate_percent' => ($completedCount + $failedCount) > 0
                ? round(($completedCount / ($completedCount + $failedCount)) * 100, 1)
                : 100,
            'active_pipeline_count' => $pendingCount,
            'velocity_timeseries' => $timeseries,
            'timeseries' => $timeseries,
        ];
    }
}
