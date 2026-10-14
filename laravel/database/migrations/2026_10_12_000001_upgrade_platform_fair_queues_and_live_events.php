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
        // 1. Upgrade db_connections with verification, latency, server version, timeout and freshness metadata
        Schema::table('db_connections', function (Blueprint $table) {
            if (!Schema::hasColumn('db_connections', 'last_tested_at')) {
                $table->timestamp('last_tested_at')->nullable()->after('status');
            }
            if (!Schema::hasColumn('db_connections', 'server_version')) {
                $table->string('server_version')->nullable()->after('last_tested_at');
            }
            if (!Schema::hasColumn('db_connections', 'latency_ms')) {
                $table->decimal('latency_ms', 8, 2)->nullable()->after('server_version');
            }
            if (!Schema::hasColumn('db_connections', 'connection_timeout')) {
                $table->integer('connection_timeout')->default(5)->after('latency_ms');
            }
            if (!Schema::hasColumn('db_connections', 'error_message')) {
                $table->text('error_message')->nullable()->after('connection_timeout');
            }
            if (!Schema::hasColumn('db_connections', 'schema_freshness_at')) {
                $table->timestamp('schema_freshness_at')->nullable()->after('error_message');
            }
            if (!Schema::hasColumn('db_connections', 'is_active')) {
                $table->boolean('is_active')->default(true)->after('schema_freshness_at');
            }
        });

        // 2. Upgrade automation_executions with queue fairness, leases, durations & retry tracking
        Schema::table('automation_executions', function (Blueprint $table) {
            if (!Schema::hasColumn('automation_executions', 'queue_wait_ms')) {
                $table->integer('queue_wait_ms')->nullable()->after('status');
            }
            if (!Schema::hasColumn('automation_executions', 'execution_duration_ms')) {
                $table->integer('execution_duration_ms')->nullable()->after('queue_wait_ms');
            }
            if (!Schema::hasColumn('automation_executions', 'lease_expires_at')) {
                $table->timestamp('lease_expires_at')->nullable()->after('execution_duration_ms');
            }
            if (!Schema::hasColumn('automation_executions', 'retry_count')) {
                $table->integer('retry_count')->default(0)->after('lease_expires_at');
            }
            if (!Schema::hasColumn('automation_executions', 'max_retries')) {
                $table->integer('max_retries')->default(3)->after('retry_count');
            }
            if (!Schema::hasColumn('automation_executions', 'failure_category')) {
                $table->string('failure_category')->nullable()->after('max_retries');
            }
        });

        // 3. Create workspace_events for persistent, tenant-isolated real-time live event streaming
        if (!Schema::hasTable('workspace_events')) {
            Schema::create('workspace_events', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('event_type'); // e.g. execution.stage_changed, connection.tested, schema.refreshed
                $table->string('resource_type')->nullable(); // AutomationExecution, DbConnection, etc.
                $table->string('resource_id')->nullable();
                $table->json('payload');
                $table->timestamp('created_at')->useCurrent();

                $table->index(['user_id', 'id']);
                $table->index('created_at');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('workspace_events');

        Schema::table('automation_executions', function (Blueprint $table) {
            $table->dropColumn([
                'queue_wait_ms',
                'execution_duration_ms',
                'lease_expires_at',
                'retry_count',
                'max_retries',
                'failure_category',
            ]);
        });

        Schema::table('db_connections', function (Blueprint $table) {
            $table->dropColumn([
                'last_tested_at',
                'server_version',
                'latency_ms',
                'connection_timeout',
                'error_message',
                'schema_freshness_at',
                'is_active',
            ]);
        });
    }
};
