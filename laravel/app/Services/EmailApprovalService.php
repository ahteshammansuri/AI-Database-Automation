<?php

namespace App\Services;

use App\Models\ApprovalToken;
use App\Models\ContentVersion;
use App\Models\AutomationExecution;
use App\Models\AuditLog;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Exception;

class EmailApprovalService
{
    /**
     * Issue approval token and dispatch notification email.
     */
    public function dispatchApprovalNotification(ContentVersion $version, string $recipientEmail): ApprovalToken
    {
        $tokenRecord = ApprovalToken::generateForVersion($version);
        $automation = $version->execution->automation;

        $frontendUrl = env('FRONTEND_URL', 'http://localhost:5173');
        $approvalUrl = "{$frontendUrl}/approvals/{$tokenRecord->token}";

        $payload = $version->payload;
        $title = $payload['title'] ?? 'Untitled Draft';

        // Dispatch real email via Laravel Mail transport (log, smtp, etc.)
        try {
            Mail::raw("A new AI-generated draft is awaiting your editorial review for '{$automation->name}' (Draft #{$version->version_number}).\n\nTitle: {$title}\n\nSecure Review & Decision Link:\n{$approvalUrl}\n\nThis cryptographic HMAC single-use link expires in 48 hours.", function ($message) use ($recipientEmail, $automation, $version) {
                $message->to($recipientEmail)
                    ->subject("Action Required: Review '{$automation->name}' Draft #{$version->version_number}");
            });
        } catch (\Throwable $e) {
            Log::warning("Email dispatch error: " . $e->getMessage());
        }

        // Log simulated email clearly for local development & demonstration
        Log::info("[EMAIL DISPATCHED] To: {$recipientEmail} | Subject: Review Required: '{$automation->name}' Draft #{$version->version_number} | Review URL: {$approvalUrl}");

        AuditLog::log(
            $version->user_id,
            'APPROVAL_EMAIL_SENT',
            'ContentVersion',
            (string) $version->id,
            [
                'recipient' => $recipientEmail,
                'version' => $version->version_number,
                'approval_url' => $approvalUrl,
            ]
        );

        return $tokenRecord;
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
