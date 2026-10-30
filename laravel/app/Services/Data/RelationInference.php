<?php

namespace App\Services\Data;

use Illuminate\Support\Str;

/**
 * Finds the links between tables that the database does not declare, from column names and types only (no rows are
 * read), and merges them with the declared foreign keys and the owner's own settings into one list of effective links.
 *
 * Many real databases declare few or no foreign keys (blogs.category_id -> blog_categories, products.user_id -> users
 * are plain integers). A detected link is only proposed when a table with a single-column primary key of a compatible
 * type matches the column's name, tried in this order:
 *   self       parent_id -> the same table (a tree)
 *   key_name   the column is named like another table's own key (actor_id -> actor.actor_id, rgn_cd -> lkp_rgn.rgn_cd)
 *   scoped     the table's own prefix first: blogs.category_id -> blog_categories (before categories)
 *   name       category_id -> categories / category, pick_up_point_id -> pickup_points
 *   qualifier  the last part of the name: refund_note_id -> notes, sidebar_category_id -> categories
 *   role       author_id, owner_id, created_by ... -> users, when nothing else matches
 * Never proposed: pivots and views as targets, the row's own key, type mismatches, polymorphic pairs (subject_id with
 * subject_type) and names no table matches. Declared links always win; the owner can remove, change or add a link.
 *
 * Pure: no database or framework state, so it can be tested on its own.
 */
class RelationInference
{
    /** Column names that usually hold a person's id when no table matches the name itself. */
    private const ROLE_WORDS = [
        'author', 'owner', 'creator', 'editor', 'reviewer', 'approver', 'customer', 'buyer', 'seller', 'vendor', 'member',
        'employee', 'agent', 'sender', 'receiver', 'recipient', 'assignee', 'manager', 'admin', 'actor', 'poster',
        'publisher', 'writer', 'moderator', 'host', 'organizer', 'requester', 'reporter', 'student', 'teacher', 'driver',
    ];

    private const ROLE_TABLES = ['users', 'user', 'members', 'accounts', 'people', 'persons'];

    /** created_by, updated_by ... hold a user id without the _id suffix. */
    private const BY_COLUMN = '/^(created|updated|modified|deleted|approved|reviewed|assigned|edited|published|owned|added|requested)_by$/i';

    /** Key names that identify a row (acct_id, rgn_cd, sku_code), as opposed to natural keys such as order-number. */
    private const KEY_NAME = '/(^|[_-])(id|cd|code|key|no|num|nr)$/i';

    /** Copies kept next to the real table (orders_old, product-list_bck_17_10, orders-duplicate) are never link targets. */
    private const BACKUP_TABLE = '/(^|[_-])(old|bkp|bck|backup|bak|copy|dup|duplicate|tmp|archive|archived)([_-]|\d|$)|[_-]\d{1,2}[_-]\d{1,2}$/i';

    /** Names whose values are a short list of states or kinds (status, type, is_active ...). */
    private const CATEGORICAL_NAME = '/(^|_)(status|state|type|kind|level|priority|stage|mode|visibility|grade|tier|gender|role|flag|active|enabled|published|approved|verified|featured|visible)($|_)|^(is|has|can|should|show)_/i';

