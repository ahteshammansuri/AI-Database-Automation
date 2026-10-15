<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Models\SchemaSnapshot;
use App\Models\Automation;
use App\Models\ContentVersion;
use App\Services\ContextPackageService;
use App\Services\AiServiceClient;
use App\Services\SafeDatabaseExecutor;
use Tests\TestCase;
use Mockery;

class ContextPackageServiceTest extends TestCase
{
    protected function getTestConnection(User $user): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Context Package Test DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);
    }

    public function test_context_package_assembly_with_snapshot_and_constraints(): void
    {
        $user = User::factory()->create();
        $conn = $this->getTestConnection($user);

        // Create schema snapshot
        SchemaSnapshot::create([
            'user_id' => $user->id,
            'connection_id' => $conn->id,
            'version' => 1,
            'schema_payload' => [
                'tables' => [
                    [
                        'name' => 'posts',
                        'columns' => [
                            ['name' => 'id', 'type' => 'int', 'is_pk' => true, 'nullable' => false],
                            ['name' => 'title', 'type' => 'varchar', 'max_length' => 200, 'nullable' => false],
                            ['name' => 'slug', 'type' => 'varchar', 'max_length' => 200, 'nullable' => false, 'is_unique' => true],
                            ['name' => 'content', 'type' => 'text', 'nullable' => false],
                            ['name' => 'status', 'type' => 'varchar', 'nullable' => false, 'enum_values' => ['draft', 'published']],
                            ['name' => 'category_id', 'type' => 'int', 'nullable' => true, 'fk_table' => 'categories'],
                        ],
                    ],
                ],
            ],
            'table_count' => 1,
            'column_count' => 6,
        ]);

        $automation = Automation::create([
            'user_id' => $user->id,
            'connection_id' => $conn->id,
            'name' => 'Tech Blog Automation',
            'target_table' => 'posts',
            'operation_mode' => 'AI_CREATE',
            'field_mappings' => [
                ['column_name' => 'title', 'role' => 'title', 'confidence' => 0.97],
                ['column_name' => 'slug', 'role' => 'slug', 'confidence' => 0.97],
                ['column_name' => 'content', 'role' => 'body', 'confidence' => 0.95],
                ['column_name' => 'status', 'role' => 'status', 'confidence' => 0.95],
                ['column_name' => 'category_id', 'role' => 'category_ref', 'confidence' => 0.95],
            ],
            'prompt_context' => 'Write about cloud computing trends',
            'schedule_type' => 'DAILY',
            'requires_approval' => true,
            'is_active' => true,
        ]);
        $automation->brand_voice = 'Professional, authoritative, and concise';
        $automation->category_name = 'Cloud';

        $aiClient = Mockery::mock(AiServiceClient::class);
        $aiClient->shouldReceive('queryKnowledge')
            ->andReturn([
                [
                    'chunk_id' => 'chunk_1',
                    'document_id' => 10,
                    'text' => 'Cloud migration best practices include adopting microservices architecture.',
                    'score' => 0.88,
                    'embedding_backend' => 'ollama',
                ]
            ]);

        $executor = Mockery::mock(SafeDatabaseExecutor::class);
        $executor->shouldReceive('lookupReferenceValues')
            ->andReturn(['Cloud', 'DevOps', 'Security']);

        $service = new ContextPackageService($aiClient, $executor);
        $package = $service->assemble($automation);

        $this->assertEquals('posts', $package['target_table']);
        $this->assertEquals('Write about cloud computing trends', $package['topic_prompt']);
        $this->assertEquals('Professional, authoritative, and concise', $package['brand_voice']);
        $this->assertStringContainsString('Target category: Cloud', $package['business_rules']);
        $this->assertCount(1, $package['kb_chunks']);
        $this->assertEquals('chunk_1', $package['kb_chunks'][0]['chunk_id']);

        // Check schema constraints
        $this->assertArrayHasKey('title', $package['schema_constraints']);
        $this->assertEquals(200, $package['schema_constraints']['title']['max_length']);
        $this->assertTrue($package['schema_constraints']['title']['required']);
        $this->assertEquals(['draft', 'published'], $package['schema_constraints']['status']['enum_values']);

        // Check relation catalog
        $this->assertArrayHasKey('category_id', $package['relation_catalog']);
        $this->assertEquals(['Cloud', 'DevOps', 'Security'], $package['relation_catalog']['category_id']['values']);

        // Check prompt string formatting contains delimiters
        $promptStr = $service->toPromptString($package);
        $this->assertStringContainsString('<UNTRUSTED_CONTENT source=', $promptStr);
        $this->assertStringContainsString('</UNTRUSTED_CONTENT>', $promptStr);
        $this->assertStringContainsString('Cloud migration best practices', $promptStr);
    }
}
