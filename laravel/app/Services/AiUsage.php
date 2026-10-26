<?php

namespace App\Services;

use App\Models\AiUsageEvent;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

/**
 * Records the model usage the AI service reports (X-AI-Usage header) against the customer, purpose and subject the
 * current work is for. Jobs and services set the attribution with using(); without it, the signed-in customer of the
 * HTTP request is used and the purpose comes from the AI service endpoint.
 */
final class AiUsage
{
    /** @var array{user_id: ?int, purpose: ?string, subject_type: ?string, subject_id: ?int}|null */
    private static ?array $context = null;

    private const PURPOSE_BY_PATH = [
        '/v1/ai/agent/decide' => 'orbit',
        '/v1/ai/agent/route' => 'orbit',
        '/v1/ai/agent/answer' => 'data_question',
        '/v1/ai/generate' => 'content',
        '/v1/ai/check-novelty' => 'novelty',
        '/v1/ai/propose-automation' => 'planning',
        '/v1/ai/readiness' => 'readiness',
        '/v1/ai/data/plan' => 'data_question',
        '/v1/ai/data/sql' => 'data_question',
        '/v1/ai/generate-image' => 'image',
        '/v1/ai/sample-rows' => 'sample_data',
    ];

    /**
     * Run $work with usage attributed to $userId / $purpose / $subject; the previous attribution is restored after.
     *
     * @template T
     * @param  callable(): T  $work
     * @return T
     */
    public static function using(?int $userId, ?string $purpose, ?Model $subject, callable $work): mixed
    {
        $previous = self::$context;
        self::$context = [
            'user_id' => $userId,
            'purpose' => $purpose,
            'subject_type' => $subject ? class_basename($subject) : null,
            'subject_id' => $subject?->getKey(),
        ];
        try {
            return $work();
        } finally {
            self::$context = $previous;
        }
    }

    /** Attribute the rest of this HTTP request (each request starts with no attribution). */
    public static function attribute(?int $userId, ?string $purpose, ?Model $subject = null): void
    {
        self::$context = [
            'user_id' => $userId,
            'purpose' => $purpose,
            'subject_type' => $subject ? class_basename($subject) : null,
            'subject_id' => $subject?->getKey(),
        ];
    }

    /** Forget any attribution (each queued job starts clean). */
    public static function reset(): void
    {
        self::$context = null;
    }

    public static function purposeFor(string $path): string
    {
        foreach (self::PURPOSE_BY_PATH as $prefix => $purpose) {
            if (str_starts_with($path, $prefix)) {
                return $purpose;
            }
        }
        return 'other';
    }

    /** Store what one AI service response reported. Never throws: usage must not break the work it measures. */
    public static function recordFromHeader(string $path, string $header): void
    {
        if ($header === '') {
            return;
        }
        try {
            $items = json_decode($header, true, 4, JSON_THROW_ON_ERROR);
            if (!is_array($items)) {
                return;
            }
            $ctx = self::$context;
            $requestUser = request()?->user();
            $userId = $ctx['user_id'] ?? ($requestUser instanceof User ? $requestUser->id : null);
            $purpose = $ctx['purpose'] ?? self::purposeFor($path);
            foreach (array_slice($items, 0, 20) as $item) {
                if (!is_array($item)) {
                    continue;
                }
                AiUsageEvent::create([
                    'user_id' => $userId,
                    'purpose' => mb_substr($purpose, 0, 40),
                    'provider' => mb_substr((string) ($item['provider'] ?? 'unknown'), 0, 40),
                    'model' => mb_substr((string) ($item['model'] ?? ''), 0, 120) ?: null,
                    'kind' => mb_substr((string) ($item['kind'] ?? 'chat'), 0, 20),
                    'calls' => max(1, (int) ($item['calls'] ?? 1)),
                    'prompt_tokens' => max(0, (int) ($item['prompt_tokens'] ?? 0)),
                    'completion_tokens' => max(0, (int) ($item['completion_tokens'] ?? 0)),
                    'subject_type' => $ctx['subject_type'] ?? null,
                    'subject_id' => $ctx['subject_id'] ?? null,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('AI usage was not recorded: ' . $e->getMessage());
        }
    }

    /**
     * Totals for a set of events: tokens, calls and a per-model breakdown.
     *
     * @return array{prompt: int, completion: int, total: int, calls: int, models: list<array{provider: string, model: ?string, calls: int, prompt: int, completion: int, total: int}>}
     */
    public static function summarize(\Illuminate\Database\Eloquent\Builder $query): array
    {
        $rows = (clone $query)->selectRaw('provider, model, SUM(calls) AS calls, SUM(prompt_tokens) AS prompt, SUM(completion_tokens) AS completion')
            ->groupBy('provider', 'model')
            ->orderByRaw('SUM(prompt_tokens) + SUM(completion_tokens) DESC')
            ->get();
        $models = $rows->map(fn ($r) => [
            'provider' => (string) $r->provider,
            'model' => $r->model,
            'calls' => (int) $r->calls,
            'prompt' => (int) $r->prompt,
            'completion' => (int) $r->completion,
            'total' => (int) $r->prompt + (int) $r->completion,
        ])->values()->all();
        $prompt = array_sum(array_column($models, 'prompt'));
        $completion = array_sum(array_column($models, 'completion'));
        return [
            'prompt' => $prompt,
            'completion' => $completion,
            'total' => $prompt + $completion,
            'calls' => array_sum(array_column($models, 'calls')),
            'models' => $models,
        ];
    }
}
