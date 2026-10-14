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
        $connection = $automation->connection;

        // Retrieve latest approved content version
        $version = ContentVersion::where('execution_id', $execution->id)
            ->where('status', 'APPROVED')
            ->latest('version_number')
            ->first();

        if (!$version) {
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'NO_APPROVED_VERSION',
                'error_message' => 'No approved content version available to publish.',
            ]);
            $execution->addTimelineEvent('PUBLISH_ABORTED', 'No approved content version was available at deadline.');
            LiveEventService::publish($execution->user_id, 'execution.failed', [
                'execution_id' => $execution->id,
                'status' => 'FAILED',
                'reason' => 'No approved version',
            ], 'AutomationExecution', (string) $execution->id);
            return;
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
