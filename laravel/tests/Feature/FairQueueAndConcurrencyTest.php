<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\Automation;
use App\Models\AutomationExecution;
use App\Services\QueueFairnessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;
use Carbon\Carbon;

class FairQueueAndConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    public function test_ten_simultaneous_runs_across_multiple_users_use_fair_round_robin_dispatch()
    {
        Queue::fake();
        Carbon::setTestNow(Carbon::parse('2026-10-12 09:00:00', 'UTC'));

        // Create 3 separate users (tenants)
        $userA = User::factory()->create(['name' => 'Tenant A']);
        $userB = User::factory()->create(['name' => 'Tenant B']);
        $userC = User::factory()->create(['name' => 'Tenant C']);

        $connA = DbConnection::create([
            'user_id' => $userA->id,
            'name' => 'DB A',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'secret',
            'ssl_mode' => 'prefer',
        ]);
        $connB = DbConnection::create([
            'user_id' => $userB->id,
            'name' => 'DB B',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'secret',
            'ssl_mode' => 'prefer',
        ]);
        $connC = DbConnection::create([
            'user_id' => $userC->id,
            'name' => 'DB C',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'secret',
            'ssl_mode' => 'prefer',
        ]);

        // User A creates 5 automations (large backlog)
        // User B creates 3 automations
        // User C creates 2 automations
        // Total = 10 automations all due at 09:00 UTC
        $dueAutomations = collect();

        for ($i = 1; $i <= 5; $i++) {
            $dueAutomations->push(Automation::create([
                'user_id' => $userA->id,
                'connection_id' => $connA->id,
                'name' => "Tenant A Auto {$i}",
                'target_table' => 'blog_posts',
                'generation_time' => '09:00:00',
                'publication_time' => '10:00:00',
                'timezone' => 'UTC',
                'frequency' => 'daily',
                'is_active' => true,
                'requires_approval' => false,
                'field_mappings' => ['title' => 'ai_generate', 'slug' => 'ai_generate'],
            ]));
        }

        for ($i = 1; $i <= 3; $i++) {
            $dueAutomations->push(Automation::create([
                'user_id' => $userB->id,
                'connection_id' => $connB->id,
                'name' => "Tenant B Auto {$i}",
                'target_table' => 'blog_posts',
                'generation_time' => '09:00:00',
                'publication_time' => '10:00:00',
                'timezone' => 'UTC',
                'frequency' => 'daily',
                'is_active' => true,
                'requires_approval' => false,
                'field_mappings' => ['title' => 'ai_generate', 'slug' => 'ai_generate'],
            ]));
        }

        for ($i = 1; $i <= 2; $i++) {
            $dueAutomations->push(Automation::create([
                'user_id' => $userC->id,
                'connection_id' => $connC->id,
                'name' => "Tenant C Auto {$i}",
                'target_table' => 'blog_posts',
                'generation_time' => '09:00:00',
                'publication_time' => '10:00:00',
                'timezone' => 'UTC',
                'frequency' => 'daily',
                'is_active' => true,
                'requires_approval' => false,
                'field_mappings' => ['title' => 'ai_generate', 'slug' => 'ai_generate'],
            ]));
        }

        $this->assertCount(10, $dueAutomations);

        // Execute fair dispatch with concurrency cap of 2 per tenant
        $fairnessService = app(QueueFairnessService::class);
        $result = $fairnessService->dispatchDueCohort($dueAutomations, 2);

        // All 10 must have persistent execution ledger records
        $allExecutions = AutomationExecution::orderBy('id')->get();
        $this->assertCount(10, $allExecutions);

        // Check round robin interleaving across tenants in timeline events
        $firstThreeExecutions = $allExecutions->take(3);
        $firstThreeUserIds = $firstThreeExecutions->pluck('user_id')->unique()->values();
        // The first 3 slots must be distributed across the 3 distinct tenants (no single tenant monopolizes slots 0, 1, 2)
        $this->assertCount(3, $firstThreeUserIds);
        $this->assertTrue($firstThreeUserIds->contains($userA->id));
        $this->assertTrue($firstThreeUserIds->contains($userB->id));
        $this->assertTrue($firstThreeUserIds->contains($userC->id));

        // Test Idempotency: re-running dispatch immediately on the exact same cohort creates ZERO duplicate records
        $rerunResult = $fairnessService->dispatchDueCohort($dueAutomations, 2);
        $this->assertEquals(0, $rerunResult['dispatched']);
        $this->assertEquals(0, $rerunResult['queued']);
        $this->assertEquals(10, AutomationExecution::count());

        Carbon::setTestNow(); // Reset clock
    }

    public function test_stale_worker_leases_are_safely_recovered_and_exhausted_retries_fail_terminally()
    {
        Queue::fake();

        $user = User::factory()->create();
        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Demo DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'secret',
            'ssl_mode' => 'prefer',
        ]);

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $connection->id,
            'name' => 'Crashed Job Test',
            'target_table' => 'blog_posts',
            'generation_time' => '09:00:00',
            'publication_time' => '10:00:00',
            'timezone' => 'UTC',
            'frequency' => 'daily',
            'is_active' => true,
            'requires_approval' => false,
            'field_mappings' => ['title' => 'ai_generate'],
        ]);

        // 1. Create an execution that was left RUNNING with an expired lease (e.g. worker crashed)
        $crashedExecution = AutomationExecution::create([
            'user_id' => $user->id,
            'automation_id' => $automation->id,
            'status' => 'GENERATING',
            'idempotency_key' => 'crashed_test_1',
            'lease_expires_at' => now()->subMinutes(10), // Expired 10 min ago
            'retry_count' => 0,
            'max_retries' => 2,
        ]);

        $fairnessService = app(QueueFairnessService::class);

        // Run lease recovery
        $recovered = $fairnessService->recoverOrphanedLeases(15);
        $this->assertEquals(1, $recovered);

        $crashedExecution->refresh();
        $this->assertEquals('QUEUED', $crashedExecution->status);
        $this->assertEquals(1, $crashedExecution->retry_count);
        $this->assertTrue($crashedExecution->lease_expires_at->isFuture());

        // 2. Simulate reaching max retries and crashing again
        $crashedExecution->update([
            'status' => 'GENERATING',
            'lease_expires_at' => now()->subMinutes(5),
            'retry_count' => 2, // Reached max_retries
        ]);

        $fairnessService->recoverOrphanedLeases(15);
        $crashedExecution->refresh();

        // Must be marked terminal FAILED with LEASE_TIMEOUT_EXCEEDED
        $this->assertEquals('FAILED', $crashedExecution->status);
        $this->assertEquals('LEASE_TIMEOUT_EXCEEDED', $crashedExecution->failure_category);
        $this->assertNull($crashedExecution->lease_expires_at);
    }
}
