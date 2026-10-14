<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Jobs\GenerateAutomationContentJob;
use App\Jobs\PublishAutomationContentJob;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class QueueFairnessService
{
    /**
     * Default per-tenant concurrency cap to prevent single tenant backlog monopolization.
     */
    public const DEFAULT_TENANT_CONCURRENCY_CAP = 3;

    /**
     * Fair round-robin dispatch across tenants for automations due in the same cohort.
     */
    public function dispatchDueCohort(Collection $dueAutomations, int $concurrencyCap = self::DEFAULT_TENANT_CONCURRENCY_CAP): array
    {
        if ($dueAutomations->isEmpty()) {
            return ['dispatched' => 0, 'queued' => 0];
        }

        // 1. Group automations by tenant (user_id)
        $tenants = $dueAutomations->groupBy('user_id');

        // 2. Interleave across tenants using strict round-robin
        $interleaved = [];
        $maxItems = $tenants->map(fn($group) => $group->count())->max() ?: 0;

        for ($i = 0; $i < $maxItems; $i++) {
            foreach ($tenants as $userId => $userAutomations) {
                if (isset($userAutomations[$i])) {
                    $interleaved[] = $userAutomations[$i];
                }
            }
        }

        $dispatchedCount = 0;
        $queuedCount = 0;

        // 3. Process interleaved jobs with per-tenant concurrency checks
        foreach ($interleaved as $index => $automation) {
            $userTz = $automation->timezone ?: 'UTC';
            $nowInUserTz = Carbon::now($userTz);
            $todayDate = $nowInUserTz->toDateString();

            $idempotencyKey = "auto_{$automation->id}_{$todayDate}_gen";

            // Enforce database-level idempotency
            if (AutomationExecution::where('idempotency_key', $idempotencyKey)->exists()) {
                continue;
            }

            // Concurrency lock to prevent distributed race conditions
            $lockKey = "auto_sched_lock_{$automation->id}_{$todayDate}";
            $lock = Cache::lock($lockKey, 30);

            if ($lock->get()) {
                try {
                    // Double check inside distributed lock
                    if (AutomationExecution::where('idempotency_key', $idempotencyKey)->exists()) {
                        continue;
                    }

                    $genTimeToday = Carbon::parse("{$todayDate} {$automation->generation_time}", $userTz);
                    $pubTimeToday = Carbon::parse("{$todayDate} {$automation->publication_time}", $userTz)->utc();
                    if ($pubTimeToday->lessThanOrEqualTo($genTimeToday->utc())) {
                        $pubTimeToday = $pubTimeToday->addDay();
                    }

                    // Check active running jobs for this tenant
                    $activeTenantJobs = AutomationExecution::where('user_id', $automation->user_id)
                        ->whereIn('status', ['RUNNING', 'GENERATING', 'PUBLISHING'])
                        ->count();

                    $isImmediate = $activeTenantJobs < $concurrencyCap;

                    $execution = AutomationExecution::create([
                        'user_id' => $automation->user_id,
                        'automation_id' => $automation->id,
                        'status' => 'QUEUED',
                        'idempotency_key' => $idempotencyKey,
                        'publication_time' => $pubTimeToday,
                        'max_retries' => 3,
                        'retry_count' => 0,
                    ]);

                    $execution->addTimelineEvent(
                        'SCHEDULED_FAIR_DISPATCH',
                        "Dispatched in due cohort via tenant round-robin (Slot #{$index}). Active tenant workers: {$activeTenantJobs}/{$concurrencyCap}.",
                        [
                            'timezone' => $userTz,
                            'publication_time' => $pubTimeToday->toIso8601String(),
                            'round_robin_index' => $index,
                            'immediate' => $isImmediate,
                        ]
                    );

                    LiveEventService::publish($automation->user_id, 'execution.created', [
                        'execution_id' => $execution->id,
                        'automation_id' => $automation->id,
                        'status' => 'QUEUED',
                        'publication_time' => $pubTimeToday->toIso8601String(),
                    ], 'AutomationExecution', (string) $execution->id);

                    if ($isImmediate) {
                        GenerateAutomationContentJob::dispatch($execution->id);
                        $dispatchedCount++;
                    } else {
                        $queuedCount++;
                    }
                } finally {
                    $lock->release();
                }
            }
        }

        return ['dispatched' => $dispatchedCount, 'queued' => $queuedCount];
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
                        $fresh->update([
                            'retry_count' => $newAttempt,
                            'status' => 'QUEUED',
                            'lease_expires_at' => now()->addMinutes($leaseTimeoutMinutes),
                        ]);

                        $fresh->addTimelineEvent(
                            'LEASE_EXPIRED_RECOVERED',
                            "Worker lease expired without response. Safely requeued (Attempt {$newAttempt} of {$fresh->max_retries}).",
                            ['attempt' => $newAttempt]
                        );

                        LiveEventService::publish($fresh->user_id, 'execution.stage_changed', [
                            'execution_id' => $fresh->id,
                            'status' => 'QUEUED',
                            'recovered' => true,
                        ], 'AutomationExecution', (string) $fresh->id);

                        if ($fresh->status === 'PUBLISHING') {
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
