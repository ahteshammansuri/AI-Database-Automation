<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DbConnectionController;
use App\Http\Controllers\Api\SchemaController;
use App\Http\Controllers\Api\AiProviderController;
use App\Http\Controllers\Api\KnowledgeController;
use App\Http\Controllers\Api\AutomationController;
use App\Http\Controllers\Api\ExecutionController;
use App\Http\Controllers\Api\ApprovalController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\LiveEventController;
use App\Http\Controllers\Api\AgentController;
use App\Http\Controllers\Api\ModelRoleController;
use App\Http\Controllers\FeatureFlagController;
use App\Http\Controllers\SimulationController;
use App\Http\Controllers\SchemaDriftController;
use App\Http\Controllers\CompensationController;
use App\Http\Controllers\QualityScoreController;
use App\Http\Controllers\TemplateController;
use App\Http\Controllers\DatabaseInsightsController;
use App\Http\Controllers\CalendarController;

// Public Health Check
Route::get('/health', fn () => response()->json(['status' => 'healthy', 'service' => 'laravel-control-plane']));

// Public Authentication
Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::get('/login', fn () => response()->json(['message' => 'Unauthenticated.'], 401))->name('login');

// Public Token-Signed Review & Approval (from email notification links)
Route::get('/approvals/{token}', [ApprovalController::class, 'review']);
Route::post('/approvals/{token}/approve', [ApprovalController::class, 'approve']);
Route::post('/approvals/{token}/reject', [ApprovalController::class, 'reject']);

// Real-Time Server-Sent Events (SSE) Stream (Authenticates via query param token or Bearer header)
Route::get('/live/stream', [LiveEventController::class, 'stream']);

