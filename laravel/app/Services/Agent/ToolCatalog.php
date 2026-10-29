<?php

namespace App\Services\Agent;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The shipped Orbit tool catalog (resources/orbit/tools.json) applied to the orbit_tools table: missing tools are
 * added, and tools no administrator has edited are brought up to date. A tool edited in the admin panel keeps its
 * text and parameters; its policy columns (vault arguments, confirmation, post-check) follow the catalog.
 */
final class ToolCatalog
{
    private const POLICY = ['version', 'side_effect_class', 'secret_params', 'always_confirm', 'confirm_by_button', 'postcondition'];

    /** @return array{added: int, updated: int} */
    public static function sync(?string $path = null): array
    {
        $path ??= resource_path('orbit/tools.json');
        if (!is_file($path) || !Schema::hasTable('orbit_tools')) {
            return ['added' => 0, 'updated' => 0];
        }
        $catalog = json_decode((string) file_get_contents($path), true) ?: [];
        $hasPolicy = Schema::hasColumn('orbit_tools', 'confirm_by_button');
        $now = now();
        $added = $updated = 0;

        foreach (($catalog['tools'] ?? []) as $i => $tool) {
            $name = (string) ($tool['name'] ?? '');
            if ($name === '') {
                continue;
            }
            $policy = $hasPolicy ? [
                'version' => (int) ($tool['version'] ?? 1),
                'side_effect_class' => $tool['side_effect_class'] ?? null,
                'secret_params' => json_encode((object) ($tool['secret_params'] ?? [])),
                'always_confirm' => (bool) ($tool['always_confirm'] ?? false),
                'confirm_by_button' => (bool) ($tool['confirm_by_button'] ?? false),
                'postcondition' => $tool['postcondition'] ?? null,
            ] : [];
            $content = [
                'label' => $tool['label'] ?? $name,
                'category' => $tool['category'] ?? 'general',
                'description' => (string) ($tool['description'] ?? ''),
                'outcome' => $tool['outcome'] ?? null,
                'scope' => $tool['scope'] ?? 'tenant_user',
                'read_only' => (bool) ($tool['read_only'] ?? false),
                'side_effects' => $tool['side_effects'] ?? null,
                'risk_level' => $tool['risk_level'] ?? 'LOW',
                'requires_confirmation' => (bool) ($tool['requires_confirmation'] ?? false),
                'idempotent' => (bool) ($tool['idempotent'] ?? true),
                'retryable' => (bool) ($tool['retryable'] ?? true),
                'audit_required' => (bool) ($tool['audit_required'] ?? false),
                'is_ui' => (bool) ($tool['is_ui'] ?? false),
                'parameters' => json_encode($tool['parameters'] ?? ['type' => 'object']),
                'output_schema' => json_encode($tool['output_schema'] ?? ['type' => 'object']),
            ];

            $existing = DB::table('orbit_tools')->where('name', $name)->first();
            if (!$existing) {
                DB::table('orbit_tools')->insert(['name' => $name] + $content + $policy + [
                    'is_active' => (bool) ($tool['is_active'] ?? true),
                    'sort' => (int) ($tool['sort'] ?? ($i + 1) * 10),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $added++;
                continue;
            }
            DB::table('orbit_tools')->where('name', $name)->update(
                $policy + ($existing->updated_by === null ? $content : []) + ['updated_at' => $now]
            );
            $updated++;
        }
        AgentToolRegistry::flushCache();

        return ['added' => $added, 'updated' => $updated];
    }

    /** @return list<string> */
    public static function policyColumns(): array
    {
        return self::POLICY;
    }
}
