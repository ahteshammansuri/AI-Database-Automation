<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AgentConversation;
use App\Models\AgentTask;
use App\Models\UserAgentPreference;
use App\Services\Agent\AgentExecutionService;
use App\Services\Agent\AgentToolRegistry;
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
            'content' => 'required|string',
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

        return response()->json($result);
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

        $action = strtoupper($request->input('action', 'STOP'));
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
        return response()->json($res);
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

        return response()->json(['task' => $task]);
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
                'preferred_model' => 'llama3.2:1b',
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
            'availability' => $request->user() ? AgentToolRegistry::getDynamicToolAvailability($request->user()) : [],
        ]);
    }
}
