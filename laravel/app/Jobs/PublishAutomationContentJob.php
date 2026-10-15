<?php

namespace App\Jobs;

use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\AuditLog;
use App\Services\SafeDatabaseExecutor;
use App\Services\LiveEventService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Exception;

class PublishAutomationContentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public int $executionId
    ) {}

    public function handle(SafeDatabaseExecutor $executor): void
    {
        $startTime = microtime(true);

        $execution = AutomationExecution::with(['automation.connection'])->find($this->executionId);
        if (!$execution) {
            Log::error("PublishAutomationContentJob: Execution #{$this->executionId} not found.");
            return;
        }

        // Idempotency check: if already published, skip
        if ($execution->status === 'PUBLISHED') {
            Log::info("PublishAutomationContentJob: Execution #{$this->executionId} already published. Skipping.");
            return;
        }

        $automation = $execution->automation;
        if (!$automation || !$automation->is_active) {
            $execution->update([
                'status' => 'CANCELLED',
                'failure_category' => 'AUTOMATION_INACTIVE',
                'error_message' => 'Automation has been deactivated prior to publication.',
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('PUBLISH_ABORTED', 'Automation was deactivated by user before publication.');
            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'CANCELLED',
                'reason' => 'Automation deactivated',
            ], 'AutomationExecution', (string) $execution->id);
            return;
        }

        $connection = $automation->connection;
        if (!$connection || !$connection->is_active) {
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'CONNECTION_INACTIVE',
                'error_message' => 'Target database connection is disabled or missing.',
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('PUBLISH_FAILED', 'Target database connection is disabled or missing.');
            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'reason' => 'Connection inactive',
            ], 'AutomationExecution', (string) $execution->id);
            return;
        }

        // Strict tenant isolation verification
        if ($execution->user_id !== $automation->user_id || $automation->user_id !== $connection->user_id) {
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'TENANT_MISMATCH',
                'error_message' => 'Security check failed: Tenant ownership mismatch detected between execution, automation, and connection.',
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('SECURITY_VIOLATION', 'Tenant ownership mismatch detected.');
            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'reason' => 'Tenant mismatch',
            ], 'AutomationExecution', (string) $execution->id);
            return;
        }

        // Retrieve latest approved content version
        $version = ContentVersion::where('execution_id', $execution->id)
            ->where('status', 'APPROVED')
            ->latest('version_number')
            ->first();

        if (!$version) {
            $policy = $automation->safe_deadline_policy ?? 'notify_and_wait';

            if ($policy === 'publish_last_valid') {
                $candidate = ContentVersion::where('execution_id', $execution->id)
                    ->where('status', '!=', 'REJECTED')
                    ->latest('version_number')
                    ->first();

                if ($candidate && !empty($candidate->payload)) {
                    $candidate->update(['status' => 'APPROVED']);
                    $execution->addTimelineEvent(
                        'AUTO_APPROVED_DEADLINE',
                        "Auto-approved Version #{$candidate->version_number} at publication deadline under 'publish_last_valid' policy."
                    );
                    AuditLog::log(
                        $execution->user_id,
                        'CONTENT_AUTO_APPROVED_DEADLINE',
                        'ContentVersion',
                        (string) $candidate->id,
                        [
                            'execution_id' => $execution->id,
                            'version_number' => $candidate->version_number,
                            'policy' => 'publish_last_valid',
                        ]
                    );
                    $version = $candidate;
                } else {
                    $execution->update([
                        'status' => 'FAILED',
                        'failure_category' => 'NO_VALID_VERSION_TO_PUBLISH',
                        'error_message' => 'No valid unrejected content version available to publish at deadline.',
                        'lease_expires_at' => null,
                    ]);
                    $execution->addTimelineEvent('PUBLISH_ABORTED', 'No valid unrejected content version was available at deadline under publish_last_valid policy.');
                    LiveEventService::publish($execution->user_id, 'execution.failed', [
                        'execution_id' => $execution->id,
                        'status' => 'FAILED',
                        'reason' => 'No valid unrejected version',
                    ], 'AutomationExecution', (string) $execution->id);
                    return;
                }
            } elseif ($policy === 'skip') {
                $execution->update([
                    'status' => 'SKIPPED',
                    'failure_category' => 'DEADLINE_SKIPPED',
                    'error_message' => 'Publication deadline passed without approval. Execution skipped per automation safe deadline policy.',
                    'lease_expires_at' => null,
                ]);
                $execution->addTimelineEvent('PUBLISH_SKIPPED', 'Publication deadline passed without approval. Execution skipped per automation safe deadline policy.');
                AuditLog::log(
                    $execution->user_id,
                    'EXECUTION_SKIPPED_AT_DEADLINE',
                    'AutomationExecution',
                    (string) $execution->id,
                    [
                        'automation_id' => $automation->id,
                        'policy' => 'skip',
                    ]
                );
                LiveEventService::publish($execution->user_id, 'execution.skipped', [
                    'execution_id' => $execution->id,
                    'status' => 'SKIPPED',
                    'reason' => 'Deadline passed without approval (skip policy)',
                ], 'AutomationExecution', (string) $execution->id);
                return;
            } else {
                // Default: notify_and_wait
                $execution->update(['lease_expires_at' => null]);
                $execution->addTimelineEvent('DEADLINE_REACHED_WAITING', "Publication deadline reached without user approval. Automation policy is set to 'notify_and_wait'; publication will pause until explicit approval.");
                AuditLog::log(
                    $execution->user_id,
                    'PUBLICATION_DEADLINE_WAITING',
                    'AutomationExecution',
                    (string) $execution->id,
                    [
                        'automation_id' => $automation->id,
                        'policy' => 'notify_and_wait',
                    ]
                );
                LiveEventService::publish($execution->user_id, 'execution.deadline_reached', [
                    'execution_id' => $execution->id,
                    'status' => $execution->status,
                    'policy' => 'notify_and_wait',
                    'message' => 'Publication deadline reached without approval. Awaiting manual review.',
                ], 'AutomationExecution', (string) $execution->id);
                return;
            }
        }

        $execution->update([
            'status' => 'PUBLISHING',
            'lease_expires_at' => now()->addMinutes(10),
        ]);

        $execution->addTimelineEvent(
            'PUBLISHING_DISPATCHED',
            "Dispatching atomic transaction to target table '{$automation->target_table}'."
        );

        LiveEventService::publish($execution->user_id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => 'PUBLISHING',
            'target_table' => $automation->target_table,
        ], 'AutomationExecution', (string) $execution->id);

        try {
            // Extract relation options from automation field_mappings
            $relationOptions = [];
            if (!empty($automation->field_mappings)) {
                foreach ($automation->field_mappings as $mapping) {
                    $fieldName = $mapping['field_name'] ?? null;
                    if ($fieldName && !empty($mapping['relation_config'])) {
                        $relationOptions[$fieldName] = $mapping['relation_config'];
                    }
                }
            }

            $result = $executor->executeInsert(
                $connection,
                $automation->target_table,
                $version->payload,
                $relationOptions
            );

            $result['payload'] = $version->payload;
            $recordId = (string) ($result['record_id'] ?? 'published');
            $resolutions = $result['relation_resolutions'] ?? [];
            $publishDurationMs = (int) round((microtime(true) - $startTime) * 1000);

            $execution->update([
                'status' => 'PUBLISHED',
                'published_at' => now(),
                'target_record_id' => $recordId,
                'result_details' => $result,
                'relation_resolutions' => $resolutions,
                'lease_expires_at' => null, // Release lease
            ]);

            // Add timeline events for each relation resolution
            foreach ($resolutions as $res) {
                $execution->addTimelineEvent(
                    'RELATION_RESOLVED',
                    $res['details'] ?? "Resolved {$res['table']}",
                    $res
                );
            }

            $execution->addTimelineEvent(
                'TARGET_TRANSACTION_COMMITTED',
                "Successfully committed record #{$recordId} to MySQL table '{$automation->target_table}' ({$publishDurationMs}ms).",
                [
                    'target_table' => $automation->target_table,
                    'record_id' => $recordId,
                    'duration_ms' => $publishDurationMs,
                ]
            );

            AuditLog::log(
                $execution->user_id,
                'TARGET_RECORD_PUBLISHED',
                'AutomationExecution',
                (string) $execution->id,
                [
                    'target_table' => $automation->target_table,
                    'record_id' => $recordId,
                    'version_number' => $version->version_number,
                    'resolutions' => count($resolutions),
                ]
            );

            LiveEventService::publish($execution->user_id, 'execution.published', [
                'execution_id' => $execution->id,
                'status' => 'PUBLISHED',
                'record_id' => $recordId,
                'target_table' => $automation->target_table,
                'published_at' => now()->toIso8601String(),
            ], 'AutomationExecution', (string) $execution->id);

            Log::info("Successfully published execution #{$execution->id} to '{$automation->target_table}' (Record ID: {$recordId}).");
        } catch (Exception $e) {
            Log::error("Publish failed for execution #{$execution->id}: " . $e->getMessage());
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'TRANSACTION_ROLLBACK',
                'error_message' => $e->getMessage(),
                'lease_expires_at' => null,
            ]);
            $execution->addTimelineEvent('PUBLISH_FAILED', "Transaction failed and rolled back: {$e->getMessage()}");

            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'error' => $e->getMessage(),
            ], 'AutomationExecution', (string) $execution->id);
        }
    }
}
