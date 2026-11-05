<?php

namespace App\Services\Data;

use App\Models\ConnectionColumnSetting;
use App\Models\DbConnection;
use App\Models\SchemaTableAnnotation;
use App\Services\Data\Dialects\MySqlDialect;

/**
 * The one place that decides how a connection's tables link to each other: declared foreign keys, links detected
 * from names (RelationInference) and the owner's own settings. The live catalog (Data page, link checks, delete
 * impact, AI sample rows and questions, automations and manual publishing) and the stored schema snapshot (Schema
 * Explorer) are both decorated here, so every screen shows and enforces the same links.
 */
class SchemaRelations
{
    /**
     * The owner's settings for a connection.
     *
     * @return array{links: array<string, array<string, array{mode: string, ref_table: ?string, ref_column: ?string}>>, values: array<string, array<string, array<string, string>>>, display: array<string, string>}
     */
    public function settings(DbConnection $connection): array
    {
        $links = [];
        $values = [];
        foreach (ConnectionColumnSetting::where('connection_id', $connection->id)->where('user_id', $connection->user_id)->get() as $s) {
            $t = strtolower($s->table_name);
            $c = strtolower($s->column_name);
            if (in_array($s->link_mode, ['link', 'none'], true)) {
                $links[$t][$c] = ['mode' => $s->link_mode, 'ref_table' => $s->ref_table, 'ref_column' => $s->ref_column];
            }
            if (!empty($s->value_labels)) {
                $values[$t][$c] = array_map('strval', (array) $s->value_labels);
            }
        }
        $display = SchemaTableAnnotation::where('connection_id', $connection->id)->where('user_id', $connection->user_id)
            ->whereNotNull('display_column')->pluck('display_column', 'table_name')
            ->mapWithKeys(fn ($col, $table) => [strtolower($table) => (string) $col])->all();

        return ['links' => $links, 'values' => $values, 'display' => $display];
    }

    /**
     * Live catalog (LiveSchemaService) with the effective links on every table and in the catalog, each table's
     * label column, and per column the owner's value names and whether it is offered as a list of choices.
     */
    public function decorateCatalog(DbConnection $connection, array $catalog): array
    {
        $settings = $this->settings($connection);
        $insights = app(TableInsightService::class)->forConnection($connection);
        $declared = array_values(array_filter($catalog['foreign_keys'] ?? [], fn ($fk) => ($fk['source'] ?? 'declared') === 'declared'));
        $links = RelationInference::resolve($catalog['tables'] ?? [], $declared, $settings['links'], self::aiLinks($insights));

        $byColumn = [];
        foreach ($catalog['tables'] as $name => $meta) {
            $catalog['tables'][$name]['foreign_keys'] = [];
        }
        $all = [];
        foreach ($links as $l) {
            $fk = self::catalogLink($l);
            if (isset($catalog['tables'][$l['table']])) {
                $catalog['tables'][$l['table']]['foreign_keys'][] = $fk;
            }
            if (count($l['columns']) === 1) {
                $byColumn[$l['table']][$l['column']] = true;
            }
            $all[] = $fk;
        }
        $catalog['foreign_keys'] = $all;

        foreach ($catalog['tables'] as $name => $meta) {
            $lt = strtolower($name);
            $ai = $insights[$name] ?? null;
            $catalog['tables'][$name]['label_column'] = $this->displayColumn($settings['display'][$lt] ?? null, $meta['columns'] ?? [])
                ?? RelationInference::labelColumn($name, $meta['columns'] ?? []);
            $catalog['tables'][$name]['ai'] = self::tableAi($ai);
            foreach ($meta['columns'] ?? [] as $col => $c) {
                $isPk = in_array($col, (array) ($meta['primary_key'] ?? []), true);
                $read = $ai['columns'][$col] ?? null;
                [$labels, $source] = self::valueLabels($settings['values'][$lt][strtolower($col)] ?? [], $read);
                $catalog['tables'][$name]['columns'][$col]['value_labels'] = $labels;
                $catalog['tables'][$name]['columns'][$col]['value_labels_source'] = $source;
                $catalog['tables'][$name]['columns'][$col]['ai_role'] = $read['role'] ?? null;
                $catalog['tables'][$name]['columns'][$col]['ai_meaning'] = $read['meaning'] ?? null;
                $catalog['tables'][$name]['columns'][$col]['categorical'] = !$isPk && empty($byColumn[$name][$col]) && empty($c['enum'])
                    && (RelationInference::isCategorical((string) $col, $c) || self::codedByAi($read, $c, (string) $col));
            }
        }

        return $catalog;
    }

