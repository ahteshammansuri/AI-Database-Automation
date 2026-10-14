<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\SchemaTableAnnotation;
use App\Services\DatabaseSafetyService;
use App\Services\SafeDatabaseExecutor;
use App\Services\SchemaIntrospectionService;
use Tests\TestCase;

class IntelligentRelationalAndSchemaTest extends TestCase
{
    protected function getTestConnection(User $user): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Test MySQL DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);
    }

    public function test_four_tier_table_classification(): void
    {
        $safety = app(DatabaseSafetyService::class);

        // Tier 1: Recommended
        $postsTier = $safety->classifyTableEligibility('posts', ['id', 'title', 'slug', 'content', 'status']);
        $this->assertEquals('RECOMMENDED', $postsTier['tier']);
        $this->assertTrue($postsTier['eligible']);

        // Tier 2: Review Required (e.g. users, audit_logs)
        $auditTier = $safety->classifyTableEligibility('audit_logs', ['id', 'action', 'user_id', 'created_at']);
        $this->assertEquals('RESTRICTED', $auditTier['tier']);
        $this->assertFalse($auditTier['eligible']);

        // Ambiguous / catalog table without content
        $metaTier = $safety->classifyTableEligibility('meta_lookups', ['id', 'code', 'value']);
        $this->assertContains($metaTier['tier'], ['RECOMMENDED', 'REVIEW_REQUIRED']);

        // Tier 3: Restricted
        $usersTier = $safety->classifyTableEligibility('users', ['id', 'email', 'password']);
        $this->assertEquals('RESTRICTED', $usersTier['tier']);
        $this->assertFalse($usersTier['eligible']);
    }

    public function test_workspace_table_annotation_endpoint(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);

        $response = $this->actingAs($user)->postJson("/api/connections/{$conn->id}/tables/posts/annotate", [
            'user_notes' => 'Primary editorial blog table for AI automation pipelines.',
            'override_tier' => 'RECOMMENDED',
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'message' => 'Table annotation saved to workspace knowledge',
        ]);

        $this->assertDatabaseHas('schema_table_annotations', [
            'user_id' => $user->id,
            'connection_id' => $conn->id,
            'table_name' => 'posts',
            'user_override_notes' => 'Primary editorial blog table for AI automation pipelines.',
        ]);
    }

    public function test_intelligent_relational_record_resolution_and_category_creation(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);
        $executor = app(SafeDatabaseExecutor::class);

        // Case A: Create a post referencing a brand-new category with CREATE_IF_MISSING policy
        $uniqueCatName = 'Cloud Native ' . uniqid();
        $postTitle = 'Cloud Native Architecture ' . uniqid();
        $postSlug = 'cloud-native-arch-' . uniqid();

        $result = $executor->executeInsert(
            $conn,
            'posts',
            [
                'title' => $postTitle,
                'slug' => $postSlug,
                'content' => 'Microservice scalability guidelines.',
                'status' => 'draft',
                'category_id' => $uniqueCatName, // String category name to resolve
            ],
            [
                'category_id' => [
                    'policy' => 'CREATE_IF_MISSING',
                    'referenced_table' => 'categories',
                    'lookup_column' => 'name',
                ],
            ]
        );

        $this->assertTrue($result['success']);
        $this->assertNotEmpty($result['record_id']);
        $this->assertNotEmpty($result['relation_resolutions']);

        $res = $result['relation_resolutions'][0];
        $this->assertEquals('categories', $res['table']);
        $this->assertContains($res['action'], ['CREATED_NEW', 'MATCHED_EXISTING']);
        $resolvedCatId = $res['resolved_id'];
        $this->assertGreaterThan(0, $resolvedCatId);

        // Case B: Second insert with the same category name must reuse the existing ID (MATCHED_EXISTING)
        $secondPostTitle = 'Cloud Native Second Post ' . uniqid();
        $secondPostSlug = 'cloud-native-second-' . uniqid();

        $result2 = $executor->executeInsert(
            $conn,
            'posts',
            [
                'title' => $secondPostTitle,
                'slug' => $secondPostSlug,
                'content' => 'Reusing existing category.',
                'status' => 'draft',
                'category_id' => $uniqueCatName,
            ],
            [
                'category_id' => [
                    'policy' => 'CREATE_IF_MISSING',
                    'referenced_table' => 'categories',
                    'lookup_column' => 'name',
                ],
            ]
        );

        $this->assertTrue($result2['success']);
        $res2 = $result2['relation_resolutions'][0];
        $this->assertEquals('MATCHED_EXISTING', $res2['action']);
        $this->assertEquals($resolvedCatId, $res2['resolved_id']);
    }

    public function test_propose_automation_plan_api(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);

        $response = $this->actingAs($user)->postJson('/api/automations/propose-plan', [
            'connection_id' => $conn->id,
            'prompt' => 'Create one useful article about Database Performance every morning. Assign to Database Tuning category (create if missing), publish at 9 AM with approval.',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'message',
            'plan' => [
                'name',
                'target_table',
                'operation_mode',
                'field_mappings',
                'schedule_config',
                'approval_policy',
                'explanation',
            ],
        ]);

        $plan = $response->json('plan');
        $this->assertEquals('posts', $plan['target_table']);
        $this->assertNotEmpty($plan['field_mappings']);
    }
}
