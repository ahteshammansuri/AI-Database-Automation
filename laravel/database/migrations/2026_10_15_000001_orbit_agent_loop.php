<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orbit observe-act loop: per-turn state on agent_tasks, persisted tool calls,
 * acknowledged UI actions, and an encrypted per-task secret vault.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_tasks', function (Blueprint $table) {
            $table->unsignedInteger('plan_version')->default(1)->after('current_step_index');
            $table->string('stage')->nullable()->after('plan_version');
            $table->unsignedInteger('iteration_count')->default(0)->after('stage');
            $table->string('current_turn_id')->nullable()->after('iteration_count');
            $table->timestamp('turn_started_at')->nullable()->after('current_turn_id');
            $table->boolean('pending_user_turn')->default(false)->after('turn_started_at');
            $table->json('pending_tool_call')->nullable()->after('pending_user_turn');
            $table->json('page_context')->nullable()->after('pending_tool_call');
            $table->json('last_decision')->nullable()->after('page_context');
            $table->json('final_verification')->nullable()->after('last_decision');
        });

        Schema::table('agent_messages', function (Blueprint $table) {
            $table->json('meta')->nullable()->after('is_voice');
        });

        Schema::create('agent_tool_calls', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained('agent_tasks')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('turn_id')->nullable();
            $table->unsignedInteger('plan_version')->default(1);
            $table->unsignedInteger('iteration')->default(0);
            $table->string('tool');
            $table->unsignedInteger('tool_version')->default(1);
            $table->json('args_redacted')->nullable();
            $table->string('args_hash', 64);
            $table->string('status'); // succeeded, failed, rejected
            $table->string('error_category')->nullable();
            $table->boolean('side_effect_committed')->default(false);
            $table->boolean('verified')->default(false);
            $table->json('result_sanitized')->nullable();
            $table->string('trace_id', 64)->index();
            $table->string('idempotency_key', 120)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['task_id', 'id']);
        });

        Schema::create('agent_ui_actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained('agent_tasks')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('correlation_id', 64)->unique();
            $table->string('action');
            $table->json('payload')->nullable();
            $table->string('status')->default('requested'); // requested, ok, validation_error, not_mounted, error, timeout, headless
            $table->json('result')->nullable();
            $table->timestamp('acked_at')->nullable();
            $table->timestamps();
        });

        Schema::create('agent_secure_inputs', function (Blueprint $table) {
            $table->id();
            $table->uuid('handle')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('task_id')->nullable()->constrained('agent_tasks')->cascadeOnDelete();
            $table->string('kind'); // database_password, api_key
            $table->text('payload')->nullable(); // encrypted
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();

            $table->index(['task_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_secure_inputs');
        Schema::dropIfExists('agent_ui_actions');
        Schema::dropIfExists('agent_tool_calls');

        Schema::table('agent_messages', function (Blueprint $table) {
            $table->dropColumn('meta');
        });

        Schema::table('agent_tasks', function (Blueprint $table) {
            $table->dropColumn([
                'plan_version', 'stage', 'iteration_count', 'current_turn_id', 'turn_started_at',
                'pending_user_turn', 'pending_tool_call', 'page_context', 'last_decision', 'final_verification',
            ]);
        });
    }
};
