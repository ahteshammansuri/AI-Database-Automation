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

    protected function agentClient(int $timeout = 60)
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
        // Long articles on a CPU-only local model can take several minutes; stay below the job timeout (690s).
        $res = $this->client()->timeout((int) ($params['timeout'] ?? 600))->post("{$this->baseUrl}/v1/ai/generate", [
            'provider' => $params['provider'] ?? 'mock',
            'model' => $params['model'] ?? null,
            'api_key' => $params['api_key'] ?? null,
            'prompt' => $params['prompt'],
            'system_prompt' => $params['system_prompt'] ?? 'You are an expert content generation engine.',
            'target_table' => $params['target_table'] ?? 'posts',
            'required_fields' => $params['required_fields'] ?? ['title', 'slug', 'content', 'excerpt'],
            'context_passages' => $params['context_passages'] ?? [],
            'rejection_feedback' => $params['rejection_feedback'] ?? null,
            'schema_constraints' => $params['schema_constraints'] ?? null,
            'relation_catalog' => $params['relation_catalog'] ?? null,
            'recent_titles' => $params['recent_titles'] ?? null,
            'field_specs' => $params['field_specs'] ?? null,
            'length' => $params['length'] ?? 'medium',
            'max_output_tokens' => $params['max_output_tokens'] ?? null,
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
     * Generate one image (OpenAI / Gemini with the user's key, or a local designed cover).
     * Returns the AI service response: provider_used, model_used, mime_type, width, height, image_base64.
     */
    public function generateImage(array $params): array
    {
        $res = $this->client()->post("{$this->baseUrl}/v1/ai/generate-image", [
            'provider' => $params['provider'] ?? 'local',
            'api_key' => $params['api_key'] ?? null,
            'model' => $params['model'] ?? null,
            'prompt' => mb_substr((string) ($params['prompt'] ?? ''), 0, 5900),
            'width' => (int) ($params['width'] ?? 1600),
            'height' => (int) ($params['height'] ?? 900),
            'title' => isset($params['title']) ? mb_substr((string) $params['title'], 0, 290) : null,
            'label' => isset($params['label']) ? mb_substr((string) $params['label'], 0, 78) : null,
            'seed' => isset($params['seed']) ? mb_substr((string) $params['seed'], 0, 290) : null,
        ]);

        if (!$res->successful()) {
            throw new Exception("AI service image error ({$res->status()}).");
        }
        $data = $res->json();
        if (!($data['success'] ?? false) || empty($data['image_base64'])) {
            throw new Exception($data['error'] ?? 'Image generation failed.');
        }
        return $data;
    }

    /**
     * Check candidate title novelty against recent titles using semantic embeddings.
     */
    public function checkNovelty(string $candidateTitle, array $recentTitles, float $threshold = 0.92): array
    {
        $res = $this->client()->post("{$this->baseUrl}/v1/ai/check-novelty", [
            'candidate_title' => $candidateTitle,
            'recent_titles' => $recentTitles,
            'threshold' => $threshold,
        ]);

        if (!$res->successful()) {
            throw new Exception("AI service novelty check error ({$res->status()}): " . $res->body());
        }

        return $res->json();
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
        if ($provider === 'mock') {
            return [
                'provider' => 'mock',
                'available' => true,
                'latency_ms' => 1.2,
                'models' => ['mock-llama3-synthetic', 'mock-mistral-synthetic'],
                'message' => 'Local mock generator ready (Offline testing & demo mode).',
            ];
        }

        try {
            $res = Http::withHeaders([
                'X-Service-Token' => $this->serviceToken,
                'Accept' => 'application/json',
            ])->timeout(5)->post("{$this->baseUrl}/v1/ai/health", [
                'provider' => $provider,
                'model' => $model,
                'api_key' => $apiKey,
            ]);

            if ($res->successful()) {
                return $res->json();
            }
        } catch (\Throwable $e) {
            // Local fallback handling below
        }

        return [
            'provider' => $provider,
            'available' => false,
            'latency_ms' => 0.0,
            'models' => [],
            'message' => "AI service unreachable at {$this->baseUrl}",
        ];
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
     * One step of Orbit's observe-act loop. Never throws: transport failures come back
     * as success=false with an error category so the caller can report them honestly.
     */
    public function decide(array $payload, int $timeoutSeconds = 150): array
    {
        try {
            $res = $this->agentClient($timeoutSeconds)->post("{$this->baseUrl}/v1/ai/agent/decide", $payload);
            if ($res->successful() && is_array($res->json())) {
                return $res->json();
            }
            \Illuminate\Support\Facades\Log::warning("AiServiceClient decide HTTP {$res->status()}");

            return [
                'success' => false,
                'error_category' => 'AI_SERVICE_ERROR',
                'error_message' => "The AI service returned HTTP {$res->status()}.",
            ];
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('AiServiceClient decide transport error: ' . get_class($e));

            return [
                'success' => false,
                'error_category' => 'AI_SERVICE_UNAVAILABLE',
                'error_message' => 'The AI service could not be reached.',
            ];
        }
    }

    /**
     * Classify schema columns into semantic roles via the AI service field classifier.
     * Returns an array of classification results per column, or empty array on failure.
     */
    public function classifyFields(array $columns): array
    {
        try {
            $res = $this->client()->post("{$this->baseUrl}/v1/rag/classify-fields", [
                'columns' => $columns,
            ]);

            if ($res->successful()) {
                $data = $res->json();
                if ($data['success'] ?? false) {
                    return $data['classifications'] ?? [];
                }
            }
        } catch (\Throwable $e) {
            // Classification failure is non-fatal; caller proceeds with unknown roles
        }

        return [];
    }

    /**
     * Parse and validate SQL via python sqlglot AST analyzer gate.
     */
    public function analyzeSql(string $sql, string $dialect = 'mysql', int $maxLimit = 500): array
    {
        try {
            $res = $this->client()->post("{$this->baseUrl}/v1/sql/analyze", [
                'sql' => $sql,
                'dialect' => $dialect,
                'max_limit' => $maxLimit,
            ]);

            if ($res->successful() && is_array($res->json())) {
                return $res->json();
            }

            return [
                'valid' => false,
                'dialect' => $dialect,
                'statement_type' => 'UNKNOWN',
                'tables' => [],
                'columns' => [],
                'functions' => [],
                'has_limit' => false,
                'errors' => ["HTTP {$res->status()}: " . $res->body()],
            ];
        } catch (\Throwable $e) {
            return [
                'valid' => false,
                'dialect' => $dialect,
                'statement_type' => 'UNKNOWN',
                'tables' => [],
                'columns' => [],
                'functions' => [],
                'has_limit' => false,
                'errors' => ['SQL analyzer service unreachable: ' . $e->getMessage()],
            ];
        }
    }

    /**
     * Generate structured QueryPlan via Python AI service DataPlanner.
     */
    public function generateDataPlan(array $params): array
    {
        if (app()->environment('testing') && empty($params['force_live_ai'])) {
            return [];
        }

        try {
            $timeout = (int) ($params['timeout'] ?? 15);
            $res = $this->agentClient($timeout)->post("{$this->baseUrl}/v1/ai/data/plan", [
                'utterance' => $params['utterance'],
                'schema_slice' => $params['schema_slice'],
                'context' => $params['context'] ?? null,
                'timezone' => $params['timezone'] ?? 'Asia/Kolkata',
                'backend_errors' => $params['backend_errors'] ?? null,
                'provider' => $params['provider'] ?? null,
                'model' => $params['model'] ?? null,
            ]);

            if ($res->successful() && is_array($res->json())) {
                $data = $res->json();
                if ($data['success'] ?? false) {
                    return $data['plan'] ?? [];
                }
            }

            \Illuminate\Support\Facades\Log::warning("generateDataPlan failed HTTP {$res->status()}: " . $res->body());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("generateDataPlan exception: " . $e->getMessage());
        }

        return [];
    }
}