    /**
     * Every effective link of the schema, sorted by table and column.
     *
     * @param  array<string, array{kind?: string, primary_key?: list<string>, unique_keys?: array, columns: array<string, array>}>  $tables
     *         table => meta; each column has at least 'family' (integer, string, uuid, ...), optionally 'nullable', 'default'
     * @param  list<array{table: string, columns: list<string>, ref_table: string, ref_columns: list<string>, name?: string, on_delete?: string}>  $declared
     * @param  array<string, array<string, array{mode: string, ref_table?: ?string, ref_column?: ?string}>>  $overrides
     *         lower-case table => lower-case column => owner setting: mode 'none' (not a link) or 'link' (to ref_table.ref_column)
     * @return list<array{table: string, column: string, columns: list<string>, ref_table: string, ref_column: string, ref_columns: list<string>, source: string, enforced: bool, rule: string, reason: string, alternatives: list<string>, name?: string, on_delete: string, on_update?: string}>
     */
    public static function resolve(array $tables, array $declared, array $overrides = []): array
    {
        $lower = [];
        foreach ($tables as $name => $_) {
            $lower[strtolower($name)] = $name;
        }
        $targets = self::targets($tables);
        // Lookup by lower-case and by "squashed" name (pick_up_points = pickup_points).
        $names = [];
        foreach ($targets as $name => $_) {
            $names[strtolower($name)] = $name;
        }
        foreach ($targets as $name => $_) {
            $names['~' . self::squash($name)] ??= $name;
        }

        $out = [];
        $taken = [];
        foreach ($declared as $fk) {
            $cols = array_values((array) ($fk['columns'] ?? []));
            foreach ($cols as $c) {
                $taken[strtolower($fk['table'] . '.' . $c)] = true;
            }
            $out[] = [
                'table' => $fk['table'],
                'column' => $cols[0] ?? '',
                'columns' => $cols,
                'ref_table' => $fk['ref_table'],
                'ref_column' => $fk['ref_columns'][0] ?? 'id',
                'ref_columns' => array_values((array) ($fk['ref_columns'] ?? [])),
                'source' => 'declared',
                'enforced' => true,
                'rule' => 'declared',
                'reason' => 'Declared in the database' . (!empty($fk['name']) ? " (foreign key {$fk['name']})" : '') . ': the database itself refuses an id that does not exist.',
                'alternatives' => [],
                'name' => $fk['name'] ?? null,
                'on_delete' => strtoupper((string) ($fk['on_delete'] ?? 'NO ACTION')),
                'on_update' => strtoupper((string) ($fk['on_update'] ?? 'NO ACTION')),
            ];
        }

        foreach ($tables as $table => $meta) {
            $pk = array_values((array) ($meta['primary_key'] ?? []));
            foreach ($meta['columns'] ?? [] as $column => $col) {
                $key = strtolower("{$table}.{$column}");
                if (isset($taken[$key])) {
                    continue;
                }
                $setting = $overrides[strtolower($table)][strtolower($column)] ?? null;
                if ($setting && ($setting['mode'] ?? null) === 'none') {
                    continue;
                }
                if ($setting && ($setting['mode'] ?? null) === 'link') {
                    $ref = $lower[strtolower((string) ($setting['ref_table'] ?? ''))] ?? null;
                    $refCol = (string) ($setting['ref_column'] ?? ($targets[$ref]['pk'] ?? ''));
                    if ($ref !== null && isset($tables[$ref]['columns'][$refCol])) {
                        $out[] = self::detected($table, $column, $ref, $refCol, 'owner', 'owner',
                            "Set by you on this connection: {$column} holds the {$refCol} of a row in {$ref}.", []);
                        continue;
                    }
                }
                if (count($pk) === 1 && $pk[0] === $column) {
                    continue; // the row's own id
                }
                $found = self::detect($table, $column, $col, $meta, $tables, $targets, $names);
                if ($found !== null) {
                    $out[] = $found;
                }
            }
        }

        usort($out, fn ($a, $b) => [$a['table'], $a['column']] <=> [$b['table'], $b['column']]);
        return $out;
    }

