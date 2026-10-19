<?php

namespace Tests\Feature;

use App\Models\AgentConversation;
use App\Models\AgentMessage;
use App\Models\AgentSecureInput;
use App\Models\AgentTask;
use App\Models\AgentToolCall;
use App\Models\AgentUiAction;
use App\Models\Automation;
use App\Models\DbConnection;
use App\Models\User;
use App\Models\UserAgentPreference;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Agent\UiActionCoordinator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Orbit observe-act loop. The AI service is faked with scripted decisions so each test
 * controls exactly what the "model" chooses; tools, policy, vault and verification are real
 * (connection tests hit the synthetic demo MySQL on 127.0.0.1:3308).
 */
class AgentAutonomousActionTest extends TestCase
{
    protected User $user1;
    protected User $user2;

    protected const DEMO = ['host' => '127.0.0.1', 'port' => 3308, 'database' => 'demo_blog_cms', 'username' => 'root'];
    protected const DEMO_PASSWORD = 'ipo_root_password';

    protected function setUp(): void
    {
        parent::setUp();
        $this->user1 = User::create(['name' => 'Agent Tester', 'email' => 'agent_' . uniqid() . '@example.com', 'password' => bcrypt('password123')]);
        $this->user2 = User::create(['name' => 'Other Tenant', 'email' => 'other_' . uniqid() . '@example.com', 'password' => bcrypt('password123')]);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    protected function decision(array $decision, array $rag = []): array
    {
        return [
            'success' => true,
            'decision' => array_merge(['speech_text' => ''], $decision),
            'rag' => array_merge(['attempted' => true, 'used' => false, 'count' => 0, 'source_ids' => [], 'chunks' => []], $rag),
            'model_used' => 'qwen2.5:3b',
        ];
    }

    protected function toolCall(string $tool, array $args = []): array
    {
        return $this->decision(['kind' => 'CALL_TOOL', 'tool_call' => ['name' => $tool, 'args' => $args]]);
    }

    /** One scripted model sequence per test; later turns push more decisions onto it. */
    protected $modelSequence = null;

    protected function fakeModel(array ...$responses): void
    {
        if ($this->modelSequence === null) {
            $this->modelSequence = Http::sequence();
            Http::fake(['*/v1/ai/agent/decide' => $this->modelSequence, '*' => Http::response(['success' => true], 200)]);
        }
        foreach ($responses as $r) {
            $this->modelSequence->push($r, 200);
        }
    }

    /** Bodies sent to the AI service's decide endpoint, in order. */
    protected function decideRequests(): array
    {
        return Http::recorded(fn ($req) => str_contains($req->url(), '/v1/ai/agent/decide'))
            ->map(fn ($pair) => $pair[0]->data())->values()->all();
    }

    protected function conversation(?User $user = null): AgentConversation
    {
        return AgentConversation::create(['user_id' => ($user ?? $this->user1)->id, 'title' => 'Orbit']);
    }

    protected function say(AgentConversation $c, string $text, array $extra = [], ?User $as = null)
    {
        return $this->actingAs($as ?? $this->user1)
            ->postJson("/api/agent/conversations/{$c->id}/messages", array_merge(['content' => $text, 'is_voice' => true], $extra));
    }

    protected function savedDemoConnection(User $user, string $name = 'Blog DB'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id, 'name' => $name, 'db_type' => 'mysql',
            'host' => self::DEMO['host'], 'port' => self::DEMO['port'], 'database_name' => self::DEMO['database'],
            'username' => self::DEMO['username'], 'encrypted_password' => self::DEMO_PASSWORD,
            'ssl_mode' => 'prefer', 'status' => 'untested',
        ]);
    }

    protected function assertSecretNowhere(string $secret): void
    {
        $like = '%' . $secret . '%';
        foreach ([
            ['agent_tasks', ['goal', 'active_plan', 'slots', 'page_context', 'last_decision', 'pending_tool_call', 'final_verification']],
            ['agent_messages', ['content', 'tool_calls', 'tool_results', 'meta']],
            ['agent_tool_calls', ['args_redacted', 'result_sanitized']],
            ['agent_ui_actions', ['payload', 'result']],
            ['agent_task_timeline_events', ['message', 'details']],
            ['workspace_events', ['payload']],
        ] as [$table, $cols]) {
            foreach ($cols as $col) {
                $this->assertSame(0, DB::table($table)->where($col, 'like', $like)->count(), "Secret found in {$table}.{$col}");
            }
        }
        foreach ($this->decideRequests() as $body) {
            $this->assertStringNotContainsString($secret, json_encode($body), 'Secret sent to the model');
        }
    }

    // ------------------------------------------------------------------
    // Registry
    // ------------------------------------------------------------------

    public function test_tool_registry_has_zero_destructive_sql_tools()
    {
        foreach (AgentToolRegistry::getToolDefinitions() as $tool) {
            foreach (['drop', 'truncate', 'alter', 'raw_sql', 'sql_console', 'execute_sql'] as $p) {
                $this->assertStringNotContainsString($p, $tool['name']);
            }
        }
        $res = AgentToolRegistry::executeTool($this->user1, 'execute_raw_sql_drop', []);
        $this->assertFalse($res['success']);
    }

    public function test_model_visible_schemas_hide_secrets_and_forbid_extra_args()
    {
        $schemas = collect(AgentToolRegistry::modelVisibleSchemas($this->user1))->keyBy('name');
        $save = $schemas['save_database_connection'];
        $props = (array) $save['parameters']['properties'];
        $this->assertArrayNotHasKey('password', $props);
        $this->assertNotContains('password', $save['parameters']['required']);
        $this->assertFalse($save['parameters']['additionalProperties']);
        $this->assertArrayNotHasKey('api_key', (array) $schemas['save_ai_provider']['parameters']['properties']);
    }

    public function test_user_can_create_conversation_and_query_tools()
    {
        $this->actingAs($this->user1)->getJson('/api/agent/tools')->assertOk()->assertJsonStructure(['tools', 'model_visible']);
        $id = $this->actingAs($this->user1)->postJson('/api/agent/conversations', ['title' => 'T'])->assertStatus(201)->json('conversation.id');
        $this->actingAs($this->user1)->getJson('/api/agent/conversations')->assertJsonFragment(['id' => $id]);
    }

    // ------------------------------------------------------------------
    // The loop
    // ------------------------------------------------------------------

    public function test_greeting_reaches_model_and_generated_answer_is_spoken()
    {
        $this->fakeModel($this->decision(['kind' => 'ANSWER', 'speech_text' => 'Hey! I am Orbit. Want to connect a database?', 'emotion_hint' => 'happy']));
        $c = $this->conversation();

        $res = $this->say($c, 'hello orbit');

        $res->assertStatus(202);
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('ANSWERED', $task->status);
        $reply = AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->first();
        $this->assertSame('Hey! I am Orbit. Want to connect a database?', $reply->content);
        $this->assertSame('model', $reply->meta['source']);
        $this->assertSame('hello orbit', $this->decideRequests()[0]['utterance']);
        $this->assertSame(0, AgentToolCall::where('task_id', $task->id)->count());
    }

    public function test_status_question_with_open_form_checks_status_and_never_asks_for_name()
    {
        $conn = $this->savedDemoConnection($this->user1);
        $this->fakeModel(
            $this->toolCall('list_database_connections'),
            $this->toolCall('test_database_connection', ['connection_id' => $conn->id]),
            $this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Blog DB is connected and responding.', 'emotion_hint' => 'celebrating']),
        );
        $c = $this->conversation();
        $page = [
            'currentPath' => '/connections',
            'activeModal' => 'connection_modal',
            'mountedForms' => ['connection_modal' => ['name' => 'Database Connection Form', 'fields' => [
                'name' => ['name' => 'name', 'value' => ''],
                'host' => ['name' => 'host', 'value' => '127.0.0.1'],
                'port' => ['name' => 'port', 'value' => 3308],
                'password' => ['name' => 'password', 'value' => '••••••••', 'isMasked' => true],
            ]]],
        ];

        $this->say($c, 'can you check my database connection status?', ['page_context' => $page])->assertStatus(202);

        $requests = $this->decideRequests();
        $fields = $requests[0]['runtime_context']['page']['forms']['connection_modal']['fields'];
        $this->assertTrue($fields['host']['supplied']);
        $this->assertSame('127.0.0.1', $fields['host']['value']);
        $this->assertSame(['present' => true, 'secret' => true], $fields['password']);
        $this->assertSame('list_database_connections', $requests[1]['observations'][0]['tool']);
        $this->assertTrue($requests[2]['observations'][1]['result']['success']);

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('SUCCEEDED', $task->status);
        $this->assertSame(['list_database_connections', 'test_database_connection'], AgentToolCall::where('task_id', $task->id)->pluck('tool')->all());
        $this->assertSame('connected', $conn->fresh()->status);
        $this->assertNotNull($conn->fresh()->last_tested_at);
        $this->assertSame(1, AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->count());
        // Backend tools never drive the UI themselves (on-screen work uses the UI tools).
        $this->assertFalse(AgentUiAction::where('task_id', $task->id)->exists());
    }

    public function test_connection_creation_asks_only_for_password_then_tests_saves_and_verifies()
    {
        $c = $this->conversation();
        $details = self::DEMO;

        // Turn 1: all non-secret details given; the model tries, the vault has no password.
        $this->fakeModel(
            $this->toolCall('test_database_connection', $details),
            $this->decision(['kind' => 'WAIT_FOR_USER', 'secure_input_type' => 'database_password',
                'speech_text' => 'Got it. What is the password for root? Please type it in the secure field.',
                'slot_updates' => $details + ['connection_name' => 'Blog DB'], 'response_style' => 'question']),
        );
        $this->say($c, 'connect my mysql database demo_blog_cms on 127.0.0.1 port 3308 as user root, call it Blog DB');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_INPUT', $task->status);
        $this->assertSame('database_password', AgentMessage::where('role', 'assistant')->where('conversation_id', $c->id)->latest('id')->first()->secure_input_type);
        $this->assertSame('SECRET_REQUIRED', $this->decideRequests()[1]['observations'][0]['result']['error_category']);
        $this->assertSame('Blog DB', $task->slots['connection_name']);
        $this->assertSame(0, DbConnection::where('user_id', $this->user1->id)->count());

        // Turn 2: password through the masked field; same task continues.
        $this->fakeModel(
            $this->toolCall('test_database_connection', $details),
            $this->toolCall('save_database_connection', $details + ['name' => 'Blog DB']),
            $this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Blog DB is connected and saved.', 'emotion_hint' => 'celebrating']),
        );
        $this->say($c, 'I entered the password in the secure field.', ['secure_input_data' => ['password' => self::DEMO_PASSWORD]]);

        $task->refresh();
        $this->assertSame('SUCCEEDED', $task->status);
        $conn = DbConnection::where('user_id', $this->user1->id)->where('name', 'Blog DB')->first();
        $this->assertNotNull($conn);
        $this->assertSame('connected', $conn->status);
        $save = AgentToolCall::where('task_id', $task->id)->where('tool', 'save_database_connection')->first();
        $this->assertTrue($save->verified);
        $this->assertSame($conn->id, (int) $task->slots['connection_id']);
        $this->assertFalse(AgentSecureInput::where('task_id', $task->id)->whereNull('consumed_at')->exists(), 'password consumed after save');
        $this->assertSecretNowhere(self::DEMO_PASSWORD);
    }

    public function test_inline_spoken_password_is_redacted_and_vaulted()
    {
        $this->fakeModel($this->decision(['kind' => 'ANSWER', 'speech_text' => 'Thanks, I have it.']));
        $c = $this->conversation();

        $this->say($c, 'the db password is hunter2secret please connect');

        $msg = AgentMessage::where('conversation_id', $c->id)->where('role', 'user')->first();
        $this->assertStringContainsString('[REDACTED]', $msg->content);
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertTrue(AgentSecureInput::where('task_id', $task->id)->where('kind', 'database_password')->exists());
        $this->assertTrue($this->decideRequests()[0]['runtime_context']['credentials_captured']['database_password']);
        $this->assertSecretNowhere('hunter2secret');
    }

    public function test_gate_rejects_unknown_tools_and_unexpected_arguments()
    {
        $this->fakeModel(
            $this->toolCall('list_database_connections', ['sql' => 'DROP TABLE users']),
            $this->toolCall('execute_sql', ['query' => 'DELETE FROM posts']),
            $this->decision(['kind' => 'UNSUPPORTED', 'speech_text' => 'I cannot run SQL.']),
        );
        $c = $this->conversation();
        $this->say($c, 'run this sql for me');

        $reqs = $this->decideRequests();
        $this->assertSame('INVALID_ARGS', $reqs[1]['observations'][0]['result']['error_category']);
        $this->assertSame('UNKNOWN_TOOL', $reqs[2]['observations'][1]['result']['error_category']);
        $this->assertSame(['rejected', 'rejected'], AgentToolCall::pluck('status')->where(fn () => true)->values()->slice(-2)->values()->all());
    }

    public function test_cross_tenant_resource_ids_are_rejected()
    {
        $foreign = $this->savedDemoConnection($this->user2, 'Not yours');
        $this->fakeModel(
            $this->toolCall('test_database_connection', ['connection_id' => $foreign->id]),
            $this->decision(['kind' => 'ANSWER', 'speech_text' => 'I could not find that connection.']),
        );
        $this->say($this->conversation(), 'test connection ' . $foreign->id);

        $this->assertSame('NOT_FOUND', $this->decideRequests()[1]['observations'][0]['result']['error_category']);
        $this->assertNull($foreign->fresh()->last_tested_at);
    }

    public function test_consequential_tool_waits_for_confirmation_then_runs_after_button()
    {
        $conn = $this->savedDemoConnection($this->user1);
        $auto = Automation::create([
            'user_id' => $this->user1->id, 'connection_id' => $conn->id, 'name' => 'Old Auto', 'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE', 'field_mappings' => [], 'schedule_type' => 'DAILY',
            'generation_time' => '08:30', 'publication_time' => '09:00', 'timezone' => 'UTC',
        ]);
        $this->fakeModel(
            $this->toolCall('remove_automation', ['automation_id' => $auto->id]),
            $this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => "Should I remove the automation 'Old Auto'?"]),
        );
        $c = $this->conversation();
        $this->say($c, 'remove the old automation');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_APPROVAL', $task->status);
        $this->assertSame('remove_automation', $task->pending_tool_call['name']);
        $this->assertNotNull(Automation::find($auto->id));

        $this->fakeModel($this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Removed it.']));
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/confirm")->assertStatus(202);

        $this->assertNull(Automation::find($auto->id));
        $this->assertSame('SUCCEEDED', $task->fresh()->status);
        $this->assertSame('USER_CONFIRMED', $task->timelineEvents()->where('step_name', 'USER_CONFIRMED')->value('step_name'));
    }

    public function test_spoken_yes_never_confirms_a_removal_only_the_panel_button_does()
    {
        $conn = $this->savedDemoConnection($this->user1);
        $auto = Automation::create([
            'user_id' => $this->user1->id, 'connection_id' => $conn->id, 'name' => 'Voice Auto', 'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE', 'field_mappings' => [], 'schedule_type' => 'DAILY',
            'generation_time' => '08:30', 'publication_time' => '09:00', 'timezone' => 'UTC',
        ]);
        $c = $this->conversation();
        $this->fakeModel(
            $this->toolCall('remove_automation', ['automation_id' => $auto->id]),
            $this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => 'Remove Voice Auto?']),
        );
        $this->say($c, 'delete voice auto');
        $this->assertNotNull(Automation::find($auto->id));

        // A typed "yes" is read by the model, so it does not count for a removal.
        $this->fakeModel(
            $this->toolCall('remove_automation', ['automation_id' => $auto->id]),
            $this->decision(['kind' => 'ASK_CLARIFICATION', 'speech_text' => 'Please press Confirm in my panel.']),
        );
        $this->say($c, 'yes go ahead');
        $this->assertNotNull(Automation::find($auto->id));
        $obs = $this->decideRequests()[3]['observations'][0]['result'];
        $this->assertSame('CONFIRMATION_REQUIRED', $obs['error_category']);
        $this->assertStringContainsString('Confirm button', $obs['safe_message']);
        $task = AgentTask::where('conversation_id', $c->id)->latest('id')->first();
        $this->assertSame('WAITING_FOR_APPROVAL', $task->status, 'the Confirm button stays available');

        $this->fakeModel($this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Removed it.']));
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/confirm")->assertStatus(202);
        $this->assertNull(Automation::find($auto->id));
    }

    public function test_spoken_yes_confirms_a_non_destructive_step_only_after_orbit_asked()
    {
        $browser = $this->fakeBrowser([['ok', ['success' => true, 'message' => 'Blog is now paused.']]]);
        $conn = $this->savedDemoConnection($this->user1);
        $auto = Automation::create([
            'user_id' => $this->user1->id, 'connection_id' => $conn->id, 'name' => 'Blog', 'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE', 'field_mappings' => [], 'schedule_type' => 'DAILY',
            'generation_time' => '08:30', 'publication_time' => '09:00', 'timezone' => 'UTC',
        ]);
        $press = ['surface' => 'automations.list', 'action' => 'toggle', 'row' => (string) $auto->id];
        $c = $this->conversation();
        $this->fakeModel(
            $this->toolCall('press', $press),
            $this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => 'Pause Blog?']),
        );
        $this->say($c, 'pause the blog automation');
        $this->assertSame([], $browser->requests);

        $this->fakeModel(
            $this->toolCall('press', $press),
            $this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Paused.']),
        );
        $this->say($c, 'yes');
        $this->assertSame('surface.press', $browser->requests[0][0]);
        $this->assertTrue($browser->requests[0][1]['user_confirmed'], 'the page may click its own confirm popup');
    }

    public function test_destructive_press_runs_only_after_the_panel_button_and_carries_the_confirmation()
    {
        $browser = $this->fakeBrowser([['ok', ['success' => true, 'message' => 'Connection profile removed.', 'confirmed_in_popup' => true]]]);
        $conn = $this->savedDemoConnection($this->user1);
        $press = ['surface' => 'connections.list', 'action' => 'remove', 'row' => (string) $conn->id];
        $c = $this->conversation();
        // The model asks in plain words instead of REQUEST_CONFIRMATION: the step stays pending anyway.
        $this->fakeModel(
            $this->toolCall('press', $press),
            $this->decision(['kind' => 'ANSWER', 'speech_text' => 'Do you want me to remove Blog DB?']),
        );
        $this->say($c, 'remove blog db');
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_APPROVAL', $task->status);
        $this->assertSame('press', $task->pending_tool_call['name']);
        $this->assertSame([], $browser->requests);

        $this->fakeModel($this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Removed.']));
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/confirm")->assertStatus(202);
        $this->assertCount(1, $browser->requests);
        $this->assertTrue($browser->requests[0][1]['user_confirmed']);
    }

    public function test_guessed_id_is_refused_with_the_users_real_items_and_no_password_box_appears()
    {
        // Replays a real qwen2.5:3b run: it guessed document id 123, then asked for the id with a password box.
        $doc = \App\Models\KnowledgeDocument::create(['user_id' => $this->user1->id, 'title' => 'Old pricing notes', 'file_path' => 'k/x.md', 'file_type' => 'md', 'status' => 'indexed']);
        \App\Models\KnowledgeDocument::create(['user_id' => $this->user2->id, 'title' => 'Other tenant doc', 'file_path' => 'k/y.md', 'file_type' => 'md', 'status' => 'indexed']);
        $this->fakeModel(
            $this->toolCall('remove_knowledge_document', ['document_id' => 123]),
            $this->decision(['kind' => 'WAIT_FOR_USER', 'secure_input_type' => 'database_password', 'speech_text' => 'Please enter the ID of the document.']),
        );
        $c = $this->conversation();
        $this->say($c, 'remove my document Old pricing notes');

        $reqs = $this->decideRequests();
        $this->assertSame([['id' => $doc->id, 'title' => 'Old pricing notes', 'status' => 'indexed']], $reqs[0]['runtime_context']['knowledge_documents']);
        $refusal = $reqs[1]['observations'][0]['result']['safe_message'];
        $this->assertStringContainsString("#{$doc->id} Old pricing notes", $refusal);
        $this->assertStringNotContainsString('Other tenant doc', $refusal);
        $this->assertNotNull(\App\Models\KnowledgeDocument::find($doc->id));
        $reply = AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->latest('id')->first();
        $this->assertNull($reply->secure_input_type, 'no password box for a question that needs no secret');
    }

    public function test_a_confirmed_step_is_never_run_twice_and_the_model_is_told_it_is_done()
    {
        // Real run: after the confirmed removal succeeded, the model called the same removal again.
        $doc = \App\Models\KnowledgeDocument::create(['user_id' => $this->user1->id, 'title' => 'Old pricing notes', 'file_path' => 'k/x.md', 'file_type' => 'md', 'status' => 'indexed']);
        $call = ['document_id' => $doc->id];
        $this->fakeModel(
            $this->toolCall('remove_knowledge_document', $call),
            $this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => 'Remove Old pricing notes?']),
        );
        $c = $this->conversation();
        $this->say($c, 'remove old pricing notes');
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_APPROVAL', $task->status);
        $this->assertStringEndsWith('press Confirm in my panel.', $task->last_decision['speech_text']);

        $this->fakeModel(
            $this->toolCall('remove_knowledge_document', $call),
            $this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Removed Old pricing notes.']),
        );
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/confirm")->assertStatus(202);

        $this->assertNull(\App\Models\KnowledgeDocument::find($doc->id));
        $obs = $this->decideRequests()[2]['observations'];
        $this->assertStringContainsString('Do not repeat it', $obs[0]['result']['next_step']);
        $this->assertSame('already_done', $this->decideRequests()[3]['observations'][1]['result']['status']);
        $this->assertSame('SUCCEEDED', $task->fresh()->status);
        $this->assertSame(1, AgentToolCall::where('task_id', $task->id)->where('status', 'succeeded')->count());
    }

    public function test_after_a_confirmed_step_a_re_ask_is_replaced_by_the_verified_result()
    {
        // Real qwen2.5:3b run: the removal succeeded, then it asked "Would you like to confirm?" again.
        $doc = \App\Models\KnowledgeDocument::create(['user_id' => $this->user1->id, 'title' => 'Old pricing notes', 'file_path' => 'k/x.md', 'file_type' => 'md', 'status' => 'indexed']);
        $this->fakeModel(
            $this->toolCall('remove_knowledge_document', ['document_id' => $doc->id]),
            $this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => 'Remove Old pricing notes?']),
        );
        $c = $this->conversation();
        $this->say($c, 'remove old pricing notes');
        $task = AgentTask::where('conversation_id', $c->id)->first();

        $this->fakeModel($this->decision(['kind' => 'ASK_CLARIFICATION',
            'speech_text' => "I will remove your knowledge document 'Old pricing notes'. Would you like to confirm?"]));
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/confirm")->assertStatus(202);

        $task->refresh();
        $this->assertSame('SUCCEEDED', $task->status);
        $this->assertStringContainsString('removed', $task->last_decision['speech_text']);
        $this->assertStringNotContainsString('Would you like to confirm', $task->last_decision['speech_text']);
    }

    public function test_asking_for_confirmation_with_nothing_held_is_just_a_question()
    {
        $this->fakeModel($this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => 'Should I remove Old pricing notes?']));
        $c = $this->conversation();
        $this->say($c, 'remove old pricing notes');
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_INPUT', $task->status, 'no Confirm button that would confirm nothing');
        $this->assertNull($task->pending_tool_call);
    }

    public function test_opening_a_page_takes_the_focused_path_and_really_navigates()
    {
        // Real run: "Please open the security page" took 547 s through the full agent prompt.
        $browser = $this->fakeBrowser([['ok', ['success' => true, 'message' => 'Opened Security & Guardrails.', 'page' => '/security']]]);
        Http::fake([
            '*/v1/ai/agent/route' => Http::response(['success' => true, 'kind' => 'open_page', 'question' => '', 'page' => '/security'], 200),
            '*/v1/ai/agent/decide' => Http::response(['success' => true, 'decision' => ['kind' => 'ANSWER', 'speech_text' => 'full loop']], 200),
            '*' => Http::response(['success' => true], 200),
        ]);
        $c = $this->conversation();
        $this->say($c, 'Please open the security page');

        $this->assertSame([['surface.go_to_page', ['page' => '/security']]], array_map(fn ($r) => [$r[0], $r[1]], $browser->requests));
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('Opened Security & Guardrails.', $task->last_decision['speech_text']);
        $this->assertSame(0, Http::recorded(fn ($r) => str_contains($r->url(), '/agent/decide'))->count());
        $route = Http::recorded(fn ($r) => str_contains($r->url(), '/agent/route'))->first()[0]->data();
        $this->assertContains('/security', array_column($route['pages'], 'route'));
    }

    public function test_a_page_the_catalog_does_not_have_is_never_opened_from_the_focused_path()
    {
        $browser = $this->fakeBrowser([]);
        Http::fake([
            '*/v1/ai/agent/route' => Http::response(['success' => true, 'kind' => 'open_page', 'question' => '', 'page' => '/admin/secret'], 200),
            '*/v1/ai/agent/decide' => Http::response(['success' => true, 'decision' => ['kind' => 'ANSWER', 'speech_text' => 'full loop']], 200),
            '*' => Http::response(['success' => true], 200),
        ]);
        $c = $this->conversation();
        $this->say($c, 'open the security page');

        $this->assertSame([], $browser->requests);
        $this->assertSame('full loop', AgentTask::where('conversation_id', $c->id)->first()->last_decision['speech_text']);
    }

    public function test_unconfirmed_and_read_only_presses_never_carry_the_confirmation_flag()
    {
        $browser = $this->fakeBrowser([]);
        $conn = $this->savedDemoConnection($this->user1);
        $this->fakeModel(
            $this->toolCall('press', ['surface' => 'connections.list', 'action' => 'test', 'row' => (string) $conn->id]),
            $this->decision(['kind' => 'ANSWER', 'speech_text' => 'Tested.']),
        );
        $this->say($this->conversation(), 'test blog db');
        $this->assertSame('surface.press', $browser->requests[0][0]);
        $this->assertArrayNotHasKey('user_confirmed', $browser->requests[0][1]);
    }

    public function test_model_unavailable_is_reported_as_a_service_error_without_fallback()
    {
        Http::fake(['*/v1/ai/agent/decide' => Http::response([
            'success' => false, 'error_category' => 'MODEL_UNAVAILABLE',
            'error_message' => "Ollama model 'qwen2.5:3b' is not installed.", 'rag' => ['attempted' => false, 'used' => false],
        ], 200)]);
        $c = $this->conversation();
        $this->say($c, 'connect my database please');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('FAILED', $task->status);
        $reply = AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->first();
        $this->assertTrue($reply->meta['is_service_error']);
        $this->assertSame('system', $reply->meta['source']);
        $this->assertStringContainsString("can't reach my language model", $reply->content);
        $this->assertSame(0, AgentToolCall::where('task_id', $task->id)->count(), 'no keyword fallback executed tools');
    }

    public function test_ai_service_down_fails_honestly()
    {
        Http::fake(['*/v1/ai/agent/decide' => Http::response('boom', 500)]);
        $c = $this->conversation();
        $this->say($c, 'show my connections');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('FAILED', $task->status);
        $this->assertSame('SERVICE_ERROR', $task->last_decision['kind']);
    }

    public function test_repeated_identical_failed_call_stops_the_loop()
    {
        $bad = $this->toolCall('get_automation_details', ['automation_id' => 987654]);
        $conn = $this->savedDemoConnection($this->user1);
        Automation::create([
            'user_id' => $this->user1->id, 'connection_id' => $conn->id, 'name' => 'A', 'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE', 'field_mappings' => [], 'schedule_type' => 'DAILY',
            'generation_time' => '08:30', 'publication_time' => '09:00', 'timezone' => 'UTC',
        ]);
        $this->fakeModel($bad, $bad, $bad, $bad);
        $c = $this->conversation();
        $this->say($c, 'details for automation 987654');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('FAILED', $task->status);
        $this->assertSame('REPEATED_FAILED_CALL', $task->last_decision['error_category']);
        $this->assertSame(1, AgentToolCall::where('task_id', $task->id)->count(), 'duplicate calls are not executed');
    }

    public function test_repeated_successful_call_is_not_re_executed_and_turn_ends_truthfully()
    {
        $this->savedDemoConnection($this->user1);
        $list = $this->toolCall('list_database_connections');
        $this->fakeModel($list, $list, $list);
        $c = $this->conversation();
        $this->say($c, 'what connections do I have?');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame(1, AgentToolCall::where('task_id', $task->id)->count());
        $this->assertSame('already_done', $this->decideRequests()[2]['observations'][1]['result']['status']);
        // Only reads happened: the turn is answered truthfully, not reported as a success.
        $this->assertSame('ANSWERED', $task->status);
        $reply = AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->first();
        $this->assertStringContainsString('database connection', $reply->content);
        $this->assertSame('system', $reply->meta['source']);
    }

    public function test_missing_secret_twice_asks_through_secure_channel()
    {
        $this->fakeModel(
            $this->toolCall('test_database_connection', self::DEMO),
            $this->toolCall('save_database_connection', self::DEMO + ['name' => 'Blog DB']),
        );
        $c = $this->conversation();
        $this->say($c, 'connect demo_blog_cms on 127.0.0.1 port 3308 user root');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_INPUT', $task->status);
        $reply = AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->first();
        $this->assertSame('database_password', $reply->secure_input_type);
        $this->assertSame(0, DbConnection::where('user_id', $this->user1->id)->count());
        $this->assertSame(['rejected', 'rejected'], AgentToolCall::where('task_id', $task->id)->pluck('status')->all());
        // Headless: no press_* action was even attempted while the password was missing.
        $this->assertFalse(AgentUiAction::where('task_id', $task->id)->where('action', 'like', 'connections.press_%')->exists());
    }

    public function test_complete_without_verified_result_is_not_reported_as_success()
    {
        $this->fakeModel($this->decision(['kind' => 'COMPLETE', 'speech_text' => 'All done!', 'emotion_hint' => 'celebrating']));
        $c = $this->conversation();
        $this->say($c, 'connect my database');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('ANSWERED', $task->status);
        $this->assertSame('happy', $task->last_decision['emotion_hint']);
    }

    public function test_unresponsive_browser_times_out_honestly_and_the_loop_continues()
    {
        config(['orbit.ui_ack_timeout_cap_seconds' => 1]);
        UiActionCoordinator::heartbeat($this->user1->id);
        $conn = $this->savedDemoConnection($this->user1);
        $this->fakeModel(
            $this->toolCall('go_to_page', ['page' => '/connections']),
            $this->toolCall('test_database_connection', ['connection_id' => $conn->id]),
            $this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Connected.']),
        );
        $c = $this->conversation();
        $this->say($c, 'is blog db up?');

        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('UI_TIMEOUT', $this->decideRequests()[1]['observations'][0]['result']['error_category']);
        $this->assertSame('timeout', AgentUiAction::where('task_id', $task->id)->orderBy('id')->value('status'));
        $this->assertSame('SUCCEEDED', $task->status);
        $this->assertSame('connected', $conn->fresh()->status);
    }

    // ------------------------------------------------------------------
    // Interruption, supersede, ownership
    // ------------------------------------------------------------------

    public function test_utterance_during_running_turn_supersedes_plan_without_new_job()
    {
        Queue::fake();
        $c = $this->conversation();
        $task = AgentTask::create([
            'user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'x',
            'status' => 'RUNNING', 'plan_version' => 1, 'current_turn_id' => 'turn-1',
        ]);

        $this->say($c, 'actually use the Reviews category instead')->assertStatus(202);

        $task->refresh();
        $this->assertTrue($task->pending_user_turn);
        $this->assertSame(2, $task->plan_version);
        Queue::assertNothingPushed();
    }

    public function test_stop_button_cancels_waiting_task_and_requests_stop_for_running_task()
    {
        $c = $this->conversation();
        $waiting = AgentTask::create(['user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'x', 'status' => 'WAITING_FOR_INPUT']);
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$waiting->id}/interrupt", ['action' => 'STOP'])
            ->assertOk()->assertJsonPath('task.status', 'CANCELLED');

        $running = AgentTask::create(['user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'y', 'status' => 'RUNNING']);
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$running->id}/interrupt", ['action' => 'STOP'])
            ->assertOk()->assertJsonPath('task.status', 'INTERRUPT_REQUESTED');
    }

    public function test_ui_ack_is_owner_scoped()
    {
        $c = $this->conversation();
        $task = AgentTask::create(['user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'x', 'status' => 'RUNNING']);
        $ui = AgentUiAction::create(['task_id' => $task->id, 'user_id' => $this->user1->id, 'correlation_id' => 'corr-' . uniqid(),
            'action' => 'navigation.navigate', 'payload' => ['route' => '/connections'], 'status' => 'requested']);

        $this->actingAs($this->user2)->postJson("/api/agent/ui-actions/{$ui->correlation_id}/ack", ['status' => 'ok'])->assertStatus(404);
        $this->actingAs($this->user1)->postJson("/api/agent/ui-actions/{$ui->correlation_id}/ack", ['status' => 'ok'])->assertOk();
        $this->assertSame('ok', $ui->fresh()->status);
    }

    public function test_queued_turn_reports_real_position_and_worker_liveness()
    {
        config(['queue.default' => 'database']);
        \Illuminate\Support\Facades\Cache::forget('orbit-agent-worker-heartbeat');
        DB::table('jobs')->where('queue', 'agent')->delete();
        $c = $this->conversation();
        $task = AgentTask::create(['user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST',
            'goal' => 'x', 'status' => 'QUEUED', 'current_turn_id' => 'turn-mine-123']);
        $job = fn (string $turn, $reserved = null) => DB::table('jobs')->insert([
            'queue' => 'agent', 'payload' => json_encode(['data' => ['command' => "turnId {$turn}"]]), 'attempts' => 0,
            'reserved_at' => $reserved, 'available_at' => time(), 'created_at' => time(),
        ]);
        $job('turn-other-1', time());   // another turn currently running
        $job('turn-mine-123');

        $status = \App\Services\Agent\AgentQueueStatus::forTask($task);
        $this->assertSame(1, $status['ahead']);
        $this->assertSame(2, $status['position']);
        $this->assertTrue($status['worker_alive'], 'a reserved job proves a worker is running');

        DB::table('jobs')->where('queue', 'agent')->whereNotNull('reserved_at')->delete();
        $status = \App\Services\Agent\AgentQueueStatus::forTask($task);
        $this->assertSame(0, $status['ahead']);
        $this->assertFalse($status['worker_alive'], 'no heartbeat and nothing running: report it instead of "starting shortly"');

        \App\Services\Agent\AgentQueueStatus::workerHeartbeat();
        $this->assertTrue(\App\Services\Agent\AgentQueueStatus::forTask($task)['worker_alive']);
        DB::table('jobs')->where('queue', 'agent')->delete();
    }

    // ------------------------------------------------------------------
    // On-screen operation (generic surfaces)
    // ------------------------------------------------------------------

    /** A fake browser: records requested UI actions and answers with scripted acknowledgements. */
    protected function fakeBrowser(array $answers): object
    {
        UiActionCoordinator::heartbeat($this->user1->id);
        $fake = new class($answers) extends UiActionCoordinator {
            public array $requests = [];
            public function __construct(public array $answers) {}
            public function request(\App\Models\AgentTask $task, string $action, array $payload, int $timeoutSeconds): array
            {
                $this->requests[] = [$action, $payload];
                return array_shift($this->answers) ?? ['ok', ['success' => true]];
            }
        };
        $this->app->instance(UiActionCoordinator::class, $fake);

        return $fake;
    }

    public function test_ui_tools_are_unavailable_without_a_browser()
    {
        \Illuminate\Support\Facades\Cache::forget("orbit-client:{$this->user1->id}");
        $this->fakeModel(
            $this->toolCall('open_form', ['surface' => 'connections.form']),
            $this->decision(['kind' => 'ANSWER', 'speech_text' => 'Please open the portal so I can show you.']),
        );
        $this->say($this->conversation(), 'connect a database for me');

        $this->assertSame('UNAVAILABLE', $this->decideRequests()[1]['observations'][0]['result']['error_category']);
        $this->assertFalse($this->decideRequests()[0]['runtime_context']['browser_present']);
    }

    public function test_orbit_fills_the_real_form_and_asks_the_user_to_type_the_password()
    {
        $browser = $this->fakeBrowser([
            ['ok', ['success' => true, 'message' => 'Connect database form is open.', 'missing_required' => ['Connection display name', 'Password']]],
            ['ok', ['success' => true, 'results' => ['host' => ['ok' => true]], 'missing_required' => ['Password']]],
            ['ok', ['success' => true, 'message' => 'Waiting for the user to type the Password in the form.']],
        ]);
        $this->fakeModel(
            $this->toolCall('open_form', ['surface' => 'connections.form']),
            $this->toolCall('fill_fields', ['surface' => 'connections.form', 'values' => ['name' => 'Blog DB', 'host' => '127.0.0.1', 'port' => 3308, 'database_name' => 'demo_blog_cms', 'username' => 'root']]),
            $this->toolCall('ask_secret_in_form', ['surface' => 'connections.form', 'field' => 'password']),
            $this->decision(['kind' => 'WAIT_FOR_USER', 'secure_input_type' => 'database_password', 'speech_text' => 'Please type the password in the form.']),
        );
        $c = $this->conversation();
        $this->say($c, 'connect my blog database on 127.0.0.1 port 3308, database demo_blog_cms, user root, call it Blog DB');

        $this->assertSame(['surface.open_form', 'surface.fill_fields', 'surface.ask_secret_in_form'], array_column($browser->requests, 0));
        $task = AgentTask::where('conversation_id', $c->id)->first();
        $this->assertSame('WAITING_FOR_INPUT', $task->status);
        // The user types the password in the real form; no second secure card in Orbit's panel.
        $this->assertNull(AgentMessage::where('conversation_id', $c->id)->where('role', 'assistant')->latest('id')->first()->secure_input_type);
        $this->assertStringContainsString('Fill name, host, port, database_name, username', $task->timelineEvents()->pluck('step_name')->implode('|'));
    }

    public function test_catalog_blocks_secret_fill_unknown_surfaces_and_unconfirmed_consequential_presses()
    {
        $browser = $this->fakeBrowser([]);
        $this->fakeModel(
            $this->toolCall('fill_fields', ['surface' => 'connections.form', 'values' => ['password' => 'x']]),
            $this->toolCall('press', ['surface' => 'connections.list', 'action' => 'remove', 'row' => '1']),
            $this->toolCall('press', ['surface' => 'connections.list', 'action' => 'launch_missiles', 'row' => '1']),
            $this->decision(['kind' => 'REQUEST_CONFIRMATION', 'speech_text' => 'Remove that connection?']),
        );
        $this->say($this->conversation(), 'remove my connection');

        $reqs = $this->decideRequests();
        $this->assertSame('INVALID_ARGS', $reqs[1]['observations'][0]['result']['error_category']);
        $this->assertSame('CONFIRMATION_REQUIRED', $reqs[2]['observations'][1]['result']['error_category']);
        $this->assertSame('INVALID_ARGS', $reqs[3]['observations'][2]['result']['error_category']);
        $this->assertSame([], $browser->requests, 'nothing reached the browser');
    }

    public function test_pressed_save_is_verified_on_the_server()
    {
        $mine = $this->savedDemoConnection($this->user1, 'Created by page');
        $foreign = $this->savedDemoConnection($this->user2, 'Not mine');
        $this->fakeBrowser([
            ['ok', ['success' => true, 'message' => 'Saved.', 'resource' => ['type' => 'DbConnection', 'id' => $foreign->id]]],
            ['ok', ['success' => true, 'message' => 'Saved.', 'resource' => ['type' => 'DbConnection', 'id' => $mine->id]]],
        ]);
        $this->fakeModel(
            $this->toolCall('press', ['surface' => 'connections.form', 'action' => 'save']),
            $this->toolCall('press', ['surface' => 'connections.form', 'action' => 'save', 'row' => '']),
            $this->decision(['kind' => 'COMPLETE', 'speech_text' => 'Saved and verified.']),
        );
        $c = $this->conversation();
        $this->say($c, 'save it');

        $obs = $this->decideRequests()[2]['observations'];
        $this->assertSame('VERIFICATION_FAILED', $obs[0]['result']['error_category'], "another user's id is never accepted");
        $this->assertTrue($obs[1]['result']['verified']);
        $this->assertSame('SUCCEEDED', AgentTask::where('conversation_id', $c->id)->first()->status);
    }

    public function test_continue_after_secret_is_owner_scoped_and_never_takes_values()
    {
        Queue::fake();
        $c = $this->conversation();
        $task = AgentTask::create(['user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'x', 'status' => 'WAITING_FOR_INPUT']);

        $this->actingAs($this->user2)->postJson("/api/agent/tasks/{$task->id}/continue", ['surface' => 'connections.form', 'field' => 'password'])->assertStatus(404);
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/continue", ['surface' => 'connections.form', 'field' => 'password', 'value' => 'leak'])->assertStatus(422);
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/continue", ['surface' => 'connections.form', 'field' => 'host'])->assertStatus(422);
        $this->actingAs($this->user1)->postJson("/api/agent/tasks/{$task->id}/continue", ['surface' => 'connections.form', 'field' => 'password'])->assertStatus(202);

        $note = AgentMessage::where('conversation_id', $c->id)->where('role', 'user')->latest('id')->first();
        $this->assertStringContainsString('typed the Password', $note->content);
        Queue::assertPushed(\App\Jobs\RunAgentTurnJob::class);
    }

    public function test_surface_catalog_endpoint_lists_pages_and_surfaces()
    {
        $res = $this->actingAs($this->user1)->getJson('/api/agent/surfaces')->assertOk();
        $this->assertContains('/connections', array_column($res->json('pages'), 'route'));
        $this->assertContains('connections.form', array_column($res->json('surfaces'), 'id'));
    }

    public function test_conversation_memory_carries_facts_and_history_skips_service_notices()
    {
        $c = $this->conversation();
        $this->fakeModel($this->decision(['kind' => 'ASK_CLARIFICATION', 'speech_text' => 'Which host?',
            'slot_updates' => ['connection_name' => 'Blog DB', 'database' => 'demo_blog_cms']]));
        $this->say($c, 'connect my database called Blog DB, database demo_blog_cms');
        AgentTask::where('conversation_id', $c->id)->update(['status' => 'ANSWERED']); // that task is finished

        AgentMessage::create(['conversation_id' => $c->id, 'role' => 'assistant', 'content' => "I can't reach my language model right now.",
            'meta' => ['source' => 'system', 'decision_kind' => 'SERVICE_ERROR'], 'created_at' => now()]);

        $this->fakeModel($this->decision(['kind' => 'ANSWER', 'speech_text' => 'Sure.']));
        $this->say($c, 'what was the name again?');

        $last = $this->decideRequests()[count($this->decideRequests()) - 1];
        $this->assertSame('Blog DB', $last['runtime_context']['conversation_memory']['connection_name']);
        $this->assertSame('Blog DB', $last['slots']['connection_name'], 'new task starts from conversation memory');
        $history = json_encode($last['conversation_summary']);
        $this->assertStringContainsString('Which host?', $history);
        $this->assertStringNotContainsString("can't reach my language model", $history);
    }

    public function test_tenant_isolation_and_idor_prevention()
    {
        $c = $this->conversation($this->user1);
        $task = AgentTask::create(['user_id' => $this->user1->id, 'conversation_id' => $c->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'x', 'status' => 'WAITING_FOR_INPUT']);

        $this->actingAs($this->user2)->getJson("/api/agent/conversations/{$c->id}")->assertStatus(404);
        $this->actingAs($this->user2)->postJson("/api/agent/conversations/{$c->id}/messages", ['content' => 'hi'])->assertStatus(404);
        $this->actingAs($this->user2)->postJson("/api/agent/tasks/{$task->id}/interrupt", ['action' => 'STOP'])->assertStatus(404);
        $this->actingAs($this->user2)->postJson("/api/agent/tasks/{$task->id}/confirm")->assertStatus(404);
    }
}
