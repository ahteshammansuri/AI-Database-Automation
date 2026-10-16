<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Jobs\PublishAutomationContentJob;
use App\Services\Automation\ScheduleCalculator;
use App\Services\QueueFairnessService;
use App\Services\LiveEventService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * Runs every minute (routes/console.php). Each tick:
 *  1. recovers executions whose worker lease expired;
 *  2. finds every schedule occurrence whose generation time has arrived and creates exactly one
 *     execution for it (idempotency key auto_{id}_{local date}_gen), or records it as MISSED when
 *     the scheduler was down past its publication time;
 *  3. dispatches runs held back by the tenant concurrency cap;
 *  4. publishes (or applies the timeout policy to) executions whose publication time has arrived;
 *  5. marks automations COMPLETED once their schedule has no future runs and nothing is in flight.
 */
class CheckAutomationSchedulesCommand extends Command
{
    protected $signature = 'automations:check-schedule';
    protected $description = 'Create due scheduled runs, publish due content and complete finished schedules';

    /** How far back a tick looks for occurrences it has not processed (covers scheduler downtime). */
    private const LOOKBACK_DAYS = 7;

    public function handle(QueueFairnessService $fairnessService, ScheduleCalculator $calculator): int
    {
        $now = CarbonImmutable::now()->utc();
        $this->info("Checking automation schedules at {$now->toIso8601String()}");

        // 1. Crash recovery
        $recovered = $fairnessService->recoverOrphanedLeases(15);
        if ($recovered > 0) {
            $this->warn("Recovered {$recovered} orphaned execution(s) from crashed or timed-out workers.");
        }

        // 2. Due and missed occurrences
        $automations = Automation::where('is_active', true)
            ->whereNull('completed_at')
            ->where('schedule_type', '!=', ScheduleCalculator::TYPE_NONE)
            ->get();

        $due = collect();
        foreach ($automations as $automation) {
            $anchor = CarbonImmutable::instance($automation->schedule_anchor_at ?? $automation->created_at ?? $now)->utc();
            $from = $anchor->greaterThan($now->subDays(self::LOOKBACK_DAYS)) ? $anchor : $now->subDays(self::LOOKBACK_DAYS);

            foreach ($calculator->occurrencesBetween($automation, $from, $now) as $occ) {
                $key = "auto_{$automation->id}_{$occ['run_date']}_gen";
                if (AutomationExecution::where('idempotency_key', $key)->exists()) {
                    continue;
                }
                if ($now->lessThan($occ['publication_at'])) {
                    $due->push(['automation' => $automation, 'occurrence' => $occ]);
                } else {
                    $this->recordMissedRun($automation, $occ, $key);
                }
            }
        }

        if ($due->isNotEmpty()) {
            $stats = $fairnessService->dispatchDueCohort($due);
            $this->info("Fair queue dispatch: {$stats['dispatched']} dispatched, {$stats['queued']} waiting for tenant capacity.");
        }

        // 3. Runs waiting for tenant capacity
        $released = $fairnessService->dispatchWaitingRuns();
        if ($released > 0) {
            $this->info("Dispatched {$released} run(s) that were waiting for tenant capacity.");
        }

        // 4. Publication deadlines
        $this->processDuePublications();

        // 5. Completion
        foreach ($automations as $automation) {
            $this->completeIfFinished($automation->fresh(), $calculator, $now);
        }

        return self::SUCCESS;
    }

    private function recordMissedRun(Automation $automation, array $occ, string $key): void
    {
        $tz = $occ['timezone'];
        $genLocal = $occ['generation_at']->setTimezone($tz)->format('D j M H:i');
        $pubLocal = $occ['publication_at']->setTimezone($tz)->format('D j M H:i');

        $execution = AutomationExecution::create([
            'user_id' => $automation->user_id,
            'automation_id' => $automation->id,
            'status' => 'MISSED',
            'trigger_type' => 'SCHEDULE',
            'occurrence_date' => $occ['run_date'],
            'scheduled_generation_at' => $occ['generation_at'],
            'idempotency_key' => $key,
            'publication_time' => $occ['publication_at'],
            'failure_category' => 'MISSED_WINDOW',
            'error_message' => "The scheduler was not running between {$genLocal} and {$pubLocal} ({$tz}), so this run was skipped. Nothing was written to your database.",
        ]);
        $execution->addTimelineEvent('RUN_MISSED', $execution->error_message, [
            'run_date' => $occ['run_date'],
            'generation_at' => $occ['generation_at']->toIso8601String(),
            'publication_at' => $occ['publication_at']->toIso8601String(),
        ]);

        AuditLog::log($automation->user_id, 'SCHEDULED_RUN_MISSED', 'AutomationExecution', (string) $execution->id, [
            'automation_id' => $automation->id,
            'run_date' => $occ['run_date'],
        ]);
        LiveEventService::publish($automation->user_id, 'execution.failed', [
            'execution_id' => $execution->id,
            'automation_id' => $automation->id,
            'status' => 'MISSED',
            'reason' => 'Scheduler was not running during the run window',
        ], 'AutomationExecution', (string) $execution->id);

        $this->warn("Recorded missed run {$key}.");
    }

