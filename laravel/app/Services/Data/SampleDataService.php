<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use App\Models\ModelRole;
use App\Models\User;
use App\Services\Agent\ModelSelector;
use App\Services\AiServiceClient;
use App\Services\AiUsage;
use PDO;

/**
 * AI sample ("dummy") rows for a customer's table. The column rules come from the live table; the customer's
 * writing model proposes rows; every value is validated (RowValidator, unique values, links) and only valid rows are
 * turned into an insert preview that the customer confirms (or a data autopilot confirmed when it was set up).
 */
class SampleDataService
{
    public function __construct(
        private LiveSchemaService $schema,
        private TargetConnector $connector,
        private DataAccessPolicy $policy,
        private DataChangeService $changes,
        private RowValidator $validator,
        private AiServiceClient $ai,
    ) {}

    public static function maxRows(): int
    {
        return max(1, (int) config('data_explorer.max_sample_rows', 25));
    }

    /**
     * What the AI needs to write valid rows: one rule per column it fills, values already used in unique columns,
     * and anything that makes sample rows impossible (blockers).
     *
     * @return array{columns: list<array>, existing_unique: array<string, list<string>>, blockers: list<string>, skipped: list<string>, meta: array}
     */
    public function columnRules(DbConnection $connection, string $table): array
    {
        $this->policy->assertCanWrite($connection, $table, 'insert');
        $catalog = $this->schema->getCatalog($connection);
        $meta = $catalog['tables'][$table] ?? null;
        if (!$meta) {
            throw new DataException('TABLE_NOT_FOUND', "There is no table “{$table}” in this database.");
        }

        $unique = [];
        foreach (array_merge([$meta['primary_key'] ?? []], array_values($meta['unique_keys'] ?? [])) as $key) {
            if (count($key) === 1) {
                $unique[$key[0]] = true;
            }
        }
        $links = [];
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns']) === 1) {
                $links[$fk['columns'][0]] = $fk;
            }
        }

        $columns = [];
        $blockers = [];
        $skipped = [];
        $readParents = [];
        foreach ($meta['columns'] as $name => $c) {
            $family = $c['family'] ?? 'other';
            if (!empty($c['auto']) || !empty($c['generated']) || ColumnClassifier::isSecret($name) || $family === 'binary') {
                continue;
            }
            // Timestamps and soft-delete markers with a database default fill themselves.
            if ((!empty($c['is_soft_delete']) && !empty($c['nullable'])) || ($c['default'] !== null && in_array($c['temporal_role'] ?? null, ['created', 'updated'], true))) {
                $skipped[] = $name;
                continue;
            }
            $rule = [
                'name' => $name,
                'family' => $family,
                'type' => $c['raw_type'] ?? $c['data_type'] ?? '',
                'nullable' => (bool) ($c['nullable'] ?? true),
                'max_length' => $c['max_length'] ?? null,
                'enum' => $c['enum'] ?? [],
                'unique' => isset($unique[$name]),
                'comment' => $c['comment'] ?? '',
            ];
            if (isset($links[$name])) {
                $fk = $links[$name];
                $parent = $catalog['tables'][$fk['ref_table']] ?? null;
                if (!$parent || ($parent['class'] ?? null) === 'blocked') {
                    if (!empty($c['nullable'])) {
                        $skipped[] = $name;
                        continue;
                    }
                    $blockers[] = "“{$name}” must link to “{$fk['ref_table']}”, which is protected, so sample rows cannot be created here.";
                    continue;
                }
                $label = $parent['label_column'] ?? null;
                $readParents[$name] = [$fk['ref_table'], $fk['ref_columns'][0], $label];
                $rule['link'] = ['table' => $fk['ref_table'], 'options' => []];
            }
            $columns[$name] = $rule;
        }

        // Existing parent records a link may use, and values already taken in unique text columns.
        $existing = $this->connector->read($connection, function (PDO $pdo, $dialect) use ($readParents, $columns, $table, $meta) {
            $out = ['parents' => [], 'unique' => []];
            foreach ($readParents as $col => [$refTable, $refCol, $label]) {
                $sel = $dialect->quoteIdentifier($refCol) . ' AS id' . ($label ? ', ' . $dialect->quoteIdentifier($label) . ' AS label' : '');
                $stmt = $pdo->query("SELECT {$sel} FROM " . $dialect->quoteIdentifier($refTable) . ' ORDER BY ' . $dialect->quoteIdentifier($refCol) . ' DESC LIMIT ' . max(5, (int) config('automation.relation_options', 40)));
                $out['parents'][$col] = array_map(fn ($r) => ['id' => is_numeric($r['id']) ? (int) $r['id'] : $r['id'], 'label' => isset($r['label']) ? mb_substr((string) $r['label'], 0, 80) : null], $stmt->fetchAll(PDO::FETCH_ASSOC));
            }
            $order = isset($meta['primary_key'][0]) ? ' ORDER BY ' . $dialect->quoteIdentifier($meta['primary_key'][0]) . ' DESC' : '';
            foreach ($columns as $name => $rule) {
                if ($rule['unique'] && in_array($rule['family'], ['string', 'text'], true)) {
                    $stmt = $pdo->query('SELECT ' . $dialect->quoteIdentifier($name) . ' FROM ' . $dialect->quoteIdentifier($table) . $order . ' LIMIT 200');
                    $out['unique'][$name] = array_values(array_filter(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN))));
                }
            }
            return $out;
        });

        foreach ($existing['parents'] as $col => $options) {
            if (!$options) {
                if (!empty($columns[$col]['nullable'])) {
                    unset($columns[$col]);
                    $skipped[] = $col;
                } else {
                    $blockers[] = "“{$col}” must link to a row in “{$readParents[$col][0]}”, which is empty. Add rows there first (you can generate sample rows for it too).";
                    unset($columns[$col]);
                }
                continue;
            }
            $columns[$col]['link']['options'] = $options;
        }

        return [
            'columns' => array_values($columns),
            'existing_unique' => $existing['unique'],
            'blockers' => $blockers,
            'skipped' => $skipped,
            'meta' => $meta,
        ];
    }

    /**
     * Ask the customer's writing model for rows and keep only the ones that pass every check.
     * $emit(stage, message) reports each step as it happens.
     *
     * @return array{rows: list<array>, dropped: list<array{row: int, errors: array<string, string>}>, problems: list<string>, model: string, seconds: float, requested: int}
     */
    public function generate(DbConnection $connection, User $user, string $table, int $count, string $instructions, ?callable $emit = null): array
    {
        $emit ??= fn () => null;
        $count = max(1, min(self::maxRows(), $count));
        $rules = $this->columnRules($connection, $table);
        if ($rules['blockers']) {
            throw new DataException('SAMPLE_BLOCKED', implode(' ', $rules['blockers']));
        }
        if (!$rules['columns']) {
            throw new DataException('NOTHING_TO_FILL', "Every column of “{$table}” is filled by the database, so there is nothing for sample rows to set.");
        }
        $linked = array_values(array_filter($rules['columns'], fn ($c) => isset($c['link'])));
        $emit('RULES_READ', 'Read “' . $table . '”: ' . count($rules['columns']) . ' column(s) to fill'
            . ($linked ? ', ' . implode(', ', array_map(fn ($c) => "{$c['name']} links to {$c['link']['table']} (" . count($c['link']['options']) . ' existing)', $linked)) : '') . '.');

        $model = ModelSelector::for($user, ModelRole::ROLE_GENERATOR);
        $emit('GENERATING', "Asking {$model['model']} for {$count} row(s).");
        $res = AiUsage::using($user->id, 'sample_data', $connection, fn () => $this->ai->sampleRows([
            'provider' => $model['provider'],
            'model' => $model['model'],
            'api_key' => $model['api_key'],
            'table' => $table,
            'columns' => $rules['columns'],
            'count' => $count,
            'instructions' => mb_substr($instructions, 0, 1000),
            'existing_unique' => $rules['existing_unique'],
            'temperature' => $model['temperature'],
        ], (int) config('orbit.readiness_budget_seconds', 240)));

        $proposed = (array) ($res['rows'] ?? []);
        $emit('GENERATED', 'Received ' . count($proposed) . ' row(s) in ' . round((float) ($res['seconds'] ?? 0)) . 's. Checking every value…');

        $valid = [];
        $dropped = [];
        foreach ($proposed as $i => $row) {
            [$clean, $errors] = $this->validator->validate($rules['meta'], (array) $row, true);
            if ($errors) {
                $dropped[] = ['row' => $i + 1, 'errors' => $errors];
                continue;
            }
            $valid[] = $clean;
        }
        if ($valid) {
            $linkErrors = $this->changes->checkUniqueAndLinks($connection, $table, $rules['meta'], $valid, []);
            foreach ($linkErrors as $i => $errors) {
                $dropped[] = ['row' => $i + 1, 'errors' => $errors];
                unset($valid[$i]);
            }
            $valid = array_values($valid);
        }
        $emit('VALIDATED', count($valid) . ' row(s) passed every check' . ($dropped ? ', ' . count($dropped) . ' were left out (shown below)' : '') . '.');

        return [
            'rows' => $valid,
            'dropped' => $dropped,
            'problems' => array_values((array) ($res['problems'] ?? [])),
            'model' => $model['model'],
            'seconds' => (float) ($res['seconds'] ?? 0),
            'requested' => $count,
            'error' => $res['error'] ?? null,
        ];
    }
}
