<?php

namespace Tests\Feature;

use App\Models\AiUsageEvent;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Account settings: profile (email change needs the current password), password change that signs out other
 * sessions, signing out a single session (never the current one through this path), and the customer's AI usage.
 */
class ProfileSettingsTest extends TestCase
{
    use RefreshDatabase;

    private function bearer(User $user): array
    {
        return ['Authorization' => 'Bearer ' . $user->createToken('api_token')->plainTextToken, 'Accept' => 'application/json'];
    }

    public function test_profile_shows_sessions_and_updates_with_password_check_for_email()
    {
        $user = User::factory()->create(['email' => 'me@example.test', 'password' => Hash::make('secret123')]);
        $other = User::factory()->create(['email' => 'taken@example.test']);
        $h = $this->bearer($user);
        $user->createToken('api_token'); // another device

        $res = $this->withHeaders($h)->getJson('/api/profile')->assertOk();
        $this->assertSame('me@example.test', $res->json('profile.email'));
        $this->assertCount(2, $res->json('sessions'));
        $this->assertCount(1, array_filter($res->json('sessions'), fn ($s) => $s['current']));

        $this->withHeaders($h)->putJson('/api/profile', ['name' => 'Me', 'email' => 'me@example.test', 'timezone' => 'Europe/Berlin'])->assertOk();
        $this->assertSame('Europe/Berlin', $user->fresh()->timezone);
        $this->withHeaders($h)->getJson('/api/auth/me')->assertJsonPath('user.timezone', 'Europe/Berlin');

        $this->withHeaders($h)->putJson('/api/profile', ['name' => 'Me', 'email' => 'new@example.test'])->assertStatus(422)->assertJsonValidationErrors(['current_password']);
        $this->withHeaders($h)->putJson('/api/profile', ['name' => 'Me', 'email' => $other->email, 'current_password' => 'secret123'])->assertStatus(422)->assertJsonValidationErrors(['email']);
        $this->withHeaders($h)->putJson('/api/profile', ['name' => 'Me', 'email' => 'new@example.test', 'current_password' => 'secret123', 'timezone' => 'Not/AZone'])->assertStatus(422)->assertJsonValidationErrors(['timezone']);
        $this->withHeaders($h)->putJson('/api/profile', ['name' => 'Me', 'email' => 'new@example.test', 'current_password' => 'secret123'])->assertOk();
        $this->assertSame('new@example.test', $user->fresh()->email);
        $this->assertNull($user->fresh()->timezone, 'an empty timezone means "follow the browser"');

        $log = AuditLog::where('user_id', $user->id)->where('action', 'PROFILE_UPDATED')->latest('id')->first();
        $this->assertSame('m***@example.test', $log->metadata['changes']['email']['from'], 'emails are masked in the audit trail');
    }

    public function test_password_change_checks_the_current_one_and_signs_out_other_sessions()
    {
        $user = User::factory()->create(['password' => Hash::make('secret123')]);
        $h = $this->bearer($user);
        $user->createToken('api_token');
        $user->createToken('api_token');

        $this->withHeaders($h)->putJson('/api/profile/password', ['current_password' => 'wrong', 'password' => 'newpass1', 'password_confirmation' => 'newpass1'])
            ->assertStatus(422)->assertJsonValidationErrors(['current_password']);
        $this->withHeaders($h)->putJson('/api/profile/password', ['current_password' => 'secret123', 'password' => 'secret123', 'password_confirmation' => 'secret123'])
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
        $this->withHeaders($h)->putJson('/api/profile/password', ['current_password' => 'secret123', 'password' => 'newpass1', 'password_confirmation' => 'newpass1'])
            ->assertOk()->assertJsonPath('signed_out', 2);

        $this->assertTrue(Hash::check('newpass1', $user->fresh()->password));
        $this->assertSame(1, $user->tokens()->count(), 'only the current session remains');
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'newpass1'])->assertOk();
    }

    public function test_sessions_can_be_signed_out_except_the_current_one_and_usage_is_summed()
    {
        $user = User::factory()->create();
        $h = $this->bearer($user);
        $currentId = $user->tokens()->latest('id')->value('id');
        $otherId = $user->createToken('api_token')->accessToken->id;
        $stranger = User::factory()->create();
        $strangerToken = $stranger->createToken('api_token')->accessToken->id;

        $this->withHeaders($h)->deleteJson("/api/profile/sessions/{$currentId}")->assertStatus(422);
        $this->withHeaders($h)->deleteJson("/api/profile/sessions/{$strangerToken}")->assertNotFound();
        $this->withHeaders($h)->deleteJson("/api/profile/sessions/{$otherId}")->assertOk()->assertJsonPath('count', 1);
        $this->assertSame(1, $user->tokens()->count());

        AiUsageEvent::create(['user_id' => $user->id, 'purpose' => 'content', 'provider' => 'ollama', 'model' => 'llama3.2:1b', 'kind' => 'chat', 'calls' => 2, 'prompt_tokens' => 800, 'completion_tokens' => 400, 'created_at' => now()]);
        AiUsageEvent::create(['user_id' => $user->id, 'purpose' => 'orbit', 'provider' => 'ollama', 'model' => 'qwen2.5:3b', 'kind' => 'chat', 'calls' => 1, 'prompt_tokens' => 100, 'completion_tokens' => 50, 'created_at' => now()->subDays(40)]);
        AiUsageEvent::create(['user_id' => $stranger->id, 'purpose' => 'content', 'provider' => 'openai', 'model' => 'x', 'kind' => 'chat', 'calls' => 9, 'prompt_tokens' => 9999, 'completion_tokens' => 9999, 'created_at' => now()]);

        $u30 = $this->withHeaders($h)->getJson('/api/profile/usage?days=30')->assertOk();
        $this->assertSame(['calls' => 2, 'prompt_tokens' => 800, 'completion_tokens' => 400], $u30->json('totals'));
        $this->assertSame('Automation writing', $u30->json('by_purpose.0.label'));
        $this->assertSame(3, $this->withHeaders($h)->getJson('/api/profile/usage?days=90')->json('totals.calls'));
        $this->withHeaders($h)->getJson('/api/profile/usage?days=5')->assertStatus(422);
    }
}
