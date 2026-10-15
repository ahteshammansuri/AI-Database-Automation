<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Services\RelationshipResolverService;
use App\Services\DatabaseSafetyService;
use Tests\TestCase;
use PDO;

class RelationshipResolverServiceTest extends TestCase
{
    protected function getTestConnection(User $user): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Resolver Test DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);
    }

    public function test_resolve_only_matches_existing_record(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);
        $pdo = $conn->createTargetPdo();

        $service = app(RelationshipResolverService::class);

        // First insert a known category directly
        $catName = 'DevOps ' . uniqid();
        $stmt = $pdo->prepare("INSERT INTO categories (name, slug, description) VALUES (:name, :slug, :desc)");
        $stmt->execute([
            'name' => $catName,
            'slug' => \Illuminate\Support\Str::slug($catName),
            'desc' => 'DevOps practices',
        ]);
        $existingId = (int) $pdo->lastInsertId();

        // Test case-insensitive resolution with resolve_only
        $result = $service->resolve(
            pdo: $pdo,
            dbName: $conn->database_name,
            refTable: 'categories',
            refCol: 'id',
            lookupValue: strtolower($catName),
            policy: RelationshipResolverService::POLICY_RESOLVE_ONLY
        );

        $this->assertEquals('MATCHED', $result['matched_or_created']);
        $this->assertEquals($existingId, $result['real_id']);
        $this->assertEquals(RelationshipResolverService::POLICY_RESOLVE_ONLY, $result['policy_used']);
    }

    public function test_resolve_only_fails_when_record_missing(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);
        $pdo = $conn->createTargetPdo();

        $service = app(RelationshipResolverService::class);

        $nonExistent = 'NonExistentCategory_' . uniqid();

        $result = $service->resolve(
            pdo: $pdo,
            dbName: $conn->database_name,
            refTable: 'categories',
            refCol: 'id',
            lookupValue: $nonExistent,
            policy: RelationshipResolverService::POLICY_RESOLVE_ONLY
        );

        $this->assertEquals('FAILED', $result['matched_or_created']);
        $this->assertNull($result['real_id']);
    }

    public function test_create_if_missing_creates_new_record_atomically(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);
        $pdo = $conn->createTargetPdo();

        $service = app(RelationshipResolverService::class);

        $newCatName = 'Artificial Intelligence ' . uniqid();

        $result = $service->resolve(
            pdo: $pdo,
            dbName: $conn->database_name,
            refTable: 'categories',
            refCol: 'id',
            lookupValue: $newCatName,
            policy: RelationshipResolverService::POLICY_CREATE_IF_MISSING
        );

        $this->assertEquals('CREATED', $result['matched_or_created']);
        $this->assertNotNull($result['real_id']);
        $this->assertGreaterThan(0, $result['real_id']);

        // Verify record actually exists in target MySQL
        $check = $pdo->prepare("SELECT id, name FROM categories WHERE id = :id");
        $check->execute(['id' => $result['real_id']]);
        $row = $check->fetch(PDO::FETCH_ASSOC);
        $this->assertNotEmpty($row);
        $this->assertEquals($newCatName, $row['name']);
    }

    public function test_sensitive_table_auto_creation_is_strictly_blocked(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);
        $pdo = $conn->createTargetPdo();

        $service = app(RelationshipResolverService::class);

        // Attempting to create_if_missing in 'users' table must be downgraded to resolve_only
        $result = $service->resolve(
            pdo: $pdo,
            dbName: $conn->database_name,
            refTable: 'users',
            refCol: 'id',
            lookupValue: 'Hacker User ' . uniqid(),
            policy: RelationshipResolverService::POLICY_CREATE_IF_MISSING
        );

        $this->assertEquals('FAILED', $result['matched_or_created']);
        $this->assertEquals(RelationshipResolverService::POLICY_RESOLVE_ONLY, $result['policy_used']);
        $this->assertNull($result['real_id']);
    }

    public function test_numeric_id_is_reused(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);
        $pdo = $conn->createTargetPdo();

        $service = app(RelationshipResolverService::class);

        // Find any existing category ID
        $stmt = $pdo->query("SELECT id FROM categories LIMIT 1");
        $catId = (int) $stmt->fetchColumn();

        $result = $service->resolve(
            pdo: $pdo,
            dbName: $conn->database_name,
            refTable: 'categories',
            refCol: 'id',
            lookupValue: $catId,
            policy: RelationshipResolverService::POLICY_RESOLVE_ONLY
        );

        $this->assertEquals('REUSED_BY_ID', $result['matched_or_created']);
        $this->assertEquals($catId, $result['real_id']);
    }
}
