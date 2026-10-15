<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Services\AiServiceClient;
use App\Services\ContextPackageService;
use App\Services\NoveltyCheckService;
use App\Services\EmailApprovalService;
use App\Jobs\GenerateAutomationContentJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class NoveltyCheckTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected DbConnection $connection;
    protected Automation $automation;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();

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
        ]);

        $this->automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'Database Optimization Series',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [
                ['field_name' => 'title', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'slug', 'mapping_type' => 'DERIVED_SLUG', 'source_field' => 'title'],
                ['field_name' => 'content', 'mapping_type' => 'AI_GENERATED'],
            ],
            'ai_provider' => 'mock',
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'timezone' => 'UTC',
            'requires_approval' => true,
            'safe_deadline_policy' => 'notify_and_wait',
            'is_active' => true,
        ]);
    }

    public function test_novelty_service_fallback_exact_match(): void
    {
        $service = app(NoveltyCheckService::class);
        $recent = [
            'Architecting Distributed Databases for Scale',
            'Mastering MySQL Execution Plans',
            'Cache Invalidation Strategies in 2026',
        ];

        $res = $service->fallbackCheck('Mastering MySQL Execution Plans', $recent, 0.92);

        $this->assertTrue($res['is_duplicate']);
        $this->assertEquals(1.0, $res['highest_similarity']);
        $this->assertEquals('Mastering MySQL Execution Plans', $res['matched_title']);
        $this->assertNotNull($res['angle_suggestion']);
    }

    public function test_novelty_service_fallback_distinct_title(): void
    {
        $service = app(NoveltyCheckService::class);
        $recent = [
            'Architecting Distributed Databases for Scale',
            'Mastering MySQL Execution Plans',
            'Cache Invalidation Strategies in 2026',
        ];

        $res = $service->fallbackCheck('An Introduction to Organic Farming Practices', $recent, 0.92);

        $this->assertFalse($res['is_duplicate']);
        $this->assertLessThan(0.92, $res['highest_similarity']);
        $this->assertNull($res['matched_title']);
    }

    public function test_novelty_service_calls_ai_client(): void
    {
        // Create an existing execution with a prior published title
        $priorExecution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $this->automation->id,
            'status' => 'PUBLISHED',
            'idempotency_key' => 'idemp-prior-' . uniqid(),
        ]);

        ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $priorExecution->id,
            'version_number' => 1,
            'payload' => ['title' => 'Architecting High-Throughput MySQL Clusters'],
            'status' => 'APPROVED',
        ]);

        $mockAiClient = Mockery::mock(AiServiceClient::class);
        $mockAiClient->shouldReceive('checkNovelty')
            ->once()
            ->andReturn([
                'is_duplicate' => true,
                'highest_similarity' => 0.965,
                'matched_title' => 'Architecting High-Throughput MySQL Clusters',
                'angle_suggestion' => 'Focus on failover benchmarking instead of architecture',
            ]);

        $service = new NoveltyCheckService($mockAiClient, app(ContextPackageService::class));
        $result = $service->check('Architecting High-Throughput MySQL Clusters', $this->automation, 0.92);

        $this->assertTrue($result['is_duplicate']);
        $this->assertEquals(0.965, $result['highest_similarity']);
        $this->assertEquals('Architecting High-Throughput MySQL Clusters', $result['matched_title']);
    }

    public function test_generate_content_job_novelty_angle_regeneration(): void
    {
        // 1. Establish an existing publication title
        $priorExec = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $this->automation->id,
            'status' => 'PUBLISHED',
            'idempotency_key' => 'idemp-seed-' . uniqid(),
        ]);

        ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $priorExec->id,
            'version_number' => 1,
            'payload' => [
                'title' => 'Scaling MySQL with Read Replicas',
                'slug' => 'scaling-mysql-with-read-replicas',
                'content' => 'Initial content',
            ],
            'status' => 'APPROVED',
        ]);

        // 2. New execution being generated
        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $this->automation->id,
            'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'idemp-new-gen-' . uniqid(),
            'publication_time' => now()->addHour(),
        ]);

        $mockAiClient = Mockery::mock(AiServiceClient::class);

        // First call: produces a duplicate title
        $mockAiClient->shouldReceive('generateContent')
            ->once()
            ->andReturn([
                'success' => true,
                'latency_seconds' => 0.5,
                'data' => [
                    'title' => 'Scaling MySQL with Read Replicas',
                    'slug' => 'scaling-mysql-with-read-replicas',
                    'content' => 'Standard overview of replication',
                    'excerpt' => 'Overview excerpt',
                ],
            ]);

        // Second call: regenerated after novelty check with angle variation
        $mockAiClient->shouldReceive('generateContent')
            ->once()
            ->andReturn([
                'success' => true,
                'latency_seconds' => 0.7,
                'data' => [
                    'title' => 'Advanced Replication Lag Mitigation in Large MySQL Clusters',
                    'slug' => 'advanced-replication-lag-mitigation',
                    'content' => 'Deep technical dive into replication lag',
                    'excerpt' => 'Advanced excerpt',
                ],
            ]);

        $mockApproval = Mockery::mock(EmailApprovalService::class);
        $mockApproval->shouldReceive('dispatchApprovalNotification')->zeroOrMoreTimes();

        $noveltyService = app(NoveltyCheckService::class);
        $contextPackageService = app(ContextPackageService::class);

        $job = new GenerateAutomationContentJob($execution->id);
        $job->handle($mockAiClient, $mockApproval, $noveltyService, $contextPackageService);

        $execution->refresh();
        $this->assertEquals('PENDING_APPROVAL', $execution->status);

        // Verify version payload has the REGENERATED title, not the duplicate!
        $version = ContentVersion::where('execution_id', $execution->id)->first();
        $this->assertNotNull($version);
        $this->assertEquals('Advanced Replication Lag Mitigation in Large MySQL Clusters', $version->payload['title']);

        // Verify timeline events
        $timelineStages = array_column($execution->timeline_events ?? [], 'stage');
        $this->assertContains('NOVELTY_DUPLICATE_DETECTED', $timelineStages);
        $this->assertContains('NOVELTY_ANGLE_APPLIED', $timelineStages);
    }
}
