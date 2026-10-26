<?php

namespace App\Services\Data;

use App\Models\AuditLog;
use App\Models\DataChangeRequest;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\Data\Dialects\DialectRegistry;
use PDO;

class DataChangeService
{
    // Defaults; the live limits are admin settings (Settings > Data assistant).
    private const MAX_WRITE_ROWS = 100;
    private const MAX_DELETE_ROWS = 50;

    private static function maxWriteRows(): int
    {
        return max(1, (int) config('data_agent.max_write_rows', self::MAX_WRITE_ROWS));
    }

    private static function maxDeleteRows(): int
    {
        return max(1, (int) config('data_agent.max_delete_rows', self::MAX_DELETE_ROWS));
    }

    public function __construct(
        protected TargetConnector $targetConnector,
        protected LiveSchemaService $schemaService,
        protected DataAccessPolicy $policy,
        protected DialectRegistry $dialectRegistry
    ) {}

    /**
     * Step 1: Prepare preview & impact analysis for an UPDATE.
     */
    public function previewUpdate(
        DbConnection $connection,
        User $user,
        string $tableName,
        array $filter,
        array $patchValues,
        ?int $taskId = null
    ): array {
        $this->policy->assertCanWrite($connection, $tableName, 'update');

        $catalog = $this->schemaService->getCatalog($connection);
        $tableMeta = $catalog['tables'][$tableName] ?? null;
        if (!$tableMeta) {
            throw new DataException('TABLE_NOT_FOUND', "Table '{$tableName}' does not exist.");
        }

        $pkCols = $tableMeta['primary_key'] ?? [];
        if (empty($pkCols)) {
            throw new DataException('NO_PRIMARY_KEY', "Table '{$tableName}' does not have a primary key. Writes are prohibited without a declared primary key.");
        }
        $primaryKey = $pkCols[0];

        // Ensure not patching secret columns
        foreach (array_keys($patchValues) as $patchCol) {
            if (ColumnClassifier::isSecret($patchCol)) {
                throw new DataException('SECRET_COLUMN_RESTRICTED', "Writing to credential/secret column '{$patchCol}' is prohibited.");
            }
            if (!isset($tableMeta['columns'][$patchCol])) {
                throw new DataException('COLUMN_NOT_FOUND', "Column '{$patchCol}' does not exist on table '{$tableName}'.");
            }
        }

        // Read target rows
        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $qTable = $dialect->quoteIdentifier($tableName);
        $whereSql = [];
        $bindings = [];

        foreach ($filter as $col => $val) {
            $whereSql[] = $dialect->quoteIdentifier($col) . ' = ?';
            $bindings[] = $val;
        }

        $whereClause = !empty($whereSql) ? 'WHERE ' . implode(' AND ', $whereSql) : '';
        $sql = "SELECT * FROM {$qTable} {$whereClause} LIMIT " . (self::maxWriteRows() + 1);

        $pdo = $this->targetConnector->getReadOnlyPdo($connection);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bindings);
        $targetRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $count = count($targetRows);
        if ($count === 0) {
            return [
                'success' => false,
                'message' => "No matching records found in '{$tableName}' to update.",
                'affected_count' => 0,
            ];
        }

        if ($count > self::maxWriteRows()) {
            throw new DataException('MAX_ROWS_EXCEEDED', "Update matches more than the maximum allowed " . self::maxWriteRows() . " rows ({$count} found). Narrow your criteria.");
        }

        $pks = array_column($targetRows, $primaryKey);

        // Build before -> after diff per column
        $diffSummary = [];
        foreach ($patchValues as $col => $newVal) {
            $sampleBefore = $targetRows[0][$col] ?? null;
            $diffSummary[$col] = [
                'before' => ColumnClassifier::mask($sampleBefore, $col),
                'after' => ColumnClassifier::mask($newVal, $col),
            ];
        }

        // Mask sample rows
        $maskedPreview = $this->policy->maskResultRows(array_slice($targetRows, 0, 5));

