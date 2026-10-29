<?php

namespace App\Services\Agent;

use App\Jobs\RunAgentTurnJob;
use App\Models\AgentMessage;
use App\Models\AgentTask;
use App\Models\AgentTaskTimelineEvent;
use App\Models\AgentToolCall;
use App\Models\AiProvider;
use App\Models\ModelRole;
use App\Models\User;
use App\Services\AiServiceClient;
use App\Services\LiveEventService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Orbit's canonical observe-act loop for one user turn.
 *
 *   context → model decision → policy gate → visible UI choreography → real tool
 *   → authoritative verification → observation → model decision → … → spoken result
 *
 * The model chooses what to do; this class decides whether it is allowed, executes it
 * through registered handlers only, and reports exactly what happened.
 */
class AgentOrchestrator
{
    /** Task status for each turn-ending decision kind. */
    public const TERMINAL_STATUS = [
        'ANSWER' => 'ANSWERED',
        'ASK_CLARIFICATION' => 'WAITING_FOR_INPUT',
        'WAIT_FOR_USER' => 'WAITING_FOR_INPUT',
        'REQUEST_CONFIRMATION' => 'WAITING_FOR_APPROVAL',
        'UNSUPPORTED' => 'ANSWERED',
        'RECOVER' => 'WAITING_FOR_INPUT',
        'PARTIAL_RESULT' => 'PARTIAL_SUCCESS',
        'COMPLETE' => 'SUCCEEDED',
    ];

    public const CLOUD_PROVIDERS = ['openai', 'gemini', 'anthropic', 'claude'];

    /** The model fallback note is shown once per request. */
    private bool $modelNoteShown = false;

    public function __construct(
        protected AiServiceClient $ai,
        protected SecretVault $vault,
        protected ToolPolicyGate $gate,
        protected ToolRunner $runner,
        protected RuntimeContextBuilder $context,
        protected UiActionCoordinator $ui,
    ) {
    }

    /**
     * Focused path: a small model call, given only the tables (across all the user's databases) and pages the
     * message is about, as retrieved by the AI service, decides whether the WHOLE message is one read-only question
     * about the data of one database, or a request to open one page; nothing matching means no model call at all.
     * ask_database then runs through the normal gate and timeline, and a second small call writes the reply from the
     * verified result in the user's language. Returns false (the full agent loop runs instead) for anything else.
     */
    protected function answerDataQuestion(AgentTask $task, User $user, string $turnId, AgentMessage $userMsg, array $model, array $schemaDocs): bool
    {
        $instructions = trim((string) \App\Settings\PlatformSettings::get('orbit.route_instructions'));
        if ($instructions === '') {
            return false;
        }
        $this->stage($task, 'THINKING', 0);
        $history = collect($this->context->conversationSummary($task, $userMsg->id, 4))
            ->map(fn ($m) => ['role' => (string) ($m['role'] ?? ''), 'content' => (string) ($m['content'] ?? '')])->all();
        $timeout = max(60, (int) config('orbit.decide_timeout_seconds', 300));
        $route = $this->ai->routeUtterance([
            'utterance' => $userMsg->content, 'schema_documents' => $schemaDocs, 'pages' => SurfaceCatalog::pageSummaries(),
            'history' => $history, 'instructions' => self::branded($instructions),
            'provider' => $model['provider'], 'model' => $model['model'], 'api_key' => $model['api_key'],
        ], $timeout);
        if (empty($route['success'])) {
            return false;
        }

        if (($route['kind'] ?? '') === 'open_page' && in_array($route['page'] ?? '', SurfaceCatalog::routes(), true)) {
            $observation = $this->executeTool($task, $user, $turnId, 0, 'go_to_page', ['page' => $route['page']], false);
            $result = $observation['result'] ?? [];
            $this->finish($task, [
                'kind' => 'ANSWER', 'speech_text' => (string) ($result['safe_message'] ?? 'Done.'),
                'emotion_hint' => !empty($result['success']) ? 'happy' : 'concerned', 'response_style' => 'result',
            ], [$observation], null);

            return true;
        }
        // Only a database the retrieved tables are in (the gate re-checks that it is the user's).
        $connectionId = (int) ($route['connection_id'] ?? 0);
        if (($route['kind'] ?? '') !== 'data_question' || trim((string) ($route['question'] ?? '')) === ''
            || !in_array($connectionId, array_column($schemaDocs, 'connection_id'), true)) {
            return false;
        }

        $this->timeline($task, 'UNDERSTOOD', 'succeeded', 'Understood as a question about your data: ' . mb_substr($route['question'], 0, 200));
        $observation = $this->executeTool($task, $user, $turnId, 0, 'ask_database',
            ['question' => mb_substr($route['question'], 0, 1000), 'connection_id' => $connectionId], false);
        $result = $observation['result'] ?? [];
        $tool = AgentToolCall::where('task_id', $task->id)->where('tool', 'ask_database')->latest('id')->first();
        $full = $tool?->result_sanitized ?? [];

        $this->stage($task, 'THINKING', 1);
        $facts = array_values(array_filter((array) ($full['data']['facts'] ?? []), fn ($f) => (string) $f !== ''));
        $payload = [
            'utterance' => $userMsg->content,
            'result' => [
                'success' => !empty($result['success']),
                'message' => $result['safe_message'] ?? null,
                'error' => empty($result['success']) ? ($result['safe_message'] ?? null) : null,
                'facts' => $facts,
                'row_count' => $full['data']['row_count'] ?? null,
                'columns' => $full['data']['columns'] ?? null,
                'rows' => $full['data']['rows'] ?? [],
                'assumptions' => $full['data']['assumptions'] ?? [],
            ],
            'instructions' => self::branded((string) \App\Settings\PlatformSettings::get('orbit.answer_instructions')),
            'provider' => $model['provider'], 'model' => $model['model'], 'api_key' => $model['api_key'],
        ];
        // The reply must contain every verified fact; one retry naming what was left out, then the
        // plain factual sentence from the result itself.
        $speech = null;
        for ($attempt = 0; $attempt < 2 && $speech === null; $attempt++) {
            $reply = $this->ai->composeDataAnswer($payload, $timeout);
            if (empty($reply['success'])) {
                break;
            }
            $reply['speech_text'] = self::stripEcho((string) $reply['speech_text'], $userMsg->content);
            $missing = self::missingFacts((string) $reply['speech_text'], $facts);
            if (!$missing && $facts && !self::isSentence((string) $reply['speech_text'], $facts)) {
                $missing = ['a complete sentence in the user\'s language (not just a list)'];
            }
            if (!$missing) {
                $speech = (string) $reply['speech_text'];
            }
            $payload['missing'] = $missing;
        }
        $speech ??= (string) ($result['safe_message'] ?? 'I could not answer that.');

        $this->finish($task, [
            'kind' => 'ANSWER', 'speech_text' => mb_substr($speech, 0, 1200),
            'emotion_hint' => !empty($result['success']) ? 'happy' : 'concerned', 'response_style' => 'result',
        ], [$observation], null);

        return true;
    }

