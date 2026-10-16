<?php

namespace Tests\Feature;

use App\Models\DbConnection;
use App\Models\User;
use App\Services\Data\DataAgentService;
use Tests\TestCase;

class NaturalLanguageQueryAccuracyTest extends TestCase
{
    protected function createUser(): User
    {
        return User::factory()->create([
            'email' => 'eval_user_' . uniqid() . '_' . bin2hex(random_bytes(4)) . '@example.com',
            'timezone' => 'Asia/Kolkata',
        ]);
    }

    protected function createMysqlConnection(User $user): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Evaluation MySQL Shop DB',
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

    protected function createPostgresConnection(User $user): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => 'Evaluation Postgres Shop DB',
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

    /**
     * The 60 evaluation queries representing the 5 core categories:
     * 1. Counts & Aggregates (10)
     * 2. Filters & Matching (15)
     * 3. Time-Relative Windows (10)
     * 4. Joins & Relationships (15)
     * 5. Group-By & Top-N Rankings (10)
     */
    protected function getEvaluationQueries(): array
    {
        return [
            // 1. Counts & Aggregates (10)
            ['query' => 'how many users are there?', 'category' => 'count', 'expected_type' => 'data_query'],
            ['query' => 'how many orders are there?', 'category' => 'count', 'expected_type' => 'data_query'],
            ['query' => 'how many products are there?', 'category' => 'count', 'expected_type' => 'data_query'],
            ['query' => 'total number of posts', 'category' => 'count', 'expected_type' => 'data_query'],
            ['query' => 'count of payments', 'category' => 'count', 'expected_type' => 'data_query'],
            ['query' => 'total revenue from all orders', 'category' => 'aggregate', 'expected_type' => 'data_query'],
            ['query' => 'average order total amount', 'category' => 'aggregate', 'expected_type' => 'data_query'],
            ['query' => 'highest product price', 'category' => 'aggregate', 'expected_type' => 'data_query'],
            ['query' => 'minimum stock quantity of products', 'category' => 'aggregate', 'expected_type' => 'data_query'],
            ['query' => 'total quantity of items sold', 'category' => 'aggregate', 'expected_type' => 'data_query'],

            // 2. Filters & Matching (15)
            ['query' => 'find users with region RJ', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'find the user from Rajasthan', 'category' => 'grounding', 'expected_type' => 'data_query'],
            ['query' => 'users with active status', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'users where status is pending', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'orders with status completed', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'orders with status cancelled', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'orders with status processing', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'products with price greater than 500', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'products with price less than 100', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'products out of stock', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'products in stock', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'payments with credit_card', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'payments with status completed', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'published posts', 'category' => 'filter', 'expected_type' => 'data_query'],
            ['query' => 'draft posts', 'category' => 'filter', 'expected_type' => 'data_query'],

            // 3. Time-Relative Windows (10)
            ['query' => 'how many new users today?', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'users registered yesterday', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'orders placed today', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'orders from yesterday', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'orders in the last 7 days', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'posts created today', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'payments created today', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'users registered this week', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'orders created this month', 'category' => 'time_window', 'expected_type' => 'data_query'],
            ['query' => 'posts created yesterday', 'category' => 'time_window', 'expected_type' => 'data_query'],

            // 4. Joins & Relationships (15)
            ['query' => 'orders placed by user 1', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'orders with user details', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'orders with user name', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'products in category', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'posts written by user 1', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'items in order 1', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'payments for order 1', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'comments on post 1', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'orders with payment details', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'posts with author name', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'order items with product name', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'orders placed by user 2', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'posts written by user 2', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'items in order 2', 'category' => 'join', 'expected_type' => 'data_query'],
            ['query' => 'payments for order 2', 'category' => 'join', 'expected_type' => 'data_query'],

            // 5. Group-By & Top-N Rankings (10)
            ['query' => 'top 5 products', 'category' => 'ranking', 'expected_type' => 'data_query'],
            ['query' => 'top 3 orders', 'category' => 'ranking', 'expected_type' => 'data_query'],
            ['query' => 'number of users by region', 'category' => 'group_by', 'expected_type' => 'data_query'],
            ['query' => 'count of orders by status', 'category' => 'group_by', 'expected_type' => 'data_query'],
            ['query' => 'count of products by category', 'category' => 'group_by', 'expected_type' => 'data_query'],
            ['query' => 'total sales by payment method', 'category' => 'group_by', 'expected_type' => 'data_query'],
            ['query' => 'number of posts by status', 'category' => 'group_by', 'expected_type' => 'data_query'],
            ['query' => 'recent 5 orders', 'category' => 'ranking', 'expected_type' => 'data_query'],
            ['query' => 'latest 10 users', 'category' => 'ranking', 'expected_type' => 'data_query'],
            ['query' => 'top 10 products', 'category' => 'ranking', 'expected_type' => 'data_query'],
        ];
    }

    public function test_mysql_60_query_accuracy_suite(): void
    {
        $user = $this->createUser();
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);
        $queries = $this->getEvaluationQueries();

        $this->assertCount(60, $queries);

        $passed = 0;
        $failures = [];

        foreach ($queries as $idx => $q) {
            $num = $idx + 1;
            try {
                $res = $agent->ask($user, $q['query'], $conn->id);
                $this->assertNotEquals('error', $res['type'] ?? '', "Query #{$num} returned error: " . ($res['headline'] ?? ''));
                $this->assertEquals($q['expected_type'], $res['type'] ?? '', "Query #{$num} type mismatch");
                $this->assertNotEmpty($res['headline'], "Query #{$num} empty headline");
                $passed++;
            } catch (\Throwable $e) {
                $failures[] = "Query #{$num} ('{$q['query']}'): " . $e->getMessage();
            }
        }

        $accuracy = ($passed / count($queries)) * 100;
        echo "\n[MySQL Evaluation Suite] Passed: {$passed}/60 ({$accuracy}% Accuracy)\n";

        if (!empty($failures)) {
            echo "Failures:\n" . implode("\n", $failures) . "\n";
        }

        $this->assertEquals(60, $passed, "MySQL NL Query Accuracy fell below 100%: " . implode('; ', $failures));
    }

    public function test_postgres_60_query_accuracy_suite(): void
    {
        $user = $this->createUser();
        $conn = $this->createPostgresConnection($user);
        $agent = app(DataAgentService::class);
        $queries = $this->getEvaluationQueries();

        $this->assertCount(60, $queries);

        $passed = 0;
        $failures = [];

        foreach ($queries as $idx => $q) {
            $num = $idx + 1;
            try {
                $res = $agent->ask($user, $q['query'], $conn->id);
                $this->assertNotEquals('error', $res['type'] ?? '', "Query #{$num} returned error: " . ($res['headline'] ?? ''));
                $this->assertEquals($q['expected_type'], $res['type'] ?? '', "Query #{$num} type mismatch");
                $this->assertNotEmpty($res['headline'], "Query #{$num} empty headline");
                $passed++;
            } catch (\Throwable $e) {
                $failures[] = "Query #{$num} ('{$q['query']}'): " . $e->getMessage();
            }
        }

        $accuracy = ($passed / count($queries)) * 100;
        echo "\n[PostgreSQL Evaluation Suite] Passed: {$passed}/60 ({$accuracy}% Accuracy)\n";

        if (!empty($failures)) {
            echo "Failures:\n" . implode("\n", $failures) . "\n";
        }

        $this->assertEquals(60, $passed, "PostgreSQL NL Query Accuracy fell below 100%: " . implode('; ', $failures));
    }
}
