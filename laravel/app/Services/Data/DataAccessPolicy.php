<?php

namespace App\Services\Data;

use App\Models\AuditLog;
use App\Models\DbConnection;

class DataAccessPolicy
{
    private const BLOCKED_TABLE_PATTERNS = [
        '/^api_tokens$/i',
        '/^tokens?$/i',
        '/^sessions?$/i',
        '/^password_resets?$/i',
        '/^personal_access_tokens$/i',
        '/^oauth_/i',
        '/^credentials?$/i',
    ];

    private const READ_ONLY_TABLE_PATTERNS = [
        '/^payments?$/i',
        '/^audit_/i',
        '/^roles?$/i',
        '/^permissions?$/i',
        '/^user_roles?$/i',
        '/^financial/i',
        '/^invoices?$/i',
        '/^transactions?$/i',
    ];

    public function getTableClass(DbConnection $connection, string $table): string
    {
        $name = strtolower(trim($table));
        $policy = (array) ($connection->data_policy ?? []);
        $overrides = (array) ($policy['table_overrides'] ?? []);

        // 1. Blocked tables are ALWAYS blocked (no override can enable credentials/token tables)
        foreach (self::BLOCKED_TABLE_PATTERNS as $p) {
            if (preg_match($p, $name)) {
                return 'blocked';
            }
        }

        // 2. Owner override for this table
        if (isset($overrides[$name])) {
            return $overrides[$name]; // e.g. 'read_write' or 'read_only'
        }

        // 3. Default read-only tables (financial/permission/audit)
        foreach (self::READ_ONLY_TABLE_PATTERNS as $p) {
            if (preg_match($p, $name)) {
                return 'read_only';
            }
        }

        return 'writable';
    }

    public function assertCanReadTable(DbConnection $connection, string $table): void
    {
        $class = $this->getTableClass($connection, $table);
        if ($class === 'blocked') {
            AuditLog::log($connection->user_id, 'data.read_refused', 'db_connections', (string) $connection->id, [
                'table' => $table,
                'reason' => 'blocked_table',
            ]);
            throw new DataException('TABLE_BLOCKED', "Table '{$table}' contains sensitive credentials/tokens and cannot be accessed.");
        }
    }

    public function assertCanRead(DbConnection $connection, array $tables): void
    {
        foreach ($tables as $t) {
            $this->assertCanReadTable($connection, $t);
        }
    }

    public function assertCanWrite(DbConnection $connection, string $table, string $operation): void
    {
        $op = strtolower($operation);
        $mode = $connection->access_mode ?: 'read_only';
        $class = $this->getTableClass($connection, $table);

        if ($class === 'blocked') {
            AuditLog::log($connection->user_id, 'data.write_refused', 'db_connections', (string) $connection->id, [
                'table' => $table,
                'operation' => $op,
                'reason' => 'blocked_table',
            ]);
            throw new DataException('TABLE_BLOCKED', "Writes to table '{$table}' are permanently blocked by security policy.");
        }

        if ($mode === 'read_only') {
            AuditLog::log($connection->user_id, 'data.write_refused', 'db_connections', (string) $connection->id, [
                'table' => $table,
                'operation' => $op,
                'reason' => 'connection_read_only',
            ]);
            throw new DataException('ACCESS_MODE_RESTRICTED', "Database connection '{$connection->name}' is in read-only mode. An owner can change this to 'read_write' in connection settings.");
        }

        if ($op === 'delete' && $mode !== 'read_write_delete') {
            AuditLog::log($connection->user_id, 'data.delete_refused', 'db_connections', (string) $connection->id, [
                'table' => $table,
                'reason' => 'delete_mode_not_enabled',
            ]);
            throw new DataException('DELETE_NOT_ENABLED', "Destructive operations (DELETE) are disabled for connection '{$connection->name}'. To allow row deletion, the connection owner must set Access Mode to 'read_write_delete'.");
        }

        if ($class === 'read_only') {
            AuditLog::log($connection->user_id, 'data.write_refused', 'db_connections', (string) $connection->id, [
                'table' => $table,
                'operation' => $op,
                'reason' => 'table_is_read_only',
            ]);
            throw new DataException('TABLE_READ_ONLY', "Table '{$table}' is designated read-only (financial/audit/permissions). An owner can override this in table settings if intended.");
        }
    }

    public function filterSafeColumns(array $columnNames): array
    {
        $safe = [];
        foreach ($columnNames as $col) {
            if (!ColumnClassifier::isSecret($col)) {
                $safe[] = $col;
            }
        }
        return $safe;
    }

    public function maskResultRows(array $rows, bool $revealPii = false): array
    {
        $out = [];
        foreach ($rows as $row) {
            $maskedRow = [];
            foreach ($row as $col => $val) {
                if (ColumnClassifier::isSecret($col)) {
                    continue; // Secret columns are NEVER returned
                }
                if ($revealPii) {
                    $maskedRow[$col] = $val;
                } else {
                    $maskedRow[$col] = ColumnClassifier::mask($val, $col);
                }
            }
            $out[] = $maskedRow;
        }
        return $out;
    }
}
