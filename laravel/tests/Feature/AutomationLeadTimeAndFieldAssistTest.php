<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\UsesAutomationFixtureDatabase;
use Tests\TestCase;

class AutomationLeadTimeAndFieldAssistTest extends TestCase
{
    use RefreshDatabase, UsesAutomationFixtureDatabase;

    protected function tearDown(): void
    {
        $this->dropFixtureBlogDatabase();
        parent::tearDown();
    }

    public function test_automation_creation_enforces_minimum_15_minute_lead_time()
    {
        $user = User::factory()->create();
        $connection = $this->fixtureConnection($user, $this->createFixtureBlogDatabase());

        // 10-minute gap (08:50 -> 09:00) is below the 15-minute minimum
        $invalidPayload = [
            'name' => 'Tight Schedule Pipeline',
            'connection_id' => $connection->id,
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'schedule_type' => 'DAILY',
            'generation_time' => '08:50',
            'publication_time' => '09:00',
            'timezone' => 'UTC',
            'field_mappings' => [
                ['field_name' => 'title', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'slug', 'mapping_type' => 'DERIVED_SLUG', 'source_field' => 'title'],
                ['field_name' => 'content', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'category_id', 'mapping_type' => 'RELATIONAL_LOOKUP', 'fixed_value' => 1],
            ],
        ];

        $response = $this->actingAs($user)->postJson('/api/automations', $invalidPayload);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['publication_time']);

        // Exactly 15 minutes is allowed (08:45 -> 09:00)
        $validPayload = array_merge($invalidPayload, [
            'name' => 'Safe Schedule Pipeline',
            'generation_time' => '08:45',
            'publication_time' => '09:00',
        ]);

        $responseValid = $this->actingAs($user)->postJson('/api/automations', $validPayload);
        $responseValid->assertStatus(201);
        $this->assertDatabaseHas('automations', [
            'user_id' => $user->id,
            'name' => 'Safe Schedule Pipeline',
            'generation_time' => '08:45',
            'publication_time' => '09:00',
        ]);
    }

    public function test_future_scheduled_manual_publish_holds_in_approved_state()
    {
        $user = User::factory()->create();
        $connection = $this->fixtureConnection($user, $this->createFixtureBlogDatabase());

        $response = $this->actingAs($user)->postJson('/api/automations/manual-publish', [
            'connection_id' => $connection->id,
            'target_table' => 'posts',
            'payload' => [
                'title' => 'Future Scheduled Article',
                'slug' => 'future-scheduled-article',
                'content' => 'Sample body awaiting schedule window',
                'category_id' => 1,
            ],
            'publish_now' => false,
            'scheduled_at' => now()->addHours(2)->toIso8601String(),
        ]);

        $response->assertStatus(202);
        $response->assertJsonStructure([
            'message',
            'execution' => ['id', 'status', 'publication_time'],
        ]);

        $this->assertDatabaseHas('automation_executions', [
            'user_id' => $user->id,
            'status' => 'APPROVED',
        ]);
        // Nothing is written until the scheduled time
        $this->assertSame(0, $this->fixtureCount('posts', 'slug = ?', ['future-scheduled-article']));
    }

    public function test_inline_ai_field_assist_endpoint()
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/automations/field-assist', [
            'field_name' => 'meta_description',
            'action' => 'improve',
            'current_value' => 'overview of db replication',
            'topic' => 'High Availability MySQL Clustering',
            'target_table' => 'posts',
            'provider' => 'mock',
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'field_name' => 'meta_description',
            'action' => 'improve',
        ]);
        $this->assertNotEmpty($response->json('suggested_value'));
    }

    public function test_knowledge_semantic_query_endpoint()
    {
        \Illuminate\Support\Facades\Http::fake([
            '*/v1/rag/query' => \Illuminate\Support\Facades\Http::response([
                'success' => true,
                'query_text' => 'database sharding and partition prune',
                'count' => 1,
                'chunks' => [
                    [
                        'chunk_id' => 'chunk_1',
                        'document_id' => null,
                        'text' => 'Sample retrieved text',
                        'score' => 0.95,
                    ]
                ]
            ], 200),
        ]);

        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/knowledge/query', [
            'query' => 'database sharding and partition prune',
            'top_k' => 2,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'query',
            'count',
            'chunks',
        ]);
    }
}