    /** One column: the best matching table, or null. */
    private static function detect(string $table, string $column, array $col, array $meta, array $tables, array $targets, array $names): ?array
    {
        $family = self::keyFamily($col['family'] ?? '');
        if ($family === null || ColumnClassifier::isSecret($column)) {
            return null;
        }
        $base = self::baseName($column);
        $columns = $meta['columns'] ?? [];

        // Polymorphic pair: commentable_id + commentable_type points at a different table per row. A "type" next to a
        // name that is itself a table (product_taxes.tax_id + tax_type) is just a kind, so only exact names count then.
        $polymorphic = $base !== null && (isset($columns["{$base}_type"]) || isset($columns[Str::singular($base) . '_type']));
        if ($polymorphic && str_ends_with($base, 'able')) {
            return null;
        }

        /** @var list<array{0: string, 1: string, 2: string}> $candidates  [table name, rule, reason] */
        $candidates = [];
        $add = function (string $name, string $rule, string $reason) use (&$candidates) {
            $candidates[] = [$name, $rule, $reason];
        };

        // The column is named like another table's own id-like key (actor_id -> actor.actor_id, rgn_cd -> lkp_rgn.rgn_cd);
        // a natural key such as order-number is not enough.
        foreach ($targets as $name => $t) {
            if ($name !== $table && strcasecmp($t['pk'], $column) === 0 && strtolower($t['pk']) !== 'id' && preg_match(self::KEY_NAME, $t['pk'])) {
                $add($name, 'key_name', "{$column} has the same name as the key of {$name}.");
            }
        }

        if ($base !== null) {
            if ($base === 'parent') {
                $add($table, 'self', "{$column} points to another row of the same table, so rows form a tree.");
            }

            // The table's own prefix first: blogs.category_id -> blog_categories.
            $tokens = explode('_', strtolower(Str::singular($table)));
            for ($k = count($tokens); $k >= 1; $k--) {
                $prefix = implode('_', array_slice($tokens, 0, $k));
                if ($prefix === $base || str_starts_with($base, "{$prefix}_")) {
                    continue;
                }
                foreach ([Str::plural($base), $base] as $word) {
                    $add("{$prefix}_{$word}", 'scoped', "{$column} in {$table} matches {$prefix}_{$word} (same prefix as the table).");
                }
            }

            foreach (array_unique([Str::plural($base), $base, "{$base}s", "{$base}es"]) as $word) {
                $add($word, 'name', "{$column} matches the table name {$word}.");
            }

            $parts = explode('_', $base);
            for ($i = 1; $i < count($parts); $i++) {
                $tail = implode('_', array_slice($parts, $i));
                foreach ([Str::plural($tail), $tail] as $word) {
                    $add($word, 'qualifier', "{$column} most likely points to {$word} (the last part of its name).");
                }
            }
        }

        $role = $base !== null ? (in_array($base, self::ROLE_WORDS, true) || in_array(Str::afterLast($base, '_'), self::ROLE_WORDS, true)) : (bool) preg_match(self::BY_COLUMN, $column);
        if ($role) {
            foreach (self::ROLE_TABLES as $word) {
                $add($word, 'role', "{$column} usually holds the id of a person, and {$word} is the table of people here.");
            }
        }

        $pick = null;
        $alternatives = [];
        foreach ($candidates as [$name, $rule, $reason]) {
            if ($polymorphic && !in_array($rule, ['key_name', 'scoped', 'name'], true)) {
                continue;
            }
            $ref = $names[strtolower($name)] ?? $names['~' . self::squash($name)] ?? null;
            // Only parent_id and person columns (users.created_by) point back at their own table.
            if ($ref === null || ($ref === $table && !in_array($rule, ['self', 'role'], true)) || ($rule === 'self' && $ref !== $table)) {
                continue;
            }
            if (self::keyFamily($tables[$ref]['columns'][$targets[$ref]['pk']]['family'] ?? '') !== $family) {
                continue; // an integer column cannot hold a text key, and the other way round
            }
            if ($pick === null) {
                $pick = [$ref, $rule, $reason];
            } elseif ($ref !== $pick[0] && !in_array($ref, $alternatives, true) && count($alternatives) < 3) {
                $alternatives[] = $ref;
            }
        }
        if ($pick === null) {
            return null;
        }

        [$ref, $rule, $reason] = $pick;
        return self::detected($table, $column, $ref, $targets[$ref]['pk'], 'detected', $rule,
            "Detected from the column name: {$reason} The database does not enforce this link, so every value is checked before it is saved.", $alternatives);
    }

    private static function detected(string $table, string $column, string $ref, string $refCol, string $source, string $rule, string $reason, array $alternatives): array
    {
        return [
            'table' => $table,
            'column' => $column,
            'columns' => [$column],
            'ref_table' => $ref,
            'ref_column' => $refCol,
            'ref_columns' => [$refCol],
            'source' => $source,
            'enforced' => false,
            'rule' => $rule,
            'reason' => $reason,
            'alternatives' => $alternatives,
            'name' => null,
            'on_delete' => 'NOT ENFORCED',
        ];
    }

