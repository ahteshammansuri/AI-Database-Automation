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

    public function __construct(
        protected AiServiceClient $ai,
        protected SecretVault $vault,
        protected ToolPolicyGate $gate,
        protected ToolRunner $runner,
        protected RuntimeContextBuilder $context,
        protected UiActionCoordinator $ui,
    ) {
    }

    public function runTurn(int $taskId, string $turnId): void
    {
        $task = AgentTask::find($taskId);
        if (!$task || $task->current_turn_id !== $turnId) {
            return; // superseded by a newer turn
        }

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
        $task->update([
            'status' => 'RUNNING',
            'stage' => 'UNDERSTANDING',
            'turn_started_at' => now(),
            'pending_user_turn' => false,
            'iteration_count' => 0,
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

        // A tool call the user explicitly confirmed (button) runs first.
        $pending = $task->pending_tool_call;
        if (!empty($pending['confirmed'])) {
            $task->update(['pending_tool_call' => null]);
            $this->timeline($task, 'USER_CONFIRMED', 'succeeded', "You confirmed: {$pending['name']}.");
            $observations[] = $this->executeTool($task, $user, $turnId, 0, $pending['name'], $pending['args'] ?? [], true);
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
            $response = $this->ai->decide([
                'user_id' => $user->id,
                'utterance' => $userMsg->content,
                'runtime_context' => $this->context->build($user, $task, ['provider' => $model['provider'], 'model' => $model['model']]),
                'tool_schemas' => AgentToolRegistry::modelVisibleSchemas($user, $task->autonomy_level ?: 'CONFIRM_CONSEQUENTIAL_CHANGES'),
                'portal_map' => SurfaceCatalog::modelSummary(),
                'observations' => $observations,
                'conversation_summary' => $this->context->conversationSummary($task, $userMsg->id),
                'slots' => $task->slots ?: (object) [],
                'retrieved_context' => $retrieved,
                'use_rag' => true,
                'iteration' => $i,
                'provider' => $model['provider'],
                'model' => $model['model'],
                'api_key' => $model['api_key'],
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

            switch ($decision['kind']) {
                case 'CALL_TOOL':
                    $name = (string) ($decision['tool_call']['name'] ?? '');
                    $args = (array) ($decision['tool_call']['args'] ?? []);
                    $hash = self::argsHash($name, $args);
                    if (trim((string) ($decision['speech_text'] ?? '')) !== '') {
                        LiveEventService::publish($task->user_id, 'agent.narration', [
                            'task_id' => $task->id, 'text' => mb_substr($decision['speech_text'], 0, 200), 'tool' => $name,
                        ], 'AgentTask', (string) $task->id);
                    }

                    if (isset($succeededCalls[$hash])) {
                        // Identical successful call: never re-run it; point the model at the result it has.
                        $succeededCalls[$hash]['repeats']++;
                        if ($succeededCalls[$hash]['repeats'] >= 2) {
                            $this->finishFromObservations($task, $observations);
                            return;
                        }
                        $observations[] = [
                            'iteration' => $i, 'tool' => $name, 'args' => $args,
                            'result' => ['success' => true, 'status' => 'already_done',
                                'safe_message' => 'Already done this turn; NOT executed again. Its result is in the earlier observation. Now reply to the user with ANSWER or COMPLETE.'],
                        ];
                        continue 2;
                    }

                    if (($failedCalls[$hash] ?? 0) >= 1) {
                        $failedCalls[$hash]++;
                        if ($failedCalls[$hash] >= 3) {
                            $this->finishLimit($task, $observations, 'REPEATED_FAILED_CALL');
                            return;
                        }
                        $observations[] = [
                            'iteration' => $i, 'tool' => $name, 'args' => $args,
                            'result' => ['success' => false, 'error_category' => 'DUPLICATE_CALL',
                                'safe_message' => 'This exact call already failed this turn and was NOT executed again. Change the arguments, ask the user, or stop.'],
                        ];
                        continue 2;
                    }

                    $confirmed = $this->confirmedByLaterUtterance($task, $hash, $userMsg->id);
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
            $this->timeline($task, $label, $gate['error_category'] === 'CONFIRMATION_REQUIRED' ? 'waiting' : 'failed', $gate['safe_message']);
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
        $result = $this->runner->run($user, $task, $def, $args);
        $this->persistCall($task, $turnId, $iteration, $name, $def['version'], $args, $result['success'] ? 'succeeded' : 'failed', $result, $traceId, $started);

        LiveEventService::publish($task->user_id, 'agent.tool_finished', [
            'task_id' => $task->id, 'trace_id' => $traceId, 'tool' => $name, 'label' => $label,
            'success' => $result['success'], 'status' => $result['status'], 'error_category' => $result['error_category'],
            'safe_message' => $result['safe_message'], 'verified' => $result['verified'],
            'resource_refs' => $result['resource_refs'],
        ], 'AgentTask', (string) $task->id);
        $this->timeline($task, $label, $result['success'] ? 'succeeded' : 'failed', $result['safe_message'],
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
        }

        return $tool;
    }

    // ------------------------------------------------------------------
    // Turn endings
    // ------------------------------------------------------------------

    protected function finish(AgentTask $task, array $decision, array $observations, ?array $rag, ?string $forcedStatus = null): void
    {
        $kind = $decision['kind'];
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

        $secureType = $kind === 'WAIT_FOR_USER' ? ($decision['secure_input_type'] ?? null) : null;
        $last = end($observations);
        if ($last && $last['tool'] === 'ask_secret_in_form' && !empty($last['result']['success'])) {
            $secureType = null; // the user types it into the real form; no second input card
        }
        $lastDecision = [
            'kind' => $kind,
            'speech_text' => $decision['speech_text'],
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

        $this->speak($task, $decision['speech_text'], $lastDecision, $observations, $rag, 'model');
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

    /** The model kept repeating a call that already succeeded: report what the observations show. */
    protected function finishFromObservations(AgentTask $task, array $observations): void
    {
        $results = array_values(array_filter($observations, fn ($o) => !empty($o['result']['success']) && !str_starts_with($o['tool'], '_')
            && ($o['result']['status'] ?? '') !== 'already_done'));
        $last = end($results);
        $text = $last ? rtrim((string) $last['result']['safe_message'], '.') . '.' : 'I could not finish that request.';
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
        $provider = config('orbit.default_provider', 'ollama');
        $model = config('orbit.default_model', 'qwen2.5:3b');

        $role = ModelRole::where('user_id', $user->id)->where('role', ModelRole::ROLE_PLANNER)->where('is_active', true)->first();
        $active = AiProvider::where('user_id', $user->id)->where('is_active', true)->first();
        if ($role) {
            $provider = $role->provider;
            $model = $role->model_name;
        } elseif ($active) {
            $provider = $active->provider_type;
            $model = $active->model_name ?: $model;
        }

        $apiKey = null;
        if (in_array(strtolower($provider), self::CLOUD_PROVIDERS, true)) {
            $types = in_array(strtolower($provider), ['anthropic', 'claude'], true) ? ['anthropic', 'claude'] : [strtolower($provider)];
            $apiKey = AiProvider::where('user_id', $user->id)->whereIn('provider_type', $types)->first()?->encrypted_api_key;
        }

        return ['provider' => $provider, 'model' => $model, 'api_key' => $apiKey];
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
        LiveEventService::publish($task->user_id, 'agent.turn_stage', array_filter([
            'task_id' => $task->id, 'stage' => $stage, 'iteration' => $iteration, 'tool' => $tool,
            'plan_version' => $task->plan_version,
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
        ], 'AgentTask', (string) $task->id);
    }
}
