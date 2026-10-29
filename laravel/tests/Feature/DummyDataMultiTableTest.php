<?php

namespace Tests\Feature;

use App\Models\DbConnection;
use App\Models\User;
use App\Services\Agent\AgentToolRegistry;
use App\Services\Data\DummyDataDetector;
use Tests\TestCase;

class DummyDataMultiTableTest extends TestCase
{
    protected function createTestConnection(User $user): ?DbConnection
    {
        try {
            return DbConnection::create([
                'user_id' => $user->id,
                'name' => 'Choviet Test',
                'db_type' => 'mysql',
                'host' => '127.0.0.1',
                'port' => 3306,
                'database_name' => 'choviet102',
                'username' => 'root',
                'encrypted_password' => 'agc123',
                'ssl_mode' => 'disabled',
                'access_mode' => 'read_only',
                'data_timezone' => 'Asia/Kolkata',
                'is_active' => true,
            ]);
        } catch (\Throwable) {
            return null;
        }
    }

    public function test_dummy_data_detector_detects_across_recommended_tables(): void
    {
        $user = User::factory()->create();
        $conn = $this->createTestConnection($user);
        if (!$conn) {
            $this->markTestSkipped('Could not connect to test database.');
        }

        $detector = app(DummyDataDetector::class);
        $result = $detector->detectAcrossTables($conn, 'recommended');

        $this->assertTrue($result['success']);
        $this->assertGreaterThan(0, $result['total_tables_scanned']);
        $this->assertNotEmpty($result['scanned_tables']);
        $this->assertIsArray($result['tables_with_dummy_data']);
        $this->assertNotEmpty($result['summary_message']);
        $this->assertNotEmpty($result['safe_message']);
    }

    public function test_find_dummy_data_tool_execution_via_registry(): void
    {
        $user = User::factory()->create();
        $conn = $this->createTestConnection($user);
        if (!$conn) {
            $this->markTestSkipped('Could not connect to test database.');
        }

        $toolResult = AgentToolRegistry::executeTool($user, 'find_dummy_data', [
            'table' => 'recommended',
            'connection_id' => $conn->id,
        ]);

        $this->assertTrue($toolResult['success']);
        $this->assertNotEmpty($toolResult['safe_message']);
        $this->assertArrayHasKey('report', $toolResult);
        $this->assertGreaterThan(0, $toolResult['report']['total_tables_scanned']);
        $this->assertStringContainsString('Scanned', $toolResult['safe_message']);
    }
}
