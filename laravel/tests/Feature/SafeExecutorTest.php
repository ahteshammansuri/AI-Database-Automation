<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Services\SafeDatabaseExecutor;
use Tests\TestCase;
use Exception;

class SafeExecutorTest extends TestCase
{
    public function test_safe_insert_into_target_mysql_succeeds(): void
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Demo Target DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
        ]);

        $executor = app(SafeDatabaseExecutor::class);

        $testTitle = "Automated Test Post " . uniqid();
        $testSlug = "automated-test-post-" . uniqid();

        $result = $executor->executeInsert(
            $connection,
            'posts',
            [
                'title' => $testTitle,
                'slug' => $testSlug,
                'content' => 'Content verified by automated integration test.',
                'status' => 'draft',
            ]
        );

        $this->assertTrue($result['success']);
        $this->assertEquals('INSERT', $result['operation']);
        $this->assertEquals('posts', $result['table']);
        $this->assertNotEmpty($result['record_id']);

        // Verify direct read from target MySQL
        $pdo = $connection->createTargetPdo();
        $stmt = $pdo->prepare("SELECT * FROM posts WHERE slug = :slug");
        $stmt->execute(['slug' => $testSlug]);
        $row = $stmt->fetch();

        $this->assertNotEmpty($row);
        $this->assertEquals($testTitle, $row['title']);
    }

    public function test_attempt_to_write_to_sensitive_table_is_blocked(): void
    {
        $user = User::factory()->create();

        $connection = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Demo Target DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
        ]);

        $executor = app(SafeDatabaseExecutor::class);

        $this->expectException(Exception::class);
        $this->expectExceptionMessage("restricted");

        $executor->executeInsert(
            $connection,
            'users',
            [
                'email' => 'hacker@example.com',
                'password' => 'secret',
            ]
        );
    }
}
