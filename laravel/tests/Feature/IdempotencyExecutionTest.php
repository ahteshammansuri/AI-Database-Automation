<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\IdempotencyKey;
use App\Services\SafeDatabaseExecutor;
use Tests\TestCase;

class IdempotencyExecutionTest extends TestCase
{
    protected function getTestConnection(User $user): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Idempotency Test DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);
    }

    public function test_exact_same_idempotency_key_does_not_duplicate_insert(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);

        $executor = app(SafeDatabaseExecutor::class);

        $idempotencyKey = 'idem_test_' . uniqid();
        $testTitle = 'Idempotent Post ' . uniqid();
        $testSlug = 'idempotent-post-' . uniqid();

        $payload = [
            'title' => $testTitle,
            'slug' => $testSlug,
            'content' => 'Initial publication payload testing idempotency.',
            'status' => 'draft',
        ];

        // 1. First execution
        $res1 = $executor->executeInsert(
            $conn,
            'posts',
            $payload,
            ['idempotency_key' => $idempotencyKey]
        );

        $this->assertTrue($res1['success']);
        $firstId = $res1['record_id'];
        $this->assertNotEmpty($firstId);
        $this->assertFalse($res1['idempotent_replayed'] ?? false);

        // Verify idempotency record exists in platform DB
        $idemRecord = IdempotencyKey::where('idempotency_key', $idempotencyKey)->first();
        $this->assertNotNull($idemRecord);
        $this->assertEquals('COMMITTED', $idemRecord->status);
        $this->assertEquals((string) $firstId, $idemRecord->target_record_id);

        // 2. Retry execution with same key (e.g. queue worker retry or network hiccup)
        $res2 = $executor->executeInsert(
            $conn,
            'posts',
            $payload,
            ['idempotency_key' => $idempotencyKey]
        );

        $this->assertTrue($res2['success']);
        $this->assertTrue($res2['idempotent_replayed']);
        $this->assertEquals($firstId, $res2['record_id']);

        // 3. Verify exactly ONE row exists in target database
        $pdo = $conn->createTargetPdo();
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM posts WHERE slug = :slug");
        $stmt->execute(['slug' => $testSlug]);
        $count = (int) $stmt->fetchColumn();

        $this->assertEquals(1, $count, "Target table must have exactly 1 record for this slug, got {$count}");
    }
}
