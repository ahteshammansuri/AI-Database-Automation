<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ModelRole;
use App\Models\AiProvider;
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
                'temperature' => $saved->temperature ?? ($roleKey === ModelRole::ROLE_PLANNER ? 0.2 : 0.7),
                'temperature_hint' => $meta['temperature_hint'],
                'max_tokens' => $saved->max_tokens ?? null,
                'is_active' => $saved->is_active ?? true,
                'recommended_models' => $meta['recommended'],
                'is_customized' => $saved !== null,
                'updated_at' => $saved?->updated_at?->toIso8601String(),
            ];
        }

        // Active model catalog per provider
        $providerModels = [
            'gemini' => (array) config('ai_models.gemini', []),
            'openai' => (array) config('ai_models.openai', []),
            'anthropic' => (array) config('ai_models.anthropic', []),
            'ollama' => (array) config('ai_models.ollama_fallback', []),
        ];

        try {
            $aiCtrl = app(AiProviderController::class);
            $providersData = $aiCtrl->index($request)->getData(true);
            foreach ($providersData as $p) {
                if (!empty($p['provider_id']) && !empty($p['models'])) {
                    $providerModels[$p['provider_id']] = array_values(array_unique(array_merge(
                        $p['models'],
                        $providerModels[$p['provider_id']] ?? []
                    )));
                }
            }
        } catch (\Throwable) {
            // Keep default catalog if live probe is not available
        }

        return response()->json([
            'success' => true,
            'roles' => $result,
            'provider_models' => $providerModels,
        ]);
    }

    /**
     * Save or update a specific model role assignment.
     */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'role' => 'required|string|in:planner,generator',
            'provider' => 'required|string|in:ollama,openai,gemini,anthropic',
            'model_name' => 'required|string|max:64',
            'temperature' => 'nullable|numeric|min:0|max:' . ($request->input('role') === ModelRole::ROLE_PLANNER ? '1' : '1.5'),
            'max_tokens' => 'nullable|integer|min:1|max:32000',
            'is_active' => 'nullable|boolean',
        ]);

        $userId = $request->user()->id;
        $tracked = ['provider', 'model_name', 'temperature', 'max_tokens', 'is_active'];
        $before = ModelRole::where('user_id', $userId)->where('role', $validated['role'])->first()?->only($tracked) ?? [];

        $role = ModelRole::updateOrCreate(
            [
                'user_id' => $userId,
                'role' => $validated['role'],
            ],
            [
                'provider' => $validated['provider'],
                'model_name' => $validated['model_name'],
                'temperature' => $validated['temperature'] ?? ($validated['role'] === ModelRole::ROLE_PLANNER ? 0.2 : 0.7),
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
                'changes' => AuditLog::changes($before, $role->only($tracked)),
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
            'provider' => 'required|string|in:ollama,openai,gemini,anthropic',
            'model_name' => 'nullable|string|max:64',
        ]);

        $userProvider = AiProvider::where('user_id', $request->user()->id)
            ->where('provider_type', $validated['provider'])
            ->first();
        $apiKey = $userProvider?->encrypted_api_key;

        try {
            $health = $this->aiClient->checkHealth(
                $validated['provider'],
                $validated['model_name'] ?? null,
                $apiKey
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

    /**
     * Model readiness: four real tasks run against the model by the AI service (exact JSON, choosing the right
     * action, turning a question into a query plan, applying a correction). Each result is what the model did.
     */
    public function readinessTest(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'provider' => 'required|string|in:ollama,openai,gemini,anthropic',
            'model_name' => 'nullable|string|max:64',
        ]);

        $provider = $validated['provider'];
        $model = $validated['model_name'] ?? null;
        $apiKey = AiProvider::where('user_id', $request->user()->id)->where('provider_type', $provider)->first()?->encrypted_api_key;

        $health = $this->aiClient->checkHealth($provider, $model, $apiKey);
        if (!($health['available'] ?? false)) {
            return response()->json([
                'success' => false,
                'provider' => $provider,
                'model_name' => $model,
                'overall_score' => 0,
                'status' => 'offline',
                'message' => $health['message'] ?? "The model '{$model}' on {$provider} cannot be reached.",
                'tests' => [],
            ]);
        }

        try {
            $report = $this->aiClient->modelReadiness($provider, $model, $apiKey, (int) config('orbit.readiness_budget_seconds', 240));
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'status' => 'error', 'message' => 'The readiness test could not run: ' . $e->getMessage(), 'tests' => []], 502);
        }
        if (!($report['success'] ?? false)) {
            return response()->json(['success' => false, 'status' => 'error', 'message' => $report['error'] ?? 'The readiness test could not run.', 'tests' => []], 422);
        }

        $tests = [];
        foreach ($report['checks'] as $c) {
            $tests[$c['key']] = [
                'label' => $c['label'],
                'passed' => (bool) $c['passed'],
                'score' => $c['passed'] ? (int) round(100 / max(1, $report['total'])) : 0,
                'details' => $c['details'],
                'seconds' => $c['seconds'],
            ];
        }
        $score = (int) $report['score'];
        $status = $score === 100 ? 'ready_for_agent' : ($score >= 50 ? 'needs_better_model' : 'not_ready');

        AuditLog::log($request->user()->id, 'MODEL_READINESS_TESTED', 'ModelRole', null, [
            'provider' => $provider, 'model_name' => $model, 'score' => $score,
        ]);

        return response()->json([
            'success' => true,
            'provider' => $provider,
            'model_name' => $report['model'] ?? $model,
            'overall_score' => $score,
            'status' => $status,
            'recommendation' => $status === 'ready_for_agent' ? null
                : "This model got {$report['passed']} of {$report['total']} checks right. Orbit may make mistakes with it; a larger model (for example qwen2.5:7b or a cloud model) is more reliable.",
            'latency_ms' => (float) ($report['seconds'] ?? 0) * 1000,
            'tests' => $tests,
        ]);
    }
}