// Protected Application Routes (Scoped by Authenticated User)
Route::middleware('auth:sanctum')->group(function () {
    // Current user & session
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Dynamic Dashboard Stats
    Route::get('/dashboard/stats', [DashboardController::class, 'stats']);

    // Real-Time Event Catch-Up & Polling Fallback
    Route::get('/live/events', [LiveEventController::class, 'events']);

    // Database Connections
    Route::get('/connections', [DbConnectionController::class, 'index']);
    Route::post('/connections', [DbConnectionController::class, 'store']);
    Route::post('/connections/test', [DbConnectionController::class, 'test']);
    Route::get('/connections/{id}', [DbConnectionController::class, 'show']);
    Route::put('/connections/{id}', [DbConnectionController::class, 'update']);
    Route::delete('/connections/{id}', [DbConnectionController::class, 'destroy']);
    Route::post('/connections/{id}/refresh-schema', [DbConnectionController::class, 'refreshSchema']);

    // Schema Discovery
    Route::get('/connections/{id}/schema', [SchemaController::class, 'introspect']);
    Route::get('/connections/{id}/lookup-values', [SchemaController::class, 'lookupRecords']);
    Route::post('/connections/{id}/tables/{table}/annotate', [SchemaController::class, 'annotateTable']);

    // AI Providers
    Route::get('/ai-providers', [AiProviderController::class, 'index']);
    Route::post('/ai-providers', [AiProviderController::class, 'store']);
    Route::get('/ai-providers/health', [AiProviderController::class, 'health']);

    // Model Roles (Planning, Generation, Classification, Summarization)
    Route::get('/model-roles', [ModelRoleController::class, 'index']);
    Route::put('/model-roles', [ModelRoleController::class, 'update']);
    Route::post('/model-roles/probe', [ModelRoleController::class, 'probe']);

    // Knowledge Base & RAG
    Route::get('/knowledge', [KnowledgeController::class, 'index']);
    Route::post('/knowledge', [KnowledgeController::class, 'upload']);
    Route::post('/knowledge/upload', [KnowledgeController::class, 'upload']);
    Route::post('/knowledge/query', [KnowledgeController::class, 'query']);
    Route::delete('/knowledge/{id}', [KnowledgeController::class, 'destroy']);

    // Automations
    Route::get('/automations', [AutomationController::class, 'index']);
    Route::post('/automations', [AutomationController::class, 'store']);
    Route::post('/automations/manual-publish', [AutomationController::class, 'manualPublish']);
    Route::post('/automations/preview-ai', [AutomationController::class, 'previewAi']);
    Route::post('/automations/field-assist', [AutomationController::class, 'fieldAssist']);
    Route::post('/automations/propose-plan', [AutomationController::class, 'proposePlan']);
    Route::get('/automations/{id}', [AutomationController::class, 'show']);
    Route::put('/automations/{id}', [AutomationController::class, 'update']);
    Route::delete('/automations/{id}', [AutomationController::class, 'destroy']);
    Route::post('/automations/{id}/trigger', [AutomationController::class, 'trigger']);
    Route::get('/automations/{id}/field-mappings', [AutomationController::class, 'getFieldMappings']);
    Route::put('/automations/{id}/field-mappings', [AutomationController::class, 'updateFieldMappings']);

    // Executions
    Route::get('/executions', [ExecutionController::class, 'index']);
    Route::get('/executions/{id}', [ExecutionController::class, 'show']);
    Route::post('/executions/{id}/publish-now', [ExecutionController::class, 'publishNow']);
    Route::post('/executions/{id}/retry', [ExecutionController::class, 'retry']);
    Route::post('/executions/{id}/cancel', [ExecutionController::class, 'cancel']);
    Route::post('/executions/{id}/pause', [ExecutionController::class, 'pause']);
    Route::post('/executions/{id}/resume', [ExecutionController::class, 'resume']);
    Route::post('/executions/{id}/update-record', [ExecutionController::class, 'updateRecord']);

    // Approvals (Authenticated view & in-portal review/editing)
    Route::get('/approvals', [ApprovalController::class, 'index']);
    Route::put('/approvals/{id}/payload', [ApprovalController::class, 'updatePayload']);
    Route::post('/approvals/{id}/portal-approve', [ApprovalController::class, 'approveVersion']);
    Route::post('/approvals/{id}/portal-reject', [ApprovalController::class, 'rejectVersion']);

    // Audit Logs
    Route::get('/audit-logs', [AuditLogController::class, 'index']);

    // Autonomous AI Agent Assistant
    Route::get('/agent/conversations', [AgentController::class, 'index']);
    Route::post('/agent/conversations', [AgentController::class, 'store']);
    Route::get('/agent/conversations/{id}', [AgentController::class, 'show']);
    Route::post('/agent/conversations/{id}/messages', [AgentController::class, 'postMessage']);
    Route::get('/agent/tasks/{id}', [AgentController::class, 'getTask']);
    Route::post('/agent/tasks/{id}/interrupt', [AgentController::class, 'interrupt']);
    Route::post('/agent/tasks/{id}/correct', [AgentController::class, 'correct']);
    Route::post('/agent/tasks/{id}/confirm', [AgentController::class, 'confirm']);
    Route::get('/agent/tasks/{id}/timeline', [AgentController::class, 'timeline']);
    Route::get('/agent/preferences', [AgentController::class, 'getPreferences']);
    Route::put('/agent/preferences', [AgentController::class, 'updatePreferences']);
    Route::get('/agent/tools', [AgentController::class, 'tools']);
    Route::post('/agent/ui-actions/{correlationId}/ack', [AgentController::class, 'uiAck']);
    Route::post('/agent/heartbeat', [AgentController::class, 'heartbeat']);
    Route::get('/agent/surfaces', [AgentController::class, 'surfaces']);
    Route::post('/agent/tasks/{id}/continue', [AgentController::class, 'continueAfterSecret']);

    // Phase 6: Feature Flags & Advanced Platform Capabilities
    Route::get('/features', [FeatureFlagController::class, 'index']);
    Route::post('/automations/{id}/dry-run', [SimulationController::class, 'dryRun']);
    Route::post('/connections/{id}/detect-drift', [SchemaDriftController::class, 'detectDrift']);
    Route::post('/executions/{id}/undo', [CompensationController::class, 'undo']);
    Route::post('/content/evaluate-quality', [QualityScoreController::class, 'evaluate']);
    Route::get('/templates', [TemplateController::class, 'index']);
    Route::post('/automations/from-template', [TemplateController::class, 'createFromTemplate']);
    Route::get('/connections/{id}/insights', [DatabaseInsightsController::class, 'insights']);
    Route::get('/calendar/events', [CalendarController::class, 'events']);
    Route::post('/calendar/reschedule/{automationId}', [CalendarController::class, 'reschedule']);
});
