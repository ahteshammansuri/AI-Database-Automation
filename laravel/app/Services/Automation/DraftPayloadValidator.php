<?php

namespace App\Services\Automation;

/**
 * Checks values an editor changed in a draft or a published record, column by column, before anything is saved
 * or written: no new columns, required columns stay filled, numbers stay numbers, text fits the column.
 * Column facts come from the write plan recorded when the content was generated. The database write path
 * (SafeDatabaseExecutor) still validates against the live table.
 */
class DraftPayloadValidator
{
    /**
     * @param  array  $payload   Values submitted by the editor.
     * @param  array  $original  The values that were there before (only these columns may be edited).
     * @param  array  $columns   write_plan.columns entries: ['column' => ..., 'type' => 'varchar(255)', 'required' => bool].
     * @param  string[]  $relationColumns  Linked columns: they may hold a record's name (resolved when published), so no number check.
     * @return array<string, string[]>  Messages keyed "payload.<column>" (empty when everything is valid).
     */
    public static function errors(array $payload, array $original, array $columns, array $relationColumns = []): array
    {
        $byName = [];
        foreach ($columns as $c) {
            if (isset($c['column'])) {
                $byName[$c['column']] = $c;
            }
        }

        $errors = [];
        foreach ($payload as $key => $value) {
            $key = (string) $key;
            if (!array_key_exists($key, $original)) {
                $errors["payload.{$key}"] = ["'{$key}' is not part of this draft, so it cannot be added here."];
                continue;
            }
            if (is_array($value) && !is_array($original[$key])) {
                $errors["payload.{$key}"] = ["{$key} must be a single value."];
                continue;
            }
            $c = $byName[$key] ?? null;
            if (!$c || is_array($value)) {
                continue;
            }
            $blank = $value === null || (is_string($value) && trim($value) === '');
            $type = strtolower((string) ($c['type'] ?? ''));
            if ($blank) {
                if (!empty($c['required'])) {
                    $errors["payload.{$key}"] = ["{$key} is required."];
                }
                continue;
            }
            if (in_array($key, $relationColumns, true)) {
                continue;
            }
            if (preg_match('/^(tinyint|smallint|mediumint|int|integer|bigint)\b/', $type) && !preg_match('/^-?\d+$/', trim((string) $value))) {
                $errors["payload.{$key}"] = ["{$key} must be a whole number."];
            } elseif (preg_match('/^(decimal|float|double|numeric|real)\b/', $type) && !is_numeric($value)) {
                $errors["payload.{$key}"] = ["{$key} must be a number."];
            } elseif (preg_match('/^(varchar|char)\((\d+)\)/', $type, $m) && mb_strlen((string) $value) > (int) $m[2]) {
                $errors["payload.{$key}"] = ["{$key} must be {$m[2]} characters or fewer (now " . mb_strlen((string) $value) . ').'];
            }
        }

        return $errors;
    }

    /** Columns filled from a linked table, as recorded in a version's meta. */
    public static function relationColumns(?array $meta): array
    {
        $cols = array_keys(is_array($meta['relation_options'] ?? null) ? $meta['relation_options'] : []);
        foreach (array_merge($meta['write_plan']['relations'] ?? [], $meta['relations'] ?? []) as $r) {
            if (is_array($r) && isset($r['column'])) {
                $cols[] = (string) $r['column'];
            }
        }
        return array_values(array_unique($cols));
    }

    /** The meta of the newest version that recorded a write plan. */
    public static function metaFor(iterable $versions): array
    {
        $list = is_array($versions) ? $versions : iterator_to_array($versions);
        foreach (array_reverse($list) as $v) {
            if (!empty($v->meta['write_plan']['columns'])) {
                return $v->meta;
            }
        }
        return [];
    }
}
