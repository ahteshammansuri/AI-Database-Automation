<?php

namespace Tests\Feature;

use App\Admin\AdminActivity;
use App\Admin\CustomerAccounts;
use App\Admin\OrbitKnowledge;
use App\Admin\SystemHealth;
use App\Filament\Resources\OrbitKnowledge\Pages\EditOrbitKnowledge;
use App\Models\Admin;
use App\Models\AdminActivityLog;
use App\Models\DbConnection;
use App\Models\FailedJob;
use App\Models\OrbitKnowledgeGuide;
use App\Models\User;
use App\Services\Automation\ScheduleCalculator;
use App\Settings\PlatformSettings;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;
use RuntimeException;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/**
 * The admin panel: a separate admin identity with role-based permissions, settings that change how the platform
 * behaves (without env edits), customer account controls, Orbit knowledge publishing and system health.
 */
class AdminPanelTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('admin:sync-permissions')->assertSuccessful();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    private function admin(?string $role = null, array $attributes = []): Admin
    {
        $admin = Admin::create($attributes + [
            'name' => 'Ada Admin',
            'email' => 'admin' . Admin::count() . '@example.test',
            'password' => 'correct-horse-battery-9',
            'is_active' => true,
        ]);
        if ($role) {
            $admin->assignRole($role);
        }
        return $admin;
    }

    // ------------------------------------------------------------------ identity and permissions

    public function test_the_panel_needs_an_admin_sign_in_and_a_customer_token_is_not_one()
    {
        $this->get('/admin')->assertRedirect('/admin/login');

        $customer = User::factory()->create();
        $token = $customer->createToken('portal')->plainTextToken;
        $this->withToken($token)->get('/admin/customers')->assertRedirect('/admin/login');
        $this->actingAs($customer)->get('/admin/customers')->assertRedirect('/admin/login');
    }

    public function test_an_inactive_admin_cannot_use_the_panel()
    {
        $admin = $this->admin(Admin::SUPER_ADMIN, ['is_active' => false]);
        $this->actingAs($admin, 'admin')->get('/admin')->assertForbidden();
    }

    public function test_a_role_only_opens_the_areas_it_grants()
    {
        $support = $this->admin('support');
        $this->actingAs($support, 'admin');

        $this->get('/admin')->assertOk();
        $this->get('/admin/customers')->assertOk();
        $this->get('/admin/customer-activity')->assertOk();
        $this->get('/admin/settings/general')->assertForbidden();
        $this->get('/admin/website-content')->assertForbidden();
        $this->get('/admin/admins')->assertForbidden();
        $this->get('/admin/roles')->assertForbidden();
        $this->get('/admin/system-health')->assertForbidden();
        $this->get('/admin/failed-jobs')->assertForbidden();
        $this->get('/admin/orbit-knowledge')->assertForbidden();
    }

    public function test_an_admin_without_a_role_sees_nothing()
    {
        $this->actingAs($this->admin(), 'admin')->get('/admin/customers')->assertForbidden();
    }

    public function test_a_super_admin_opens_every_area()
    {
        $this->actingAs($this->admin(Admin::SUPER_ADMIN), 'admin');
        foreach (['/admin', '/admin/customers', '/admin/settings/general', '/admin/website-content', '/admin/admins', '/admin/roles', '/admin/admin-activity', '/admin/orbit-knowledge', '/admin/system-health', '/admin/failed-jobs'] as $path) {
            $this->get($path)->assertOk();
        }
    }

    public function test_admin_create_makes_the_first_admin_a_super_admin_and_refuses_weak_passwords()
    {
        $this->artisan('admin:create', ['--name' => 'Weak', '--email' => 'weak@example.test', '--password' => 'short'])->assertFailed();
        $this->assertSame(0, Admin::count());

        $this->artisan('admin:create', ['--name' => 'First Admin', '--email' => 'first@example.test', '--password' => 'a-long-passphrase-42'])->assertSuccessful();
        $this->assertTrue(Admin::where('email', 'first@example.test')->firstOrFail()->isSuperAdmin());
    }

    // ------------------------------------------------------------------ settings

    public function test_saved_settings_apply_at_once_and_reach_the_portal()
    {
        $this->assertSame(15, ScheduleCalculator::minGapMinutes());

        PlatformSettings::save(['automation.min_gap_minutes' => 30, 'platform.brand_name' => 'Nimbus Data']);

        $this->assertSame(30, ScheduleCalculator::minGapMinutes());
        $this->assertSame('Nimbus Data', config('app.name'));
        $this->getJson('/api/platform/config')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-cache, private')
            ->assertJsonPath('automation.min_gap_minutes', 30)
            ->assertJsonPath('platform.brand_name', 'Nimbus Data');

        // Website texts use {brand}: renaming the brand renames every text that refers to it.
        $content = $this->getJson('/api/site/content')->assertOk()->json();
        $this->assertSame('Nimbus Data · AI automation for your own database', $content['meta_title']);
        $this->assertStringNotContainsString('{brand}', json_encode($content));
    }

    public function test_settings_are_validated_on_the_server_and_defaults_are_not_stored()
    {
        try {
            PlatformSettings::save(['automation.min_gap_minutes' => 0]);
            $this->fail('A zero minute gap must be refused.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('automation.min_gap_minutes', $e->errors());
        }
        $this->assertSame(15, ScheduleCalculator::minGapMinutes());

        PlatformSettings::save(['automation.min_gap_minutes' => 20]);
        $this->assertDatabaseHas('platform_settings', ['key' => 'automation.min_gap_minutes']);
        PlatformSettings::save(['automation.min_gap_minutes' => 15]);
        $this->assertDatabaseMissing('platform_settings', ['key' => 'automation.min_gap_minutes']);

        PlatformSettings::save(['automation.min_gap_minutes' => 45]);
        PlatformSettings::reset(['automation.min_gap_minutes']);
        $this->assertSame(15, ScheduleCalculator::minGapMinutes());
    }

    public function test_public_endpoints_never_expose_server_secrets()
    {
        config(['services.ai.key' => 'super-secret-shared-key', 'database.connections.mysql.password' => 'db-secret-value']);
        $body = $this->getJson('/api/platform/config')->assertOk()->getContent() . $this->getJson('/api/site/content')->assertOk()->getContent();
        foreach (['super-secret-shared-key', 'db-secret-value', (string) config('app.key'), (string) config('services.ai.url')] as $secret) {
            $this->assertStringNotContainsString($secret, $body);
        }
    }

    // ------------------------------------------------------------------ sign-up and accounts

    public function test_closing_sign_ups_refuses_new_accounts_with_the_admin_message()
    {
        PlatformSettings::save(['platform.registration_open' => false, 'platform.registration_closed_message' => 'Sign-ups reopen on Monday.']);

        $this->postJson('/api/auth/register', ['name' => 'New', 'email' => 'new@example.test', 'password' => 'password-123', 'password_confirmation' => 'password-123'])
            ->assertForbidden()
            ->assertJsonPath('reason', 'registration_closed')
            ->assertJsonPath('errors.email.0', 'Sign-ups reopen on Monday.');
        $this->assertDatabaseMissing('users', ['email' => 'new@example.test']);
    }

    public function test_the_password_minimum_comes_from_settings()
    {
        PlatformSettings::save(['platform.password_min_length' => 14]);
        $this->postJson('/api/auth/register', ['name' => 'New', 'email' => 'new@example.test', 'password' => 'only-12-char', 'password_confirmation' => 'only-12-char'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');
        $this->postJson('/api/auth/register', ['name' => 'New', 'email' => 'new@example.test', 'password' => 'fourteen-chars', 'password_confirmation' => 'fourteen-chars'])
            ->assertCreated();
    }

    public function test_suspending_a_customer_ends_their_sessions_and_blocks_sign_in_until_reactivated()
    {
        $this->actingAs($this->admin(Admin::SUPER_ADMIN), 'admin');
        $customer = User::factory()->create(['email' => 'cust@example.test', 'password' => bcrypt('password-123')]);
        $token = $customer->createToken('portal')->plainTextToken;

        app(CustomerAccounts::class)->suspend($customer, 'Chargeback under review');

        $this->assertSame(0, $customer->tokens()->count());
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => 'cust@example.test', 'password' => 'password-123'])
            ->assertJsonValidationErrors('email');
        // A token issued before the suspension took effect is refused with the reason.
        $late = $customer->createToken('late')->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($late)->getJson('/api/connections')->assertForbidden()->assertJsonPath('reason', 'suspended');
        $this->assertDatabaseHas('audit_logs', ['user_id' => $customer->id, 'action' => 'ACCOUNT_SUSPENDED']);
        $this->assertDatabaseHas('admin_activity_logs', ['action' => 'customer.suspended']);

        app(CustomerAccounts::class)->reactivate($customer->fresh());
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => 'cust@example.test', 'password' => 'password-123'])->assertOk();
    }

    public function test_per_customer_connection_limit()
    {
        PlatformSettings::save(['platform.max_connections_per_customer' => 1]);
        $customer = User::factory()->create();
        DbConnection::create([
            'user_id' => $customer->id, 'name' => 'Main', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
            'database_name' => 'shop', 'username' => 'reader', 'encrypted_password' => 'x', 'ssl_mode' => 'disabled',
        ]);

        $this->actingAs($customer)->postJson('/api/connections', ['name' => 'Second'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');
    }

    // ------------------------------------------------------------------ Orbit switches

    public function test_turning_orbit_off_refuses_new_requests()
    {
        PlatformSettings::save(['orbit.enabled' => false]);
        $customer = User::factory()->create();

        $this->actingAs($customer)->postJson('/api/agent/conversations/1/messages', ['message' => 'hello'])
            ->assertStatus(503)
            ->assertJsonPath('reason', 'orbit_disabled');
        $this->getJson('/api/platform/config')->assertJsonPath('orbit.enabled', false);
    }

    public function test_turning_orbit_remote_off_refuses_pairing()
    {
        PlatformSettings::save(['orbit.remote_enabled' => false]);
        $customer = User::factory()->create();

        $this->actingAs($customer)->postJson('/api/orbit-remote/sessions', ['instance' => 'tab_AAAAAAAAAAAA'])->assertForbidden();
        $this->getJson('/api/platform/config')->assertJsonPath('orbit.remote_enabled', false);
    }

    // ------------------------------------------------------------------ Orbit knowledge

    /** The migrations add the product guides; these tests start from an empty set of their own. */
    private function withoutShippedGuides(): void
    {
        OrbitKnowledgeGuide::query()->delete();
    }

    private function guide(string $slug = 'billing_guide', bool $published = true): OrbitKnowledgeGuide
    {
        return OrbitKnowledgeGuide::create(['slug' => $slug, 'title' => 'Billing', 'body' => "## Plans\nThe Pro plan has no limits.", 'is_published' => $published, 'sort' => 10]);
    }

    public function test_publishing_sends_included_guides_and_marks_them_live()
    {
        $this->actingAs($this->admin('content_editor'), 'admin');
        $this->withoutShippedGuides();
        Http::fake(['*/v1/rag/product-guides' => Http::response(['success' => true, 'guides' => 1, 'chunks' => 1, 'version' => 'abc123', 'embedding_backend' => 'ollama:nomic-embed-text'])]);
        $live = $this->guide();
        $hidden = $this->guide('old_faq', false);
        $this->assertSame('pending', $live->liveState());

        $res = OrbitKnowledge::publish();

        $this->assertSame(['guides' => 1, 'chunks' => 1, 'version' => 'abc123', 'embedding_backend' => 'ollama:nomic-embed-text'], $res);
        Http::assertSent(fn ($request) => $request['guides'] === [['name' => 'billing_guide', 'title' => 'Billing', 'content' => "## Plans\nThe Pro plan has no limits."]]
            && $request->hasHeader('X-Service-Token'));
        $this->assertSame('live', $live->fresh()->liveState());
        $this->assertSame('hidden', $hidden->fresh()->liveState());
        $this->assertDatabaseHas('admin_activity_logs', ['action' => 'orbit_knowledge.published']);

        // An edit is a draft until the next publish.
        $live->update(['body' => "## Plans\nThe Pro plan allows 10 seats."]);
        $this->assertSame('pending', $live->fresh()->liveState());
    }

    public function test_a_failed_publish_changes_nothing_and_publishing_nothing_is_refused()
    {
        $this->actingAs($this->admin(Admin::SUPER_ADMIN), 'admin');
        $this->withoutShippedGuides();
        $this->guide('draft_only', false);
        try {
            OrbitKnowledge::publish();
            $this->fail('Publishing with no included guide must be refused.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('at least one guide', $e->getMessage());
        }

        Http::fake(['*/v1/rag/product-guides' => Http::response(['detail' => 'Invalid guide name'], 422)]);
        $guide = $this->guide();
        try {
            OrbitKnowledge::publish();
            $this->fail('A refused publish must raise.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Invalid guide name', $e->getMessage());
        }
        $this->assertSame('pending', $guide->fresh()->liveState());
    }

    public function test_guides_live_in_the_database_with_the_brand_filled_in_and_are_resent_when_lost()
    {
        $slugs = OrbitKnowledgeGuide::orderBy('sort')->pluck('slug')->all();
        foreach (['product_context_rag', 'portal_tour', 'automations_guide', 'security_guide', 'data_tools_guide'] as $slug) {
            $this->assertContains($slug, $slugs, "{$slug} is stored in the database");
        }
        $this->assertDirectoryDoesNotExist(base_path('../docs/orbit-agent'), 'no guide is kept as a file');

        config(['platform.brand_name' => 'Acme Pilot']);
        $payload = OrbitKnowledgeGuide::where('slug', 'product_context_rag')->first()->payload();
        $this->assertStringContainsString('Acme Pilot', $payload['title'] . $payload['content']);
        $this->assertStringNotContainsString('{brand}', $payload['title'] . $payload['content']);

        // The AI service still has the guides: nothing is sent.
        Http::fake(['*/v1/rag/product-guides/status' => Http::response(['source' => 'published', 'guides' => 5, 'chunks' => 79])]);
        $this->assertNull(OrbitKnowledge::syncIfLost());
        Http::assertNotSent(fn ($r) => $r->method() === 'POST');
    }

    public function test_guides_are_resent_when_the_ai_service_lost_them()
    {
        Http::fake([
            '*/v1/rag/product-guides/status' => Http::response(['source' => 'none', 'guides' => 0, 'chunks' => 0]),
            '*/v1/rag/product-guides' => Http::response(['success' => true, 'guides' => 5, 'chunks' => 70, 'version' => 'v1', 'embedding_backend' => 'ollama:nomic-embed-text']),
        ]);
        $this->artisan('orbit:sync-knowledge')->assertSuccessful();
        Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/v1/rag/product-guides') && count($r['guides']) >= 5);
    }

    public function test_activity_logs_export_what_is_filtered_as_readable_csv()
    {
        $this->actingAs($this->admin(Admin::SUPER_ADMIN), 'admin');
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $ann = User::factory()->create(['name' => 'Ann Customer']);
        $tricky = User::factory()->create(['name' => '=SUM(1,2)']);
        \App\Models\AuditLog::log($tricky->id, 'AUTOMATION_DELETED', 'Automation', '9');
        \App\Models\AuditLog::log($ann->id, 'AUTOMATION_UPDATED', 'Automation', '7', ['name' => '=HYPERLINK("x")', 'changes' => ['timeout_policy' => ['from' => 'KEEP_DRAFT', 'to' => 'CANCEL']]]);
        \App\Models\AuditLog::log($ann->id, 'CONNECTION_CREATED', 'DbConnection', '3', ['name' => 'Shop', 'database' => 'shop']);

        $page = Livewire::test(\App\Filament\Resources\CustomerActivity\Pages\ListCustomerActivity::class)
            ->filterTable('category', 'automations');
        ob_start();
        $page->instance()->exportCsv()->sendContent();
        $csv = ob_get_clean();

        $this->assertStringStartsWith('time_utc,customer,customer_email,what_happened', $csv);
        $this->assertStringContainsString('timeout_policy: KEEP_DRAFT → CANCEL', $csv);
        $this->assertStringContainsString('Ann Customer', $csv);
        $this->assertStringNotContainsString('Added the connection', $csv, 'only the filtered area is exported');
        $this->assertStringContainsString("'=SUM(1,2)", $csv, 'a cell that would start a formula is neutralised');
        $this->assertStringNotContainsString(',=SUM', $csv);
        $this->assertDatabaseHas('admin_activity_logs', ['action' => 'customer_activity.exported']);

        ob_start();
        Livewire::test(\App\Filament\Resources\AdminActivity\Pages\ListAdminActivity::class)->instance()->exportCsv()->sendContent();
        $adminCsv = ob_get_clean();
        $this->assertStringStartsWith('time_utc,admin,action,subject,changes', $adminCsv);
        $this->assertStringContainsString('Customer activity log', $adminCsv);
    }

    public function test_editing_a_guide_in_the_panel_records_what_changed()
    {
        $editor = $this->admin('content_editor');
        $this->actingAs($editor, 'admin');
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $guide = $this->guide();

        Livewire::test(EditOrbitKnowledge::class, ['record' => $guide->getRouteKey()])
            ->fillForm(['title' => 'Billing and plans', 'body' => "## Plans\nThe Pro plan has no seat limit."])
            ->call('save')
            ->assertHasNoFormErrors();

        $this->assertSame('Billing and plans', $guide->fresh()->title);
        $this->assertSame($editor->id, $guide->fresh()->updated_by);
        $log = AdminActivityLog::where('action', 'orbit_knowledge.updated')->latest('id')->firstOrFail();
        $this->assertEquals(['from' => 'Billing', 'to' => 'Billing and plans'], $log->changes['title']);
        $this->assertEquals(['from' => '36 characters', 'to' => '40 characters'], $log->changes['body']);
    }

    public function test_guide_names_must_be_slugs()
    {
        $this->actingAs($this->admin('content_editor'), 'admin');
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $guide = $this->guide();

        Livewire::test(EditOrbitKnowledge::class, ['record' => $guide->getRouteKey()])
            ->fillForm(['slug' => '../etc/passwd'])
            ->call('save')
            ->assertHasFormErrors(['slug' => 'regex']);
        $this->assertSame('billing_guide', $guide->fresh()->slug);
    }

    // ------------------------------------------------------------------ activity log and system health

    public function test_activity_diff_records_the_value_before_the_save_and_never_secrets()
    {
        $admin = $this->admin(Admin::SUPER_ADMIN, ['name' => 'Before Name']);
        $before = $admin->getAttributes();
        $admin->update(['name' => 'After Name', 'password' => 'another-long-pass-77']);

        $diff = AdminActivity::diff($admin, $before);

        $this->assertSame(['from' => 'Before Name', 'to' => 'After Name'], $diff['name']);
        $this->assertSame('(changed, value not recorded)', $diff['password']);
    }

    public function test_worker_heartbeats_and_failed_jobs_show_only_safe_details()
    {
        $this->assertSame('No worker', SystemHealth::queues()['default']['summary']);
        SystemHealth::workerBeat('default,agent');
        $this->assertSame('Worker running', SystemHealth::queues()['default']['summary']);
        $this->assertSame('Worker running', SystemHealth::queues()['agent']['summary']);

        $job = new FailedJob();
        $job->forceFill([
            'payload' => json_encode(['displayName' => 'App\\Jobs\\PublishAutomationContentJob', 'data' => ['secret' => 'row-content']]),
            'exception' => "RuntimeException: Target refused the write\n#0 /app/Jobs/Publish.php(12): PDO->__construct('mysql:host=db', 'root', 'p4ssw0rd')",
        ]);
        $this->assertSame('PublishAutomationContentJob', $job->jobName());
        $this->assertSame('RuntimeException: Target refused the write', $job->errorLine());
        $this->assertStringNotContainsString('p4ssw0rd', $job->errorLine());
    }

    public function test_environment_list_never_shows_secret_values()
    {
        config(['database.connections.mysql.password' => 'db-secret-value', 'services.ai.key' => 'ai-secret-value']);
        $text = json_encode(SystemHealth::environment());

        $this->assertStringNotContainsString('db-secret-value', $text);
        $this->assertStringNotContainsString('ai-secret-value', $text);
        $this->assertStringNotContainsString((string) config('app.key'), $text);
        $this->assertStringContainsString('Set (never shown)', $text);
    }
}
