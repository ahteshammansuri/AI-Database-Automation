<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\FieldMapping;
use Tests\TestCase;

class FieldMappingsApiTest extends TestCase
{
    protected function createAutomation(User $user): Automation
    {
        $conn = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Mapping DB ' . uniqid(),
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);

        return Automation::create([
            'user_id' => $user->id,
            'connection_id' => $conn->id,
            'name' => 'Mapping Test Automation',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [
                ['column_name' => 'title', 'role' => 'title'],
            ],
            'prompt_context' => 'Mapping test',
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'requires_approval' => true,
            'is_active' => true,
        ]);
    }

    public function test_user_can_update_and_retrieve_field_mappings(): void
    {
        $user = User::factory()->create();
        $automation = $this->createAutomation($user);

        $payload = [
            'mappings' => [
                [
                    'column_name' => 'title',
                    'role' => 'title',
                    'confidence' => 0.98,
                    'confirmed' => true,
                ],
                [
                    'column_name' => 'short_description',
                    'role' => 'summary',
                    'confidence' => 0.92,
                    'confirmed' => true,
                    'override_instructions' => 'Keep under 150 characters',
                ],
                [
                    'column_name' => 'category_id',
                    'role' => 'category_ref',
                    'confidence' => 0.95,
                    'confirmed' => true,
                ],
            ],
        ];

        // 1. PUT update
        $putRes = $this->actingAs($user)->putJson("/api/automations/{$automation->id}/field-mappings", $payload);
        $putRes->assertStatus(200);
        $putRes->assertJson(['success' => true]);

        // 2. GET retrieve
        $getRes = $this->actingAs($user)->getJson("/api/automations/{$automation->id}/field-mappings");
        $getRes->assertStatus(200);
        $mappings = $getRes->json('field_mappings');
        $this->assertCount(3, $mappings);

        $summary = collect($mappings)->firstWhere('column_name', 'short_description');
        $this->assertNotNull($summary);
        $this->assertEquals('summary', $summary['role']);
        $this->assertEquals('Keep under 150 characters', $summary['override_instructions']);
    }

    public function test_cross_user_cannot_access_or_modify_field_mappings(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        $automationA = $this->createAutomation($userA);

        // User B tries to read User A's mappings
        $getRes = $this->actingAs($userB)->getJson("/api/automations/{$automationA->id}/field-mappings");
        $getRes->assertStatus(404);

        // User B tries to write to User A's mappings
        $putRes = $this->actingAs($userB)->putJson("/api/automations/{$automationA->id}/field-mappings", [
            'mappings' => [
                ['column_name' => 'title', 'role' => 'title', 'confirmed' => true],
            ],
        ]);
        $putRes->assertStatus(404);
    }
}
