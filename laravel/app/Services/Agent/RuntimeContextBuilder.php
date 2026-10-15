<?php

namespace App\Services\Agent;

use App\Models\AgentMessage;
use App\Models\AgentTask;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\User;

/**
 * Builds the live runtime snapshot the model reasons over: authorized, non-secret,
 * and limited to what a decision needs. Identity always comes from the server.
 */
class RuntimeContextBuilder
{
    public function __construct(protected SecretVault $vault)
    {
    }

    public function build(User $user, AgentTask $task, array $modelInfo): array
    {
        $connections = DbConnection::where('user_id', $user->id)->orderBy('id')->limit(20)->get()
            ->map(fn ($c) => [
                'id' => $c->id,
                'name' => $c->name,
                'host' => $c->host,
                'port' => $c->port,
                'database_name' => $c->database_name,
                'username' => $c->username,
                'status' => $c->status,
                'last_tested_at' => $c->last_tested_at?->toIso8601String(),
            ])->all();

        $automations = Automation::where('user_id', $user->id)->orderByDesc('id')->limit(15)->get()
            ->map(fn ($a) => [
                'id' => $a->id,
                'name' => $a->name,
                'connection_id' => $a->connection_id,
                'target_table' => $a->target_table,
                'schedule_type' => $a->schedule_type,
                'is_active' => (bool) $a->is_active,
            ])->all();

        $context = [
            'now' => now()->toIso8601String(),
            'user' => ['name' => $user->name],
            'page' => self::sanitizePage($task->page_context ?? []),
            'connections' => $connections,
            'automations' => $automations,
            'pending_approvals' => AutomationExecution::where('user_id', $user->id)->where('status', 'PENDING_APPROVAL')->count(),
            'model' => $modelInfo,
            'credentials_captured' => $this->vault->capturedKinds($task),
            'conversation_memory' => $task->conversation?->metadata['memory'] ?? (object) [],
            // Whether a browser is open to watch Orbit operate the screen (UI tools need it).
            'browser_present' => UiActionCoordinator::clientPresent($user->id),
            'task' => array_filter([
                'id' => $task->id,
                'status' => $task->status,
                'plan_version' => $task->plan_version,
                'awaiting_confirmation_for' => $task->pending_tool_call
                    ? ['tool' => $task->pending_tool_call['name'] ?? null, 'args' => $task->pending_tool_call['args'] ?? []]
                    : null,
                'last_question' => ($task->last_decision['kind'] ?? null) && in_array($task->last_decision['kind'], ['ASK_CLARIFICATION', 'WAIT_FOR_USER', 'REQUEST_CONFIRMATION', 'RECOVER'], true)
                    ? ($task->last_decision['speech_text'] ?? null)
                    : null,
            ], fn ($v) => $v !== null),
        ];

        $focusConnection = $this->focusedConnectionId($task, $connections);
        if ($focusConnection) {
            $snap = SchemaSnapshot::where('user_id', $user->id)->where('connection_id', $focusConnection)->latest('id')->first();
            if ($snap) {
                $context['focused_schema'] = [
                    'connection_id' => $focusConnection,
                    'snapshot_version' => $snap->version,
                    'tables' => collect($snap->schema_payload['tables'] ?? [])->take(40)->map(fn ($t) => array_filter([
                        'name' => $t['name'] ?? null,
                        'category' => $t['category'] ?? null,
                        'sensitive' => !empty($t['is_sensitive']) ?: null,
                    ], fn ($v) => $v !== null))->values()->all(),
                ];
            }
        }

        return $context;
    }

