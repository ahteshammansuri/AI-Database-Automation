<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ConnectionColumnSetting;
use App\Models\DbConnection;
use App\Models\SchemaTableAnnotation;
use App\Services\Data\ColumnClassifier;
use App\Services\Data\DataException;
use App\Services\Data\LinkedRecords;
use App\Services\Data\LiveSchemaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * How a connection's tables link and how values read, as the owner sees and corrects them (Schema Explorer), and
 * the linked-row pickers of manual publishing and automation fields. Settings are platform data scoped to the
 * owner's connection; nothing is written to the customer's database. Reads of customer rows are limited, read-only
 * and never touch credential tables, secret or personal columns.
 */
class SchemaLinksController extends Controller
{
    private const NAME = '/^[A-Za-z0-9_$\-]{1,64}$/';

    public function __construct(
        private LiveSchemaService $schema,
        private LinkedRecords $linked,
    ) {}

    private function connection(Request $request, int $id): DbConnection
    {
        return DbConnection::where('user_id', $request->user()->id)->findOrFail($id);
    }

    /** The live table, readable on this connection. */
    private function table(DbConnection $connection, string $table): array
    {
        $meta = $this->schema->getCatalog($connection)['tables'][$table] ?? null;
        if (!$meta) {
            throw new DataException('TABLE_NOT_FOUND', "There is no table “{$table}” in this database.");
        }
        if (($meta['class'] ?? null) === 'blocked') {
            throw new DataException('TABLE_BLOCKED', "{$table} holds credentials or sessions and is never shown.");
        }
        return $meta;
    }

    private function setting(DbConnection $connection, string $table, string $column): ConnectionColumnSetting
    {
        return ConnectionColumnSetting::firstOrNew(
            ['connection_id' => $connection->id, 'table_name' => $table, 'column_name' => $column],
            ['user_id' => $connection->user_id, 'link_mode' => 'auto'],
        );
    }

