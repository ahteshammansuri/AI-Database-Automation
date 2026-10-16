<?php

namespace App\Services\Data\Dialects;

use App\Models\DbConnection;
use PDO;

class MySqlDialect implements Dialect
{
    public function key(): string
    {
        return 'mysql';
    }

    public function label(): string
    {
        return 'MySQL / MariaDB';
    }

    public function defaultPort(): int
    {
        return 3306;
    }

    public function driverAvailable(): bool
    {
        return extension_loaded('pdo_mysql');
    }

    public function parserDialect(): string
    {
        return 'mysql';
    }

    public function dsn(DbConnection $connection): string
    {
        return sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $connection->host, (int) $connection->port, $connection->database_name);
    }

    public function pdoOptions(): array
    {
        return [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
            // UPDATE row counts must be *matched* rows, not *changed* rows, for pinned-count checks.
            PDO::MYSQL_ATTR_FOUND_ROWS => true,
            PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,
        ];
    }

    public function initSession(PDO $pdo, bool $readOnly, int $statementTimeoutMs): void
    {
        $pdo->exec("SET SESSION time_zone = '+00:00'");
        $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
        if (stripos($version, 'mariadb') !== false) {
            $pdo->exec('SET SESSION max_statement_time = ' . max(1, (int) ceil($statementTimeoutMs / 1000)));
        } else {
            // Applies to read-only SELECT statements.
            $pdo->exec('SET SESSION max_execution_time = ' . max(100, $statementTimeoutMs));
        }
        $pdo->exec('SET SESSION innodb_lock_wait_timeout = 5');
        if ($readOnly) {
            $pdo->exec('SET SESSION TRANSACTION READ ONLY');
        }
    }

    public function beginReadOnly(PDO $pdo): void
    {
        $pdo->exec('START TRANSACTION READ ONLY');
    }

    public function endReadOnly(PDO $pdo): void
    {
        $pdo->exec('ROLLBACK');
    }

    public function quote(string $identifier): string
    {
        return '`' . str_replace('`', '``', $identifier) . '`';
    }

    public function quoteIdentifier(string $identifier): string
    {
        return $this->quote($identifier);
    }

    public function ciLike(): string
    {
        return 'LIKE';
    }

    public function bindBool(bool $value): int|bool
    {
        return $value ? 1 : 0;
    }

    public function serverInfo(PDO $pdo): array
    {
        $row = $pdo->query('SELECT VERSION() AS v, CURRENT_USER() AS u, @@version_comment AS c')->fetch(PDO::FETCH_ASSOC) ?: [];
        $version = (string) ($row['v'] ?? '');
        $isMaria = stripos($version . ' ' . ($row['c'] ?? ''), 'mariadb') !== false;
        return [
            'engine' => $isMaria ? 'MariaDB' : 'MySQL',
            'version' => $version,
            'current_user' => (string) ($row['u'] ?? ''),
        ];
    }

    public function readCatalog(PDO $pdo, DbConnection $connection): array
    {
        $db = $connection->database_name;

        $tables = $this->rows($pdo, "
            SELECT table_name AS name, table_type AS kind, table_rows AS rows_estimate,
                   COALESCE(data_length, 0) + COALESCE(index_length, 0) AS bytes, table_comment AS comment
            FROM information_schema.tables
            WHERE table_schema = ?
            ORDER BY table_name", [$db]);

        $columns = $this->rows($pdo, "
            SELECT table_name AS tbl, column_name AS name, ordinal_position AS position, data_type, column_type,
                   is_nullable, column_default, character_maximum_length AS max_length,
                   numeric_precision AS num_precision, numeric_scale AS num_scale, extra, column_comment AS comment
            FROM information_schema.columns
            WHERE table_schema = ?
            ORDER BY table_name, ordinal_position", [$db]);

        $keyRows = $this->rows($pdo, "
            SELECT tc.table_name AS tbl, tc.constraint_name AS name, tc.constraint_type AS type,
                   kcu.column_name AS col, kcu.ordinal_position AS pos
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
            WHERE tc.table_schema = ? AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
            ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position", [$db]);

        $fkRows = $this->rows($pdo, "
            SELECT kcu.constraint_name AS name, kcu.table_name AS tbl, kcu.column_name AS col,
                   kcu.referenced_table_name AS ref_tbl, kcu.referenced_column_name AS ref_col,
                   rc.delete_rule AS on_delete, rc.update_rule AS on_update, kcu.ordinal_position AS pos
            FROM information_schema.key_column_usage kcu
            JOIN information_schema.referential_constraints rc
              ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name AND rc.table_name = kcu.table_name
            WHERE kcu.table_schema = ? AND kcu.referenced_table_name IS NOT NULL
            ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position", [$db]);

        $outTables = [];
        foreach ($tables as $t) {
            $outTables[] = [
                'name' => (string) $t['name'],
                'kind' => strtoupper((string) $t['kind']) === 'VIEW' ? 'view' : 'table',
                'rows_estimate' => $t['rows_estimate'] === null ? null : (int) $t['rows_estimate'],
                'bytes' => (int) $t['bytes'],
                'comment' => (string) ($t['comment'] ?? ''),
            ];
        }

        $outColumns = [];
        foreach ($columns as $c) {
            $colType = (string) $c['column_type'];
            $enum = [];
            if (preg_match('/^(enum|set)\((.*)\)$/i', $colType, $m)) {
                preg_match_all("/'((?:[^']|'')*)'/", $m[2], $vals);
                $enum = array_map(fn ($v) => str_replace("''", "'", $v), $vals[1] ?? []);
            }
            $extra = strtolower((string) ($c['extra'] ?? ''));
            $outColumns[] = [
                'table' => (string) $c['tbl'],
                'name' => (string) $c['name'],
                'position' => (int) $c['position'],
                'data_type' => strtolower((string) $c['data_type']),
                'raw_type' => $colType,
                'nullable' => strtoupper((string) $c['is_nullable']) === 'YES',
                'default' => $c['column_default'],
                'max_length' => $c['max_length'] === null ? null : (int) $c['max_length'],
                'precision' => $c['num_precision'] === null ? null : (int) $c['num_precision'],
                'scale' => $c['num_scale'] === null ? null : (int) $c['num_scale'],
                'auto' => str_contains($extra, 'auto_increment'),
                'generated' => str_contains($extra, 'generated'),
                'enum' => $enum,
                'comment' => (string) ($c['comment'] ?? ''),
            ];
        }

        return [
            'database' => $db,
            'tables' => $outTables,
            'columns' => $outColumns,
            'keys' => $this->groupKeys($keyRows),
            'foreign_keys' => $this->groupForeignKeys($fkRows),
        ];
    }

    public function explain(PDO $pdo, string $sql, array $bindings): array
    {
        $stmt = $pdo->prepare('EXPLAIN FORMAT=JSON ' . $sql);
        $stmt->execute(array_values($bindings));
        $json = json_decode((string) $stmt->fetchColumn(), true) ?: [];
        $rows = 0;
        $walk = function ($node) use (&$walk, &$rows) {
            if (!is_array($node)) {
                return;
            }
            foreach ($node as $k => $v) {
                if ($k === 'rows_examined_per_scan' && is_numeric($v)) {
                    $rows = max($rows, (int) $v);
                }
                $walk($v);
            }
        };
        $walk($json);
        $cost = (float) ($json['query_block']['cost_info']['query_cost'] ?? 0);
        return ['rows' => $rows, 'cost' => $cost, 'raw' => $json];
    }

    public function typeFamily(array $c): string
    {
        $dt = strtolower($c['data_type'] ?? '');
        $raw = strtolower($c['raw_type'] ?? '');
        return match (true) {
            $dt === 'tinyint' && str_starts_with($raw, 'tinyint(1)') => 'boolean',
            in_array($dt, ['bit', 'bool', 'boolean'], true) => 'boolean',
            in_array($dt, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'year'], true) => 'integer',
            in_array($dt, ['decimal', 'numeric', 'float', 'double', 'real'], true) => 'decimal',
            $dt === 'enum' => 'enum',
            in_array($dt, ['char', 'varchar', 'set'], true) => 'string',
            in_array($dt, ['tinytext', 'text', 'mediumtext', 'longtext'], true) => 'text',
            $dt === 'date' => 'date',
            $dt === 'time' => 'time',
            $dt === 'timestamp' => 'timestamp_tz',
            $dt === 'datetime' => 'timestamp_naive',
            $dt === 'json' => 'json',
            in_array($dt, ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'], true) => 'binary',
            default => 'other',
        };
    }

    private function rows(PDO $pdo, string $sql, array $params): array
    {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return array_map(fn ($r) => array_change_key_case($r, CASE_LOWER), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function groupKeys(array $rows): array
    {
        $keys = [];
        foreach ($rows as $r) {
            $id = $r['tbl'] . '|' . $r['name'];
            $keys[$id] ??= ['table' => (string) $r['tbl'], 'name' => (string) $r['name'], 'type' => $r['type'] === 'PRIMARY KEY' ? 'PRIMARY' : 'UNIQUE', 'columns' => []];
            $keys[$id]['columns'][] = (string) $r['col'];
        }
        return array_values($keys);
    }

    private function groupForeignKeys(array $rows): array
    {
        $fks = [];
        foreach ($rows as $r) {
            $id = $r['tbl'] . '|' . $r['name'];
            $fks[$id] ??= [
                'name' => (string) $r['name'], 'table' => (string) $r['tbl'], 'columns' => [], 'ref_table' => (string) $r['ref_tbl'],
                'ref_columns' => [], 'on_delete' => strtoupper((string) $r['on_delete']), 'on_update' => strtoupper((string) $r['on_update']),
            ];
            $fks[$id]['columns'][] = (string) $r['col'];
            $fks[$id]['ref_columns'][] = (string) $r['ref_col'];
        }
        return array_values($fks);
    }
}