        // Create pending change request record
        $changeRequest = DataChangeRequest::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'task_id' => $taskId,
            'action' => 'update',
            'target_table' => $tableName,
            'primary_keys' => $pks,
            'filter_spec' => $filter,
            'patch_values' => $patchValues,
            'affected_count' => $count,
            'preview_rows' => $maskedPreview,
            'diff_summary' => $diffSummary,
            'status' => 'pending_confirmation',
            'before_image' => json_encode($targetRows),
            'expires_at' => now()->addMinutes(15),
        ]);

        return [
            'success' => true,
            'change_request_id' => $changeRequest->id,
            'action' => 'update',
            'table' => $tableName,
            'affected_count' => $count,
            'primary_keys' => $pks,
            'diff_summary' => $diffSummary,
            'preview_rows' => $maskedPreview,
            'requires_confirmation' => true,
            'confirmation_type' => $count === 1 ? 'light_confirm' : 'count_confirm',
        ];
    }

    /**
     * Step 1 (Insert): validate every row against the live table (types, required columns, enums, unique values,
     * links to other tables) and keep it as a pending change. Nothing is written until the customer confirms.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @param  string  $source  manual | sample | autopilot (shown in history)
     * @return array{success: bool, errors?: array<int, array<string, string>>, change_request_id?: int, rows?: array}
     */
    public function previewInsert(DbConnection $connection, User $user, string $tableName, array $rows, string $source = 'manual', ?int $taskId = null): array
    {
        $this->policy->assertCanWrite($connection, $tableName, 'insert');
        if (count($rows) === 0) {
            throw new DataException('NO_ROWS', 'There is nothing to add.');
        }
        if (count($rows) > self::maxWriteRows()) {
            throw new DataException('MAX_ROWS_EXCEEDED', 'At most ' . self::maxWriteRows() . ' rows can be added at once.');
        }

        $catalog = $this->schemaService->getCatalog($connection);
        $tableMeta = $catalog['tables'][$tableName] ?? null;
        if (!$tableMeta) {
            throw new DataException('TABLE_NOT_FOUND', "Table '{$tableName}' does not exist.");
        }

        $validator = app(RowValidator::class);
        $clean = [];
        $errors = [];
        foreach (array_values($rows) as $i => $row) {
            [$c, $e] = $validator->validate($tableMeta, (array) $row, true);
            $clean[$i] = $c;
            if ($e) {
                $errors[$i] = $e;
            }
        }
        // Every problem at once: unique values and links are checked for the values that passed the type checks.
        foreach ($this->checkUniqueAndLinks($connection, $tableName, $tableMeta, $clean, []) as $i => $e) {
            $errors[$i] = ($errors[$i] ?? []) + $e;
        }
        if ($errors) {
            ksort($errors);
            return ['success' => false, 'errors' => $errors];
        }

        $preview = $this->policy->maskResultRows(array_slice($clean, 0, 20));
        $change = DataChangeRequest::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'task_id' => $taskId,
            'action' => 'insert',
            'target_table' => $tableName,
            'primary_keys' => [],
            'patch_values' => ['rows' => array_values($clean), 'source' => $source],
            'affected_count' => count($clean),
            'preview_rows' => $preview,
            'status' => 'pending_confirmation',
            'expires_at' => now()->addMinutes(30),
        ]);

        return [
            'success' => true,
            'change_request_id' => $change->id,
            'action' => 'insert',
            'table' => $tableName,
            'affected_count' => count($clean),
            'preview_rows' => $preview,
            'requires_confirmation' => true,
            'confirmation_type' => count($clean) === 1 ? 'light_confirm' : 'count_confirm',
        ];
    }

    /**
     * Values that must be unique are not used yet (in the table or twice in the batch) and every link points at a
     * row that exists. $exceptKeys: primary keys of rows being updated (their own current values are fine).
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, string>>
     */
    public function checkUniqueAndLinks(DbConnection $connection, string $tableName, array $tableMeta, array $rows, array $exceptKeys): array
    {
        $errors = [];
        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $pdo = $this->targetConnector->getReadOnlyPdo($connection);
        $pk = $tableMeta['primary_key'][0] ?? null;
        $qTable = $dialect->quoteIdentifier($tableName);

        $uniqueSets = array_values(array_filter(array_merge([$tableMeta['primary_key'] ?? []], array_values($tableMeta['unique_keys'] ?? [])), fn ($k) => count($k) === 1));
        foreach ($uniqueSets as [$col]) {
            $seen = [];
            foreach ($rows as $i => $row) {
                if (!array_key_exists($col, $row) || $row[$col] === null) {
                    continue;
                }
                $v = (string) $row[$col];
                if (isset($seen[$v])) {
                    $errors[$i][$col] = 'This value is used twice in these rows; it must be unique.';
                    continue;
                }
                $seen[$v] = true;
                $sql = "SELECT 1 FROM {$qTable} WHERE " . $dialect->quoteIdentifier($col) . ' = ?';
                $bind = [$row[$col]];
                if ($pk && isset($exceptKeys[$i])) {
                    $sql .= ' AND ' . $dialect->quoteIdentifier($pk) . ' <> ?';
                    $bind[] = $exceptKeys[$i];
                }
                $stmt = $pdo->prepare($sql . ' LIMIT 1');
                $stmt->execute($bind);
                if ($stmt->fetchColumn()) {
                    $errors[$i][$col] = 'Another row already uses this value; it must be unique.';
                }
            }
        }

        foreach ($tableMeta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns']) !== 1) {
                continue;
            }
            $col = $fk['columns'][0];
            $q = 'SELECT 1 FROM ' . $dialect->quoteIdentifier($fk['ref_table']) . ' WHERE ' . $dialect->quoteIdentifier($fk['ref_columns'][0]) . ' = ? LIMIT 1';
            foreach ($rows as $i => $row) {
                if (!array_key_exists($col, $row) || $row[$col] === null || isset($errors[$i][$col])) {
                    continue;
                }
                $stmt = $pdo->prepare($q);
                $stmt->execute([$row[$col]]);
                if (!$stmt->fetchColumn()) {
                    $errors[$i][$col] = "No row in “{$fk['ref_table']}” has the id {$row[$col]}.";
                }
            }
        }

        return $errors;
    }

    /**
     * Step 1 (Delete): Impact analysis, cascade counts, soft-delete suggestion, typed phrase.
     */
    public function previewDelete(
        DbConnection $connection,
        User $user,
        string $tableName,
        array $filter,
        ?int $taskId = null
    ): array {
        $this->policy->assertCanWrite($connection, $tableName, 'delete');

        $catalog = $this->schemaService->getCatalog($connection);
        $tableMeta = $catalog['tables'][$tableName] ?? null;
        if (!$tableMeta) {
            throw new DataException('TABLE_NOT_FOUND', "Table '{$tableName}' does not exist.");
        }

        $pkCols = $tableMeta['primary_key'] ?? [];
        if (empty($pkCols)) {
            throw new DataException('NO_PRIMARY_KEY', "Table '{$tableName}' does not have a primary key. Deletions require a primary key.");
        }
        $primaryKey = $pkCols[0];

        // Read target rows
        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $qTable = $dialect->quoteIdentifier($tableName);
        $whereSql = [];
        $bindings = [];

        foreach ($filter as $col => $val) {
            $whereSql[] = $dialect->quoteIdentifier($col) . ' = ?';
            $bindings[] = $val;
        }

        if (empty($whereSql)) {
            throw new DataException('TABLE_WIDE_DELETE_PROHIBITED', "Table-wide deletions without WHERE criteria are strictly prohibited.");
        }

        $whereClause = 'WHERE ' . implode(' AND ', $whereSql);
        $sql = "SELECT * FROM {$qTable} {$whereClause} LIMIT " . (self::maxDeleteRows() + 1);

        $pdo = $this->targetConnector->getReadOnlyPdo($connection);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bindings);
        $targetRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $count = count($targetRows);
        if ($count === 0) {
            return [
                'success' => false,
                'message' => "No matching records found in '{$tableName}' to delete.",
                'affected_count' => 0,
            ];
        }

        if ($count > self::maxDeleteRows()) {
            throw new DataException('MAX_ROWS_EXCEEDED', "Delete matches {$count} rows, exceeding maximum limit of " . self::maxDeleteRows() . " rows.");
        }

        $pks = array_column($targetRows, $primaryKey);

        // Impact Analysis: Find child rows referencing these target rows via FKs
        $fks = $catalog['foreign_keys'] ?? [];
        $impactAnalysis = [];
        $totalDependentCount = 0;

        foreach ($fks as $fk) {
            if ($fk['ref_table'] === $tableName && in_array($primaryKey, $fk['ref_columns'], true)) {
                $childTable = $fk['table'];
                $childCol = $fk['columns'][0];

                $qChild = $dialect->quoteIdentifier($childTable);
                $qCol = $dialect->quoteIdentifier($childCol);
                $placeholders = implode(', ', array_fill(0, count($pks), '?'));

                $childStmt = $pdo->prepare("SELECT COUNT(*) FROM {$qChild} WHERE {$qCol} IN ({$placeholders})");
                $childStmt->execute($pks);
                $depCount = (int) $childStmt->fetchColumn();

                if ($depCount > 0) {
                    $impactAnalysis[] = [
                        'child_table' => $childTable,
                        'foreign_key_column' => $childCol,
                        'dependent_row_count' => $depCount,
                        'cascade_action' => $fk['on_delete'] ?? 'RESTRICT/CASCADE',
                    ];
                    $totalDependentCount += $depCount;
                }
            }
        }

        // Soft delete check
        $softDeleteCol = null;
        foreach (['deleted_at', 'is_deleted', 'status', 'active'] as $cand) {
            if (isset($tableMeta['columns'][$cand])) {
                $softDeleteCol = $cand;
                break;
            }
        }

        // Generate required typed phrase
        $typedPhrase = "DELETE {$count} " . strtolower($tableName);

        $maskedPreview = $this->policy->maskResultRows(array_slice($targetRows, 0, 5));

        $changeRequest = DataChangeRequest::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'task_id' => $taskId,
            'action' => 'delete',
            'target_table' => $tableName,
            'primary_keys' => $pks,
            'filter_spec' => $filter,
            'affected_count' => $count,
            'preview_rows' => $maskedPreview,
            'impact_analysis' => $impactAnalysis,
            'confirmation_phrase' => $typedPhrase,
            'status' => 'pending_confirmation',
            'before_image' => json_encode($targetRows),
            'expires_at' => now()->addMinutes(15),
        ]);

        return [
            'success' => true,
            'change_request_id' => $changeRequest->id,
            'action' => 'delete',
            'table' => $tableName,
            'affected_count' => $count,
            'primary_keys' => $pks,
            'impact_analysis' => $impactAnalysis,
            'total_dependent_rows' => $totalDependentCount,
            'soft_delete_available' => (bool) $softDeleteCol,
            'soft_delete_column' => $softDeleteCol,
            'preview_rows' => $maskedPreview,
            'requires_typed_confirmation' => true,
            'confirmation_phrase' => $typedPhrase,
            'warning_message' => "Permanently deleting {$count} rows from `{$tableName}`. This action cannot be undone unless restored from backup.",
        ];
    }

    /**
     * Step 2: Execute pinned change request inside a transaction.
     */
    public function executeChange(
        User $user,
        int $changeRequestId,
        ?string $typedPhrase = null
    ): array {
        $change = DataChangeRequest::where('id', $changeRequestId)
            ->where('user_id', $user->id)
            ->firstOrFail();

        if ($change->status !== 'pending_confirmation') {
            throw new DataException('INVALID_STATUS', "Change request is already {$change->status}.");
        }

        if ($change->expires_at->isPast()) {
            $change->update(['status' => 'expired']);
            throw new DataException('EXPIRED', "Change preview has expired. Please re-run the request.");
        }

        $connection = $change->connection;
        $this->policy->assertCanWrite($connection, $change->target_table, $change->action);

        // For delete: strictly verify typed phrase
        if ($change->action === 'delete') {
            if (!$typedPhrase || trim($typedPhrase) !== $change->confirmation_phrase) {
                AuditLog::log($user->id, 'data.delete_confirmation_mismatch', 'data_change_requests', (string) $change->id);
                throw new DataException('TYPED_CONFIRMATION_REQUIRED', "Typed confirmation phrase does not match. You must type exactly: '{$change->confirmation_phrase}'. Voice confirmation alone is not accepted.");
            }
        }

        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $catalog = $this->schemaService->getCatalog($connection);
        $tableMeta = $catalog['tables'][$change->target_table] ?? [];
        $primaryKey = ($tableMeta['primary_key'] ?? ['id'])[0];

        $qTable = $dialect->quoteIdentifier($change->target_table);
        $qPk = $dialect->quoteIdentifier($primaryKey);
        $pks = (array) $change->primary_keys;

        $pdo = $this->targetConnector->getReadWritePdo($connection);
        $pdo->beginTransaction();

        try {
            $placeholders = implode(', ', array_fill(0, count($pks), '?'));

            if ($change->action === 'insert') {
                $rows = (array) ($change->patch_values['rows'] ?? []);
                $inserted = [];
                foreach ($rows as $row) {
                    $cols = array_keys($row);
                    $sql = "INSERT INTO {$qTable} (" . implode(', ', array_map(fn ($c) => $dialect->quoteIdentifier($c), $cols)) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
                    if (($connection->driver ?: 'mysql') === 'pgsql') {
                        $sql .= " RETURNING {$qPk}";
                    }
                    $stmt = $pdo->prepare($sql);
                    $stmt->execute(array_values($row));
                    $inserted[] = ($connection->driver ?: 'mysql') === 'pgsql' ? $stmt->fetchColumn() : ($row[$primaryKey] ?? $pdo->lastInsertId());
                }
                $pks = $inserted;
                $change->primary_keys = $inserted;
            } elseif ($change->action === 'update') {
                $patch = (array) $change->patch_values;
                $setSql = [];
                $bindings = [];

                foreach ($patch as $col => $val) {
                    $setSql[] = $dialect->quoteIdentifier($col) . ' = ?';
                    $bindings[] = $val;
                }

                foreach ($pks as $pk) {
                    $bindings[] = $pk;
                }

                $sql = "UPDATE {$qTable} SET " . implode(', ', $setSql) . " WHERE {$qPk} IN ({$placeholders})";
                $stmt = $pdo->prepare($sql);
                $stmt->execute($bindings);
                $affected = $stmt->rowCount();

                // Pinned execution TOCTOU verification
                if ($affected !== count($pks)) {
                    $pdo->rollBack();
                    $change->update(['status' => 'rolled_back']);
                    throw new DataException('TOCTOU_MISMATCH', "Underlying rows changed concurrently (expected {$change->affected_count}, affected {$affected}). The update was safely rolled back.");
                }
            } elseif ($change->action === 'delete') {
                $sql = "DELETE FROM {$qTable} WHERE {$qPk} IN ({$placeholders})";
                $stmt = $pdo->prepare($sql);
                $stmt->execute($pks);
                $affected = $stmt->rowCount();

                if ($affected !== count($pks)) {
                    $pdo->rollBack();
                    $change->update(['status' => 'rolled_back']);
                    throw new DataException('TOCTOU_MISMATCH', "Underlying rows changed concurrently (expected {$change->affected_count}, deleted {$affected}). The delete was safely rolled back.");
                }
            }

            $pdo->commit();

            $change->status = 'executed';
            $change->executed_at = now();
            $change->save();

            $diff = $change->action === 'update' ? (array) ($change->diff_summary ?? []) : [];
            AuditLog::log($user->id, "data.{$change->action}_executed", 'db_connections', (string) $connection->id, [
                'table' => $change->target_table,
                'affected_count' => count($pks),
                'primary_keys' => $pks,
                'change_request_id' => $change->id,
                'changes' => $diff ? AuditLog::changes(
                    array_map(fn ($d) => $d['before'] ?? null, $diff),
                    array_map(fn ($d) => $d['after'] ?? null, $diff),
                ) : null,
            ]);

            return [
                'success' => true,
                'action' => $change->action,
                'table' => $change->target_table,
                'affected_count' => count($pks),
                'message' => ['insert' => 'Added', 'update' => 'Updated', 'delete' => 'Deleted'][$change->action] . ' ' . count($pks) . " row(s) in '{$change->target_table}'.",
                'primary_keys' => $pks,
                'can_undo' => true,
                'change_request_id' => $change->id,
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Undo an executed change using the encrypted before-image.
     */
    public function undo(User $user, int $changeRequestId): array
    {
        $change = DataChangeRequest::where('id', $changeRequestId)
            ->where('user_id', $user->id)
            ->firstOrFail();

        if ($change->status !== 'executed') {
            throw new DataException('CANNOT_UNDO', "Only executed changes can be undone (current status: {$change->status}).");
        }

        if ($change->action === 'insert') {
            return $this->undoInsert($user, $change);
        }

        if (empty($change->before_image)) {
            throw new DataException('NO_BACKUP_IMAGE', "No backup before-image available to restore.");
        }

        $connection = $change->connection;
        $this->policy->assertCanWrite($connection, $change->target_table, 'update');

        $beforeRows = json_decode($change->before_image, true);
        if (!is_array($beforeRows)) {
            throw new DataException('CORRUPT_BACKUP', "Failed to decode backup before-image.");
        }

        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $catalog = $this->schemaService->getCatalog($connection);
        $tableMeta = $catalog['tables'][$change->target_table] ?? [];
        $primaryKey = ($tableMeta['primary_key'] ?? ['id'])[0];
        $qTable = $dialect->quoteIdentifier($change->target_table);

        $pdo = $this->targetConnector->getReadWritePdo($connection);
        $pdo->beginTransaction();

        try {
            if ($change->action === 'update') {
                foreach ($beforeRows as $row) {
                    $pkVal = $row[$primaryKey];
                    $setSql = [];
                    $bindings = [];

                    foreach ($change->patch_values as $col => $_) {
                        $setSql[] = $dialect->quoteIdentifier($col) . ' = ?';
                        $bindings[] = $row[$col] ?? null;
                    }
                    $bindings[] = $pkVal;

                    $sql = "UPDATE {$qTable} SET " . implode(', ', $setSql) . " WHERE " . $dialect->quoteIdentifier($primaryKey) . " = ?";
                    $stmt = $pdo->prepare($sql);
                    $stmt->execute($bindings);
                }
            } elseif ($change->action === 'delete') {
                // Re-insert deleted rows
                foreach ($beforeRows as $row) {
                    $cols = array_keys($row);
                    $qCols = array_map(fn($c) => $dialect->quoteIdentifier($c), $cols);
                    $placeholders = implode(', ', array_fill(0, count($cols), '?'));

                    $sql = "INSERT INTO {$qTable} (" . implode(', ', $qCols) . ") VALUES ({$placeholders})";
                    $stmt = $pdo->prepare($sql);
                    $stmt->execute(array_values($row));
                }
            }

            $pdo->commit();

            $change->update([
                'status' => 'undone',
                'undone_at' => now(),
            ]);

            AuditLog::log($user->id, "data.{$change->action}_undone", 'db_connections', (string) $connection->id, [
                'table' => $change->target_table,
                'restored_count' => count($beforeRows),
            ]);

            return [
                'success' => true,
                'message' => "Successfully reverted {$change->action} on " . count($beforeRows) . " row(s) in '{$change->target_table}'.",
                'restored_count' => count($beforeRows),
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Undo an insert: removes exactly the rows that change added (their recorded keys), in one transaction, within
     * a day. It reverses the platform's own write, like the Undo center for published runs.
     */
    private function undoInsert(User $user, DataChangeRequest $change): array
    {
        if ($change->executed_at && $change->executed_at->lt(now()->subDay())) {
            throw new DataException('UNDO_EXPIRED', 'Added rows can be removed with Undo for one day. Delete them from the table instead.');
        }
        $connection = $change->connection;
        $this->policy->assertCanWrite($connection, $change->target_table, 'insert');
        $pks = array_values(array_filter((array) $change->primary_keys, fn ($v) => $v !== null && $v !== ''));
        if (!$pks) {
            throw new DataException('NO_KEYS', 'The added rows have no recorded ids, so they cannot be removed automatically.');
        }

        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $catalog = $this->schemaService->getCatalog($connection);
        $primaryKey = ($catalog['tables'][$change->target_table]['primary_key'] ?? ['id'])[0];
        $pdo = $this->targetConnector->getReadWritePdo($connection);
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('DELETE FROM ' . $dialect->quoteIdentifier($change->target_table) . ' WHERE ' . $dialect->quoteIdentifier($primaryKey) . ' IN (' . implode(', ', array_fill(0, count($pks), '?')) . ')');
            $stmt->execute($pks);
            $removed = $stmt->rowCount();
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $change->update(['status' => 'undone', 'undone_at' => now()]);
        AuditLog::log($user->id, 'data.insert_undone', 'db_connections', (string) $connection->id, [
            'table' => $change->target_table, 'primary_keys' => $pks, 'removed' => $removed,
        ]);

        return [
            'success' => true,
            'message' => "Removed {$removed} added row(s) from '{$change->target_table}'.",
            'affected_count' => $removed,
        ];
    }
}
