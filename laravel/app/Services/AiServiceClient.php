<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Exception;

class AiServiceClient
{
    protected string $baseUrl;
    protected string $serviceToken;

    public function __construct()
    {
        $this->baseUrl = rtrim(env('AI_SERVICE_URL', 'http://127.0.0.1:8001'), '/');
        $this->serviceToken = env('AI_SERVICE_KEY', 'platform_secret_internal_key_2026');
    }

    protected function client()
    {
        return Http::withHeaders([
            'X-Service-Token' => $this->serviceToken,
            'Accept' => 'application/json',
        ])->timeout(300);
    }

    protected function agentClient(int $timeout = 10)
    {
        return Http::withHeaders([
            'X-Service-Token' => $this->serviceToken,
            'Accept' => 'application/json',
        ])->timeout($timeout);
    }

    /**
     * Request structured JSON generation from the Python AI service.
     */
    public function generateContent(array $params): array
    {
        $res = $this->client()->post("{$this->baseUrl}/v1/ai/generate", [
            'provider' => $params['provider'] ?? 'mock',
            'model' => $params['model'] ?? null,
            'api_key' => $params['api_key'] ?? null,
            'prompt' => $params['prompt'],
            'system_prompt' => $params['system_prompt'] ?? 'You are an expert content generation engine.',
            'target_table' => $params['target_table'] ?? 'posts',
            'required_fields' => $params['required_fields'] ?? ['title', 'slug', 'content', 'excerpt'],
            'context_passages' => $params['context_passages'] ?? [],
            'rejection_feedback' => $params['rejection_feedback'] ?? null,
        ]);

        if (!$res->successful()) {
            throw new Exception("AI service error ({$res->status()}): " . $res->body());
        }

        $data = $res->json();
        if (!($data['success'] ?? false)) {
            throw new Exception("AI generation failed: " . ($data['error'] ?? 'Unknown error'));
        }

        return $data;
    }

    /**
     * Translate a natural language goal into a validated proposed automation configuration.
     */
    public function proposeAutomation(
        string $goalPrompt,
        array $tables,
        string $provider = 'mock',
        ?string $model = null,
        ?string $apiKey = null
    ): array {
        $res = $this->client()->post("{$this->baseUrl}/v1/ai/propose-automation", [
            'goal_prompt' => $goalPrompt,
            'tables' => $tables,
            'provider' => $provider,
            'model' => $model,
            'api_key' => $apiKey,
        ]);

        if (!$res->successful()) {
            throw new Exception("AI proposal service error ({$res->status()}): " . $res->body());
        }

        $data = $res->json();
        if (!($data['success'] ?? false)) {
            throw new Exception("AI proposal failed: " . ($data['error'] ?? 'Unknown error'));
        }

        return $data;
    }

    /**
     * Check provider health & available models.
     */
    public function checkHealth(string $provider = 'ollama', ?string $model = null, ?string $apiKey = null): array
    {
        $res = $this->client()->post("{$this->baseUrl}/v1/ai/health", [
            'provider' => $provider,
            'model' => $model,
            'api_key' => $apiKey,
        ]);

        if (!$res->successful()) {
            return [
                'provider' => $provider,
                'available' => false,
                'latency_ms' => 0.0,
                'models' => [],
                'message' => "AI service unreachable at {$this->baseUrl}",
            ];
        }

        return $res->json();
    }

    /**
     * Index text into user-isolated vector store.
     */
    public function indexDocument(int $userId, int $docId, string $title, string $textContent, string $fileType = 'txt'): array
    {
        $res = $this->client()->post("{$this->baseUrl}/v1/rag/index", [
            'user_id' => $userId,
            'document_id' => $docId,
            'title' => $title,
            'text_content' => $textContent,
            'file_type' => $fileType,
        ]);

        if (!$res->successful()) {
            throw new Exception("RAG indexing failed: " . $res->body());
        }

        return $res->json();
    }

    /**
     * Semantic search within tenant's documents.
     */
    public function queryKnowledge(int $userId, string $queryText, int $topK = 3): array
    {
        $res = $this->client()->post("{$this->baseUrl}/v1/rag/query", [
            'user_id' => $userId,
            'query_text' => $queryText,
            'top_k' => $topK,
        ]);

        if (!$res->successful()) {
            return [];
        }

        return $res->json()['chunks'] ?? [];
    }