    /**
     * What Orbit says when a data-change preview is ready: written by the model in the user's language from the
     * verified preview. It must keep the database, table and row count, and for a delete the exact phrase to type;
     * otherwise (or when the model is unavailable) the server's own description of the preview is used.
     */
    protected function confirmationSpeech(string $utterance, array $model, array $data, array $args, string $serverMessage): string
    {
        $connection = (string) ($data['connection'] ?? '');
        $table = (string) ($data['table'] ?? $args['table'] ?? '');
        $count = isset($data['affected_count']) ? (string) $data['affected_count'] : '';
        $phrase = !empty($data['requires_typed_confirmation']) ? (string) ($data['confirmation_phrase'] ?? '') : '';
        $facts = array_values(array_filter([$connection, $table, $count, $phrase], fn ($f) => $f !== ''));
        $message = trim(rtrim($serverMessage, '. ') . '.'
            . ($connection !== '' ? " Database: {$connection}." : '')
            . ' Nothing is changed until the user confirms'
            . ($phrase !== '' ? " by typing exactly: {$phrase}" : ' (Confirm button, or a clear yes)') . '.');

        $payload = [
            'utterance' => $utterance,
            'result' => ['success' => true, 'message' => $message, 'facts' => $facts,
                'rows' => array_slice((array) ($data['preview_rows'] ?? []), 0, 5)],
            'instructions' => self::branded((string) \App\Settings\PlatformSettings::get('orbit.answer_instructions')),
            'provider' => $model['provider'], 'model' => $model['model'], 'api_key' => $model['api_key'],
        ];
        $timeout = max(60, (int) config('orbit.decide_timeout_seconds', 300));
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $reply = $this->ai->composeDataAnswer($payload, $timeout);
            if (empty($reply['success'])) {
                break;
            }
            $speech = self::stripEcho((string) ($reply['speech_text'] ?? ''), $utterance);
            $missing = $speech === '' ? $facts : self::missingFacts($speech, $facts);
            if ($speech !== '' && !$missing) {
                return mb_substr($speech, 0, 1200);
            }
            $payload['missing'] = $missing;
        }

