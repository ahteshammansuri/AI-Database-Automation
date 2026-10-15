<?php

namespace App\Services;

use App\Models\AutomationExecution;
use App\Models\AuditLog;
use App\Models\User;
use Exception;
use Carbon\Carbon;

class CompensationService
{
    public function __construct(
        protected SafeDatabaseExecutor $safeExecutor,
        protected FeatureFlagService $featureFlagService,
        protected DatabaseSafetyService $safetyService
    ) {}

    /**
     * Safely compensate (undo) a published automated execution.
     */
    public function compensateExecution(User $user, int $executionId): array
    {
        if (!$this->featureFlagService->isEnabled('FEATURE_UNDO_CENTER')) {
            throw new Exception("Undo / Compensation Center is disabled by platform feature flag.");
        }

        $execution = AutomationExecution::with(['automation.connection'])->find($executionId);
        if (!$execution) {
            throw new Exception("Execution #{$executionId} not found.");
        }

        // Tenant ownership check
        if ($execution->user_id !== $user->id) {
            throw new Exception("Unauthorized: You do not own execution #{$executionId}.");
        }

        if ($execution->status === 'COMPENSATED') {
            throw new Exception("Execution #{$executionId} has already been compensated/undone.");
        }

        if ($execution->status !== 'COMPLETED') {
            throw new Exception("Cannot undo execution with status '{$execution->status}'. Only 'COMPLETED' executions can be compensated.");
        }

        $targetRecordId = $execution->target_record_id;
        if (!$targetRecordId) {
            throw new Exception("Execution #{$executionId} has no target_record_id to compensate.");
        }

        // Check 24-hour compensation window
        $createdAt = Carbon::parse($execution->created_at);
        if ($createdAt->diffInHours(now()) > 24) {
            throw new Exception("Compensation window expired: Automations can only be undone within 24 hours of publication.");
        }

        $automation = $execution->automation;
        if (!$automation) {
            throw new Exception("Associated automation record not found.");
        }

        $connection = $automation->connection;
        if (!$connection) {
            throw new Exception("Associated database connection not found.");
        }

        $targetTable = $automation->target_table;
        if ($this->safetyService->isTableSensitive($targetTable)) {
            throw new Exception("Security violation: Restricted table '{$targetTable}' cannot undergo compensation.");
        }

        // Perform safe single-row delete for compensation
        $result = $this->safeExecutor->executeDeleteForCompensation(
            $connection,
            $targetTable,
            (int) $targetRecordId
        );

        // Update execution status
        $execution->update([
            'status' => 'COMPENSATED',
            'error_message' => 'Safely compensated/undone by user request on ' . now()->toIso8601String(),
        ]);

        // Record audit log
        AuditLog::create([
            'user_id' => $user->id,
            'action' => 'COMPENSATION_UNDO',
            'resource_type' => 'automation_execution',
            'resource_id' => $execution->id,
            'details' => json_encode([
                'target_table' => $targetTable,
                'target_record_id' => $targetRecordId,
                'connection_id' => $connection->id,
                'compensated_at' => now()->toIso8601String(),
            ]),
        ]);

        return [
            'success' => true,
            'execution_id' => $execution->id,
            'status' => 'COMPENSATED',
            'target_table' => $targetTable,
            'compensated_record_id' => (int) $targetRecordId,
            'message' => "Successfully compensated execution #{$execution->id}. Record #{$targetRecordId} in '{$targetTable}' was safely removed.",
        ];
    }
}
