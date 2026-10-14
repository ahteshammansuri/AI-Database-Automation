<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiProvider;
use App\Models\AuditLog;
use App\Services\AiServiceClient;
use Illuminate\Http\Request;

class AiProviderController extends Controller
{
    public function __construct(
        protected AiServiceClient $aiClient
    ) {}

    public function index(Request $request)
    {
        $userProviders = AiProvider::where('user_id', $request->user()->id)->get()->keyBy('provider_type');

        $catalog = [
            [
                'provider_id' => 'ollama',
                'name' => 'Ollama (Local LLM)',
                'is_local' => true,
                'is_available' => false,
                'status_message' => 'Zero-cost local model inference on host machine.',
                'current_model' => $userProviders['ollama']->model_name ?? 'llama3',
                'requires_api_key' => false,
            ],
            [
                'provider_id' => 'mock',
                'name' => 'Local Mock Generator',
                'is_local' => true,
                'is_available' => true,
                'status_message' => 'Deterministic local generator for development & offline demos.',
                'current_model' => 'mock-llama3-synthetic',
                'requires_api_key' => false,
            ],
            [
                'provider_id' => 'openai',
                'name' => 'OpenAI',
                'is_local' => false,
                'is_available' => isset($userProviders['openai']),
                'status_message' => 'Cloud provider (GPT-4o / GPT-4o-mini). Requires user API key.',
                'current_model' => $userProviders['openai']->model_name ?? 'gpt-4o-mini',
                'requires_api_key' => true,
            ],
            [
                'provider_id' => 'gemini',
                'name' => 'Google Gemini',
                'is_local' => false,
                'is_available' => isset($userProviders['gemini']),
                'status_message' => 'Cloud provider (Gemini 1.5 Flash / Pro). Requires user API key.',
                'current_model' => $userProviders['gemini']->model_name ?? 'gemini-1.5-flash',
                'requires_api_key' => true,
            ],
            [
                'provider_id' => 'anthropic',
                'name' => 'Anthropic Claude',
                'is_local' => false,
                'is_available' => isset($userProviders['anthropic']),
                'status_message' => 'Cloud provider (Claude 3.5 Sonnet). Requires user API key.',
                'current_model' => $userProviders['anthropic']->model_name ?? 'claude-3-5-sonnet',
                'requires_api_key' => true,
            ],
        ];

        // Enrich with live health check and available model lists
        foreach ($catalog as &$item) {
            if ($item['provider_id'] === 'ollama') {
                try {
                    $health = $this->aiClient->checkHealth('ollama', $item['current_model']);
                    $item['is_available'] = (bool) ($health['available'] ?? false);
                    $models = $health['models'] ?? ['llama3.2:1b', 'llama3:latest'];
                    $item['models'] = $models;
                    if (!empty($models) && empty($userProviders['ollama'])) {
                        $item['current_model'] = in_array('llama3.2:1b', $models) ? 'llama3.2:1b' : $models[0];
                    }
                    if ($item['is_available']) {
                        $item['status_message'] = $health['message'] ?? 'Ollama is online and ready.';
                    } else {
                        $item['status_message'] = 'Ollama is offline. Start via "ollama serve" on port 11434.';
                    }
                } catch (\Exception) {
                    $item['is_available'] = false;
                    $item['models'] = ['llama3.2:1b', 'llama3:latest'];
                    $item['status_message'] = 'Ollama service offline. Run "ollama serve" on port 11434.';
                }
            } elseif ($item['provider_id'] === 'mock') {
                $item['models'] = ['mock-llama3-synthetic', 'mock-mistral-synthetic'];
            } elseif ($item['provider_id'] === 'openai') {
                $item['models'] = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];
            } elseif ($item['provider_id'] === 'gemini') {
                $item['models'] = ['gemini-1.5-flash', 'gemini-1.5-pro'];
            } elseif ($item['provider_id'] === 'anthropic') {
                $item['models'] = ['claude-3-5-sonnet', 'claude-3-5-haiku-latest'];
            }
        }

        return response()->json($catalog);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'provider_type' => 'required|string|in:ollama,mock,openai,gemini,anthropic',
            'model_name' => 'required|string',
            'api_key' => 'nullable|string',
            'base_url' => 'nullable|string',
        ]);

        $provider = AiProvider::updateOrCreate(
            [
                'user_id' => $request->user()->id,
                'provider_type' => $validated['provider_type'],
            ],
            [
                'model_name' => $validated['model_name'],
                'encrypted_api_key' => $validated['api_key'] ?? null,
                'base_url' => $validated['base_url'] ?? null,
                'is_active' => true,
            ]
        );

        AuditLog::log($request->user()->id, 'AI_PROVIDER_CONFIGURED', 'AiProvider', (string) $provider->id, [
            'provider_type' => $provider->provider_type,
            'model_name' => $provider->model_name,
        ]);

        return response()->json([
            'message' => 'AI provider preferences saved successfully',
            'provider' => $provider,
        ]);
    }

    public function health(Request $request)
    {
        $providerType = $request->query('provider', 'mock');
        $model = $request->query('model');

        // Look up user's key if configured
        $userProvider = AiProvider::where('user_id', $request->user()->id)
            ->where('provider_type', $providerType)
            ->first();

        $apiKey = $userProvider?->encrypted_api_key;
        $defaultModel = match ($providerType) {
            'ollama' => 'llama3',
            'openai' => 'gpt-4o-mini',
            'gemini' => 'gemini-1.5-flash',
            'anthropic' => 'claude-3-5-sonnet',
            default => 'mock-llama3-synthetic',
        };
        $modelName = $model ?: ($userProvider?->model_name ?: $defaultModel);

        $status = $this->aiClient->checkHealth($providerType, $modelName, $apiKey);

        return response()->json($status);
    }
}
