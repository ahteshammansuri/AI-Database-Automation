<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Schedule windows (end date, weekdays, completion), per-automation generation options
 * (tone, body format, length, image provider) and per-version metadata (relations, media,
 * write plan) for the 2026-10-16 automation engine upgrade.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automations', function (Blueprint $table) {
            if (!Schema::hasColumn('automations', 'end_date')) {
                $table->date('end_date')->nullable()->after('start_date');
            }
            if (!Schema::hasColumn('automations', 'weekly_days')) {
                // ISO-8601 weekdays, 1 = Monday ... 7 = Sunday
                $table->json('weekly_days')->nullable()->after('end_date');
            }
            if (!Schema::hasColumn('automations', 'schedule_anchor_at')) {
                // Occurrences whose generation time is before this instant are never run or reported
                // as missed: they happened before the schedule was created, changed or resumed.
                $table->timestamp('schedule_anchor_at')->nullable()->after('weekly_days');
            }
            if (!Schema::hasColumn('automations', 'completed_at')) {
                $table->timestamp('completed_at')->nullable()->after('schedule_anchor_at');
            }
            if (!Schema::hasColumn('automations', 'generation_options')) {
                $table->json('generation_options')->nullable()->after('prompt_context');
            }
        });

        Schema::table('automation_executions', function (Blueprint $table) {
            if (!Schema::hasColumn('automation_executions', 'trigger_type')) {
                $table->string('trigger_type', 24)->nullable()->after('status');
            }
            if (!Schema::hasColumn('automation_executions', 'occurrence_date')) {
                $table->date('occurrence_date')->nullable()->after('trigger_type');
            }
            if (!Schema::hasColumn('automation_executions', 'scheduled_generation_at')) {
                $table->timestamp('scheduled_generation_at')->nullable()->after('occurrence_date');
            }
        });

        Schema::table('content_versions', function (Blueprint $table) {
            if (!Schema::hasColumn('content_versions', 'meta')) {
                $table->json('meta')->nullable()->after('payload');
            }
        });

        // Manual-publishing containers were stored as ONE_TIME schedules without a date, which the
        // old scheduler picked up every day. Mark them as non-scheduled.
        DB::table('automations')
            ->where('operation_mode', 'MANUAL_SCHEDULE')
            ->where('ai_provider', 'none')
            ->where('ai_model', 'manual')
            ->update(['schedule_type' => 'NONE']);

        // Existing schedules start counting occurrences from now, so the upgrade never back-fills
        // or reports "missed" runs that predate it.
        DB::table('automations')->whereNull('schedule_anchor_at')->update(['schedule_anchor_at' => now()]);
    }

    public function down(): void
    {
        Schema::table('content_versions', function (Blueprint $table) {
            if (Schema::hasColumn('content_versions', 'meta')) {
                $table->dropColumn('meta');
            }
        });

        Schema::table('automation_executions', function (Blueprint $table) {
            foreach (['scheduled_generation_at', 'occurrence_date', 'trigger_type'] as $col) {
                if (Schema::hasColumn('automation_executions', $col)) {
                    $table->dropColumn($col);
                }
            }
        });

        Schema::table('automations', function (Blueprint $table) {
            foreach (['generation_options', 'completed_at', 'schedule_anchor_at', 'weekly_days', 'end_date'] as $col) {
                if (Schema::hasColumn('automations', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
