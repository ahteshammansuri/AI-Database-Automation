<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Services\SafeDatabaseExecutor;
use Tests\TestCase;

class PostPublicationAndStagedDiagnosticsTest extends TestCase
{
    public function test_safe_scoped_update_modifies_target_record(): void
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Test MySQL DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
        ]);

        $executor = app(SafeDatabaseExecutor::class);

        // 1. Insert a record
        $slug = 'scoped-update-test-' . uniqid();
        $insertRes = $executor->executeInsert($connection, 'posts', [
            'title' => 'Initial Title',
            'slug' => $slug,
            'content' => 'Initial Content',
            'status' => 'draft',
        ]);

        $recordId = $insertRes['record_id'];

        // 2. Perform scoped update
        $newTitle = 'Updated Post Title ' . uniqid();
        $updateRes = $executor->executeScopedUpdate($connection, 'posts', 'id', $recordId, [
            'title' => $newTitle,
            'status' => 'published',
        ]);

        $this->assertTrue($updateRes['success']);
        $this->assertEquals('UPDATE', $updateRes['operation']);
        $this->assertEquals(1, $updateRes['rows_affected']);

        // 3. Verify in target MySQL
        $pdo = $connection->createTargetPdo();
        $stmt = $pdo->prepare("SELECT title, status FROM posts WHERE id = :id");
        $stmt->execute(['id' => $recordId]);
        $row = $stmt->fetch();

        $this->assertEquals($newTitle, $row['title']);
        $this->assertEquals('published', $row['status']);
    }

    public function test_post_publication_in_portal_update_api_endpoint(): void
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Test MySQL DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
        ]);

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'name' => 'Blog Auto',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:30',
            'publication_time' => '09:00',
            'timezone' => 'UTC',
        ]);

        $executor = app(SafeDatabaseExecutor::class);
        $slug = 'portal-edit-test-' . uniqid();
        $insertRes = $executor->executeInsert($connection, 'posts', [
            'title' => 'Pre-edit Title',
            'slug' => $slug,
            'content' => 'Pre-edit Content',
            'status' => 'published',
        ]);
        $recordId = (int) $insertRes['record_id'];

        $execution = AutomationExecution::create([
            'user_id' => $user->id,
            'automation_id' => $automation->id,
            'status' => 'PUBLISHED',
            'target_record_id' => $recordId,
            'idempotency_key' => 'portal_edit_' . uniqid(),
            'timeline_events' => [],
        ]);

        ContentVersion::create([
            'execution_id' => $execution->id,
            'user_id' => $user->id,
            'version_number' => 1,
            'status' => 'PUBLISHED',
            'payload' => ['title' => 'Pre-edit Title', 'slug' => $slug],
        ]);

        $updatedTitle = 'Post-Publication Revised Title ' . uniqid();

        $response = $this->actingAs($user)->postJson("/api/executions/{$execution->id}/update-record", [
            'payload' => [
                'title' => $updatedTitle,
                'status' => 'published',
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('version.version_number', 2);
        $this->assertEquals($updatedTitle, $response->json('version.payload.title'));

        // Verify direct MySQL reflection
        $pdo = $connection->createTargetPdo();
        $stmt = $pdo->prepare("SELECT title FROM posts WHERE id = :id");
        $stmt->execute(['id' => $recordId]);
        $this->assertEquals($updatedTitle, $stmt->fetch()['title']);
    }

    public function test_connection_test_returns_all_staged_milestones(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/connections/test', [
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'password' => 'ipo_root_password',
            'ssl_mode' => 'preferred',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'latency_ms',
            'server_version',
            'table_count',
            'stages' => [
                '*' => ['stage', 'status', 'detail'],
            ],
        ]);

        $stages = collect($response->json('stages'))->pluck('stage')->toArray();
        $this->assertContains('Validating settings', $stages);
        $this->assertContains('Opening secure connection', $stages);
        $this->assertContains('Checking access & privileges', $stages);
        $this->assertContains('Reading schema metadata', $stages);
        $this->assertContains('Mapping relationships', $stages);
        $this->assertContains('Finishing', $stages);
    }

    public function test_connection_deletion_requires_force_when_active_automations_exist(): void
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Protected DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
        ]);

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'name' => 'Active Dependent Pipeline',
            'target_table' => 'posts',
            'is_active' => true,
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:30',
            'publication_time' => '09:00',
            'timezone' => 'UTC',
        ]);

        // Attempt deletion without force
        $failResponse = $this->actingAs($user)->deleteJson("/api/connections/{$connection->id}");
        $failResponse->assertStatus(422);
        $failResponse->assertJsonStructure(['message', 'dependent_automations']);

        // Attempt deletion with force=true
        $successResponse = $this->actingAs($user)->deleteJson("/api/connections/{$connection->id}?force=true");
        $successResponse->assertStatus(200);
        $this->assertDatabaseMissing('db_connections', ['id' => $connection->id]);
    }

    public function test_dashboard_stats_returns_timeseries_and_operational_feed(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/dashboard/stats?range=7d');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'analytics' => [
                'range',
                'daily_volume' => [
                    '*' => ['label', 'published', 'failed', 'total'],
                ],
            ],
            'worker_health' => ['status', 'is_healthy', 'active_workers'],
            'operational_feed',
        ]);
    }
}
