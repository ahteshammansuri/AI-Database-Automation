<?php

namespace App\Services\Data;

use App\Models\DbConnection;
use App\Services\DatabaseSafetyService;
use App\Services\FeatureFlagService;
use Illuminate\Support\Str;
use PDO;

/**
 * Linked rows for people, the same on every screen (Data page, manual publishing, automation fields): the rows of
 * the linked table named in people's words, readable names for stored ids, whether and how a new linked row can be
 * added, a new linked row checked before it is saved, the values a status-like column uses, and how well a link
 * matches the data. Reads only; the rows themselves are written by DataChangeService or the automation executor.
 *
 * Context decides who may create a new linked row: 'data' follows the Data Manager rules (the connection's access
 * mode and the table's class); 'publish' follows the automation rules (never accounts, roles, payments and other
 * protected tables).
 */
class LinkedRecords
{
    private const OPTION_LIMIT = 50;
    private const SAMPLE_ROWS = 5000;
    private const MAX_CHOICES = 25;

    public function __construct(
        private LiveSchemaService $schema,
        private DataAccessPolicy $policy,
        private TargetConnector $connector,
        private RowValidator $validator,
        private DatabaseSafetyService $safety,
    ) {}

    /** The effective link of a column, or a refusal in plain words. */
    public function link(array $catalog, string $table, string $column): array
    {
        foreach ($catalog['tables'][$table]['foreign_keys'] ?? [] as $fk) {
            if (($fk['columns'] ?? []) === [$column]) {
                return $fk;
            }
        }
        throw new DataException('NOT_A_LINK', "“{$column}” does not link to another table.");
    }

    /**
     * The value that means "not linked" for this column: NULL when allowed, or 0 when the database does not enforce
     * the link and the column defaults to 0 (categories.parent_id = 0 for a top-level category).
     */
    public static function noneValue(array $col, array $fk): array
    {
        if (!empty($col['nullable'])) {
            return ['allowed' => true, 'value' => null];
        }
        if (empty($fk['enforced']) && in_array((string) ($col['default'] ?? ''), ['0', "'0'"], true)) {
            return ['allowed' => true, 'value' => 0];
        }
        return ['allowed' => false, 'value' => null];
    }

