<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApprovalToken;
use App\Models\ContentVersion;
use App\Models\AutomationExecution;
use App\Models\AuditLog;
use App\Services\Automation\DraftPayloadValidator;
use App\Services\EmailApprovalService;
use App\Services\LiveEventService;
use App\Jobs\PublishAutomationContentJob;
use App\Jobs\GenerateAutomationContentJob;
use Illuminate\Http\Request;
use Exception;

class ApprovalController extends Controller
{
    public function __construct(
        protected EmailApprovalService $approvalService
    ) {}

    /**
     * Authenticated endpoint: List all pending approvals for the current user.
     */
    public function index(Request $request)
    {
        $pendingVersions = ContentVersion::where('user_id', $request->user()->id)
            ->awaitingDecision()
            ->with([
                'execution.automation:id,name,target_table,timezone,timeout_policy,connection_id',
                'execution.automation.connection:id,name,database_name',
                // Earlier versions of the same run (no content): what was sent back, and the notes given.
                'execution.versions' => fn ($q) => $q->select('id', 'execution_id', 'version_number', 'status', 'rejection_feedback', 'created_at')->orderBy('version_number'),
            ])
            ->orderBy('created_at', 'desc')
            ->get();
        // Signed tokens are never sent to the portal; the portal acts through authenticated endpoints.
        $pendingVersions->each(fn($v) => $v->makeHidden('approvalTokens'));

        return response()->json($pendingVersions);
    }

    /**
     * Public token-authenticated review endpoint (routes from email link).
     */
    public function review($tokenString)
    {
        $token = ApprovalToken::where('token', $tokenString)
            ->with(['version.execution.automation'])
            ->first();

        if (!$token) {
            return response()->json([
                'valid' => false,
                'message' => 'Invalid or unknown approval link.',
            ], 404);
        }

        $version = $token->version;
        $execution = $version->execution;
        $automation = $execution->automation;

        $reviewable = $version->status === 'PENDING_APPROVAL'
            && !in_array($execution->status, array_merge(AutomationExecution::TERMINAL_STATUSES, ['PUBLISHING', 'GENERATING', 'REGENERATING']), true);

        return response()->json([
            'valid' => $token->isValid() && $reviewable,
            'is_used' => !is_null($token->used_at),
            'is_expired' => $token->expires_at->isPast(),
            'reviewable' => $reviewable,
            'execution_status' => $execution->status,
            'automation_name' => $automation->name,
            'target_table' => $automation->target_table,
            'timezone' => $automation->timezone,
            'timeout_policy' => $automation->timeout_policy,
            'version_number' => $version->version_number,
            'status' => $version->status,
            'publication_time' => $execution->publication_time,
            'content_payload' => $version->payload,
            'meta' => $version->meta,
            'rejection_feedback' => $version->rejection_feedback,
            'expires_at' => $token->expires_at,
        ]);
    }

    /**
     * Submit interactive approval click.
     */
    public function approve($tokenString)
    {
        try {
            $result = $this->approvalService->approve($tokenString);

            // If scheduled publication time is now or past, publish immediately
            $execution = $result['execution'];
            if ($execution->publication_time && $execution->publication_time->isPast()) {
                PublishAutomationContentJob::dispatch($execution->id);
            }

            return response()->json($result);
        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        }
    }

    /**
     * Submit interactive rejection with reviewer feedback.
     */
    public function reject(Request $request, $tokenString)
    {
        $request->validate(['feedback' => 'nullable|string|max:2000']);
        $feedback = trim((string) $request->input('feedback', '')) ?: 'Requested revisions from editor.';

        try {
            $result = $this->approvalService->reject($tokenString, $feedback);

            // If regenerating, dispatch new generation job with feedback context
            if (($result['status'] ?? '') === 'REGENERATING') {
                $token = ApprovalToken::where('token', $tokenString)->first();
                if ($token) {
                    GenerateAutomationContentJob::dispatch($token->version->execution_id, $feedback);
                }
            }

            return response()->json($result);
        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        }
    }

    /**
     * Portal In-App: Update payload of a pending content version before publication.
     */
    public function updatePayload(Request $request, $id)
    {
        $request->validate([
            'payload' => 'required|array',
        ]);

        $version = ContentVersion::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->with('execution')
            ->firstOrFail();
        if ($blocked = $this->notReviewable($version)) {
            return $blocked;
        }
        if ($invalid = $this->invalidPayload($version, $request->input('payload'))) {
            return $invalid;
        }

        $version->payload = $request->input('payload');
        $version->save();

        AuditLog::log(
            $request->user()->id,
            'VERSION_PAYLOAD_EDITED_IN_PORTAL',
            'ContentVersion',
            (string) $version->id,
            [
                'version_number' => $version->version_number,
                'fields_updated' => array_keys($request->input('payload')),
            ]
        );

        return response()->json([
            'message' => 'Content payload updated successfully.',
            'version' => $version,
        ]);
    }

