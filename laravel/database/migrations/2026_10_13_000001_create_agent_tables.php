<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. Agent Conversations
        Schema::create('agent_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title')->default('New Consultation');
            $table->string('status')->default('ACTIVE'); // ACTIVE, ARCHIVED
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });

        // 2. Agent Messages
        Schema::create('agent_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained('agent_conversations')->cascadeOnDelete();
            $table->string('role'); // user, assistant, system, tool
            $table->text('content')->nullable();
            $table->json('tool_calls')->nullable();
            $table->json('tool_results')->nullable();
            $table->string('secure_input_type')->nullable(); // database_credentials, api_key
            $table->boolean('is_voice')->default(false);
            $table->timestamp('created_at')->useCurrent();

            $table->index(['conversation_id', 'id']);
        });

        // 3. Agent Tasks
        Schema::create('agent_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->nullable()->constrained('agent_conversations')->nullOnDelete();
            $table->string('task_type'); // e.g. ADD_CONNECTION, CREATE_AUTOMATION, SCAN_SCHEMA, RUN_EXECUTION, EXPLAIN_FAILURE
            $table->text('goal');
            $table->string('status')->default('DRAFT'); // DRAFT, READY, QUEUED, RUNNING, WAITING_FOR_INPUT, WAITING_FOR_PROVIDER, WAITING_FOR_APPROVAL, VALIDATING, COMMITTING, SUCCEEDED, INTERRUPT_REQUESTED, PAUSE_REQUESTED, PAUSED, CANCELLED, PARTIAL_SUCCESS, FAILED
            $table->string('autonomy_level')->default('CONFIRM_CONSEQUENTIAL_CHANGES'); // PREPARE_FOR_REVIEW, CONFIRM_CONSEQUENTIAL_CHANGES, AUTOMATIC_WITHIN_PERMISSIONS
            $table->json('active_plan')->nullable(); // Array of step objects
            $table->integer('current_step_index')->default(0);
            $table->string('idempotency_key')->nullable()->index();
            $table->string('target_resource_type')->nullable(); // DbConnection, Automation, AutomationExecution
            $table->string('target_resource_id')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('paused_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });

        // 4. Agent Task Timeline Events
        Schema::create('agent_task_timeline_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained('agent_tasks')->cascadeOnDelete();
            $table->string('step_name');
            $table->string('status'); // pending, running, waiting, succeeded, failed, skipped, cancelled
            $table->string('message');
            $table->json('details')->nullable();
            $table->string('correlation_id')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['task_id', 'id']);
        });

        // 5. User Agent Preferences
        Schema::create('user_agent_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('autonomy_level')->default('CONFIRM_CONSEQUENTIAL_CHANGES');
            $table->boolean('voice_enabled')->default(true);
            $table->string('preferred_model')->default('llama3.2:1b');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('user_agent_preferences');
        Schema::dropIfExists('agent_task_timeline_events');
        Schema::dropIfExists('agent_tasks');
        Schema::dropIfExists('agent_messages');
        Schema::dropIfExists('agent_conversations');
    }
};
