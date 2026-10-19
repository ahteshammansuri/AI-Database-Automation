<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrbitAuditToolsTest extends TestCase
{
    use RefreshDatabase;

    public function test_search_answers_did_i_ever_with_real_counts_and_only_my_entries(): void
    {
        $me = User::factory()->create();
        $other = User::factory()->create();
        $old = AuditLog::log($me->id, 'CONNECTION_CREATED', 'DbConnection', '7', ['name' => 'Shop DB']);
        $old->forceFill(['created_at' => now()->subDays(10)])->save();
        AuditLog::log($me->id, 'CONNECTION_DELETED', 'DbConnection', '7', ['name' => 'Shop DB']);
        AuditLog::log($me->id, 'AUTOMATION_CREATED', 'Automation', '3', ['name' => 'Daily blog']);
        AuditLog::log($other->id, 'CONNECTION_CREATED', 'DbConnection', '99', ['name' => 'Not yours']);

        $res = AgentToolRegistry::executeTool($me, 'list_audit_logs', ['query' => 'connection']);
        $this->assertTrue($res['success']);
        $this->assertSame(2, $res['total_matching']);
        $this->assertSame(1, $res['counts_by_action']['CONNECTION_CREATED']);
        $this->assertNotNull($res['first_at']);
        $this->assertStringNotContainsString('Not yours', json_encode($res));

        $recent = AgentToolRegistry::executeTool($me, 'list_audit_logs', ['action' => 'CREATED', 'since' => now()->subDay()->toDateString()]);
        $this->assertSame(1, $recent['total_matching'], 'the 10-day-old entry is excluded');

        $none = AgentToolRegistry::executeTool($me, 'list_audit_logs', ['action' => 'PROVIDER']);
        $this->assertSame(0, $none['total_matching']);
        $this->assertContains('AUTOMATION_CREATED', $none['your_action_types']->all());
    }

    public function test_inspect_hides_secrets_and_review_links_and_respects_ownership(): void
    {
        $me = User::factory()->create();
        $other = User::factory()->create();
        $log = AuditLog::log($me->id, 'APPROVAL_EMAIL_SENT', 'ContentVersion', '5', [
            'recipient' => 'editor@example.test', 'api_key' => 'sk-live-123', 'approval_url' => 'http://x/approvals/SECRET-TOKEN',
        ]);
        $res = AgentToolRegistry::executeTool($me, 'get_audit_log_entry', ['log_id' => $log->id]);
        $this->assertTrue($res['success']);
        $json = json_encode($res);
        $this->assertStringNotContainsString('sk-live-123', $json);
        $this->assertStringNotContainsString('SECRET-TOKEN', $json);
        $this->assertStringContainsString('editor@example.test', $json);

        $this->assertFalse(AgentToolRegistry::executeTool($other, 'get_audit_log_entry', ['log_id' => $log->id])['success']);
    }
}
