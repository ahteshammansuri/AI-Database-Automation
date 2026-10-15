<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AgentConversation;
use App\Models\AgentTask;
use App\Models\UserAgentPreference;
use App\Services\Agent\AgentExecutionService;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Agent\UiActionCoordinator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentController extends Controller
{
    protected AgentExecutionService $executionService;

    public function __construct(AgentExecutionService $executionService)
    {
        $this->executionService = $executionService;
    }

    /**
     * List user conversations.
     */
    public function index(Request $request): JsonResponse
    {
        $conversations = AgentConversation::where('user_id', $request->user()->id)
            ->with(['messages' => fn ($q) => $q->latest('id')->limit(1)])
            ->orderBy('updated_at', 'desc')
            ->limit(20)
            ->get();

        return response()->json(['conversations' => $conversations]);
    }

    /**
     * Start a new conversation.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'nullable|string|max:120',
        ]);

        $conversation = AgentConversation::create([
            'user_id' => $request->user()->id,
            'title' => $validated['title'] ?? 'New Consultation',
            'status' => 'ACTIVE',
        ]);

        return response()->json([
            'conversation' => $conversation,
            'message' => 'New agent conversation started.',
        ], 201);
    }

    /**
     * Get conversation with messages, active task, and timeline events.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $conversation = AgentConversation::where('user_id', $request->user()->id)
            ->with(['messages'])
            ->find($id);

        if (!$conversation) {
            return response()->json(['error' => 'Conversation not found.'], 404);
        }

        $activeTask = AgentTask::where('conversation_id', $conversation->id)
            ->with(['timelineEvents'])
            ->latest('id')
            ->first();

        return response()->json([
            'conversation' => $conversation,
            'active_task' => $activeTask,
            'queue' => $activeTask ? \App\Services\Agent\AgentQueueStatus::forTask($activeTask) : null,
        ]);
    }

    /**
     * Post a user message and trigger autonomous agent execution.
     */
    public function postMessage(Request $request, int $id): JsonResponse
    {
        $conversation = AgentConversation::where('user_id', $request->user()->id)->find($id);
        if (!$conversation) {
            return response()->json(['error' => 'Conversation not found.'], 404);
        }

        $validated = $request->validate([
            'content' => 'required|string|max:4000',
            'is_voice' => 'nullable|boolean',
            'secure_input_data' => 'nullable|array',
            'page_context' => 'nullable|array',
        ]);

        $result = $this->executionService->handleUserMessage(
            $request->user(),
            $conversation,
            $validated['content'],
            (bool) ($validated['is_voice'] ?? false),
            $validated['secure_input_data'] ?? null,
            $validated['page_context'] ?? null
        );

        $conversation->touch();

        // 202: the turn runs in the background; progress and the spoken result arrive as live events.
        return response()->json($result, 202);
    }

    /**
     * Request immediate Stop or Pause of an active task.
     */
    public function interrupt(Request $request, int $taskId): JsonResponse
    {
        $task = AgentTask::where('user_id', $request->user()->id)->find($taskId);
        if (!$task) {
            return response()->json(['error' => 'Task not found.'], 404);
        }

        $action = strtoupper((string) $request->input('action', 'STOP'));
        if (!in_array($action, ['STOP', 'PAUSE', 'RESUME'], true)) {
            return response()->json(['error' => 'Action must be STOP, PAUSE or RESUME.'], 422);
        }
        $res = $this->executionService->interruptTask($request->user(), $task, $action);

        return response()->json($res);
    }

    /**
     * Submit mid-task typed or voice correction.
     */
    public function correct(Request $request, int $taskId): JsonResponse
    {
        $task = AgentTask::where('user_id', $request->user()->id)->find($taskId);
        if (!$task) {
            return response()->json(['error' => 'Task not found.'], 404);
        }

        $validated = $request->validate([
            'correction' => 'required|string',
        ]);

        $conversation = $task->conversation;
        $res = $this->executionService->handleCorrection(
            $request->user(),
            $conversation,
            $task,
            $validated['correction']
        );

        return response()->json($res);
    }

    /**
     * Confirm a pending consequential step.
     */
    public function confirm(Request $request, int $taskId): JsonResponse
    {
        $task = AgentTask::where('user_id', $request->user()->id)->find($taskId);
        if (!$task) {
            return response()->json(['error' => 'Task not found.'], 404);
        }

        $res = $this->executionService->confirmTaskStep($request->user(), $task);
        return response()->json($res, empty($res['error']) ? 202 : 409);
    }

    /**
     * Browser acknowledgement of one visible UI action (navigate, fill, press...).
     */
    public function uiAck(Request $request, string $correlationId): JsonResponse
    {
        $validated = $request->validate([
            'status' => 'required|string|in:ok,validation_error,not_mounted,error,timeout',
            'result' => 'nullable|array',
        ]);

        $ui = UiActionCoordinator::acknowledge($request->user()->id, $correlationId, $validated['status'], $validated['result'] ?? []);
        if (!$ui) {
            return response()->json(['error' => 'UI action not found.'], 404);
        }

        return response()->json(['correlation_id' => $ui->correlation_id, 'status' => $ui->status]);
    }

    /**
     * The surface catalog: which pages, forms, fields and buttons Orbit may operate.
     */
    public function surfaces(): JsonResponse
    {
        return response()->json(\App\Services\Agent\SurfaceCatalog::data());
    }

    /**
     * The user typed a secret into a real form field (e.g. the connection password) and
     * wants Orbit to continue. Only the fact is sent, never the value.
     */
    public function continueAfterSecret(Request $request, int $taskId): JsonResponse
    {
        $task = AgentTask::where('user_id', $request->user()->id)->find($taskId);
        if (!$task) {
            return response()->json(['error' => 'Task not found.'], 404);
        }
        $validated = $request->validate([
            'surface' => 'required|string|max:80',
            'field' => 'required|string|max:80',
        ]);
        if ($request->hasAny(['value', 'password', 'api_key', 'secret'])) {
            return response()->json(['error' => 'Do not send secret values here.'], 422);
        }
        $surface = \App\Services\Agent\SurfaceCatalog::surface($validated['surface']);
        $field = $surface ? \App\Services\Agent\SurfaceCatalog::field($surface, $validated['field']) : null;
        if (!$field || $field['type'] !== 'secret') {
            return response()->json(['error' => 'Unknown secret field.'], 422);
        }

        $result = $this->executionService->handleUserMessage(
            $request->user(),
            $task->conversation,
            "I typed the {$field['label']} into the {$surface['title']} myself. Please continue.",
            false,
            null,
            $request->input('page_context')
        );

        return response()->json($result, 202);
    }

    /**
     * The open portal tells the server it can perform visible UI actions.
     */
    public function heartbeat(Request $request): JsonResponse
    {
        UiActionCoordinator::heartbeat($request->user()->id);

        return response()->json(['ok' => true, 'server_time' => now()->toIso8601String()]);
    }

    /**
     * Get timeline events for a task.
     */
    public function timeline(Request $request, int $taskId): JsonResponse
    {
        $task = AgentTask::where('user_id', $request->user()->id)->find($taskId);
        if (!$task) {
            return response()->json(['error' => 'Task not found.'], 404);
        }

        return response()->json([
            'task_id' => $task->id,
            'status' => $task->status,
            'timeline_events' => $task->timelineEvents,
        ]);
    }

    /**
     * Get details of a specific task.
     */
    public function getTask(Request $request, int $taskId): JsonResponse
    {
        $task = AgentTask::where('user_id', $request->user()->id)
            ->with(['timelineEvents'])
            ->find($taskId);

        if (!$task) {
            return response()->json(['error' => 'Task not found.'], 404);
        }

        return response()->json(['task' => $task, 'queue' => \App\Services\Agent\AgentQueueStatus::forTask($task)]);
    }

    /**
     * Get user agent preferences.
     */
    public function getPreferences(Request $request): JsonResponse
    {
        $pref = UserAgentPreference::firstOrCreate(
            ['user_id' => $request->user()->id],
            [
                'autonomy_level' => 'CONFIRM_CONSEQUENTIAL_CHANGES',
                'voice_enabled' => true,
                'preferred_model' => config('orbit.default_model'),
            ]
        );

        return response()->json(['preferences' => $pref]);
    }

    /**
     * Update user agent preferences.
     */
    public function updatePreferences(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'autonomy_level' => 'nullable|in:PREPARE_FOR_REVIEW,CONFIRM_CONSEQUENTIAL_CHANGES,AUTOMATIC_WITHIN_PERMISSIONS',
            'voice_enabled' => 'nullable|boolean',
            'preferred_model' => 'nullable|string',
        ]);

        $pref = UserAgentPreference::updateOrCreate(
            ['user_id' => $request->user()->id],
            array_filter($validated, fn ($v) => $v !== null)
        );

        return response()->json([
            'preferences' => $pref,
            'message' => 'Agent preferences updated.',
        ]);
    }

    /**
     * List registered tools and dynamic availability for user.
     */
    public function tools(Request $request): JsonResponse
    {
        return response()->json([
            'tools' => AgentToolRegistry::getToolDefinitions(),
            'model_visible' => AgentToolRegistry::modelVisibleSchemas($request->user()),
            'availability' => AgentToolRegistry::getDynamicToolAvailability($request->user()),
        ]);
    }
}
