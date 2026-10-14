<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    public function test_cross_user_connection_access_is_blocked(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        $connA = DbConnection::create([
            'user_id' => $userA->id,
            'name' => "User A Private DB",
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'secret_pass_a',
        ]);

        $tokenB = $userB->createToken('test')->plainTextToken;

        // User B attempts to access User A's connection by ID
        $response = $this->withHeader('Authorization', "Bearer {$tokenB}")
            ->getJson("/api/connections/{$connA->id}");

        $response->assertStatus(404);

        // User B attempts to delete User A's connection
        $delResponse = $this->withHeader('Authorization', "Bearer {$tokenB}")
            ->deleteJson("/api/connections/{$connA->id}");

        $delResponse->assertStatus(404);
        $this->assertDatabaseHas('db_connections', ['id' => $connA->id]);
    }

    public function test_user_b_cannot_attach_automation_to_user_a_connection(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        $connA = DbConnection::create([
            'user_id' => $userA->id,
            'name' => "User A DB",
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'secret',
        ]);

        $tokenB = $userB->createToken('test')->plainTextToken;

        $response = $this->withHeader('Authorization', "Bearer {$tokenB}")
            ->postJson('/api/automations', [
                'name' => 'Malicious Cross-Tenant Automation',
                'connection_id' => $connA->id,
                'target_table' => 'posts',
                'operation_mode' => 'AI_CREATE',
                'field_mappings' => [
                    ['field_name' => 'title', 'mapping_type' => 'FIXED_VALUE', 'fixed_value' => 'Hi']
                ],
                'schedule_type' => 'DAILY',
                'generation_time' => '08:00',
                'publication_time' => '09:00',
                'requires_approval' => true,
            ]);

        $response->assertStatus(404);
        $this->assertDatabaseMissing('automations', ['name' => 'Malicious Cross-Tenant Automation']);
    }
}
