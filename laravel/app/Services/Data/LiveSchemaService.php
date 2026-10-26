<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use Illuminate\Support\Facades\Cache;
use PDO;

class LiveSchemaService
{
    public function __construct(
        private TargetConnector $connector,
        private DataAccessPolicy $policy,
    ) {
    }

    public function getCatalog(DbConnection $connection, bool $forceRefresh = false): array
    {
        return $this->getSchema($connection, $forceRefresh);
    }

    /** Drop the cached catalog, e.g. after the owner changed a table's access on this connection. */
    public function forget(DbConnection $connection): void
    {
        Cache::forget("live_schema:{$connection->id}");
    }

    public function getSchema(DbConnection $connection, bool $forceRefresh = false): array
    {
        $cacheKey = "live_schema:{$connection->id}";
        $ttl = (int) config('data_agent.schema_cache_seconds', 60);

        if (!$forceRefresh && Cache::has($cacheKey)) {
            return Cache::get($cacheKey);
        }

        $schema = $this->connector->read($connection, function (PDO $pdo, $dialect) use ($connection) {
            $catalog = $dialect->readCatalog($pdo, $connection);
            $serverInfo = $dialect->serverInfo($pdo);

            $tables = [];
            foreach ($catalog['tables'] as $t) {
                $tName = $t['name'];
                $tableClass = $this->policy->getTableClass($connection, $tName);
                $tables[$tName] = [
                    'name' => $tName,
                    'kind' => $t['kind'], // 'table' | 'view'
                    'rows_estimate' => $t['rows_estimate'],
                    'bytes' => $t['bytes'],
                    'comment' => $t['comment'] ?? '',
                    'class' => $tableClass,
                    'columns' => [],
                    'primary_key' => [],
                    'unique_keys' => [],
                    'foreign_keys' => [],
                ];
            }

            foreach ($catalog['columns'] as $c) {
                $tName = $c['table'];
                if (!isset($tables[$tName])) {
                    continue;
                }
                $cName = $c['name'];
                $family = $dialect->typeFamily($c);
                $classification = ColumnClassifier::classify($cName, $c['data_type']);

                $tables[$tName]['columns'][$cName] = array_merge($c, [
                    'family' => $family,
                    'class' => $classification['class'],
                    'temporal_role' => $classification['temporal_role'],
                    'is_soft_delete' => $classification['is_soft_delete'],
                    'is_label' => $classification['is_label'],
                ]);
            }

            foreach ($catalog['keys'] ?? [] as $key) {
                $tName = $key['table'];
                if (!isset($tables[$tName])) {
                    continue;
                }
                if ($key['type'] === 'PRIMARY') {
                    $tables[$tName]['primary_key'] = $key['columns'];
                } elseif ($key['type'] === 'UNIQUE') {
                    $tables[$tName]['unique_keys'][$key['name']] = $key['columns'];
                }
            }

            $allFks = [];
            foreach ($catalog['foreign_keys'] ?? [] as $fk) {
                $tName = $fk['table'];
                $fkNorm = [
                    'name' => $fk['name'],
                    'table' => $fk['table'],
                    'from_table' => $fk['table'],
                    'columns' => $fk['columns'],
                    'from_columns' => $fk['columns'],
                    'ref_table' => $fk['ref_table'],
                    'to_table' => $fk['ref_table'],
                    'ref_columns' => $fk['ref_columns'],
                    'to_columns' => $fk['ref_columns'],
                    'on_delete' => $fk['on_delete'] ?? 'NO ACTION',
                    'on_update' => $fk['on_update'] ?? 'NO ACTION',
                ];
                if (isset($tables[$tName])) {
                    $tables[$tName]['foreign_keys'][] = $fkNorm;
                }
                $allFks[] = $fkNorm;
            }

            return [
                'connection_id' => $connection->id,
                'connection_name' => $connection->name,
                'engine' => $dialect->key(),
                'server_info' => $serverInfo,
                'tables' => $tables,
                'foreign_keys' => $allFks,
                'introspected_at' => now()->toIso8601String(),
            ];
        });

        Cache::put($cacheKey, $schema, $ttl);
        return $schema;
    }

    public function tables(DbConnection $connection, bool $force = false): array
    {
        return $this->getSchema($connection, $force)['tables'] ?? [];
    }

    public function table(DbConnection $connection, string $tableName, bool $force = false): ?array
    {
        $tables = $this->tables($connection, $force);
        return $tables[$tableName] ?? null;
    }

    public function hasTable(DbConnection $connection, string $tableName): bool
    {
        return $this->table($connection, $tableName) !== null;
    }

    public function columns(DbConnection $connection, string $tableName): array
    {
        $table = $this->table($connection, $tableName);
        return $table['columns'] ?? [];
    }

    public function hasColumn(DbConnection $connection, string $tableName, string $columnName): bool
    {
        $columns = $this->columns($connection, $tableName);
        return isset($columns[$columnName]);
    }

    public function primaryKey(DbConnection $connection, string $tableName): array
    {
        $table = $this->table($connection, $tableName);
        return $table['primary_key'] ?? [];
    }

    public function uniqueKeys(DbConnection $connection, string $tableName): array
    {
        $table = $this->table($connection, $tableName);
        return $table['unique_keys'] ?? [];
    }

    public function foreignKeys(DbConnection $connection, ?string $tableName = null): array
    {
        $schema = $this->getSchema($connection);
        if ($tableName === null) {
            return $schema['foreign_keys'] ?? [];
        }
        $table = $schema['tables'][$tableName] ?? null;
        return $table['foreign_keys'] ?? [];
    }

    public function serverInfo(DbConnection $connection): array
    {
        return $this->getSchema($connection)['server_info'] ?? [];
    }

    /**
     * Look up real distinct values for a column (bounded, safe, allowlisted).
     * Used for value grounding ("Rajasthan" -> "RJ").
     */
    public function distinctValues(DbConnection $connection, string $table, string $column, int $limit = 15): array
    {
        if (!$this->hasTable($connection, $table) || !$this->hasColumn($connection, $table, $column)) {
            return [];
        }
        if (ColumnClassifier::isSecret($column)) {
            return [];
        }
        $this->policy->assertCanReadTable($connection, $table);

        return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $column, $limit) {
            $qTable = $dialect->quote($table);
            $qCol = $dialect->quote($column);
            $sql = "SELECT DISTINCT {$qCol} AS val FROM {$qTable} WHERE {$qCol} IS NOT NULL LIMIT " . max(1, min(50, $limit));
            $stmt = $pdo->query($sql);
            $vals = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                if ($row['val'] !== null && $row['val'] !== '') {
                    $vals[] = $row['val'];
                }
            }
            return $vals;
        });
    }
}
