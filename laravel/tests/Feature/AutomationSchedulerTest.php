<?php

namespace Tests\Feature;

use App\Jobs\GenerateAutomationContentJob;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\DbConnection;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class AutomationSchedulerTest extends TestCase
{
    use RefreshDatabase;

    private User $user;
    private DbConnection $conn;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->user = User::factory()->create();
        $this->conn = DbConnection::create([
            'user_id' => $this->user->id,
            'name' => 'Target',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3317,
            'database_name' => 'unused',
            'username' => 'root',
            'encrypted_password' => 'x',
            'ssl_mode' => 'disabled',
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function automation(array $attrs): Automation
    {
        return Automation::create($attrs + [
            'user_id' => $this->user->id,
            'connection_id' => $this->conn->id,
            'name' => 'Daily blog',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [['field_name' => 'title', 'mapping_type' => 'AI_GENERATED']],
            'timezone' => 'Asia/Kolkata',
            'generation_time' => '08:30',
            'publication_time' => '09:00',
            'requires_approval' => false,
            'is_active' => true,
            'schedule_anchor_at' => Carbon::parse('2026-10-15 00:00', 'UTC'),
        ]);
    }

    private function tick(string $localTime): void
    {
        Carbon::setTestNow(Carbon::parse($localTime, 'Asia/Kolkata'));
        $this->artisan('automations:check-schedule')->assertExitCode(0);
    }

    public function test_one_time_runs_exactly_once_and_then_completes(): void
    {
        $a = $this->automation(['schedule_type' => 'ONE_TIME', 'start_date' => '2026-10-17']);

        $this->tick('2026-10-17 08:29');
        $this->assertSame(0, AutomationExecution::count(), 'nothing before generation time');

        $this->tick('2026-10-17 08:30');
        $this->tick('2026-10-17 08:31');
        $this->assertSame(1, AutomationExecution::count(), 'exactly one run, never duplicated');
        $exec = AutomationExecution::first();
        $this->assertSame('SCHEDULE', $exec->trigger_type);
        $this->assertSame('2026-10-17', $exec->occurrence_date->format('Y-m-d'));
        $this->assertSame('2026-10-17 03:30:00', $exec->publication_time->utc()->format('Y-m-d H:i:s'));
        Queue::assertPushed(GenerateAutomationContentJob::class, 1);

        // Still in flight: not completed
        $this->assertNull($a->fresh()->completed_at);

        $exec->update(['status' => 'PUBLISHED']);
        $this->tick('2026-10-17 09:05');
        $this->assertNotNull($a->fresh()->completed_at);
        $this->assertSame('COMPLETED', $a->fresh()->scheduleSummary()['state']);

        // Never runs again
        $this->tick('2026-10-18 08:30');
        $this->assertSame(1, AutomationExecution::count());
    }

    public function test_daily_with_end_date_stops_after_last_day(): void
    {
        $a = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17', 'end_date' => '2026-10-18']);

        foreach (['2026-10-17 08:30', '2026-10-18 08:30', '2026-10-19 08:30'] as $t) {
            $this->tick($t);
            AutomationExecution::query()->update(['status' => 'PUBLISHED']);
        }
        $this->assertSame(2, AutomationExecution::count());
        $this->tick('2026-10-19 09:00');
        $this->assertNotNull($a->fresh()->completed_at);
    }

    public function test_weekly_runs_only_on_chosen_weekdays(): void
    {
        // Monday 2026-10-19 and Thursday 2026-10-22
        $this->automation(['schedule_type' => 'WEEKLY', 'start_date' => '2026-10-17', 'weekly_days' => [1, 4]]);

        foreach (['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'] as $d) {
            $this->tick("{$d} 08:30");
        }
        $dates = AutomationExecution::orderBy('id')->get()->map(fn($e) => $e->occurrence_date->format('Y-m-d'))->all();
        $this->assertSame(['2026-10-19', '2026-10-22'], $dates);
    }

    public function test_run_missed_while_scheduler_was_down_is_recorded_not_published(): void
    {
        $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17']);

        // Scheduler comes back after the publication time
        $this->tick('2026-10-17 09:10');
        $exec = AutomationExecution::first();
        $this->assertSame('MISSED', $exec->status);
        $this->assertSame('MISSED_WINDOW', $exec->failure_category);
        Queue::assertNotPushed(GenerateAutomationContentJob::class);
    }

    public function test_runs_before_creation_or_resume_are_not_back_filled(): void
    {
        $a = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17', 'schedule_anchor_at' => Carbon::parse('2026-10-17 08:45', 'Asia/Kolkata')]);
        $this->tick('2026-10-17 08:50');
        $this->assertSame(0, AutomationExecution::count(), "today's 08:30 run predates the automation");

        $this->tick('2026-10-18 08:30');
        $this->assertSame(1, AutomationExecution::count());
    }

    public function test_manual_publish_container_is_never_scheduled(): void
    {
        $this->automation(['schedule_type' => 'NONE', 'operation_mode' => 'MANUAL_SCHEDULE', 'name' => 'Manual: Posts']);
        $this->tick('2026-10-17 08:30');
        $this->assertSame(0, AutomationExecution::count());
    }

    public function test_paused_automation_does_not_run(): void
    {
        $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-17', 'is_active' => false]);
        $this->tick('2026-10-17 08:30');
        $this->assertSame(0, AutomationExecution::count());
    }

    public function test_keep_draft_policy_skips_without_writing_and_late_drafts_are_not_auto_published(): void
    {
        $keep = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-30', 'requires_approval' => true, 'timeout_policy' => 'KEEP_DRAFT']);
        $e1 = AutomationExecution::create([
            'user_id' => $this->user->id, 'automation_id' => $keep->id, 'status' => 'PENDING_APPROVAL',
            'trigger_type' => 'MANUAL', 'idempotency_key' => 'k1', 'publication_time' => Carbon::parse('2026-10-17 09:00', 'Asia/Kolkata'),
        ]);
        ContentVersion::create(['user_id' => $this->user->id, 'execution_id' => $e1->id, 'version_number' => 1, 'payload' => ['title' => 'x'], 'status' => 'PENDING_APPROVAL']);

        $auto = $this->automation(['schedule_type' => 'DAILY', 'start_date' => '2026-10-30', 'requires_approval' => true, 'timeout_policy' => 'AUTO_PUBLISH_LATEST']);
        $e2 = AutomationExecution::create([
            'user_id' => $this->user->id, 'automation_id' => $auto->id, 'status' => 'PENDING_APPROVAL',
            'trigger_type' => 'MANUAL', 'idempotency_key' => 'k2', 'publication_time' => Carbon::parse('2026-10-17 09:00', 'Asia/Kolkata'),
        ]);
        Carbon::setTestNow(Carbon::parse('2026-10-17 09:02', 'Asia/Kolkata'));
        ContentVersion::create(['user_id' => $this->user->id, 'execution_id' => $e2->id, 'version_number' => 1, 'payload' => ['title' => 'late'], 'status' => 'PENDING_APPROVAL']);

        $this->tick('2026-10-17 09:03');

        $this->assertSame('SKIPPED', $e1->fresh()->status);
        $this->assertSame('PENDING_APPROVAL', $e2->fresh()->status, 'a draft finished after the deadline waits for a human');
        $this->assertContains('LATE_DRAFT_HELD', array_column($e2->fresh()->timeline_events, 'stage'));
    }
}
