<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    public function test_user_can_register(): void
    {
        $email = 'test_' . uniqid() . '@example.com';
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Alice Engineer',
            'email' => $email,
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'user' => ['id', 'name', 'email'],
                'token',
            ]);

        $this->assertDatabaseHas('users', ['email' => $email]);
    }

    public function test_duplicate_registration_fails(): void
    {
        $user = User::factory()->create();

        $response = $this->postJson('/api/auth/register', [
            'name' => 'Duplicate User',
            'email' => $user->email,
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
        ]);

        $response->assertStatus(422);
    }

    public function test_user_can_login_and_access_me(): void
    {
        $user = User::factory()->create([
            'password' => bcrypt('Secret12345!'),
        ]);

        $loginRes = $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'Secret12345!',
        ]);

        $loginRes->assertStatus(200);
        $token = $loginRes->json('token');
        $this->assertNotEmpty($token);

        $meRes = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/auth/me');

        $meRes->assertStatus(200)
            ->assertJsonPath('user.email', $user->email);
    }

    public function test_unauthenticated_request_is_rejected(): void
    {
        $response = $this->getJson('/api/dashboard/stats');
        $response->assertStatus(401);
    }
}
