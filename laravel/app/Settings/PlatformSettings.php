<?php

namespace App\Settings;

use App\Admin\AdminActivity;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Admin-managed settings (see SettingsRegistry). Saved values are cached and applied over config() when the app
 * boots, so existing code that reads config picks them up. Long-running queue workers re-apply them before each
 * job when they changed (refreshIfStale). Website content is read with content().
 */
final class PlatformSettings
{
    private const CACHE_KEY = 'platform_settings.values';
    private const VERSION_KEY = 'platform_settings.version';

    /** Config values before any admin override (the defaults shown and restored in the panel). */
    private static array $defaults = [];
    private static array $values = [];
    private static ?string $appliedVersion = null;
    private static bool $booted = false;

    public static function boot(): void
    {
        if (!self::$booted) {
            foreach (SettingsRegistry::all() as $key => $def) {
                self::$defaults[$key] = $def['config'] ? config($key) : ($def['default'] ?? null);
            }
            self::$booted = true;
        }
        self::$appliedVersion = self::version();
        self::apply(self::load());
    }

    /** Re-apply when another process saved settings since this one applied them (cheap: one cache read). */
    public static function refreshIfStale(): void
    {
        if (!self::$booted) {
            self::boot();
            return;
        }
        if (self::version() !== self::$appliedVersion) {
            self::boot();
        }
    }

    public static function value(string $key): mixed
    {
        $def = SettingsRegistry::get($key);
        if (!$def) {
            return null;
        }
        if ($def['config']) {
            return config($key);
        }
        return array_key_exists($key, self::$values) ? self::cast($def, self::$values[$key]) : (self::$defaults[$key] ?? ($def['default'] ?? null));
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::value($key) ?? $default;
    }

    public static function default(string $key): mixed
    {
        return self::$defaults[$key] ?? (SettingsRegistry::get($key)['default'] ?? null);
    }

    public static function isOverridden(string $key): bool
    {
        return array_key_exists($key, self::$values);
    }

    /** Current values of one group (for the admin forms). */
    public static function groupValues(string $group): array
    {
        $out = [];
        foreach (SettingsRegistry::group($group) as $key => $def) {
            $out[$key] = self::value($key);
        }
        return $out;
    }

    /**
     * Validate and save values (key => value). A value equal to its default removes the override.
     * Returns the changed keys with before/after; records them in the admin activity log.
     *
     * @throws ValidationException messages keyed by setting key
     */
    public static function save(array $input, string $activity = 'settings.updated'): array
    {
        $rules = [];
        $data = [];
        foreach ($input as $key => $value) {
            $def = SettingsRegistry::get($key);
            if (!$def) {
                continue;
            }
            $data[self::field($key)] = $value;
            $rules[self::field($key)] = self::rules($def);
            if ($def['type'] === 'list') {
                foreach ($def['fields'] as $name => $field) {
                    $rules[self::field($key) . ".*.{$name}"] = ['required', 'string', 'max:' . ($field['max'] ?? 1000)];
                }
            }
            if ($def['type'] === 'tags') {
                $rules[self::field($key) . '.*'] = ['required', 'string', 'max:' . ($def['item_max'] ?? 120), 'regex:/^[A-Za-z0-9._:\/-]+$/'];
            }
        }
        $validator = Validator::make($data, $rules, [], self::attributes(array_keys($input)));
        self::crossChecks($validator, $input);
        if ($validator->fails()) {
            $errors = [];
            foreach ($validator->errors()->messages() as $field => $messages) {
                $errors[self::keyFromField(explode('.', $field)[0])] = $messages;
            }
            throw ValidationException::withMessages($errors);
        }

        $changes = [];
        $adminId = auth('admin')->id();
        DB::transaction(function () use ($input, &$changes, $adminId) {
            foreach ($input as $key => $value) {
                $def = SettingsRegistry::get($key);
                if (!$def) {
                    continue;
                }
                $value = self::cast($def, $value);
                $before = self::value($key);
                if ($value == $before) {
                    continue;
                }
                $changes[$key] = ['from' => $before, 'to' => $value];
                if ($value == self::default($key)) {
                    DB::table('platform_settings')->where('key', $key)->delete();
                } else {
                    DB::table('platform_settings')->updateOrInsert(
                        ['key' => $key],
                        ['value' => json_encode($value), 'updated_by' => $adminId, 'updated_at' => now()]
                    );
                }
            }
        });

        if ($changes) {
            self::flush();
            AdminActivity::record($activity, 'Settings', $changes, implode(', ', array_map(fn ($k) => SettingsRegistry::get($k)['label'], array_keys($changes))));
        }
        return $changes;
    }

    /** Remove the overrides of the given keys (back to defaults). */
    public static function reset(array $keys, string $activity = 'settings.reset'): void
    {
        $changes = [];
        foreach ($keys as $key) {
            if (self::isOverridden($key)) {
                $changes[$key] = ['from' => self::value($key), 'to' => self::default($key)];
            }
        }
        if (!$changes) {
            return;
        }
        DB::table('platform_settings')->whereIn('key', array_keys($changes))->delete();
        self::flush();
        AdminActivity::record($activity, 'Settings', $changes, implode(', ', array_map(fn ($k) => SettingsRegistry::get($k)['label'], array_keys($changes))));
    }

    /** Settings the customer portal may read (GET /api/platform/config), as a nested array. */
    public static function publicConfig(): array
    {
        $out = [];
        foreach (SettingsRegistry::all() as $key => $def) {
            if ($def['public'] && $def['group'] !== 'content') {
                data_set($out, $key, self::value($key));
            }
        }
        return $out;
    }

