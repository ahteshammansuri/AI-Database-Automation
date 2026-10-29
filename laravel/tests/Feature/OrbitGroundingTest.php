<?php

namespace Tests\Feature;

use App\Models\AgentConversation;
use App\Models\AgentMessage;
use App\Models\DataChangeRequest;
use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Agent\ToolCatalog;
use App\Services\Data\DataException;
use App\Settings\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Orbit acts on what the user chose and on retrieved knowledge, never on a guess of the server: data tools do not pick
 * a database, an action is never assumed, a delete's phrase counts only when the user typed it, and the tool catalog,
 * its policy and Orbit's instructions are data (a fresh installation has all of them).
 */
class OrbitGroundingTest extends TestCase
{
    use RefreshDatabase;

    private function connection(User $user, string $name, string $access = 'read_only'): DbConnection
    {
        $conn = DbConnection::create([
            'user_id' => $user->id, 'name' => $name, 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3399,
            'database_name' => strtolower(str_replace(' ', '_', $name)), 'username' => 'root', 'encrypted_password' => 'x',
            'ssl_mode' => 'disabled', 'access_mode' => $access, 'is_active' => true,
        ]);
        SchemaSnapshot::create(['user_id' => $user->id, 'connection_id' => $conn->id, 'version' => 1, 'schema_payload' => ['tables' => [
            ['name' => 'users', 'columns' => [['name' => 'id', 'type' => 'int', 'is_primary_key' => true], ['name' => 'name', 'type' => 'varchar(100)']]],
            ['name' => 'posts', 'columns' => [['name' => 'id', 'type' => 'int', 'is_primary_key' => true]]],
        ]]]);

        return $conn;
    }

    public function test_data_tools_never_pick_a_database_when_several_are_connected(): void
    {
        $user = User::factory()->create();
        $shop = $this->connection($user, 'Shop DB');
        $blog = $this->connection($user, 'Blog DB');

        foreach ([
            ['preview_data_change', ['table' => 'users', 'action' => 'insert', 'rows' => [['name' => 'Test User']]]],
            ['find_dummy_data', ['table' => 'users']],
            ['ask_database', ['question' => 'How many users are there?']],
        ] as [$tool, $args]) {
            $res = AgentToolRegistry::executeTool($user, $tool, $args);
            $this->assertFalse($res['success'], $tool);
            $this->assertSame('CONNECTION_REQUIRED', $res['error_category'], $tool);
            $this->assertSame([$shop->id, $blog->id], array_column($res['connections'], 'id'), $tool);
        }
        $res = AgentToolRegistry::executeTool($user, 'preview_data_change', ['table' => 'users', 'action' => 'insert', 'rows' => [['name' => 'x']]]);
        $this->assertSame([true, true], array_column($res['connections'], 'has_table'));
        $this->assertStringContainsString('Shop DB (connection_id ' . $shop->id, $res['error']);
        $this->assertSame(0, DataChangeRequest::count(), 'nothing was prepared');
    }

    public function test_a_missing_action_is_an_error_not_a_delete(): void
    {
        $user = User::factory()->create();
        $only = $this->connection($user, 'Shop DB', 'read_write_delete');

        // One connection: it is used without asking; the action is still never assumed.
        $res = AgentToolRegistry::executeTool($user, 'preview_data_change', ['table' => 'posts', 'ids' => [1]]);

        $this->assertSame('INVALID_ARGS', $res['error_category']);
        $this->assertSame($only->id, $res['connection_id']);
        $this->assertSame(0, DataChangeRequest::count());
    }

