<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orbit's tool catalog holds the whole tool, its policy included: which arguments come from the secure vault, which
 * steps always need confirmation or the Confirm button, and the check run after success. Nothing about a tool is kept
 * in code any more (a password- or key-named argument is still always filled from the vault: AgentToolRegistry).
 *
 * resources/orbit/tools.json is the shipped catalog. It fills a fresh installation (the earlier migration could only
 * copy tools from code that no longer defines them) and brings tools no administrator has edited up to date; a tool
 * edited in the admin panel keeps its text and parameters.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orbit_tools', function (Blueprint $table) {
            if (!Schema::hasColumn('orbit_tools', 'version')) {
                $table->unsignedInteger('version')->default(1);
            }
            if (!Schema::hasColumn('orbit_tools', 'side_effect_class')) {
                $table->string('side_effect_class', 32)->nullable();
            }
            if (!Schema::hasColumn('orbit_tools', 'secret_params')) {
                $table->json('secret_params')->nullable();
            }
            if (!Schema::hasColumn('orbit_tools', 'always_confirm')) {
                $table->boolean('always_confirm')->default(false);
            }
            if (!Schema::hasColumn('orbit_tools', 'confirm_by_button')) {
                $table->boolean('confirm_by_button')->default(false);
            }
            if (!Schema::hasColumn('orbit_tools', 'postcondition')) {
                $table->string('postcondition', 64)->nullable();
            }
        });

        \App\Services\Agent\ToolCatalog::sync();
    }

    public function down(): void
    {
        Schema::table('orbit_tools', function (Blueprint $table) {
            foreach (\App\Services\Agent\ToolCatalog::policyColumns() as $column) {
                if (Schema::hasColumn('orbit_tools', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
