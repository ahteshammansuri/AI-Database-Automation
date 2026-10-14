<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Services\DatabaseSafetyService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ManualPublishAndSchedulerTest extends TestCase
{
    use RefreshDatabase;

    public function test_blog_tables_are_allowlisted()
    {
        $safety = app(DatabaseSafetyService::class);
        $this->assertFalse($safety->isTableSensitive('blog_posts'));
        $this->assertFalse($safety->isTableSensitive('blog_categories'));
        $this->assertFalse($safety->isTableSensitive('blogs'));
        $this->assertFalse($safety->isTableSensitive('articles'));
        $this->assertFalse($safety->isTableSensitive('products'));
        $this->assertFalse($safety->isTableSensitive('faqs'));
        $this->assertFalse($safety->isTableSensitive('cities'));

        // Protected tables
        $this->assertTrue($safety->isTableSensitive('users'));
        $this->assertTrue($safety->isTableSensitive('personal_access_tokens'));
        $this->assertTrue($safety->isTableSensitive('passwords'));
    }

    public function test_manual_publishing_and_scheduler_lifecycle()
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Demo Target DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);

        // 1. Direct manual publish
        $payload = [
            'title' => 'Dynamic Enterprise Orchestration ' . uniqid(),
            'slug' => 'dynamic-enterprise-orchestration-' . uniqid(),
            'banner' => 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200',
            'meta_img' => 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800',
            'category_id' => 1,
            'status' => 'draft',
            'excerpt' => 'Dynamic zero-AI publication test',
            'content' => 'Deep dive body content',
            'deleted_at' => null,
        ];

        $response = $this->actingAs($user)->postJson('/api/automations/manual-publish', [
            'connection_id' => $connection->id,
            'target_table' => 'posts',
            'payload' => $payload,
            'publish_now' => true,
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure([
            'message',
            'execution' => ['id', 'status'],
            'result' => ['record_id', 'table'],
        ]);

        $this->assertDatabaseHas('automation_executions', [
            'user_id' => $user->id,
            'status' => 'PUBLISHED',
        ]);

        // 2. Scheduler check command
        $this->artisan('automations:check-schedule')->assertExitCode(0);
    }
}
