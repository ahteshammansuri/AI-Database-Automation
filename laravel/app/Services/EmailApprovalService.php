<?php

namespace App\Services;

use App\Models\ApprovalToken;
use App\Models\ContentVersion;
use App\Models\AutomationExecution;
use App\Models\AuditLog;
use App\Mail\ContentReviewMail;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Exception;

class EmailApprovalService
{
    /**
     * Issue a single-use approval token for this exact version and send the review email.
     * Returns whether the configured mail transport accepted the message; a failure is recorded,
     * never reported as sent.
     *
     * @return array{token: ApprovalToken, sent: bool, error: ?string}
     */
    public function dispatchApprovalNotification(ContentVersion $version, string $recipientEmail): array
    {
        $tokenRecord = ApprovalToken::generateForVersion($version);
        $version->loadMissing('execution.automation.connection');
        $automation = $version->execution->automation;

        $frontendUrl = rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/');
        $reviewUrl = "{$frontendUrl}/approvals/{$tokenRecord->token}";

        $sent = false;
        $error = null;
        try {
            Mail::to($recipientEmail)->send(new ContentReviewMail($version, $tokenRecord, $reviewUrl));
            $sent = true;
        } catch (\Throwable $e) {
            $error = $e->getMessage();
            Log::warning("Review email for version #{$version->id} failed: " . $error);
        }

        // The signed link is a credential: it is never written to logs or the audit trail.
        AuditLog::log(
            $version->user_id,
            $sent ? 'APPROVAL_EMAIL_SENT' : 'APPROVAL_EMAIL_FAILED',
            'ContentVersion',
            (string) $version->id,
            [
                'recipient' => $recipientEmail,
                'version' => $version->version_number,
                'automation_id' => $automation->id,
                'error' => $error ? mb_substr($error, 0, 300) : null,
            ]
        );

        return ['token' => $tokenRecord, 'sent' => $sent, 'error' => $error ? mb_substr($error, 0, 300) : null];
    }

    /**
     * A token may only act on a version that is still awaiting review, in a run that has not finished.
     */
    private function assertReviewable(ContentVersion $version): void
    {
        $execution = $version->execution;
        if ($version->status !== 'PENDING_APPROVAL') {
            throw new Exception("This draft is no longer awaiting review (it is {$version->status}).");
        }
        if (!$execution || in_array($execution->status, AutomationExecution::TERMINAL_STATUSES, true) || in_array($execution->status, ['PUBLISHING', 'GENERATING', 'REGENERATING'], true)) {
            throw new Exception('This run is ' . strtolower((string) $execution?->status) . ', so the draft can no longer be approved or rejected here.');
        }
    }

    /**
     * Process review approval action via token.
     */
    public function approve(string $tokenString): array
    {
        $token = ApprovalToken::where('token', $tokenString)->first();

        if (!$token) {
            throw new Exception("Invalid or unknown approval token.");
        }

        if (!$token->isValid()) {
            throw new Exception("Approval token has expired or has already been used.");
        }

        $version = $token->version;
        $execution = $version->execution;
        $this->assertReviewable($version);

        // Mark token used
        $token->update(['used_at' => now()]);

        // Update version and execution status
        $version->update(['status' => 'APPROVED']);
        $execution->update(['status' => 'APPROVED']);

        AuditLog::log(
            $version->user_id,
            'VERSION_APPROVED',
            'ContentVersion',
            (string) $version->id,
            [
                'automation_id' => $execution->automation_id,
                'version_number' => $version->version_number,
            ]
        );

        return [
            'success' => true,
            'message' => "Version #{$version->version_number} approved successfully.",
            'version' => $version,
            'execution' => $execution,
        ];
    }

    /**
     * Process rejection action with feedback.
     */
    public function reject(string $tokenString, string $feedback): array
    {
        $token = ApprovalToken::where('token', $tokenString)->first();

        if (!$token) {
            throw new Exception("Invalid or unknown approval token.");
        }

        if (!$token->isValid()) {
            throw new Exception("Token has expired or has already been used.");
        }

        $version = $token->version;
        $execution = $version->execution;
        $this->assertReviewable($version);

        $token->update(['used_at' => now()]);
        $version->update([
            'status' => 'REJECTED',
            'rejection_feedback' => $feedback,
        ]);

        AuditLog::log(
            $version->user_id,
            'VERSION_REJECTED',
            'ContentVersion',
            (string) $version->id,
            [
                'automation_id' => $execution->automation_id,
                'version_number' => $version->version_number,
                'feedback' => $feedback,
            ]
        );

        // Check retry limit (max 3 attempts)
        $priorAttempts = ContentVersion::where('execution_id', $execution->id)->count();

        if ($priorAttempts >= 3) {
            $execution->update([
                'status' => 'REJECTED',
                'error_message' => "Maximum rejection retries reached (3). Manual intervention required.",
            ]);

            return [
                'success' => true,
                'status' => 'MAX_RETRIES_REACHED',
                'message' => "Maximum rejection retries (3) reached. Manual editing required.",
            ];
        }

        // Trigger regeneration job
        $execution->update(['status' => 'REGENERATING']);

        return [
            'success' => true,
            'status' => 'REGENERATING',
            'message' => "Feedback recorded. Regenerating revision #{" . ($priorAttempts + 1) . "}...",
            'retry_count' => $priorAttempts,
        ];
    }
}
