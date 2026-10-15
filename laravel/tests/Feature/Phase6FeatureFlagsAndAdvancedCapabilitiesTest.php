<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\SchemaSnapshot;
use App\Services\FeatureFlagService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class Phase6FeatureFlagsAndAdvancedCapabilitiesTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected User $otherUser;
    protected DbConnection $connection;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->otherUser = User::factory()->create();

        // Target customer connection fixture pointing to test container DB
        $this->connection = DbConnection::create([
            'user_id' => $this->user->id,
            'name' => 'Demo Target DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
            'is_active' => true,
        ]);
    }

    public function test_feature_flags_endpoint_returns_active_flags()
    {
        $response = $this->actingAs($this->user)
            ->getJson('/api/features');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'features' => [
                'dry_run' => ['key', 'name', 'enabled'],
                'schema_drift' => ['key', 'name', 'enabled'],
                'undo_center' => ['key', 'name', 'enabled'],
                'quality_score' => ['key', 'name', 'enabled'],
                'content_calendar' => ['key', 'name', 'enabled'],
                'db_insights' => ['key', 'name', 'enabled'],
                'templates' => ['key', 'name', 'enabled'],
            ],
        ]);
        $this->assertTrue($response->json('features.dry_run.enabled'));
    }

    public function test_quality_score_evaluation_endpoint()
    {
        $payload = [
            'title' => 'Understanding Modern High-Performance Database Architectures',
            'slug' => 'understanding-modern-high-performance-database-architectures',
            'excerpt' => 'A comprehensive guide exploring high-throughput relational databases, transactional isolation boundaries, and automated publication pipelines.',
            'content' => "## Introduction to Modern Relational Architecture\n\nRelational engines require rigorous ACID guarantees.\n\n### Transactional Isolation\n\nHigh concurrency demands robust row-level locking mechanisms.\n\n### Summary\n\nCareful planning ensures consistent performance across database workloads.",
            'rag_passages' => [
                ['text' => 'High-performance databases require transactional isolation and automated publication guarantees.'],
            ],
        ];

        $response = $this->actingAs($this->user)
            ->postJson('/api/content/evaluate-quality', $payload);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'overall_score',
            'grade',
            'readability' => ['score', 'flesch_reading_ease', 'grade_level', 'word_count'],
            'seo' => ['score', 'title_length', 'slug_valid', 'excerpt_length'],
            'factual_grounding' => ['score', 'grounded_percentage'],
            'suggestions',
        ]);

        $this->assertGreaterThanOrEqual(60, $response->json('overall_score'));
        $this->assertTrue($response->json('seo.slug_valid'));
    }

    public function test_simulation_dry_run_executes_without_target_writes()
    {
        $automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'Weekly Engineering Digest',
            'target_table' => 'posts',
            'field_mappings' => ['title' => 'title', 'content' => 'content'],
            'schedule_type' => 'WEEKLY',
            'generation_time' => '09:00',
            'publication_time' => '10:00',
            'is_active' => true,
            'requires_approval' => true,
            'prompt_context' => 'Deep dive into transactional idempotency',
        ]);

        $response = $this->actingAs($this->user)
            ->postJson("/api/automations/{$automation->id}/dry-run", [
                'title' => 'Simulated Post on Transactional Idempotency',
            ]);

        $response->assertStatus(200);
        $response->assertJson([
            'dry_run' => true,
            'automation_id' => $automation->id,
            'target_table' => 'posts',
        ]);
        $response->assertJsonStructure([
            'simulated_payload',
            'resolved_relations',
            'quality_metrics',
            'novelty_check',
        ]);
    }

    public function test_simulation_cross_user_isolation_is_blocked()
    {
        $automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'User A Automation',
            'target_table' => 'posts',
            'field_mappings' => [],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'is_active' => true,
        ]);

        $response = $this->actingAs($this->otherUser)
            ->postJson("/api/automations/{$automation->id}/dry-run");

        $response->assertStatus(422);
        $this->assertStringContainsString('Unauthorized', $response->json('error'));
    }

    public function test_schema_drift_detection_establishes_baseline_and_detects_changes()
    {
        // 1. First run establishes initial baseline snapshot
        $response1 = $this->actingAs($this->user)
            ->postJson("/api/connections/{$this->connection->id}/detect-drift");

        $response1->assertStatus(200);
        $this->assertTrue($response1->json('feature_enabled'));
        $this->assertFalse($response1->json('has_drift'));

        // 2. Mock a drifted prior snapshot missing a column
        $snapshot = SchemaSnapshot::where('connection_id', $this->connection->id)->first();
        $this->assertNotNull($snapshot);

        // Modify snapshot to simulate that 'posts' table previously only had 'id' and 'title'
        $driftedPayload = [
            'tables' => [
                [
                    'name' => 'posts',
                    'columns' => [
                        ['name' => 'id', 'type' => 'int', 'nullable' => false],
                        ['name' => 'title', 'type' => 'varchar(255)', 'nullable' => false],
                    ],
                ],
            ],
        ];
        $snapshot->update(['schema_payload' => $driftedPayload]);

        // 3. Second run compares live schema against modified snapshot and detects drift
        $response2 = $this->actingAs($this->user)
            ->postJson("/api/connections/{$this->connection->id}/detect-drift");

        $response2->assertStatus(200);
        $this->assertTrue($response2->json('has_drift'));
        $this->assertNotEmpty($response2->json('modified_tables'));
    }

    public function test_compensation_undo_safely_reverts_execution_and_audits()
    {
        $automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'Audited Blog Automation',
            'target_table' => 'posts',
            'field_mappings' => [],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'is_active' => true,
        ]);

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'COMPLETED',
            'target_record_id' => 9999, // Specific simulated record
            'published_at' => now(),
            'created_at' => now(),
        ]);

        $response = $this->actingAs($this->user)
            ->postJson("/api/executions/{$execution->id}/undo");

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'execution_id' => $execution->id,
            'status' => 'COMPENSATED',
            'compensated_record_id' => 9999,
        ]);

        $this->assertEquals('COMPENSATED', $execution->fresh()->status);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $this->user->id,
            'action' => 'COMPENSATION_UNDO',
            'resource_id' => $execution->id,
        ]);
    }

    public function test_compensation_cross_user_undo_is_prohibited()
    {
        $automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'Tenant Scoped Automation',
            'target_table' => 'posts',
            'field_mappings' => [],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'is_active' => true,
        ]);

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'COMPLETED',
            'target_record_id' => 8888,
            'created_at' => now(),
        ]);

        $response = $this->actingAs($this->otherUser)
            ->postJson("/api/executions/{$execution->id}/undo");

        $response->assertStatus(422);
        $this->assertStringContainsString('Unauthorized', $response->json('error'));
    }

    public function test_templates_catalog_and_instantiation()
    {
        // 1. List templates
        $listRes = $this->actingAs($this->user)
            ->getJson('/api/templates');

        $listRes->assertStatus(200);
        $this->assertGreaterThanOrEqual(4, count($listRes->json('templates')));

        // 2. Create automation from template
        $createRes = $this->actingAs($this->user)
            ->postJson('/api/automations/from-template', [
                'template_id' => 'tech_blog',
                'connection_id' => $this->connection->id,
                'name' => 'My Generated Tech Blog',
            ]);

        $createRes->assertStatus(201);
        $createRes->assertJson([
            'success' => true,
            'automation' => [
                'name' => 'My Generated Tech Blog',
                'target_table' => 'posts',
                'lead_time_minutes' => 30,
            ],
        ]);
    }

    public function test_calendar_events_and_lead_time_safe_rescheduling()
    {
        $automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'Calendar Scheduled Item',
            'target_table' => 'posts',
            'field_mappings' => [],
            'schedule_type' => 'DAILY',
            'generation_time' => '11:30',
            'publication_time' => '12:00',
            'is_active' => true,
        ]);

        // 1. Fetch calendar events
        $calRes = $this->actingAs($this->user)
            ->getJson('/api/calendar/events');

        $calRes->assertStatus(200);
        $calRes->assertJsonStructure(['events']);

        // 2. Rescheduling under 30 minutes is safely rejected
        $unsafeTime = now()->addMinutes(10)->toIso8601String();
        $badReschedule = $this->actingAs($this->user)
            ->postJson("/api/calendar/reschedule/{$automation->id}", [
                'new_datetime' => $unsafeTime,
            ]);

        $badReschedule->assertStatus(422);
        $this->assertStringContainsString('at least 30 minutes into the future', $badReschedule->json('error'));

        // 3. Rescheduling beyond lead time succeeds
        $safeTime = now()->addHours(2)->toIso8601String();
        $goodReschedule = $this->actingAs($this->user)
            ->postJson("/api/calendar/reschedule/{$automation->id}", [
                'new_datetime' => $safeTime,
            ]);

        $goodReschedule->assertStatus(200);
        $this->assertTrue($goodReschedule->json('success'));
    }

    public function test_database_insights_returns_table_stats_and_velocity()
    {
        $response = $this->actingAs($this->user)
            ->getJson("/api/connections/{$this->connection->id}/insights");

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'connection_id',
            'connection_name',
            'database_name',
            'tables',
            'total_tables',
            'total_rows',
            'monthly_publications',
            'success_rate_percent',
            'timeseries',
        ]);
        $this->assertEquals($this->connection->id, $response->json('connection_id'));
    }
}
