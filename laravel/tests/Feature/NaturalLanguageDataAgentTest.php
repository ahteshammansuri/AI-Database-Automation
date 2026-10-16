<?php

namespace Tests\Feature;

use App\Models\DbConnection;
use App\Models\User;
use App\Services\Data\DataAgentService;
use App\Services\Data\DummyDataDetector;
use Tests\TestCase;

class NaturalLanguageDataAgentTest extends TestCase
{
    protected function createMysqlConnection(User $user, string $name = 'Shop DB'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => $name,
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3317,
            'database_name' => 'shopfx',
            'username' => 'root',
            'encrypted_password' => 'fxroot',
            'ssl_mode' => 'disabled',
            'access_mode' => 'read_only',
            'data_timezone' => 'Asia/Kolkata',
            'is_active' => true,
        ]);
    }

    protected function createPostgresConnection(User $user, string $name = 'PG Shop DB'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => $name,
            'db_type' => 'postgresql',
            'host' => '127.0.0.1',
            'port' => 5442,
            'database_name' => 'shopfx',
            'username' => 'postgres',
            'encrypted_password' => 'fxroot',
            'ssl_mode' => 'disabled',
            'access_mode' => 'read_only',
            'data_timezone' => 'Asia/Kolkata',
            'is_active' => true,
        ]);
    }

    public function test_introspection_table_count_and_list_matches_live_mysql_schema(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'how many tables are there in my database?', $conn->id);

        $this->assertEquals('schema_overview', $res['type']);
        $this->assertCount(13, $res['tables']);
        $this->assertContains('users', $res['tables']);
        $this->assertContains('orders', $res['tables']);
        $this->assertContains('posts', $res['tables']);
        $this->assertStringContainsString('13 tables', $res['headline']);
    }

    public function test_postgres_introspection_table_count_and_list_matches_live_schema(): void
    {
        $user = User::factory()->create();
        $conn = $this->createPostgresConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'how many tables are there in my database?', $conn->id);

        $this->assertEquals('schema_overview', $res['type']);
        $this->assertCount(13, $res['tables']);
        $this->assertContains('users', $res['tables']);
        $this->assertContains('orders', $res['tables']);
    }

    public function test_semantic_table_discovery_finds_user_data_with_evidence(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'which table stores the user data?', $conn->id);

        $this->assertEquals('table_discovery', $res['type']);
        $this->assertNotNull($res['best_match']);
        $this->assertEquals('users', $res['best_match']['table']);
        $this->assertGreaterThan(0, count($res['best_match']['evidence']));
        $this->assertStringContainsString('users', $res['headline']);
    }

    public function test_time_relative_window_resolves_today_with_assumptions(): void
    {
        $user = User::factory()->create(['timezone' => 'Asia/Kolkata']);
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'how many new users today?', $conn->id);

        $this->assertArrayHasKey('diagnostics', $res);
        $this->assertNotEmpty($res['assumptions']);
        $assumptionsStr = implode(' ', $res['assumptions']);
        $this->assertTrue(
            str_contains($assumptionsStr, 'Asia/Kolkata') || str_contains($assumptionsStr, 'created_at')
        );
    }

    public function test_dummy_data_detection_finds_seeded_dummies_without_false_positives(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $detector = app(DummyDataDetector::class);

        $report = $detector->detect($conn, 'users');

        $this->assertGreaterThan(0, $report['dummy_count']);
        $this->assertEquals('high', $report['confidence']);

        // Check that ground truth dummy IDs (57 to 66) are captured
        foreach ([57, 58, 59, 60, 61, 62] as $expectedId) {
            $this->assertContains($expectedId, $report['suspected_ids'], "Expected dummy ID {$expectedId} to be flagged.");
        }

        // Precision check: Adversarial look-alikes that are NOT dummy data must NOT be flagged
        // User 49 (John Dsouza), User 50 (Marco Testa), User 51 (contest.in)
        $this->assertNotContains(49, $report['suspected_ids'], 'John Dsouza must NOT be flagged as dummy data.');
        $this->assertNotContains(50, $report['suspected_ids'], 'Marco Testa must NOT be flagged as dummy data.');
        $this->assertNotContains(51, $report['suspected_ids'], 'contest.in email must NOT be flagged as dummy data.');
    }

    public function test_value_grounding_maps_rajasthan_to_rj(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'Find users from Rajasthan', $conn->id);

        $this->assertEquals('data_query', $res['type']);
        $assumptionsStr = implode(' ', $res['assumptions']);
        $this->assertStringContainsString('Rajasthan', $assumptionsStr);
        $this->assertStringContainsString('RJ', $assumptionsStr);
    }

    public function test_multi_connection_disambiguation(): void
    {
        $user = User::factory()->create();
        $conn1 = $this->createMysqlConnection($user, 'Shop Primary DB');
        $conn2 = $this->createMysqlConnection($user, 'Shop Replica DB');
        $agent = app(DataAgentService::class);

        // When ambiguous and no active connection: asks user
        $res = $agent->ask($user, 'how many users are there?');

        $this->assertTrue($res['needs_clarification'] ?? false);
        $this->assertEquals('disambiguation', $res['type']);
        $this->assertCount(2, $res['options']);

        // When explicitly specifying connection name in utterance: resolves automatically
        $resWithConn = $agent->ask($user, 'how many users are in Shop Primary DB?');
        $this->assertEquals('data_query', $resWithConn['type']);
        $this->assertEquals($conn1->id, $resWithConn['connection']['id']);
    }
}
