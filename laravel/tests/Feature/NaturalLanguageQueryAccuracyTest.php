<?php

namespace Tests\Feature;

use App\Models\DbConnection;
use App\Models\User;
use App\Services\Data\DataAgentService;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Live accuracy evaluation of the data assistant: real AI service, the configured local model and the
 * synthetic shopfx fixture (127.0.0.1:3317). Every question has hand-written reference SQL; the
 * assistant's rows must match what the database really returns — not just "some query ran".
 *
 * Needs a running AI service and model, so it only runs when ORBIT_LIVE_EVAL=1:
 *   ORBIT_LIVE_EVAL=1 php artisan test --filter=NaturalLanguageQueryAccuracyTest
 */
class NaturalLanguageQueryAccuracyTest extends TestCase
{
    /** [question, reference SQL, comparison] — scalar | rows (each reference row appears; same count) | count */
    protected const CASES = [
        ['how many users are there?', 'SELECT COUNT(*) FROM users', 'scalar'],
        ['how many orders were refunded?', "SELECT COUNT(*) FROM orders WHERE status = 'refunded'", 'scalar'],
        ['what is the sum of order totals for orders with status paid or shipped?', "SELECT SUM(total) FROM orders WHERE status IN ('paid', 'shipped')", 'scalar'],
        ['what is the average order total?', 'SELECT AVG(total) FROM orders', 'scalar'],
        ['what is the highest product price?', 'SELECT MAX(price) FROM products', 'scalar'],
        ['Rajasthan ke kitne users hain?', "SELECT COUNT(*) FROM users WHERE region = 'RJ'", 'scalar'],
        ['how many published posts are there?', "SELECT COUNT(*) FROM posts WHERE status = 'published'", 'scalar'],
        ['number of users by region', 'SELECT region, COUNT(*) FROM users GROUP BY region', 'rows'],
        ['count of orders by status', 'SELECT status, COUNT(*) FROM orders GROUP BY status', 'rows'],
        ['which customer placed the most orders?',
            'SELECT u.name, COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id GROUP BY u.id, u.name ORDER BY n DESC LIMIT 1', 'rows'],
        ['Aisa kaun sa user hai jisne sabse jyada order refund kare ho',
            "SELECT u.name, COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'refunded' GROUP BY u.id, u.name
             HAVING COUNT(*) = (SELECT MAX(c) FROM (SELECT COUNT(*) c FROM orders WHERE status = 'refunded' GROUP BY user_id) m)", 'rows'],
        ['top 3 products by quantity sold',
            'SELECT p.name, SUM(oi.qty) AS q FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.id, p.name ORDER BY q DESC LIMIT 3', 'rows'],
        ['which user spent the most on paid or shipped orders?',
            "SELECT u.name, SUM(o.total) AS s FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status IN ('paid', 'shipped') GROUP BY u.id, u.name ORDER BY s DESC LIMIT 1", 'rows'],
        ['list the products with fewer than 100 units in stock', 'SELECT id FROM products WHERE stock < 100', 'count'],
        ['which products cost more than 50000?', 'SELECT id FROM products WHERE price > 50000', 'count'],
        ['list the orders placed by user 1', 'SELECT id FROM orders WHERE user_id = 1', 'count'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        if (!env('ORBIT_LIVE_EVAL')) {
            $this->markTestSkipped('Live model evaluation: set ORBIT_LIVE_EVAL=1 with the AI service running.');
        }
    }

    public function test_answers_match_the_real_database_on_the_shop_fixture(): void
    {
        $user = User::factory()->create(['timezone' => 'Asia/Kolkata']);
        $conn = DbConnection::create([
            'user_id' => $user->id, 'name' => 'Evaluation MySQL Shop DB', 'db_type' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317,
            'database_name' => 'shopfx', 'username' => 'root', 'encrypted_password' => 'fxroot', 'ssl_mode' => 'disabled',
            'access_mode' => 'read_only', 'data_timezone' => 'Asia/Kolkata', 'is_active' => true,
        ]);
        $truthDb = DB::build(['driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317, 'database' => 'shopfx', 'username' => 'root', 'password' => 'fxroot']);
        $agent = app(DataAgentService::class);

        $passed = 0;
        $report = [];
        foreach (self::CASES as [$question, $referenceSql, $mode]) {
            $truth = array_map(fn ($r) => array_values((array) $r), $truthDb->select($referenceSql));
            $res = $agent->ask($user, $question, $conn->id);
            $ok = !empty($res['success']) && ($res['type'] ?? '') === 'data_query' && $this->answerMatches($mode, $truth, $res);
            $passed += $ok ? 1 : 0;
            $report[] = ($ok ? 'PASS ' : 'FAIL ') . $question . ' | ' . mb_substr((string) ($res['message'] ?? ''), 0, 140)
                . ' | SQL: ' . mb_substr((string) ($res['diagnostics']['sql'] ?? ''), 0, 200);
        }

        $total = count(self::CASES);
        fwrite(STDERR, "\n[Data assistant live accuracy] {$passed}/{$total}\n" . implode("\n", $report) . "\n");
        $this->assertSame($total, $passed, "Live accuracy {$passed}/{$total}; see the report above.");
    }

    /** Values compared as normalised strings; numbers with a 0.5% tolerance (rounding differences). */
    protected function answerMatches(string $mode, array $truth, array $res): bool
    {
        $rows = array_map(fn ($r) => array_values((array) $r), $res['rows'] ?? []);
        $same = function ($a, $b): bool {
            if (is_numeric($a) && is_numeric($b)) {
                return abs((float) $a - (float) $b) <= max(0.01, abs((float) $b) * 0.005);
            }
            return mb_strtolower(trim((string) $a)) === mb_strtolower(trim((string) $b));
        };
        $rowHas = fn (array $row, array $values) => collect($values)->every(fn ($v) => collect($row)->contains(fn ($x) => $same($x, $v)));

        return match ($mode) {
            'scalar' => count($rows) === 1 && collect($rows[0])->contains(fn ($x) => $same($x, $truth[0][0] ?? null)),
            'count' => (int) ($res['row_count'] ?? -1) === count($truth),
            default => count($rows) >= count($truth)
                && collect($truth)->every(fn ($t) => collect($rows)->contains(fn ($r) => $rowHas($r, $t))),
        };
    }
}
