<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Agent\RuntimeContextBuilder;
use App\Services\Agent\SurfaceCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrbitAccountToolsTest extends TestCase
{
    use RefreshDatabase;

    public function test_get_account_profile_returns_user_info_without_password_hash(): void
    {
        $user = User::factory()->create([
            'name' => 'Tasty Burger',
            'email' => 'tasty@example.test',
            'timezone' => 'America/New_York',
        ]);

        $res = AgentToolRegistry::executeTool($user, 'get_account_profile', []);

        $this->assertTrue($res['success']);
        $this->assertSame($user->id, $res['data']['id']);
        $this->assertSame('Tasty Burger', $res['data']['name']);
        $this->assertSame('tasty@example.test', $res['data']['email']);
        $this->assertSame('America/New_York', $res['data']['timezone']);
        $this->assertSame('Tasty Burger', $res['user']['name']);

        $json = json_encode($res);
        $this->assertStringNotContainsString('password', $json);
        $this->assertStringNotContainsString('remember_token', $json);
    }

    public function test_update_account_profile_changes_name_and_logs_audit_trail(): void
    {
        $user = User::factory()->create([
            'name' => 'Tasty',
            'email' => 'user@example.test',
            'timezone' => 'UTC',
        ]);

        $res = AgentToolRegistry::executeTool($user, 'update_account_profile', [
            'name' => 'John Wick',
        ]);

        $this->assertTrue($res['success']);
        $this->assertSame('John Wick', $res['data']['name']);
        $this->assertSame('John Wick', $res['user']['name']);

        $user->refresh();
        $this->assertSame('John Wick', $user->name);

        // Verify audit log
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $user->id,
            'action' => 'PROFILE_UPDATED',
            'resource_type' => 'User',
            'resource_id' => (string) $user->id,
        ]);
    }

    public function test_update_account_profile_changes_timezone_and_validates(): void
    {
        $user = User::factory()->create([
            'name' => 'John Wick',
            'timezone' => 'UTC',
        ]);

        $res = AgentToolRegistry::executeTool($user, 'update_account_profile', [
            'timezone' => 'Asia/Kolkata',
        ]);

        $this->assertTrue($res['success']);
        $this->assertSame('Asia/Kolkata', $res['data']['timezone']);

        // Invalid timezone should fail gracefully
        $invalid = AgentToolRegistry::executeTool($user, 'update_account_profile', [
            'timezone' => 'Invalid/Timezone_Name_123',
        ]);
        $this->assertFalse($invalid['success']);
        $this->assertNotEmpty($invalid['error']);
    }

    public function test_surfaces_catalog_contains_account_surfaces(): void
    {
        $catalog = SurfaceCatalog::data();

        $accountSurfaces = array_filter($catalog['surfaces'], fn ($s) => ($s['route'] ?? '') === '/account');
        $this->assertNotEmpty($accountSurfaces, 'Catalog must contain surfaces on /account');

        $surfaceIds = array_column($accountSurfaces, 'id');
        $this->assertContains('account.profile', $surfaceIds);
        $this->assertContains('account.password', $surfaceIds);
        $this->assertContains('account.sessions', $surfaceIds);

        // Check specific fields on account.profile
        $profileSurface = SurfaceCatalog::surface('account.profile');
        $this->assertNotNull($profileSurface);
        $fieldNames = array_column($profileSurface['fields'], 'name');
        $this->assertContains('name', $fieldNames);
        $this->assertContains('email', $fieldNames);
        $this->assertContains('timezone', $fieldNames);

        // Check go_to_page check
        $check = SurfaceCatalog::check('go_to_page', ['page' => '/account']);
        $this->assertTrue($check['ok']);
    }

    public function test_every_page_is_described_by_what_it_is_for_so_requests_can_be_matched_to_it(): void
    {
        // Which page "mera account setting kholo aur naam badlo" means is retrieved by the AI service by meaning; the
        // pages it ranks carry what they are for (their own description, else their surfaces' purposes).
        $pages = collect(SurfaceCatalog::pageSummaries())->keyBy('route');

        $this->assertSame('Account settings', $pages['/account']['title']);
        $this->assertNotSame('', $pages['/account']['description']);
        $this->assertSame(SurfaceCatalog::routes(), $pages->keys()->all());
    }
}
