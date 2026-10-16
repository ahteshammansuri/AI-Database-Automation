<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Connection Access Modes and Policy Overrides (ADR-010)
        Schema::table('db_connections', function (Blueprint $table) {
            $table->string('access_mode')->default('read_only')->after('ssl_mode'); // read_only, read_write, read_write_delete
            $table->json('data_policy')->nullable()->after('access_mode');          // owner overrides per table/column
            $table->string('data_timezone', 64)->nullable()->after('data_policy');  // target DB wall-clock timezone
        });

        // 2. User Preferences for Timezone, Privacy and Agent Modes
        Schema::table('users', function (Blueprint $table) {
            $table->string('timezone', 64)->default('UTC')->after('remember_token');
            $table->string('privacy_mode', 32)->default('local_only')->after('timezone'); // local_only, cloud_metadata_only, cloud_with_results
            $table->string('agent_view_mode', 32)->default('watch')->after('privacy_mode'); // watch, fast, background
        });

        // 3. Data Change Requests: Previews, Diffs, Pinned Execution, Before-Image with TTL, Undo
        Schema::create('data_change_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
            $table->foreignId('task_id')->nullable()->constrained('agent_tasks')->nullOnDelete();
            $table->string('action', 20); // insert, update, delete
            $table->string('target_table');
            $table->json('primary_keys')->nullable();     // pinned PKs previewed
            $table->json('filter_spec')->nullable();      // re-checked at execution time
            $table->json('patch_values')->nullable();     // fields to update or insert
            $table->unsignedInteger('affected_count')->default(0);
            $table->json('preview_rows')->nullable();     // masked preview sample rows
            $table->json('diff_summary')->nullable();     // before -> after per column
            $table->json('impact_analysis')->nullable();  // cascade count, child tables
            $table->string('confirmation_phrase')->nullable(); // typed phrase for delete
            $table->string('status', 30)->default('pending_confirmation'); // pending_confirmation, executed, rolled_back, undone, cancelled, expired
            $table->longText('before_image')->nullable(); // encrypted snapshot of rows before change
            $table->longText('after_image')->nullable();  // snapshot after change
            $table->timestamp('expires_at');
            $table->timestamp('executed_at')->nullable();
            $table->timestamp('undone_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index(['connection_id', 'target_table']);
        });

        // 4. Stored Data Query Results (masked rows for re-display, paging, explain panel)
        Schema::create('data_query_results', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
            $table->string('query_hash', 64)->index();
            $table->text('user_question')->nullable();
            $table->text('compiled_sql')->nullable();
            $table->json('bindings')->nullable();
            $table->unsignedInteger('row_count')->default(0);
            $table->json('masked_rows')->nullable();
            $table->json('columns')->nullable();
            $table->json('assumptions')->nullable();
            $table->json('how_i_got_this')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->index(['user_id', 'expires_at']);
        });

        // 5. Per-Conversation Data Context (active connection, active table, last query plan, result refs)
        Schema::create('data_conversation_states', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('active_connection_id')->nullable()->constrained('db_connections')->nullOnDelete();
            $table->string('active_table')->nullable();
            $table->uuid('last_result_id')->nullable();
            $table->json('last_query_plan')->nullable();
            $table->json('pending_clarification')->nullable();
            $table->timestamps();

            $table->unique('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_conversation_states');
        Schema::dropIfExists('data_query_results');
        Schema::dropIfExists('data_change_requests');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['timezone', 'privacy_mode', 'agent_view_mode']);
        });

        Schema::table('db_connections', function (Blueprint $table) {
            $table->dropColumn(['access_mode', 'data_policy', 'data_timezone']);
        });
    }
};
