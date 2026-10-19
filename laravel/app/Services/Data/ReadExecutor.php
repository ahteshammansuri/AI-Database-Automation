<?php

namespace App\Services\Data;

use App\Models\AuditLog;
use App\Models\DbConnection;
use PDO;

class ReadExecutor
{
    public function __construct(
        protected TargetConnector $targetConnector,
        protected DataAccessPolicy $policy
    ) {}

    /**
     * Execute a read query safely: EXPLAIN check, read-only transaction, timeout, and result masking.
     *
     * @return array{success: bool, row_count: int, rows: array, columns: array, execution_time_ms: float, sql: string, bindings: array, error?: string}
     */
    public function execute(
        DbConnection $connection,
        string $sql,
        array $bindings = [],
        bool $revealPii = false
    ): array {
        $startTime = microtime(true);
        $pdo = null;

        try {
            $pdo = $this->targetConnector->getReadOnlyPdo($connection);

            // 1. Dry run EXPLAIN query
            try {
                $explainStmt = $pdo->prepare('EXPLAIN ' . $sql);
                $explainStmt->execute($bindings);
                $explainStmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (\Throwable $e) {
                // If EXPLAIN fails, log and abort
                throw new DataException('QUERY_PLAN_FAILED', 'Query execution plan rejected: ' . $e->getMessage());
            }

            // 2. Execute main query
            $stmt = $pdo->prepare($sql);
            $stmt->execute($bindings);
            $rawRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $elapsedMs = round((microtime(true) - $startTime) * 1000, 2);

            // 3. Mask PII and filter out secrets
            $maskedRows = $this->policy->maskResultRows($rawRows, $revealPii);

            // Extract visible column headers
            $visibleCols = [];
            if (!empty($maskedRows)) {
                $visibleCols = array_keys($maskedRows[0]);
            }

            // 4. Audit read action
            AuditLog::log($connection->user_id, 'data.read_executed', 'db_connections', (string) $connection->id, [
                'sql' => $sql,
                'row_count' => count($maskedRows),
                'execution_time_ms' => $elapsedMs,
                'pii_revealed' => $revealPii,
            ]);

            return [
                'success' => true,
                'row_count' => count($maskedRows),
                'rows' => $maskedRows,
                'columns' => $visibleCols,
                'execution_time_ms' => $elapsedMs,
                'sql' => $sql,
                'bindings' => $bindings,
            ];
        } catch (\Throwable $e) {
            $elapsedMs = round((microtime(true) - $startTime) * 1000, 2);
            return [
                'success' => false,
                'row_count' => 0,
                'rows' => [],
                'columns' => [],
                'execution_time_ms' => $elapsedMs,
                'sql' => $sql,
                'bindings' => $bindings,
                'error' => $e->getMessage(),
            ];
        } finally {
            if ($pdo) {
                // Release connection
                unset($pdo);
            }
        }
    }
}
