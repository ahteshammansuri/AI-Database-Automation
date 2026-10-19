<?php

namespace Tests\Feature;

use App\Jobs\GenerateAutomationContentJob;
use App\Jobs\PublishAutomationContentJob;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\Concerns\UsesAutomationFixtureDatabase;
use Tests\TestCase;

/**
 * Orbit's automation/execution/approval tools, called exactly the way the agent loop calls them.
 * Previously four of them dispatched job classes that did not exist.
 */
class OrbitAutomationToolsTest extends TestCase
{
    use RefreshDatabase, UsesAutomationFixtureDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->user = User::factory()->create();
    }

    protected function tearDown(): void
    {
        $this->dropFixtureBlogDatabase();
        parent::tearDown();
    }

    private function automation(array $over = []): Automation
    {
        $conn = $this->fixtureConnection($this->user, $this->fixtureDb ?? 'unused_db');
        return Automation::create($over + [
            'user_id' => $this->user->id,
            'connection_id' => $conn->id,
            'name' => 'Daily blog',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [['field_name' => 'title', 'mapping_type' => 'AI_GENERATED']],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:30',
            'publication_time' => '09:00',
            'timezone' => 'Asia/Kolkata',
            'requires_approval' => true,
            'is_active' => true,
        ]);
    }

    private function pendingDraft(Automation $a, $publicationTime): array
    {
        $e = AutomationExecution::create([
            'user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'PENDING_APPROVAL',
            'idempotency_key' => uniqid('k'), 'publication_time' => $publicationTime,
        ]);
        $v = ContentVersion::create([
            'user_id' => $this->user->id, 'execution_id' => $e->id, 'version_number' => 1,
            'payload' => ['title' => 'Indexing basics'], 'meta' => ['fields' => [['column' => 'title', 'kind' => 'title']], 'can_publish' => true],
            'status' => 'PENDING_APPROVAL',
        ]);
        return [$e, $v];
    }

    public function test_run_now_creates_a_claimable_run_and_dispatches_the_real_job(): void
    {
        $a = $this->automation();
        $res = AgentToolRegistry::executeTool($this->user, 'run_automation_now', ['automation_id' => $a->id]);

        $this->assertTrue($res['success'], json_encode($res));
        $e = AutomationExecution::findOrFail($res['execution_id']);
        $this->assertSame('PENDING_GENERATION', $e->status);
        $this->assertSame('MANUAL', $e->trigger_type);
        $this->assertTrue($e->publication_time->isFuture());
        Queue::assertPushed(GenerateAutomationContentJob::class, fn($job) => $job->executionId === $e->id);
    }

    public function test_pending_approvals_list_ids_and_titles(): void
    {
        [, $v] = $this->pendingDraft($this->automation(), now()->addHour());
        $res = AgentToolRegistry::executeTool($this->user, 'get_pending_approvals', []);
        $this->assertTrue($res['success']);
        $this->assertSame($v->id, $res['pending'][0]['version_id']);
        $this->assertSame('Indexing basics', $res['pending'][0]['title']);
    }

    public function test_drafts_whose_run_ended_are_no_longer_listed_for_approval(): void
    {
        [$e] = $this->pendingDraft($this->automation(), now()->subMinute());
        // The scheduler skipped it at the deadline ("keep as draft"): it can no longer be approved.
        $e->refresh()->update(['status' => 'SKIPPED']);

        $this->assertSame(0, AgentToolRegistry::executeTool($this->user, 'get_pending_approvals', [])['count']);
        $this->actingAs($this->user)->getJson('/api/approvals')->assertOk()->assertJsonCount(0);
    }

    public function test_approve_holds_until_publication_time_and_cannot_be_repeated(): void
    {
        [$e, $v] = $this->pendingDraft($this->automation(), now()->addHour());
        $res = AgentToolRegistry::executeTool($this->user, 'approve_content_version', ['version_id' => $v->id]);
        $this->assertTrue($res['success'], json_encode($res));
        $this->assertSame('APPROVED', $e->fresh()->status);
        $this->assertSame('APPROVED', $v->fresh()->status);
        Queue::assertNotPushed(PublishAutomationContentJob::class);

        $again = AgentToolRegistry::executeTool($this->user, 'approve_content_version', ['version_id' => $v->id]);
        $this->assertFalse($again['success']);
    }

    public function test_approve_after_publication_time_publishes_now(): void
    {
        [$e, $v] = $this->pendingDraft($this->automation(), now()->subMinute());
        $res = AgentToolRegistry::executeTool($this->user, 'approve_content_version', ['version_id' => $v->id]);
        $this->assertTrue($res['success']);
        $this->assertSame('PUBLISHING', $e->fresh()->status);
        Queue::assertPushed(PublishAutomationContentJob::class, fn($job) => $job->executionId === $e->id);
    }

    public function test_reject_regenerates_with_feedback_and_stops_after_three(): void
    {
        [$e, $v] = $this->pendingDraft($this->automation(), now()->addHour());
        $res = AgentToolRegistry::executeTool($this->user, 'reject_content_version', ['version_id' => $v->id, 'feedback' => 'Shorter title']);
        $this->assertTrue($res['success']);
        $this->assertSame('REGENERATING', $e->fresh()->status);
        Queue::assertPushed(GenerateAutomationContentJob::class, fn($job) => $job->executionId === $e->id && $job->rejectionFeedback === 'Shorter title');

        // Two earlier rejections exist: the third stops the run.
        foreach ([2, 3] as $n) {
            ContentVersion::create(['user_id' => $this->user->id, 'execution_id' => $e->id, 'version_number' => $n, 'payload' => ['title' => 'x'], 'status' => $n === 2 ? 'REJECTED' : 'PENDING_APPROVAL']);
        }
        $e->refresh()->update(['status' => 'PENDING_APPROVAL']);
        $third = ContentVersion::where('execution_id', $e->id)->where('version_number', 3)->first();
        $res = AgentToolRegistry::executeTool($this->user, 'reject_content_version', ['version_id' => $third->id, 'feedback' => 'Still wrong']);
        $this->assertTrue($res['success'], json_encode($res));
        $this->assertSame('FAILED', $e->fresh()->status);
        $this->assertSame('MAX_REJECTIONS_EXCEEDED', $e->fresh()->failure_category);
    }

    public function test_retry_requeues_failed_runs_but_not_in_flight_ones(): void
    {
        $a = $this->automation();
        $failed = AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'FAILED', 'idempotency_key' => 'f1', 'publication_time' => now()->subHour()]);
        $res = AgentToolRegistry::executeTool($this->user, 'retry_execution', ['execution_id' => $failed->id]);
        $this->assertTrue($res['success']);
        $this->assertSame('QUEUED', $failed->fresh()->status);
        $this->assertTrue($failed->fresh()->publication_time->isFuture(), 'a retried run gets a fresh review window');

        $busy = AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'GENERATING', 'idempotency_key' => 'b1']);
        $this->assertFalse(AgentToolRegistry::executeTool($this->user, 'retry_execution', ['execution_id' => $busy->id])['success']);
    }

    public function test_list_executions_filters_by_automation_name(): void
    {
        $a = $this->automation(['name' => 'Weekly cloud digest']);
        $b = $this->automation(['name' => 'Product copy']);
        AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'PUBLISHED', 'idempotency_key' => 'x1']);
        AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $b->id, 'status' => 'FAILED', 'idempotency_key' => 'x2']);
        $res = AgentToolRegistry::executeTool($this->user, 'list_executions', ['automation_name' => 'cloud']);
        $this->assertCount(1, $res['executions']);
        $this->assertSame('Weekly cloud digest', $res['executions'][0]['automation']);
    }

    public function test_create_uses_live_schema_defaults_and_the_schedule_rules(): void
    {
        $this->createFixtureBlogDatabase();
        $conn = $this->fixtureConnection($this->user, $this->fixtureDb);

        $bad = AgentToolRegistry::executeTool($this->user, 'create_automation_draft', [
            'connection_id' => $conn->id, 'target_table' => 'posts', 'name' => 'Tight',
            'generation_time' => '08:50', 'publication_time' => '09:00', 'timezone' => 'Asia/Kolkata',
        ]);
        $this->assertFalse($bad['success']);
        $this->assertStringContainsString('15 minutes', $bad['error']);

        $protected = AgentToolRegistry::executeTool($this->user, 'create_automation_draft', [
            'connection_id' => $conn->id, 'target_table' => 'users', 'name' => 'Nope',
        ]);
        $this->assertFalse($protected['success']);

        $ok = AgentToolRegistry::executeTool($this->user, 'create_automation_draft', [
            'connection_id' => $conn->id, 'target_table' => 'posts', 'name' => 'Cloud tips',
            'topic_prompt' => 'Cloud database tips', 'category_name' => 'Cloud',
            'schedule_type' => 'WEEKLY', 'weekly_days' => [1, 4], 'start_date' => now('Asia/Kolkata')->addDay()->toDateString(),
            'end_date' => now('Asia/Kolkata')->addDays(30)->toDateString(),
            'generation_time' => '09:00', 'publication_time' => '10:00', 'timezone' => 'Asia/Kolkata', 'length' => 'short',
        ]);
        $this->assertTrue($ok['success'], json_encode($ok));
        $a = Automation::findOrFail($ok['automation_id']);
        $this->assertSame([1, 4], $a->weekly_days);
        $this->assertSame('short', $a->generation_options['length']);
        $mappings = collect($a->field_mappings)->keyBy('field_name');
        $this->assertSame('AI_GENERATED', $mappings['category_id']['mapping_type']);
        $this->assertStringContainsString('Cloud', $mappings['category_id']['instructions']);
        $this->assertSame('DERIVED_SLUG', $mappings['slug']['mapping_type']);
        $this->assertNotNull($a->schedule_anchor_at);
        $this->assertStringContainsString('every Monday and Thursday', $ok['schedule']);
    }

    public function test_update_published_record_edits_only_that_row_and_never_secrets(): void
    {
        $this->createFixtureBlogDatabase();
        $a = $this->automation();
        $e = AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'PUBLISHED', 'idempotency_key' => 'p1', 'target_record_id' => '1']);
        $res = AgentToolRegistry::executeTool($this->user, 'update_published_record', [
            'execution_id' => $e->id, 'fields' => ['title' => 'Renamed by Orbit', 'password' => 'x'],
        ]);
        $this->assertTrue($res['success'], json_encode($res));
        $this->assertSame('Renamed by Orbit', $this->fixtureRow('posts', 'id = 1')['title']);
    }
}
