<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\ModelRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ModelRolesApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_list_model_roles_with_defaults(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/model-roles');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'roles' => [
                '*' => [
                    'role',
                    'label',
                    'description',
                    'provider',
                    'model_name',
                    'temperature',
                    'is_active',
                    'recommended_models',
                ],
            ],
        ]);

        $roles = collect($response->json('roles'))->pluck('role')->toArray();
        // Only jobs the product really gives to a model are offered.
        $this->assertSame(['planner', 'generator'], $roles);
    }

    public function test_user_can_update_model_role(): void
    {
        $user = User::factory()->create();

        $payload = [
            'role' => 'planner',
            'provider' => 'ollama',
            'model_name' => 'qwen2.5:7b',
            'temperature' => 0.45,
            'max_tokens' => 4096,
            'is_active' => true,
        ];

        $response = $this->actingAs($user)->putJson('/api/model-roles', $payload);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'role' => [
                'user_id' => $user->id,
                'role' => 'planner',
                'provider' => 'ollama',
                'model_name' => 'qwen2.5:7b',
                'temperature' => 0.45,
                'max_tokens' => 4096,
            ],
        ]);

        $this->assertDatabaseHas('model_roles', [
            'user_id' => $user->id,
            'role' => 'planner',
            'model_name' => 'qwen2.5:7b',
        ]);

        // Verify index reflects the customized role
        $indexRes = $this->actingAs($user)->getJson('/api/model-roles');
        $plannerRole = collect($indexRes->json('roles'))->firstWhere('role', 'planner');
        $this->assertEquals('qwen2.5:7b', $plannerRole['model_name']);
        $this->assertTrue($plannerRole['is_customized']);
    }

    public function test_cross_user_isolation_on_model_roles(): void
    {
        $userA = User::factory()->create();
        $userB = User::factory()->create();

        ModelRole::create([
            'user_id' => $userA->id,
            'role' => 'generator',
            'provider' => 'openai',
            'model_name' => 'gpt-4o',
            'temperature' => 0.7,
        ]);

        // User B inspects roles
        $responseB = $this->actingAs($userB)->getJson('/api/model-roles');
        $generatorRoleB = collect($responseB->json('roles'))->firstWhere('role', 'generator');

        // User B sees the default model (not User A's custom model)
        $this->assertNotEquals('gpt-4o', $generatorRoleB['model_name']);
        $this->assertFalse($generatorRoleB['is_customized']);
    }

    public function test_model_role_probe_endpoint(): void
    {
        $user = User::factory()->create();

        \Illuminate\Support\Facades\Http::fake(['*/v1/ai/health' => \Illuminate\Support\Facades\Http::response(['provider' => 'ollama', 'available' => true, 'latency_ms' => 12.5, 'models' => ['qwen2.5:3b'], 'message' => 'Ready'])]);

        // The placeholder generator is not a provider customers can choose.
        $this->actingAs($user)->postJson('/api/model-roles/probe', ['provider' => 'mock'])->assertStatus(422);

        $response = $this->actingAs($user)->postJson('/api/model-roles/probe', [
            'provider' => 'ollama',
            'model_name' => 'qwen2.5:3b',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'available',
            'latency_ms',
            'models',
            'message',
        ]);
        $this->assertTrue($response->json('available'));
    }
}