    /** Linked-row picker for manual publishing and automation fields (publishing rules decide what may be created). */
    public function options(Request $request, int $id): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $v = $request->validate([
            'table' => ['required', 'string', 'regex:' . self::NAME],
            'column' => ['required', 'string', 'regex:' . self::NAME],
            'q' => 'nullable|string|max:200',
            'selected' => 'nullable|string|max:200',
        ]);
        $this->table($connection, $v['table']);
        return response()->json($this->linked->options($connection, $v['table'], $v['column'], (string) ($v['q'] ?? ''), 'publish', $v['selected'] ?? null));
    }

    /** The values a status-like column uses (manual publishing, automation fixed values). */
    public function values(Request $request, int $id): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $v = $request->validate(['table' => ['required', 'string', 'regex:' . self::NAME], 'column' => ['required', 'string', 'regex:' . self::NAME]]);
        $this->table($connection, $v['table']);
        return response()->json($this->linked->valueChoices($connection, $v['table'], $v['column']));
    }

    /** The form for a new linked record with its details (manual publishing). */
    public function form(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $meta = $this->table($connection, $table);
        $names = array_keys(array_filter($meta['columns'], fn ($c, $name) => !ColumnClassifier::isSecret($name) && ($c['family'] ?? '') !== 'binary', ARRAY_FILTER_USE_BOTH));
        return response()->json([
            'table' => $table,
            'thing' => LinkedRecords::thing($table),
            'primary_key' => $meta['primary_key'] ?? [],
            'label_column' => $meta['label_column'] ?? null,
            'columns' => $this->linked->columnsFor($meta, $names),
            'create' => $this->linked->createInfo($connection, $this->schema->getCatalog($connection), $table, 'publish'),
        ]);
    }

    /** Check a new linked record without saving anything. */
    public function validateRow(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $this->table($connection, $table);
        $v = $request->validate(['values' => 'required|array|max:200']);
        $prepared = $this->linked->prepareParent($connection, $this->schema->getCatalog($connection), $table, $v['values'], 'publish');
        if ($prepared['errors']) {
            return response()->json(['message' => 'Fix the values marked in red.', 'row_errors' => [0 => $prepared['errors']]], 422);
        }
        return response()->json(['valid' => true, 'label' => $prepared['label'], 'existing' => $prepared['existing']]);
    }

    /**
     * Owner: confirm, change or remove the link of a column, or add one. auto = use what was found; link = this
     * column holds the key of ref_table; none = not a link. A key the database declares cannot be changed here.
     */
    public function setLink(Request $request, int $id, string $table, string $column): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $v = $request->validate([
            'mode' => 'required|in:auto,link,none',
            'ref_table' => ['required_if:mode,link', 'nullable', 'string', 'regex:' . self::NAME],
            'ref_column' => ['nullable', 'string', 'regex:' . self::NAME],
        ], ['mode.in' => 'Choose automatic, a table, or not a link.', 'ref_table.required_if' => 'Choose the table this column points to.']);
        $catalog = $this->schema->getCatalog($connection);
        $meta = $this->table($connection, $table);
        $col = $meta['columns'][$column] ?? null;
        if (!$col) {
            return response()->json(['message' => "There is no column “{$column}” in {$table}."], 422);
        }
        foreach ($meta['foreign_keys'] ?? [] as $fk) {
            if (($fk['columns'] ?? []) === [$column] && ($fk['source'] ?? null) === 'declared') {
                return response()->json(['message' => "The database itself declares where {$column} points ({$fk['ref_table']}), so it cannot be changed here."], 422);
            }
        }

        $refTable = null;
        $refColumn = null;
        if ($v['mode'] === 'link') {
            $refTable = $v['ref_table'];
            $ref = $catalog['tables'][$refTable] ?? null;
            if (!$ref) {
                return response()->json(['message' => "There is no table “{$refTable}”.", 'errors' => ['ref_table' => ["There is no table “{$refTable}”."]]], 422);
            }
            if (($ref['class'] ?? null) === 'blocked') {
                return response()->json(['message' => "{$refTable} holds credentials or sessions; nothing links to it here.", 'errors' => ['ref_table' => ["{$refTable} holds credentials or sessions."]]], 422);
            }
            $refColumn = ($v['ref_column'] ?? null) ?: ($ref['primary_key'][0] ?? null);
            $keys = array_merge([$ref['primary_key'] ?? []], array_values($ref['unique_keys'] ?? []));
            if (!$refColumn || !in_array([$refColumn], $keys, true)) {
                return response()->json(['message' => "A link must point at a column of {$refTable} that identifies one row (its key or a unique column).", 'errors' => ['ref_column' => ['Choose the key of the table.']]], 422);
            }
            $fam = fn ($f) => $f === 'integer' ? 'integer' : (in_array($f, ['string', 'uuid'], true) ? 'string' : $f);
            if ($fam($col['family'] ?? '') !== $fam($ref['columns'][$refColumn]['family'] ?? '')) {
                return response()->json(['message' => "{$column} holds " . ($col['family'] ?? 'other') . " values but {$refTable}.{$refColumn} is " . ($ref['columns'][$refColumn]['family'] ?? 'other') . ', so they can never match.', 'errors' => ['ref_table' => ['The types do not match.']]], 422);
            }
        }

        $setting = $this->setting($connection, $table, $column);
        $before = $setting->exists ? $setting->link_mode . ($setting->ref_table ? " {$setting->ref_table}.{$setting->ref_column}" : '') : 'auto';
        $setting->fill(['link_mode' => $v['mode'], 'ref_table' => $refTable, 'ref_column' => $refColumn]);
        if ($v['mode'] === 'auto' && empty($setting->value_labels)) {
            if ($setting->exists) {
                $setting->delete();
            }
        } else {
            $setting->save();
        }
        $this->schema->forget($connection);

        AuditLog::log($request->user()->id, 'CONNECTION_COLUMN_LINK_CHANGED', 'DbConnection', (string) $connection->id, [
            'table' => $table, 'column' => $column, 'before' => $before, 'after' => $v['mode'] . ($refTable ? " {$refTable}.{$refColumn}" : ''),
        ]);

        return response()->json([
            'link' => $this->currentLink($connection, $table, $column),
            'message' => match ($v['mode']) {
                'link' => "{$table}.{$column} now points to {$refTable}.",
                'none' => "{$table}.{$column} is no longer treated as a link.",
                default => "{$table}.{$column} uses the automatic link again.",
            },
        ]);
    }

    /** Owner: names for the stored values of a status-like column ({"1": "Published", "0": "Draft"}). */
    public function setValueLabels(Request $request, int $id, string $table, string $column): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $v = $request->validate(['labels' => 'present|array|max:50', 'labels.*' => 'nullable|string|max:60'], ['labels.*.max' => 'Keep each name under 60 characters.']);
        $meta = $this->table($connection, $table);
        if (!isset($meta['columns'][$column]) || ColumnClassifier::classify($column)['class'] !== 'standard') {
            return response()->json(['message' => "Values of “{$column}” cannot be named."], 422);
        }
        $labels = [];
        foreach ($v['labels'] as $value => $name) {
            $value = trim((string) $value);
            $name = trim((string) $name);
            if ($value !== '' && $name !== '' && mb_strlen($value) <= 64) {
                $labels[$value] = $name;
            }
        }
        $setting = $this->setting($connection, $table, $column);
        $setting->value_labels = $labels ?: null;
        if (!$labels && $setting->link_mode === 'auto') {
            if ($setting->exists) {
                $setting->delete();
            }
        } else {
            $setting->save();
        }
        $this->schema->forget($connection);
        AuditLog::log($request->user()->id, 'CONNECTION_VALUE_NAMES_CHANGED', 'DbConnection', (string) $connection->id, ['table' => $table, 'column' => $column, 'values' => count($labels)]);

        return response()->json(['labels' => (object) $labels, 'message' => $labels ? 'Value names saved.' : 'Value names removed.']);
    }

    /** Owner: the column that names this table's rows in every picker (null = automatic). */
    public function setDisplayColumn(Request $request, int $id, string $table): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $v = $request->validate(['column' => ['nullable', 'string', 'regex:' . self::NAME]]);
        $meta = $this->table($connection, $table);
        $column = $v['column'] ?? null;
        if ($column !== null) {
            $c = $meta['columns'][$column] ?? null;
            if (!$c || !in_array($c['family'] ?? '', ['string', 'text'], true) || ColumnClassifier::classify($column)['class'] !== 'standard') {
                return response()->json(['message' => 'Choose a text column that is not secret or personal.', 'errors' => ['column' => ['Choose a text column that is not secret or personal.']]], 422);
            }
        }
        SchemaTableAnnotation::updateOrCreate(
            ['user_id' => $connection->user_id, 'connection_id' => $connection->id, 'table_name' => $table],
            ['display_column' => $column],
        );
        $this->schema->forget($connection);
        AuditLog::log($request->user()->id, 'CONNECTION_DISPLAY_COLUMN_CHANGED', 'DbConnection', (string) $connection->id, ['table' => $table, 'column' => $column]);
        $label = $this->schema->getCatalog($connection)['tables'][$table]['label_column'] ?? null;

        return response()->json(['label_column' => $label, 'display_column' => $column, 'message' => $column ? "Rows of {$table} are now shown by {$column}." : "Rows of {$table} are named automatically again."]);
    }

    /** How well a column's values match the key of one or more tables (bounded sample, read-only). */
    public function check(Request $request, int $id): JsonResponse
    {
        $connection = $this->connection($request, $id);
        $v = $request->validate([
            'table' => ['required', 'string', 'regex:' . self::NAME],
            'column' => ['required', 'string', 'regex:' . self::NAME],
            'ref_tables' => 'required|array|min:1|max:4',
            'ref_tables.*' => ['string', 'regex:' . self::NAME],
        ]);
        $this->table($connection, $v['table']);
        return response()->json($this->linked->check($connection, $v['table'], $v['column'], $v['ref_tables']));
    }

    private function currentLink(DbConnection $connection, string $table, string $column): ?array
    {
        foreach ($this->schema->getCatalog($connection)['tables'][$table]['foreign_keys'] ?? [] as $fk) {
            if (($fk['columns'] ?? []) === [$column]) {
                return ['foreign_key' => $column, 'referenced_table' => $fk['ref_table'], 'referenced_column' => $fk['ref_columns'][0],
                    'source' => $fk['source'], 'enforced' => $fk['enforced'], 'rule' => $fk['rule'], 'reason' => $fk['reason'], 'alternatives' => $fk['alternatives']];
            }
        }
        return null;
    }
}
