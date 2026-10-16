<?php

namespace App\Console\Commands;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Jobs\PublishAutomationContentJob;
use App\Services\QueueFairnessService;
use App\Services\LiveEventService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Carbon\Carbon;

class CheckAutomationSchedulesCommand extends Command
{
    protected $signature = 'automations:check-schedule';
    protected $description = 'Scan active automations and trigger due generations or publication jobs with fair queue round-robin and lease recovery';

    public function handle(QueueFairnessService $fairnessService): int
    {
        $this->info("Checking automation schedules at " . now()->toIso8601String());

        // 1. Crash recovery: recover orphaned executions with expired worker leases
        $recovered = $fairnessService->recoverOrphanedLeases(15);
        if ($recovered > 0) {
            $this->warn("Recovered {$recovered} orphaned execution(s) from crashed or timed-out workers.");
        }

        // 2. Identify all automations currently due for generation
        $activeAutomations = Automation::where('is_active', true)->get();
        $dueForGeneration = collect();

        foreach ($activeAutomations as $automation) {
            $userTz = $automation->timezone ?: 'UTC';
            if ($userTz === 'Asia/Calcutta') {
                $userTz = 'Asia/Kolkata';
            }
            try {
                $nowInUserTz = Carbon::now($userTz);
            } catch (\Throwable) {
                $userTz = 'UTC';
                $nowInUserTz = Carbon::now('UTC');
            }
            $todayDate = $nowInUserTz->toDateString();

            // Check if automation start_date has arrived
            if (!empty($automation->start_date)) {
                if ($todayDate < $automation->start_date) {
                    continue; // Start date is in future
                }
                if ($automation->schedule_type === 'ONE_TIME' && $todayDate !== $automation->start_date) {
                    continue; // One time only runs on specified start date
                }
            }

            // Check generation trigger with 12-hour safe catch-up tolerance window
            try {
                $genTimeToday = Carbon::parse("{$todayDate} {$automation->generation_time}", $userTz);
            } catch (\Throwable) {
                $genTimeToday = Carbon::parse("{$todayDate} {$automation->generation_time}", 'UTC');
            }

            if ($nowInUserTz->greaterThanOrEqualTo($genTimeToday)) {
                if ($nowInUserTz->diffInHours($genTimeToday) < 12) {
                    $idempotencyKey = "auto_{$automation->id}_{$todayDate}_gen";
                    if (!AutomationExecution::where('idempotency_key', $idempotencyKey)->exists()) {
                        $dueForGeneration->push($automation);
                    }
                }
            }
        }

        // 3. Dispatch generation cohort using fair queue round-robin
        if ($dueForGeneration->isNotEmpty()) {
            $stats = $fairnessService->dispatchDueCohort($dueForGeneration);
            $this->info("Fair queue dispatch: {$stats['dispatched']} immediate jobs dispatched, {$stats['queued']} queued under tenant limits.");
        }

        // 4. Check publication due executions (including READY_TO_PUBLISH and APPROVED)
        $duePublications = AutomationExecution::whereIn('status', ['APPROVED', 'PENDING_APPROVAL', 'READY_TO_PUBLISH'])
            ->whereNotNull('publication_time')
            ->where('publication_time', '<=', now())
            ->get();

        foreach ($duePublications as $exec) {
            $pubLockKey = "pub_exec_lock_{$exec->id}";
            $pubLock = Cache::lock($pubLockKey, 30);

            if ($pubLock->get()) {
                try {
                    $freshExec = AutomationExecution::find($exec->id);
                    if (!$freshExec || in_array($freshExec->status, ['PUBLISHED', 'PUBLISHING', 'FAILED'])) {
                        continue;
                    }

                    $automation = $freshExec->automation;

                    // Direct publish for APPROVED or READY_TO_PUBLISH
                    if ($freshExec->status === 'APPROVED' || $freshExec->status === 'READY_TO_PUBLISH') {
                        $this->info("Publishing ready execution #{$freshExec->id} for '{$automation?->name}'");
                        PublishAutomationContentJob::dispatch($freshExec->id);
                    } elseif ($freshExec->status === 'PENDING_APPROVAL') {
                        // Handle unapproved execution at publication deadline based on policy
                        if ($automation && $automation->timeout_policy === 'AUTO_PUBLISH_LATEST') {
                            $this->info("Auto-approving latest version on timeout for execution #{$freshExec->id}");
                            $version = ContentVersion::where('execution_id', $freshExec->id)
                                ->where('status', 'PENDING_APPROVAL')
                                ->latest('version_number')
                                ->first();

                            if ($version) {
                                $version->update(['status' => 'APPROVED']);
                                $freshExec->update(['status' => 'READY_TO_PUBLISH']);
                                $freshExec->addTimelineEvent(
                                    'TIMEOUT_AUTO_PUBLISH',
                                    "Publication deadline reached without rejection; auto-approved version #{$version->version_number} per policy."
                                );
                                PublishAutomationContentJob::dispatch($freshExec->id);
                            }
                        } else {
                            $this->warn("Cancelling execution #{$freshExec->id} due to timeout policy '{$automation?->timeout_policy}'");
                            $freshExec->update([
                                'status' => 'FAILED',
                                'failure_category' => 'APPROVAL_DEADLINE_MISSED',
                                'error_message' => "Publication deadline reached without approval ({$automation?->timeout_policy}).",
                            ]);
                            $freshExec->addTimelineEvent('TIMEOUT_CANCELLED', 'Publication deadline passed without approval; cancelled per policy.');
                            LiveEventService::publish($freshExec->user_id, 'execution.failed', [
                                'execution_id' => $freshExec->id,
                                'status' => 'FAILED',
                                'reason' => 'Approval deadline missed',
                            ], 'AutomationExecution', (string) $freshExec->id);
                        }
                    }
                } finally {
                    $pubLock->release();
                }
            }
        }

        return self::SUCCESS;
    }
}
