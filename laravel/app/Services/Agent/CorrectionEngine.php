<?php

namespace App\Services\Agent;

use App\Models\AgentTask;
use App\Models\User;
use App\Services\AiServiceClient;
use Illuminate\Support\Str;

class CorrectionEngine
{
    public function __construct(
        protected AiServiceClient $aiClient,
        protected SecretVault $vault
    ) {}

    /**
     * Classify an incoming mid-task utterance to detect slot patches, cancellations, or pauses.
     *
     * @return array{action: string, slot_name: ?string, new_value: mixed, explanation: string}
     */
    public function classify(AgentTask $task, string $utterance): array
    {
        $u = trim($utterance);
        $uLower = strtolower($u);

        // 1. Fast heuristics for deterministic barge-in commands
        if (preg_match('/^(?:stop|cancel|abort|terminate)(?:\s+(?:it|now|the task|everything))?$/i', $uLower) ||
            str_contains($uLower, 'stop right now')) {
            return [
                'action' => 'cancel',
                'slot_name' => null,
                'new_value' => null,
                'explanation' => 'User requested task cancellation.',
            ];
        }

        if (preg_match('/^(?:pause|hold on|wait a minute)$/i', $uLower)) {
            return [
                'action' => 'pause',
                'slot_name' => null,
                'new_value' => null,
                'explanation' => 'User requested task pause.',
            ];
        }

        if (preg_match('/^(?:resume|continue|keep going)$/i', $uLower)) {
            return [
                'action' => 'resume',
                'slot_name' => null,
                'new_value' => null,
                'explanation' => 'User requested task resumption.',
            ];
        }

        // 2. Self-correction in single utterance: "host is db1, no wait, db2" or "x, actually y"
        if (preg_match('/(host|db|database|user|username|port)\s+(?:is|=|:)?\s*([^\s,]+)[,\s]+(?:no wait|actually|sorry|wait|i mean)[,\s]+([^\s,]+)/i', $u, $m)) {
            $matchedField = strtolower($m[1]);
            $slot = match ($matchedField) {
                'user', 'username' => 'username',
                'port' => 'port',
                'database', 'db' => 'database',
                default => 'host',
            };

            return [
                'action' => 'patch_value',
                'slot_name' => $slot,
                'new_value' => trim($m[3]),
                'explanation' => "Self-correction: updated {$slot} to '{$m[3]}'.",
            ];
        }

        // 3. Slot patch pattern: "sorry, the username is wrong, it's john_admin"
        if (preg_match('/(?:username|user)\s+(?:is wrong|is not right|was incorrect)[,\s]+(?:it\'s|its|it is|use)?\s*([^\s,]+)/i', $u, $m) ||
            preg_match('/change (?:the )?username to\s+([^\s,]+)/i', $u, $m)) {
            return [
                'action' => 'patch_value',
                'slot_name' => 'username',
                'new_value' => trim($m[1]),
                'explanation' => "Patched slot 'username' to '{$m[1]}'.",
            ];
        }

        if (preg_match('/(?:host|hostname)\s+(?:is wrong|is not right)[,\s]+(?:it\'s|its|it is|use)?\s*([^\s,]+)/i', $u, $m) ||
            preg_match('/change (?:the )?host to\s+([^\s,]+)/i', $u, $m)) {
            return [
                'action' => 'patch_value',
                'slot_name' => 'host',
                'new_value' => trim($m[1]),
                'explanation' => "Patched slot 'host' to '{$m[1]}'.",
            ];
        }

        if (preg_match('/(?:port)\s+(?:is wrong|is not right)[,\s]+(?:it\'s|its|it is|use)?\s*(\d+)/i', $u, $m) ||
            preg_match('/change (?:the )?port to\s+(\d+)/i', $u, $m)) {
            return [
                'action' => 'patch_value',
                'slot_name' => 'port',
                'new_value' => (int) $m[1],
                'explanation' => "Patched slot 'port' to '{$m[1]}'.",
            ];
        }

        // 4. Secret correction: "the password is wrong"
        if (preg_match('/(?:password|api[_-]?key|secret)\s+(?:is wrong|was wrong|incorrect)/i', $uLower)) {
            return [
                'action' => 'patch_value',
                'slot_name' => 'password',
                'new_value' => '[REQUIRES_SECURE_INPUT]',
                'explanation' => 'Password correction requires re-entering secret securely.',
            ];
        }

        return [
            'action' => 'provide_value',
            'slot_name' => null,
            'new_value' => null,
            'explanation' => 'General message or value provision.',
        ];
    }

    /**
     * Apply patch semantics: update ONLY the targeted slot, bump its version,
     * mark dependent steps as stale, and keep all other slots intact.
     */
    public function applyPatch(AgentTask $task, string $slotName, mixed $newValue, ?int $utteranceId = null): array
    {
        $rawSlots = $task->slots ?? [];
        $existing = $rawSlots[$slotName] ?? null;

        $oldVersion = is_array($existing) ? ($existing['version'] ?? 1) : 1;
        $oldValue = is_array($existing) ? ($existing['value'] ?? null) : $existing;

        $newVersion = $oldVersion + 1;

        // Structured slot ledger entry
        $slotEntry = [
            'name' => $slotName,
            'value' => $newValue,
            'status' => 'valid',
            'version' => $newVersion,
            'source_utterance_id' => $utteranceId,
            'updated_at' => now()->toIso8601String(),
        ];

        $rawSlots[$slotName] = $slotEntry;
        // Also keep scalar convenience key for backward compatibility
        $rawSlots[$slotName . '_scalar'] = $newValue;

        $task->slots = $rawSlots;
        $task->plan_version = ($task->plan_version ?? 1) + 1;

        // Check if a committed resource was already saved with the old slot value
        $committedNotice = null;
        if (!empty($task->target_resource_id) && $task->target_resource_type === 'DbConnection') {
            $committedNotice = "I already saved the connection with the previous {$slotName}. Would you like me to update the saved profile with {$newValue}?";
        }

        // If secret, discard old secret from memory/vault
        if (SecretVault::looksSecretKey($slotName)) {
            $this->vault->consume($task, 'database_password');
        }

        $task->save();

        return [
            'success' => true,
            'slot' => $slotName,
            'old_value' => $oldValue,
            'new_value' => $newValue,
            'version' => $newVersion,
            'committed_notice' => $committedNotice,
        ];
    }
}
