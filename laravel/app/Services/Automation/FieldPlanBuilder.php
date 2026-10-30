<?php

namespace App\Services\Automation;

use App\Models\Automation;
use App\Models\DbConnection;
use App\Services\Data\DataAccessPolicy;
use App\Services\DatabaseSafetyService;
use PDO;

/**
 * Turns a table's live schema plus an automation's field mappings into a per-column plan.
 *
 * Stored mapping (one per column):
 *   { field_name, mapping_type, fixed_value?, source_field?, relation_config?: {referenced_table,
 *     referenced_column, creation_policy}, instructions? }
 * mapping_type: AI_GENERATED | FIXED_VALUE | RELATIONAL_LOOKUP | DERIVED_SLUG | RUNTIME_NOW |
 *               LEAVE_EMPTY | DB_DEFAULT
 *
 * Resolved source (what actually happens):
 *   ai_text        AI writes the value (title, body, summary, SEO fields ...)
 *   ai_relation    AI picks a parent by name: reuse an existing record, or create one if allowed
 *   ai_image       an image is generated for the content and its URL/path stored
 *   fixed          a constant value
 *   fixed_relation always the chosen existing parent record
 *   slug           derived from the title, made unique at write time
 *   now            the publication time
 *   empty          NULL
 *   db_default     column left out of the INSERT so the database default applies
 */
class FieldPlanBuilder
{
    public const MAPPING_TYPES = ['AI_GENERATED', 'FIXED_VALUE', 'RELATIONAL_LOOKUP', 'RELATIONSHIP_LOOKUP', 'DERIVED_SLUG', 'RUNTIME_NOW', 'LEAVE_EMPTY', 'DB_DEFAULT'];

    /** How many existing parent names are offered to the model when it picks a parent. */
    /** Default; the live value is the admin setting automation.relation_options. */
    private const RELATION_OPTION_LIMIT = 40;

    public function __construct(
        protected TargetTableInspector $inspector,
        protected DatabaseSafetyService $safety,
        protected DataAccessPolicy $accessPolicy,
    ) {}

    /**
     * Column metadata plus a suggested mapping for every writable column, for the builder UI.
     */
    public function suggest(DbConnection $connection, PDO $pdo, string $table): array
    {
        $info = $this->inspector->describeFor($connection, $pdo, $table);
        if ($info === null) {
            throw new \Exception("Table '{$table}' was not found in '{$connection->database_name}'.");
        }

        $titleCol = $this->firstOfKind($info, 'title');
        $valueNames = app(\App\Services\Data\SchemaRelations::class)->settings($connection)['values'][strtolower($table)] ?? [];
        $dialect = new \App\Services\Data\Dialects\MySqlDialect();
        $columns = [];
        foreach ($info['columns'] as $name => $c) {
            if ($c['auto_increment'] || $c['generated']) {
                continue;
            }
            $relation = $c['foreign_key'] ? $this->relationInfo($connection, $pdo, $c) : null;
            $family = $dialect->typeFamily(['data_type' => $c['data_type'], 'raw_type' => $c['column_type']]);
            $columns[] = [
                'name' => $name,
                'type' => $c['column_type'],
                'data_type' => $c['data_type'],
                'kind' => $c['kind'],
                'nullable' => $c['nullable'],
                'required' => $c['required'],
                'has_default' => $c['has_default'],
                'default' => $c['default'],
                'max_length' => $c['max_length'],
                'enum_values' => $c['enum_values'],
                'is_unique' => $c['is_unique'],
                'is_secret' => $c['is_secret'],
                'relation' => $relation,
                'family' => $family,
                // A status-like column: its fixed value is chosen from the values it already holds.
                'categorical' => !$relation && !$c['enum_values'] && \App\Services\Data\RelationInference::isCategorical($name, ['family' => $family, 'max_length' => $c['max_length']]),
                'value_labels' => (object) ($valueNames[strtolower($name)] ?? []),
                'suggested' => $this->suggestMapping($c, $relation, $titleCol),
            ];
        }

        return [
            'table' => $table,
            'primary_key' => $info['primary_key'],
            'title_column' => $titleCol,
            'columns' => $columns,
        ];
    }

