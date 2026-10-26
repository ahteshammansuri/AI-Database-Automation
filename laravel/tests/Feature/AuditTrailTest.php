<?php

namespace Tests\Feature;

use App\Models\AgentTask;
use App\Models\AgentToolCall;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The customer's audit trail: before -> after records (secrets never stored, personal data masked), category and
 * search filters, Orbit's tool calls with the request they served, and the CSV export (owner only, formula-safe).
 */
class AuditTrailTest extends TestCase
{
    use RefreshDatabase;

    public function test_changes_keep_only_real_differences_hide_secrets_and_mask_personal_data()
    {
        $changes = AuditLog::changes(
            ['name' => 'Old', 'port' => 3306, 'encrypted_password' => 'a', 'email' => 'ann@example.com', 'same' => 'x', 'body' => str_repeat('a', 900)],
            ['name' => 'New', 'port' => '3307', 'encrypted_password' => 'b', 'email' => 'bob@example.com', 'same' => 'x', 'body' => str_repeat('b', 900)],
            ['encrypted_password'],
        );

        $this->assertSame(['from' => 'Old', 'to' => 'New'], $changes['name']);
        $this->assertSame(['from' => 3306, 'to' => '3307'], $changes['port']);
        $this->assertSame(['from' => '(hidden)', 'to' => '(changed, hidden)'], $changes['encrypted_password']);
        $this->assertSame('a***@example.com', $changes['email']['from']);
        $this->assertArrayNotHasKey('same', $changes);
        $this->assertLessThanOrEqual(401, mb_strlen($changes['body']['to']));
    }

    public function test_filters_orbit_feed_and_export_are_scoped_to_the_owner()
    {
        $me = User::factory()->create();
        $other = User::factory()->create();
        AuditLog::log($me->id, 'CONNECTION_CREATED', 'DbConnection', '1', ['name' => 'Shop']);
        AuditLog::log($me->id, 'AUTOMATION_UPDATED', 'Automation', '7', ['name' => '=HYPERLINK("x")', 'changes' => ['name' => ['from' => 'A', 'to' => 'B']]]);
        AuditLog::log($me->id, 'data.insert_executed', 'db_connections', '1', ['table' => 'products', 'affected_count' => 2]);
        AuditLog::log($other->id, 'CONNECTION_CREATED', 'DbConnection', '9', ['name' => 'Not mine']);

        $this->actingAs($me);
        $this->getJson('/api/audit-logs')->assertOk()->assertJsonPath('total', 3);
        $this->assertSame(['CONNECTION_CREATED'], array_column($this->getJson('/api/audit-logs?category=connections')->json('data'), 'action'));
        $this->assertSame(['data.insert_executed'], array_column($this->getJson('/api/audit-logs?category=data')->json('data'), 'action'));
        $this->assertSame(['AUTOMATION_UPDATED'], array_column($this->getJson('/api/audit-logs?search=AUTOMATION')->json('data'), 'action'));
        $this->getJson('/api/audit-logs?category=nope')->assertStatus(422);

        $task = AgentTask::create(['user_id' => $me->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'Pause my blog automation', 'status' => 'COMPLETED']);
        AgentToolCall::create(['task_id' => $task->id, 'user_id' => $me->id, 'tool' => 'pause_automation', 'args_redacted' => ['automation_id' => 7], 'args_hash' => hash('sha256', 'a'), 'idempotency_key' => 'k1', 'trace_id' => 't1', 'status' => 'succeeded',
            'side_effect_committed' => true, 'verified' => true, 'result_sanitized' => ['safe_message' => 'Paused “Blog”.'], 'started_at' => now()->subSecond(), 'finished_at' => now()]);
        $otherTask = AgentTask::create(['user_id' => $other->id, 'task_type' => 'ORBIT_REQUEST', 'goal' => 'Secret plan', 'status' => 'COMPLETED']);
        AgentToolCall::create(['task_id' => $otherTask->id, 'user_id' => $other->id, 'tool' => 'delete_everything', 'args_hash' => hash('sha256', 'b'), 'idempotency_key' => 'k2', 'trace_id' => 't2', 'status' => 'failed']);

        $feed = $this->getJson('/api/audit-logs/orbit')->assertOk();
        $this->assertSame(1, $feed->json('total'));
        $this->assertSame('Pause my blog automation', $feed->json('data.0.request'));
        $this->assertSame('Paused “Blog”.', $feed->json('data.0.outcome'));
        $this->assertTrue($feed->json('data.0.changed_something'));

        $csv = $this->get('/api/audit-logs/export')->assertOk()->streamedContent();
        $this->assertStringStartsWith('time_utc,action,resource_type', $csv);
        $this->assertStringContainsString('CONNECTION_CREATED', $csv);
        $this->assertStringNotContainsString('Not mine', $csv, 'other customers are never exported');
        $this->assertStringContainsString('AUDIT_LOG_EXPORTED', AuditLog::where('user_id', $me->id)->latest('id')->value('action'));
    }

    public function test_automation_update_records_before_and_after()
    {
        $me = User::factory()->create();
        $connection = \App\Models\DbConnection::create([
            'user_id' => $me->id, 'name' => 'Shop', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317,
            'database_name' => 'shopfx_w', 'username' => 'root', 'encrypted_password' => 'fxroot', 'ssl_mode' => 'disabled', 'access_mode' => 'read_write', 'is_active' => true,
        ]);
        $automation = \App\Models\Automation::create([
            'user_id' => $me->id, 'connection_id' => $connection->id, 'name' => 'Blog', 'target_table' => 'posts', 'operation_mode' => 'AI_CREATE',
            'field_mappings' => [['field_name' => 'title', 'mapping_type' => 'AI_GENERATED']], 'schedule_type' => 'NONE', 'timezone' => 'UTC',
            'timeout_policy' => 'KEEP_DRAFT', 'is_active' => false,
        ]);

        $this->actingAs($me)->putJson("/api/automations/{$automation->id}", ['name' => 'Blog posts', 'timeout_policy' => 'CANCEL'])->assertOk();

        $log = AuditLog::where('action', 'AUTOMATION_UPDATED')->latest('id')->first();
        $this->assertEquals(['from' => 'Blog', 'to' => 'Blog posts'], $log->metadata['changes']['name']);
        $this->assertEquals(['from' => 'KEEP_DRAFT', 'to' => 'CANCEL'], $log->metadata['changes']['timeout_policy']);
    }
}
