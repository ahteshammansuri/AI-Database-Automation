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

    /** What an owner may set per table on a connection. Blocked tables ignore overrides. */
    public const OVERRIDE_CLASSES = ['read_only', 'writable'];

    // Financial, order, permission and audit tables: read-only until the owner overrides a table on the connection.
    private const READ_ONLY_TABLE_PATTERNS = [
        '/^payments?$/i',
        '/^audit_/i',
        '/^roles?$/i',
        '/^permissions?$/i',
        '/^user_roles?$/i',
        '/^model_has_(roles|permissions)$/i',
        '/^role_has_permissions$/i',
        '/^financial/i',
        '/^invoices?$/i',
        '/^transactions?$/i',
        '/^refunds?$/i',
        '/^payouts?$/i',
        '/^orders?$/i',
        '/^order_(items?|lines?)$/i',
    ];

    public function getTableClass(DbConnection $connection, string $table): string
    {
        $name = strtolower(trim($table));
        $default = $this->defaultTableClass($name);

        // Blocked tables are ALWAYS blocked (no override can enable credentials/token tables)
        if ($default === 'blocked') {
            return 'blocked';
        }

        // Owner override for this table on this connection
        $override = $this->tableOverride($connection, $name);

        return $override ?? $default;
    }

    /** The class a table has before any owner override: blocked, read_only (financial/order/permission/audit) or writable. */
    public function defaultTableClass(string $table): string
    {
        $name = strtolower(trim($table));
        foreach (self::BLOCKED_TABLE_PATTERNS as $p) {
            if (preg_match($p, $name)) {
                return 'blocked';
            }
        }
        foreach (self::READ_ONLY_TABLE_PATTERNS as $p) {
            if (preg_match($p, $name)) {
                return 'read_only';
            }
        }

        return 'writable';
    }

    /** The owner's override for a table on this connection (read_only or writable), or null. */
    public function tableOverride(DbConnection $connection, string $table): ?string
    {
        $overrides = (array) (((array) ($connection->data_policy ?? []))['table_overrides'] ?? []);
        $value = $overrides[strtolower(trim($table))] ?? null;

        return in_array($value, self::OVERRIDE_CLASSES, true) ? $value : null;
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

    /**
     * Why a write would be refused (code, audit action, reason, message), or null when it is allowed. Checking does
     * not log anything, so the Data page can show what is possible without filling the audit log.
     *
     * @return array{code: string, audit: string, reason: string, message: string}|null
     */
    public function writeRefusal(DbConnection $connection, string $table, string $operation): ?array
    {
        $op = strtolower($operation);
        $mode = $connection->access_mode ?: 'read_only';
        $class = $this->getTableClass($connection, $table);

        if ($class === 'blocked') {
            return ['code' => 'TABLE_BLOCKED', 'audit' => 'data.write_refused', 'reason' => 'blocked_table',
                'message' => "Writes to table '{$table}' are permanently blocked by security policy."];
        }
        if ($mode === 'read_only') {
            return ['code' => 'ACCESS_MODE_RESTRICTED', 'audit' => 'data.write_refused', 'reason' => 'connection_read_only',
                'message' => "Database connection '{$connection->name}' is in read-only mode. An owner can change this to 'read_write' in connection settings."];
        }
        if ($op === 'delete' && $mode !== 'read_write_delete') {
            return ['code' => 'DELETE_NOT_ENABLED', 'audit' => 'data.delete_refused', 'reason' => 'delete_mode_not_enabled',
                'message' => "Destructive operations (DELETE) are disabled for connection '{$connection->name}'. To allow row deletion, the connection owner must set Access Mode to 'read_write_delete'."];
        }
        if ($class === 'read_only') {
            return ['code' => 'TABLE_READ_ONLY', 'audit' => 'data.write_refused', 'reason' => 'table_is_read_only',
                'message' => "Table '{$table}' is view only on this connection (financial, order, permission or audit data). The connection owner can make it editable in the Schema Explorer."];
        }

        return null;
    }

    /** Refuse a real write attempt: the refusal is recorded in the customer's audit log. */
    public function assertCanWrite(DbConnection $connection, string $table, string $operation): void
    {
        $refusal = $this->writeRefusal($connection, $table, $operation);
        if ($refusal === null) {
            return;
        }
        AuditLog::log($connection->user_id, $refusal['audit'], 'db_connections', (string) $connection->id, array_filter([
            'table' => $table,
            'operation' => $refusal['audit'] === 'data.delete_refused' ? null : strtolower($operation),
            'reason' => $refusal['reason'],
        ]));
        throw new DataException($refusal['code'], $refusal['message']);
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