    /**
     * Recent conversation before the current utterance (oldest first), without secrets.
     */
    public function conversationSummary(AgentTask $task, ?int $beforeMessageId, int $limit = 14): array
    {
        $q = AgentMessage::where('conversation_id', $task->conversation_id)->whereIn('role', ['user', 'assistant']);
        if ($beforeMessageId) {
            $q->where('id', '<', $beforeMessageId);
        }

        // Service notices ("model unavailable"...) are not part of the dialogue; leaving them in
        // makes the model repeat or apologise for them.
        $messages = $q->orderByDesc('id')->limit($limit * 2)->get()
            ->reject(fn ($m) => $m->role === 'assistant' && (($m->meta['source'] ?? null) === 'system'))
            ->take($limit)->reverse()->values();
        $count = $messages->count();

        return $messages->map(function ($m, $i) use ($count) {
            $recent = $i >= $count - 4;
            return array_filter([
                'role' => $m->role,
                'content' => mb_substr((string) $m->content, 0, $recent ? 500 : 220),
                'decision' => $m->role === 'assistant' ? ($m->meta['decision_kind'] ?? null) : null,
            ], fn ($v) => $v !== null);
        })->all();
    }

    /** Facts remembered across tasks in this conversation (non-secret, capped). */
    public static function rememberFromTask(AgentTask $task): void
    {
        $conversation = $task->conversation;
        if (!$conversation) {
            return;
        }
        $meta = $conversation->metadata ?? [];
        $memory = $meta['memory'] ?? [];
        foreach (($task->slots ?? []) as $k => $v) {
            if (is_string($k) && $k !== 'page_context' && !SecretVault::looksSecretKey($k) && (is_scalar($v) || $v === null)) {
                $memory[$k] = is_string($v) ? mb_substr($v, 0, 200) : $v;
            }
        }
        if (count($memory) > 30) {
            $memory = array_slice($memory, -30, null, true);
        }
        $meta['memory'] = $memory;
        $conversation->update(['metadata' => $meta]);
    }

    /**
     * Page snapshot from the browser: masked/secret fields reduced to presence flags,
     * non-empty values marked as supplied so the model never asks for them again.
     */
    public static function sanitizePage(array $page): array
    {
        $forms = [];
        foreach (($page['mountedForms'] ?? []) as $formId => $form) {
            if (!is_array($form)) {
                continue;
            }
            $fields = [];
            foreach (($form['fields'] ?? []) as $name => $field) {
                if (!is_array($field)) {
                    continue;
                }
                $name = (string) $name;
                $value = $field['value'] ?? null;
                $present = $value !== null && $value !== '' && $value !== 0;
                if (!empty($field['isMasked']) || SecretVault::looksSecretKey($name)) {
                    $fields[$name] = ['present' => $present, 'secret' => true];
                    continue;
                }
                $isDefault = !empty($field['isDefault']);
                $fields[$name] = array_filter([
                    'value' => is_scalar($value) ? mb_substr((string) $value, 0, 200) : null,
                    // Untouched form defaults are hints, not values the user gave.
                    'supplied' => $present && !$isDefault,
                    'default' => $isDefault ?: null,
                    'error' => isset($field['error']) ? mb_substr((string) $field['error'], 0, 120) : null,
                ], fn ($v) => $v !== null && $v !== '');
            }
            $forms[(string) $formId] = ['name' => mb_substr((string) ($form['name'] ?? $formId), 0, 80), 'fields' => $fields];
        }

        return array_filter([
            'route' => isset($page['currentPath']) ? mb_substr((string) $page['currentPath'], 0, 120) : null,
            'title' => isset($page['pageTitle']) ? mb_substr((string) $page['pageTitle'], 0, 80) : null,
            'open_modal' => isset($page['activeModal']) ? mb_substr((string) $page['activeModal'], 0, 80) : null,
            'active_entity' => is_array($page['activeEntity'] ?? null)
                ? array_intersect_key($page['activeEntity'], array_flip(['type', 'id', 'name']))
                : null,
            'forms' => $forms ?: null,
        ], fn ($v) => $v !== null);
    }

    protected function focusedConnectionId(AgentTask $task, array $connections): ?int
    {
        $entity = $task->page_context['activeEntity'] ?? null;
        if (is_array($entity) && ($entity['type'] ?? null) === 'connection' && is_numeric($entity['id'] ?? null)) {
            $id = (int) $entity['id'];
            return collect($connections)->contains('id', $id) ? $id : null;
        }
        $slot = $task->slots['connection_id'] ?? null;
        if (is_numeric($slot) && collect($connections)->contains('id', (int) $slot)) {
            return (int) $slot;
        }

        return count($connections) === 1 ? $connections[0]['id'] : null;
    }
}
