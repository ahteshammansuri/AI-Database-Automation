<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Services\SafeDatabaseExecutor;
use App\Jobs\PublishAutomationContentJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeadlinePolicyTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected DbConnection $connection;

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
    }

    protected function createAutomation(string $deadlinePolicy, bool $isActive = true): Automation
    {
        return Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $this->connection->id,
            'name' => 'Tech Blog Automation ' . uniqid(),
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
            'safe_deadline_policy' => $deadlinePolicy,
            'is_active' => $isActive,
        ]);
    }

    public function test_skip_policy_aborts_unapproved_execution_at_deadline(): void
    {
        $automation = $this->createAutomation('skip');

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'idemp-skip-' . uniqid(),
            'publication_time' => now()->subMinute(),
        ]);

        $version = ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => [
                'title' => 'Unapproved Post ' . uniqid(),
                'slug' => 'unapproved-post-' . uniqid(),
                'content' => 'Sample post content',
            ],
            'status' => 'PENDING_APPROVAL',
        ]);

        $job = new PublishAutomationContentJob($execution->id);
        $job->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        $this->assertEquals('SKIPPED', $execution->status);
        $this->assertEquals('DEADLINE_SKIPPED', $execution->failure_category);
        $this->assertNull($execution->published_at);
        $this->assertNull($execution->target_record_id);

        // Check timeline event
        $timelineStages = array_column($execution->timeline_events ?? [], 'stage');
        $this->assertContains('PUBLISH_SKIPPED', $timelineStages);
    }

    public function test_publish_last_valid_auto_approves_and_publishes(): void
    {
        $automation = $this->createAutomation('publish_last_valid');

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'idemp-auto-appr-' . uniqid(),
            'publication_time' => now()->subMinute(),
        ]);

        $uniq = uniqid();
        $version = ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => [
                'title' => 'Auto Approved Article ' . $uniq,
                'slug' => 'auto-approved-article-' . $uniq,
                'category_id' => 1,
                'status' => 'draft',
                'excerpt' => 'Auto approved at deadline test',
                'content' => 'Deep dive publication body content',
            ],
            'status' => 'PENDING_APPROVAL',
        ]);

        $job = new PublishAutomationContentJob($execution->id);
        $job->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        $version->refresh();

        $this->assertEquals('PUBLISHED', $execution->status);
        $this->assertNotNull($execution->published_at);
        $this->assertNotNull($execution->target_record_id);
        $this->assertEquals('APPROVED', $version->status);

        $timelineStages = array_column($execution->timeline_events ?? [], 'stage');
        $this->assertContains('AUTO_APPROVED_DEADLINE', $timelineStages);
        $this->assertContains('TARGET_TRANSACTION_COMMITTED', $timelineStages);
    }

    public function test_publish_last_valid_fails_if_only_rejected_versions_exist(): void
    {
        $automation = $this->createAutomation('publish_last_valid');

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'idemp-rejected-' . uniqid(),
            'publication_time' => now()->subMinute(),
        ]);

        ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => ['title' => 'Bad Post', 'slug' => 'bad-post', 'content' => 'poor quality'],
            'rejection_feedback' => 'Inappropriate topic',
            'status' => 'REJECTED',
        ]);

        $job = new PublishAutomationContentJob($execution->id);
        $job->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        $this->assertEquals('FAILED', $execution->status);
        $this->assertEquals('NO_VALID_VERSION_TO_PUBLISH', $execution->failure_category);
        $this->assertNull($execution->published_at);
    }

    public function test_notify_and_wait_leaves_execution_in_pending_state(): void
    {
        $automation = $this->createAutomation('notify_and_wait');

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'idemp-wait-' . uniqid(),
            'publication_time' => now()->subMinute(),
        ]);

        ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => ['title' => 'Waiting Post', 'slug' => 'waiting-post', 'content' => 'needs review'],
            'status' => 'PENDING_APPROVAL',
        ]);

        $job = new PublishAutomationContentJob($execution->id);
        $job->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        // Under notify_and_wait, execution MUST remain PENDING_APPROVAL and NOT publish unapproved content
        $this->assertEquals('PENDING_APPROVAL', $execution->status);
        $this->assertNull($execution->published_at);
        $this->assertNull($execution->target_record_id);

        $timelineStages = array_column($execution->timeline_events ?? [], 'stage');
        $this->assertContains('DEADLINE_REACHED_WAITING', $timelineStages);
    }

    public function test_inactive_automation_aborts_publication(): void
    {
        $automation = $this->createAutomation('notify_and_wait', isActive: false);

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'APPROVED',
            'idempotency_key' => 'idemp-inactive-' . uniqid(),
        ]);

        ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => ['title' => 'Approved but Inactive', 'slug' => 'approved-inactive'],
            'status' => 'APPROVED',
        ]);

        $job = new PublishAutomationContentJob($execution->id);
        $job->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        $this->assertEquals('CANCELLED', $execution->status);
        $this->assertEquals('AUTOMATION_INACTIVE', $execution->failure_category);
        $this->assertNull($execution->published_at);
    }

    public function test_tenant_ownership_mismatch_aborts_publication(): void
    {
        $userB = User::factory()->create();
        $connectionB = DbConnection::create([
            'user_id' => $userB->id,
            'name' => 'User B Target DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);

        // Maliciously configured automation: User A owns automation, but pointing to User B's connection
        $automation = Automation::create([
            'user_id' => $this->user->id,
            'connection_id' => $connectionB->id,
            'name' => 'Cross Tenant Exploit Attempt',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [],
            'ai_provider' => 'mock',
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'timezone' => 'UTC',
            'requires_approval' => true,
            'safe_deadline_policy' => 'publish_last_valid',
            'is_active' => true,
        ]);

        $execution = AutomationExecution::create([
            'user_id' => $this->user->id,
            'automation_id' => $automation->id,
            'status' => 'APPROVED',
            'idempotency_key' => 'idemp-tenant-breach-' . uniqid(),
        ]);

        ContentVersion::create([
            'user_id' => $this->user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => ['title' => 'Breach Attempt', 'slug' => 'breach-attempt'],
            'status' => 'APPROVED',
        ]);

        $job = new PublishAutomationContentJob($execution->id);
        $job->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        $this->assertEquals('FAILED', $execution->status);
        $this->assertEquals('TENANT_MISMATCH', $execution->failure_category);
        $this->assertNull($execution->published_at);
    }
}
