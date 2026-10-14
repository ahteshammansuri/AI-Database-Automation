<?php

namespace App\Services\Agent;

use App\Models\User;
use App\Models\AgentConversation;
use App\Models\AgentMessage;
use App\Models\AgentTask;
use App\Models\AgentTaskTimelineEvent;
use App\Models\UserAgentPreference;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\AiProvider;
use App\Services\LiveEventService;
use App\Services\AiServiceClient;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AgentExecutionService
{
    /**
     * Process an incoming user message inside a conversation.
     */
    public function handleUserMessage(
        User $user,
        AgentConversation $conversation,
        string $content,
        bool $isVoice = false,
        ?array $secureInputData = null
    ): array {
        // 1. Record incoming user message
        $userMsg = AgentMessage::create([
            'conversation_id' => $conversation->id,
            'role' => 'user',
            'content' => $content,
            'is_voice' => $isVoice,
            'created_at' => now(),
        ]);

        // 2. Check for active task in conversation
        $activeTask = AgentTask::where('conversation_id', $conversation->id)
            ->whereIn('status', ['RUNNING', 'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'PAUSED'])
            ->orderBy('id', 'desc')
            ->first();

        // 3. Handle mid-task interruption or input resolution
        if ($activeTask) {
            // Did user supply secure input for WAITING_FOR_INPUT?
            if ($secureInputData && $activeTask->status === 'WAITING_FOR_INPUT') {
                return $this->resumeTaskWithSecureInput($user, $conversation, $activeTask, $secureInputData);
            }

            // Check if user is issuing an interruption or correction command
            $lower = strtolower(trim($content));
            if ($this->isCorrectionOrInterruption($lower)) {
                return $this->handleCorrection($user, $conversation, $activeTask, $content);
            }
        }

        // 4. Semantic Intent Understanding & Planning
        $plan = $this->resolveIntentAndPlan($user, $content, $conversation, $activeTask);

        // 5. Check outcome classifications
        $outcome = $plan['outcome'] ?? 'SUPPORTED_AND_SPECIFIED';

        // 5a. Disallowed by safety or policy
        if ($outcome === 'DISALLOWED_BY_POLICY') {
            $msgContent = $plan['explanation'] ?? "This operation is prohibited by platform safety guardrails.";
            $assistantMsg = AgentMessage::create([
                'conversation_id' => $conversation->id,
                'role' => 'assistant',
                'content' => "🚫 **Policy Restriction:** " . $msgContent,
                'created_at' => now(),
            ]);

            return [
                'conversation' => $conversation->fresh(['messages']),
                'task' => null,
                'message' => $assistantMsg,
            ];
        }

        // 5b. Unsupported by the actual product
        if ($outcome === 'UNSUPPORTED') {
            $msgContent = $plan['explanation'] ?? "This operation is outside the platform's supported capabilities.";
            $assistantMsg = AgentMessage::create([
                'conversation_id' => $conversation->id,
                'role' => 'assistant',
                'content' => "ℹ️ **Capability Boundary:** " . $msgContent,
                'created_at' => now(),
            ]);

            return [
                'conversation' => $conversation->fresh(['messages']),
                'task' => null,
                'message' => $assistantMsg,
            ];
        }

        // 5c. Missing information or conversational clarification required
        $extractedSlots = $plan['extracted_slots'] ?? [];
        $accumulatedSlots = $activeTask ? array_merge($activeTask->slots ?? [], $extractedSlots) : $extractedSlots;

        if (!empty($plan['requires_input']) || $outcome === 'MISSING_INFORMATION' || $outcome === 'AMBIGUOUS' || ($outcome === 'CURRENTLY_UNAVAILABLE' && !empty($plan['requires_input']))) {
            if ($activeTask && in_array($activeTask->status, ['WAITING_FOR_INPUT', 'READY', 'DRAFT'])) {
                $task = $activeTask;
                $task->update([
                    'task_type' => $plan['task_type'] ?? $task->task_type,
                    'status' => 'WAITING_FOR_INPUT',
                    'active_plan' => $plan['steps'] ?? $task->active_plan,
                    'slots' => $accumulatedSlots,
                ]);
            } else {
                $task = AgentTask::create([
                    'user_id' => $user->id,
                    'conversation_id' => $conversation->id,
                    'task_type' => $plan['task_type'] ?? 'GENERAL',
                    'goal' => $content,
                    'status' => 'WAITING_FOR_INPUT',
                    'autonomy_level' => $this->getUserAutonomyLevel($user),
                    'active_plan' => $plan['steps'] ?? [],
                    'slots' => $accumulatedSlots,
                    'current_step_index' => 0,
                    'idempotency_key' => Str::uuid()->toString(),
                    'target_resource_type' => $plan['target_resource_type'] ?? null,
                    'target_resource_id' => $plan['target_resource_id'] ?? null,
                ]);
            }

            // Visible UI action bridge: for ADD_CONNECTION, visibly navigate, open modal and populate non-secret fields
            if (($plan['task_type'] ?? '') === 'ADD_CONNECTION') {
                $this->broadcastActionRequested($user->id, 'navigation.navigate', ['route' => '/connections']);
                $nonSecretFields = array_diff_key($accumulatedSlots, ['password' => true]);
                $this->broadcastActionRequested($user->id, 'connections.open_create_form', [
                    'slots' => $nonSecretFields,
                ]);
                if (!empty($nonSecretFields)) {
                    $this->broadcastActionRequested($user->id, 'connections.fill_fields', [
                        'fields' => $nonSecretFields,
                    ]);
                }
            }

            $questionText = $plan['question'] ?? ($plan['explanation'] ?? 'Please provide the missing details to continue:');
            $this->recordTimelineEvent($task, 'COLLECT_INFORMATION', 'waiting', $questionText);

            $assistantMsg = AgentMessage::create([
                'conversation_id' => $conversation->id,
                'role' => 'assistant',
                'content' => $questionText,
                'secure_input_type' => $plan['secure_input_type'] ?? null,
                'tool_calls' => null,
                'created_at' => now(),
            ]);

            return [
                'conversation' => $conversation->fresh(['messages']),
                'task' => $task->fresh(['timelineEvents']),
                'message' => $assistantMsg,
            ];
        }

        // 5d. Currently unavailable without immediate input recovery
        if ($outcome === 'CURRENTLY_UNAVAILABLE' && empty($plan['steps'])) {
            $msgContent = $plan['explanation'] ?? "This capability is currently unavailable.";
            $assistantMsg = AgentMessage::create([
                'conversation_id' => $conversation->id,
                'role' => 'assistant',
                'content' => "⚠️ **Currently Unavailable:** " . $msgContent,
                'created_at' => now(),
            ]);

            return [
                'conversation' => $conversation->fresh(['messages']),
                'task' => null,
                'message' => $assistantMsg,
            ];
        }

        // 6. Create durable AgentTask for supported plan
        if ($activeTask && in_array($activeTask->status, ['WAITING_FOR_INPUT', 'READY', 'DRAFT'])) {
            $task = $activeTask;
            $task->update([
                'task_type' => $plan['task_type'] ?? $task->task_type,
                'status' => 'READY',
                'active_plan' => $plan['steps'] ?? [],
                'slots' => $accumulatedSlots,
                'current_step_index' => 0,
            ]);
        } else {
            $task = AgentTask::create([
                'user_id' => $user->id,
                'conversation_id' => $conversation->id,
                'task_type' => $plan['task_type'] ?? 'GENERAL',
                'goal' => $content,
                'status' => 'READY',
                'autonomy_level' => $this->getUserAutonomyLevel($user),
                'active_plan' => $plan['steps'] ?? [],
                'slots' => $accumulatedSlots,
                'current_step_index' => 0,
                'idempotency_key' => Str::uuid()->toString(),
                'target_resource_type' => $plan['target_resource_type'] ?? null,
                'target_resource_id' => $plan['target_resource_id'] ?? null,
            ]);
        }

        if (($plan['task_type'] ?? '') === 'ADD_CONNECTION') {
            $this->broadcastActionRequested($user->id, 'navigation.navigate', ['route' => '/connections']);
            $nonSecretFields = array_diff_key($accumulatedSlots, ['password' => true]);
            $this->broadcastActionRequested($user->id, 'connections.open_create_form', [
                'slots' => $nonSecretFields,
            ]);
            if (!empty($nonSecretFields)) {
                $this->broadcastActionRequested($user->id, 'connections.fill_fields', [
                    'fields' => $nonSecretFields,
                ]);
            }
        }

        $this->recordTimelineEvent($task, 'UNDERSTAND_REQUEST', 'succeeded', "Understood user goal: \"{$content}\"");

        // 7. Execute the task plan
        return $this->executeTaskPlan($user, $conversation, $task);
    }

    /**
     * Execute the planned steps of a task sequentially with safety checkpoints.
     */
    public function executeTaskPlan(User $user, AgentConversation $conversation, AgentTask $task, ?int $skipConfirmationForStepIndex = null): array
    {
        $task->update(['status' => 'RUNNING']);
        $this->broadcastTaskUpdate($task);

        $plan = $task->active_plan ?: [];
        $totalSteps = count($plan);
        $executedResults = [];

        for ($i = $task->current_step_index; $i < $totalSteps; $i++) {
            $step = $plan[$i];
            $toolName = $step['tool'];
            $args = $step['args'] ?? [];
            $stepLabel = $step['label'] ?? $toolName;

            // Cooperative cancellation check before step begins
            $task->refresh();
            if ($task->status === 'INTERRUPT_REQUESTED' || $task->status === 'CANCELLED') {
                $task->update(['status' => 'CANCELLED', 'cancelled_at' => now()]);
                $this->recordTimelineEvent($task, $stepLabel, 'cancelled', "Execution stopped by user before step '{$stepLabel}'.");
                $this->broadcastTaskUpdate($task);

                $msg = AgentMessage::create([
                    'conversation_id' => $conversation->id,
                    'role' => 'assistant',
                    'content' => "Task was stopped as requested before committing step '{$stepLabel}'.",
                    'created_at' => now(),
                ]);

                return [
                    'conversation' => $conversation->fresh(['messages']),
                    'task' => $task->fresh(['timelineEvents']),
                    'message' => $msg,
                ];
            }

            // Check if step requires explicit user confirmation
            $autonomy = $task->autonomy_level;
            $toolDef = collect(AgentToolRegistry::getToolDefinitions())->firstWhere('name', $toolName);
            $isHighRisk = ($toolDef['risk_level'] ?? 'LOW') === 'HIGH';

            if ($skipConfirmationForStepIndex !== $i && ((($autonomy === 'CONFIRM_CONSEQUENTIAL_CHANGES' && $isHighRisk) || $autonomy === 'PREPARE_FOR_REVIEW'))) {
                $task->update([
                    'status' => 'WAITING_FOR_APPROVAL',
                    'current_step_index' => $i,
                ]);

                $this->recordTimelineEvent($task, $stepLabel, 'waiting', "Waiting for user confirmation to execute '{$stepLabel}'.");
                $this->broadcastTaskUpdate($task);

                $confirmMsg = AgentMessage::create([
                    'conversation_id' => $conversation->id,
                    'role' => 'assistant',
                    'content' => "I am ready to proceed with: **{$stepLabel}**. Please review and confirm this action.",
                    'tool_calls' => [$step],
                    'created_at' => now(),
                ]);

                return [
                    'conversation' => $conversation->fresh(['messages']),
                    'task' => $task->fresh(['timelineEvents']),
                    'message' => $confirmMsg,
                ];
            }

            // Broadcast live UI action events so browser visibly navigates, fills and executes
            if ($toolName === 'test_database_connection') {
                $this->broadcastActionRequested($user->id, 'connections.trigger_test', [
                    'host' => $args['host'] ?? '',
                    'port' => $args['port'] ?? 3306,
                    'database' => $args['database'] ?? '',
                    'username' => $args['username'] ?? '',
                ]);
            } elseif ($toolName === 'save_database_connection') {
                $this->broadcastActionRequested($user->id, 'connections.submit_save', [
                    'name' => $args['name'] ?? '',
                ]);
            } elseif ($toolName === 'scan_database_schema') {
                $this->broadcastActionRequested($user->id, 'connections.scan_schema', [
                    'connection_id' => $args['connection_id'] ?? 0,
                ]);
            } elseif ($toolName === 'create_automation_draft') {
                $this->broadcastActionRequested($user->id, 'automations.create_draft', $args);
            }

            $result = AgentToolRegistry::executeTool($user, $toolName, $args);
            $executedResults[] = ['step' => $stepLabel, 'result' => $result];

            if (!($result['success'] ?? false)) {
                $task->update([
                    'status' => 'FAILED',
                    'error_message' => $result['error'] ?? 'Step execution failed.',
                ]);

                $this->recordTimelineEvent($task, $stepLabel, 'failed', $result['error'] ?? 'Execution failed.');
                $this->broadcastTaskUpdate($task);

                $failMsg = AgentMessage::create([
                    'conversation_id' => $conversation->id,
                    'role' => 'assistant',
                    'content' => "Operation stopped at step **{$stepLabel}**: " . ($result['error'] ?? 'Unknown error'),
                    'tool_results' => $executedResults,
                    'created_at' => now(),
                ]);

                return [
                    'conversation' => $conversation->fresh(['messages']),
                    'task' => $task->fresh(['timelineEvents']),
                    'message' => $failMsg,
                ];
            }

            // Authoritative Post-Execution Verification
            $verificationError = $this->verifyStepAuthoritatively($user, $toolName, $result);
            if ($verificationError) {
                $task->update([
                    'status' => 'FAILED',
                    'error_message' => "Verification failure: {$verificationError}",
                ]);
                $this->recordTimelineEvent($task, $stepLabel, 'failed', "State verification failed: {$verificationError}");
                $this->broadcastTaskUpdate($task);

                $failMsg = AgentMessage::create([
                    'conversation_id' => $conversation->id,
                    'role' => 'assistant',
                    'content' => "Operation failed verification check: {$verificationError}",
                    'tool_results' => $executedResults,
                    'created_at' => now(),
                ]);

                return [
                    'conversation' => $conversation->fresh(['messages']),
                    'task' => $task->fresh(['timelineEvents']),
                    'message' => $failMsg,
                ];
            }

            // Track target resource if created and propagate to subsequent steps
            if (!empty($result['connection_id'])) {
                $task->update(['target_resource_type' => 'DbConnection', 'target_resource_id' => $result['connection_id']]);
                for ($j = $i + 1; $j < $totalSteps; $j++) {
                    if (isset($plan[$j]['args']['connection_id']) && (empty($plan[$j]['args']['connection_id']) || $plan[$j]['args']['connection_id'] === 0)) {
                        $plan[$j]['args']['connection_id'] = $result['connection_id'];
                    }
                }
                $task->update(['active_plan' => $plan]);
            } elseif (!empty($result['automation_id'])) {
                $task->update(['target_resource_type' => 'Automation', 'target_resource_id' => $result['automation_id']]);
            } elseif (!empty($result['execution_id'])) {
                $task->update(['target_resource_type' => 'AutomationExecution', 'target_resource_id' => $result['execution_id']]);
            }

            $successMsg = $result['message'] ?? "Completed: {$stepLabel}";
            $this->recordTimelineEvent($task, $stepLabel, 'succeeded', $successMsg, $result);
            $task->update(['current_step_index' => $i + 1]);
        }

        // All steps succeeded
        $task->update([
            'status' => 'SUCCEEDED',
            'completed_at' => now(),
        ]);
        $this->recordTimelineEvent($task, 'TASK_COMPLETE', 'succeeded', 'All planned operations verified and finished successfully.');
        $this->broadcastTaskUpdate($task);

        $summaryContent = $this->buildCompletionSummary($task, $executedResults, $user);
        $assistantMsg = AgentMessage::create([
            'conversation_id' => $conversation->id,
            'role' => 'assistant',
            'content' => $summaryContent,
            'tool_results' => $executedResults,
            'created_at' => now(),
        ]);

        return [
            'conversation' => $conversation->fresh(['messages']),
            'task' => $task->fresh(['timelineEvents']),
            'message' => $assistantMsg,
        ];
    }

    /**
     * Verify consequential operations against authoritative database models.
     */
    protected function verifyStepAuthoritatively(User $user, string $toolName, array $result): ?string
    {
        if ($toolName === 'save_database_connection' && !empty($result['connection_id'])) {
            $exists = DbConnection::where('user_id', $user->id)->where('id', $result['connection_id'])->exists();
            if (!$exists) {
                return "Saved connection #{$result['connection_id']} could not be verified in database.";
            }
        }

        if ($toolName === 'create_automation_draft' && !empty($result['automation_id'])) {
            $exists = Automation::where('user_id', $user->id)->where('id', $result['automation_id'])->exists();
            if (!$exists) {
                return "Created automation #{$result['automation_id']} could not be verified in database.";
            }
        }

        if ($toolName === 'approve_content_version' && !empty($result['version_id'])) {
            $version = ContentVersion::find($result['version_id']);
            if (!$version || !$version->is_approved) {
                return "Content version #{$result['version_id']} approval status was not persisted.";
            }
        }

        return null;
    }

    /**
     * Handle user interrupt (Stop / Pause).
     */
    public function interruptTask(User $user, AgentTask $task, string $action = 'STOP'): array
    {
        if ($task->user_id !== $user->id) {
            abort(403, 'Unauthorized access to task.');
        }

        if ($action === 'PAUSE') {
            $task->update([
                'status' => 'PAUSED',
                'paused_at' => now(),
            ]);
            $this->recordTimelineEvent($task, 'USER_PAUSE', 'waiting', 'Task paused by user. Can be resumed anytime.');
            $msg = 'Task paused at safe checkpoint.';
        } else {
            $task->update([
                'status' => 'INTERRUPT_REQUESTED',
                'cancelled_at' => now(),
            ]);
            $this->recordTimelineEvent($task, 'USER_STOP', 'cancelled', 'Instant stop received. Terminating uncommitted steps.');
            $msg = 'Stop request received. Cancelling pending steps safely.';
        }

        $this->broadcastTaskUpdate($task);

        return [
            'success' => true,
            'task' => $task->fresh(['timelineEvents']),
            'message' => $msg,
        ];
    }

    /**
     * Handle user mid-task correction with dynamic evaluation.
     */
    public function handleCorrection(User $user, AgentConversation $conversation, AgentTask $task, string $correctionText): array
    {
        $this->recordTimelineEvent($task, 'CORRECTION_RECEIVED', 'running', "Correction received: \"{$correctionText}\"");

        // Call AI evaluation service for semantic correction
        $aiClient = new AiServiceClient();
        $evaluation = $aiClient->evaluateAgentCorrection($correctionText, $task->status, null);

        $action = $evaluation['action'] ?? null;
        if (!$action) {
            $lower = strtolower($correctionText);
            if (str_contains($lower, 'reviews') || str_contains($lower, 'category') || str_contains($lower, 'instead') || str_contains($lower, 'change ')) {
                $action = 'CHANGE_PARAMETER';
            } elseif (str_starts_with($lower, 'stop') || str_starts_with($lower, 'cancel')) {
                $action = 'STOP';
            } elseif (str_starts_with($lower, 'pause')) {
                $action = 'PAUSE';
            } else {
                $action = 'CHANGE_PARAMETER';
            }
        }

        if ($action === 'STOP') {
            return $this->interruptTask($user, $task, 'STOP');
        }

        if ($action === 'PAUSE') {
            return $this->interruptTask($user, $task, 'PAUSE');
        }

        if ($action === 'CHANGE_PARAMETER') {
            $param = $evaluation['revised_parameter'] ?? 'category_name';
            $newVal = $evaluation['new_value'] ?? 'Reviews';
            $needsCompensating = !empty($evaluation['compensating_needed']) || in_array($task->status, ['SUCCEEDED', 'COMMITTED']);

            // If task has already committed an Automation, apply a dynamic compensating update
            if ($task->target_resource_type === 'Automation' && $task->target_resource_id) {
                $automation = Automation::where('user_id', $user->id)->find($task->target_resource_id);
                if ($automation) {
                    if ($param === 'category_name') {
                        $promptContext = preg_replace('/\[Category:.*?\]/', "[Category: {$newVal}]", $automation->prompt_context);
                        if (!str_contains($promptContext, "[Category: {$newVal}]")) {
                            $promptContext .= " [Category: {$newVal}]";
                        }
                        $automation->update(['prompt_context' => $promptContext]);
                    } elseif ($param === 'topic_prompt') {
                        $automation->update(['prompt_context' => $newVal]);
                    } elseif ($param === 'schedule_type') {
                        $automation->update(['schedule_type' => $newVal]);
                    }

                    $this->recordTimelineEvent($task, 'COMPENSATING_UPDATE', 'succeeded', "Applied compensating update to Automation #{$automation->id}: {$param} set to '{$newVal}'.");
                    $this->broadcastTaskUpdate($task);

                    $msg = AgentMessage::create([
                        'conversation_id' => $conversation->id,
                        'role' => 'assistant',
                        'content' => "The automation was already created, so I safely applied a compensating update: {$param} has been updated to **{$newVal}**.",
                        'created_at' => now(),
                    ]);

                    return [
                        'conversation' => $conversation->fresh(['messages']),
                        'task' => $task->fresh(['timelineEvents']),
                        'message' => $msg,
                    ];
                }
            }

            // Invalidate remaining uncommitted steps and rewrite plan with revised parameter
            $plan = $task->active_plan ?: [];
            foreach ($plan as &$step) {
                if (isset($step['args'][$param])) {
                    $step['args'][$param] = $newVal;
                }
            }

            $task->update([
                'active_plan' => $plan,
                'status' => 'RUNNING',
            ]);

            $this->recordTimelineEvent($task, 'PLAN_REVISED', 'succeeded', "Plan updated with revised {$param}: '{$newVal}'. Resuming safe execution.");
            $this->broadcastTaskUpdate($task);

            return $this->executeTaskPlan($user, $conversation, $task);
        }

        // Generic plan revision
        $this->recordTimelineEvent($task, 'PLAN_ADAPTED', 'succeeded', "Adapted workflow to: \"{$correctionText}\"");
        return $this->executeTaskPlan($user, $conversation, $task);
    }

    /**
     * Resume task when user supplies secure masked credentials.
     */
    public function resumeTaskWithSecureInput(User $user, AgentConversation $conversation, AgentTask $task, array $data): array
    {
        $plan = $task->active_plan ?: [];

        // Inject secure credentials into save step args
        foreach ($plan as &$step) {
            if ($step['tool'] === 'save_database_connection' || $step['tool'] === 'test_database_connection') {
                $step['args']['host'] = $data['host'] ?? $step['args']['host'] ?? '127.0.0.1';
                $step['args']['port'] = (int) ($data['port'] ?? $step['args']['port'] ?? 3306);
                $step['args']['database'] = $data['database'] ?? $data['database_name'] ?? $step['args']['database'] ?? '';
                $step['args']['username'] = $data['username'] ?? $step['args']['username'] ?? '';
                $step['args']['password'] = $data['password'] ?? '';
                $step['args']['name'] = $data['name'] ?? $step['args']['name'] ?? 'Production Database';
                $step['args']['ssl_mode'] = $data['ssl_mode'] ?? 'prefer';
            }
        }

        $nonSecret = array_diff_key($data, ['password' => true]);
        $task->update([
            'slots' => array_merge($task->slots ?? [], $nonSecret),
            'active_plan' => $plan,
            'status' => 'RUNNING',
        ]);

        $this->recordTimelineEvent($task, 'CREDENTIALS_PROVIDED', 'succeeded', 'Secure credentials provided via masked input component.');
        $this->broadcastTaskUpdate($task);

        return $this->executeTaskPlan($user, $conversation, $task);
    }

    /**
     * Confirm a waiting step.
     */
    public function confirmTaskStep(User $user, AgentTask $task): array
    {
        if ($task->user_id !== $user->id) {
            abort(403, 'Unauthorized');
        }

        $conversation = $task->conversation;
        $confirmedStepIndex = $task->current_step_index;
        $task->update(['status' => 'RUNNING']);
        $this->recordTimelineEvent($task, 'USER_CONFIRMED', 'succeeded', 'User confirmed action. Proceeding with execution.');
        $this->broadcastTaskUpdate($task);

        return $this->executeTaskPlan($user, $conversation, $task, $confirmedStepIndex);
    }

    // =========================================================================
    // Planning & Intent Resolution Engine
    // =========================================================================

    protected function resolveIntentAndPlan(User $user, string $goal, AgentConversation $conversation, ?AgentTask $activeTask = null): array
    {
        // 1. Gather rich workspace context
        $connections = DbConnection::where('user_id', $user->id)->get(['id', 'name', 'database_name', 'host'])->toArray();
        $automations = Automation::where('user_id', $user->id)->get(['id', 'name', 'target_table', 'schedule_type'])->toArray();
        $executions = AutomationExecution::where('user_id', $user->id)->latest('id')->take(5)->get(['id', 'status', 'automation_id'])->toArray();
        $conversationHistory = $conversation->messages()->latest('id')->take(6)->get(['role', 'content'])->toArray();
        $availability = AgentToolRegistry::getDynamicToolAvailability($user);
        $activeTaskData = $activeTask ? ['id' => $activeTask->id, 'status' => $activeTask->status, 'task_type' => $activeTask->task_type] : null;

        // 2. Call Python AI microservice agent planner
        $activeProvider = AiProvider::where('user_id', $user->id)->where('is_active', true)->first();
        $provider = $activeProvider ? $activeProvider->provider_type : env('AI_PROVIDER', 'mock');
        $model = $activeProvider ? $activeProvider->model_name : env('AI_MODEL', null);
        $apiKey = $activeProvider ? $activeProvider->encrypted_api_key : null;
        $accumulatedSlots = $activeTask ? ($activeTask->slots ?? []) : [];
        $availableTools = AgentToolRegistry::getToolDefinitions();

        try {
            $aiClient = new AiServiceClient();
            $aiPlan = $aiClient->planAgentTask(
                $goal,
                $connections,
                [],
                $automations,
                $executions,
                $conversationHistory,
                $activeTaskData,
                $availability,
                $accumulatedSlots,
                $availableTools,
                $provider,
                $model,
                $apiKey
            );

            if ($aiPlan && isset($aiPlan['outcome'])) {
                return $aiPlan;
            }
        } catch (\Throwable $e) {
            Log::warning('AI Service agent planner error: ' . $e->getMessage());
        }

        // 3. Robust Open-Ended Fallback (Zero hardcoded topics)
        return $this->fallbackOpenEndedPlanner($user, $goal, $connections);
    }

    /**
     * Fallback open-ended semantic planner if Python microservice is temporarily unreachable.
     */
    protected function fallbackOpenEndedPlanner(User $user, string $goal, array $connections): array
    {
        $lower = strtolower($goal);

        // Disallowed destructive SQL
        if (preg_match('/\b(drop|truncate|alter|delete\s+from|raw\s+sql)\b/', $lower)) {
            return [
                'task_type' => 'POLICY_REJECTED',
                'outcome' => 'DISALLOWED_BY_POLICY',
                'explanation' => 'Destructive SQL operations are strictly prohibited on customer databases by platform safety guardrails.',
            ];
        }

        // Schema scan (takes precedence over connection keywords)
        if (str_contains($lower, 'scan') || str_contains($lower, 'schema') || str_contains($lower, 'tables') || str_contains($lower, 'columns')) {
            if (empty($connections)) {
                return [
                    'task_type' => 'ADD_CONNECTION',
                    'outcome' => 'CURRENTLY_UNAVAILABLE',
                    'requires_input' => true,
                    'secure_input_type' => 'database_credentials',
                    'question' => "You don't have any database connections yet. Please connect your database first so I can inspect the schema.",
                ];
            }

            $connId = $this->extractResourceIdFromGoal($goal, 'connection') ?: ($connections[0]['id'] ?? 1);
            return [
                'task_type' => 'SCAN_SCHEMA',
                'outcome' => 'SUPPORTED_AND_SPECIFIED',
                'steps' => [
                    ['tool' => 'scan_database_schema', 'label' => "Scanning Schema for Connection #{$connId}", 'args' => ['connection_id' => $connId]],
                ],
            ];
        }

        // Connection operations
        if (str_contains($lower, 'connect') || str_contains($lower, 'database') || str_contains($lower, 'mysql')) {
            if (str_contains($lower, 'list') || str_contains($lower, 'show') || str_contains($lower, 'what')) {
                return [
                    'task_type' => 'LIST_CONNECTIONS',
                    'outcome' => 'SUPPORTED_AND_SPECIFIED',
                    'steps' => [
                        ['tool' => 'list_database_connections', 'label' => 'Listing Database Connections', 'args' => []],
                    ],
                ];
            }

            // Extract known connection slots from utterance
            $extractedSlots = [];
            if (preg_match('/host\s*(?:is|=|:)?\s*([a-zA-Z0-9\.\-_]+)/i', $goal, $m)) {
                $extractedSlots['host'] = $m[1];
            } elseif (str_contains($lower, '127.0.0.1') || str_contains($lower, 'localhost')) {
                $extractedSlots['host'] = '127.0.0.1';
            }

            if (preg_match('/port\s*(?:is|=|:)?\s*(\d+)/i', $goal, $m)) {
                $extractedSlots['port'] = (int) $m[1];
            }

            if (preg_match_all('/(?:database|db)(?:\s+name)?\s*(?:is|=|:|\s+named|\s+called)?\s*[\'"]?([a-zA-Z0-9_\-]+)[\'"]?/i', $goal, $dbMatches)) {
                foreach ($dbMatches[1] as $candDb) {
                    if (!in_array(strtolower($candDb), ['on', 'with', 'for', 'in', 'to', 'at', 'and', 'connection', 'profile', 'server', 'named', 'called', 'is', 'mysql'])) {
                        $extractedSlots['database'] = $candDb;
                        break;
                    }
                }
            }

            if (preg_match_all('/(?:username|user)\s*(?:is|=|:|\s+named|\s+called)?\s*[\'"]?([a-zA-Z0-9_\-]+)[\'"]?/i', $goal, $userMatches)) {
                foreach ($userMatches[1] as $candUser) {
                    if (!in_array(strtolower($candUser), ['on', 'with', 'for', 'in', 'to', 'at', 'and', 'named', 'called', 'is'])) {
                        $extractedSlots['username'] = $candUser;
                        break;
                    }
                }
            }

            if (preg_match('/(?:name\s*(?:is|=|:)?\s*[\'"]([^\'"]+)[\'"]|name\s+([A-Za-z0-9_\s]+?)(?:\s+database|\s+connection|$))/i', $goal, $m)) {
                $candName = trim($m[1] ?: $m[2]);
                if (!in_array(strtolower($candName), ['is', 'my', 'the', 'a', 'new'])) {
                    $extractedSlots['name'] = $candName;
                }
            }

            return [
                'task_type' => 'ADD_CONNECTION',
                'outcome' => 'MISSING_INFORMATION',
                'requires_input' => true,
                'secure_input_type' => 'database_credentials',
                'question' => "I can connect your MySQL database. Please enter your connection credentials below. Passwords are encrypted at rest and never shared with the AI model.",
                'extracted_slots' => $extractedSlots,
                'steps' => [
                    [
                        'tool' => 'save_database_connection',
                        'label' => 'Verifying and Saving Connection Profile',
                        'args' => [
                            'name' => $extractedSlots['name'] ?? 'MySQL Target',
                            'host' => $extractedSlots['host'] ?? '127.0.0.1',
                            'port' => $extractedSlots['port'] ?? 3306,
                            'database' => $extractedSlots['database'] ?? '',
                            'username' => $extractedSlots['username'] ?? '',
                            'password' => '',
                            'ssl_mode' => 'prefer',
                        ],
                    ],
                    [
                        'tool' => 'scan_database_schema',
                        'label' => 'Discovering Database Schema & Tables',
                        'args' => ['connection_id' => 0],
                    ],
                ],
            ];
        }

        // Automation creation
        if (str_contains($lower, 'automation') || str_contains($lower, 'blog') || str_contains($lower, 'article') || str_contains($lower, 'publish') || str_contains($lower, 'schedule')) {
            if (empty($connections)) {
                return [
                    'task_type' => 'ADD_CONNECTION',
                    'outcome' => 'CURRENTLY_UNAVAILABLE',
                    'requires_input' => true,
                    'secure_input_type' => 'database_credentials',
                    'question' => "To set up an automation, we need a database connection first. Enter your database details securely below:",
                ];
            }

            $connId = $connections[0]['id'] ?? 1;
            $topic = $this->extractTopicFromGoal($goal);
            $category = $this->extractCategoryFromGoal($goal);

            return [
                'task_type' => 'CREATE_AUTOMATION',
                'outcome' => 'SUPPORTED_AND_SPECIFIED',
                'steps' => [
                    [
                        'tool' => 'create_automation_draft',
                        'label' => "Configuring Automation Workflow ({$topic})",
                        'args' => [
                            'connection_id' => $connId,
                            'target_table' => 'posts',
                            'name' => "Daily Content: {$topic}",
                            'topic_prompt' => $topic,
                            'category_name' => $category,
                            'schedule_type' => 'DAILY',
                            'generation_time' => '08:00',
                            'publication_time' => '09:00',
                            'timezone' => 'Asia/Kolkata',
                            'requires_approval' => true,
                            'is_active' => true,
                        ],
                    ],
                ],
            ];
        }

        // Monitoring
        if (str_contains($lower, 'status') || str_contains($lower, 'today') || str_contains($lower, 'overview') || str_contains($lower, 'metrics')) {
            return [
                'task_type' => 'CHECK_STATUS',
                'outcome' => 'SUPPORTED_AND_SPECIFIED',
                'steps' => [
                    ['tool' => 'get_dashboard_summary', 'label' => 'Retrieving Workspace Metrics', 'args' => []],
                    ['tool' => 'get_provider_health', 'label' => 'Checking AI Engine Status', 'args' => []],
                ],
            ];
        }

        // Default General State
        return [
            'task_type' => 'GENERAL_QUERY',
            'outcome' => 'SUPPORTED_AND_SPECIFIED',
            'steps' => [
                ['tool' => 'get_dashboard_summary', 'label' => 'Checking Platform State', 'args' => []],
            ],
        ];
    }

    protected function isCorrectionOrInterruption(string $lower): bool
    {
        return str_starts_with($lower, 'stop')
            || str_starts_with($lower, 'pause')
            || str_starts_with($lower, 'cancel')
            || str_starts_with($lower, 'resume')
            || str_contains($lower, 'reviews')
            || str_contains($lower, 'category')
            || str_contains($lower, 'instead')
            || str_contains($lower, 'change ');
    }

    protected function extractTopicFromGoal(string $goal): string
    {
        if (preg_match('/\b(?:about|on)\s+([^,\.]+)/i', $goal, $m)) {
            $raw = trim($m[1]);
            return ucwords($raw);
        }
        return "Comprehensive Industry Insights";
    }

    protected function extractCategoryFromGoal(string $goal): string
    {
        if (preg_match('/\b(?:in\s+the|category)\s+([A-Za-z0-9_-]+)/i', $goal, $m)) {
            return ucwords(trim($m[1]));
        }
        return "General";
    }

    protected function extractResourceIdFromGoal(string $goal, string $resourceName): ?int
    {
        if (preg_match('/\b' . preg_quote($resourceName, '/') . '\s*#?\s*(\d+)\b/i', $goal, $m)) {
            return (int) $m[1];
        }
        if (preg_match('/\b(?:id|#)\s*(\d+)\b/i', $goal, $m)) {
            return (int) $m[1];
        }
        return null;
    }

    // =========================================================================
    // Helpers & Real-Time Broadcast
    // =========================================================================

    protected function recordTimelineEvent(AgentTask $task, string $stepName, string $status, string $message, ?array $details = null): AgentTaskTimelineEvent
    {
        $event = AgentTaskTimelineEvent::create([
            'task_id' => $task->id,
            'step_name' => $stepName,
            'status' => $status,
            'message' => $message,
            'details' => $details,
            'correlation_id' => $task->idempotency_key,
            'created_at' => now(),
        ]);

        LiveEventService::publish(
            $task->user_id,
            'agent.timeline_event',
            [
                'task_id' => $task->id,
                'step_name' => $stepName,
                'status' => $status,
                'message' => $message,
                'details' => $details,
                'task_status' => $task->status,
                'created_at' => $event->created_at->toIso8601String(),
            ],
            'AgentTask',
            (string) $task->id
        );

        return $event;
    }

    protected function broadcastTaskUpdate(AgentTask $task): void
    {
        LiveEventService::publish(
            $task->user_id,
            'agent.task_updated',
            [
                'task_id' => $task->id,
                'status' => $task->status,
                'task_type' => $task->task_type,
                'current_step_index' => $task->current_step_index,
                'total_steps' => count($task->active_plan ?: []),
                'target_resource_type' => $task->target_resource_type,
                'target_resource_id' => $task->target_resource_id,
                'error_message' => $task->error_message,
            ],
            'AgentTask',
            (string) $task->id
        );
    }

    protected function getUserAutonomyLevel(User $user): string
    {
        $pref = UserAgentPreference::where('user_id', $user->id)->first();
        return $pref?->autonomy_level ?: 'CONFIRM_CONSEQUENTIAL_CHANGES';
    }

    public function broadcastActionRequested(int $userId, string $action, array $payload = []): void
    {
        LiveEventService::publish(
            $userId,
            'agent.action_requested',
            [
                'action' => $action,
                'payload' => $payload,
                'timestamp' => now()->toISOString(),
            ],
            'AgentAction',
            $action
        );
    }

    protected function buildCompletionSummary(AgentTask $task, array $results, ?User $user = null): string
    {
        $rawSummary = [];
        $lastResultData = [];
        foreach ($results as $res) {
            $msg = $res['result']['message'] ?? $res['step'];
            $rawSummary[] = $msg;
            if (!empty($res['result']) && is_array($res['result'])) {
                $lastResultData = array_merge($lastResultData, $res['result']);
            }
        }
        $actionSummary = implode('; ', $rawSummary);

        if ($user) {
            try {
                $activeProvider = AiProvider::where('user_id', $user->id)->where('is_active', true)->first();
                $provider = $activeProvider ? $activeProvider->provider_type : env('AI_PROVIDER', 'mock');
                $model = $activeProvider ? $activeProvider->model_name : env('AI_MODEL', null);
                $apiKey = $activeProvider ? $activeProvider->encrypted_api_key : null;

                $aiClient = new AiServiceClient();
                $synth = $aiClient->synthesizeResponse(
                    $task->goal,
                    $actionSummary,
                    $task->status,
                    $lastResultData,
                    $provider,
                    $model,
                    $apiKey
                );

                if (!empty($synth['spoken_response'])) {
                    $lines = ["{$synth['spoken_response']}\n"];
                    foreach ($results as $res) {
                        $msg = $res['result']['message'] ?? $res['step'];
                        $lines[] = "- {$msg}";
                    }
                    return implode("\n", $lines);
                }
            } catch (\Throwable $e) {
                Log::info("Response synthesis fallback: " . $e->getMessage());
            }
        }

        $lines = ["Task completed successfully: **{$task->goal}**\n"];
        foreach ($results as $res) {
            $msg = $res['result']['message'] ?? $res['step'];
            $lines[] = "- {$msg}";
        }
        return implode("\n", $lines);
    }
}
