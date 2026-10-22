<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Models\ContentVersion;
use App\Models\ApprovalToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApprovalFlowTest extends TestCase
{
    // Its rows must not outlive the test: the scheduler tests count every run in the table.
    use RefreshDatabase;

    public function test_approval_review_and_single_use_token_lifecycle(): void
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Review Target DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
        ]);

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'name' => 'Daily Tech News',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [['field_name' => 'title', 'mapping_type' => 'AI_GENERATED']],
            'schedule_type' => 'DAILY',
            'generation_time' => '08:00',
            'publication_time' => '09:00',
            'requires_approval' => true,
        ]);

        $execution = AutomationExecution::create([
            'user_id' => $user->id,
            'automation_id' => $automation->id,
            'status' => 'PENDING_APPROVAL',
            'idempotency_key' => 'test_exec_' . uniqid(),
            'publication_time' => now()->addHour(),
        ]);

        $version = ContentVersion::create([
            'user_id' => $user->id,
            'execution_id' => $execution->id,
            'version_number' => 1,
            'payload' => [
                'title' => 'Sample Generated Post',
                'slug' => 'sample-generated-post',
                'content' => 'Review content preview.',
            ],
            'status' => 'PENDING_APPROVAL',
        ]);

        $tokenRecord = ApprovalToken::generateForVersion($version);

        // 1. Review via token
        $reviewRes = $this->getJson("/api/approvals/{$tokenRecord->token}");
        $reviewRes->assertStatus(200)
            ->assertJsonPath('valid', true)
            ->assertJsonPath('automation_name', 'Daily Tech News')
            ->assertJsonPath('version_number', 1)
            ->assertJsonPath('content_payload.title', 'Sample Generated Post');

        // 2. Approve via token
        $approveRes = $this->postJson("/api/approvals/{$tokenRecord->token}/approve");
        $approveRes->assertStatus(200)
            ->assertJsonPath('success', true);

        $this->assertEquals('APPROVED', $version->fresh()->status);
        $this->assertEquals('APPROVED', $execution->fresh()->status);
        $this->assertNotNull($tokenRecord->fresh()->used_at);

        // 3. Second approval attempt should fail (single-use replay prevention)
        $replayRes = $this->postJson("/api/approvals/{$tokenRecord->token}/approve");
        $replayRes->assertStatus(422)
            ->assertJsonPath('success', false);
    }
}
