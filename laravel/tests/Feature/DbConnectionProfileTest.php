<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use Tests\TestCase;

class DbConnectionProfileTest extends TestCase
{
    public function test_user_can_create_connection_with_prefer_or_preferred(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        // Test with 'prefer'
        $response1 = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/connections', [
                'name' => 'Test DB Prefer ' . uniqid(),
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'demo_blog_cms',
                'username' => 'root',
                'password' => 'secret',
                'ssl_mode' => 'prefer',
            ]);

        $response1->assertStatus(201);
        $this->assertEquals('preferred', $response1->json('connection.ssl_mode'));

        // Test with 'preferred'
        $response2 = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/connections', [
                'name' => 'Test DB Preferred ' . uniqid(),
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'demo_blog_cms',
                'username' => 'root',
                'password' => 'secret',
                'ssl_mode' => 'preferred',
            ]);

        $response2->assertStatus(201);
        $this->assertEquals('preferred', $response2->json('connection.ssl_mode'));
    }

    public function test_user_can_create_connection_with_require_and_disable(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        // 'require' -> normalized to 'required'
        $response1 = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/connections', [
                'name' => 'Test DB Require ' . uniqid(),
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'demo_blog_cms',
                'username' => 'root',
                'password' => 'secret',
                'ssl_mode' => 'require',
            ]);

        $response1->assertStatus(201);
        $this->assertEquals('required', $response1->json('connection.ssl_mode'));

        // 'disable' -> normalized to 'disabled'
        $response2 = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/connections', [
                'name' => 'Test DB Disable ' . uniqid(),
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'demo_blog_cms',
                'username' => 'root',
                'password' => 'secret',
                'ssl_mode' => 'disable',
            ]);

        $response2->assertStatus(201);
        $this->assertEquals('disabled', $response2->json('connection.ssl_mode'));
    }

    public function test_invalid_ssl_mode_returns_validation_error(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/connections', [
                'name' => 'Test DB Invalid SSL ' . uniqid(),
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'demo_blog_cms',
                'username' => 'root',
                'password' => 'secret',
                'ssl_mode' => 'invalid_ssl_mode_xyz',
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['ssl_mode']);
    }

    public function test_user_can_create_connection_with_test_before_save(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/connections', [
                'name' => 'Test DB With Verification ' . uniqid(),
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'platform_automation',
                'username' => 'root',
                'password' => 'agc123',
                'ssl_mode' => 'preferred',
                'test_before_save' => true,
            ]);

        $response->assertStatus(201);
        $this->assertEquals('connected', $response->json('connection.status'));
        $this->assertNull($response->json('connection.error_message'));
    }
}
