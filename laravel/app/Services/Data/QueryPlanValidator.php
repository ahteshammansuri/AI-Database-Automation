<?php

namespace App\Services\Data;

use App\Models\DbConnection;

class QueryPlanValidator
{
    private const ALLOWED_OPS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'in', 'is_null', 'is_not_null'];
    private const ALLOWED_AGGS = ['count', 'sum', 'avg', 'min', 'max', 'none', null];

    public function __construct(
        protected LiveSchemaService $schemaService,
        protected DataAccessPolicy $policy
    ) {}

    /**
     * Validate QueryPlan structure and entities against the live schema and security policy.
     *
     * @return array<string> List of validation error strings. Empty if valid.
     */
    public function validate(DbConnection $connection, array $plan): array
    {
        $errors = [];
        $catalog = $this->schemaService->getCatalog($connection);
        $tables = $catalog['tables'] ?? [];

        // 1. Validate tables
        $planTables = (array) ($plan['tables'] ?? []);
        if (empty($planTables)) {
            $errors[] = "QueryPlan missing required 'tables' array.";
            return $errors;
        }

        foreach ($planTables as $table) {
            if (!isset($tables[$table])) {
                $errors[] = "Table '{$table}' does not exist in live database schema.";
                continue;
            }
            // Check table access policy
            $class = $this->policy->getTableClass($connection, $table);
            if ($class === 'blocked') {
                $errors[] = "Access to table '{$table}' is blocked by security policy.";
            }
        }

        if (!empty($errors)) {
            return $errors;
        }

        $primaryTable = $planTables[0];
        $primaryCols = $tables[$primaryTable]['columns'] ?? [];

        // 2. Validate select columns
        $select = (array) ($plan['select'] ?? []);
        foreach ($select as $item) {
            $col = $item['column'] ?? '*';
            $t = $item['table'] ?? $primaryTable;
            $agg = $item['agg'] ?? null;

            if ($col !== '*' && !isset($tables[$t]['columns'][$col])) {
                $errors[] = "Column '{$col}' does not exist on table '{$t}'.";
            }
            if ($agg && !in_array(strtolower($agg), self::ALLOWED_AGGS, true)) {
                $errors[] = "Unsupported aggregate function '{$agg}'.";
            }
        }

        // 3. Validate filters
        $filters = (array) ($plan['filters'] ?? []);
        foreach ($filters as $f) {
            $col = $f['column'] ?? null;
            $t = $f['table'] ?? $primaryTable;
            $op = strtolower($f['op'] ?? '=');

            if (!$col) {
                $errors[] = "Filter missing 'column' field.";
                continue;
            }
            if (!isset($tables[$t]['columns'][$col])) {
                $errors[] = "Filter column '{$col}' does not exist on table '{$t}'.";
            }
            if (!in_array($op, self::ALLOWED_OPS, true)) {
                $errors[] = "Unsupported filter operator '{$op}'. Allowed: " . implode(', ', self::ALLOWED_OPS);
            }
        }

        // 4. Validate joins
        $joins = (array) ($plan['joins'] ?? []);
        foreach ($joins as $j) {
            $from = $j['from'] ?? null;
            $to = $j['to'] ?? null;
            if (!$from || !isset($tables[$from])) {
                $errors[] = "Join from-table '{$from}' does not exist.";
            }
            if (!$to || !isset($tables[$to])) {
                $errors[] = "Join to-table '{$to}' does not exist.";
            }
        }

        // 5. Validate order_by
        $orderBy = (array) ($plan['order_by'] ?? []);
        foreach ($orderBy as $o) {
            $col = $o['column'] ?? null;
            $t = $o['table'] ?? $primaryTable;
            $dir = strtolower($o['direction'] ?? 'asc');
            if ($col && (!isset($tables[$t]) || !isset($tables[$t]['columns'][$col]))) {
                $errors[] = "Order by column '{$col}' does not exist on table '{$t}'.";
            }
            if (!in_array($dir, ['asc', 'desc'], true)) {
                $errors[] = "Order direction must be 'asc' or 'desc'.";
            }
        }

        return $errors;
    }
}