        return $message;
    }

    /** Administrator-written text with the brand put in ({brand}, {product}). */
    public static function branded(string $text): string
    {
        return str_replace(['{brand}', '{product}'], (string) config('platform.brand_name'), trim($text));
    }

    /** Remove a verbatim repeat of the user's own message from a reply (small models sometimes echo it). */
    public static function stripEcho(string $speech, string $utterance): string
    {
        $u = trim($utterance, " \t\n\r?.!");
        if (mb_strlen($u) < 12) {
            return $speech;
        }
        $clean = trim(preg_replace('/\s*' . preg_quote($u, '/') . '\s*[?.!]*/iu', ' ', $speech) ?? $speech);
        $clean = trim(preg_replace('/\s{2,}/', ' ', $clean), " ,;:-");

        return $clean !== '' ? $clean : $speech;
    }

    /** A reply that is more than the bare list of facts: at least three words of its own. */
    public static function isSentence(string $speech, array $facts): bool
    {
        $rest = mb_strtolower($speech);
        foreach ($facts as $f) {
            $rest = str_replace(mb_strtolower((string) $f), ' ', $rest);
        }
        $words = array_filter(preg_split('/[^\p{L}]+/u', $rest) ?: [], fn ($w) => mb_strlen($w) >= 2);

        return count($words) >= 3;
    }

    /** Facts (names, numbers) that a reply does not contain; numbers match with or without separators. */
    public static function missingFacts(string $speech, array $facts): array
    {
        $plain = mb_strtolower($speech);
        $digits = preg_replace('/(?<=\d)[,\s](?=\d)/u', '', $plain);

        return array_values(array_filter($facts, function ($f) use ($plain, $digits) {
            $f = mb_strtolower(trim((string) $f));
            if ($f === '') {
                return false;
            }
            if (is_numeric($f)) { // a whole number: "8" is not satisfied by "2018"
                return !preg_match('/(?<![\d.])' . preg_quote($f, '/') . '(?![\d])/u', $digits);
            }

            return !str_contains($plain, $f);
        }));
    }

    /** Gate refusals caused by the model's own malformed call; the loop gives the model the reason to fix it. */
    protected const SELF_CORRECTED = ['INVALID_ARGS', 'UNKNOWN_TOOL'];

    /** True when this turn started by running a step the user confirmed, and that step succeeded. */
    protected bool $confirmedStepDone = false;

    public function runTurn(int $taskId, string $turnId): void
    {
        $task = AgentTask::find($taskId);
        if (!$task || $task->current_turn_id !== $turnId) {
            return; // superseded by a newer turn
        }
        // Model usage of this request is recorded for the customer and the Orbit request (AI usage in the admin panel).
        \App\Services\AiUsage::using($task->user_id, 'orbit', $task, fn () => $this->runTurnFor($task, $taskId, $turnId));
    }

    private function runTurnFor(AgentTask $task, int $taskId, string $turnId): void
    {
        $this->confirmedStepDone = false;
        $this->modelNoteShown = false;

        $lock = Cache::lock("orbit-agent-task:{$taskId}", (int) config('orbit.max_turn_seconds', 600) + 120);
        if (!$lock->get()) {
            // Another worker is mid-turn on this task; it will pick up the newer utterance.
            $task->update(['pending_user_turn' => true]);
            return;
        }

        try {
            $task->refresh();
            if (in_array($task->status, ['INTERRUPT_REQUESTED', 'CANCELLED'], true)) {
                $this->finishCancelled($task, []);
            } elseif ($task->status === 'QUEUED') {
                $this->loop($task, $turnId);
            }
        } catch (\Throwable $e) {
            report($e);
            $fresh = AgentTask::find($taskId); // the task (or its owner) may have been deleted mid-turn
            if ($fresh) {
                $this->finishSystem($fresh, 'FAILED', 'ORCHESTRATOR_ERROR',
                    'Something went wrong inside Orbit while handling that request, so I stopped.', []);
            }
        } finally {
            $lock->release();
        }

        $task = AgentTask::find($taskId);
        if (!$task) {
            return;
        }
        if ($task->pending_user_turn && !in_array($task->status, ['CANCELLED', 'INTERRUPT_REQUESTED'], true)) {
            // A newer utterance arrived after the loop's last checkpoint.
            $next = (string) Str::uuid();
            $task->update(['status' => 'QUEUED', 'stage' => 'QUEUED', 'current_turn_id' => $next]);
            RunAgentTurnJob::dispatch($task->id, $next);
        }
    }

    protected function loop(AgentTask $task, string $turnId): void
    {
        $user = $task->user;
        $userMsg = $this->latestUserMessage($task);
        if (!$userMsg) {
            $this->finishSystem($task, 'FAILED', 'NO_UTTERANCE', 'I did not receive anything to work on.', []);
            return;
        }

        $model = $this->modelSelection($user);
        $modelLabel = ModelSelector::labelFor($model['provider'], $model['model']);
        $task->update([
            'status' => 'RUNNING',
            'stage' => 'UNDERSTANDING',
            'turn_started_at' => now(),
            'pending_user_turn' => false,
            'iteration_count' => 0,
            'slots' => array_merge($task->slots ?? [], [
                '_active_model' => $modelLabel,
                '_provider' => $model['provider'],
                '_model_name' => $model['model'],
            ]),
        ]);
        $this->broadcastTaskUpdate($task);
        $this->stage($task, 'UNDERSTANDING', 0);

        $observations = [];
        $retrieved = null;
        $rag = null;
        $failedCalls = [];
        $succeededCalls = [];
        $secretRequests = 0;
        $deadline = microtime(true) + (int) config('orbit.max_turn_seconds', 600);
        $maxIterations = (int) config('orbit.max_iterations', 8);

        // A tool call the user explicitly confirmed (button or typed utterance) runs first.
        $pending = $task->pending_tool_call;
        if (empty($pending['confirmed'])) {
            $userText = trim(trim($userMsg->content), "'\" \t\n\r\0\x0B.");
            $matched = false;

            if ($pending && !empty($pending['confirmation_phrase'])) {
                $expected = trim(trim($pending['confirmation_phrase']), "'\" \t\n\r\0\x0B.");
                if (strcasecmp($userText, $expected) === 0) {
                    $matched = true;
                    if (isset($pending['args'])) {
                        $pending['args']['typed_phrase'] = $userText;
                    }
                }
            } elseif ($pending && empty($pending['requires_typed_confirmation'])) {
                if (in_array(strtolower($userText), ['yes', 'confirm', 'proceed', 'go ahead', 'do it', 'ok', 'okay', 'sure'], true)) {
                    $matched = true;
                }
            }

            if (!$matched) {
                // Check if there is an active pending DataChangeRequest in DB
                $activeChange = \App\Models\DataChangeRequest::where('user_id', $user->id)
                    ->where('status', 'pending_confirmation')
                    ->where('expires_at', '>', now())
                    ->latest()
                    ->first();
                if ($activeChange) {
                    $expected = trim(trim($activeChange->confirmation_phrase), "'\" \t\n\r\0\x0B.");
                    if ($expected !== '' && strcasecmp($userText, $expected) === 0) {
                        $matched = true;
                        $pending = [
                            'name' => 'confirm_data_change',
                            'args' => [
                                'change_request_id' => $activeChange->id,
                                'typed_phrase' => $userText,
                            ],
                            'confirmation_phrase' => $expected,
                            'hash' => self::argsHash('confirm_data_change', ['change_request_id' => $activeChange->id]),
                        ];
                    } elseif ($activeChange->action !== 'delete' && in_array(strtolower($userText), ['yes', 'confirm', 'proceed', 'go ahead', 'do it', 'ok', 'okay', 'sure'], true)) {
                        $matched = true;
                        $pending = [
                            'name' => 'confirm_data_change',
                            'args' => [
                                'change_request_id' => $activeChange->id,
                            ],
                            'confirmation_phrase' => $expected,
                            'hash' => self::argsHash('confirm_data_change', ['change_request_id' => $activeChange->id]),
                        ];
                    }
                }
            }

            if ($matched) {
                $pending['confirmed'] = true;
            }
        }

        if (!empty($pending['confirmed'])) {
            $task->update(['pending_tool_call' => null]);
            $this->timeline($task, 'USER_CONFIRMED', 'succeeded', "You confirmed: {$pending['name']}.");
            $confirmedObs = $this->executeTool($task, $user, $turnId, 0, $pending['name'], $pending['args'] ?? [], true);
            if (!empty($confirmedObs['result']['success'])) {
                $this->confirmedStepDone = true;
                // Never run the confirmed step twice, and say plainly that it is done.
                $succeededCalls[$pending['hash'] ?? self::argsHash($pending['name'], $pending['args'] ?? [])] = ['repeats' => 0];
                if ($pending['name'] === 'confirm_data_change') {
                    $observations[] = $confirmedObs;
                    $this->finishFromObservations($task, $observations);
                    return;
                }
                // Set before the observation is recorded, so the model really sees it.
                $confirmedObs['result']['next_step'] = 'The user confirmed this step and it succeeded. Do not repeat it. '
                    . 'Reply with COMPLETE describing the result, unless the request had other parts still to do.';
            }
            $observations[] = $confirmedObs;
        }

        // A question about the user's own data takes the focused path (small model calls, same gate).
        $schemaDocs = $this->context->schemaDocuments($user);
        if ($observations === [] && $this->answerDataQuestion($task, $user, $turnId, $userMsg, $model, $schemaDocs)) {
            return;
        }

        for ($i = 0; $i < $maxIterations; $i++) {
            $task->refresh();
            if (in_array($task->status, ['INTERRUPT_REQUESTED', 'CANCELLED'], true)) {
                $this->finishCancelled($task, $observations);
                return;
            }
            if (in_array($task->status, ['PAUSE_REQUESTED', 'PAUSED'], true)) {
                $this->finishPaused($task, $observations);
                return;
            }
            if ($task->pending_user_turn) {
                $newer = $this->latestUserMessage($task);
                if ($newer && $newer->id !== $userMsg->id) {
                    $userMsg = $newer;
                    $this->timeline($task, 'PLAN_SUPERSEDED', 'succeeded',
                        "New instruction received; continuing with plan version {$task->plan_version}.");
                    $observations[] = [
                        'iteration' => $i,
                        'tool' => '_user_spoke_again',
                        'args' => [],
                        'result' => ['note' => 'The user spoke again while you were working. Results above are real; anything marked side_effect_committed already happened. Decide based on the new utterance.'],
                    ];
                }
                $task->update(['pending_user_turn' => false]);
            }
            if (microtime(true) > $deadline) {
                $this->finishLimit($task, $observations, 'TURN_TIMEOUT');
                return;
            }

            $this->stage($task, 'THINKING', $i);
            LiveEventService::publish($task->user_id, 'agent.thinking', [
                'task_id' => $task->id,
                'text' => 'Analyzing database schema, permissions and user prompt.',
                'next' => [],
                'model' => $modelLabel,
            ], 'AgentTask', (string) $task->id);
            $response = $this->ai->decide([
                'user_id' => $user->id,
                'utterance' => $userMsg->content,
                'runtime_context' => $this->context->build($user, $task, ['provider' => $model['provider'], 'model' => $model['model']], $userMsg->content),
                'tool_schemas' => AgentToolRegistry::modelVisibleSchemas($user, $task->autonomy_level ?: 'CONFIRM_CONSEQUENTIAL_CHANGES'),
                'portal_map' => SurfaceCatalog::modelSummary(),
                'product_name' => (string) config('platform.brand_name'),
                'system_prompt' => self::branded((string) \App\Settings\PlatformSettings::get('orbit.system_prompt')) ?: null,
                'system_instructions' => self::branded((string) \App\Settings\PlatformSettings::get('orbit.system_instructions')) ?: null,
                'decision_schema' => \App\Settings\PlatformSettings::get('orbit.decision_schema') ?: null,
                'observations' => $observations,
                'conversation_summary' => $this->context->conversationSummary($task, $userMsg->id),
                'slots' => $task->slots ?: (object) [],
                'retrieved_context' => $retrieved,
                // Every table of every connected database, for retrieval; later iterations reuse what was retrieved.
                'schema_documents' => $retrieved === null ? $schemaDocs : [],
                'use_rag' => true,
                'iteration' => $i,
                'provider' => $model['provider'],
                'model' => $model['model'],
                'api_key' => $model['api_key'],
                'temperature' => $model['temperature'] ?? null,
                'max_repairs' => (int) config('orbit.max_repairs', 1),
                // The AI service must answer before our HTTP client gives up (no orphaned model work).
                'deadline_seconds' => max(20, (int) config('orbit.decide_timeout_seconds', 300) - 20),
            ], (int) config('orbit.decide_timeout_seconds', 300));

            if ($rag === null && isset($response['rag'])) {
                $rag = $response['rag'];
                if (!empty($rag['used'])) {
                    $retrieved = $rag['chunks'] ?? null;
                }
                if (!empty($rag['attempted'])) {
                    $this->timeline($task, 'RAG_RETRIEVAL', !empty($rag['error']) ? 'failed' : 'succeeded',
                        !empty($rag['error']) ? $rag['error']
                            : (!empty($rag['used'])
                                ? 'Used ' . count($rag['source_ids'] ?? []) . ' knowledge passage(s): ' . implode(', ', array_slice($rag['source_ids'] ?? [], 0, 5))
                                : 'No relevant knowledge passages for this request.'),
                        array_diff_key($rag, ['chunks' => true]));
                }
            }

            if (empty($response['success']) || empty($response['decision'])) {
                $this->finishSystem($task, 'FAILED', $response['error_category'] ?? 'AI_SERVICE_ERROR',
                    $this->serviceErrorSpeech($response['error_category'] ?? '', $response['error_message'] ?? ''), $observations);
                return;
            }

            $decision = $response['decision'];
            $task->update(['iteration_count' => $i + 1]);
            $this->mergeSlots($task, $decision['slot_updates'] ?? []);
            // The decision is the model's: the server never rewrites it into another tool or a canned question. Which
            // database a request means is decided from the retrieved schema of every connection and what the user
            // said; a data tool given no connection_id while several exist answers CONNECTION_REQUIRED instead of
            // picking one (ConnectionResolver).

            // Orbit's visible thinking: what it understood and what it does next (never secrets: the AI service
            // refuses secret-like content in decisions), plus why another model answered, once per request.
            $notes = array_values(array_filter((array) ($response['model_notes'] ?? []), 'is_string'));
            if ($notes !== [] && !$this->modelNoteShown) {
                $this->modelNoteShown = true;
                $this->timeline($task, 'MODEL_FALLBACK', 'info', 'Model: ' . implode('; ', array_slice($notes, 0, 3)) . '.');
            }
            $thought = trim((string) ($decision['thought'] ?? $decision['reasoning_summary'] ?? ''));
            $modelUsed = $response['model_used'] ?? $model['model'];
            $providerUsed = $response['provider_used'] ?? $model['provider'];
            $decisionModelLabel = ModelSelector::labelFor($providerUsed, $modelUsed);

            LiveEventService::publish($task->user_id, 'agent.thinking', array_filter([
                'task_id' => $task->id,
                'text' => $thought !== '' ? mb_substr($thought, 0, 500) : 'Evaluated request and selected next action.',
                'next' => $decision['kind'] === 'CALL_TOOL'
                    ? array_map(fn (array $call) => $this->stepLabel((string) ($call['name'] ?? ''), (array) ($call['args'] ?? [])),
                        array_values(array_filter(array_merge([$decision['tool_call'] ?? null], (array) ($decision['then'] ?? [])), 'is_array')))
                    : null,
                'model' => $decisionModelLabel,
            ], fn ($v) => $v !== null && $v !== ''), 'AgentTask', (string) $task->id);

            switch ($decision['kind']) {
                case 'CALL_TOOL':
                    $name = (string) ($decision['tool_call']['name'] ?? '');
                    $args = (array) ($decision['tool_call']['args'] ?? []);
                    $hash = self::argsHash($name, $args);

                    if (isset($succeededCalls[$hash])) {
                        // Identical successful call: never re-run it; finish immediately with earlier result.
                        $this->finishFromObservations($task, $observations);
                        return;
                    }

                    if (($failedCalls[$hash] ?? 0) >= 1) {
                        // Identical failed call: stop looping immediately.
                        $this->finishLimit($task, $observations, 'REPEATED_FAILED_CALL');
                        return;
                    }

                    if (trim((string) ($decision['speech_text'] ?? '')) !== '') {
                        LiveEventService::publish($task->user_id, 'agent.narration', [
                            'task_id' => $task->id, 'text' => mb_substr($decision['speech_text'], 0, 200), 'tool' => $name,
                        ], 'AgentTask', (string) $task->id);
                    }

                    // What is on screen is the model's choice, made with fill_fields/choose_option and checked by the
                    // page; the server never switches the database or table behind it (a remembered connection_id or a
                    // word in the message is not what the user chose now). The press result names where it acted.
                    $confirmed =!ToolPolicyGate::needsPanelButton($name, $args)
                        && $this->confirmedByLaterUtterance($task, $hash, $userMsg->id);
                    $observation = $this->executeTool($task, $user, $turnId, $i, $name, $args, $confirmed);
                    if (($observation['result']['error_category'] ?? null) === 'CONFIRMATION_REQUIRED') {
                        $task->update(['pending_tool_call' => [
                            'name' => $name, 'args' => $observation['args'], 'hash' => $hash,
                            'requested_after_message_id' => $userMsg->id, 'confirmed' => false,
                        ]]);
                    } elseif ($confirmed) {
                        $task->update(['pending_tool_call' => null]);
                    }
                    $observations[] = $observation;
                    if (!empty($observation['result']['success'])) {
                        $succeededCalls[$hash] = ['repeats' => 0];

                        // If this was preview_data_change, finish turn as WAITING_FOR_APPROVAL immediately!
                        if ($name === 'preview_data_change') {
                            $data = $observation['result']['data'] ?? [];
                            $changeId = $data['change_request_id'] ?? null;
                            $phrase = $data['confirmation_phrase'] ?? null;
                            $table = $data['table'] ?? ($args['table'] ?? 'records');
                            $action = $data['action'] ?? ($args['action'] ?? 'change');
                            $count = $data['affected_count'] ?? 1;

                            $task->update([
                                'pending_tool_call' => [
                                    'name' => 'confirm_data_change',
                                    // No phrase here: a delete's phrase counts only when the user types it.
                                    'args' => [
                                        'change_request_id' => $changeId,
                                        'table' => $table,
                                        'action' => $action,
                                    ],
                                    'change_request_id' => $changeId,
                                    'confirmation_phrase' => $phrase,
                                    'requires_typed_confirmation' => !empty($data['requires_typed_confirmation']),
                                    'requested_after_message_id' => $userMsg->id,
                                    'confirmed' => false,
                                ],
                                'slots' => array_merge($task->slots ?? [], [
                                    'pending_change_request_id' => $changeId,
                                    'pending_confirmation_phrase' => $phrase,
                                ]),
                            ]);

                            $speech = $this->confirmationSpeech($userMsg->content, $model, $data, $args, $observation['result']['safe_message'] ?? '');

                            $decision = [
                                'kind' => 'REQUEST_CONFIRMATION',
                                'speech_text' => $speech,
                                'emotion_hint' => 'attentive',
                                'response_style' => 'conversational',
                            ];
                            $this->finish($task, $decision, $observations, $rag, 'WAITING_FOR_APPROVAL');
                            return;
                        }

                        // Steps the model already knew run now, without asking it again (each one still gated).
                        $chainOk = true;
                        foreach (array_slice((array) ($decision['then'] ?? []), 0, 6) as $step) {
                            $stepName = (string) ($step['name'] ?? '');
                            $stepArgs = (array) ($step['args'] ?? []);
                            if (!self::chainable($stepName, $stepArgs)) {
                                $observations[] = ['iteration' => $i, 'tool' => $stepName, 'args' => $stepArgs, 'result' => [
                                    'success' => false, 'error_category' => 'NOT_CHAINABLE',
                                    'safe_message' => 'Not run: only on-screen steps that change nothing can follow automatically. Call it on its own.']];
                                $chainOk = false;
                                break;
                            }
                            $stepHash = self::argsHash($stepName, $stepArgs);
                            if (isset($succeededCalls[$stepHash])) {
                                continue;
                            }
                            $stepObs = $this->executeTool($task, $user, $turnId, $i, $stepName, $stepArgs, false);
                            $observations[] = $stepObs;
                            if (empty($stepObs['result']['success'])) {
                                $chainOk = false;
                                break;
                            }
                            $succeededCalls[$stepHash] = ['repeats' => 0];
                        }

                        // The request is done: report the verified result now instead of asking the model again.
                        $finishes = in_array($name, ['give_tour', 'explain_page'], true) || !empty($decision['finish_after']);
                        if ($chainOk && $finishes) {
                            $this->finishFromObservations($task, $observations, self::followUpOffer($name, $args));
                            return;
                        }
                    } elseif (($observation['result']['error_category'] ?? null) === 'SECRET_REQUIRED') {
                        if (++$secretRequests >= 2) {
                            // The model was told to ask and did not: ask through the secure channel ourselves.
                            $this->finishNeedsSecret($task, $observation['result']['secure_input_type'] ?? 'database_password', $observations);
                            return;
                        }
                    } else {
                        $failedCalls[$hash] = ($failedCalls[$hash] ?? 0) + 1;
                    }
                    continue 2;

                case 'CREATE_OR_REVISE_PLAN':
                    $plan = array_map(fn ($p) => ['tool' => $p['tool'] ?? '', 'label' => $p['purpose'] ?? ($p['tool'] ?? '')], $decision['plan'] ?? []);
                    $task->update(['active_plan' => $plan]);
                    $this->timeline($task, 'PLAN', 'succeeded', 'Plan: ' . implode(' → ', array_column($plan, 'tool')), ['plan' => $plan]);
                    $this->broadcastTaskUpdate($task);
                    $observations[] = ['iteration' => $i, 'tool' => '_plan_recorded', 'args' => [],
                        'result' => ['success' => true, 'note' => 'Plan recorded. Now carry it out one CALL_TOOL at a time.']];
                    continue 2;

                case 'INTERRUPT_OR_CANCEL':
                    $action = $decision['cancel_action'] ?? 'STOP';
                    if ($action === 'RESUME') {
                        $observations[] = ['iteration' => $i, 'tool' => '_resumed', 'args' => [],
                            'result' => ['success' => true, 'note' => 'Resuming. Continue the original request from where it stopped.']];
                        continue 2;
                    }
                    $status = $action === 'PAUSE' ? 'PAUSED' : 'CANCELLED';
                    $this->finish($task, $decision, $observations, $rag, $status);
                    return;

                default:
                    $this->finish($task, $decision, $observations, $rag);
                    return;
            }
        }

        $this->finishLimit($task, $observations, 'ITERATION_LIMIT');
    }

    /**
     * Gate, show, execute, verify and record one tool call. Returns the observation for the model.
     */
    protected function executeTool(AgentTask $task, User $user, string $turnId, int $iteration, string $name, array $args, bool $confirmed): array
    {
        $traceId = bin2hex(random_bytes(8));
        $safeArgs = array_filter($args, fn ($k) => !SecretVault::looksSecretKey((string) $k), ARRAY_FILTER_USE_KEY);
        $gate = $this->gate->check($user, $task, $name, $safeArgs, $confirmed);
        $label = $gate['def']['label'] ?? $name;

        if (!$gate['ok']) {
            $result = $this->runner->result(false, $gate['error_category'], $gate['safe_message']);
            $this->persistCall($task, $turnId, $iteration, $name, $gate['def']['version'] ?? 1, $safeArgs, 'rejected', $result, $traceId, now());
            $held = $gate['error_category'] === 'CONFIRMATION_REQUIRED';
            // The gate's text is written for the model; the person sees plain wording.
            if (!$held && in_array($gate['error_category'], self::SELF_CORRECTED, true)) {
                // The model's own slip (bad arguments, unknown tool): it corrects itself next step; the
                // attempt stays in the audit records but is not shown to the user as a failure.
                return ['iteration' => $iteration, 'tool' => $name, 'args' => $safeArgs, 'result' => $this->runner->modelView($result)];
            }
            $this->timeline($task, $label, $held ? 'waiting' : 'failed', $held
                ? (ToolPolicyGate::needsPanelButton($name, $safeArgs)
                    ? 'Held until you press Confirm in this panel (a typed "yes" does not count for removals).'
                    : 'Held until you confirm.')
                : $gate['safe_message']);
            return ['iteration' => $iteration, 'tool' => $name, 'args' => $safeArgs, 'result' => $this->runner->modelView($result)];
        }

        $args = $gate['args'];
        $def = $gate['def'];
        $this->stage($task, 'CALLING_TOOL', $iteration, $name);

        if ($def['side_effect_class'] === 'ui') {
            $label = $this->uiLabel($name, $args);
        }

        $missing = $this->runner->missingSecret($task, $def, $args);
        if ($missing !== null) {
            $secretLabel = $missing === 'api_key' ? 'API key' : 'database password';
            $how = UiActionCoordinator::clientPresent($user->id)
                ? 'Prefer doing this on screen: open the form, fill it, then ask_secret_in_form so the user types it in the form.'
                : 'Ask the user to enter it in the secure field (WAIT_FOR_USER with secure_input_type).';
            $result = $this->runner->result(false, 'SECRET_REQUIRED',
                "Not run yet: the {$secretLabel} has not been captured. {$how}",
                retryable: true, extra: ['secure_input_type' => $missing]);
            $this->persistCall($task, $turnId, $iteration, $name, $def['version'], $args, 'rejected', $result, $traceId, now());
            $this->timeline($task, $missing === 'api_key' ? 'API_KEY_NEEDED' : 'PASSWORD_NEEDED', 'waiting',
                "Waiting for the {$secretLabel} before running {$label}.");
            return ['iteration' => $iteration, 'tool' => $name, 'args' => $args, 'result' => $this->runner->modelView($result)];
        }

        // Re-check cancellation immediately before the side effect.
        $task->refresh();
        if (in_array($task->status, ['INTERRUPT_REQUESTED', 'CANCELLED', 'PAUSE_REQUESTED', 'PAUSED'], true)) {
            $result = $this->runner->result(false, 'CANCELLED_BEFORE_EXECUTION', "Stopped before running {$label}; nothing was changed.");
            $this->persistCall($task, $turnId, $iteration, $name, $def['version'], $args, 'rejected', $result, $traceId, now());
            return ['iteration' => $iteration, 'tool' => $name, 'args' => $args, 'result' => $this->runner->modelView($result)];
        }

        LiveEventService::publish($task->user_id, 'agent.tool_started', [
            'task_id' => $task->id, 'trace_id' => $traceId, 'tool' => $name, 'label' => $label,
            'side_effect_class' => $def['side_effect_class'],
        ], 'AgentTask', (string) $task->id);
        $this->timeline($task, $label, 'running', "Running {$label}…", ['trace_id' => $traceId]);

        $started = now();
        // With the portal open, a backend action that has an on-screen equivalent is done on screen (the user watches
        // Orbit go there and press the page's own button); it falls back to the backend tool only if nothing was pressed.
        $result = $def['side_effect_class'] !== 'ui' ? $this->runVisibly($user, $task, $name, $args, $traceId) : null;
        $result ??= $this->runner->run($user, $task, $def, $args);
        $this->persistCall($task, $turnId, $iteration, $name, $def['version'], $args, $result['success'] ? 'succeeded' : 'failed', $result, $traceId, $started);

        LiveEventService::publish($task->user_id, 'agent.tool_finished', [
            'task_id' => $task->id, 'trace_id' => $traceId, 'tool' => $name, 'label' => $label,
            'success' => $result['success'], 'status' => $result['status'], 'error_category' => $result['error_category'],
            'safe_message' => $result['safe_message'], 'verified' => $result['verified'],
            'resource_refs' => $result['resource_refs'],
        ], 'AgentTask', (string) $task->id);
        // A field the page rejected, or a part not on screen yet, is something Orbit adjusts to, not a failure.
        $adjusted = !$result['success'] && in_array($result['error_category'], ['NOT_ON_SCREEN', 'VALIDATION_ERROR'], true);
        $this->timeline($task, $label, $result['success'] ? 'succeeded' : ($adjusted ? 'adjusted' : 'failed'),
            $adjusted && $result['error_category'] === 'NOT_ON_SCREEN' ? 'Not on screen yet; finding it another way.' : $result['safe_message'],
            array_filter(['trace_id' => $traceId, 'verification' => $result['verification'] ?? null]));

        if ($result['success']) {
            $this->trackResources($task, $result['resource_refs']);
        }
        $view = $this->runner->modelView($result);
        if ($result['success'] === false && in_array($result['error_category'], ['SECRET_REQUIRED'], true)) {
            $view['hint'] = 'Return WAIT_FOR_USER with secure_input_type ' . ($result['secure_input_type'] ?? 'database_password') . '.';
        }

        return ['iteration' => $iteration, 'tool' => $name, 'args' => $args, 'result' => $view];
    }

    /**
     * Carry out a backend tool on screen when the portal is open and the page has the same action. Returns the
     * verified result, or null to let the backend tool run (no equivalent, no browser, or nothing was pressed).
     */
    protected function runVisibly(User $user, AgentTask $task, string $tool, array $args, string $traceId): ?array
    {
        $steps = VisibleEquivalent::steps($tool, $args);
        if ($steps === null || !UiActionCoordinator::clientPresent($user->id)) {
            return null;
        }
        $since = now();
        foreach ($steps as $step) {
            $def = AgentToolRegistry::definition($step['tool']);
            if ($def === null) {
                return null;
            }
            $label = $this->uiLabel($step['tool'], $step['args']);
            LiveEventService::publish($task->user_id, 'agent.tool_started', [
                'task_id' => $task->id, 'trace_id' => $traceId, 'tool' => $step['tool'], 'label' => $label,
                'side_effect_class' => 'ui', 'on_behalf_of' => $tool,
            ], 'AgentTask', (string) $task->id);
            $res = $this->runner->runUi($user, $task, $def, $step['args']);
            LiveEventService::publish($task->user_id, 'agent.tool_finished', [
                'task_id' => $task->id, 'trace_id' => $traceId, 'tool' => $step['tool'], 'label' => $label,
                'success' => $res['success'], 'status' => $res['status'], 'error_category' => $res['error_category'],
                'safe_message' => $res['safe_message'], 'verified' => $res['verified'] ?? false, 'resource_refs' => $res['resource_refs'] ?? [],
            ], 'AgentTask', (string) $task->id);
            if (!$res['success']) {
                $pressed = $step['tool'] === 'press' && !in_array($res['error_category'], ['NOT_ON_SCREEN', 'NO_BROWSER'], true);
                if (!$pressed) {
                    $this->timeline($task, $label, 'adjusted', 'Not on screen; doing it directly instead.', ['trace_id' => $traceId]);
                    return null;
                }
                // The page pressed and reported a problem (or did not answer): report it, never repeat it in the background.
                return $res;
            }
        }

        $check = VisibleEquivalent::verify($tool, $args, $user->id, $since);
        if (!$check['ok']) {
            return $this->runner->result(false, 'VERIFICATION_FAILED', $check['message'], committed: true);
        }

        return $this->runner->result(true, null, $check['message'], committed: true, refs: $check['refs'], extra: [
            'verified' => true,
            'verification' => 'Checked on the server after Orbit pressed the button on screen.',
        ]);
    }

    /** Plain words for a planned step, shown in Orbit's thinking line. */
    protected function stepLabel(string $tool, array $args): string
    {
        if (in_array($tool, AgentToolRegistry::UI_TOOLS, true)) {
            return $this->uiLabel($tool, $args);
        }

        return ucfirst(str_replace('_', ' ', $tool));
    }

    /** Human-readable timeline label for an on-screen action. */
    protected function uiLabel(string $tool, array $args): string
    {
        $surface = isset($args['surface']) ? SurfaceCatalog::surface((string) $args['surface']) : null;
        $title = $surface['title'] ?? ($args['surface'] ?? '');
        $row = isset($args['row']) && $args['row'] !== '' ? " #{$args['row']}" : '';
        switch ($tool) {
            case 'go_to_page':
                $page = collect(SurfaceCatalog::data()['pages'])->firstWhere('route', $args['page'] ?? '');
                return 'Go to ' . ($page['title'] ?? ($args['page'] ?? 'page'));
            case 'open_form':
                return "Open {$title}";
            case 'read_screen':
                return 'Read the screen';
            case 'fill_fields':
                return 'Fill ' . implode(', ', array_keys((array) ($args['values'] ?? []))) . " in {$title}{$row}";
            case 'choose_option':
                return "Choose {$args['field']} in {$title}{$row}";
            case 'press':
                $action = $surface ? SurfaceCatalog::action($surface, (string) ($args['action'] ?? '')) : null;
                return 'Press "' . ($action['label'] ?? ($args['action'] ?? '')) . "\"{$row}";
            case 'ask_secret_in_form':
                return "Ask you to type the {$args['field']} in {$title}";
            case 'show_me':
                return "Show you {$title}";
            case 'give_tour':
                return 'Give you a tour of the portal';
            case 'explain_page':
                $page = collect(SurfaceCatalog::data()['pages'])->firstWhere('route', $args['page'] ?? '');
                return (($args['depth'] ?? '') === 'detailed' ? 'Walk you through ' : 'Explain ') . ($page['title'] ?? 'this page');
        }

        return $tool;
    }

    // ------------------------------------------------------------------
    // Turn endings
    // ------------------------------------------------------------------

    protected function finish(AgentTask $task, array $decision, array $observations, ?array $rag, ?string $forcedStatus = null): void
    {
        $kind = $decision['kind'];

        // The user pressed Confirm, the confirmed step succeeded, and the model only asks again with no
        // further progress and nothing new held: report the verified result instead of a misleading re-ask.
        $successes = count(array_filter($observations, fn ($o) => !empty($o['result']['success']) && ($o['result']['status'] ?? '') !== 'already_done'));
        if ($this->confirmedStepDone && $forcedStatus === null && $successes === 1 && empty($task->pending_tool_call)
            && in_array($kind, ['ASK_CLARIFICATION', 'REQUEST_CONFIRMATION', 'WAIT_FOR_USER'], true)
            && empty($decision['secure_input_type']) && count($task->active_plan ?? []) <= 1) {
            $this->finishFromObservations($task, $observations);
            return;
        }
        $status = $forcedStatus ?? (self::TERMINAL_STATUS[$kind] ?? 'ANSWERED');
        $verified = $this->verifiedCalls($observations);
        $emotion = $decision['emotion_hint'] ?? 'neutral';

        // Truthfulness guards: no "complete" without a verified tool result this turn,
        // and no celebration unless the task really succeeded.
        if ($kind === 'COMPLETE' && empty($verified)) {
            $status = 'ANSWERED';
        }
        if ($kind === 'ANSWER' && !empty($verified)) {
            $status = 'SUCCEEDED';
        }
        if ($emotion === 'celebrating' && $status !== 'SUCCEEDED') {
            $emotion = 'happy';
        }

        // A confirmation request with nothing held by the gate has nothing to confirm: it is a question.
        if ($status === 'WAITING_FOR_APPROVAL' && empty($task->pending_tool_call)) {
            $status = 'WAITING_FOR_INPUT';
        }
        // The gate held a step for confirmation and the model ended the turn without REQUEST_CONFIRMATION
        // (e.g. it asked in plain words): keep the step pending so the panel shows the Confirm button.
        $last = end($observations);
        if ($status !== 'WAITING_FOR_APPROVAL' && !empty($task->pending_tool_call) && empty($task->pending_tool_call['confirmed'])
            && $last && ($last['result']['error_category'] ?? null) === 'CONFIRMATION_REQUIRED') {
            $status = 'WAITING_FOR_APPROVAL';
        }

        $secureType = $kind === 'WAIT_FOR_USER' ? ($decision['secure_input_type'] ?? null) : null;
        if ($secureType !== null && !$this->secretIsRelevant($task, $secureType, $observations)) {
            $secureType = null; // never show a password/key box for a question that does not need one
        }
        $last = end($observations);
        if ($last && $last['tool'] === 'ask_secret_in_form' && !empty($last['result']['success'])) {
            $secureType = null; // the user types it into the real form; no second input card
        }
        $speech = (string) $decision['speech_text'];
        $held = $task->pending_tool_call;
        if ($status === 'WAITING_FOR_APPROVAL' && $held && ToolPolicyGate::needsPanelButton($held['name'] ?? '', $held['args'] ?? [])) {
            // Removals are confirmed only by the panel button, whatever the model said ("say yes" does not work).
            $speech = rtrim($speech) . ' To go ahead, press Confirm in my panel.';
        }
        $lastDecision = [
            'kind' => $kind,
            'speech_text' => $speech,
            'emotion_hint' => $emotion,
            'response_style' => $decision['response_style'] ?? 'conversational',
            'secure_input_type' => $secureType,
            'missing_fields' => $decision['missing_fields'] ?? [],
        ];

        $task->update([
            'status' => $status,
            'stage' => 'DONE',
            'last_decision' => $lastDecision,
            'final_verification' => $verified ?: null,
            'pending_tool_call' => $status === 'WAITING_FOR_APPROVAL' ? $task->pending_tool_call : null,
            'completed_at' => in_array($status, ['SUCCEEDED', 'ANSWERED', 'PARTIAL_SUCCESS', 'CANCELLED'], true) ? now() : null,
            'cancelled_at' => $status === 'CANCELLED' ? now() : $task->cancelled_at,
            'paused_at' => $status === 'PAUSED' ? now() : $task->paused_at,
            'error_message' => null,
        ]);

        $this->speak($task, $speech, $lastDecision, $observations, $rag, 'model');
    }

    /** Ask for a secret through the secure channel when the model did not. */
    protected function finishNeedsSecret(AgentTask $task, string $kind, array $observations): void
    {
        $label = $kind === 'api_key' ? 'API key' : 'database password';
        $text = "I need the {$label} to continue. Please type it into the secure field; it never goes into our conversation.";
        $decision = ['kind' => 'WAIT_FOR_USER', 'speech_text' => $text, 'emotion_hint' => 'attentive',
            'response_style' => 'question', 'secure_input_type' => $kind, 'missing_fields' => [$kind]];
        $task->update(['status' => 'WAITING_FOR_INPUT', 'stage' => 'DONE', 'last_decision' => $decision, 'error_message' => null]);
        $this->speak($task, $text, $decision, $observations, null, 'system');
    }

    /** The model finished or had earlier successful calls: report what the observations show. */
    /** Only on-screen steps that change nothing may follow a tool call automatically (`then`). */
    public static function chainable(string $tool, array $args): bool
    {
        if (!in_array($tool, ['go_to_page', 'open_form', 'fill_fields', 'choose_option', 'show_me', 'press'], true)) {
            return false;
        }
        if ($tool !== 'press') {
            return true;
        }
        $surface = SurfaceCatalog::surface((string) ($args['surface'] ?? ''));
        $action = $surface ? SurfaceCatalog::action($surface, (string) ($args['action'] ?? '')) : null;

        return $action !== null && empty($action['consequential']) && empty($action['destructive']);
    }

    /** What Orbit offers after explaining something, so the user can go deeper with one word. */
    public static function followUpOffer(string $tool, array $args): string
    {
        return match (true) {
            $tool === 'give_tour' => 'Would you like me to go through any of these pages in detail?',
            $tool === 'explain_page' && ($args['depth'] ?? 'overview') !== 'detailed' => 'Would you like the detailed version of this page, where I open each part and explain every button?',
            default => '',
        };
    }

    protected function finishFromObservations(AgentTask $task, array $observations, string $suffix = ''): void
    {
        $results = array_values(array_filter($observations, fn ($o) => !empty($o['result']['success']) && !str_starts_with($o['tool'], '_')
            && ($o['result']['status'] ?? '') !== 'already_done'));
        $last = end($results);

        if ($last && $last['tool'] === 'preview_data_change') {
            $utterance = (string) ($this->latestUserMessage($task)?->content ?? '');
            $text = $this->confirmationSpeech($utterance, $this->modelSelection($task->user), $last['result']['data'] ?? [],
                (array) ($last['args'] ?? []), (string) ($last['result']['safe_message'] ?? ''));

            $decision =['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => $text, 'emotion_hint' => 'attentive', 'response_style' => 'conversational'];
            $task->update(['status' => 'WAITING_FOR_APPROVAL', 'stage' => 'DONE', 'last_decision' => $decision, 'completed_at' => null]);
            $this->speak($task, $text, $decision, $observations, null, 'system');
            return;
        }

        $text = $last ? rtrim((string) $last['result']['safe_message'], '.') . '.' : 'I could not finish that request.';
        if ($text === 'Done.' || $text === 'Done') {
            $text = $last ? "I completed the {$last['tool']} step." : "Completed your request.";
        }
        if ($last && $suffix !== '') {
            $text .= ' ' . $suffix;
        }
        $verified = $this->verifiedCalls($observations);
        // The model stopped making progress: only a committed, verified write counts as success.
        $committed = $this->committedSummary($observations) !== '';
        $decision = ['kind' => 'RESULT_SUMMARY', 'speech_text' => $text, 'emotion_hint' => $committed ? 'happy' : 'neutral', 'response_style' => 'result'];
        $task->update(['status' => $committed ? 'SUCCEEDED' : 'ANSWERED', 'stage' => 'DONE', 'last_decision' => $decision,
            'final_verification' => $verified ?: null, 'completed_at' => now(), 'pending_tool_call' => null]);
        $this->speak($task, $text, $decision, $observations, null, 'system');
    }

    protected function finishCancelled(AgentTask $task, array $observations): void
    {
        $done = $this->committedSummary($observations);
        $text = $done ? "Stopped. Before stopping I had already completed: {$done}. Nothing else was changed." : 'Stopped. Nothing was changed.';
        $this->finishSystem($task, 'CANCELLED', null, $text, $observations);
    }

    protected function finishPaused(AgentTask $task, array $observations): void
    {
        $done = $this->committedSummary($observations);
        $text = 'Paused.' . ($done ? " Completed so far: {$done}." : '') . ' Say resume when you want me to continue.';
        $this->finishSystem($task, 'PAUSED', null, $text, $observations);
    }

    protected function finishLimit(AgentTask $task, array $observations, string $reason): void
    {
        $done = $this->committedSummary($observations);
        $why = match ($reason) {
            'TURN_TIMEOUT' => 'it was taking too long',
            'REPEATED_FAILED_CALL' => 'the same step kept failing',
            default => 'it needed more steps than I am allowed in one turn',
        };
        $text = "I stopped because {$why}." . ($done ? " Completed: {$done}." : ' Nothing was changed.');
        $this->finishSystem($task, $done ? 'PARTIAL_SUCCESS' : 'FAILED', $reason, $text, $observations);
    }

    /**
     * Turn endings not produced by the model (service errors, limits, stop/pause).
     * Marked source=system so the UI never presents them as a generated answer.
     */
    protected function finishSystem(AgentTask $task, string $status, ?string $errorCategory, string $text, array $observations): void
    {
        $isError = $errorCategory !== null;
        $lastDecision = [
            'kind' => $isError ? 'SERVICE_ERROR' : $status,
            'speech_text' => $text,
            'emotion_hint' => $isError ? 'concerned' : 'attentive',
            'response_style' => $isError ? 'error' : 'status',
            'error_category' => $errorCategory,
        ];
        $task->update([
            'status' => $status,
            'stage' => 'DONE',
            'last_decision' => $lastDecision,
            'error_message' => $isError ? $text : null,
            'final_verification' => $this->verifiedCalls($observations) ?: null,
            'cancelled_at' => $status === 'CANCELLED' ? now() : $task->cancelled_at,
            'paused_at' => $status === 'PAUSED' ? now() : $task->paused_at,
            'pending_tool_call' => null,
        ]);
        $this->speak($task, $text, $lastDecision, $observations, null, 'system');
    }

    protected function speak(AgentTask $task, string $text, array $decision, array $observations, ?array $rag, string $source): void
    {
        RuntimeContextBuilder::rememberFromTask($task);
        $toolResults = array_values(array_map(fn ($o) => [
            'tool' => $o['tool'],
            'success' => $o['result']['success'] ?? null,
            'message' => $o['result']['safe_message'] ?? ($o['result']['note'] ?? null),
        ], array_filter($observations, fn ($o) => !str_starts_with($o['tool'], '_'))));

        $model = $this->modelSelection($task->user);
        $modelLabel = ModelSelector::labelFor($model['provider'], $model['model']);

        $meta = array_filter([
            'source' => $source,
            'is_service_error' => $decision['kind'] === 'SERVICE_ERROR',
            'decision_kind' => $decision['kind'],
            'emotion_hint' => $decision['emotion_hint'] ?? 'neutral',
            'response_style' => $decision['response_style'] ?? 'conversational',
            'missing_fields' => $decision['missing_fields'] ?? null,
            'error_category' => $decision['error_category'] ?? null,
            'task_id' => $task->id,
            'turn_id' => $task->current_turn_id,
            'thought' => $decision['thought'] ?? $decision['reasoning_summary'] ?? null,
            'model' => $modelLabel,
            'provider' => $model['provider'] ?? null,
            'rag' => $rag ? array_diff_key($rag, ['chunks' => true]) : null,
        ], fn ($v) => $v !== null && $v !== []);

        $message = AgentMessage::create([
            'conversation_id' => $task->conversation_id,
            'role' => 'assistant',
            'content' => $text,
            'secure_input_type' => $decision['secure_input_type'] ?? null,
            'tool_results' => $toolResults ?: null,
            'meta' => $meta,
            'created_at' => now(),
        ]);

        LiveEventService::publish($task->user_id, 'agent.speech', [
            'task_id' => $task->id,
            'message_id' => $message->id,
            'speech_text' => $text,
            'source' => $source,
            'is_service_error' => $meta['is_service_error'] ?? false,
            'decision_kind' => $decision['kind'],
            'emotion_hint' => $meta['emotion_hint'],
            'response_style' => $meta['response_style'],
            'secure_input_type' => $decision['secure_input_type'] ?? null,
            'missing_fields' => $decision['missing_fields'] ?? [],
            'task_status' => $task->status,
            'rag_used' => (bool) ($rag['used'] ?? false),
            'model' => $modelLabel,
            'thought' => $meta['thought'] ?? null,
        ], 'AgentTask', (string) $task->id);

        $this->broadcastTaskUpdate($task);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Model/provider for Orbit: the user's planner role, else their active provider, else
     * the platform default. Never silently swapped for a different provider.
     */
    public function modelSelection(User $user): array
    {
        return ModelSelector::for($user);
    }

    /**
     * A model-requested secure input box is shown only when a secret of that kind is really involved:
     * a tool this turn takes that secret (or asked for it), or the user is giving connection/provider details.
     */
    protected function secretIsRelevant(AgentTask $task, string $kind, array $observations): bool
    {
        foreach ($observations as $o) {
            $result = $o['result'] ?? [];
            if (($result['error_category'] ?? null) === 'SECRET_REQUIRED' || ($result['secure_input_type'] ?? null) === $kind) {
                return true;
            }
            if (in_array($kind, AgentToolRegistry::definition((string) ($o['tool'] ?? ''))['secret_params'] ?? [], true)) {
                return true;
            }
        }
        $slots = $task->slots ?? [];
        $needs = $kind === 'api_key' ? ['provider', 'provider_type'] : ['host', 'database', 'database_name', 'username'];

        return (bool) array_intersect($needs, array_keys($slots));
    }

    /** A spoken "yes" counts only if the user spoke after Orbit asked, for the same call. */
    protected function confirmedByLaterUtterance(AgentTask $task, string $hash, int $currentMessageId): bool
    {
        $pending = $task->pending_tool_call;
        return $pending
            && ($pending['hash'] ?? null) === $hash
            && $currentMessageId > (int) ($pending['requested_after_message_id'] ?? PHP_INT_MAX);
    }

    protected function mergeSlots(AgentTask $task, array $updates): void
    {
        $clean = [];
        foreach ($updates as $k => $v) {
            if (!is_string($k) || SecretVault::looksSecretKey($k) || !(is_scalar($v) || $v === null)) {
                continue;
            }
            $clean[mb_substr($k, 0, 60)] = is_string($v) ? mb_substr($v, 0, 300) : $v;
        }
        if ($clean) {
            $task->update(['slots' => array_merge($task->slots ?? [], $clean)]);
        }
    }

    protected function trackResources(AgentTask $task, array $refs): void
    {
        $map = ['connection_id' => 'DbConnection', 'automation_id' => 'Automation', 'execution_id' => 'AutomationExecution'];
        $slots = $task->slots ?? [];
        foreach ($map as $key => $type) {
            if (!empty($refs[$key])) {
                $slots[$key] = $refs[$key];
                $task->target_resource_type = $type;
                $task->target_resource_id = (string) $refs[$key];
            }
        }
        $task->slots = $slots;
        $task->save();
    }

    protected function verifiedCalls(array $observations): array
    {
        $out = [];
        foreach ($observations as $o) {
            if (!empty($o['result']['success']) && !empty($o['result']['verified'])) {
                $out[] = ['tool' => $o['tool'], 'message' => $o['result']['safe_message'] ?? null];
            }
        }

        return $out;
    }

    protected function committedSummary(array $observations): string
    {
        $done = [];
        foreach ($observations as $o) {
            if (!empty($o['result']['success']) && !empty($o['result']['side_effect_committed'])) {
                $done[] = rtrim((string) ($o['result']['safe_message'] ?? $o['tool']), '.');
            }
        }

        return implode('; ', $done);
    }

    protected function serviceErrorSpeech(string $category, string $message): string
    {
        return match ($category) {
            'MODEL_UNAVAILABLE' => "I can't reach my language model right now. {$message}",
            'MODEL_BUSY_OR_SLOW' => "My local model is overloaded and didn't finish in time, so I stopped. Nothing was changed. Please try again; freeing up memory on this computer makes me much faster.",
            'MODEL_OUTPUT_INVALID' => 'My language model gave me an answer I could not use safely, so I did not act on it. Please try again or rephrase.',
            'AI_SERVICE_UNAVAILABLE', 'AI_SERVICE_ERROR' => "My AI service is not responding, so I could not process that. {$message}",
            'PROVIDER_UNSUPPORTED' => "The selected AI provider can't drive Orbit. {$message}",
            default => "I couldn't process that because of a service problem. {$message}",
        };
    }

    public static function argsHash(string $name, array $args): string
    {
        ksort($args);
        return hash('sha256', $name . '|' . json_encode($args));
    }

    protected function latestUserMessage(AgentTask $task): ?AgentMessage
    {
        return AgentMessage::where('conversation_id', $task->conversation_id)->where('role', 'user')->latest('id')->first();
    }

    protected function persistCall(AgentTask $task, string $turnId, int $iteration, string $tool, int $version, array $args,
                                   string $status, array $result, string $traceId, $startedAt): void
    {
        AgentToolCall::create([
            'task_id' => $task->id,
            'user_id' => $task->user_id,
            'turn_id' => $turnId,
            'plan_version' => $task->plan_version,
            'iteration' => $iteration,
            'tool' => $tool,
            'tool_version' => $version,
            'args_redacted' => $args,
            'args_hash' => self::argsHash($tool, $args),
            'status' => $status,
            'error_category' => $result['error_category'],
            'side_effect_committed' => $result['side_effect_committed'],
            'verified' => $result['verified'],
            'result_sanitized' => $this->runner->modelView($result),
            'trace_id' => $traceId,
            'idempotency_key' => "{$task->id}:{$turnId}:{$iteration}",
            'started_at' => $startedAt,
            'finished_at' => now(),
        ]);
    }

    protected function stage(AgentTask $task, string $stage, int $iteration, ?string $tool = null): void
    {
        $task->update(['stage' => $stage]);
        $model = $this->modelSelection($task->user);
        $modelLabel = ModelSelector::labelFor($model['provider'], $model['model']);

        LiveEventService::publish($task->user_id, 'agent.turn_stage', array_filter([
            'task_id' => $task->id, 'stage' => $stage, 'iteration' => $iteration, 'tool' => $tool,
            'plan_version' => $task->plan_version,
            'model' => $modelLabel,
        ], fn ($v) => $v !== null), 'AgentTask', (string) $task->id);
    }

    public function timeline(AgentTask $task, string $step, string $status, string $message, ?array $details = null): void
    {
        $event = AgentTaskTimelineEvent::create([
            'task_id' => $task->id,
            'step_name' => mb_substr($step, 0, 190),
            'status' => $status,
            'message' => mb_substr($message, 0, 250),
            'details' => $details,
            'correlation_id' => $task->current_turn_id,
            'created_at' => now(),
        ]);
        LiveEventService::publish($task->user_id, 'agent.timeline_event', [
            'id' => $event->id,
            'task_id' => $task->id,
            'step_name' => $event->step_name,
            'status' => $status,
            'message' => $event->message,
            'details' => $details,
            'task_status' => $task->status,
            'created_at' => $event->created_at->toIso8601String(),
        ], 'AgentTask', (string) $task->id);
    }

    public function broadcastTaskUpdate(AgentTask $task): void
    {
        LiveEventService::publish($task->user_id, 'agent.task_updated', [
            'task_id' => $task->id,
            'status' => $task->status,
            'stage' => $task->stage,
            'plan_version' => $task->plan_version,
            'task_type' => $task->task_type,
            'target_resource_type' => $task->target_resource_type,
            'target_resource_id' => $task->target_resource_id,
            'error_message' => $task->error_message,
            'awaiting_confirmation_for' => $task->pending_tool_call['name'] ?? null,
            'slots' => $task->slots,
        ], 'AgentTask', (string) $task->id);
    }
}
