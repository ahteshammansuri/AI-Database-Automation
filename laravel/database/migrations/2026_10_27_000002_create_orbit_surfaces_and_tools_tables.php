<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Make Orbit surfaces, portal pages, and agent tools fully dynamic and database-driven:
 * managed directly by administrators in the Filament Admin Panel.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Portal Pages table
        if (!Schema::hasTable('orbit_pages')) {
            Schema::create('orbit_pages', function (Blueprint $table) {
                $table->id();
                $table->string('route', 120)->unique();
                $table->string('title', 160);
                $table->text('description')->nullable();
                $table->boolean('is_active')->default(true);
                $table->unsignedInteger('sort')->default(0);
                $table->unsignedBigInteger('updated_by')->nullable();
                $table->timestamps();
            });
        }

        // 2. Interactive Surfaces table
        if (!Schema::hasTable('orbit_surfaces')) {
            Schema::create('orbit_surfaces', function (Blueprint $table) {
                $table->string('id', 120)->primary();
                $table->string('route', 120)->index();
                $table->string('title', 160);
                $table->text('purpose')->nullable();
                $table->boolean('openable')->default(false);
                $table->json('fields')->nullable();
                $table->json('actions')->nullable();
                $table->boolean('is_active')->default(true);
                $table->unsignedInteger('sort')->default(0);
                $table->unsignedBigInteger('updated_by')->nullable();
                $table->timestamps();
            });
        }

        // 3. Orbit Tools table
        if (!Schema::hasTable('orbit_tools')) {
            Schema::create('orbit_tools', function (Blueprint $table) {
                $table->string('name', 120)->primary();
                $table->string('label', 160);
                $table->string('category', 64)->default('general')->index();
                $table->text('description');
                $table->text('outcome')->nullable();
                $table->string('scope', 64)->default('tenant_user');
                $table->boolean('read_only')->default(false);
                $table->text('side_effects')->nullable();
                $table->string('risk_level', 32)->default('LOW');
                $table->boolean('requires_confirmation')->default(false);
                $table->boolean('idempotent')->default(true);
                $table->boolean('retryable')->default(true);
                $table->boolean('audit_required')->default(false);
                $table->boolean('is_ui')->default(false);
                $table->boolean('is_active')->default(true);
                $table->json('parameters')->nullable();
                $table->json('output_schema')->nullable();
                $table->unsignedInteger('sort')->default(0);
                $table->unsignedBigInteger('updated_by')->nullable();
                $table->timestamps();
            });
        }

        $now = now();

        // Seed pages from surfaces.json
        $catalogPath = resource_path('orbit/surfaces.json');
        if (file_exists($catalogPath)) {
            $catalog = json_decode(file_get_contents($catalogPath), true);

            foreach (($catalog['pages'] ?? []) as $i => $page) {
                DB::table('orbit_pages')->updateOrInsert(
                    ['route' => $page['route']],
                    [
                        'title' => $page['title'],
                        'description' => $page['description'] ?? null,
                        'is_active' => true,
                        'sort' => ($i + 1) * 10,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]
                );
            }

            foreach (($catalog['surfaces'] ?? []) as $i => $surface) {
                DB::table('orbit_surfaces')->updateOrInsert(
                    ['id' => $surface['id']],
                    [
                        'route' => $surface['route'],
                        'title' => $surface['title'],
                        'purpose' => $surface['purpose'] ?? null,
                        'openable' => (bool) ($surface['openable'] ?? false),
                        'fields' => json_encode($surface['fields'] ?? []),
                        'actions' => json_encode($surface['actions'] ?? []),
                        'is_active' => true,
                        'sort' => ($i + 1) * 10,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]
                );
            }
        }

        // Seed tools from AgentToolRegistry
        try {
            $tools = \App\Services\Agent\AgentToolRegistry::getToolDefinitions();
            foreach ($tools as $i => $t) {
                $isUi = in_array($t['name'], \App\Services\Agent\AgentToolRegistry::UI_TOOLS, true);
                $category = match(true) {
                    $isUi => 'ui',
                    str_contains($t['name'], 'connection') || str_contains($t['name'], 'database') || str_contains($t['name'], 'schema') => 'database',
                    str_contains($t['name'], 'automation') || str_contains($t['name'], 'execution') => 'automation',
                    str_contains($t['name'], 'approval') || str_contains($t['name'], 'content') => 'approval',
                    str_contains($t['name'], 'provider') => 'ai_provider',
                    str_contains($t['name'], 'knowledge') => 'knowledge',
                    str_contains($t['name'], 'account') || str_contains($t['name'], 'profile') => 'account',
                    str_contains($t['name'], 'audit') => 'audit',
                    str_contains($t['name'], 'data_change') || str_contains($t['name'], 'dummy_data') => 'data_operations',
                    default => 'general',
                };

                DB::table('orbit_tools')->updateOrInsert(
                    ['name' => $t['name']],
                    [
                        'label' => $t['label'] ?? $t['name'],
                        'category' => $category,
                        'description' => $t['description'] ?? '',
                        'outcome' => $t['outcome'] ?? null,
                        'scope' => $t['scope'] ?? 'tenant_user',
                        'read_only' => (bool) ($t['read_only'] ?? false),
                        'side_effects' => $t['side_effects'] ?? null,
                        'risk_level' => $t['risk_level'] ?? 'LOW',
                        'requires_confirmation' => (bool) ($t['requires_confirmation'] ?? false),
                        'idempotent' => (bool) ($t['idempotent'] ?? true),
                        'retryable' => (bool) ($t['retryable'] ?? true),
                        'audit_required' => (bool) ($t['audit_required'] ?? false),
                        'is_ui' => $isUi,
                        'is_active' => true,
                        'parameters' => json_encode($t['parameters'] ?? ['type' => 'object']),
                        'output_schema' => json_encode($t['output_schema'] ?? ['type' => 'object']),
                        'sort' => ($i + 1) * 10,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]
                );
            }
        } catch (\Throwable $e) {
            // Safe fallback if registry is initializing
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('orbit_tools');
        Schema::dropIfExists('orbit_surfaces');
        Schema::dropIfExists('orbit_pages');
    }
};
