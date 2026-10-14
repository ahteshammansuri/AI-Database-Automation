<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\DbConnection;
use App\Models\AgentConversation;
use App\Models\AgentTask;
use App\Models\UserAgentPreference;
use App\Services\Agent\AgentToolRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;

class AgentAutonomousActionTest extends TestCase
{
    protected User $user1;
    protected User $user2;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user1 = User::create([
            'name' => 'Agent Master Tester',
            'email' => 'agent_user_' . uniqid() . '@example.com',
            'password' => bcrypt('password123'),
        ]);

        $this->user2 = User::create([
            'name' => 'Unauthorized Competitor',
            'email' => 'hacker_' . uniqid() . '@example.com',
            'password' => bcrypt('password123'),
        ]);
    }

    public function test_tool_registry_has_zero_destructive_sql_tools()
    {
        $tools = AgentToolRegistry::getToolDefinitions();
        $this->assertNotEmpty($tools);

        $prohibited = ['drop', 'truncate', 'alter', 'create_table', 'execute_raw_sql', 'sql_console', 'delete_record', 'delete_table', 'delete_rows'];
        foreach ($tools as $tool) {
            $name = strtolower($tool['name']);
            foreach ($prohibited as $p) {
                $this->assertStringNotContainsString($p, $name, "Prohibited keyword '{$p}' found in tool '{$name}'");
            }
            if (str_contains($name, 'delete')) {
                // Ensure delete only applies to platform configuration records, never customer data
                $this->assertTrue(
                    in_array($name, ['delete_database_connection', 'delete_automation', 'delete_knowledge_document']),
                    "Tool '{$name}' contains 'delete' but is not an authorized platform record deletion."
                );
            }
        }

        // Test safety interceptor rejects arbitrary destructive tool execution
        $res = AgentToolRegistry::executeTool($this->user1, 'drop_table_users', ['table' => 'users']);
        $this->assertFalse($res['success']);
        $this->assertStringContainsString('violates database safety guardrails', $res['error']);
    }

    public function test_user_can_create_conversation_and_query_tools()
    {
        $response = $this->actingAs($this->user1)
            ->getJson('/api/agent/tools');

        $response->assertStatus(200)
            ->assertJsonStructure(['tools']);

        $convoRes = $this->actingAs($this->user1)
            ->postJson('/api/agent/conversations', ['title' => 'Test Consultation']);

        $convoRes->assertStatus(201)
            ->assertJsonPath('conversation.title', 'Test Consultation');

        $convoId = $convoRes->json('conversation.id');

        $listRes = $this->actingAs($this->user1)
            ->getJson('/api/agent/conversations');

        $listRes->assertStatus(200)
            ->assertJsonFragment(['id' => $convoId]);
    }

    public function test_database_connection_request_prompts_for_masked_credentials()
    {
        $convo = AgentConversation::create([
            'user_id' => $this->user1->id,
            'title' => 'Connect DB',
        ]);

        $response = $this->actingAs($this->user1)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", [
                'content' => 'I want to add a MySQL database connection',
            ]);

        $response->assertStatus(200);
        $this->assertEquals('WAITING_FOR_INPUT', $response->json('task.status'));
        $this->assertEquals('database_credentials', $response->json('message.secure_input_type'));
        $this->assertStringContainsString('connection credentials', strtolower($response->json('message.content')));
    }

    public function test_supplying_secure_credentials_executes_connection_and_schema_scan()
    {
        $convo = AgentConversation::create([
            'user_id' => $this->user1->id,
            'title' => 'Connect DB',
        ]);

        // First message creates WAITING_FOR_INPUT task
        $this->actingAs($this->user1)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", [
                'content' => 'Add database connection',
            ]);

        // User supplies masked credentials (targeting local test MySQL)
        $resumeResponse = $this->actingAs($this->user1)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", [
                'content' => 'Here are my database details',
                'secure_input_data' => [
                    'name' => 'Demo Content MySQL',
                    'host' => '127.0.0.1',
                    'port' => 3308,
                    'database' => 'demo_blog_cms',
                    'username' => 'root',
                    'password' => 'ipo_root_password',
                    'ssl_mode' => 'prefer',
                ],
            ]);

        $resumeResponse->assertStatus(200);
        // Under default CONFIRM_CONSEQUENTIAL_CHANGES, pauses before saving connection
        $this->assertEquals('WAITING_FOR_APPROVAL', $resumeResponse->json('task.status'));
        $taskId = $resumeResponse->json('task.id');

        // User confirms the consequential connection creation
        $confirmResponse = $this->actingAs($this->user1)
            ->postJson("/api/agent/tasks/{$taskId}/confirm");

        $confirmResponse->assertStatus(200);
        $this->assertEquals('SUCCEEDED', $confirmResponse->json('task.status'));

        // Verify DbConnection record was created in database
        $this->assertDatabaseHas('db_connections', [
            'user_id' => $this->user1->id,
            'name' => 'Demo Content MySQL',
            'database_name' => 'demo_blog_cms',
        ]);
    }

    public function test_automation_creation_and_mid_task_correction()
    {
        // Set user preference to AUTOMATIC_WITHIN_PERMISSIONS for this test
        UserAgentPreference::create([
            'user_id' => $this->user1->id,
            'autonomy_level' => 'AUTOMATIC_WITHIN_PERMISSIONS',
            'voice_enabled' => true,
        ]);

        // Setup saved connection
        $conn = DbConnection::create([
            'user_id' => $this->user1->id,
            'name' => 'Blog DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'status' => 'CONNECTED',
        ]);

        $convo = AgentConversation::create([
            'user_id' => $this->user1->id,
            'title' => 'Blog Automation',
        ]);

        // Request daily blog automation
        $res = $this->actingAs($this->user1)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", [
                'content' => 'Create a daily blog automation about electric cars with category Cars',
            ]);

        $res->assertStatus(200);
        $taskId = $res->json('task.id');
        $this->assertNotNull($taskId);

        // Test mid-task correction: "Stop, don't use Cars category. Use Reviews instead"
        $correctRes = $this->actingAs($this->user1)
            ->postJson("/api/agent/tasks/{$taskId}/correct", [
                'correction' => 'Stop, don\'t use Cars. Use Reviews category instead',
            ]);

        $correctRes->assertStatus(200);
        $this->assertEquals('SUCCEEDED', $correctRes->json('task.status'));

        // Verify automation created with revised category
        $this->assertDatabaseHas('automations', [
            'user_id' => $this->user1->id,
            'target_table' => 'posts',
        ]);
        $auto = \App\Models\Automation::where('user_id', $this->user1->id)->latest('id')->first();
        $this->assertStringContainsString('Reviews', $auto->prompt_context);
    }


    public function test_instant_stop_interrupt()
    {
        $convo = AgentConversation::create([
            'user_id' => $this->user1->id,
            'title' => 'Long Task',
        ]);

        $task = AgentTask::create([
            'user_id' => $this->user1->id,
            'conversation_id' => $convo->id,
            'task_type' => 'GENERAL',
            'goal' => 'Long running task',
            'status' => 'RUNNING',
            'active_plan' => [
                ['tool' => 'get_dashboard_summary', 'label' => 'Step 1'],
                ['tool' => 'get_provider_health', 'label' => 'Step 2'],
            ],
            'current_step_index' => 0,
        ]);

        $stopRes = $this->actingAs($this->user1)
            ->postJson("/api/agent/tasks/{$task->id}/interrupt", ['action' => 'STOP']);

        $stopRes->assertStatus(200);
        $this->assertEquals('INTERRUPT_REQUESTED', $stopRes->json('task.status'));
        $this->assertNotNull($stopRes->json('task.cancelled_at'));
    }

    public function test_tenant_isolation_and_idor_prevention()
    {
        $convo = AgentConversation::create([
            'user_id' => $this->user1->id,
            'title' => 'Private Convo User 1',
        ]);

        $task = AgentTask::create([
            'user_id' => $this->user1->id,
            'conversation_id' => $convo->id,
            'task_type' => 'GENERAL',
            'goal' => 'User 1 secret goal',
            'status' => 'RUNNING',
        ]);

        // User 2 attempts to read User 1 conversation -> 404
        $this->actingAs($this->user2)
            ->getJson("/api/agent/conversations/{$convo->id}")
            ->assertStatus(404);

        // User 2 attempts to post message to User 1 conversation -> 404
        $this->actingAs($this->user2)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", ['content' => 'Hacked'])
            ->assertStatus(404);

        // User 2 attempts to interrupt User 1 task -> 404
        $this->actingAs($this->user2)
            ->postJson("/api/agent/tasks/{$task->id}/interrupt", ['action' => 'STOP'])
            ->assertStatus(404);

        // User 2 attempts to correct User 1 task -> 404
        $this->actingAs($this->user2)
            ->postJson("/api/agent/tasks/{$task->id}/correct", ['correction' => 'Malicious plan'])
            ->assertStatus(404);
    }

    public function test_end_to_end_connection_slot_preservation_and_autonomous_execution()
    {
        UserAgentPreference::create([
            'user_id' => $this->user1->id,
            'autonomy_level' => 'AUTOMATIC_WITHIN_PERMISSIONS',
            'voice_enabled' => true,
        ]);

        $convo = AgentConversation::create([
            'user_id' => $this->user1->id,
            'title' => 'Voice Connection Setup',
        ]);

        // Turn 1: User speaks natural language with multiple slots
        $res1 = $this->actingAs($this->user1)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", [
                'content' => 'Please connect my MySQL database on host 127.0.0.1 port 3308 database demo_blog_cms user root with name Production DB',
                'is_voice' => true,
            ]);

        $res1->assertStatus(200);
        $task = AgentTask::find($res1->json('task.id'));
        $this->assertNotNull($task);

        // Assert slots were preserved without erasure
        $this->assertEquals('127.0.0.1', $task->slots['host'] ?? null);
        $this->assertEquals(3308, $task->slots['port'] ?? null);
        $this->assertEquals('demo_blog_cms', $task->slots['database'] ?? null);
        $this->assertEquals('root', $task->slots['username'] ?? null);

        // Turn 2: User provides isolated password via secure capture
        $res2 = $this->actingAs($this->user1)
            ->postJson("/api/agent/conversations/{$convo->id}/messages", [
                'content' => 'Provided password securely',
                'secure_input_data' => [
                    'host' => '127.0.0.1',
                    'port' => 3308,
                    'database' => 'demo_blog_cms',
                    'username' => 'root',
                    'password' => 'ipo_root_password',
                    'name' => 'Production DB',
                ],
            ]);

        $res2->assertStatus(200);
        $this->assertEquals('SUCCEEDED', $res2->json('task.status'));

        // Assert connection was verified and persisted
        $this->assertDatabaseHas('db_connections', [
            'user_id' => $this->user1->id,
            'name' => 'Production DB',
            'database_name' => 'demo_blog_cms',
        ]);

        // Assert spoken completion synthesis is returned
        $lastMsg = $res2->json('message.content');
        $this->assertNotEmpty($lastMsg);
    }
}
