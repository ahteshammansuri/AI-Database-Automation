<?php

namespace Tests\Feature;

use App\Models\DbConnection;
use App\Models\User;
use App\Services\AiServiceClient;
use App\Services\Data\DataChangeService;
use App\Services\Data\DataException;
use App\Services\Data\ReadExecutor;
use PDO;
use Tests\TestCase;

class SafeDataWritesAndGuardedDeleteTest extends TestCase
{
    protected function createWritableConnection(User $user, string $mode = 'read_write'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Shop Writable DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3317,
            'database_name' => 'shopfx_w',
            'username' => 'root',
            'encrypted_password' => 'fxroot',
            'ssl_mode' => 'disabled',
            'access_mode' => $mode,
            'data_timezone' => 'Asia/Kolkata',
            'is_active' => true,
        ]);
    }

    protected function createUser(): User
    {
        return User::factory()->create([
            'email' => 'safe_test_' . uniqid() . '_' . bin2hex(random_bytes(4)) . '@example.com',
        ]);
    }

    public function test_writes_refused_in_read_only_mode(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_only');
        $service = app(DataChangeService::class);

        $this->expectException(DataException::class);
        $this->expectExceptionMessage("read-only mode");

        $service->previewUpdate($conn, $user, 'posts', ['id' => 1], ['title' => 'New Title']);
    }

    public function test_writes_refused_on_blocked_tables(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_write');
        $service = app(DataChangeService::class);

        $this->expectException(DataException::class);
        $this->expectExceptionMessage("permanently blocked");

        $service->previewUpdate($conn, $user, 'tokens', ['id' => 1], ['token' => 'hacked']);
    }

    public function test_writes_refused_on_tables_without_primary_key(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_write');
        $service = app(DataChangeService::class);

        $this->expectException(DataException::class);
        $this->expectExceptionMessage("primary key");

        // 'page_views' table in fixture has no primary key
        $service->previewUpdate($conn, $user, 'page_views', ['path' => '/'], ['path' => '/home']);
    }

    public function test_safe_update_flow_with_preview_diff_pinned_pks_and_undo(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_write');
        $service = app(DataChangeService::class);

        // 1. Preview Update on post 1
        $preview = $service->previewUpdate(
            $conn,
            $user,
            'posts',
            ['id' => 1],
            ['title' => 'Updated Top Smart Phones Guide']
        );

        $this->assertTrue($preview['success']);
        $this->assertEquals(1, $preview['affected_count']);
        $this->assertArrayHasKey('diff_summary', $preview);
        $this->assertArrayHasKey('title', $preview['diff_summary']);
        $reqId = $preview['change_request_id'];

        // 2. Execute update
        $execRes = $service->executeChange($user, $reqId);
        $this->assertTrue($execRes['success']);
        $this->assertEquals(1, $execRes['affected_count']);

        // 3. Verify in target DB
        $pdo = new PDO('mysql:host=127.0.0.1;port=3317;dbname=shopfx_w', 'root', 'fxroot');
        $stmt = $pdo->query('SELECT title FROM posts WHERE id = 1');
        $this->assertEquals('Updated Top Smart Phones Guide', $stmt->fetchColumn());

        // 4. Undo change
        $undoRes = $service->undo($user, $reqId);
        $this->assertTrue($undoRes['success']);

        // 5. Verify original value restored
        $stmt = $pdo->query('SELECT title FROM posts WHERE id = 1');
        $this->assertEquals('Choosing the right laptop for college', $stmt->fetchColumn());
    }

    public function test_toctou_concurrency_rollback_when_affected_count_mismatches(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_write');
        $service = app(DataChangeService::class);

        // Preview update on post 2
        $preview = $service->previewUpdate(
            $conn,
            $user,
            'posts',
            ['id' => 2],
            ['title' => 'Concurrency Test Title']
        );
        $reqId = $preview['change_request_id'];

        // Simulate concurrent deletion of post 2 before execution
        $pdo = new PDO('mysql:host=127.0.0.1;port=3317;dbname=shopfx_w', 'root', 'fxroot');
        $origRow = $pdo->query('SELECT * FROM posts WHERE id = 2')->fetch(PDO::FETCH_ASSOC);
        $pdo->exec('DELETE FROM posts WHERE id = 2');

        try {
            $service->executeChange($user, $reqId);
            $this->fail('Expected TOCTOU mismatch exception to be thrown.');
        } catch (DataException $e) {
            $this->assertEquals('TOCTOU_MISMATCH', $e->errorCode);
            $this->assertStringContainsString('concurrently', $e->getMessage());
        } finally {
            // Restore deleted row for fixture idempotency
            $cols = array_keys($origRow);
            $placeholders = implode(', ', array_fill(0, count($cols), '?'));
            $pdo->prepare("INSERT INTO posts (" . implode(', ', $cols) . ") VALUES ({$placeholders})")
                ->execute(array_values($origRow));
        }
    }

    public function test_guarded_delete_flow_with_impact_analysis_typed_confirmation_and_undo(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_write_delete');
        $service = app(DataChangeService::class);

        // Preview deletion of post 12 (has tags in product_tags or no foreign keys)
        $preview = $service->previewDelete($conn, $user, 'posts', ['id' => 12]);

        $this->assertTrue($preview['success']);
        $this->assertEquals(1, $preview['affected_count']);
        $this->assertTrue($preview['requires_typed_confirmation']);
        $this->assertEquals('DELETE 1 posts', $preview['confirmation_phrase']);
        $reqId = $preview['change_request_id'];

        // Attempting to execute with wrong phrase or voice 'yes' fails
        try {
            $service->executeChange($user, $reqId, 'yes');
            $this->fail('Delete without exact typed confirmation phrase should be rejected.');
        } catch (DataException $e) {
            $this->assertEquals('TYPED_CONFIRMATION_REQUIRED', $e->errorCode);
        }

        // Executing with exact typed confirmation phrase succeeds
        $execRes = $service->executeChange($user, $reqId, 'DELETE 1 posts');
        $this->assertTrue($execRes['success']);

        // Verify row is deleted
        $pdo = new PDO('mysql:host=127.0.0.1;port=3317;dbname=shopfx_w', 'root', 'fxroot');
        $count = $pdo->query('SELECT COUNT(*) FROM posts WHERE id = 12')->fetchColumn();
        $this->assertEquals(0, (int) $count);

        // Undo deletion: restores row from encrypted before-image
        $undoRes = $service->undo($user, $reqId);
        $this->assertTrue($undoRes['success']);
        $this->assertEquals(1, $undoRes['restored_count']);

        // Verify row is restored
        $restored = $pdo->query('SELECT COUNT(*) FROM posts WHERE id = 12')->fetchColumn();
        $this->assertEquals(1, (int) $restored);
    }

    public function test_delete_refused_when_access_mode_is_not_read_write_delete(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_write'); // read_write does not allow delete
        $service = app(DataChangeService::class);

        $this->expectException(DataException::class);
        $this->expectExceptionMessage("Destructive operations (DELETE) are disabled");

        $service->previewDelete($conn, $user, 'posts', ['id' => 5]);
    }

    public function test_ast_read_gate_validates_sql_and_blocks_dangerous_functions(): void
    {
        $aiClient = app(AiServiceClient::class);

        // Valid SELECT query
        $validRes = $aiClient->analyzeSql("SELECT id, title FROM posts LIMIT 10", 'mysql');
        $this->assertTrue($validRes['valid']);
        $this->assertEquals('SELECT', strtoupper($validRes['statement_type']));
        $this->assertTrue($validRes['has_limit']);

        // Dangerous function pg_sleep blocked
        $sleepRes = $aiClient->analyzeSql("SELECT pg_sleep(10)", 'postgres');
        $this->assertFalse($sleepRes['valid']);
        $this->assertNotEmpty($sleepRes['errors']);
        $this->assertStringContainsString('dangerous function', strtolower($sleepRes['errors'][0]));

        // Dangerous function sleep blocked on MySQL
        $mySleepRes = $aiClient->analyzeSql("SELECT SLEEP(10)", 'mysql');
        $this->assertFalse($mySleepRes['valid']);
        $this->assertNotEmpty($mySleepRes['errors']);

        // DDL / mutations blocked
        $dropRes = $aiClient->analyzeSql("DROP TABLE users", 'mysql');
        $this->assertFalse($dropRes['valid']);
    }

    public function test_privacy_secret_columns_are_never_returned_and_pii_masked(): void
    {
        $user = $this->createUser();
        $conn = $this->createWritableConnection($user, 'read_only');
        $executor = app(ReadExecutor::class);

        $result = $executor->execute($conn, "SELECT * FROM users WHERE id = 1");

        $this->assertTrue($result['success']);
        $this->assertNotEmpty($result['rows']);
        $row = $result['rows'][0];

        // Secret columns (password_hash, remember_token) must NEVER be in returned rows
        $this->assertArrayNotHasKey('password_hash', $row);
        $this->assertArrayNotHasKey('remember_token', $row);

        // PII columns (email, phone) must be masked by default
        $this->assertStringContainsString('***@', $row['email']);
        $this->assertStringContainsString('*', $row['phone']);
    }
}
