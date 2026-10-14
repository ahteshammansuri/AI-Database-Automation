<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Jobs\GenerateAutomationContentJob;
use App\Jobs\PublishAutomationContentJob;
use App\Services\LiveEventService;
use App\Services\SafeDatabaseExecutor;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Exception;

class ExecutionController extends Controller
{
    public function index(Request $request)
    {
        $query = AutomationExecution::where('user_id', $request->user()->id)
            ->with(['automation:id,name,target_table,operation_mode,connection_id', 'versions']);

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        if ($request->filled('automation_id')) {
            $query->where('automation_id', $request->automation_id);
        }

        $pageSize = (int) $request->query('pageSize', 25);
        $executions = $query->orderBy('created_at', 'desc')->paginate($pageSize);

        return response()->json($executions);
    }

    public function show(Request $request, $id)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->with(['automation.connection', 'versions.approvalTokens'])
            ->firstOrFail();

        return response()->json($execution);
    }

    public function publishNow(Request $request, $id)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        if ($execution->status === 'PUBLISHED') {
            return response()->json([
                'message' => 'This execution record is already committed and published.',
                'execution' => $execution,
            ]);
        }

        $version = ContentVersion::where('execution_id', $execution->id)
            ->latest('version_number')
            ->first();

        if ($version && $version->status !== 'APPROVED') {
            $version->update(['status' => 'APPROVED']);
        }

        $execution->update(['status' => 'APPROVED']);
        $execution->addTimelineEvent('MANUAL_PUBLISH_TRIGGERED', 'User triggered immediate publication from portal.');

        PublishAutomationContentJob::dispatch($execution->id);

        LiveEventService::publish($request->user()->id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => 'PUBLISHING',
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => 'Publishing job dispatched to background worker.',
            'execution' => $execution,
        ]);
    }

    /**
     * Retry a failed or cancelled execution.
     */
    public function retry(Request $request, $id)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        if ($execution->status === 'PUBLISHED') {
            return response()->json(['message' => 'Cannot retry an already published execution.'], 422);
        }

        $newRetryCount = ($execution->retry_count ?? 0) + 1;
        $execution->update([
            'status' => 'QUEUED',
            'retry_count' => $newRetryCount,
            'error_message' => null,
            'failure_category' => null,
            'lease_expires_at' => now()->addMinutes(15),
        ]);

        $execution->addTimelineEvent(
            'USER_RETRY_TRIGGERED',
            "User triggered manual retry (Attempt #{$newRetryCount})."
        );

        GenerateAutomationContentJob::dispatch($execution->id);

        AuditLog::log($request->user()->id, 'EXECUTION_RETRIED', 'AutomationExecution', (string) $execution->id, [
            'retry_count' => $newRetryCount,
        ]);

        LiveEventService::publish($request->user()->id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => 'QUEUED',
            'retry_count' => $newRetryCount,
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => "Execution #{$execution->id} requeued successfully.",
            'execution' => $execution,
        ]);
    }

    /**
     * Cancel an execution prior to customer database commit.
     */
    public function cancel(Request $request, $id)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        if ($execution->status === 'PUBLISHED') {
            return response()->json(['message' => 'Cannot cancel a record that has already been published to the target database.'], 422);
        }

        $execution->update([
            'status' => 'CANCELLED',
            'lease_expires_at' => null,
            'error_message' => 'Execution cancelled by user.',
        ]);

        $execution->addTimelineEvent('USER_CANCELLED', 'Execution cancelled by user before publication commit.');

        AuditLog::log($request->user()->id, 'EXECUTION_CANCELLED', 'AutomationExecution', (string) $execution->id);

        LiveEventService::publish($request->user()->id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => 'CANCELLED',
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => "Execution #{$execution->id} cancelled.",
            'execution' => $execution,
        ]);
    }

    /**
     * Pause an execution.
     */
    public function pause(Request $request, $id)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        if (in_array($execution->status, ['PUBLISHED', 'FAILED', 'CANCELLED'])) {
            return response()->json(['message' => "Cannot pause execution in status '{$execution->status}'."], 422);
        }

        $execution->update([
            'status' => 'PAUSED',
            'lease_expires_at' => null,
        ]);

        $execution->addTimelineEvent('USER_PAUSED', 'Execution paused by user.');

        LiveEventService::publish($request->user()->id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => 'PAUSED',
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => "Execution #{$execution->id} paused.",
            'execution' => $execution,
        ]);
    }

    /**
     * Resume a paused execution.
     */
    public function resume(Request $request, $id)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->firstOrFail();

        if ($execution->status !== 'PAUSED') {
            return response()->json(['message' => "Execution is not currently paused."], 422);
        }

        $execution->update([
            'status' => 'QUEUED',
            'lease_expires_at' => now()->addMinutes(15),
        ]);

        $execution->addTimelineEvent('USER_RESUMED', 'Execution resumed by user.');

        GenerateAutomationContentJob::dispatch($execution->id);

        LiveEventService::publish($request->user()->id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => 'QUEUED',
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => "Execution #{$execution->id} resumed.",
            'execution' => $execution,
        ]);
    }

    /**
     * Post-Publication Editing: Safely update an explicitly identified published record in customer target DB.
     * Enforces single-row parameterized UPDATE, policy checks, immutable version tracking, and audit logging.
     */
    public function updateRecord(Request $request, $id, SafeDatabaseExecutor $executor)
    {
        $execution = AutomationExecution::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->with(['automation.connection', 'versions'])
            ->firstOrFail();

        if ($execution->status !== 'PUBLISHED' || empty($execution->target_record_id)) {
            return response()->json([
                'message' => 'Only published executions with a verified target record ID can be updated in the customer database.'
            ], 422);
        }

        $validated = $request->validate([
            'payload' => 'required|array',
        ]);

        $connection = $execution->automation->connection;
        $tableName = $execution->automation->target_table;
        $recordId = (int) $execution->target_record_id;

        // Disallow modifying sensitive system columns
        $forbiddenColumns = ['id', 'created_at', 'password', 'password_hash', 'token', 'secret', 'remember_token'];
        $cleanPayload = array_diff_key($validated['payload'], array_flip($forbiddenColumns));

        if (empty($cleanPayload)) {
            return response()->json(['message' => 'No eligible fields provided for update.'], 422);
        }

        $result = $executor->executeScopedUpdate(
            $connection,
            $tableName,
            'id',
            $recordId,
            $cleanPayload
        );

        // Record an immutable new ContentVersion representing this post-publication edit
        $latestVersionNumber = $execution->versions->max('version_number') ?: 1;
        $previousPayload = $execution->versions->last()?->payload ?? [];

        $newVersion = ContentVersion::create([
            'execution_id' => $execution->id,
            'user_id' => $request->user()->id,
            'version_number' => $latestVersionNumber + 1,
            'status' => 'PUBLISHED',
            'payload' => array_merge($previousPayload, $cleanPayload),
            'change_summary' => 'In-portal post-publication update committed to target database.',
        ]);

        $execution->addTimelineEvent(
            'RECORD_UPDATED_IN_PORTAL',
            "Operator updated published record #{$recordId} in table '{$tableName}' via portal (Version #{$newVersion->version_number})."
        );

        AuditLog::log($request->user()->id, 'PUBLISHED_RECORD_UPDATED', 'AutomationExecution', (string) $execution->id, [
            'target_table' => $tableName,
            'record_id' => $recordId,
            'updated_fields' => array_keys($cleanPayload),
            'version_number' => $newVersion->version_number,
        ]);

        LiveEventService::publish($request->user()->id, 'execution.record_updated', [
            'execution_id' => $execution->id,
            'record_id' => $recordId,
            'version_number' => $newVersion->version_number,
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => "Target record #{$recordId} in '{$tableName}' successfully updated in customer database.",
            'execution' => $execution->fresh(['versions']),
            'result' => $result,
            'version' => $newVersion,
        ]);
    }
}
