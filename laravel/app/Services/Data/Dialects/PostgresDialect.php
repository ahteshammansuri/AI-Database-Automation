<?php

namespace App\Services\Data\Dialects;

use App\Models\DbConnection;
use PDO;

class PostgresDialect implements Dialect
{
    private const DELETE_RULES = ['a' => 'NO ACTION', 'r' => 'RESTRICT', 'c' => 'CASCADE', 'n' => 'SET NULL', 'd' => 'SET DEFAULT'];

    public function key(): string
    {
        return 'postgresql';
    }

    public function label(): string
    {
        return 'PostgreSQL';
    }

    public function defaultPort(): int
    {
        return 5432;
    }

    public function driverAvailable(): bool
    {
        return extension_loaded('pdo_pgsql');
    }

    public function parserDialect(): string
    {
        return 'postgres';
    }

    public function dsn(DbConnection $connection): string
    {
        $ssl = match ((string) $connection->ssl_mode) {
            'disabled' => 'disable',
            'required' => 'require',
            default => 'prefer',
        };
        return sprintf("pgsql:host=%s;port=%d;dbname=%s;sslmode=%s;connect_timeout=5;application_name=dataauto",
            $connection->host, (int) $connection->port, $connection->database_name, $ssl);
    }

    public function pdoOptions(): array
    {
        return [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ];
    }