    /**
     * Runtime plan for generation/preview: one entry per mapped, writable column.
     *
     * @return array{table: string, info: array, fields: array<string, array>, issues: array}
     */
    public function build(Automation $automation, DbConnection $connection, PDO $pdo): array
    {
        $table = $automation->target_table;
        $info = $this->inspector->describeFor($connection, $pdo, $table);
        if ($info === null) {
            throw new \Exception("Target table '{$table}' was not found in '{$connection->database_name}'.");
        }

        $mappings = self::normalizeMappings($automation->field_mappings ?? []);
        $titleCol = $this->firstOfKind($info, 'title');
        $manual = $automation->operation_mode === 'MANUAL_SCHEDULE';

        $fields = [];
        $issues = [];
        foreach ($mappings as $column => $m) {
            $c = $info['columns'][$column] ?? null;
            if ($c === null) {
                $issues[] = ['level' => 'error', 'column' => $column, 'message' => "Column `{$column}` no longer exists in `{$table}`. Remove it from the mapping."];
                continue;
            }
            if ($c['is_secret']) {
                $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$column}` holds secrets and can never be written by an automation."];
                continue;
            }
            if ($c['auto_increment'] || $c['generated']) {
                continue;
            }

            $source = self::resolveSource($m['mapping_type'], $c);
            if ($manual && in_array($source, ['ai_text', 'ai_relation', 'ai_image'], true)) {
                $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$column}` is set to AI, but this automation has AI turned off. Give it a fixed value."];
                continue;
            }

            $field = [
                'column' => $column,
                'kind' => $c['kind'],
                'source' => $source,
                'mapping' => $m,
                'meta' => $c,
            ];

            if (in_array($source, ['ai_relation', 'fixed_relation'], true)) {
                $relation = $c['foreign_key'] ? $this->relationInfo($connection, $pdo, $c, $source === 'ai_relation') : null;
                if ($relation === null) {
                    $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$column}` is not a foreign key, so it cannot be linked to another table."];
                    continue;
                }
                if ($source === 'ai_relation' && $relation['protected']) {
                    $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$relation['table']}` is a protected table, so AI cannot choose its records. Pick a fixed record for `{$column}`."];
                    continue;
                }
                $wantsCreate = strtoupper((string) ($m['relation_config']['creation_policy'] ?? 'CREATE_IF_MISSING')) === 'CREATE_IF_MISSING';
                $relation['allow_create'] = $source === 'ai_relation' && $wantsCreate && $relation['can_create'];
                $field['relation'] = $relation;
                if ($source === 'ai_relation' && $relation['label_column'] === null) {
                    $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$relation['table']}` has no name or title column, so AI cannot choose a record by name. Pick a fixed record for `{$column}` instead."];
                    continue;
                }
                if ($source === 'ai_relation' && !$relation['allow_create'] && $relation['existing_count'] === 0) {
                    $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$relation['table']}` is empty and new records cannot be created there" . ($relation['create_blocked_reason'] ? " ({$relation['create_blocked_reason']})" : '') . '.'];
                    continue;
                }
                if ($source === 'fixed_relation' && ($m['fixed_value'] === null || $m['fixed_value'] === '')) {
                    if (!$c['nullable']) {
                        $issues[] = ['level' => 'error', 'column' => $column, 'message' => "Choose which `{$relation['table']}` record `{$column}` should use."];
                        continue;
                    }
                    $field['source'] = 'empty';
                }
            }

            if ($source === 'slug') {
                $field['slug_source'] = $m['source_field'] && isset($info['columns'][$m['source_field']]) ? $m['source_field'] : $titleCol;
            }

            if ($source === 'fixed' && $c['kind'] === 'image' && is_string($m['fixed_value']) && $m['fixed_value'] !== ''
                && !preg_match('#^https?://#i', $m['fixed_value'])) {
                $issues[] = ['level' => 'error', 'column' => $column, 'message' => "`{$column}` must be an http(s) image URL."];
                continue;
            }

            $fields[$column] = $field;
        }

        return ['table' => $table, 'info' => $info, 'fields' => $fields, 'issues' => $issues];
    }

    /**
     * Normalise stored mappings (current list format or the legacy {column: "ai_generate"} map) to
     * column => {mapping_type, fixed_value, source_field, relation_config, instructions}.
     */
    public static function normalizeMappings(array $raw): array
    {
        $out = [];
        $isList = array_is_list($raw);
        foreach ($raw as $key => $m) {
            if (!$isList && is_string($m)) {
                $type = str_contains(strtolower($m), 'ai') ? 'AI_GENERATED' : 'FIXED_VALUE';
                $out[(string) $key] = ['mapping_type' => $type, 'fixed_value' => $type === 'FIXED_VALUE' ? $m : null, 'source_field' => null, 'relation_config' => [], 'instructions' => null];
                continue;
            }
            if (!is_array($m)) {
                continue;
            }
            $col = $m['field_name'] ?? $m['column'] ?? (is_string($key) ? $key : null);
            if (!$col) {
                continue;
            }
            $type = strtoupper((string) ($m['mapping_type'] ?? $m['source'] ?? 'FIXED_VALUE'));
            $type = match ($type) {
                'RELATIONSHIP_LOOKUP', 'RELATIONAL_LOOKUP' => 'RELATIONAL_LOOKUP',
                'RUNTIME_VALUE', 'DERIVED_SLUG' => 'DERIVED_SLUG',
                'AI_GENERATED', 'FIXED_VALUE', 'RUNTIME_NOW', 'LEAVE_EMPTY', 'DB_DEFAULT' => $type,
                default => 'FIXED_VALUE',
            };
            $out[(string) $col] = [
                'mapping_type' => $type,
                'fixed_value' => $m['fixed_value'] ?? $m['value'] ?? null,
                'source_field' => $m['source_field'] ?? null,
                'relation_config' => is_array($m['relation_config'] ?? null) ? $m['relation_config'] : [],
                'instructions' => isset($m['instructions']) ? mb_substr((string) $m['instructions'], 0, 500) : null,
            ];
        }
        return $out;
    }

    public static function resolveSource(string $mappingType, array $c): string
    {
        $isFk = (bool) $c['foreign_key'];
        return match ($mappingType) {
            'AI_GENERATED' => $isFk ? 'ai_relation' : match ($c['kind']) {
                'image' => 'ai_image',
                'slug' => 'slug',
                'datetime' => 'now',
                default => 'ai_text',
            },
            'RELATIONAL_LOOKUP' => $isFk ? 'fixed_relation' : 'fixed',
            'FIXED_VALUE' => $isFk ? 'fixed_relation' : 'fixed',
            'DERIVED_SLUG' => 'slug',
            'RUNTIME_NOW' => 'now',
            'LEAVE_EMPTY' => 'empty',
            'DB_DEFAULT' => 'db_default',
            default => 'fixed',
        };
    }

    /**
     * What a foreign key points at and what automations may do with it.
     */
    public function relationInfo(DbConnection $connection, PDO $pdo, array $c, bool $withOptions = true): ?array
    {
        $fk = $c['foreign_key'];
        if (!$fk) {
            return null;
        }
        $refTable = $fk['table'];
        $class = $this->accessPolicy->getTableClass($connection, $refTable);
        $refInfo = $class === 'blocked' ? null : $this->inspector->describeFor($connection, $pdo, $refTable);
        $labelCol = $refInfo ? TargetTableInspector::labelColumn($refInfo) : null;

        $blockedReason = null;
        $protected = $class !== 'writable' || $this->safety->isTableSensitive($refTable);
        if ($class === 'blocked') {
            $blockedReason = 'protected table';
        } elseif ($protected) {
            $blockedReason = 'protected table (accounts, roles, payments and similar are never created automatically)';
        } elseif ($labelCol === null) {
            $blockedReason = 'it has no name or title column';
        }

        $requiredOthers = [];
        if ($refInfo && $blockedReason === null) {
            $probe = (new ParentRowBuilder())->build($refInfo, 'Probe', null);
            foreach ($probe['issues'] as $issue) {
                if ($issue['level'] === 'error') {
                    $blockedReason = 'a new record would need values automations cannot fill: ' . ($issue['column'] ?? 'unknown');
                    break;
                }
            }
            foreach ($refInfo['columns'] as $n => $rc) {
                if ($rc['required'] && $n !== $labelCol) {
                    $requiredOthers[] = $n;
                }
            }
        }

        $count = 0;
        $options = [];
        if ($refInfo) {
            try {
                $count = (int) $pdo->query("SELECT COUNT(*) FROM `{$refTable}`")->fetchColumn();
                if ($withOptions && $labelCol) {
                    $stmt = $pdo->query("SELECT `{$labelCol}` FROM `{$refTable}` WHERE `{$labelCol}` IS NOT NULL AND `{$labelCol}` <> '' ORDER BY `{$fk['column']}` ASC LIMIT " . max(5, (int) config('automation.relation_options', self::RELATION_OPTION_LIMIT)));
                    $options = array_values(array_unique(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN))));
                }
            } catch (\Throwable) {
                // Counting is informational only.
            }
        }

        return [
            'table' => $refTable,
            'column' => $fk['column'],
            'source' => $fk['source'] ?? 'declared',
            'label_column' => $labelCol,
            'entity' => \Illuminate\Support\Str::singular(str_replace('_', ' ', $refTable)),
            'existing_count' => $count,
            'options' => $options,
            'can_create' => $blockedReason === null,
            'create_blocked_reason' => $blockedReason,
            'protected' => $protected,
            'parent_required_columns' => $requiredOthers,
        ];
    }

    private function firstOfKind(array $info, string $kind): ?string
    {
        foreach ($info['columns'] as $name => $c) {
            if ($c['kind'] === $kind && !$c['foreign_key']) {
                return $name;
            }
        }
        return null;
    }

    /**
     * Sensible default per column so a new automation works with no edits in the common case.
     */
    private function suggestMapping(array $c, ?array $relation, ?string $titleCol): array
    {
        $name = $c['name'];
        $base = ['field_name' => $name];

        if ($c['is_secret']) {
            return $base + ['mapping_type' => 'DB_DEFAULT', 'reason' => 'Protected column: never written.'];
        }
        if ($name === 'deleted_at') {
            return $base + ['mapping_type' => $c['nullable'] ? 'LEAVE_EMPTY' : 'DB_DEFAULT'];
        }

        if ($relation) {
            $aiCanPick = !$relation['protected'] && $relation['label_column'] && ($relation['can_create'] || $relation['existing_count'] > 0);
            if ($aiCanPick) {
                return $base + [
                    'mapping_type' => 'AI_GENERATED',
                    'relation_config' => [
                        'referenced_table' => $relation['table'],
                        'referenced_column' => $relation['column'],
                        'creation_policy' => $relation['can_create'] ? 'CREATE_IF_MISSING' : 'REUSE_EXISTING_ONLY',
                    ],
                ];
            }
            return $base + [
                'mapping_type' => $c['nullable'] ? 'LEAVE_EMPTY' : 'RELATIONAL_LOOKUP',
                'fixed_value' => null,
                'relation_config' => ['referenced_table' => $relation['table'], 'referenced_column' => $relation['column'], 'creation_policy' => 'REUSE_EXISTING_ONLY'],
            ];
        }

        switch ($c['kind']) {
            case 'image':
                return $base + ['mapping_type' => 'AI_GENERATED'];
            case 'slug':
                return $base + ['mapping_type' => 'DERIVED_SLUG', 'source_field' => $titleCol];
            case 'title':
            case 'summary':
            case 'body':
            case 'meta_title':
            case 'meta_description':
            case 'keywords':
                return $base + ['mapping_type' => 'AI_GENERATED'];
            case 'datetime':
                if (preg_match('/^(created|updated|published|publish|posted)(_at|_on|_date)?$|^(date|publish_date|post_date)$/', $name)) {
                    return $base + ['mapping_type' => 'RUNTIME_NOW'];
                }
                return $base + ['mapping_type' => $c['has_default'] ? 'DB_DEFAULT' : ($c['nullable'] ? 'LEAVE_EMPTY' : 'RUNTIME_NOW')];
            case 'enum':
                return $base + ['mapping_type' => 'FIXED_VALUE', 'fixed_value' => $this->preferredStatus($c)];
            case 'boolean':
                $on = preg_match('/(active|enabled|visible|published|public|status)/', $name) ? 1 : 0;
                return $base + ['mapping_type' => 'FIXED_VALUE', 'fixed_value' => $c['has_default'] && $c['default'] !== null && !$on ? (int) $c['default'] : $on];
            case 'number':
                return $base + ['mapping_type' => $c['has_default'] ? 'DB_DEFAULT' : ($c['nullable'] ? 'LEAVE_EMPTY' : 'FIXED_VALUE'), 'fixed_value' => 0];
            case 'url':
            case 'contact':
            case 'json':
                return $base + ['mapping_type' => $c['has_default'] ? 'DB_DEFAULT' : ($c['nullable'] ? 'LEAVE_EMPTY' : 'FIXED_VALUE'), 'fixed_value' => ''];
            default: // text
                if ($name === 'status' || str_ends_with($name, '_status')) {
                    return $base + ['mapping_type' => 'FIXED_VALUE', 'fixed_value' => 'published'];
                }
                if ($c['required']) {
                    return $base + ['mapping_type' => 'AI_GENERATED'];
                }
                return $base + ['mapping_type' => $c['has_default'] ? 'DB_DEFAULT' : 'LEAVE_EMPTY'];
        }
    }

    private function preferredStatus(array $c): ?string
    {
        foreach (['published', 'publish', 'active', 'live', 'public', 'enabled', 'approved'] as $want) {
            foreach ($c['enum_values'] as $opt) {
                if (strtolower($opt) === $want) {
                    return $opt;
                }
            }
        }
        if ($c['default'] !== null && in_array($c['default'], $c['enum_values'], true)) {
            return $c['default'];
        }
        return $c['enum_values'][0] ?? null;
    }
}
