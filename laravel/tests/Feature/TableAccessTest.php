<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\Data\DataAccessPolicy;
use App\Services\Data\DataChangeService;
use App\Services\Data\DataException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Per-table access on a connection: defaults (blocked credential tables, view-only financial/order/permission/audit
 * tables), the owner's override with an audit record, and the schema view showing what the rules enforce.
 */
class TableAccessTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    private function connection(?array $policy = null): DbConnection
    {
        return DbConnection::create([
            'user_id' => $this->user->id, 'name' => 'Shop', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317,
            'database_name' => 'shopfx_w', 'username' => 'root', 'encrypted_password' => 'fxroot', 'ssl_mode' => 'disabled',
            'access_mode' => 'read_write', 'is_active' => true, 'data_policy' => $policy,
        ]);
    }

    public function test_defaults_cover_credentials_orders_and_permissions()
    {
        $policy = app(DataAccessPolicy::class);
        $c = $this->connection();

        foreach (['api_tokens', 'sessions', 'personal_access_tokens'] as $t) {
            $this->assertSame('blocked', $policy->getTableClass($c, $t), $t);
        }
        foreach (['orders', 'order_items', 'payments', 'audit_events', 'model_has_roles', 'role_has_permissions', 'refunds'] as $t) {
            $this->assertSame('read_only', $policy->getTableClass($c, $t), $t);
        }
        foreach (['products', 'posts', 'categories', 'order_notes_archive'] as $t) {
            $this->assertSame('writable', $policy->getTableClass($c, $t), $t);
        }
    }

    public function test_owner_override_is_applied_audited_and_never_unlocks_blocked_tables()
    {
        $c = $this->connection();

        $this->actingAs($this->user)->putJson("/api/connections/{$c->id}/tables/orders/access", ['access' => 'writable'])
            ->assertOk()->assertJson(['data_class' => 'writable', 'data_class_default' => 'read_only']);
        $this->assertSame('writable', app(DataAccessPolicy::class)->getTableClass($c->fresh(), 'orders'));
        $log = AuditLog::where('action', 'CONNECTION_TABLE_ACCESS_CHANGED')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertEquals(['table' => 'orders', 'before' => 'read_only', 'after' => 'writable', 'choice' => 'writable'], array_intersect_key((array) $log->metadata, array_flip(['table', 'before', 'after', 'choice'])));

        // The owner can also protect an ordinary table, and go back to the default.
        $this->putJson("/api/connections/{$c->id}/tables/products/access", ['access' => 'read_only'])->assertOk()->assertJson(['data_class' => 'read_only']);
        $this->putJson("/api/connections/{$c->id}/tables/products/access", ['access' => 'default'])->assertOk()->assertJson(['data_class' => 'writable']);
        $this->assertArrayNotHasKey('products', $c->fresh()->data_policy['table_overrides']);

        $this->putJson("/api/connections/{$c->id}/tables/api_tokens/access", ['access' => 'writable'])->assertStatus(422);
        $this->putJson("/api/connections/{$c->id}/tables/orders/access", ['access' => 'delete_everything'])->assertStatus(422);

        // A stored override can never unlock a blocked table, and unknown values are ignored.
        $forced = $this->connection(['table_overrides' => ['api_tokens' => 'writable', 'payments' => 'anything']]);
        $this->assertSame('blocked', app(DataAccessPolicy::class)->getTableClass($forced, 'api_tokens'));
        $this->assertSame('read_only', app(DataAccessPolicy::class)->getTableClass($forced, 'payments'));
    }

    public function test_view_only_tables_refuse_writes_until_the_owner_allows_them()
    {
        $c = $this->connection();
        try {
            app(DataChangeService::class)->previewInsert($c, $this->user, 'orders', [[]]);
            $this->fail('orders must be view only by default');
        } catch (DataException $e) {
            $this->assertStringContainsString('orders', $e->getMessage());
        }
    }

    public function test_other_customers_cannot_change_access_and_data_policy_values_are_checked()
    {
        $c = $this->connection();
        $other = User::factory()->create();
        $this->actingAs($other)->putJson("/api/connections/{$c->id}/tables/orders/access", ['access' => 'writable'])->assertNotFound();

        $this->actingAs($this->user)->putJson("/api/connections/{$c->id}", ['data_policy' => ['table_overrides' => ['orders' => 'superuser']]])
            ->assertStatus(422)->assertJsonValidationErrors(['data_policy.table_overrides.orders']);
    }

    public function test_schema_view_shows_table_access_and_column_sensitivity()
    {
        $c = $this->connection(['table_overrides' => ['orders' => 'writable']]);
        $res = $this->actingAs($this->user)->getJson("/api/connections/{$c->id}/schema")->assertOk();
        $tables = collect($res->json('tables'))->keyBy('name');

        $this->assertSame('blocked', $tables['api_tokens']['data_class']);
        $this->assertSame('writable', $tables['orders']['data_class']);
        $this->assertSame('read_only', $tables['orders']['data_class_default']);
        $users = collect($tables['users']['columns'])->keyBy('name');
        $this->assertSame('secret', $users['password_hash']['sensitivity']);
        $this->assertSame('pii', $users['email']['sensitivity']);
        $this->assertSame('standard', $users['id']['sensitivity']);
    }

    public function test_listing_what_is_possible_does_not_fill_the_audit_log()
    {
        $c = $this->connection();
        $c->update(['access_mode' => 'read_only']);
        $before = AuditLog::where('user_id', $this->user->id)->whereIn('action', ['data.write_refused', 'data.delete_refused'])->count();

        $tables = $this->actingAs($this->user)->getJson("/api/data/connections/{$c->id}/tables")->assertOk()->json('tables');
        $this->assertNotEmpty($tables);
        $this->assertFalse(collect($tables)->firstWhere('name', 'products')['permissions']['insert']);
        $this->assertSame($before, AuditLog::where('user_id', $this->user->id)->whereIn('action', ['data.write_refused', 'data.delete_refused'])->count(),
            'showing permissions is not a write attempt');

        // A real attempt is refused and recorded.
        try {
            app(DataChangeService::class)->previewInsert($c->fresh(), $this->user, 'products', [['name' => 'x']]);
            $this->fail('read-only connection must refuse');
        } catch (DataException $e) {
            $this->assertSame('ACCESS_MODE_RESTRICTED', $e->errorCode);
        }
        $this->assertSame($before + 1, AuditLog::where('user_id', $this->user->id)->where('action', 'data.write_refused')->count());
    }
}