    /**
     * Extract raw text from a document (.pdf, .md, .txt) via Python AI microservice.
     */
    public function extractTextFromFile(string $filePath): string
    {
        try {
            $res = $this->client()->post("{$this->baseUrl}/v1/rag/extract-text", [
                'file_path' => $filePath,
            ]);

            if ($res->successful() && ($res->json()['success'] ?? false)) {
                return (string) ($res->json()['text'] ?? '');
            }
        } catch (\Throwable $e) {
            // Handled by caller fallback
        }

        return '';
    }

    /**
     * Delete document vectors.
     */
    public function deleteDocument(int $userId, int $docId): void
    {
        $this->client()->delete("{$this->baseUrl}/v1/rag/index/{$userId}/{$docId}");
    }

    /**
     * Call AI microservice to plan agent task tools from user goal.
     */
    public function planAgentTask(
        string $goalPrompt,
        array $connections = [],
        array $tables = [],
        array $automations = [],
        array $executions = [],
        array $conversationHistory = [],
        ?array $activeTask = null,
        array $toolAvailability = [],
        array $accumulatedSlots = [],
        array $availableTools = [],
        string $provider = 'mock',
        ?string $model = null,
        ?string $apiKey = null
    ): ?array {
        try {
            $res = $this->agentClient(10)->post("{$this->baseUrl}/v1/ai/agent/plan", [
                'goal_prompt' => $goalPrompt,
                'has_connections' => !empty($connections),
                'connections' => $connections,
                'tables' => $tables,
                'automations' => $automations,
                'executions' => $executions,
                'conversation_history' => $conversationHistory,
                'active_task' => $activeTask,
                'tool_availability' => empty($toolAvailability) ? (object) [] : $toolAvailability,
                'accumulated_slots' => empty($accumulatedSlots) ? (object) [] : $accumulatedSlots,
                'available_tools' => $availableTools,
                'provider' => $provider,
                'model' => $model,
                'api_key' => $apiKey,
            ]);

            if ($res->successful()) {
                $data = $res->json();
                if (is_array($data) && isset($data['outcome'])) {
                    return $data;
                }
            }
        } catch (\Throwable $e) {
            // Falls back to Laravel deterministic planner
        }

        return null;
    }

    /**
     * Synthesize contextual, truthful spoken natural language summary from verified outcome.
     */
    public function synthesizeResponse(
        string $userGoal,
        string $actionSummary,
        string $resultStatus,
        array $resultData = [],
        string $provider = 'mock',
        ?string $model = null,
        ?string $apiKey = null
    ): array {
        try {
            $res = $this->agentClient(6)->post("{$this->baseUrl}/v1/ai/agent/synthesize-response", [
                'goal_prompt' => $userGoal,
                'action_summary' => $actionSummary,
                'final_status' => $resultStatus,
                'domain_data' => empty($resultData) ? (object) [] : $resultData,
                'provider' => $provider,
                'model' => $model,
                'api_key' => $apiKey,
            ]);

            if ($res->successful()) {
                $data = $res->json();
                $spoken = $data['spoken_text'] ?? $data['spoken_response'] ?? null;
                if ($spoken) {
                    return [
                        'spoken_response' => $spoken,
                        'display_summary' => $data['safe_summary'] ?? $actionSummary,
                        'provider_used' => $provider,
                    ];
                }
            }
        } catch (\Throwable $e) {
            // Falls back to deterministic sentence
        }

        return [
            'spoken_response' => "I have completed your request: {$actionSummary}.",
            'display_summary' => $actionSummary,
            'provider_used' => 'fallback',
        ];
    }

    /**
     * Evaluate mid-task correction via AI microservice.
     */
    public function evaluateAgentCorrection(string $correctionText, string $activeTaskStatus, ?string $currentStep = null): ?array
    {
        try {
            $res = $this->agentClient(6)->post("{$this->baseUrl}/v1/ai/agent/evaluate-correction", [
                'correction_text' => $correctionText,
                'active_task_status' => $activeTaskStatus,
                'current_step' => $currentStep,
            ]);

            if ($res->successful()) {
                return $res->json();
            }
        } catch (\Throwable $e) {
            // Falls back to Laravel deterministic handler
        }

        return null;
    }
}
