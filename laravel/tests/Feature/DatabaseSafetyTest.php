<?php

namespace Tests\Feature;

use App\Services\DatabaseSafetyService;
use Tests\TestCase;
use Exception;

class DatabaseSafetyTest extends TestCase
{
    public function test_ssrf_metadata_ip_is_blocked(): void
    {
        $safety = app(DatabaseSafetyService::class);

        $this->expectException(Exception::class);
        $this->expectExceptionMessage("prohibited");

        $safety->validateConnectionTarget('169.254.169.254', 3306);
    }

    public function test_sensitive_tables_are_classified_as_restricted(): void
    {
        $safety = app(DatabaseSafetyService::class);

        $this->assertTrue($safety->isTableSensitive('users'));
        $this->assertTrue($safety->isTableSensitive('user_accounts'));
        $this->assertTrue($safety->isTableSensitive('payments'));
        $this->assertTrue($safety->isTableSensitive('credit_cards'));
        $this->assertTrue($safety->isTableSensitive('audit_logs'));

        $this->assertFalse($safety->isTableSensitive('posts'));
        $this->assertFalse($safety->isTableSensitive('categories'));
        $this->assertFalse($safety->isTableSensitive('products'));
        $this->assertFalse($safety->isTableSensitive('faqs'));
    }

    public function test_forbidden_sql_statements_are_intercepted(): void
    {
        $safety = app(DatabaseSafetyService::class);

        $forbiddenQueries = [
            "DELETE FROM posts WHERE id = 1",
            "DROP TABLE users",
            "TRUNCATE TABLE categories",
            "ALTER TABLE posts ADD COLUMN evil VARCHAR(255)",
            "CREATE TABLE hack (id INT)",
            "GRANT ALL PRIVILEGES ON *.* TO 'attacker'",
        ];

        foreach ($forbiddenQueries as $query) {
            try {
                $safety->assertQueryIsSafe($query);
                $this->fail("Expected query '{$query}' to be rejected, but it passed.");
            } catch (Exception $e) {
                $this->assertStringContainsString("Security violation", $e->getMessage());
            }
        }
    }

    public function test_allowed_insert_statement_passes_interceptor(): void
    {
        $safety = app(DatabaseSafetyService::class);

        $safeQuery = "INSERT INTO `posts` (`title`, `slug`, `content`) VALUES (:title, :slug, :content)";
        $safety->assertQueryIsSafe($safeQuery);
        $this->assertTrue(true);
    }
}