    /**
     * Portal In-App: Approve pending content version (immediate publish or hold for schedule).
     */
    public function approveVersion(Request $request, $id)
    {
        $version = ContentVersion::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->with(['execution.automation'])
            ->firstOrFail();

        $execution = $version->execution;
        if ($blocked = $this->notReviewable($version)) {
            return $blocked;
        }

        $edited = [];
        if ($request->has('payload') && is_array($request->input('payload'))) {
            if ($invalid = $this->invalidPayload($version, $request->input('payload'))) {
                return $invalid;
            }
            $edited = AuditLog::changes((array) $version->payload, $request->input('payload'));
            $version->payload = $request->input('payload');
        }

        $version->status = 'APPROVED';
        $version->save();

        $execution->status = 'APPROVED';
        $execution->save();

        $publishNow = $request->boolean('publish_now') || ($execution->publication_time && $execution->publication_time->isPast());

        if ($publishNow) {
            $execution->update(['status' => 'PUBLISHING', 'lease_expires_at' => now()->addMinutes(10)]);
            $execution->addTimelineEvent('PORTAL_APPROVAL_PUBLISH_NOW', 'Approved by live editor in portal; immediate publication dispatched to target database.');
            PublishAutomationContentJob::dispatch($execution->id);
        } else {
            $pubTimeStr = $execution->publication_time ? $execution->publication_time->toIso8601String() : 'scheduled deadline';
            $execution->addTimelineEvent('PORTAL_APPROVED_FOR_SCHEDULE', "Approved by live editor in portal; scheduled to publish at {$pubTimeStr}.");
        }

        AuditLog::log($request->user()->id, 'VERSION_APPROVED', 'ContentVersion', (string) $version->id, [
            'automation_id' => $execution->automation_id,
            'execution_id' => $execution->id,
            'version_number' => $version->version_number,
            'via' => 'portal',
            'publish_now' => $publishNow,
            'changes' => $edited ?: null,
        ]);

        LiveEventService::publish($request->user()->id, 'execution.stage_changed', [
            'execution_id' => $execution->id,
            'status' => $publishNow ? 'PUBLISHING' : 'APPROVED',
        ], 'AutomationExecution', (string) $execution->id);

        return response()->json([
            'message' => $publishNow ? 'Approved and queued for immediate database publication.' : 'Approved for scheduled publication.',
            'version' => $version,
            'execution' => $execution->fresh(),
        ]);
    }

    /**
     * Portal In-App: Reject version and trigger AI regeneration with editorial feedback.
     */
    public function rejectVersion(Request $request, $id)
    {
        $version = ContentVersion::where('user_id', $request->user()->id)
            ->where('id', $id)
            ->with(['execution.automation'])
            ->firstOrFail();

        $execution = $version->execution;
        if ($blocked = $this->notReviewable($version)) {
            return $blocked;
        }
        $request->validate(['feedback' => 'nullable|string|max:2000']);
        $feedback = trim((string) $request->input('feedback', '')) ?: 'Requested revisions from editor in portal.';

        $version->update([
            'status' => 'REJECTED',
            'rejection_feedback' => $feedback,
        ]);
        AuditLog::log($request->user()->id, 'VERSION_REJECTED', 'ContentVersion', (string) $version->id, [
            'automation_id' => $execution->automation_id,
            'execution_id' => $execution->id,
            'version_number' => $version->version_number,
            'via' => 'portal',
            'feedback' => mb_substr($feedback, 0, 500),
        ]);

        $maxRetries = max(1, (int) config('automation.max_regenerations', 3));

        $rejectedCount = ContentVersion::where('execution_id', $execution->id)
            ->where('status', 'REJECTED')
            ->count();

        if ($rejectedCount >= $maxRetries) {
            $execution->update([
                'status' => 'FAILED',
                'failure_category' => 'MAX_REJECTIONS_EXCEEDED',
                'error_message' => "Maximum rejection limit of {$maxRetries} regenerations reached without approval.",
            ]);
            $execution->addTimelineEvent('MAX_REJECTIONS_EXCEEDED', "Reached threshold of {$maxRetries} rejected versions. Execution stopped safely.");

            return response()->json([
                'message' => "Maximum regeneration threshold ({$maxRetries}) reached. Execution stopped.",
                'version' => $version,
                'execution' => $execution->fresh(),
            ]);
        }

        // Trigger AI regeneration with feedback (the job only claims runs marked REGENERATING)
        $execution->update(['status' => 'REGENERATING']);
        GenerateAutomationContentJob::dispatch($execution->id, $feedback);
        $execution->addTimelineEvent('PORTAL_REGENERATION_REQUESTED', "Editor rejected version #{$version->version_number} with feedback: '{$feedback}'. Triggered AI regeneration.");

        return response()->json([
            'message' => 'Version rejected. AI is regenerating revised content with your feedback.',
            'version' => $version,
            'execution' => $execution->fresh(),
        ]);
    }

    /** 422 with a message per edited column (keyed "payload.<column>") when an editor's change cannot be published. */
    private function invalidPayload(ContentVersion $version, array $payload): ?\Illuminate\Http\JsonResponse
    {
        $errors = DraftPayloadValidator::errors(
            $payload,
            is_array($version->payload) ? $version->payload : [],
            $version->meta['write_plan']['columns'] ?? [],
            DraftPayloadValidator::relationColumns($version->meta)
        );
        return $errors ? response()->json(['message' => reset($errors)[0], 'errors' => $errors], 422) : null;
    }

    /** 409 response when a version can no longer be edited, approved or rejected. */
    private function notReviewable(ContentVersion $version): ?\Illuminate\Http\JsonResponse
    {
        $execution = $version->execution;
        if ($version->status !== 'PENDING_APPROVAL') {
            return response()->json(['message' => "This draft is no longer awaiting review (it is {$version->status})."], 409);
        }
        if (!$execution || in_array($execution->status, array_merge(AutomationExecution::TERMINAL_STATUSES, ['PUBLISHING', 'GENERATING', 'REGENERATING']), true)) {
            return response()->json(['message' => 'This run is ' . strtolower((string) $execution?->status) . ', so the draft can no longer be changed.'], 409);
        }
        return null;
    }
}
