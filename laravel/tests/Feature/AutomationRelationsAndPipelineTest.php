<?php

namespace Tests\Feature;

use App\Jobs\GenerateAutomationContentJob;
use App\Jobs\PublishAutomationContentJob;
use App\Mail\ContentReviewMail;
use App\Models\ApprovalToken;
use App\Models\AuditLog;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\User;
use App\Services\SafeDatabaseExecutor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\UsesAutomationFixtureDatabase;
use Tests\TestCase;

class AutomationRelationsAndPipelineTest extends TestCase
{
    use RefreshDatabase, UsesAutomationFixtureDatabase;

    /** 1x1 transparent PNG */
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        Storage::fake('public');
        $this->fakeAiService('Schema Design');
    }

    protected function tearDown(): void
    {
        $this->dropFixtureBlogDatabase();
        parent::tearDown();
    }

    /** Deterministic AI service: answers every field spec it is sent; the category is $category. */
    private function fakeAiService(string $category): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory()); // later fakes replace earlier ones
        Http::fake([
            '*/v1/ai/generate-image' => Http::response([
                'success' => true, 'provider_used' => 'local', 'model_used' => 'designed-cover-v1',
                'mime_type' => 'image/png', 'width' => 1600, 'height' => 900, 'image_base64' => self::PNG,
            ]),
            '*/v1/ai/generate' => function (HttpRequest $request) use ($category) {
                $data = [];
                foreach ($request['field_specs'] ?? [] as $spec) {
                    $data[$spec['name']] = match ($spec['kind']) {
                        'title' => 'Zero-Downtime Schema Migrations in MySQL',
                        'summary' => 'How to change a busy schema without locking your users out.',
                        'body' => "Changing schemas safely is a process.\n\n## Plan\nUse online DDL tools.\n\n## Verify\n- Shadow tables\n- Backfills",
                        'relation_label' => $category,
                        'meta_title' => 'Zero-Downtime MySQL Migrations',
                        'meta_description' => 'A practical guide to online schema changes.',
                        'keywords' => 'mysql, migrations, schema',
                        default => 'value',
                    };
                }
                return Http::response(['success' => true, 'provider_used' => 'mock', 'model_used' => 'mock', 'latency_seconds' => 0.01, 'data' => $data, 'missing_fields' => []]);
            },
            '*/v1/ai/health' => Http::response(['available' => false, 'models' => []]),
            '*' => Http::response(['success' => true]),
        ]);
    }

    private function config(int $connectionId, array $overrides = []): array
    {
        return array_merge([
            'name' => 'Daily blog',
            'connection_id' => $connectionId,
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'ai_provider' => 'mock',
            'ai_model' => 'mock',
            'prompt_context' => 'Practical MySQL operations for busy teams',
            'generation_options' => ['tone' => 'Practical', 'length' => 'short', 'image_provider' => 'local'],
            'field_mappings' => [
                ['field_name' => 'title', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'slug', 'mapping_type' => 'DERIVED_SLUG', 'source_field' => 'title'],
                ['field_name' => 'excerpt', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'content', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'banner', 'mapping_type' => 'AI_GENERATED'],
                ['field_name' => 'category_id', 'mapping_type' => 'AI_GENERATED', 'relation_config' => ['referenced_table' => 'categories', 'creation_policy' => 'CREATE_IF_MISSING']],
                ['field_name' => 'author_id', 'mapping_type' => 'RELATIONAL_LOOKUP', 'fixed_value' => 1],
                ['field_name' => 'status', 'mapping_type' => 'FIXED_VALUE', 'fixed_value' => 'published'],
                ['field_name' => 'published_at', 'mapping_type' => 'RUNTIME_NOW'],
            ],
            'schedule_type' => 'DAILY',
            'start_date' => now('Asia/Kolkata')->addDay()->toDateString(),
            'end_date' => now('Asia/Kolkata')->addDays(5)->toDateString(),
            'generation_time' => '08:30',
            'publication_time' => '09:00',
            'timezone' => 'Asia/Kolkata',
            'requires_approval' => true,
            'reviewer_email' => 'editor@example.test',
            'timeout_policy' => 'KEEP_DRAFT',
        ], $overrides);
    }

    public function test_field_plan_suggests_safe_defaults_for_every_column(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $res = $this->actingAs($this->user)->postJson('/api/automations/field-plan', ['connection_id' => $conn->id, 'target_table' => 'posts']);
        $res->assertOk();
        $cols = collect($res->json('columns'))->keyBy('name');

        $this->assertSame('title', $res->json('title_column'));
        $this->assertSame('AI_GENERATED', $cols['category_id']['suggested']['mapping_type']);
        $this->assertSame('CREATE_IF_MISSING', $cols['category_id']['suggested']['relation_config']['creation_policy']);
        $this->assertTrue($cols['category_id']['relation']['can_create']);
        $this->assertContains('Databases', $cols['category_id']['relation']['options']);
        $this->assertContains('status', $cols['category_id']['relation']['parent_required_columns']);

        // FK to a protected table is never AI-chosen or created
        $this->assertFalse($cols['author_id']['relation']['can_create']);
        $this->assertSame('LEAVE_EMPTY', $cols['author_id']['suggested']['mapping_type']);

        $this->assertSame('image', $cols['banner']['kind']);
        $this->assertSame('AI_GENERATED', $cols['banner']['suggested']['mapping_type']);
        $this->assertSame('DERIVED_SLUG', $cols['slug']['suggested']['mapping_type']);
        $this->assertSame('published', $cols['status']['suggested']['fixed_value']);
        $this->assertSame('RUNTIME_NOW', $cols['published_at']['suggested']['mapping_type']);
        $this->assertSame('local', $res->json('image_provider.provider'));
        $this->assertArrayNotHasKey('api_key', $res->json('image_provider'));
    }

    public function test_another_user_cannot_read_my_connection_field_plan(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $intruder = User::factory()->create();
        $this->actingAs($intruder)->postJson('/api/automations/field-plan', ['connection_id' => $conn->id, 'target_table' => 'posts'])->assertNotFound();
        $this->actingAs($intruder)->postJson('/api/automations/preview', $this->config($conn->id))->assertNotFound();
    }

    public function test_preview_shows_full_plan_with_parent_creation_and_writes_nothing(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $before = [$this->fixtureCount('posts'), $this->fixtureCount('categories')];

        $res = $this->actingAs($this->user)->postJson('/api/automations/preview', $this->config($conn->id));
        $res->assertOk();

        $this->assertSame('Zero-Downtime Schema Migrations in MySQL', $res->json('payload.title'));
        $this->assertSame('zero-downtime-schema-migrations-in-mysql', $res->json('payload.slug'));
        $this->assertSame('Schema Design', $res->json('payload.category_id'));
        $this->assertStringContainsString('/storage/media/', $res->json('payload.banner'));

        $this->assertSame('create', $res->json('meta.relations.0.decision'));
        $steps = $res->json('meta.write_plan.steps');
        $this->assertSame(['CREATE_PARENT', 'INSERT'], array_column($steps, 'action'));
        $this->assertSame('categories', $steps[0]['table']);
        $this->assertSame('active', $steps[0]['values']['status'], 'required enum of the new parent is filled');
        $this->assertSame(0, $steps[0]['values']['sort_order']);
        $this->assertTrue($res->json('meta.can_publish'));
        $this->assertSame('local', $res->json('meta.media.0.provider'));
        $this->assertNotEmpty($res->json('schedule.next_run'));
        $this->assertSame(5, $res->json('schedule.total_runs'));

        $this->assertSame($before, [$this->fixtureCount('posts'), $this->fixtureCount('categories')], 'preview never writes');
    }

    public function test_full_run_review_email_approval_and_publish_creates_parent_first(): void
    {
        Mail::fake();
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());

        $created = $this->actingAs($this->user)->postJson('/api/automations', $this->config($conn->id))->assertCreated();
        $this->assertSame('SCHEDULED', $created->json('automation.schedule_summary.state'));
        $automation = Automation::findOrFail($created->json('automation.id'));

        // "Run now" generates in the background (sync queue in tests)
        $this->actingAs($this->user)->postJson("/api/automations/{$automation->id}/trigger")->assertStatus(202);
        $execution = AutomationExecution::where('automation_id', $automation->id)->firstOrFail();
        $this->assertSame('PENDING_APPROVAL', $execution->status);
        $version = ContentVersion::where('execution_id', $execution->id)->firstOrFail();
        $this->assertSame('PENDING_APPROVAL', $version->status);
        $this->assertSame('create', $version->meta['relations'][0]['decision']);
        $this->assertSame(0, $this->fixtureCount('categories', 'name = ?', ['Schema Design']), 'nothing written before approval');

        Mail::assertSent(ContentReviewMail::class, function (ContentReviewMail $mail) {
            $view = $mail->presentation();
            return $mail->hasTo('editor@example.test')
                && $view['title'] === 'Zero-Downtime Schema Migrations in MySQL'
                && count($view['steps']) === 2
                && str_contains($view['relations'][0], 'will be created')
                && str_contains($view['policyText'], 'nothing is published')
                && $view['heroUrl'] !== null;
        });
        $this->assertContains('NOTIFICATION_SENT', array_column($execution->fresh()->timeline_events, 'stage'));
        $audit = AuditLog::where('action', 'APPROVAL_EMAIL_SENT')->firstOrFail();
        $token = ApprovalToken::where('version_id', $version->id)->firstOrFail();
        $this->assertStringNotContainsString($token->token, json_encode($audit->metadata), 'signed link never logged');

        // Approve through the signed link, then publish
        $this->postJson("/api/approvals/{$token->token}/approve")->assertOk();
        $this->postJson("/api/approvals/{$token->token}/approve")->assertStatus(422);
        (new PublishAutomationContentJob($execution->id))->handle(app(SafeDatabaseExecutor::class));

        $execution->refresh();
        $this->assertSame('PUBLISHED', $execution->status);
        $category = $this->fixtureRow('categories', 'name = ?', ['Schema Design']);
        $this->assertNotNull($category, 'parent created');
        $this->assertSame('active', $category['status']);
        $post = $this->fixtureRow('posts', 'id = ?', [$execution->target_record_id]);
        $this->assertSame((int) $category['id'], (int) $post['category_id'], 'child stores the new parent id');
        $this->assertSame(1, (int) $post['author_id']);
        $this->assertSame('published', $post['status']);
        $this->assertNotNull($post['published_at']);
        $this->assertStringContainsString('/storage/media/', $post['banner']);
        $this->assertStringContainsString('## Plan', $post['content']);

        // Re-running the publish job never inserts twice
        $execution->update(['status' => 'PUBLISHING']);
        (new PublishAutomationContentJob($execution->id))->handle(app(SafeDatabaseExecutor::class));
        $this->assertSame(2, $this->fixtureCount('posts'));
    }

    public function test_existing_category_is_reused_not_duplicated(): void
    {
        $this->fakeAiService('databases'); // different case than the stored 'Databases'
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $res = $this->actingAs($this->user)->postJson('/api/automations/preview', $this->config($conn->id));
        $res->assertOk();
        $this->assertSame('Databases', $res->json('payload.category_id'));
        $this->assertSame('reuse', $res->json('meta.relations.0.decision'));
        $this->assertSame(['INSERT'], array_column($res->json('meta.write_plan.steps'), 'action'));
    }

    public function test_creation_disallowed_falls_back_to_closest_existing_category(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $cfg = $this->config($conn->id);
        $cfg['field_mappings'][5]['relation_config']['creation_policy'] = 'REUSE_EXISTING_ONLY';
        $this->fakeAiService('Database Design');
        $res = $this->actingAs($this->user)->postJson('/api/automations/preview', $cfg)->assertOk();
        $this->assertSame('Databases', $res->json('payload.category_id'));
        $this->assertSame('reuse', $res->json('meta.relations.0.decision'));
    }

    public function test_api_validation_messages_for_schedule_and_mapping(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());

        $this->actingAs($this->user)->postJson('/api/automations', $this->config($conn->id, ['publication_time' => '08:40']))
            ->assertStatus(422)->assertJsonValidationErrors(['publication_time']);

        $this->actingAs($this->user)->postJson('/api/automations', $this->config($conn->id, [
            'schedule_type' => 'ONE_TIME', 'start_date' => now('Asia/Kolkata')->subDay()->toDateString(),
        ]))->assertStatus(422)->assertJsonValidationErrors(['start_date']);

        $bad = $this->config($conn->id);
        $bad['field_mappings'][] = ['field_name' => 'no_such_column', 'mapping_type' => 'AI_GENERATED'];
        $this->actingAs($this->user)->postJson('/api/automations', $bad)
            ->assertStatus(422)->assertJsonValidationErrors(['field_mappings']);

        // Choosing a user by AI is refused: users is a protected table
        $protected = $this->config($conn->id);
        $protected['field_mappings'][6] = ['field_name' => 'author_id', 'mapping_type' => 'AI_GENERATED'];
        $this->actingAs($this->user)->postJson('/api/automations', $protected)
            ->assertStatus(422)->assertJsonValidationErrors(['field_mappings']);

        $weekly = $this->actingAs($this->user)->postJson('/api/automations', $this->config($conn->id, ['schedule_type' => 'WEEKLY', 'weekly_days' => [1, 3, 5]]))->assertCreated();
        $this->assertSame([1, 3, 5], $weekly->json('automation.schedule_summary.weekly_days'));
    }

    public function test_executor_refuses_missing_parent_ids_secret_columns_and_never_guesses(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $this->fixturePdo($this->fixtureDb)->exec('ALTER TABLE posts ADD COLUMN edit_token VARCHAR(64) NULL');
        $ex = app(SafeDatabaseExecutor::class);
        $base = ['title' => 'T', 'slug' => 't', 'content' => 'c'];

        $plan = $ex->planInsert($conn, 'posts', $base + ['category_id' => 999]);
        $this->assertFalse($plan['can_publish']);
        $this->assertStringContainsString('does not exist', $plan['issues'][0]['message']);

        $plan = $ex->planInsert($conn, 'posts', $base + ['category_id' => 1, 'edit_token' => 'abc']);
        $this->assertFalse($plan['can_publish']);
        $this->assertStringContainsString('never written', collect($plan['issues'])->firstWhere('column', 'edit_token')['message']);

        $plan = $ex->planInsert($conn, 'posts', $base + ['category_id' => 1, 'author_id' => 'Somebody New'], ['author_id' => ['creation_policy' => 'CREATE_IF_MISSING']]);
        $this->assertFalse($plan['can_publish'], 'users are never created by automations');

        $plan = $ex->planInsert($conn, 'posts', ['title' => str_repeat('Long words ', 30), 'slug' => 'existing-post', 'content' => 'c', 'category_id' => 1, 'status' => 'PUBLISHED']);
        $this->assertTrue($plan['can_publish']);
        $this->assertSame('published', $plan['row']['status'], 'enum matched case-insensitively');
        $this->assertSame('existing-post-2', $plan['row']['slug'], 'slug made unique');
        $this->assertLessThanOrEqual(120, mb_strlen($plan['row']['title']));

        try {
            $ex->executeInsert($conn, 'posts', ['title' => 'T', 'slug' => 't2', 'category_id' => 1]);
            $this->fail('missing required column must fail');
        } catch (\Exception $e) {
            $this->assertStringContainsString('`content` is required', $e->getMessage());
        }
        $this->assertSame(1, $this->fixtureCount('posts'), 'failed writes leave nothing behind');
    }

    public function test_manual_publish_dry_run_then_publish_and_timezone_scheduling(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $payload = ['title' => 'Manual Post', 'slug' => 'manual-post', 'content' => 'Hand written', 'category_id' => 'Guides', 'status' => 'published'];

        $dry = $this->actingAs($this->user)->postJson('/api/automations/manual-publish', [
            'connection_id' => $conn->id, 'target_table' => 'posts', 'payload' => $payload, 'dry_run' => true,
            'relation_policies' => ['category_id' => 'CREATE_IF_MISSING'],
        ])->assertOk();
        $this->assertSame(['CREATE_PARENT', 'INSERT'], array_column($dry->json('plan.steps'), 'action'));
        $this->assertSame(0, $this->fixtureCount('categories', 'name = ?', ['Guides']));

        $this->actingAs($this->user)->postJson('/api/automations/manual-publish', [
            'connection_id' => $conn->id, 'target_table' => 'posts', 'payload' => $payload, 'publish_now' => true,
            'relation_policies' => ['category_id' => 'CREATE_IF_MISSING'],
        ])->assertCreated();
        $this->assertSame(1, $this->fixtureCount('categories', 'name = ?', ['Guides']));
        $this->assertSame(1, $this->fixtureCount('posts', 'slug = ?', ['manual-post']));

        $local = now('Asia/Kolkata')->addDay()->setTime(15, 0)->format('Y-m-d H:i');
        $sched = $this->actingAs($this->user)->postJson('/api/automations/manual-publish', [
            'connection_id' => $conn->id, 'target_table' => 'posts', 'payload' => array_merge($payload, ['slug' => 'later-post', 'category_id' => 1]),
            'publish_now' => false, 'scheduled_time' => $local, 'timezone' => 'Asia/Kolkata',
        ])->assertStatus(202);
        $exec = AutomationExecution::findOrFail($sched->json('execution.id'));
        $this->assertSame('09:30', $exec->publication_time->utc()->format('H:i'), '15:00 IST is 09:30 UTC');
        $this->assertSame('NONE', Automation::findOrFail($exec->automation_id)->schedule_type);
    }

    public function test_publish_now_refuses_rejected_or_invalid_versions(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $a = Automation::create($this->config($conn->id) + ['user_id' => $this->user->id]);
        $e = AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'FAILED', 'idempotency_key' => 'x1', 'publication_time' => now()]);
        ContentVersion::create(['user_id' => $this->user->id, 'execution_id' => $e->id, 'version_number' => 1, 'payload' => ['title' => 'x'], 'status' => 'REJECTED']);

        $this->actingAs($this->user)->postJson("/api/executions/{$e->id}/publish-now")->assertStatus(422);
        $this->assertSame('FAILED', $e->fresh()->status);
        $this->assertSame(1, $this->fixtureCount('posts'));
    }

    public function test_failed_email_is_recorded_honestly(): void
    {
        $conn = $this->fixtureConnection($this->user, $this->createFixtureBlogDatabase());
        $a = Automation::create($this->config($conn->id) + ['user_id' => $this->user->id]);
        $e = AutomationExecution::create(['user_id' => $this->user->id, 'automation_id' => $a->id, 'status' => 'PENDING_APPROVAL', 'idempotency_key' => 'x2', 'publication_time' => now()->addHour()]);
        $v = ContentVersion::create(['user_id' => $this->user->id, 'execution_id' => $e->id, 'version_number' => 1, 'payload' => ['title' => 'Hello'], 'meta' => [], 'status' => 'PENDING_APPROVAL']);

        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP connection refused'));
        $result = app(\App\Services\EmailApprovalService::class)->dispatchApprovalNotification($v, 'editor@example.test');

        $this->assertFalse($result['sent']);
        $this->assertStringContainsString('SMTP connection refused', $result['error']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'APPROVAL_EMAIL_FAILED']);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'APPROVAL_EMAIL_SENT']);
    }
}
