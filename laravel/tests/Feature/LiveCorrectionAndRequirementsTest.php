<?php

namespace Tests\Feature;

use App\Models\AgentConversation;
use App\Models\AgentTask;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\Agent\AutomationRequirementsService;
use App\Services\Agent\CorrectionEngine;
use Tests\TestCase;

class LiveCorrectionAndRequirementsTest extends TestCase
{
    protected function createTask(User $user, array $slots = []): AgentTask
    {
        $conv = AgentConversation::create([
            'user_id' => $user->id,
            'title' => 'Test Conversation',
            'status' => 'ACTIVE',
        ]);

        return AgentTask::create([
            'user_id' => $user->id,
            'conversation_id' => $conv->id,
            'task_type' => 'ORBIT_REQUEST',
            'goal' => 'Connect to MySQL database',
            'status' => 'RUNNING',
            'slots' => $slots,
            'plan_version' => 1,
        ]);
    }

    public function test_correction_classifier_detects_slot_patch_and_updates_version(): void
    {
        $user = User::factory()->create();
        $task = $this->createTask($user, [
            'host' => '127.0.0.1',
            'port' => 3306,
            'username' => 'root',
            'database' => 'shopfx',
        ]);

        $engine = app(CorrectionEngine::class);

        // User barges in with correction
        $classification = $engine->classify($task, "sorry, the username is wrong, it's john_admin");

        $this->assertEquals('patch_value', $classification['action']);
        $this->assertEquals('username', $classification['slot_name']);
        $this->assertEquals('john_admin', $classification['new_value']);

        // Apply patch
        $res = $engine->applyPatch($task, $classification['slot_name'], $classification['new_value']);

        $this->assertTrue($res['success']);
        $this->assertEquals(2, $res['version']);

        $task->refresh();
        // Check ONLY username was updated, other slots intact
        $this->assertEquals('john_admin', $task->slots['username']['value']);
        $this->assertEquals(2, $task->slots['username']['version']);
        $this->assertEquals('127.0.0.1', $task->slots['host']);
        $this->assertEquals(3306, $task->slots['port']);
        $this->assertEquals('shopfx', $task->slots['database']);
        $this->assertEquals(2, $task->plan_version);
    }

    public function test_self_correction_within_single_utterance(): void
    {
        $user = User::factory()->create();
        $task = $this->createTask($user);

        $engine = app(CorrectionEngine::class);

        // Self correction utterance
        $classification = $engine->classify($task, "host is db1, no wait, db2");

        $this->assertEquals('patch_value', $classification['action']);
        $this->assertEquals('host', $classification['slot_name']);
        $this->assertEquals('db2', $classification['new_value']);
    }

    public function test_secret_correction_discards_old_secret_and_requests_secure_input(): void
    {
        $user = User::factory()->create();
        $task = $this->createTask($user, ['password' => 'old_secret']);

        $engine = app(CorrectionEngine::class);

        $classification = $engine->classify($task, "the password is wrong");

        $this->assertEquals('patch_value', $classification['action']);
        $this->assertEquals('password', $classification['slot_name']);
        $this->assertEquals('[REQUIRES_SECURE_INPUT]', $classification['new_value']);
    }

    public function test_barge_in_cancellation_and_pause(): void
    {
        $user = User::factory()->create();
        $task = $this->createTask($user);

        $engine = app(CorrectionEngine::class);

        $cancelRes = $engine->classify($task, "stop right now");
        $this->assertEquals('cancel', $cancelRes['action']);

        $pauseRes = $engine->classify($task, "pause");
        $this->assertEquals('pause', $pauseRes['action']);

        $resumeRes = $engine->classify($task, "continue");
        $this->assertEquals('resume', $resumeRes['action']);
    }

    public function test_automation_requirements_card_extracts_and_prevents_silent_guessing(): void
    {
        $user = User::factory()->create(['timezone' => 'Asia/Kolkata']);
        DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Primary Shop DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3317,
            'database_name' => 'shopfx',
            'username' => 'root',
            'encrypted_password' => 'fxroot',
            'ssl_mode' => 'disabled',
            'is_active' => true,
        ]);

        $utterance = "make an automation that publishes a news article every day at 9 AM with an image";
        $card = AutomationRequirementsService::extractRequirements($user, $utterance);

        $this->assertEquals('requirements_card', $card['type']);
        $this->assertFalse($card['ready_to_create']); // Missing required fields, cannot silently guess

        // Schedule was extracted
        $this->assertEquals('provided', $card['fields']['schedule']['status']);
        $this->assertEquals('daily', $card['fields']['schedule']['value']);

        // Image requirement was extracted
        $this->assertEquals('provided', $card['fields']['generate_images']['status']);
        $this->assertTrue($card['fields']['generate_images']['value']);

        // Publish status is NEVER silently guessed
        $this->assertEquals('missing', $card['fields']['publish_status']['status']);

        // Approval policy is NEVER silently guessed
        $this->assertEquals('missing', $card['fields']['approval_required']['status']);

        // Agent generates next question to gather missing detail
        $this->assertNotNull($card['next_question']);
        $this->assertNotEmpty($card['next_question_options']);
    }

    public function test_model_readiness_test_endpoint(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        \Illuminate\Support\Facades\Http::fake([
            '*/v1/ai/health' => \Illuminate\Support\Facades\Http::response(['available' => true, 'latency_ms' => 10, 'models' => ['llama3.2'], 'message' => 'Ready']),
            '*/v1/ai/readiness' => \Illuminate\Support\Facades\Http::response([
                'success' => true, 'model' => 'llama3.2', 'passed' => 3, 'total' => 4, 'score' => 75, 'seconds' => 41.2,
                'checks' => [
                    ['key' => 'json_conformance', 'label' => 'Answers in exact JSON', 'passed' => true, 'details' => 'ok', 'seconds' => 9.1],
                    ['key' => 'tool_calling_safety', 'label' => 'Picks the right action', 'passed' => false, 'details' => "Chose 'answer' instead of pause_automation.", 'seconds' => 11.0],
                    ['key' => 'query_plan_accuracy', 'label' => 'Turns a question into a data query', 'passed' => true, 'details' => 'ok', 'seconds' => 10.0],
                    ['key' => 'slot_correction', 'label' => 'Applies a correction', 'passed' => true, 'details' => 'ok', 'seconds' => 11.1],
                ],
            ]),
        ]);

        $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/model-roles/readiness-test', ['provider' => 'mock'])
            ->assertStatus(422);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/model-roles/readiness-test', [
                'provider' => 'ollama',
                'model_name' => 'llama3.2',
            ]);

        // The score is what the model actually did on the four tasks, not a guess from its name.
        $response->assertStatus(200);
        $this->assertTrue($response->json('success'));
        $this->assertEquals(75, $response->json('overall_score'));
        $this->assertEquals('needs_better_model', $response->json('status'));
        $this->assertFalse($response->json('tests.tool_calling_safety.passed'));
        $this->assertSame("Chose 'answer' instead of pause_automation.", $response->json('tests.tool_calling_safety.details'));
        \Illuminate\Support\Facades\Http::assertSent(fn ($r) => str_ends_with($r->url(), '/v1/ai/readiness') && $r['provider'] === 'ollama' && $r['model'] === 'llama3.2');
    }
}
