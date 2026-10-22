<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Jobs\GenerateAutomationContentJob;
use App\Jobs\PublishAutomationContentJob;
use App\Services\Automation\ScheduleCalculator;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class QueueFairnessService
{
    /**
     * Default per-tenant concurrency cap to prevent single tenant backlog monopolization.
     */
    public const DEFAULT_TENANT_CONCURRENCY_CAP = 3;

    /** Runs of one customer that may execute at once (admin panel: Settings > Automations). */
    public static function concurrencyCap(): int
    {
        return max(1, (int) config('automation.tenant_concurrency', self::DEFAULT_TENANT_CONCURRENCY_CAP));
    }

    /**
     * Fair round-robin dispatch across tenants for runs due in the same cohort.
     *
     * Each item is either ['automation' => Automation, 'occurrence' => array] (from the
     * ScheduleCalculator) or a bare Automation, in which case today's local occurrence is used.
     */
    public function dispatchDueCohort(Collection $dueItems, ?int $concurrencyCap = null): array
    {
        $concurrencyCap ??= self::concurrencyCap();
        if ($dueItems->isEmpty()) {
            return ['dispatched' => 0, 'queued' => 0];
        }

        $calculator = app(ScheduleCalculator::class);
        $items = $dueItems->map(function ($item) use ($calculator) {
            if ($item instanceof Automation) {
                $today = CarbonImmutable::now($calculator->timezone($item))->toDateString();
                return ['automation' => $item, 'occurrence' => $calculator->occurrenceOn($item, $today)];
            }
            return $item;
        })->values();

        // 1. Group by tenant (user_id) and 2. interleave with strict round-robin
        $tenants = $items->groupBy(fn($i) => $i['automation']->user_id);
        $interleaved = [];
        $maxItems = $tenants->map(fn($group) => $group->count())->max() ?: 0;
        for ($i = 0; $i < $maxItems; $i++) {
            foreach ($tenants as $group) {
                if (isset($group[$i])) {
                    $interleaved[] = $group[$i];
                }
            }
        }

        $dispatchedCount = 0;
        $queuedCount = 0;

        // 3. Create one execution per occurrence with per-tenant concurrency checks
        foreach ($interleaved as $index => $item) {
            $automation = $item['automation'];
            $occ = $item['occurrence'];
            $runDate = $occ['run_date'];
            $idempotencyKey = "auto_{$automation->id}_{$runDate}_gen";

            if (AutomationExecution::where('idempotency_key', $idempotencyKey)->exists()) {
                continue;
            }

            $lock = Cache::lock("auto_sched_lock_{$automation->id}_{$runDate}", 30);
            if (!$lock->get()) {
                continue;
            }

            try {
                if (AutomationExecution::where('idempotency_key', $idempotencyKey)->exists()) {
                    continue;
                }

                $activeTenantJobs = AutomationExecution::where('user_id', $automation->user_id)
                    ->whereIn('status', ['RUNNING', 'GENERATING', 'PUBLISHING'])
                    ->count();
                $isImmediate = $activeTenantJobs < $concurrencyCap;

                $execution = AutomationExecution::create([
                    'user_id' => $automation->user_id,
                    'automation_id' => $automation->id,
                    'status' => 'QUEUED',
                    'trigger_type' => 'SCHEDULE',
                    'occurrence_date' => $runDate,
                    'scheduled_generation_at' => $occ['generation_at'],
                    'idempotency_key' => $idempotencyKey,
                    'publication_time' => $occ['publication_at'],
                    'max_retries' => 3,
                    'retry_count' => 0,
                ]);

                $tz = $occ['timezone'];
                $execution->addTimelineEvent(
                    'SCHEDULED_FAIR_DISPATCH',
                    "Scheduled run for {$runDate}: generation at {$occ['generation_at']->setTimezone($tz)->format('H:i')}, publication at {$occ['publication_at']->setTimezone($tz)->format('D j M H:i')} ({$tz}). Queue slot #{$index}; active tenant workers {$activeTenantJobs}/{$concurrencyCap}.",
                    [
                        'timezone' => $tz,
                        'run_date' => $runDate,
                        'generation_at' => $occ['generation_at']->toIso8601String(),
                        'publication_time' => $occ['publication_at']->toIso8601String(),
                        'round_robin_index' => $index,
                        'immediate' => $isImmediate,
                    ]
                );

                LiveEventService::publish($automation->user_id, 'execution.created', [
                    'execution_id' => $execution->id,
                    'automation_id' => $automation->id,
                    'status' => 'QUEUED',
                    'publication_time' => $occ['publication_at']->toIso8601String(),
                ], 'AutomationExecution', (string) $execution->id);

                if ($isImmediate) {
                    // The lease marks "job handed to the queue" so the waiting-run sweep never dispatches it twice.
                    $execution->update(['lease_expires_at' => now()->addMinutes(15)]);
                    GenerateAutomationContentJob::dispatch($execution->id);
                    $dispatchedCount++;
                } else {
                    $queuedCount++;
                }
            } finally {
                $lock->release();
            }
        }

        return ['dispatched' => $dispatchedCount, 'queued' => $queuedCount];
    }

    /**
     * Dispatch scheduled runs that were held back by the per-tenant concurrency cap, oldest first,
     * once that tenant has free capacity. Runs already handed to the queue carry a lease and are skipped.
     */
    public function dispatchWaitingRuns(?int $concurrencyCap = null): int
    {
        $concurrencyCap ??= self::concurrencyCap();
        $waiting = AutomationExecution::where('status', 'QUEUED')
            ->whereNull('lease_expires_at')
            ->orderBy('id')
            ->limit(200)
            ->get()
            ->groupBy('user_id');

        $dispatched = 0;
        foreach ($waiting as $userId => $runs) {
            $active = AutomationExecution::where('user_id', $userId)
                ->whereIn('status', ['RUNNING', 'GENERATING', 'PUBLISHING'])
                ->count();
            $free = max(0, $concurrencyCap - $active);
            foreach ($runs->take($free) as $run) {
                $claimed = AutomationExecution::where('id', $run->id)
                    ->where('status', 'QUEUED')
                    ->whereNull('lease_expires_at')
                    ->update(['lease_expires_at' => now()->addMinutes(15)]);
                if ($claimed) {
                    GenerateAutomationContentJob::dispatch($run->id);
                    $dispatched++;
                }
            }
        }

        return $dispatched;
    }

    /**
     * Recover orphaned executions left running after worker crashes or restarts.
     */
    public function recoverOrphanedLeases(int $leaseTimeoutMinutes = 15): int
    {
        $expiredExecutions = AutomationExecution::whereIn('status', ['GENERATING', 'PUBLISHING', 'RUNNING'])
            ->whereNotNull('lease_expires_at')
            ->where('lease_expires_at', '<=', now())
            ->get();

        $recoveredCount = 0;

        foreach ($expiredExecutions as $exec) {
            $lock = Cache::lock("lease_rec_lock_{$exec->id}", 30);
            if ($lock->get()) {
                try {
                    $fresh = AutomationExecution::find($exec->id);
                    if (!$fresh || !in_array($fresh->status, ['GENERATING', 'PUBLISHING', 'RUNNING'])) {
                        continue;
                    }

                    if ($fresh->retry_count < $fresh->max_retries) {
                        $newAttempt = $fresh->retry_count + 1;
                        // A stuck publish is retried as a publish (idempotent), never re-generated.
                        $wasPublishing = $fresh->status === 'PUBLISHING';
                        $fresh->update([
                            'retry_count' => $newAttempt,
                            'status' => $wasPublishing ? 'PUBLISHING' : 'QUEUED',
                            'lease_expires_at' => now()->addMinutes($leaseTimeoutMinutes),
                        ]);

                        $fresh->addTimelineEvent(
                            'LEASE_EXPIRED_RECOVERED',
                            "Worker lease expired without response. Safely requeued (Attempt {$newAttempt} of {$fresh->max_retries}).",
                            ['attempt' => $newAttempt]
                        );

                        LiveEventService::publish($fresh->user_id, 'execution.stage_changed', [
                            'execution_id' => $fresh->id,
                            'status' => $fresh->status,
                            'recovered' => true,
                        ], 'AutomationExecution', (string) $fresh->id);

                        if ($wasPublishing) {
                            PublishAutomationContentJob::dispatch($fresh->id);
                        } else {
                            GenerateAutomationContentJob::dispatch($fresh->id);
                        }

                        $recoveredCount++;
                    } else {
                        $fresh->update([
                            'status' => 'FAILED',
                            'failure_category' => 'LEASE_TIMEOUT_EXCEEDED',
                            'error_message' => 'Execution failed: worker lease expired and maximum retry attempts exhausted.',
                            'lease_expires_at' => null,
                        ]);

                        $fresh->addTimelineEvent(
                            'LEASE_RECOVERY_EXHAUSTED',
                            "Exhausted {$fresh->max_retries} lease retry attempts. Marked as terminal failure."
                        );

                        LiveEventService::publish($fresh->user_id, 'execution.failed', [
                            'execution_id' => $fresh->id,
                            'status' => 'FAILED',
                            'reason' => 'Lease timeout exhausted',
                        ], 'AutomationExecution', (string) $fresh->id);
                    }
                } finally {
                    $lock->release();
                }
            }
        }

        return $recoveredCount;
    }
}
