<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataConversationState;
use App\Models\DataQueryResult;
use App\Models\DbConnection;
use App\Services\Data\DataAgentService;
use App\Services\Data\DataChangeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DataAgentController extends Controller
{
    public function __construct(
        protected DataAgentService $dataAgentService,
        protected DataChangeService $dataChangeService
    ) {}

    /**
     * Ask a natural language question about database structure or records.
     */
    public function ask(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'question' => 'required|string|max:2000',
            'connection_id' => 'nullable|integer',
            'reveal_pii' => 'nullable|boolean',
        ]);

        $res = $this->dataAgentService->ask(
            $request->user(),
            $validated['question'],
            $validated['connection_id'] ?? null,
            ['reveal_pii' => $validated['reveal_pii'] ?? false]
        );

        return response()->json($res);
    }

    /**
     * Get active conversational context (active connection, active table, recent query).
     */
    public function context(Request $request): JsonResponse
    {
        $user = $request->user();
        $state = DataConversationState::where('user_id', $user->id)
            ->with(['activeConnection'])
            ->first();

        return response()->json([
            'active_connection' => $state?->activeConnection ? [
                'id' => $state->activeConnection->id,
                'name' => $state->activeConnection->name,
                'driver' => $state->activeConnection->driver,
                'access_mode' => $state->activeConnection->access_mode,
            ] : null,
            'active_table' => $state?->active_table,
            'last_result_id' => $state?->last_result_id,
            'last_query_plan' => $state?->last_query_plan,
        ]);
    }

    /**
     * Explicitly set active connection for the conversation.
     */
    public function setConnection(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'connection_id' => 'required|integer|exists:db_connections,id',
        ]);

        $conn = DbConnection::where('id', $validated['connection_id'])
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        $state = DataConversationState::firstOrCreate(['user_id' => $request->user()->id]);
        $state->update([
            'active_connection_id' => $conn->id,
            'active_table' => null,
        ]);

        return response()->json([
            'success' => true,
            'message' => "Active connection set to '{$conn->name}'.",
            'connection' => [
                'id' => $conn->id,
                'name' => $conn->name,
                'driver' => $conn->driver,
                'access_mode' => $conn->access_mode,
            ],
        ]);
    }

    /**
     * Preview an update or delete before execution (with diff, impact analysis).
     */
    public function previewChange(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'connection_id' => 'required|integer|exists:db_connections,id',
            'action' => 'required|string|in:update,delete',
            'table' => 'required|string',
            'filter' => 'required|array',
            'patch_values' => 'nullable|array',
        ]);

        $conn = DbConnection::where('id', $validated['connection_id'])
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        if ($validated['action'] === 'update') {
            $res = $this->dataChangeService->previewUpdate(
                $conn,
                $request->user(),
                $validated['table'],
                $validated['filter'],
                $validated['patch_values'] ?? []
            );
        } else {
            $res = $this->dataChangeService->previewDelete(
                $conn,
                $request->user(),
                $validated['table'],
                $validated['filter']
            );
        }

        return response()->json($res);
    }

    /**
     * Confirm and execute a previewed change request.
     */
    public function confirmChange(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'change_request_id' => 'required|integer|exists:data_change_requests,id',
            'typed_phrase' => 'nullable|string',
        ]);

        $res = $this->dataChangeService->executeChange(
            $request->user(),
            $validated['change_request_id'],
            $validated['typed_phrase'] ?? null
        );

        return response()->json($res);
    }

    /**
     * Undo an executed change using the encrypted backup before-image.
     */
    public function undoChange(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'change_request_id' => 'required|integer|exists:data_change_requests,id',
        ]);

        $res = $this->dataChangeService->undo(
            $request->user(),
            $validated['change_request_id']
        );

        return response()->json($res);
    }

    /**
     * Retrieve stored query results by ID.
     */
    public function showResult(Request $request, string $id): JsonResponse
    {
        $result = DataQueryResult::where('id', $id)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        return response()->json([
            'result' => $result,
        ]);
    }
}
