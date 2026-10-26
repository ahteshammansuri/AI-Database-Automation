<?php

namespace Tests\Feature;

use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\DbConnection;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Agent\SurfaceCatalog;
use App\Services\Agent\VisibleEquivalent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * With the portal open, Orbit carries out actions on screen (go to the page, press the page's own button) and the
 * server checks the real state afterwards. Only exact equivalents are mapped; anything else uses the backend tool.
 */
class OrbitVisibleActionsTest extends TestCase
{
    use RefreshDatabase;

    private function automation(User $user, bool $active): Automation
    {
        $connection = DbConnection::create([
            'user_id' => $user->id, 'name' => 'Shop ' . uniqid(), 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317,
            'database_name' => 'shopfx_w', 'username' => 'root', 'encrypted_password' => 'fxroot', 'ssl_mode' => 'disabled', 'access_mode' => 'read_only', 'is_active' => true,
        ]);

        return Automation::create([
            'user_id' => $user->id, 'connection_id' => $connection->id, 'name' => 'Blog', 'target_table' => 'posts', 'operation_mode' => 'AI_CREATE',
            'field_mappings' => [['field_name' => 'title', 'mapping_type' => 'AI_GENERATED']], 'schedule_type' => 'NONE', 'timezone' => 'UTC',
            'timeout_policy' => 'KEEP_DRAFT', 'is_active' => $active,
        ]);
    }

    public function test_only_exact_equivalents_are_done_on_screen()
    {
        $this->assertSame([
            ['tool' => 'go_to_page', 'args' => ['page' => '/automations']],
            ['tool' => 'press', 'args' => ['surface' => 'automations.list', 'action' => 'pause', 'row' => '7']],
        ], VisibleEquivalent::steps('update_automation', ['automation_id' => 7, 'is_active' => false]));
        $this->assertSame('resume', VisibleEquivalent::steps('update_automation', ['automation_id' => 7, 'is_active' => true])[1]['args']['action']);

        // Any other change, an unknown tool or a missing id goes through the backend tool.
        $this->assertNull(VisibleEquivalent::steps('update_automation', ['automation_id' => 7, 'is_active' => false, 'name' => 'New']));
        $this->assertNull(VisibleEquivalent::steps('update_automation', ['automation_id' => 7, 'name' => 'New']));
        $this->assertNull(VisibleEquivalent::steps('save_database_connection', ['name' => 'x']));
        $this->assertNull(VisibleEquivalent::steps('run_automation_now', ['automation_id' => 'abc']));

        $reject = VisibleEquivalent::steps('reject_content_version', ['version_id' => 4, 'feedback' => 'Shorter please']);
        $this->assertSame(['go_to_page', 'fill_fields', 'press'], array_column($reject, 'tool'));
        $this->assertSame(['reject_feedback' => 'Shorter please'], $reject[1]['args']['values']);
        $this->assertSame('pause', VisibleEquivalent::steps('request_execution_interrupt', ['execution_id' => 3, 'action' => 'pause'])[1]['args']['action']);
        $this->assertSame('cancel', VisibleEquivalent::steps('request_execution_interrupt', ['execution_id' => 3])[1]['args']['action']);

        // Every step is a real catalogued tool, page and surface action.
        foreach (['run_automation_now' => ['automation_id' => 1], 'retry_execution' => ['execution_id' => 1], 'approve_content_version' => ['version_id' => 1], 'remove_automation' => ['automation_id' => 1]] as $tool => $args) {
            foreach (VisibleEquivalent::steps($tool, $args) as $step) {
                $this->assertNotNull(AgentToolRegistry::definition($step['tool']), $step['tool']);
                $this->assertTrue(SurfaceCatalog::check($step['tool'], $step['args'])['ok'], "{$tool}: {$step['tool']}");
            }
        }
    }

    public function test_the_real_state_is_checked_after_the_press()
    {
        $user = User::factory()->create();
        $paused = $this->automation($user, false);
        $since = now()->subMinute();

        $this->assertTrue(VisibleEquivalent::verify('update_automation', ['automation_id' => $paused->id, 'is_active' => false], $user->id, $since)['ok']);
        $this->assertFalse(VisibleEquivalent::verify('update_automation', ['automation_id' => $paused->id, 'is_active' => true], $user->id, $since)['ok']);

        // Another customer's automation never verifies.
        $other = User::factory()->create();
        $this->assertFalse(VisibleEquivalent::verify('update_automation', ['automation_id' => $paused->id, 'is_active' => false], $other->id, $since)['ok']);

        $none = VisibleEquivalent::verify('run_automation_now', ['automation_id' => $paused->id], $user->id, now());
        $this->assertFalse($none['ok'], 'a press without a new run is not reported as started');
    }

    public function test_the_interrupt_tool_never_rewrites_a_finished_run()
    {
        $user = User::factory()->create();
        $automation = $this->automation($user, true);
        $published = AutomationExecution::create(['user_id' => $user->id, 'automation_id' => $automation->id, 'status' => 'PUBLISHED', 'idempotency_key' => 'k-' . uniqid()]);
        $failed = AutomationExecution::create(['user_id' => $user->id, 'automation_id' => $automation->id, 'status' => 'FAILED', 'idempotency_key' => 'k-' . uniqid()]);

        $call = fn (array $args) => (new \ReflectionMethod(AgentToolRegistry::class, 'requestExecutionInterrupt'))->invoke(null, $user, $args);

        $this->assertFalse($call(['execution_id' => $published->id, 'action' => 'cancel'])['success']);
        $this->assertSame('PUBLISHED', $published->fresh()->status);
        $this->assertFalse($call(['execution_id' => $failed->id, 'action' => 'pause'])['success']);
        $this->assertTrue($call(['execution_id' => $failed->id, 'action' => 'cancel'])['success']);
        $this->assertSame('FAILED', $failed->fresh()->status, 'an already stopped run keeps its real outcome');
    }
}
