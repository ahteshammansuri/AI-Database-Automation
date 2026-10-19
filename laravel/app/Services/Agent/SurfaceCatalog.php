<?php

namespace App\Services\Agent;

/**
 * Server-owned catalog of everything Orbit may operate on screen (resources/orbit/surfaces.json).
 * Pages register handlers for these surfaces in the browser, but the browser never decides
 * what exists or what is consequential: every UI tool call is checked against this file.
 */
class SurfaceCatalog
{
    protected static ?array $data = null;

    public static function data(): array
    {
        if (self::$data === null) {
            $raw = file_get_contents(resource_path('orbit/surfaces.json'));
            self::$data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        }

        return self::$data;
    }

    public static function routes(): array
    {
        return array_column(self::data()['pages'], 'route');
    }

    public static function surface(string $id): ?array
    {
        foreach (self::data()['surfaces'] as $s) {
            if ($s['id'] === $id) {
                return $s;
            }
        }

        return null;
    }

    public static function surfaceIds(?callable $filter = null): array
    {
        $ids = [];
        foreach (self::data()['surfaces'] as $s) {
            if ($filter === null || $filter($s)) {
                $ids[] = $s['id'];
            }
        }

        return $ids;
    }

    public static function field(array $surface, string $name): ?array
    {
        foreach ($surface['fields'] ?? [] as $f) {
            if ($f['name'] === $name) {
                return $f;
            }
        }
        // Dynamic fields (e.g. "col.*" = one per column of the chosen table).
        foreach ($surface['fields'] ?? [] as $f) {
            if (!empty($f['dynamic']) && str_ends_with($f['name'], '.*')) {
                $prefix = substr($f['name'], 0, -1);
                $rest = substr($name, strlen($prefix));
                if (str_starts_with($name, $prefix) && preg_match('/^[A-Za-z0-9_]{1,64}$/', $rest)) {
                    return array_merge($f, ['name' => $name]);
                }
            }
        }

        return null;
    }

    public static function action(array $surface, string $id): ?array
    {
        foreach ($surface['actions'] ?? [] as $a) {
            if ($a['id'] === $id) {
                return $a;
            }
        }

        return null;
    }

    /** Compact page/surface map the model sees (what exists where). */
    public static function modelSummary(): array
    {
        $out = [];
        foreach (self::data()['surfaces'] as $s) {
            $out[] = [
                'surface' => $s['id'],
                'page' => $s['route'],
                'title' => $s['title'],
                'fields' => array_map(fn ($f) => $f['name'] . ($f['type'] === 'secret' ? '(secret: user types it)' : '') . (!empty($f['required']) ? '*' : ''), $s['fields'] ?? []),
                'actions' => array_map(fn ($a) => $a['id'] . (!empty($a['row']) ? '(row)' : '') . (!empty($a['destructive']) ? '!!' : (!empty($a['consequential']) ? '!' : '')), $s['actions'] ?? []),
            ];
        }

        return $out;
    }

    /**
     * Validate a UI tool call against the catalog.
     *
     * @return array{ok: bool, error: ?string, consequential: bool, timeout: int}
     */
    public static function check(string $tool, array $args): array
    {
        $fail = fn (string $msg) => ['ok' => false, 'error' => $msg, 'consequential' => false, 'timeout' => 10];
        $ok = fn (bool $consequential = false, int $timeout = 20) => ['ok' => true, 'error' => null, 'consequential' => $consequential, 'timeout' => $timeout];

        if ($tool === 'go_to_page') {
            return in_array($args['page'] ?? '', self::routes(), true) ? $ok(false, 20) : $fail('Unknown page. Pages: ' . implode(', ', self::routes()));
        }
        if ($tool === 'read_screen') {
            return $ok(false, 15);
        }

        $surface = self::surface((string) ($args['surface'] ?? ''));
        if (!$surface) {
            return $fail("Unknown surface '" . ($args['surface'] ?? '') . "'. Surfaces: " . implode(', ', self::surfaceIds()));
        }

        switch ($tool) {
            case 'open_form':
                return !empty($surface['openable']) ? $ok(false, 25) : $fail("'{$surface['id']}' is always visible on its page; use go_to_page then fill or press.");
            case 'fill_fields':
                $values = $args['values'] ?? [];
                if (!is_array($values) || $values === []) {
                    return $fail('values must be an object of field: value pairs.');
                }
                foreach ($values as $name => $_) {
                    $f = self::field($surface, (string) $name);
                    if (!$f) {
                        return $fail("'{$surface['id']}' has no field '{$name}'. Fields: " . implode(', ', array_column($surface['fields'] ?? [], 'name')));
                    }
                    if ($f['type'] === 'secret') {
                        return $fail("'{$name}' is secret: use ask_secret_in_form so the user types it themselves.");
                    }
                    if ($f['type'] === 'file') {
                        return $fail("'{$name}' is a file: press choose_file so the user picks it.");
                    }
                    if (!empty($f['row']) && empty($args['row'])) {
                        return $fail("Field '{$name}' belongs to a row: pass row.");
                    }
                }
                // Orbit types text visibly (up to ~2 s per field) and travels between fields.
                return $ok(false, 20 + 4 * count($values));
            case 'choose_option':
                $f = self::field($surface, (string) ($args['field'] ?? ''));
                if (!$f || (!in_array($f['type'], ['select', 'searchable_select'], true) && empty($f['dynamic']))) {
                    return $fail("'" . ($args['field'] ?? '') . "' is not a selectable field of '{$surface['id']}'.");
                }
                return $ok(false, 30);
            case 'ask_secret_in_form':
                $f = self::field($surface, (string) ($args['field'] ?? ''));
                return ($f && $f['type'] === 'secret') ? $ok(false, 15) : $fail("'" . ($args['field'] ?? '') . "' is not a secret field of '{$surface['id']}'.");
            case 'press':
                $a = self::action($surface, (string) ($args['action'] ?? ''));
                if (!$a) {
                    return $fail("'{$surface['id']}' has no action '" . ($args['action'] ?? '') . "'. Actions: " . implode(', ', array_column($surface['actions'] ?? [], 'id')));
                }
                if (!empty($a['row']) && (!isset($args['row']) || $args['row'] === '')) {
                    return $fail("Action '{$a['id']}' needs row (the id of the item to act on).");
                }
                return $ok(!empty($a['consequential']), (int) ($a['timeout_s'] ?? 30));
            case 'show_me':
                return $ok(false, 15);
        }

        return $fail("'{$tool}' is not a UI tool.");
    }
}
