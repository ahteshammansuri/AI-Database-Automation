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
        // 1. Persistent Versioned Schema Snapshots
        if (!Schema::hasTable('schema_snapshots')) {
            Schema::create('schema_snapshots', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
                $table->integer('version')->default(1);
                $table->json('schema_payload');
                $table->integer('table_count')->default(0);
                $table->integer('column_count')->default(0);
                $table->timestamps();
            });
        }

        // 2. AI Semantic Table Annotations & User Workspace Notes
        if (!Schema::hasTable('schema_table_annotations')) {
            Schema::create('schema_table_annotations', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('connection_id')->constrained('db_connections')->cascadeOnDelete();
                $table->string('table_name');
                $table->text('ai_purpose')->nullable();
                $table->string('ai_business_concept')->nullable();
                $table->text('user_override_notes')->nullable();
                $table->boolean('is_user_verified')->default(false);
                $table->timestamps();

                $table->unique(['user_id', 'connection_id', 'table_name']);
            });
        }

        // 3. Add result_details, timeline_events & relation_resolutions to automation_executions
        Schema::table('automation_executions', function (Blueprint $table) {
            if (!Schema::hasColumn('automation_executions', 'result_details')) {
                $table->json('result_details')->nullable()->after('target_record_id');
            }
            if (!Schema::hasColumn('automation_executions', 'timeline_events')) {
                $table->json('timeline_events')->nullable()->after('result_details');
            }
            if (!Schema::hasColumn('automation_executions', 'relation_resolutions')) {
                $table->json('relation_resolutions')->nullable()->after('timeline_events');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('automation_executions', function (Blueprint $table) {
            $table->dropColumn(['result_details', 'timeline_events', 'relation_resolutions']);
        });
        Schema::dropIfExists('schema_table_annotations');
        Schema::dropIfExists('schema_snapshots');
    }
};