    /** Effective links of one live table, by column (single-column links only). */
    public function linksByColumn(array $tableMeta): array
    {
        $out = [];
        foreach ($tableMeta['foreign_keys'] ?? [] as $fk) {
            if (count($fk['columns'] ?? []) === 1) {
                $out[$fk['columns'][0]] = $fk;
            }
        }
        return $out;
    }

    /**
     * Stored schema snapshot (SchemaIntrospectionService, MySQL) with the same effective links: each table's
     * relationships list, and per column its link, the owner's setting, value names and whether it is a choice list.
     */
    public function decorateSnapshot(DbConnection $connection, array $payload): array
    {
        $settings = $this->settings($connection);
        $dialect = new MySqlDialect();
        $tables = [];
        $declared = [];
        foreach ($payload['tables'] ?? [] as $t) {
            $name = (string) ($t['name'] ?? ($t['table_name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $cols = [];
            $pk = [];
            foreach ($t['columns'] ?? [] as $c) {
                $cols[$c['name']] = [
                    'family' => $dialect->typeFamily(['data_type' => $c['data_type'] ?? '', 'raw_type' => $c['type'] ?? '']),
                    'max_length' => $c['max_length'] ?? null,
                    'nullable' => (bool) ($c['is_nullable'] ?? $c['nullable'] ?? true),
                    'default' => $c['default'] ?? null,
                    'enum' => $c['enum_values'] ?? [],
                ];
                if (!empty($c['is_primary_key'])) {
                    $pk[] = $c['name'];
                }
            }
            $tables[$name] = ['kind' => 'table', 'primary_key' => $pk, 'columns' => $cols];
            foreach ($t['relationships'] ?? [] as $r) {
                if (($r['source'] ?? 'declared') !== 'declared' || empty($r['foreign_key']) || empty($r['referenced_table'])) {
                    continue;
                }
                $declared[] = ['table' => $name, 'columns' => [$r['foreign_key']], 'ref_table' => $r['referenced_table'], 'ref_columns' => [$r['referenced_column'] ?? 'id']];
            }
        }

        $insights = app(TableInsightService::class)->forConnection($connection);
        $byTable = [];
        foreach (RelationInference::resolve($tables, $declared, $settings['links'], self::aiLinks($insights)) as $l) {
            $byTable[$l['table']][] = $l;
        }

        foreach ($payload['tables'] ?? [] as $i => $t) {
            $name = (string) ($t['name'] ?? ($t['table_name'] ?? ''));
            if (!isset($tables[$name])) {
                continue;
            }
            $lt = strtolower($name);
            $links = [];
            foreach ($byTable[$name] ?? [] as $l) {
                $links[$l['column']] = $l;
            }
            $payload['tables'][$i]['relationships'] = array_values(array_map(fn ($l) => [
                'foreign_key' => $l['column'],
                'referenced_table' => $l['ref_table'],
                'referenced_column' => $l['ref_column'],
                'source' => $l['source'],
                'enforced' => $l['enforced'],
                'rule' => $l['rule'],
                'reason' => $l['reason'],
                'alternatives' => $l['alternatives'],
            ], $byTable[$name] ?? []));
            $payload['tables'][$i]['label_column'] = $this->displayColumn($settings['display'][$lt] ?? null, $tables[$name]['columns'])
                ?? RelationInference::labelColumn($name, $tables[$name]['columns']);
            $payload['tables'][$i]['display_column'] = $settings['display'][$lt] ?? null;
            $ai = $insights[$name] ?? null;
            $payload['tables'][$i]['ai'] = self::tableAi($ai);
            foreach ($t['columns'] ?? [] as $j => $c) {
                $col = $c['name'];
                $meta = $tables[$name]['columns'][$col];
                $link = $links[$col] ?? null;
                $read = $ai['columns'][$col] ?? null;
                [$labels, $source] = self::valueLabels($settings['values'][$lt][strtolower($col)] ?? [], $read);
                $payload['tables'][$i]['columns'][$j]['is_foreign_key'] = $link !== null;
                $payload['tables'][$i]['columns'][$j]['link_setting'] = $settings['links'][$lt][strtolower($col)]['mode'] ?? 'auto';
                $payload['tables'][$i]['columns'][$j]['value_labels'] = $labels;
                $payload['tables'][$i]['columns'][$j]['value_labels_source'] = $source;
                $payload['tables'][$i]['columns'][$j]['ai_role'] = $read['role'] ?? null;
                $payload['tables'][$i]['columns'][$j]['ai_meaning'] = $read['meaning'] ?? null;
                $payload['tables'][$i]['columns'][$j]['categorical'] = $link === null && empty($c['is_primary_key']) && empty($meta['enum'])
                    && (RelationInference::isCategorical($col, $meta) || self::codedByAi($read, $meta, $col));
            }
        }

        return $payload;
    }

    /** Links the customer's model read (id columns that point to another table), in RelationInference's shape. */
    private static function aiLinks(array $insights): array
    {
        $out = [];
        foreach ($insights as $table => $i) {
            foreach ((array) ($i['columns'] ?? []) as $col => $c) {
                if (!empty($c['references_table'])) {
                    $out[strtolower($table)][strtolower($col)] = ['ref_table' => $c['references_table'], 'meaning' => $c['meaning'] ?? '', 'role' => $c['role'] ?? null];
                }
            }
        }
        return $out;
    }

    /** Value names: the owner's, else those the model gave (and which they are). */
    private static function valueLabels(array $owner, ?array $read): array
    {
        if ($owner) {
            return [$owner, 'owner'];
        }
        $ai = (array) ($read['value_names'] ?? []);
        return $ai ? [array_map('strval', $ai), 'ai'] : [[], null];
    }

    /** The model read the column as a coded state, kind or switch and saw a short list of values. */
    private static function codedByAi(?array $read, array $c, string $column): bool
    {
        return $read && in_array($read['role'] ?? '', ['status', 'type', 'flag'], true) && !empty($read['values'])
            && in_array($c['family'] ?? '', ['integer', 'string'], true) && ColumnClassifier::classify($column)['class'] === 'standard';
    }

    /** What the UI says about the model's reading of a table. */
    private static function tableAi(?array $ai): ?array
    {
        return $ai ? ['status' => $ai['status'], 'source' => $ai['source'], 'summary' => $ai['summary'], 'analyzed_at' => $ai['analyzed_at']] : null;
    }

    /** The owner's display column when it still exists and may name rows (text, not secret, not personal). */
    private function displayColumn(?string $wanted, array $columns): ?string
    {
        if ($wanted === null || !isset($columns[$wanted])) {
            return null;
        }
        $c = $columns[$wanted];
        return in_array($c['family'] ?? '', ['string', 'text'], true) && ColumnClassifier::classify($wanted)['class'] === 'standard' ? $wanted : null;
    }

    /** A link in the catalog's foreign-key shape (kept compatible with every existing reader). */
    private static function catalogLink(array $l): array
    {
        return [
            'name' => $l['name'] ?? null,
            'table' => $l['table'],
            'from_table' => $l['table'],
            'columns' => $l['columns'],
            'from_columns' => $l['columns'],
            'ref_table' => $l['ref_table'],
            'to_table' => $l['ref_table'],
            'ref_columns' => $l['ref_columns'],
            'to_columns' => $l['ref_columns'],
            'on_delete' => $l['on_delete'],
            'on_update' => $l['on_update'] ?? 'NOT ENFORCED',
            'column' => $l['column'],
            'ref_column' => $l['ref_column'],
            'source' => $l['source'],
            'enforced' => $l['enforced'],
            'rule' => $l['rule'],
            'reason' => $l['reason'],
            'alternatives' => $l['alternatives'],
        ];
    }
}