    public function test_a_deletes_phrase_counts_only_when_the_user_typed_it(): void
    {
        $user = User::factory()->create();
        $conn = $this->connection($user, 'Shop DB', 'read_write_delete');
        $change = DataChangeRequest::create([
            'user_id' => $user->id, 'connection_id' => $conn->id, 'action' => 'delete', 'target_table' => 'posts',
            'primary_keys' => [1], 'affected_count' => 1, 'confirmation_phrase' => 'DELETE 1 ROW FROM posts',
            'status' => 'pending_confirmation', 'expires_at' => now()->addMinutes(30),
        ]);
        $conversation = AgentConversation::create(['user_id' => $user->id, 'title' => 'Orbit']);
        AgentMessage::create(['conversation_id' => $conversation->id, 'role' => 'user', 'content' => 'yes go ahead']);

        // The model saw the phrase in the preview and passes it on: it does not count.
        try {
            AgentToolRegistry::executeTool($user, 'confirm_data_change', [
                'change_request_id' => $change->id, 'typed_phrase' => 'DELETE 1 ROW FROM posts', 'confirmation_phrase' => 'DELETE 1 ROW FROM posts',
            ]);
            $this->fail('A phrase the user did not type was accepted.');
        } catch (DataException $e) {
            $this->assertSame('TYPED_CONFIRMATION_REQUIRED', $e->errorCode);
        }
        $this->assertSame('pending_confirmation', $change->fresh()->status);
    }

    public function test_a_fresh_installation_has_the_whole_tool_catalog_with_its_policy(): void
    {
        $shipped = json_decode((string) file_get_contents(resource_path('orbit/tools.json')), true)['tools'];
        $this->assertSame(count($shipped), DB::table('orbit_tools')->count());

        $save = AgentToolRegistry::definition('save_database_connection');
        $this->assertSame(['password' => 'database_password'], $save['secret_params']);
        $this->assertSame('connection_persisted', $save['postcondition']);
        $this->assertTrue(AgentToolRegistry::definition('disconnect_database_connection')['confirm_by_button']);
        $this->assertSame('read', AgentToolRegistry::definition('search_orbit_knowledge')['side_effect_class']);
        $this->assertSame(['insert', 'update', 'delete'], AgentToolRegistry::definition('preview_data_change')['parameters']['properties']['action']['enum']);
    }

    public function test_a_secret_named_argument_is_always_filled_from_the_vault_whatever_the_catalog_says(): void
    {
        // An administrator edits the tool and empties its vault arguments: the password still never reaches the model.
        DB::table('orbit_tools')->where('name', 'save_database_connection')->update(['secret_params' => json_encode((object) [])]);
        AgentToolRegistry::flushCache();

        $def = AgentToolRegistry::definition('save_database_connection');
        $this->assertSame('database_password', $def['secret_params']['password']);
        $this->assertArrayNotHasKey('password', (array) AgentToolRegistry::modelParameterSchema($def)['properties']);
        AgentToolRegistry::flushCache();
    }

    public function test_an_administrators_edit_of_a_tool_survives_a_catalog_update(): void
    {
        DB::table('orbit_tools')->where('name', 'list_automations')->update(['description' => 'Our own wording.', 'updated_by' => 1]);

        ToolCatalog::sync();

        $this->assertSame('Our own wording.', DB::table('orbit_tools')->where('name', 'list_automations')->value('description'));
    }

    public function test_orbits_instructions_and_operating_knowledge_are_data(): void
    {
        foreach (['orbit.system_prompt', 'orbit.route_instructions', 'orbit.answer_instructions'] as $key) {
            $this->assertNotSame('', trim((string) PlatformSettings::get($key)), $key);
            $this->assertTrue(DB::table('platform_settings')->where('key', $key)->exists(), "{$key} is stored, not a code default");
        }
        $guide = DB::table('orbit_knowledge_guides')->where('slug', 'orbit_operating_guide')->first();
        $this->assertNotNull($guide);
        foreach (['## Which database a request is about', '## Adding rows, also dummy or test rows', 'search_orbit_knowledge', 'CONNECTION_REQUIRED'] as $part) {
            $this->assertStringContainsString($part, $guide->body);
        }
    }
}