    /** Website content (GET /api/site/content): content.hero_title => hero_title. */
    /** Website texts, with {brand} replaced by the brand name (so renaming the brand updates every text). */
    public static function content(): array
    {
        $brand = (string) self::value('platform.brand_name');
        $fill = function (mixed $v) use (&$fill, $brand): mixed {
            return is_string($v) ? str_replace('{brand}', $brand, $v) : (is_array($v) ? array_map($fill, $v) : $v);
        };
        $out = [];
        foreach (SettingsRegistry::group('content') as $key => $def) {
            $out[substr($key, strlen('content.'))] = $fill(self::value($key));
        }
        return $out;
    }

    // ------------------------------------------------------------------ internals

    private static function load(): array
    {
        try {
            return Cache::rememberForever(self::CACHE_KEY, function () {
                $out = [];
                foreach (DB::table('platform_settings')->get(['key', 'value']) as $row) {
                    $out[$row->key] = json_decode((string) $row->value, true);
                }
                return $out;
            });
        } catch (\Throwable) {
            return []; // before migrations (fresh install) or without a database: defaults apply
        }
    }

    private static function apply(array $values): void
    {
        self::$values = [];
        foreach (SettingsRegistry::all() as $key => $def) {
            $has = array_key_exists($key, $values);
            if ($has) {
                self::$values[$key] = $values[$key];
            }
            if (!$def['config']) {
                continue;
            }
            $value = $has ? self::cast($def, $values[$key]) : (self::$defaults[$key] ?? null);
            config([$key => $value]);
            foreach ($def['also'] as $alias) {
                config([$alias => $value]);
            }
            foreach ($def['map'] ?? [] as $target => $convert) {
                config([$target => $convert($value)]);
            }
        }
    }

    /** Re-read every saved value now; queue workers pick it up before their next job. */
    public static function reload(): void
    {
        self::flush();
    }

    private static function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
        Cache::forever(self::VERSION_KEY, (string) microtime(true));
        self::boot();
    }

    private static function version(): ?string
    {
        try {
            return Cache::get(self::VERSION_KEY);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function cast(array $def, mixed $value): mixed
    {
        return match ($def['type']) {
            'bool' => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            'int' => (int) $value,
            'list' => array_values(array_map(
                fn ($row) => array_intersect_key((array) $row, $def['fields']),
                is_array($value) ? $value : []
            )),
            'tags' => array_values(array_unique(array_filter(array_map(fn ($v) => trim((string) $v), is_array($value) ? $value : []), fn ($v) => $v !== ''))),
            'url', 'email' => ($value === null || $value === '') ? null : trim((string) $value),
            default => $value === null ? (($def['nullable'] ?? false) ? null : '') : trim((string) $value),
        };
    }

    private static function rules(array $def): array
    {
        $required = ($def['nullable'] ?? false) || in_array($def['type'], ['bool', 'list'], true) ? 'nullable' : 'required';
        return match ($def['type']) {
            'bool' => ['nullable', 'boolean'],
            'int' => ['required', 'integer', 'min:' . ($def['min'] ?? 0), 'max:' . ($def['max'] ?? PHP_INT_MAX)],
            'email' => [$required, 'email', 'max:255'],
            'url' => [$required, 'url:http,https', 'max:255'],
            'select' => ['required', 'in:' . implode(',', array_keys($def['options']))],
            'list' => ['nullable', 'array', 'max:' . ($def['max_items'] ?? 50)],
            'tags' => [($def['nullable'] ?? false) ? 'nullable' : 'required', 'array', 'min:' . (($def['nullable'] ?? false) ? 0 : 1), 'max:' . ($def['max_items'] ?? 30)],
            'text' => [$def['group'] === 'content' ? 'nullable' : $required, 'string', 'max:' . ($def['max'] ?? 2000)],
            default => [$def['group'] === 'content' ? 'nullable' : $required, 'string', 'max:' . ($def['max'] ?? 255)],
        };
    }

    /** Rules that involve two settings. */
    private static function crossChecks(\Illuminate\Validation\Validator $validator, array $input): void
    {
        $validator->after(function ($v) use ($input) {
            $turn = (int) ($input['orbit.max_turn_seconds'] ?? self::value('orbit.max_turn_seconds'));
            $decide = (int) ($input['orbit.decide_timeout_seconds'] ?? self::value('orbit.decide_timeout_seconds'));
            if ((isset($input['orbit.max_turn_seconds']) || isset($input['orbit.decide_timeout_seconds'])) && $decide >= $turn) {
                $v->errors()->add(self::field('orbit.decide_timeout_seconds'), 'Time per decision must be less than the time per request.');
            }
            if (!empty($input['content.announcement_enabled']) && trim((string) ($input['content.announcement_text'] ?? '')) === '') {
                $v->errors()->add(self::field('content.announcement_text'), 'Write the announcement, or turn the announcement off.');
            }
        });
    }

    private static function attributes(array $keys): array
    {
        $out = [];
        foreach ($keys as $key) {
            $def = SettingsRegistry::get($key);
            if ($def) {
                $out[self::field($key)] = strtolower($def['label']);
            }
        }
        return $out;
    }

    /** Dots in keys would be read as nesting by the validator. */
    private static function field(string $key): string
    {
        return str_replace('.', '__', $key);
    }

    private static function keyFromField(string $field): string
    {
        return str_replace('__', '.', $field);
    }
}
