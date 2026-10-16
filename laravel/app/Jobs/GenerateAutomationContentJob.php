<?php

namespace App\Jobs;

use App\Models\AuditLog;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Services\Automation\ContentPipeline;
use App\Services\ContextPackageService;
use App\Services\EmailApprovalService;
use App\Services\LiveEventService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Background generation for one execution: claims it atomically, runs the content pipeline
 * (text, parent decisions, images, read-only write plan), stores an immutable ContentVersion and
 * either sends the review email or holds the content for its publication time.
 */
class GenerateAutomationContentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Below the database queue's retry_after (720s) so a slow run is never handed to a second worker. */
    public int $timeout = 690;
    /** Retries are owned by the lease-recovery sweep, which keeps the attempt count on the execution. */
    public int $tries = 1;

    private const CLAIMABLE = ['QUEUED', 'PENDING_GENERATION', 'REGENERATING', 'RUNNING'];

    public function __construct(
        public int $executionId,
        public ?string $rejectionFeedback = null
    ) {}

    public function handle(
        ContentPipeline $pipeline,
        EmailApprovalService $approvalService,
        ContextPackageService $contextPackageService
    ): void {
        $startTime = microtime(true);

        $execution = AutomationExecution::with('automation.connection')->find($this->executionId);
        if (!$execution) {
            Log::error("GenerateAutomationContentJob: Execution #{$this->executionId} not found.");
            return;
        }

        $automation = $execution->automation;
        if (!$automation || !$automation->is_active) {
            $execution->update([
                'status' => 'CANCELLED',
                'failure_category' => 'CONFIGURATION_INACTIVE',
                'error_message' => 'The automation is paused or was deleted, so this run did not generate anything.',
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('JOB_ABORTED', 'Automation is paused or missing.');
            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'CANCELLED',
                'reason' => 'Automation inactive',
            ], 'AutomationExecution', (string) $execution->id);
            return;
        }

        // Atomic claim: exactly one worker generates a given execution.
        $claimed = AutomationExecution::where('id', $execution->id)
            ->whereIn('status', self::CLAIMABLE)
            ->update([
                'status' => 'GENERATING',
                'generation_started_at' => now(),
                'lease_expires_at' => now()->addMinutes(15),
            ]);
        if (!$claimed) {
            Log::info("GenerateAutomationContentJob: execution #{$execution->id} is '{$execution->status}', not claimable; skipping.");
            return;
        }
        $execution->refresh();

        $queueWaitMs = $execution->created_at ? max(0, (int) abs(now()->diffInMilliseconds($execution->created_at))) : 0;
        $execution->update(['queue_wait_ms' => $queueWaitMs]);

        $execution->addTimelineEvent(
            'TRIGGER_RECEIVED',
            ($this->rejectionFeedback ? 'Regenerating' : 'Generating') . " content for '{$automation->name}' (table `{$automation->target_table}`).",
            [
                'mode' => $automation->operation_mode,
                'rejection_retry' => !empty($this->rejectionFeedback),
                'queue_wait_ms' => $queueWaitMs,
            ]
        );
        LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'automation_id' => $automation->id,
            'status' => 'GENERATING',
            'stage' => 'GENERATING',
        ], 'AutomationExecution', (string) $execution->id);

        try {
            $versionNumber = ContentVersion::where('execution_id', $execution->id)->count() + 1;

            $result = $pipeline->run(
                $automation,
                [
                    'rejection_feedback' => $this->rejectionFeedback,
                    'recent_titles' => $contextPackageService->loadRecentTitles($automation, 50),
                    'publication_time' => $execution->publication_time,
                ],
                fn(string $stage, string $message, ?array $meta = null) => $execution->addTimelineEvent($stage, $message, $meta)
            );
            $payload = $result['payload'];
            $meta = $result['meta'];
            $durationMs = (int) round((microtime(true) - $startTime) * 1000);

            if (!$meta['can_publish']) {
                $errors = array_values(array_filter($meta['issues'], fn($i) => $i['level'] === 'error'));
                $message = 'The generated content cannot be written: ' . implode(' ', array_map(fn($i) => $i['message'], $errors));
                // Keep what was produced visible, but never publishable.
                ContentVersion::create([
                    'user_id' => $automation->user_id,
                    'execution_id' => $execution->id,
                    'version_number' => $versionNumber,
                    'payload' => $payload,
                    'meta' => $meta,
                    'rejection_feedback' => $this->rejectionFeedback,
                    'status' => 'INVALID',
                ]);
                $execution->update([
                    'status' => 'FAILED',
                    'failure_category' => 'VALIDATION_FAILED',
                    'error_message' => Str::limit($message, 1900),
                    'generation_completed_at' => now(),
                    'execution_duration_ms' => $durationMs,
                    'lease_expires_at' => null,
                ]);
                $execution->addTimelineEvent('VALIDATION_FAILED', $message, ['issues' => $errors]);
                LiveEventService::publish($automation->user_id, 'execution.failed', [
                    'execution_id' => $execution->id,
                    'status' => 'FAILED',
                    'error' => Str::limit($message, 300),
                ], 'AutomationExecution', (string) $execution->id);
                return;
            }

            $requiresApproval = (bool) $automation->requires_approval;
            $version = ContentVersion::create([
                'user_id' => $automation->user_id,
                'execution_id' => $execution->id,
                'version_number' => $versionNumber,
                'payload' => $payload,
                'meta' => $meta,
                'rejection_feedback' => $this->rejectionFeedback,
                'status' => $requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED',
            ]);

            $pubTime = $execution->publication_time;
            $execution->update([
                'generation_completed_at' => now(),
                'execution_duration_ms' => $durationMs,
                'status' => $requiresApproval ? 'PENDING_APPROVAL' : 'READY_TO_PUBLISH',
                'lease_expires_at' => null,
                'failure_category' => null,
                'error_message' => null,
            ]);

            $execution->addTimelineEvent(
                'VERSION_RECORDED',
                "Saved version #{$versionNumber} (" . count($meta['write_plan']['steps'] ?? []) . ' write step(s) planned' . (!empty($meta['media']) ? ', ' . count($meta['media']) . ' image(s)' : '') . ').',
                ['status' => $version->status, 'requires_approval' => $requiresApproval, 'duration_ms' => $durationMs]
            );
            AuditLog::log($automation->user_id, 'VERSION_GENERATED', 'AutomationExecution', (string) $execution->id, [
                'version_number' => $versionNumber,
                'requires_approval' => $requiresApproval,
                'images' => count($meta['media'] ?? []),
                'parents_to_create' => count(array_filter($meta['relations'] ?? [], fn($r) => ($r['decision'] ?? '') === 'create')),
            ]);

            if ($requiresApproval) {
                $recipient = $automation->reviewer_email ?: $automation->user?->email;
                if ($recipient) {
                    $delivery = $approvalService->dispatchApprovalNotification($version, $recipient);
                    if ($delivery['sent']) {
                        $execution->addTimelineEvent('NOTIFICATION_SENT', "Review email for version #{$versionNumber} sent to {$recipient}.");
                    } else {
                        $execution->addTimelineEvent('NOTIFICATION_FAILED', "Review email to {$recipient} could not be sent: {$delivery['error']}. You can still review it on the Approvals page.");
                    }
                } else {
                    $execution->addTimelineEvent('NOTIFICATION_SKIPPED', 'No reviewer email is set; review it on the Approvals page.');
                }
                LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
                    'execution_id' => $execution->id,
                    'status' => 'PENDING_APPROVAL',
                    'version_id' => $version->id,
                ], 'AutomationExecution', (string) $execution->id);
                return;
            }

            if ($pubTime && $pubTime->isFuture()) {
                $execution->addTimelineEvent(
                    'READY_FOR_SCHEDULED_PUBLICATION',
                    'Content is valid. Approval is off, so it will be published automatically at ' . $pubTime->copy()->setTimezone($automation->timezone ?: 'UTC')->format('D j M H:i T') . '.',
                    ['publication_time' => $pubTime->toIso8601String()]
                );
                LiveEventService::publish($automation->user_id, 'execution.stage_changed', [
                    'execution_id' => $execution->id,
                    'status' => 'READY_TO_PUBLISH',
                    'publication_time' => $pubTime->toIso8601String(),
                ], 'AutomationExecution', (string) $execution->id);
                return;
            }

            $execution->update(['status' => 'PUBLISHING', 'lease_expires_at' => now()->addMinutes(10)]);
            $execution->addTimelineEvent('AUTO_PUBLISHING_DISPATCHED', 'Approval is off and the publication time has arrived; publishing now.');
            PublishAutomationContentJob::dispatch($execution->id);
        } catch (\Throwable $e) {
            Log::error("Generation failed for execution #{$execution->id}: " . $e->getMessage());
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'GENERATION_ERROR',
                'error_message' => Str::limit($e->getMessage(), 1900),
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('GENERATION_FAILED', 'Generation failed: ' . Str::limit($e->getMessage(), 500));
            LiveEventService::publish($automation->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'error' => Str::limit($e->getMessage(), 300),
            ], 'AutomationExecution', (string) $execution->id);
        }
    }
}
