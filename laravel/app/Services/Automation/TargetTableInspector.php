<?php

namespace App\Services\Automation;

use App\Services\Data\ColumnClassifier;
use PDO;

/**
 * Read-only description of a customer table from information_schema: columns with type,
 * nullability, defaults, length, keys, auto-increment / generated flags, enum values, and the
 * table's foreign keys. Also classifies each column's content kind (title, body, image, ...)
 * so generation, previews and parent-row creation all agree on what a column means.
 *
 * Results are memoised per PDO connection for the lifetime of the object.
 */
class TargetTableInspector
{
    /** @var array<string, array> */
    private array $cache = [];

    public function describe(PDO $pdo, string $dbName, string $table): ?array
    {
        $key = spl_object_id($pdo) . "|{$dbName}|{$table}";
        if (array_key_exists($key, $this->cache)) {
            return $this->cache[$key];
        }

        $colStmt = $pdo->prepare("
            SELECT column_name, data_type, column_type, is_nullable, column_default, column_key,
                   character_maximum_length, extra
            FROM information_schema.columns
            WHERE table_schema = :db AND table_name = :tbl
            ORDER BY ordinal_position ASC
        ");
        $colStmt->execute(['db' => $dbName, 'tbl' => $table]);
        $rows = $colStmt->fetchAll(PDO::FETCH_ASSOC);
        if (empty($rows)) {
            return $this->cache[$key] = null;
        }

        $fkStmt = $pdo->prepare("
            SELECT column_name, referenced_table_name, referenced_column_name
            FROM information_schema.key_column_usage
            WHERE table_schema = :db AND table_name = :tbl AND referenced_table_name IS NOT NULL
        ");
        $fkStmt->execute(['db' => $dbName, 'tbl' => $table]);
        $foreignKeys = [];
        foreach ($fkStmt->fetchAll(PDO::FETCH_ASSOC) as $fk) {
            $fk = array_change_key_case($fk, CASE_LOWER);
            $foreignKeys[$fk['column_name']] = [
                'table' => $fk['referenced_table_name'],
                'column' => $fk['referenced_column_name'],
            ];
        }

        $columns = [];
        $primaryKey = null;
        foreach ($rows as $raw) {
            $c = array_change_key_case($raw, CASE_LOWER);
            $name = $c['column_name'];
            $columnType = strtolower((string) $c['column_type']);
            $dataType = strtolower((string) $c['data_type']);
            $extra = strtolower((string) ($c['extra'] ?? ''));
            $enum = [];
            if (str_starts_with($columnType, 'enum(') || str_starts_with($columnType, 'set(')) {
                preg_match_all("/'((?:[^'\\\\]|\\\\.|'')*)'/", (string) $c['column_type'], $m);
                $enum = array_map(fn($v) => str_replace("''", "'", $v), $m[1] ?? []);
            }
            $isPk = ($c['column_key'] ?? '') === 'PRI';
            if ($isPk && $primaryKey === null) {
                $primaryKey = $name;
            }
            $hasDefault = $c['column_default'] !== null || str_contains($extra, 'default_generated');

            $columns[$name] = [
                'name' => $name,
                'data_type' => $dataType,
                'column_type' => $columnType,
                'nullable' => strtoupper((string) $c['is_nullable']) === 'YES',
                'default' => $c['column_default'],
                'has_default' => $hasDefault,
                'max_length' => $c['character_maximum_length'] !== null ? (int) $c['character_maximum_length'] : null,
                'is_primary' => $isPk,
                'is_unique' => in_array($c['column_key'] ?? '', ['PRI', 'UNI'], true),
                'auto_increment' => str_contains($extra, 'auto_increment'),
                'generated' => str_contains($extra, 'generated') && !str_contains($extra, 'default_generated'),
                'enum_values' => $enum,
                'foreign_key' => $foreignKeys[$name] ?? null,
                'is_secret' => ColumnClassifier::classify($name)['class'] === 'secret',
            ];
            $columns[$name]['kind'] = self::kind($columns[$name]);
            // "Required" = the INSERT fails unless we supply a value.
            $columns[$name]['required'] = !$columns[$name]['nullable']
                && !$hasDefault
                && !$columns[$name]['auto_increment']
                && !$columns[$name]['generated'];
        }

        return $this->cache[$key] = [
            'table' => $table,
            'primary_key' => $primaryKey,
            'columns' => $columns,
            'foreign_keys' => $foreignKeys,
        ];
    }

    /** Best human-readable label column of a table (never a secret or e-mail/phone column). */
    public static function labelColumn(array $info): ?string
    {
        $cols = $info['columns'] ?? [];
        foreach (['name', 'title', 'label', 'display_name', 'category_name', 'tag_name', 'heading', 'topic', 'username', 'slug'] as $cand) {
            if (isset($cols[$cand]) && in_array($cols[$cand]['data_type'], ['varchar', 'char', 'text', 'tinytext'], true)) {
                return $cand;
            }
        }
        foreach ($cols as $name => $c) {
            if (str_ends_with($name, '_name') && in_array($c['data_type'], ['varchar', 'char'], true) && !$c['is_secret']) {
                $class = ColumnClassifier::classify($name)['class'];
                if ($class === 'standard') {
                    return $name;
                }
            }
        }
        return null;
    }

    public static function slugColumn(array $info): ?string
    {
        foreach ($info['columns'] ?? [] as $name => $c) {
            if ($c['kind'] === 'slug') {
                return $name;
            }
        }
        return null;
    }

    /**
     * Content kind of a column: drives AI instructions, defaults and how previews render it.
     * One of: image, slug, title, summary, body, meta_title, meta_description, keywords, url,
     * contact, datetime, boolean, number, enum, json, text.
     */
    public static function kind(array $col): string
    {
        $n = strtolower($col['name']);
        $t = $col['data_type'];
        $isString = in_array($t, ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext'], true);
        $isLongText = in_array($t, ['text', 'mediumtext', 'longtext'], true);

        if ($t === 'enum' || $t === 'set') {
            return 'enum';
        }
        if (in_array($t, ['date', 'datetime', 'timestamp', 'time', 'year'], true)) {
            return 'datetime';
        }
        if ($t === 'json') {
            return 'json';
        }
        if (($t === 'tinyint' && str_contains($col['column_type'] ?? '', 'tinyint(1)')) || $t === 'bit' || $t === 'boolean'
            || ($t === 'tinyint' && preg_match('/^(is|has|can|should)_/', $n))) {
            return 'boolean';
        }
        if (in_array($t, ['int', 'integer', 'bigint', 'smallint', 'mediumint', 'tinyint', 'decimal', 'float', 'double', 'numeric'], true)) {
            return 'number';
        }
        if (!$isString) {
            return 'text';
        }

        if (preg_match('/(^|_)(banner|image|img|thumbnail|thumb|cover|photo|picture|poster|hero|og_image|meta_img|meta_image|featured_image|featured_img)(_url|_path|_src)?$/', $n)
            || preg_match('/^(image|img|banner|thumbnail|cover|photo)(_url|_path|_src)?$/', $n)) {
            return 'image';
        }
        if ($n === 'slug' || str_ends_with($n, '_slug')) {
            return 'slug';
        }
        if (preg_match('/^(meta_title|seo_title|og_title|meta_name)$/', $n)) {
            return 'meta_title';
        }
        if (preg_match('/^(meta_description|seo_description|og_description|meta_desc|meta_content)$/', $n)) {
            return 'meta_description';
        }
        if (preg_match('/(^|_)(keywords?|tags|tag_list|meta_keywords)$/', $n)) {
            return 'keywords';
        }
        if (preg_match('/(^|_)(url|link|href|website|uri)$/', $n) || str_ends_with($n, '_url')) {
            return 'url';
        }
        if (ColumnClassifier::classify($n)['class'] === 'pii') {
            return 'contact';
        }
        if (preg_match('/^(title|name|headline|subject|question|heading|post_title|article_title)$/', $n)) {
            return 'title';
        }
        if (preg_match('/^(excerpt|summary|short_description|short_desc|intro|introduction|teaser|lead|subtitle|sub_title|abstract|snippet|tagline|overview)$/', $n)) {
            return 'summary';
        }
        if (preg_match('/^(content|body|description|article|answer|text|details|html|long_description|post_content|full_text|content_html|body_html|article_body)$/', $n)
            || $isLongText) {
            return 'body';
        }
        return 'text';
    }
}
