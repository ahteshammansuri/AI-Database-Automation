<?php

namespace App\Services\Agent;

use App\Models\AgentMessage;
use App\Models\AgentTask;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\DataAutopilot;
use App\Models\DbConnection;
use App\Models\KnowledgeDocument;
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

    public function build(User $user, AgentTask $task, array $modelInfo, ?string $utterance = null): array
    {
        $connections = DbConnection::where('user_id', $user->id)->orderBy('id')->limit(20)->get()
            ->map(function ($c) use ($user) {
                $tables = $this->tablesFor($user, $c);
                $tableNames = array_map(fn ($t) => $t['name'], $tables);
                return [
                    'id' => $c->id,
                    'name' => $c->name,
                    'host' => $c->host,
                    'port' => $c->port,
                    'database_name' => $c->database_name,
                    'username' => $c->username,
                    'status' => $c->status,
                    'last_tested_at' => $c->last_tested_at?->toIso8601String(),
                    'tables' => $tableNames,
                ];
            })->all();

        $automations = Automation::where('user_id', $user->id)->orderByDesc('id')->limit(15)->get()
            ->map(fn ($a) => [
                'id' => $a->id,
                'name' => $a->name,
                'connection_id' => $a->connection_id,
                'target_table' => $a->target_table,
                'schedule_type' => $a->schedule_type,
                'is_active' => (bool) $a->is_active,
            ] + $this->scheduleFacts($a))->all();

        $context = [
            'now' => now()->toIso8601String(),
            'user' => ['name' => $user->name],
            'page' => self::sanitizePage($task->page_context ?? []),
            'connections' => $connections,
            'automations' => $automations,
            'knowledge_documents' => KnowledgeDocument::where('user_id', $user->id)->orderByDesc('id')->limit(20)->get(['id', 'title', 'status'])
                ->map(fn ($d) => ['id' => $d->id, 'title' => $d->title, 'status' => $d->status])->all(),
            'pending_approvals' => AutomationExecution::where('user_id', $user->id)->where('status', 'PENDING_APPROVAL')->count(),
            // Latest runs, so "what happened / did it work" is answered from facts.
            'recent_runs' => AutomationExecution::where('user_id', $user->id)->with('automation:id,name')->orderByDesc('id')->limit(5)->get()
                ->map(fn ($e) => array_filter([
                    'id' => $e->id,
                    'automation' => $e->automation?->name,
                    'status' => $e->status,
                    'publication_time' => $e->publication_time?->toIso8601String(),
                    'record_id' => $e->target_record_id,
                    'error' => $e->error_message ? mb_substr((string) $e->error_message, 0, 160) : null,
                ], fn ($v) => $v !== null))->all(),
            'data_autopilots' => DataAutopilot::where('user_id', $user->id)->orderBy('id')->limit(10)->get()
                ->map(fn ($p) => array_filter([
                    'id' => $p->id,
                    'connection_id' => $p->connection_id,
                    'table' => $p->table_name,
                    'active' => (bool) $p->is_active,
                    'next_run_at' => $p->is_active ? $p->next_run_at?->toIso8601String() : null,
                    'last_status' => $p->last_status,
                ], fn ($v) => $v !== null))->all(),
            // Times are said in this zone (null: the user's browser zone, shown on the page).
            'user_timezone' => $user->timezone,
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

        // Which tables (and databases) the utterance is about is retrieved by the AI service from schemaDocuments(),
        // by meaning; no word matching here.

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

    /** State and next run of an automation's schedule (never fails the turn). */
    private function scheduleFacts(Automation $a): array
    {
        try {
            $summary = $a->scheduleSummary();
            $next = $summary['next_run'] ?? null;
            return array_filter([
                'state' => $summary['state'] ?? null,
                'next_generation_at' => $next['generation_at'] ?? null,
                'next_publication_at' => $next['publication_at'] ?? null,
            ], fn ($v) => $v !== null);
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * Every table of the user's connected databases, described in plain words from the latest schema scan (columns,
     * types, keys, allowed values, links, size, automation use). The AI service retrieves the ones a request is about
     * by meaning, across all databases, so the model sees each database that has a table and can tell them apart.
     * A connection not scanned yet is described from the briefly cached live catalog instead.
     *
     * @return list<array{connection_id: int, connection: string, database: ?string, table: string, text: string}>
     */
    public function schemaDocuments(User $user): array
    {
        $docs = [];
        foreach (DbConnection::where('user_id', $user->id)->where('is_active', true)->orderBy('id')->limit(20)->get() as $conn) {
            $snapshot = SchemaSnapshot::where('user_id', $user->id)->where('connection_id', $conn->id)->latest('id')->first();
            $tables = $snapshot ? ($snapshot->schema_payload['tables'] ?? []) : $this->liveTables($conn);
            foreach (array_slice($tables, 0, 250) as $t) {
                $name = (string) ($t['name'] ?? $t['table_name'] ?? '');
                if ($name === '') {
                    continue;
                }
                $docs[] = [
                    'connection_id' => $conn->id,
                    'connection' => (string) $conn->name,
                    'database' => $conn->database_name,
                    'table' => $name,
                    'text' => self::describeTable($conn, $name, $t),
                ];
            }
        }

        return $docs;
    }

    /** One table in plain words, e.g. 'Table users in "Shop DB" (connection_id 3, database shop): ~120 rows; columns …'. */
    public static function describeTable(DbConnection $conn, string $name, array $t): string
    {
        $columns = [];
        $enums = [];
        foreach (array_slice($t['columns'] ?? [], 0, 40) as $c) {
            $col = (string) ($c['name'] ?? '');
            if ($col === '') {
                continue;
            }
            $flags = array_filter([
                !empty($c['is_primary_key']) ? 'primary key' : null,
                empty($c['is_primary_key']) && !empty($c['is_unique']) ? 'unique' : null,
                empty($c['is_nullable']) && empty($c['is_primary_key']) && ($c['default'] ?? null) === null ? 'required' : null,
            ]);
            $columns[] = $col . ' ' . ($c['type'] ?? $c['data_type'] ?? '') . ($flags ? ' (' . implode(', ', $flags) . ')' : '');
            if (!empty($c['enum_values'])) {
                $enums[] = $col . ': ' . implode(', ', array_slice(array_map('strval', $c['enum_values']), 0, 8));
            }
        }
        $more = max(0, count($t['columns'] ?? []) - 40);
        $links = array_values(array_filter(array_map(fn ($r) => isset($r['foreign_key'], $r['referenced_table'])
            ? "{$r['foreign_key']} → {$r['referenced_table']}" : null, array_slice($t['relationships'] ?? [], 0, 6))));
        $use = match (true) {
            !empty($t['is_sensitive']) || ($t['category'] ?? null) === 'RESTRICTED' => 'restricted for automations (sensitive data)',
            ($t['category'] ?? null) === 'RECOMMENDED' => 'a content table suited to automations',
            default => null,
        };

        $text = "Table {$name} in \"{$conn->name}\" (connection_id {$conn->id}, database {$conn->database_name})"
            . (isset($t['approx_rows']) ? ": about {$t['approx_rows']} rows" : '')
            . '; columns: ' . implode(', ', $columns) . ($more ? ", and {$more} more" : '')
            . ($enums ? '; allowed values: ' . implode('; ', $enums) : '')
            . ($links ? '; links: ' . implode(', ', $links) : '')
            . ($use ? "; {$use}" : '') . '.';

        return mb_substr($text, 0, 2400);
    }

    /** The live catalog of a connection not scanned yet, in the scan's shape (empty when the database cannot be read). */
    protected function liveTables(DbConnection $conn): array
    {
        try {
            $catalog = app(\App\Services\Data\LiveSchemaService::class)->getCatalog($conn);
        } catch (\Throwable) {
            return [];
        }

        return collect($catalog['tables'] ?? [])->map(function ($t, $name) {
            $unique = collect($t['unique_keys'] ?? [])->filter(fn ($cols) => count($cols) === 1)->flatten()->all();
            return [
                'name' => (string) $name,
                'approx_rows' => $t['rows_estimate'] ?? null,
                'is_sensitive' => ($t['class'] ?? null) === 'blocked',
                'columns' => collect($t['columns'] ?? [])->map(fn ($c, $col) => [
                    'name' => (string) $col,
                    'type' => $c['raw_type'] ?? $c['data_type'] ?? '',
                    'is_primary_key' => in_array($col, $t['primary_key'] ?? [], true),
                    'is_unique' => in_array($col, $unique, true),
                    'is_nullable' => (bool) ($c['nullable'] ?? true),
                    'default' => !empty($c['auto']) ? 'auto' : ($c['default'] ?? null),
                    'enum_values' => array_values($c['enum'] ?? []),
                ])->values()->all(),
                'relationships' => collect($t['foreign_keys'] ?? [])->map(fn ($fk) => [
                    'foreign_key' => $fk['columns'][0] ?? null, 'referenced_table' => $fk['ref_table'] ?? null,
                ])->all(),
            ];
        })->values()->all();
    }

    /** @return list<array{name: string, enums: array<string, list<string>>}> */
    protected function tablesFor(User $user, DbConnection $conn): array
    {
        $snap = SchemaSnapshot::where('user_id', $user->id)->where('connection_id', $conn->id)->latest('id')->first();
        if ($snap) {
            return collect($snap->schema_payload['tables'] ?? [])->map(fn ($t) => [
                'name' => (string) ($t['name'] ?? $t['table_name'] ?? ''),
                'enums' => collect($t['columns'] ?? [])->filter(fn ($c) => !empty($c['enum_values']))
                    ->mapWithKeys(fn ($c) => [$c['name'] => array_values($c['enum_values'])])->all(),
            ])->filter(fn ($t) => $t['name'] !== '')->values()->all();
        }
        try {
            $catalog = app(\App\Services\Data\LiveSchemaService::class)->getCatalog($conn);
        } catch (\Throwable) {
            return [];
        }

        return collect($catalog['tables'] ?? [])->map(fn ($t, $name) => [
            'name' => (string) $name,
            'enums' => collect($t['columns'] ?? [])->filter(fn ($c) => !empty($c['enum']))->map(fn ($c) => array_values($c['enum']))->all(),
        ])->values()->all();
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