    private function processDuePublications(): void
    {
        $duePublications = AutomationExecution::whereIn('status', ['APPROVED', 'PENDING_APPROVAL', 'READY_TO_PUBLISH'])
            ->whereNotNull('publication_time')
            ->where('publication_time', '<=', now())
            ->get();

        foreach ($duePublications as $exec) {
            $pubLock = Cache::lock("pub_exec_lock_{$exec->id}", 30);
            if (!$pubLock->get()) {
                continue;
            }

            try {
                $freshExec = AutomationExecution::find($exec->id);
                if (!$freshExec || !in_array($freshExec->status, ['APPROVED', 'PENDING_APPROVAL', 'READY_TO_PUBLISH'], true)) {
                    continue;
                }
                $automation = $freshExec->automation;

                if ($freshExec->status === 'APPROVED' || $freshExec->status === 'READY_TO_PUBLISH') {
                    $this->info("Publishing ready execution #{$freshExec->id} for '{$automation?->name}'");
                    $freshExec->update(['status' => 'PUBLISHING', 'lease_expires_at' => now()->addMinutes(10)]);
                    PublishAutomationContentJob::dispatch($freshExec->id);
                    continue;
                }

                // PENDING_APPROVAL at the publication deadline: apply the automation's timeout policy.
                $version = ContentVersion::where('execution_id', $freshExec->id)
                    ->where('status', 'PENDING_APPROVAL')
                    ->latest('version_number')
                    ->first();
                $policy = $automation?->timeout_policy ?? 'KEEP_DRAFT';

                if ($policy === 'AUTO_PUBLISH_LATEST') {
                    if (!$version) {
                        continue; // a regeneration is still running; the publish job's safe-deadline policy decides later
                    }
                    // A draft that finished after the deadline was never reviewable; wait for a human instead.
                    if ($version->created_at && $freshExec->publication_time && $version->created_at->greaterThan($freshExec->publication_time)) {
                        $already = collect($freshExec->timeline_events ?? [])->contains(fn($e) => ($e['stage'] ?? '') === 'LATE_DRAFT_HELD');
                        if (!$already) {
                            $freshExec->addTimelineEvent(
                                'LATE_DRAFT_HELD',
                                "Version #{$version->version_number} finished after the publication time, so the reviewer never had a chance to see it. It will not auto-publish; approve it to publish."
                            );
                        }
                        continue;
                    }

                    $version->update(['status' => 'APPROVED']);
                    $freshExec->update(['status' => 'PUBLISHING', 'lease_expires_at' => now()->addMinutes(10)]);
                    $freshExec->addTimelineEvent(
                        'TIMEOUT_AUTO_PUBLISH',
                        "Publication time reached without a decision; version #{$version->version_number} was auto-approved under the 'auto-publish latest' policy."
                    );
                    AuditLog::log($freshExec->user_id, 'CONTENT_AUTO_APPROVED_TIMEOUT', 'ContentVersion', (string) $version->id, [
                        'execution_id' => $freshExec->id,
                        'policy' => $policy,
                    ]);
                    PublishAutomationContentJob::dispatch($freshExec->id);
                    continue;
                }

                $isCancel = $policy === 'CANCEL';
                $freshExec->update([
                    'status' => $isCancel ? 'CANCELLED' : 'SKIPPED',
                    'failure_category' => 'APPROVAL_DEADLINE_MISSED',
                    'error_message' => $isCancel
                        ? 'Publication time reached without approval; the run was cancelled per the automation policy. Nothing was written.'
                        : 'Publication time reached without approval; the draft was kept and nothing was written to your database.',
                    'lease_expires_at' => null,
                ]);
                $freshExec->addTimelineEvent($isCancel ? 'TIMEOUT_CANCELLED' : 'TIMEOUT_KEPT_AS_DRAFT', $freshExec->error_message);
                LiveEventService::publish($freshExec->user_id, 'execution.skipped', [
                    'execution_id' => $freshExec->id,
                    'status' => $freshExec->status,
                    'reason' => 'Approval deadline missed',
                ], 'AutomationExecution', (string) $freshExec->id);
            } finally {
                $pubLock->release();
            }
        }
    }

    private function completeIfFinished(?Automation $automation, ScheduleCalculator $calculator, CarbonImmutable $now): void
    {
        if (!$automation || $automation->completed_at || !$automation->is_active) {
            return;
        }
        if ($calculator->nextOccurrence($automation, $now) !== null) {
            return;
        }

        $inFlight = $automation->executions()
            ->whereNotIn('status', AutomationExecution::TERMINAL_STATUSES)
            ->where(fn($q) => $q->whereNull('trigger_type')->orWhere('trigger_type', 'SCHEDULE'))
            ->exists();
        if ($inFlight) {
            return;
        }

        $automation->forceFill(['completed_at' => now()])->save();
        AuditLog::log($automation->user_id, 'AUTOMATION_SCHEDULE_COMPLETED', 'Automation', (string) $automation->id, [
            'schedule_type' => $automation->schedule_type,
            'end_date' => $automation->end_date,
        ]);
        LiveEventService::publish($automation->user_id, 'automation.completed', [
            'id' => $automation->id,
            'name' => $automation->name,
        ], 'Automation', (string) $automation->id);

        $this->info("Automation #{$automation->id} '{$automation->name}' has finished its schedule.");
    }
}
