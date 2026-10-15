<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\DbConnection;
use App\Services\SchemaIntrospectionService;
use App\Services\DatabaseSafetyService;
use App\Services\AiServiceClient;
use Tests\TestCase;
use Mockery;

class TableProfileRagTest extends TestCase
{
    public function test_generate_table_profile_markdown(): void
    {
        $user = User::factory()->create();
        $conn = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Profile Test DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);

        $safety = app(DatabaseSafetyService::class);
        $service = new SchemaIntrospectionService($safety);

        $table = [
            'name' => 'articles',
            'tier' => 'RECOMMENDED',
            'eligible' => true,
            'approx_rows' => 450,
            'user_notes' => 'Primary editorial article repository',
            'columns' => [
                ['name' => 'id', 'type' => 'int', 'is_pk' => true, 'nullable' => false],
                ['name' => 'headline', 'type' => 'varchar', 'max_length' => 255, 'nullable' => false],
                ['name' => 'category_id', 'type' => 'int', 'nullable' => true, 'fk_table' => 'categories'],
                ['name' => 'status', 'type' => 'varchar', 'enum_values' => ['draft', 'published', 'archived']],
            ],
        ];

        $md = $service->generateTableProfileMarkdown($conn, $table);

        $this->assertStringContainsString('# Table Profile: articles', $md);
        $this->assertStringContainsString('demo_blog_cms', $md);
        $this->assertStringContainsString('RECOMMENDED', $md);
        $this->assertStringContainsString('Primary Key**: id', $md);
        $this->assertStringContainsString('`category_id` → `categories`', $md);
        $this->assertStringContainsString('`headline`: `varchar` (NOT NULL, max=255)', $md);
        $this->assertStringContainsString('`status`: `varchar`', $md);
        $this->assertStringContainsString('enum=[draft, published, archived]', $md);
        $this->assertStringContainsString('Safe for parameterized automated operations', $md);
    }

    public function test_index_table_profiles_into_rag_calls_ai_client(): void
    {
        $user = User::factory()->create();
        $conn = DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Profile Test DB',
            'db_type' => 'mysql',
            'host' => '127.0.0.1',
            'port' => 3308,
            'database_name' => 'demo_blog_cms',
            'username' => 'root',
            'encrypted_password' => 'ipo_root_password',
            'ssl_mode' => 'prefer',
        ]);

        $safety = app(DatabaseSafetyService::class);

        $aiClient = Mockery::mock(AiServiceClient::class);
        $aiClient->shouldReceive('indexDocument')
            ->twice()
            ->andReturn(['success' => true, 'chunks' => 2]);

        $service = new SchemaIntrospectionService($safety, $aiClient);

        $tables = [
            [
                'name' => 'posts',
                'tier' => 'RECOMMENDED',
                'eligible' => true,
                'columns' => [
                    ['name' => 'id', 'type' => 'int', 'is_pk' => true],
                    ['name' => 'title', 'type' => 'varchar', 'max_length' => 200],
                ],
            ],
            [
                'name' => 'categories',
                'tier' => 'RECOMMENDED',
                'eligible' => true,
                'columns' => [
                    ['name' => 'id', 'type' => 'int', 'is_pk' => true],
                    ['name' => 'name', 'type' => 'varchar', 'max_length' => 100],
                ],
            ],
        ];

        $indexedCount = $service->indexTableProfilesIntoRag($conn, $tables);
        $this->assertEquals(2, $indexedCount);
    }
}
