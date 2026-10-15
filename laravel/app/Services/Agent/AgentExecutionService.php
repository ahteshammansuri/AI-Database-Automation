<?php

namespace App\Services\Agent;

use App\Jobs\RunAgentTurnJob;
use App\Models\AgentConversation;
use App\Models\AgentMessage;
use App\Models\AgentTask;
use App\Models\User;
use App\Models\UserAgentPreference;
use Illuminate\Support\Str;

/**
 * Entry point for Orbit requests from the HTTP layer. It records the (redacted)
 * utterance, routes secrets into the vault, attaches the turn to the conversation's
 * open task, and queues the observe-act loop (AgentOrchestrator). It never interprets
 * what the user meant; the model does that inside the loop.
 */
class AgentExecutionService
{
    /** Task states in which a new utterance continues the same task. */
    public const OPEN_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'PAUSE_REQUESTED', 'PAUSED'];

    /** A waiting task older than this no longer captures new utterances. */
    public const OPEN_TASK_TTL_MINUTES = 120;

    public function __construct(
        protected SecretVault $vault,
        protected AgentOrchestrator $orchestrator,
    ) {
    }

    public function handleUserMessage(
        User $user,
        AgentConversation $conversation,
        string $content,
        bool $isVoice = false,
        ?array $secureInputData = null,
        ?array $pageContext = null
    ): array {
        [$redacted, $inlineSecrets] = SecretVault::redactUtterance($content);

        $task = $this->openTask($conversation) ?? AgentTask::create([
            'user_id' => $user->id,
            'conversation_id' => $conversation->id,
            'task_type' => 'ORBIT_REQUEST',
            'goal' => mb_substr($redacted, 0, 1000),
            'status' => 'QUEUED',
            'autonomy_level' => $this->autonomyLevel($user),
            // Start from what this conversation already established (e.g. connection_name).
            'slots' => $conversation->metadata['memory'] ?? [],
            'current_step_index' => 0,
            'idempotency_key' => (string) Str::uuid(),
        ]);

        foreach ($inlineSecrets as $kind => $secret) {
            $this->vault->store($user, $task, $kind, $secret);
        }
        $nonSecret = $secureInputData ? $this->vault->absorb($user, $task, $secureInputData) : [];
        $secretFields = $secureInputData
            ? array_values(array_filter(array_keys($secureInputData), fn ($k) => SecretVault::looksSecretKey((string) $k)))
            : [];

        $message = AgentMessage::create([
            'conversation_id' => $conversation->id,
            'role' => 'user',
            'content' => $redacted,
            'is_voice' => $isVoice,
            'meta' => array_filter([
                'secure_fields_provided' => array_merge($secretFields, array_keys($inlineSecrets)) ?: null,
                'redacted_inline_secret' => $inlineSecrets ? true : null,
            ]),
            'created_at' => now(),
        ]);

        $updates = ['slots' => array_merge($task->slots ?? [], $nonSecret)];
        if ($pageContext !== null) {
            $updates['page_context'] = self::stripPageSecrets($pageContext);
        }

        if ($task->status === 'RUNNING') {
            // The running loop applies this at its next safe checkpoint (stale steps are not dispatched).
            $task->update($updates + ['pending_user_turn' => true, 'plan_version' => $task->plan_version + 1]);
            $this->orchestrator->timeline($task, 'NEW_INSTRUCTION', 'info',
                'New instruction received while working; applying it at the next safe step.');
            $this->orchestrator->broadcastTaskUpdate($task);
        } else {
            $turnId = (string) Str::uuid();
            $task->update($updates + [
                'status' => 'QUEUED',
                'stage' => 'QUEUED',
                'current_turn_id' => $turnId,
                'pending_user_turn' => false,
            ]);
            $this->orchestrator->broadcastTaskUpdate($task);
            RunAgentTurnJob::dispatch($task->id, $turnId);
        }

        return $this->snapshot($conversation, $task, $message);
    }

    /**
     * Deterministic Stop / Pause / Resume controls (UI buttons). Spoken stop/pause requests
     * go through the model as normal utterances.
     */
    public function interruptTask(User $user, AgentTask $task, string $action = 'STOP'): array
    {
        if ($task->user_id !== $user->id) {
            abort(404);
        }
        $action = strtoupper($action);
        $running = in_array($task->status, ['RUNNING', 'QUEUED'], true);

        if ($action === 'RESUME') {
            if (in_array($task->status, ['PAUSED', 'PAUSE_REQUESTED'], true)) {
                $turnId = (string) Str::uuid();
                $task->update(['status' => 'QUEUED', 'stage' => 'QUEUED', 'current_turn_id' => $turnId, 'paused_at' => null]);
                $this->orchestrator->timeline($task, 'USER_RESUME', 'running', 'Resuming the paused task.');
                RunAgentTurnJob::dispatch($task->id, $turnId);
            }
            $message = 'Resume requested.';
        } elseif ($action === 'PAUSE') {
            $task->update($running ? ['status' => 'PAUSE_REQUESTED'] : ['status' => 'PAUSED', 'paused_at' => now()]);
            $this->orchestrator->timeline($task, 'USER_PAUSE', 'waiting', $running
                ? 'Pause requested; Orbit stops at the next safe step.'
                : 'Task paused.');
            $message = $running ? 'Pausing at the next safe step.' : 'Task paused.';
        } else {
            $task->update($running
                ? ['status' => 'INTERRUPT_REQUESTED']
                : ['status' => 'CANCELLED', 'cancelled_at' => now(), 'pending_tool_call' => null]);
            $this->orchestrator->timeline($task, 'USER_STOP', 'cancelled', $running
                ? 'Stop requested; no new steps will start. A step already running finishes or rolls back first.'
                : 'Task cancelled.');
            $message = $running ? 'Stopping at the next safe step.' : 'Task cancelled.';
        }

        $this->orchestrator->broadcastTaskUpdate($task);

        return ['success' => true, 'task' => $task->fresh(['timelineEvents']), 'message' => $message];
    }

    /**
     * A correction is just another utterance: the model interprets it with the task's state.
     */
    public function handleCorrection(User $user, AgentConversation $conversation, AgentTask $task, string $correctionText): array
    {
        return $this->handleUserMessage($user, $conversation, $correctionText);
    }

    /**
     * Explicit confirmation (button) of the tool call Orbit is waiting on.
     */
    public function confirmTaskStep(User $user, AgentTask $task): array
    {
        if ($task->user_id !== $user->id) {
            abort(404);
        }
        if ($task->status !== 'WAITING_FOR_APPROVAL' || empty($task->pending_tool_call)) {
            return ['success' => false, 'error' => 'There is nothing waiting for confirmation.', 'task' => $task->fresh(['timelineEvents'])];
        }

        $pending = $task->pending_tool_call;
        $pending['confirmed'] = true;
        $turnId = (string) Str::uuid();
        $task->update(['pending_tool_call' => $pending, 'status' => 'QUEUED', 'stage' => 'QUEUED', 'current_turn_id' => $turnId]);
        $this->orchestrator->broadcastTaskUpdate($task);
        RunAgentTurnJob::dispatch($task->id, $turnId);

        return $this->snapshot($task->conversation, $task, null);
    }

    protected function openTask(AgentConversation $conversation): ?AgentTask
    {
        $task = AgentTask::where('conversation_id', $conversation->id)
            ->whereIn('status', self::OPEN_STATUSES)
            ->latest('id')
            ->first();

        $waiting = $task && !in_array($task->status, ['QUEUED', 'RUNNING'], true);
        if ($waiting && $task->updated_at < now()->subMinutes(self::OPEN_TASK_TTL_MINUTES)) {
            $task->update(['status' => 'SUPERSEDED', 'stage' => 'DONE', 'pending_tool_call' => null]);
            return null;
        }

        return $task;
    }

    protected function snapshot(AgentConversation $conversation, AgentTask $task, ?AgentMessage $message): array
    {
        return [
            'conversation' => $conversation->fresh(['messages']),
            'task' => $task->fresh(['timelineEvents']),
            'message' => $message,
            'turn_id' => $task->fresh()->current_turn_id,
            'queue' => AgentQueueStatus::forTask($task->fresh()),
        ];
    }

    protected function autonomyLevel(User $user): string
    {
        return UserAgentPreference::where('user_id', $user->id)->value('autonomy_level') ?: 'CONFIRM_CONSEQUENTIAL_CHANGES';
    }

    /** Keep only the structure the context builder reads; drop secret field values entirely. */
    public static function stripPageSecrets(array $page): array
    {
        foreach (($page['mountedForms'] ?? []) as $formId => $form) {
            foreach (($form['fields'] ?? []) as $name => $field) {
                if (!is_array($field)) {
                    continue;
                }
                if (!empty($field['isMasked']) || SecretVault::looksSecretKey((string) $name)) {
                    $present = isset($field['value']) && $field['value'] !== '' && $field['value'] !== null;
                    $page['mountedForms'][$formId]['fields'][$name] = ['name' => $name, 'isMasked' => true, 'value' => $present ? '•' : ''];
                }
            }
        }

        return array_intersect_key($page, array_flip(['currentPath', 'pageTitle', 'activeEntity', 'mountedForms', 'activeModal', 'filters']));
    }
}
