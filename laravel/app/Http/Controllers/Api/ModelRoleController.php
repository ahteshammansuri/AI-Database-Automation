<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ModelRole;
use App\Models\AuditLog;
use App\Services\AiServiceClient;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ModelRoleController extends Controller
{
    public function __construct(
        protected AiServiceClient $aiClient
    ) {}

    /**
     * Get all configured model roles for the authenticated user,
     * merging with platform default role definitions.
     */
    public function index(Request $request): JsonResponse
    {
        $userId = $request->user()->id;
        $savedRoles = ModelRole::where('user_id', $userId)->get()->keyBy('role');

        $result = [];
        foreach (ModelRole::SUPPORTED_ROLES as $roleKey => $meta) {
            $saved = $savedRoles->get($roleKey);
            $result[] = [
                'role' => $roleKey,
                'label' => $meta['label'],
                'description' => $meta['description'],
                'provider' => $saved->provider ?? $meta['default_provider'],
                'model_name' => $saved->model_name ?? $meta['default_model'],
                'temperature' => $saved->temperature ?? 0.70,
                'max_tokens' => $saved->max_tokens ?? null,
                'is_active' => $saved->is_active ?? true,
                'recommended_models' => $meta['recommended'],
                'is_customized' => $saved !== null,
                'updated_at' => $saved?->updated_at?->toIso8601String(),
            ];
        }

        return response()->json([
            'success' => true,
            'roles' => $result,
        ]);
    }

    /**
     * Save or update a specific model role assignment.
     */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'role' => 'required|string|in:planner,generator,classifier,summarizer',
            'provider' => 'required|string|in:ollama,mock,openai,gemini,anthropic',
            'model_name' => 'required|string|max:64',
            'temperature' => 'nullable|numeric|min:0|max:2',
            'max_tokens' => 'nullable|integer|min:1|max:32000',
            'is_active' => 'nullable|boolean',
        ]);

        $userId = $request->user()->id;

        $role = ModelRole::updateOrCreate(
            [
                'user_id' => $userId,
                'role' => $validated['role'],
            ],
            [
                'provider' => $validated['provider'],
                'model_name' => $validated['model_name'],
                'temperature' => $validated['temperature'] ?? 0.70,
                'max_tokens' => $validated['max_tokens'] ?? null,
                'is_active' => $validated['is_active'] ?? true,
            ]
        );

        AuditLog::log(
            $userId,
            'MODEL_ROLE_UPDATED',
            'ModelRole',
            (string) $role->id,
            [
                'role' => $role->role,
                'provider' => $role->provider,
                'model_name' => $role->model_name,
            ]
        );

        return response()->json([
            'success' => true,
            'message' => "Model role '{$role->role}' updated successfully.",
            'role' => $role,
        ]);
    }

    /**
     * Capability probe: test model availability and latency for a specified role/model.
     */
    public function probe(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'provider' => 'required|string|in:ollama,mock,openai,gemini,anthropic',
            'model_name' => 'nullable|string|max:64',
        ]);

        try {
            $health = $this->aiClient->checkHealth(
                $validated['provider'],
                $validated['model_name'] ?? null
            );

            return response()->json([
                'success' => true,
                'available' => (bool) ($health['available'] ?? false),
                'latency_ms' => (float) ($health['latency_ms'] ?? 0.0),
                'models' => $health['models'] ?? [],
                'message' => $health['message'] ?? 'Probe completed.',
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'available' => false,
                'latency_ms' => 0.0,
                'models' => [],
                'message' => 'Probe error: ' . $e->getMessage(),
            ], 500);
        }
    }
}
