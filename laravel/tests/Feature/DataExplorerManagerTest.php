<?php

namespace Tests\Feature;

use App\Jobs\RunDataAutopilotJob;
use App\Models\DataAutopilot;
use App\Models\DataChangeRequest;
use App\Models\DbConnection;
use App\Models\User;
use App\Settings\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use PDO;
use Tests\TestCase;

/**
 * Data Explorer and Data Manager on the writable fixture database (shopfx_w, scripts/fixtures.sh): browsing with
 * links shown by name, validated previews, confirm -> pinned write -> undo, permissions per access mode, AI sample rows
 * (only valid rows are kept) and the data autopilot. Every row a test adds is removed again.
 */
class DataExplorerManagerTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    private function target(): PDO
    {
        return new PDO('mysql:host=127.0.0.1;port=3317;dbname=shopfx_w', 'root', 'fxroot', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    private function connection(string $mode = 'read_write'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $this->user->id, 'name' => 'Shop', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317,
            'database_name' => 'shopfx_w', 'username' => 'root', 'encrypted_password' => 'fxroot', 'ssl_mode' => 'disabled',
            'access_mode' => $mode, 'is_active' => true,
        ]);
    }

    private function base(DbConnection $c, string $table = 'products'): string
    {
        return "/api/data/connections/{$c->id}/tables/{$table}";
    }

    public function test_rows_are_listed_with_links_by_name_search_sort_and_paging()
    {
        $c = $this->connection('read_only');
        $res = $this->actingAs($this->user)->getJson($this->base($c) . '/rows?per_page=5&sort=price&dir=desc')->assertOk();

        $this->assertSame(['id'], $res->json('primary_key'));
        $this->assertCount(5, $res->json('rows'));
        $prices = array_map('floatval', array_column($res->json('rows'), 'price'));
        $this->assertSame($prices, collect($prices)->sortDesc()->values()->all());
        $catId = (string) $res->json('rows.0.category_id');
        $this->assertNotEmpty($res->json("labels.category_id.{$catId}"), 'linked category shown by its name');
        $this->assertSame(['table' => 'categories', 'column' => 'id'], $res->json('columns.' . array_search('category_id', array_column($res->json('columns'), 'name')) . '.link'));
        $this->assertFalse($res->json('permissions.insert'), 'read-only connections cannot be changed');
        $this->assertGreaterThan(5, $res->json('total'));

        $name = $res->json('rows.0.name');
        $found = $this->getJson($this->base($c) . '/rows?search=' . urlencode(substr($name, 0, 6)))->assertOk();
        $this->assertContains($name, array_column($found->json('rows'), 'name'));
    }

    public function test_protected_tables_are_never_shown_and_other_customers_connections_are_not_found()
    {
        $c = $this->connection();
        $this->actingAs($this->user)->getJson($this->base($c, 'api_tokens') . '/rows')->assertStatus(422);
        $tables = collect($this->getJson("/api/data/connections/{$c->id}/tables")->assertOk()->json('tables'))->keyBy('name');
        $this->assertTrue($tables['api_tokens']['blocked']);
        $this->assertTrue($tables['products']['permissions']['insert']);
        $this->assertFalse($tables['products']['permissions']['delete'], 'deletes need read_write_delete');

        $other = User::factory()->create();
        $this->actingAs($other)->getJson($this->base($c) . '/rows')->assertNotFound();
    }

    public function test_insert_is_validated_then_confirmed_then_undone()
    {
        $c = $this->connection();
        $existingSku = $this->target()->query('SELECT sku FROM products LIMIT 1')->fetchColumn();

        $bad = $this->actingAs($this->user)->postJson($this->base($c) . '/preview-insert', ['rows' => [
            ['sku' => $existingSku, 'name' => '', 'category_id' => 999999, 'price' => 'cheap', 'is_active' => 'maybe'],
        ]])->assertStatus(422);
        $errors = $bad->json('row_errors.0');
        $this->assertSame(['category_id', 'is_active', 'name', 'price', 'sku'], collect($errors)->keys()->sort()->values()->all(), 'every problem is reported at once');

        $bad2 = $this->postJson($this->base($c) . '/preview-insert', ['rows' => [
            ['sku' => $existingSku, 'name' => 'Duplicate', 'category_id' => 999999, 'price' => '5.00'],
        ]])->assertStatus(422);
        $this->assertStringContainsString('unique', $bad2->json('row_errors.0.sku'));
        $this->assertStringContainsString('categories', $bad2->json('row_errors.0.category_id'));

        $sku = 'QA-' . strtoupper(substr(uniqid(), -8));
        $categoryId = (int) $this->target()->query('SELECT id FROM categories LIMIT 1')->fetchColumn();
        $preview = $this->postJson($this->base($c) . '/preview-insert', ['rows' => [
            ['sku' => $sku, 'name' => 'Linen tote bag', 'category_id' => $categoryId, 'price' => '39.50', 'is_active' => true],
        ]])->assertOk();
        $this->assertSame(0, (int) $this->target()->query("SELECT COUNT(*) FROM products WHERE sku = '{$sku}'")->fetchColumn(), 'nothing written before confirmation');

        $done = $this->postJson('/api/data/changes/' . $preview->json('change_request_id') . '/confirm')->assertOk();
        $newId = $done->json('primary_keys.0');
        $row = $this->target()->query("SELECT * FROM products WHERE sku = '{$sku}'")->fetch(PDO::FETCH_ASSOC);
        $this->assertSame((string) $newId, (string) $row['id']);
        $this->assertSame('39.50', $row['price']);
        $this->assertSame(1, (int) $row['is_active']);

        $this->postJson('/api/data/changes/' . $preview->json('change_request_id') . '/undo')->assertOk();
        $this->assertSame(0, (int) $this->target()->query("SELECT COUNT(*) FROM products WHERE sku = '{$sku}'")->fetchColumn());
        $this->assertSame('undone', DataChangeRequest::find($preview->json('change_request_id'))->status);
    }

    public function test_update_changes_only_the_previewed_row_and_can_be_undone()
    {
        $c = $this->connection();
        [$id, $stock] = $this->target()->query('SELECT id, stock FROM products ORDER BY id LIMIT 1')->fetch(PDO::FETCH_NUM);

        $this->actingAs($this->user)->postJson($this->base($c) . '/preview-update', ['key' => $id, 'values' => ['stock' => 'many']])->assertStatus(422)
            ->assertJsonPath('row_errors.0.stock', 'Enter a whole number.');
        $this->postJson($this->base($c) . '/preview-update', ['key' => $id, 'values' => ['id' => 5]])->assertStatus(422);

        $preview = $this->postJson($this->base($c) . '/preview-update', ['key' => $id, 'values' => ['stock' => (int) $stock + 7]])->assertOk();
        $this->assertSame([$id], array_map('intval', $preview->json('primary_keys')));
        $this->postJson('/api/data/changes/' . $preview->json('change_request_id') . '/confirm')->assertOk();
        $this->assertSame((int) $stock + 7, (int) $this->target()->query("SELECT stock FROM products WHERE id = {$id}")->fetchColumn());

        $this->postJson('/api/data/changes/' . $preview->json('change_request_id') . '/undo')->assertOk();
        $this->assertSame((int) $stock, (int) $this->target()->query("SELECT stock FROM products WHERE id = {$id}")->fetchColumn());
    }

    public function test_delete_needs_delete_mode_and_the_typed_phrase()
    {
        $c = $this->connection('read_write');
        $sku = 'QA-DEL-' . strtoupper(substr(uniqid(), -6));
        $categoryId = (int) $this->target()->query('SELECT id FROM categories LIMIT 1')->fetchColumn();
        $this->target()->exec("INSERT INTO products (sku, name, category_id, price) VALUES ('{$sku}', 'Temp', {$categoryId}, 1.00)");
        $id = (int) $this->target()->query("SELECT id FROM products WHERE sku = '{$sku}'")->fetchColumn();

        try {
            $this->actingAs($this->user)->postJson($this->base($c) . '/preview-delete', ['key' => $id])->assertStatus(422)->assertJsonPath('code', 'DELETE_NOT_ENABLED');

            $c->update(['access_mode' => 'read_write_delete']);
            $preview = $this->postJson($this->base($c) . '/preview-delete', ['key' => $id])->assertOk();
            $this->postJson('/api/data/changes/' . $preview->json('change_request_id') . '/confirm', ['typed_phrase' => 'yes'])->assertStatus(422);
            $this->postJson('/api/data/changes/' . $preview->json('change_request_id') . '/confirm', ['typed_phrase' => $preview->json('confirmation_phrase')])->assertOk();
            $this->assertSame(0, (int) $this->target()->query("SELECT COUNT(*) FROM products WHERE id = {$id}")->fetchColumn());
        } finally {
            $this->target()->exec("DELETE FROM products WHERE sku = '{$sku}'");
        }
    }

    public function test_ai_sample_rows_keep_only_rows_that_pass_every_check()
    {
        $c = $this->connection();
        $categoryId = (int) $this->target()->query('SELECT id FROM categories LIMIT 1')->fetchColumn();
        $existingSku = $this->target()->query('SELECT sku FROM products LIMIT 1')->fetchColumn();
        $skuA = 'QA-AI-' . strtoupper(substr(uniqid(), -6));
        Http::fake(['*/v1/ai/sample-rows' => Http::response(['success' => true, 'requested' => 3, 'problems' => [], 'seconds' => 4.2, 'rows' => [
            ['sku' => $skuA, 'name' => 'Raffia sandal', 'category_id' => $categoryId, 'price' => 45, 'stock' => 12, 'is_active' => true, 'description' => 'Woven summer sandal.'],
            ['sku' => $existingSku, 'name' => 'Copy', 'category_id' => $categoryId, 'price' => 10, 'stock' => 1, 'is_active' => true, 'description' => null],  // sku taken
            ['sku' => 'QA-AI-BAD', 'name' => 'Broken', 'category_id' => $categoryId, 'price' => 'free', 'stock' => 1, 'is_active' => true, 'description' => null], // not a number
        ]])]);

        $res = $this->actingAs($this->user)->postJson($this->base($c) . '/sample-rows', ['count' => 3, 'instructions' => 'summer shoes'])->assertOk();
        $this->assertSame(1, $res->json('affected_count'));
        $this->assertCount(2, $res->json('dropped'));
        Http::assertSent(function ($r) {
            $cols = collect($r['columns'])->keyBy('name');
            return $r['table'] === 'products' && $r['count'] === 3 && $cols['sku']['unique'] === true
                && !$cols->has('id') && !$cols->has('created_at') && count($cols['category_id']['link']['options']) > 0;
        });

        $this->postJson('/api/data/changes/' . $res->json('change_request_id') . '/confirm')->assertOk();
        $this->assertSame(1, (int) $this->target()->query("SELECT COUNT(*) FROM products WHERE sku = '{$skuA}'")->fetchColumn());
        $this->postJson('/api/data/changes/' . $res->json('change_request_id') . '/undo')->assertOk();
        $this->assertSame(0, (int) $this->target()->query("SELECT COUNT(*) FROM products WHERE sku = '{$skuA}'")->fetchColumn());
    }

    public function test_autopilot_is_validated_and_a_run_adds_rows_for_the_owner_only()
    {
        $c = $this->connection();
        $this->actingAs($this->user)->postJson('/api/data/autopilots', [
            'connection_id' => $c->id, 'table_name' => 'products', 'name' => 'Nightly products', 'rows_per_run' => 2,
            'frequency' => 'weekly', 'run_time' => '25:00', 'timezone' => 'Mars/Base',
        ])->assertStatus(422)->assertJsonValidationErrors(['run_time', 'timezone', 'weekdays']);

        $res = $this->postJson('/api/data/autopilots', [
            'connection_id' => $c->id, 'table_name' => 'products', 'name' => 'Nightly products', 'rows_per_run' => 1,
            'frequency' => 'daily', 'run_time' => '02:00', 'timezone' => 'Asia/Kolkata', 'instructions' => 'travel accessories',
        ])->assertCreated();
        $pilot = DataAutopilot::findOrFail($res->json('autopilot.id'));
        $this->assertNotNull($pilot->next_run_at);
        $this->assertSame('02:00', $pilot->next_run_at->setTimezone('Asia/Kolkata')->format('H:i'));

        $sku = 'QA-AP-' . strtoupper(substr(uniqid(), -6));
        $categoryId = (int) $this->target()->query('SELECT id FROM categories LIMIT 1')->fetchColumn();
        Http::fake(['*/v1/ai/sample-rows' => Http::response(['success' => true, 'requested' => 1, 'problems' => [], 'seconds' => 2, 'rows' => [
            ['sku' => $sku, 'name' => 'Packing cubes', 'category_id' => $categoryId, 'price' => 24, 'stock' => 5, 'is_active' => true, 'description' => 'Set of three.'],
        ]])]);
        try {
            (new RunDataAutopilotJob($pilot->id))->handle(app(\App\Services\Data\SampleDataService::class), app(\App\Services\Data\DataChangeService::class));
            $pilot->refresh();
            $this->assertSame('added', $pilot->last_status, (string) $pilot->last_message);
            $this->assertSame(1, $pilot->rows_added);
            $this->assertSame(1, (int) $this->target()->query("SELECT COUNT(*) FROM products WHERE sku = '{$sku}'")->fetchColumn());
            $this->assertSame('autopilot', DataChangeRequest::find($pilot->last_change_id)->patch_values['source']);
        } finally {
            $this->target()->exec("DELETE FROM products WHERE sku = '{$sku}'");
        }

        $other = User::factory()->create();
        $this->actingAs($other)->putJson("/api/data/autopilots/{$pilot->id}", ['is_active' => false])->assertNotFound();
    }

    public function test_admin_switches_turn_the_tools_off()
    {
        $c = $this->connection();
        PlatformSettings::save(['features.data_manager' => false]);
        $this->actingAs($this->user)->getJson($this->base($c) . '/rows')->assertOk()->assertJsonPath('permissions.insert', false);
        $this->postJson($this->base($c) . '/preview-insert', ['rows' => [['name' => 'x']]])->assertForbidden();

        PlatformSettings::save(['features.data_explorer' => false]);
        $this->getJson($this->base($c) . '/rows')->assertForbidden();
    }
}
