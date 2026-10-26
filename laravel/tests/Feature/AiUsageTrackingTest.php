<?php

namespace Tests\Feature;

use App\Models\AgentTask;
use App\Models\AiUsageEvent;
use App\Models\User;
use App\Services\AiServiceClient;
use App\Services\AiUsage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The AI service reports the tokens each request used (X-AI-Usage header); Laravel stores them per customer, purpose
 * and subject so customers and admins can see what was used. No prompts or outputs are stored.
 */
class AiUsageTrackingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Start from a clean slate: no attribution left over and no rows from tests that write outside transactions.
        AiUsage::reset();
        AiUsageEvent::query()->delete();
    }

    private function fakeAi(array $usage): void
    {
        Http::fake([
            '*/v1/ai/propose-automation' => Http::response(['success' => true, 'plan' => ['name' => 'x']], 200, ['X-AI-Usage' => json_encode($usage)]),
            '*/v1/ai/health' => Http::response(['available' => true, 'models' => []]),
        ]);
    }

    public function test_usage_is_stored_for_the_attributed_customer_purpose_and_subject()
    {
        $user = User::factory()->create();
        $task = AgentTask::create(['user_id' => $user->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'Plan my automation', 'status' => 'RUNNING']);
        $this->fakeAi([
            ['provider' => 'ollama', 'model' => 'qwen2.5:3b', 'kind' => 'chat', 'calls' => 2, 'prompt_tokens' => 900, 'completion_tokens' => 140],
            ['provider' => 'openai', 'model' => 'gpt-4o-mini', 'kind' => 'chat', 'calls' => 1, 'prompt_tokens' => 300, 'completion_tokens' => 60],
        ]);

        AiUsage::using($user->id, 'orbit', $task, fn () => app(AiServiceClient::class)->proposeAutomation('Weekly posts', []));

        $this->assertSame(2, AiUsageEvent::count());
        $local = AiUsageEvent::where('provider', 'ollama')->firstOrFail();
        $this->assertSame([$user->id, 'orbit', 'qwen2.5:3b', 2, 900, 140, 'AgentTask', $task->id],
            [$local->user_id, $local->purpose, $local->model, $local->calls, $local->prompt_tokens, $local->completion_tokens, $local->subject_type, (int) $local->subject_id]);

        $sum = AiUsage::summarize(AiUsageEvent::query()->where('user_id', $user->id));
        $this->assertSame(1400, $sum['total']);
        $this->assertSame(3, $sum['calls']);
        $this->assertSame('qwen2.5:3b', $sum['models'][0]['model']);
    }

    public function test_without_attribution_the_purpose_comes_from_the_endpoint_and_nothing_leaks_between_jobs()
    {
        $this->fakeAi([['provider' => 'ollama', 'model' => 'qwen2.5:3b', 'calls' => 1, 'prompt_tokens' => 50, 'completion_tokens' => 10]]);

        AiUsage::using(42, 'content', null, fn () => null); // restored afterwards
        app(AiServiceClient::class)->proposeAutomation('Weekly posts', []);

        $event = AiUsageEvent::firstOrFail();
        $this->assertNull($event->user_id);
        $this->assertSame('planning', $event->purpose);
    }

    public function test_responses_without_usage_and_malformed_headers_store_nothing()
    {
        Http::fake(['*/v1/ai/health' => Http::response(['available' => true, 'models' => []], 200, ['X-AI-Usage' => 'not json'])]);
        app(AiServiceClient::class)->checkHealth('ollama');
        $this->assertSame(0, AiUsageEvent::count());
    }
}