    /**
     * Columns as the Data page shows and edits them: type, rules, where each link points (declared, detected or set
     * by the owner) and what "not linked" is, and whether values are offered as a list of choices.
     */
    public function columnsFor(array $meta, array $names): array
    {
        $pk = $meta['primary_key'] ?? [];
        $links = [];
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns']) === 1) {
                $links[$fk['columns'][0]] = $fk;
            }
        }
        return array_values(array_map(function ($name) use ($meta, $pk, $links) {
            $c = $meta['columns'][$name];
            $fk = $links[$name] ?? null;
            return [
                'name' => $name,
                'type' => $c['raw_type'] ?? $c['data_type'] ?? '',
                'family' => $c['family'] ?? 'other',
                'nullable' => (bool) ($c['nullable'] ?? true),
                'default' => $c['default'] ?? null,
                'max_length' => $c['max_length'] ?? null,
                'enum' => $c['enum'] ?? [],
                'auto' => (bool) ($c['auto'] ?? false),
                'generated' => (bool) ($c['generated'] ?? false),
                'is_pk' => in_array($name, $pk, true),
                'link' => $fk ? [
                    'table' => $fk['ref_table'],
                    'column' => $fk['ref_columns'][0],
                    'source' => $fk['source'] ?? 'declared',
                    'enforced' => (bool) ($fk['enforced'] ?? true),
                    'reason' => $fk['reason'] ?? null,
                    'none' => self::noneValue($c, $fk),
                ] : null,
                'choices' => !empty($c['enum']) ? 'enum' : (($c['family'] ?? '') === 'boolean' ? 'boolean' : (!empty($c['categorical']) || !empty($c['value_labels']) ? 'values' : null)),
                'value_labels' => (object) ($c['value_labels'] ?? []),
                'personal' => ColumnClassifier::isPii($name),
                'comment' => $c['comment'] ?? '',
            ];
        }, $names));
    }

    /**
     * What a person picks from for a linked column: the linked table, how its rows are named, rows matching the
     * search (by name or id), the current value's name, and whether a new linked row can be added and how.
     */
    public function options(DbConnection $connection, string $table, string $column, string $q = '', string $context = 'data', mixed $selected = null): array
    {
        $catalog = $this->schema->getCatalog($connection);
        $meta = $catalog['tables'][$table] ?? throw new DataException('TABLE_NOT_FOUND', "There is no table “{$table}” in this database.");
        $this->policy->assertCanReadTable($connection, $table);
        $fk = $this->link($catalog, $table, $column);
        $refTable = $fk['ref_table'];
        $ref = $catalog['tables'][$refTable] ?? null;
        $refCol = $fk['ref_columns'][0];
        $base = [
            'table' => $table,
            'column' => $column,
            'ref_table' => $refTable,
            'ref_column' => $refCol,
            'thing' => self::thing($refTable),
            'source' => $fk['source'] ?? 'declared',
            'enforced' => (bool) ($fk['enforced'] ?? true),
            'reason' => $fk['reason'] ?? null,
            'none' => self::noneValue($meta['columns'][$column] ?? [], $fk),
        ];
        if (!$ref || ($ref['class'] ?? null) === 'blocked') {
            return $base + ['label_column' => null, 'options' => [], 'total' => null, 'selected' => null,
                'create' => ['allowed' => false, 'reason' => "{$refTable} holds credentials or sessions, so its rows are never listed.", 'mode' => 'name', 'label_column' => null, 'required' => [], 'automatic' => []],
                'blocked' => true];
        }
        $label = $ref['label_column'] ?? null;
        $q = trim($q);

        [$rows, $total, $current] = $this->connector->read($connection, function (PDO $pdo, $dialect) use ($refTable, $refCol, $label, $q, $selected, $ref) {
            $qt = $dialect->quoteIdentifier($refTable);
            $key = $dialect->quoteIdentifier($refCol);
            $sel = "{$key} AS id" . ($label ? ', ' . $dialect->quoteIdentifier($label) . ' AS label' : '');
            $where = [];
            $bind = [];
            if ($q !== '') {
                if ($label) {
                    $where[] = $dialect->quoteIdentifier($label) . ' ' . $dialect->ciLike() . ' ?';
                    $bind[] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
                }
                if (self::fits($ref['columns'][$refCol] ?? [], $q)) {
                    $where[] = "{$key} = ?";
                    $bind[] = $q;
                }
                if (!$where) {
                    return [[], 0, null];
                }
            }
            $order = $label ? $dialect->quoteIdentifier($label) . ' ASC, ' . $key . ' ASC' : "{$key} DESC";
            $stmt = $pdo->prepare("SELECT {$sel} FROM {$qt}" . ($where ? ' WHERE ' . implode(' OR ', $where) : '') . " ORDER BY {$order} LIMIT " . self::OPTION_LIMIT);
            $stmt->execute($bind);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $total = null;
            if (($ref['rows_estimate'] ?? 0) < 200000) {
                try {
                    $total = (int) $pdo->query("SELECT COUNT(*) FROM {$qt}")->fetchColumn();
                } catch (\Throwable) {
                    // the list still works without a total
                }
            }
            $current = null;
            if ($selected !== null && $selected !== '' && self::fits($ref['columns'][$refCol] ?? [], (string) $selected)) {
                $s = $pdo->prepare("SELECT {$sel} FROM {$qt} WHERE {$key} = ? LIMIT 1");
                $s->execute([$selected]);
                $current = $s->fetch(PDO::FETCH_ASSOC) ?: null;
            }
            return [$rows, $total, $current];
        });

        $shape = fn ($r) => ['id' => $r['id'], 'label' => isset($r['label']) && $r['label'] !== null && $r['label'] !== '' ? mb_substr((string) $r['label'], 0, 120) : null];

        return $base + [
            'label_column' => $label,
            'options' => array_map($shape, $rows),
            'total' => $total,
            'selected' => $current ? $shape($current) : null,
            'create' => $this->createInfo($connection, $catalog, $refTable, $context),
            'blocked' => false,
        ];
    }

    /**
     * Whether a new row may be added to a linked table from a form, and how: 'name' when its name is all it needs
     * (a slug and timestamps are filled automatically), 'details' when other required values must be entered.
     */
    public function createInfo(DbConnection $connection, array $catalog, string $refTable, string $context): array
    {
        $ref = $catalog['tables'][$refTable] ?? null;
        $out = ['allowed' => false, 'reason' => null, 'mode' => 'name', 'label_column' => $ref['label_column'] ?? null, 'required' => [], 'automatic' => []];
        if (!$ref) {
            return ['reason' => "{$refTable} was not found."] + $out;
        }
        $thing = self::thing($refTable);

        if ($context === 'publish') {
            if ($this->safety->isTableSensitive($refTable) || $this->policy->getTableClass($connection, $refTable) !== 'writable') {
                return ['reason' => "{$refTable} is a protected table, so publishing never adds rows to it. Choose an existing {$thing}, or add one on the Data page."] + $out;
            }
        } else {
            if (!app(FeatureFlagService::class)->isEnabled('FEATURE_DATA_MANAGER')) {
                return ['reason' => 'Changing data in the portal is turned off by the administrator.'] + $out;
            }
            if ($refusal = $this->policy->writeRefusal($connection, $refTable, 'insert')) {
                return ['reason' => $refusal['message']] + $out;
            }
        }
        if (count($ref['primary_key'] ?? []) !== 1) {
            return ['reason' => "{$refTable} has no single key column, so a new row cannot be linked."] + $out;
        }

        [$required, $automatic, $blocker] = self::requiredFor($ref, $catalog);
        if ($blocker) {
            return ['reason' => $blocker] + $out;
        }
        $mode = $required === [] && ($ref['label_column'] ?? null) ? 'name' : 'details';
        return ['allowed' => true, 'reason' => null, 'mode' => $mode, 'required' => $required, 'automatic' => $automatic] + $out;
    }

    /**
     * Required values of a new row in a table, beyond its name: [required columns, columns filled automatically,
     * reason it cannot be created at all].
     */
    public static function requiredFor(array $meta, array $catalog = []): array
    {
        $label = $meta['label_column'] ?? null;
        $required = [];
        $automatic = [];
        foreach ($meta['columns'] ?? [] as $name => $c) {
            if (!empty($c['auto']) || !empty($c['generated']) || ($c['family'] ?? '') === 'binary') {
                continue;
            }
            $needed = empty($c['nullable']) && $c['default'] === null;
            if (ColumnClassifier::isSecret((string) $name)) {
                if ($needed) {
                    return [[], [], "A new row needs “{$name}”, which is a protected value that is never written from here."];
                }
                continue;
            }
            if ($name === $label) {
                continue;
            }
            if ($label && self::isSlug((string) $name, $c)) {
                $automatic[] = $name;
                continue;
            }
            if (in_array($c['temporal_role'] ?? null, ['created', 'updated'], true) && in_array($c['family'] ?? '', ['timestamp_tz', 'timestamp_naive', 'date'], true)) {
                if ($c['default'] === null) {
                    $automatic[] = $name;
                }
                continue;
            }
            if ($needed) {
                $required[] = $name;
            }
        }
        return [$required, $automatic, null];
    }

    /**
     * A new linked row from a name or a form, ready to save: the name and given values, a unique slug and the
     * timestamps filled in, every value checked like any other row.
     *
     * @return array{values: array, errors: array<string, string>, label: string, existing: mixed}
     *         existing: the id of a row that already has this name (that row is used instead of a new one)
     */
    public function prepareParent(DbConnection $connection, array $catalog, string $refTable, array $given, string $context = 'data'): array
    {
        $ref = $catalog['tables'][$refTable] ?? throw new DataException('TABLE_NOT_FOUND', "There is no table “{$refTable}”.");
        $info = $this->createInfo($connection, $catalog, $refTable, $context);
        if (!$info['allowed']) {
            throw new DataException('PARENT_NOT_ALLOWED', $info['reason'] ?? "A new row cannot be added to {$refTable}.");
        }
        $label = $ref['label_column'] ?? null;
        $values = [];
        foreach ($given as $k => $v) {
            if (is_string($k) && isset($ref['columns'][$k]) && !is_array($v)) {
                $values[$k] = is_string($v) ? trim($v) : $v;
            }
        }
        $name = $label ? (string) ($values[$label] ?? '') : '';
        if ($label && $name === '') {
            return ['values' => [], 'errors' => [$label => 'Enter a name.'], 'label' => '', 'existing' => null, 'only_name' => true];
        }

        // Only a name was typed: a row with that name already exists, so that one is used. A filled-in form always
        // adds its own row (two people can share a name).
        $onlyName = !array_filter($values, fn ($v, $k) => $k !== $label && $v !== '' && $v !== null, ARRAY_FILTER_USE_BOTH);
        $existing = $label && $onlyName ? $this->findByLabel($connection, $refTable, $ref, $name) : null;
        if ($existing !== null) {
            return ['values' => [], 'errors' => [], 'label' => $name, 'existing' => $existing, 'only_name' => true];
        }

        $now = now($connection->data_timezone ?: 'UTC');
        foreach ($ref['columns'] as $col => $c) {
            if (array_key_exists($col, $values) && $values[$col] !== '' && $values[$col] !== null) {
                continue;
            }
            if ($label && self::isSlug($col, $c)) {
                $values[$col] = $this->uniqueSlug($connection, $refTable, $col, $c, Str::slug($name) ?: Str::lower(Str::random(8)));
            } elseif (in_array($c['temporal_role'] ?? null, ['created', 'updated'], true) && $c['default'] === null) {
                $values[$col] = ($c['family'] ?? '') === 'date' ? $now->format('Y-m-d') : $now->format('Y-m-d H:i:s');
            } elseif (($values[$col] ?? null) === '' && !in_array($c['family'] ?? '', ['string', 'text'], true)) {
                unset($values[$col]);
            }
        }

        [$clean, $errors] = $this->validator->validate($ref, $values, true);
        if (!$errors) {
            $errors = app(DataChangeService::class)->checkUniqueAndLinks($connection, $refTable, $ref, [$clean], [])[0] ?? [];
        }
        return ['values' => $clean, 'errors' => $errors, 'label' => $name !== '' ? $name : (string) reset($clean), 'existing' => null, 'only_name' => $onlyName];
    }

    /**
     * New linked rows asked for in one row ({"$new": {...values}} instead of an id): checked and kept aside to be
     * added first, in the same transaction; a name that already exists uses that row instead.
     *
     * @return array{row: array, parents: array<string, array>, errors: array<string, string>, parent_errors: array<string, array<string, string>>, reused: array<string, array>}
     */
    public function extractNewParents(DbConnection $connection, array $catalog, string $table, array $row, string $context, string $keyPrefix): array
    {
        $parents = [];
        $errors = [];
        $parentErrors = [];
        $reused = [];
        foreach ($row as $col => $value) {
            if (!is_array($value) || !array_key_exists('$new', $value)) {
                continue;
            }
            unset($row[$col]);
            try {
                $fk = $this->link($catalog, $table, (string) $col);
                $prepared = $this->prepareParent($connection, $catalog, $fk['ref_table'], (array) $value['$new'], $context);
            } catch (DataException $e) {
                $errors[$col] = $e->getMessage();
                continue;
            }
            $thing = self::thing($fk['ref_table']);
            if ($prepared['existing'] !== null) {
                $row[$col] = $prepared['existing'];
                $reused[$col] = ['table' => $fk['ref_table'], 'id' => $prepared['existing'], 'label' => $prepared['label']];
                continue;
            }
            if ($prepared['errors']) {
                $parentErrors[$col] = $prepared['errors'];
                $errors[$col] = "The new {$thing} is not complete: " . implode(' ', array_map(fn ($c, $m) => "{$c}: {$m}", array_keys($prepared['errors']), $prepared['errors']));
                continue;
            }
            $key = "{$keyPrefix}{$col}";
            $parents[$key] = [
                'column' => $col,
                'table' => $fk['ref_table'],
                'key_column' => $fk['ref_columns'][0],
                'label_column' => $catalog['tables'][$fk['ref_table']]['label_column'] ?? null,
                'label' => $prepared['label'],
                'values' => $prepared['values'],
                'reuse_by_name' => $prepared['only_name'],
            ];
            $row[$col] = ['$parent' => $key];
        }
        return ['row' => $row, 'parents' => $parents, 'errors' => $errors, 'parent_errors' => $parentErrors, 'reused' => $reused];
    }

    /**
     * Readable names for the linked ids in these rows (category_id 3 -> "Fashion"), by column then id.
     *
     * @param  array<int, array<string, mixed>>  $rows
     */
    public function labels(DbConnection $connection, array $catalog, string $table, array $rows, array $onlyColumns = []): array
    {
        $meta = $catalog['tables'][$table] ?? null;
        if (!$meta || !$rows) {
            return [];
        }
        $wanted = [];
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns']) !== 1 || ($onlyColumns && !in_array($fk['columns'][0], $onlyColumns, true))) {
                continue;
            }
            $ref = $catalog['tables'][$fk['ref_table']] ?? null;
            $label = $ref['label_column'] ?? null;
            if (!$ref || ($ref['class'] ?? null) === 'blocked' || !$label) {
                continue;
            }
            $refKey = $ref['columns'][$fk['ref_columns'][0]] ?? [];
            $ids = array_values(array_unique(array_filter(array_column($rows, $fk['columns'][0]), fn ($x) => is_scalar($x) && $x !== '' && self::fits($refKey, (string) $x))));
            if ($ids) {
                $wanted[$fk['columns'][0]] = [$fk['ref_table'], $fk['ref_columns'][0], $label, array_slice($ids, 0, 200)];
            }
        }
        if (!$wanted) {
            return [];
        }
        return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($wanted) {
            $out = [];
            foreach ($wanted as $col => [$refTable, $refCol, $label, $ids]) {
                $stmt = $pdo->prepare('SELECT ' . $dialect->quoteIdentifier($refCol) . ' AS k, ' . $dialect->quoteIdentifier($label) . ' AS v FROM ' . $dialect->quoteIdentifier($refTable)
                    . ' WHERE ' . $dialect->quoteIdentifier($refCol) . ' IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')');
                $stmt->execute($ids);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                    $out[$col][(string) $r['k']] = mb_substr((string) $r['v'], 0, 120);
                }
            }
            return $out;
        });
    }

    /**
     * The values a status-like column holds (from a bounded sample of rows), how often each is used, and the names
     * the owner gave them. Enum and yes/no columns list their fixed choices.
     */
    public function valueChoices(DbConnection $connection, string $table, string $column): array
    {
        $catalog = $this->schema->getCatalog($connection);
        $meta = $catalog['tables'][$table] ?? throw new DataException('TABLE_NOT_FOUND', "There is no table “{$table}” in this database.");
        $this->policy->assertCanReadTable($connection, $table);
        $col = $meta['columns'][$column] ?? throw new DataException('UNKNOWN_COLUMN', "There is no column “{$column}” in {$table}.");
        if (ColumnClassifier::classify($column)['class'] !== 'standard') {
            throw new DataException('PROTECTED_COLUMN', 'Protected and personal values are never listed.');
        }
        $labels = (array) ($col['value_labels'] ?? []);
        $base = ['table' => $table, 'column' => $column, 'family' => $col['family'] ?? 'other', 'default' => $col['default'] ?? null, 'nullable' => (bool) ($col['nullable'] ?? true)];

        if (!empty($col['enum'])) {
            return $base + ['kind' => 'enum', 'complete' => true, 'values' => array_map(fn ($v) => ['value' => $v, 'count' => null, 'label' => $labels[$v] ?? null], $col['enum'])];
        }
        if (($col['family'] ?? '') === 'boolean') {
            return $base + ['kind' => 'boolean', 'complete' => true, 'values' => [
                ['value' => 1, 'count' => null, 'label' => $labels['1'] ?? 'Yes'], ['value' => 0, 'count' => null, 'label' => $labels['0'] ?? 'No'],
            ]];
        }
        if (empty($col['categorical']) && !$labels) {
            throw new DataException('NOT_A_CHOICE', "“{$column}” is free text or a number, not a list of choices.");
        }

        $rows = $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $column) {
            $qc = $dialect->quoteIdentifier($column);
            $stmt = $pdo->query("SELECT v, COUNT(*) AS n FROM (SELECT {$qc} AS v FROM " . $dialect->quoteIdentifier($table) . " WHERE {$qc} IS NOT NULL LIMIT " . self::SAMPLE_ROWS . ') s GROUP BY v ORDER BY n DESC LIMIT ' . (self::MAX_CHOICES + 1));
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }, 4000);

        $values = [];
        foreach (array_slice($rows, 0, self::MAX_CHOICES) as $r) {
            $v = ($col['family'] ?? '') === 'integer' ? (int) $r['v'] : (string) $r['v'];
            $values[(string) $v] = ['value' => $v, 'count' => (int) $r['n'], 'label' => $labels[(string) $v] ?? null];
        }
        // Named by the owner but not used yet, and the column's default.
        foreach ($labels as $v => $l) {
            $values[(string) $v] ??= ['value' => ($col['family'] ?? '') === 'integer' && is_numeric($v) ? (int) $v : (string) $v, 'count' => 0, 'label' => $l];
        }
        $default = $col['default'] ?? null;
        if ($default !== null && !preg_match('/^(current_timestamp|now\(|null$)/i', (string) $default)) {
            $d = trim((string) $default, "'");
            $values[$d] ??= ['value' => ($col['family'] ?? '') === 'integer' && is_numeric($d) ? (int) $d : $d, 'count' => 0, 'label' => $labels[$d] ?? null];
        }
        uasort($values, fn ($a, $b) => is_numeric($a['value']) && is_numeric($b['value']) ? $a['value'] <=> $b['value'] : strnatcasecmp((string) $a['value'], (string) $b['value']));

        return $base + ['kind' => 'values', 'complete' => count($rows) <= self::MAX_CHOICES, 'sampled' => self::SAMPLE_ROWS, 'values' => array_values($values)];
    }

    /**
     * How well a column's stored values match the keys of one or more tables: up to 50 distinct values from a
     * bounded sample, and how many of them exist in each table. Helps the owner confirm or correct a link.
     */
    public function check(DbConnection $connection, string $table, string $column, array $refTables): array
    {
        $catalog = $this->schema->getCatalog($connection);
        $meta = $catalog['tables'][$table] ?? throw new DataException('TABLE_NOT_FOUND', "There is no table “{$table}” in this database.");
        $this->policy->assertCanReadTable($connection, $table);
        if (!isset($meta['columns'][$column]) || ColumnClassifier::classify($column)['class'] !== 'standard') {
            throw new DataException('UNKNOWN_COLUMN', "There is no column “{$column}” to check.");
        }
        $targets = [];
        foreach (array_slice(array_unique($refTables), 0, 4) as $rt) {
            $ref = $catalog['tables'][$rt] ?? null;
            if (!$ref || count($ref['primary_key'] ?? []) !== 1) {
                continue;
            }
            $this->policy->assertCanReadTable($connection, $rt);
            $targets[$rt] = $ref['primary_key'][0];
        }

        return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $column, $targets, $catalog) {
            $qc = $dialect->quoteIdentifier($column);
            $values = $pdo->query("SELECT v FROM (SELECT {$qc} AS v FROM " . $dialect->quoteIdentifier($table) . " WHERE {$qc} IS NOT NULL LIMIT 2000) s GROUP BY v LIMIT 50")->fetchAll(PDO::FETCH_COLUMN);
            $values = array_values(array_filter($values, fn ($v) => $v !== '' && (string) $v !== '0'));
            $out = ['table' => $table, 'column' => $column, 'sampled' => count($values), 'results' => []];
            foreach ($targets as $rt => $pk) {
                $fitting = array_values(array_filter($values, fn ($v) => self::fits($catalog['tables'][$rt]['columns'][$pk] ?? [], (string) $v)));
                $found = 0;
                if ($fitting) {
                    $stmt = $pdo->prepare('SELECT COUNT(*) FROM ' . $dialect->quoteIdentifier($rt) . ' WHERE ' . $dialect->quoteIdentifier($pk) . ' IN (' . implode(', ', array_fill(0, count($fitting), '?')) . ')');
                    $stmt->execute($fitting);
                    $found = (int) $stmt->fetchColumn();
                }
                $n = count($values);
                $out['results'][] = [
                    'ref_table' => $rt,
                    'found' => $found,
                    'sampled' => $n,
                    'verdict' => $n === 0 ? 'empty' : ($found === $n ? 'matches' : ($found === 0 ? 'no_match' : 'partly')),
                    'message' => $n === 0 ? "No values to compare yet: {$table}.{$column} is empty."
                        : ($found === $n ? "All {$n} sampled values exist in {$rt}." : "{$found} of {$n} sampled values exist in {$rt}."),
                ];
            }
            return $out;
        }, 5000);
    }

    /** "blog_categories" -> "blog category". */
    public static function thing(string $table): string
    {
        return Str::singular(str_replace(['_', '-'], ' ', strtolower($table)));
    }

    public static function isSlug(string $name, array $c): bool
    {
        return in_array($c['family'] ?? '', ['string', 'text'], true) && (strtolower($name) === 'slug' || str_ends_with(strtolower($name), '_slug'));
    }

    /** True when the value can be compared with this key column (no "abc" against an integer key). */
    private static function fits(array $keyCol, string $value): bool
    {
        return ($keyCol['family'] ?? '') !== 'integer' || preg_match('/^-?\d{1,19}$/', trim($value)) === 1;
    }

    private function findByLabel(DbConnection $connection, string $table, array $meta, string $name): mixed
    {
        $label = $meta['label_column'] ?? null;
        $pk = $meta['primary_key'][0] ?? null;
        if (!$label || !$pk) {
            return null;
        }
        return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $label, $pk, $name) {
            $stmt = $pdo->prepare('SELECT ' . $dialect->quoteIdentifier($pk) . ' FROM ' . $dialect->quoteIdentifier($table) . ' WHERE LOWER(' . $dialect->quoteIdentifier($label) . ') = LOWER(?) ORDER BY ' . $dialect->quoteIdentifier($pk) . ' LIMIT 1');
            $stmt->execute([$name]);
            $id = $stmt->fetchColumn();
            return $id === false ? null : (is_numeric($id) && (string) (int) $id === (string) $id ? (int) $id : $id);
        });
    }

    private function uniqueSlug(DbConnection $connection, string $table, string $col, array $c, string $slug): string
    {
        $max = (int) ($c['max_length'] ?? 0);
        $fit = fn (string $s) => $max > 0 ? mb_substr($s, 0, $max) : $s;
        return $this->connector->read($connection, function (PDO $pdo, $dialect) use ($table, $col, $slug, $fit) {
            $stmt = $pdo->prepare('SELECT 1 FROM ' . $dialect->quoteIdentifier($table) . ' WHERE ' . $dialect->quoteIdentifier($col) . ' = ? LIMIT 1');
            for ($i = 1; $i <= 50; $i++) {
                $candidate = $fit($i === 1 ? $slug : "{$slug}-{$i}");
                $stmt->execute([$candidate]);
                if (!$stmt->fetchColumn()) {
                    return $candidate;
                }
            }
            return $fit($slug . '-' . Str::lower(Str::random(6)));
        });
    }
}
