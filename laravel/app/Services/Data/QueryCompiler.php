<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use App\Services\Data\Dialects\DialectRegistry;

class QueryCompiler
{
    public function __construct(
        protected DialectRegistry $dialectRegistry
    ) {}

    /**
     * Compile validated QueryPlan into parameterized SQL with dialect quoting.
     *
     * @return array{sql: string, bindings: array, primary_table: string, assumptions: array}
     */
    public function compile(DbConnection $connection, array $plan, array $catalog): array
    {
        $dialect = $this->dialectRegistry->get($connection->driver ?: 'mysql');
        $tables = (array) ($plan['tables'] ?? []);
        $primaryTable = $tables[0] ?? 'users';
        $bindings = [];
        $assumptions = (array) ($plan['assumptions'] ?? []);

        // 1. SELECT clause
        $selectParts = [];
        $select = (array) ($plan['select'] ?? []);
        if (empty($select)) {
            $select = [['column' => '*', 'table' => $primaryTable]];
        }

        foreach ($select as $item) {
            $col = $item['column'] ?? '*';
            $t = $item['table'] ?? $primaryTable;
            $agg = strtolower($item['agg'] ?? 'none');
            $alias = $item['alias'] ?? null;

            if ($col === '*') {
                $target = count($tables) > 1 ? $dialect->quoteIdentifier($t) . '.*' : '*';
            } else {
                $target = count($tables) > 1 
                    ? $dialect->quoteIdentifier($t) . '.' . $dialect->quoteIdentifier($col)
                    : $dialect->quoteIdentifier($col);
            }

            if ($agg && $agg !== 'none') {
                $expr = strtoupper($agg) . '(' . $target . ')';
                if ($alias) {
                    $expr .= ' AS ' . $dialect->quoteIdentifier($alias);
                }
                $selectParts[] = $expr;
            } else {
                $expr = $target;
                if ($alias) {
                    $expr .= ' AS ' . $dialect->quoteIdentifier($alias);
                }
                $selectParts[] = $expr;
            }
        }
        $selectClause = implode(', ', $selectParts);

        // 2. FROM clause
        $fromClause = $dialect->quoteIdentifier($primaryTable);

        // 3. JOIN clauses
        $joinClauses = [];
        $joins = (array) ($plan['joins'] ?? []);
        foreach ($joins as $j) {
            $fromT = $j['from'] ?? null;
            $toT = $j['to'] ?? null;
            $fkName = $j['via_fk'] ?? null;

            // Find matching FK in catalog
            $joinOn = null;
            foreach ($catalog['foreign_keys'] ?? [] as $fk) {
                if (($fk['table'] === $fromT && $fk['ref_table'] === $toT) ||
                    ($fk['table'] === $toT && $fk['ref_table'] === $fromT)) {
                    $joinOn = $dialect->quoteIdentifier($fk['table']) . '.' . $dialect->quoteIdentifier($fk['columns'][0]) . ' = ' .
                              $dialect->quoteIdentifier($fk['ref_table']) . '.' . $dialect->quoteIdentifier($fk['ref_columns'][0]);
                    break;
                }
            }

            if (!$joinOn) {
                // Fallback heuristic: id = {table}_id
                $joinOn = $dialect->quoteIdentifier($toT) . '.' . $dialect->quoteIdentifier('id') . ' = ' .
                          $dialect->quoteIdentifier($fromT) . '.' . $dialect->quoteIdentifier(rtrim($toT, 's') . '_id');
            }

            $joinClauses[] = 'JOIN ' . $dialect->quoteIdentifier($toT) . ' ON ' . $joinOn;
        }

        // 4. WHERE clause
        $whereParts = [];

        // Regular filters
        $filters = (array) ($plan['filters'] ?? []);
        foreach ($filters as $f) {
            $col = $f['column'];
            $t = $f['table'] ?? $primaryTable;
            $op = strtolower($f['op'] ?? '=');
            $val = $f['value'] ?? null;

            $colRef = count($tables) > 1
                ? $dialect->quoteIdentifier($t) . '.' . $dialect->quoteIdentifier($col)
                : $dialect->quoteIdentifier($col);

            if ($op === 'is_null') {
                $whereParts[] = $colRef . ' IS NULL';
            } elseif ($op === 'is_not_null') {
                $whereParts[] = $colRef . ' IS NOT NULL';
            } elseif ($op === 'in' && is_array($val)) {
                if (empty($val)) {
                    $whereParts[] = '1 = 0';
                } else {
                    $placeholders = implode(', ', array_fill(0, count($val), '?'));
                    $whereParts[] = $colRef . ' IN (' . $placeholders . ')';
                    foreach ($val as $v) {
                        $bindings[] = $v;
                    }
                }
            } elseif ($op === 'like') {
                $whereParts[] = $colRef . ' LIKE ?';
                $bindings[] = str_contains((string) $val, '%') ? (string) $val : '%' . $val . '%';
            } else {
                $whereParts[] = $colRef . ' ' . $op . ' ?';
                $bindings[] = $val;
            }
        }

        // Time window filter
        if (!empty($plan['time_window']) && is_array($plan['time_window'])) {
            $tw = $plan['time_window'];
            $tz = $tw['timezone'] ?? ($connection->data_timezone ?: 'Asia/Kolkata');
            $tsCol = $tw['column'] ?? TimeWindowResolver::detectTimestampColumn($catalog['tables'][$primaryTable]['columns'] ?? []);

            if ($tsCol && isset($catalog['tables'][$primaryTable]['columns'][$tsCol])) {
                $resolved = TimeWindowResolver::resolve($tw, $tz);
                $colRef = count($tables) > 1
                    ? $dialect->quoteIdentifier($primaryTable) . '.' . $dialect->quoteIdentifier($tsCol)
                    : $dialect->quoteIdentifier($tsCol);

                $whereParts[] = $colRef . ' >= ?';
                $whereParts[] = $colRef . ' <= ?';
                $bindings[] = $resolved['from_iso'];
                $bindings[] = $resolved['to_iso'];

                $assumptions[] = "Filtered by {$tsCol} between {$resolved['from_iso']} and {$resolved['to_iso']} ({$tz})";
            }
        }

        $whereClause = !empty($whereParts) ? 'WHERE ' . implode(' AND ', $whereParts) : '';

        // 5. GROUP BY
        $groupByClause = '';
        $groupBy = (array) ($plan['group_by'] ?? []);
        if (!empty($groupBy)) {
            $quotedGb = array_map(fn($c) => $dialect->quoteIdentifier($c), $groupBy);
            $groupByClause = 'GROUP BY ' . implode(', ', $quotedGb);
        }

        // 6. ORDER BY
        $orderByClause = '';
        $orderBy = (array) ($plan['order_by'] ?? []);
        if (!empty($orderBy)) {
            $obParts = [];
            foreach ($orderBy as $ob) {
                $col = $ob['column'];
                $dir = strtoupper($ob['direction'] ?? 'ASC');
                $obParts[] = $dialect->quoteIdentifier($col) . ' ' . $dir;
            }
            $orderByClause = 'ORDER BY ' . implode(', ', $obParts);
        }

        // 7. LIMIT
        $limit = min(500, max(1, (int) ($plan['limit'] ?? 50)));
        $limitClause = 'LIMIT ' . $limit;

        // Assemble full SQL
        $sqlComponents = [
            'SELECT', $selectClause,
            'FROM', $fromClause,
        ];
        if (!empty($joinClauses)) {
            $sqlComponents[] = implode(' ', $joinClauses);
        }
        if ($whereClause) {
            $sqlComponents[] = $whereClause;
        }
        if ($groupByClause) {
            $sqlComponents[] = $groupByClause;
        }
        if ($orderByClause) {
            $sqlComponents[] = $orderByClause;
        }
        $sqlComponents[] = $limitClause;

        $sql = implode(' ', $sqlComponents);

        return [
            'sql' => $sql,
            'bindings' => $bindings,
            'primary_table' => $primaryTable,
            'assumptions' => array_unique($assumptions),
            'limit' => $limit,
        ];
    }
}