    /** Tables that can be pointed at: real tables (not views, not backup copies) with exactly one key column. */
    private static function targets(array $tables): array
    {
        $out = [];
        foreach ($tables as $name => $meta) {
            $pk = array_values((array) ($meta['primary_key'] ?? []));
            if (($meta['kind'] ?? 'table') !== 'table' || count($pk) !== 1 || !isset($meta['columns'][$pk[0]]) || preg_match(self::BACKUP_TABLE, (string) $name)) {
                continue;
            }
            $out[$name] = ['pk' => $pk[0]];
        }
        return $out;
    }

    /** "pick_up_points" and "pickup_points" are the same name. */
    private static function squash(string $name): string
    {
        return str_replace(['_', '-'], '', strtolower($name));
    }

    /** Key families that can be compared; null for columns that never hold a key. */
    private static function keyFamily(string $family): ?string
    {
        return match ($family) {
            'integer' => 'integer',
            'string', 'uuid' => 'string',
            default => null,
        };
    }

    /** "category_id" -> "category", "customerId" -> "customer"; null when the name is not an id. */
    public static function baseName(string $column): ?string
    {
        if (preg_match('/^(.+?)_(id|fk)$/i', $column, $m) || preg_match('/^(.*[a-z])(Id|ID)$/', $column, $m)) {
            $base = strtolower(Str::snake($m[1]));
            return $base !== '' ? $base : null;
        }
        return null;
    }

    /**
     * The column that names a row in people's words: name, title, category_name, *_name ... Never a secret or personal
     * column (emails and phone numbers are masked), and only text.
     */
    public static function labelColumn(string $table, array $columns): ?string
    {
        $text = array_filter($columns, fn ($c, $n) => in_array($c['family'] ?? '', ['string', 'text'], true)
            && ($c['family'] !== 'text' || (int) ($c['max_length'] ?? 0) <= 255)
            && ColumnClassifier::classify((string) $n)['class'] === 'standard', ARRAY_FILTER_USE_BOTH);
        $names = array_map('strval', array_keys($text));
        $find = function (array $wanted) use ($names) {
            foreach ($wanted as $w) {
                foreach ($names as $n) {
                    if (strcasecmp($n, $w) === 0) {
                        return $n;
                    }
                }
            }
            return null;
        };

        $singular = strtolower(Str::singular($table));
        $last = Str::afterLast($singular, '_');
        return $find(['name', 'title', 'label', 'display_name', 'full_name', 'fullname', 'heading', 'headline', 'subject', 'caption'])
            ?? $find(["{$singular}_name", "{$last}_name", "{$singular}_title", "{$last}_title", "{$last}name"])
            ?? (function () use ($names) {
                foreach ($names as $n) {
                    if (preg_match('/(_name|_title|name)$/i', $n) && !preg_match('/^(file|image|img|path|url|class|model|table|route|icon)_?name$/i', $n)) {
                        return $n;
                    }
                }
                return null;
            })()
            ?? $find(['username', 'user_name', 'login', 'code', 'sku', 'slug', 'reference', 'number'])
            ?? (function () use ($names) {
                foreach ($names as $n) {
                    if (preg_match('/(_code|_nm|_no)$/i', $n)) {
                        return $n;
                    }
                }
                return null;
            })();
    }

    /**
     * A column whose values are a short list of states or kinds (status, type, is_active ...), offered as a list of the
     * values in use instead of a free number or text box. Enum and yes/no columns already have their own choices.
     */
    public static function isCategorical(string $column, array $col): bool
    {
        $family = $col['family'] ?? '';
        if (!in_array($family, ['integer', 'string'], true) || ColumnClassifier::classify($column)['class'] !== 'standard') {
            return false;
        }
        if ($family === 'string' && (int) ($col['max_length'] ?? 255) > 255) {
            return false;
        }
        if (self::baseName($column) !== null && !preg_match('/(status|type|state|kind)_id$/i', $column)) {
            return false;
        }
        return (bool) preg_match(self::CATEGORICAL_NAME, $column);
    }
}