    public function initSession(PDO $pdo, bool $readOnly, int $statementTimeoutMs): void
    {
        $pdo->exec("SET TIME ZONE 'UTC'");
        $pdo->exec('SET statement_timeout = ' . max(100, $statementTimeoutMs));
        $pdo->exec('SET lock_timeout = 5000');
        $pdo->exec('SET idle_in_transaction_session_timeout = 60000');
        if ($readOnly) {
            $pdo->exec('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
        }
    }

    public function beginReadOnly(PDO $pdo): void
    {
        $pdo->exec('BEGIN READ ONLY');
    }

    public function endReadOnly(PDO $pdo): void
    {
        $pdo->exec('ROLLBACK');
    }

    public function quote(string $identifier): string
    {
        return '"' . str_replace('"', '""', $identifier) . '"';
    }

    public function quoteIdentifier(string $identifier): string
    {
        return $this->quote($identifier);
    }

    public function ciLike(): string
    {
        return 'ILIKE';
    }

    public function bindBool(bool $value): int|bool
    {
        return $value;
    }

    public function serverInfo(PDO $pdo): array
    {
        $row = $pdo->query("SELECT current_setting('server_version') AS v, current_user AS u")->fetch(PDO::FETCH_ASSOC) ?: [];
        return ['engine' => 'PostgreSQL', 'version' => (string) ($row['v'] ?? ''), 'current_user' => (string) ($row['u'] ?? '')];
    }

    public function readCatalog(PDO $pdo, DbConnection $connection): array
    {
        $tables = $pdo->query("
            SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS rows_estimate,
                   pg_total_relation_size(c.oid) AS bytes, COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p', 'v', 'm')
            ORDER BY c.relname")->fetchAll(PDO::FETCH_ASSOC);

        $columns = $pdo->query("
            SELECT c.table_name AS tbl, c.column_name AS name, c.ordinal_position AS position, c.data_type, c.udt_name,
                   c.is_nullable, c.column_default, c.character_maximum_length AS max_length,
                   c.numeric_precision AS num_precision, c.numeric_scale AS num_scale, c.is_identity, c.is_generated,
                   COALESCE(col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position::int), '') AS comment
            FROM information_schema.columns c
            WHERE c.table_schema = current_schema()
            ORDER BY c.table_name, c.ordinal_position")->fetchAll(PDO::FETCH_ASSOC);

        $enumRows = $pdo->query("
            SELECT t.typname AS type_name, e.enumlabel AS label
            FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
            ORDER BY t.typname, e.enumsortorder")->fetchAll(PDO::FETCH_ASSOC);
        $enums = [];
        foreach ($enumRows as $r) {
            $enums[$r['type_name']][] = $r['label'];
        }

        // Single-column CHECK (col IN (...)) constraints act as enums.
        $checkRows = $pdo->query("
            SELECT cl.relname AS tbl, pg_get_constraintdef(con.oid) AS def
            FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid
            WHERE con.contype = 'c' AND cl.relnamespace = current_schema()::regnamespace")->fetchAll(PDO::FETCH_ASSOC);
        $checkEnums = [];
        foreach ($checkRows as $r) {
            if (preg_match('/^CHECK \(\(?\(?([a-z_][a-z0-9_]*)\)?(?:::text)?\s*=\s*ANY\s*\(\(?ARRAY\[(.*)\]/i', $r['def'], $m)
                || preg_match('/^CHECK \(\(?([a-z_][a-z0-9_]*)\s+IN\s*\((.*)\)\)/i', $r['def'], $m)) {
                preg_match_all("/'((?:[^']|'')*)'/", $m[2], $vals);
                if (!empty($vals[1])) {
                    $checkEnums[$r['tbl']][$m[1]] = array_map(fn ($v) => str_replace("''", "'", $v), $vals[1]);
                }
            }
        }

        $keyRows = $pdo->query("
            SELECT cl.relname AS tbl, con.conname AS name, con.contype AS type, att.attname AS col, u.ord
            FROM pg_constraint con
            JOIN pg_class cl ON cl.oid = con.conrelid
            CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
            WHERE con.contype IN ('p', 'u') AND cl.relnamespace = current_schema()::regnamespace
            ORDER BY cl.relname, con.conname, u.ord")->fetchAll(PDO::FETCH_ASSOC);

        $fkRows = $pdo->query("
            SELECT con.conname AS name, cl.relname AS tbl, att.attname AS col, fcl.relname AS ref_tbl, fatt.attname AS ref_col,
                   con.confdeltype AS on_delete, con.confupdtype AS on_update, u.ord
            FROM pg_constraint con
            JOIN pg_class cl ON cl.oid = con.conrelid
            JOIN pg_class fcl ON fcl.oid = con.confrelid
            CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(attnum, fattnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
            JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = u.fattnum
            WHERE con.contype = 'f' AND cl.relnamespace = current_schema()::regnamespace
            ORDER BY cl.relname, con.conname, u.ord")->fetchAll(PDO::FETCH_ASSOC);

        $outTables = [];
        foreach ($tables as $t) {
            $est = (int) $t['rows_estimate'];
            $outTables[] = [
                'name' => (string) $t['name'],
                'kind' => in_array($t['kind'], ['v', 'm'], true) ? 'view' : 'table',
                'rows_estimate' => $est < 0 ? null : $est, // -1 = never analysed
                'bytes' => (int) $t['bytes'],
                'comment' => (string) $t['comment'],
            ];
        }

        $outColumns = [];
        foreach ($columns as $c) {
            $dt = strtolower((string) $c['data_type']);
            $udt = (string) $c['udt_name'];
            $enum = $dt === 'user-defined' ? ($enums[$udt] ?? []) : ($checkEnums[$c['tbl']][$c['name']] ?? []);
            $default = $c['column_default'];
            $outColumns[] = [
                'table' => (string) $c['tbl'],
                'name' => (string) $c['name'],
                'position' => (int) $c['position'],
                'data_type' => $dt,
                'raw_type' => $dt === 'user-defined' ? $udt : $dt,
                'udt' => $udt,
                'is_enum_type' => $dt === 'user-defined' && isset($enums[$udt]),
                'nullable' => strtoupper((string) $c['is_nullable']) === 'YES',
                'default' => $default,
                'max_length' => $c['max_length'] === null ? null : (int) $c['max_length'],
                'precision' => $c['num_precision'] === null ? null : (int) $c['num_precision'],
                'scale' => $c['num_scale'] === null ? null : (int) $c['num_scale'],
                'auto' => strtoupper((string) $c['is_identity']) === 'YES' || str_starts_with((string) $default, 'nextval('),
                'generated' => strtoupper((string) $c['is_generated']) === 'ALWAYS',
                'enum' => $enum,
                'comment' => (string) $c['comment'],
            ];
        }

        $keys = [];
        foreach ($keyRows as $r) {
            $id = $r['tbl'] . '|' . $r['name'];
            $keys[$id] ??= ['table' => (string) $r['tbl'], 'name' => (string) $r['name'], 'type' => $r['type'] === 'p' ? 'PRIMARY' : 'UNIQUE', 'columns' => []];
            $keys[$id]['columns'][] = (string) $r['col'];
        }

        $fks = [];
        foreach ($fkRows as $r) {
            $id = $r['tbl'] . '|' . $r['name'];
            $fks[$id] ??= [
                'name' => (string) $r['name'], 'table' => (string) $r['tbl'], 'columns' => [], 'ref_table' => (string) $r['ref_tbl'],
                'ref_columns' => [], 'on_delete' => self::DELETE_RULES[$r['on_delete']] ?? 'NO ACTION',
                'on_update' => self::DELETE_RULES[$r['on_update']] ?? 'NO ACTION',
            ];
            $fks[$id]['columns'][] = (string) $r['col'];
            $fks[$id]['ref_columns'][] = (string) $r['ref_col'];
        }

        return [
            'database' => $connection->database_name,
            'tables' => $outTables,
            'columns' => $outColumns,
            'keys' => array_values($keys),
            'foreign_keys' => array_values($fks),
        ];
    }

    public function explain(PDO $pdo, string $sql, array $bindings): array
    {
        // EXPLAIN without ANALYZE never executes the statement. Values are interpolated client-side
        // (emulated prepare with proper quoting) because the extended protocol cannot type
        // parameters of an EXPLAIN.
        $stmt = $pdo->prepare('EXPLAIN (FORMAT JSON) ' . $sql, [PDO::ATTR_EMULATE_PREPARES => true]);
        $stmt->execute(array_values($bindings));
        $json = json_decode((string) $stmt->fetchColumn(), true) ?: [];
        $plan = $json[0]['Plan'] ?? [];
        $rows = 0;
        $walk = function ($node) use (&$walk, &$rows) {
            if (!is_array($node)) {
                return;
            }
            if (isset($node['Plan Rows']) && is_numeric($node['Plan Rows']) && in_array($node['Node Type'] ?? '', ['Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan'], true)) {
                $rows = max($rows, (int) $node['Plan Rows']);
            }
            foreach ($node['Plans'] ?? [] as $child) {
                $walk($child);
            }
        };
        $walk($plan);
        return ['rows' => $rows, 'cost' => (float) ($plan['Total Cost'] ?? 0), 'raw' => $json];
    }

    public function typeFamily(array $c): string
    {
        $dt = strtolower($c['data_type'] ?? '');
        if (!empty($c['is_enum_type'])) {
            return 'enum';
        }
        return match (true) {
            $dt === 'boolean' => 'boolean',
            in_array($dt, ['smallint', 'integer', 'bigint'], true) => 'integer',
            in_array($dt, ['numeric', 'real', 'double precision', 'money'], true) => 'decimal',
            in_array($dt, ['character varying', 'character', 'citext'], true) => !empty($c['enum']) ? 'enum' : 'string',
            $dt === 'text' => !empty($c['enum']) ? 'enum' : 'text',
            $dt === 'date' => 'date',
            str_starts_with($dt, 'time ') || $dt === 'time without time zone' || $dt === 'time with time zone' => 'time',
            $dt === 'timestamp with time zone' => 'timestamp_tz',
            $dt === 'timestamp without time zone' => 'timestamp_naive',
            in_array($dt, ['json', 'jsonb'], true) => 'json',
            $dt === 'uuid' => 'uuid',
            $dt === 'bytea' => 'binary',
            default => 'other',
        };
    }
}
