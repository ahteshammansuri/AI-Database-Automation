<?php

namespace Tests\Feature;

use App\Models\DbConnection;
use App\Models\User;
use App\Services\Data\DataAgentService;
use App\Services\Data\DummyDataDetector;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class NaturalLanguageDataAgentTest extends TestCase
{
    protected function createMysqlConnection(User $user, string $name = 'Shop DB'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => $name,
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

    protected function createPostgresConnection(User $user, string $name = 'PG Shop DB'): DbConnection
    {
        return DbConnection::create([
            'user_id' => $user->id,
            'name' => $name,
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

    public function test_introspection_table_count_and_list_matches_live_mysql_schema(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'how many tables are there in my database?', $conn->id);

        $this->assertEquals('schema_overview', $res['type']);
        $this->assertCount(13, $res['tables']);
        $this->assertContains('users', $res['tables']);
        $this->assertContains('orders', $res['tables']);
        $this->assertContains('posts', $res['tables']);
        $this->assertStringContainsString('13 tables', $res['headline']);
    }

    public function test_postgres_introspection_table_count_and_list_matches_live_schema(): void
    {
        $user = User::factory()->create();
        $conn = $this->createPostgresConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'how many tables are there in my database?', $conn->id);

        $this->assertEquals('schema_overview', $res['type']);
        $this->assertCount(13, $res['tables']);
        $this->assertContains('users', $res['tables']);
        $this->assertContains('orders', $res['tables']);
    }

    public function test_semantic_table_discovery_finds_user_data_with_evidence(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $agent = app(DataAgentService::class);

        $res = $agent->ask($user, 'which table stores the user data?', $conn->id);

        $this->assertEquals('table_discovery', $res['type']);
        $this->assertNotNull($res['best_match']);
        $this->assertEquals('users', $res['best_match']['table']);
        $this->assertGreaterThan(0, count($res['best_match']['evidence']));
        $this->assertStringContainsString('users', $res['headline']);
    }

    /**
     * Fake the AI service: the model "writes" the given SQL in order, and the gate accepts it unless the
     * entry is ['reject' => 'reason'] (the real gate is covered by ai_service/tests/test_data_sql.py).
     */
    protected function fakeModelSql(array ...$attempts): void
    {
        $writes = Http::sequence();
        $gates = Http::sequence();
        foreach ($attempts as $a) {
            $writes->push(['success' => true, 'sql' => $a['sql'] ?? '', 'assumptions' => $a['assumptions'] ?? [], 'clarification' => $a['clarification'] ?? ''], 200);
            if (($a['sql'] ?? '') !== '') {
                $gates->push(isset($a['reject'])
                    ? ['valid' => false, 'sql' => null, 'tables' => [], 'errors' => [$a['reject']]]
                    : ['valid' => true, 'sql' => $a['sql'] . ' LIMIT 200', 'tables' => $a['tables'] ?? ['users'], 'errors' => []], 200);
            }
        }
        Http::fake(['*/v1/ai/data/sql' => $writes, '*/v1/sql/validate-select' => $gates]);
    }

    protected function sqlRequests(): array
    {
        return Http::recorded(fn ($r) => str_ends_with($r->url(), '/v1/ai/data/sql'))->map(fn ($p) => $p[0]->data())->values()->all();
    }

    public function test_time_relative_question_runs_the_models_query_in_the_connection_timezone(): void
    {
        $user = User::factory()->create(['timezone' => 'Asia/Kolkata']);
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(['sql' => 'SELECT COUNT(*) AS new_users FROM users WHERE DATE(created_at) = CURDATE()',
            'assumptions' => ['"new" users = created_at today (Asia/Kolkata)']]);

        $res = app(DataAgentService::class)->ask($user, 'how many new users today?', $conn->id);

        $this->assertTrue($res['success']);
        $this->assertSame('data_query', $res['type']);
        $this->assertStringContainsString('CURDATE()', $res['diagnostics']['sql']);
        $this->assertStringContainsString('created_at', implode(' ', $res['assumptions']));
        $this->assertSame('Asia/Kolkata', $this->sqlRequests()[0]['timezone']);
        $this->assertArrayHasKey('new_users', $res['rows'][0]);
    }

    public function test_ranking_question_answers_with_the_real_top_rows_including_ties(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $sql = "SELECT u.id, u.name, COUNT(o.id) AS refunds FROM users u JOIN orders o ON o.user_id = u.id WHERE o.status = 'refunded' "
            . 'GROUP BY u.id, u.name ORDER BY refunds DESC, u.id ASC';
        $this->fakeModelSql(['sql' => $sql, 'tables' => ['users', 'orders']]);

        $res = app(DataAgentService::class)->ask($user, 'Aisa kaun sa user hai jisne sabse jyada order refund kare ho', $conn->id);

        $this->assertTrue($res['success'], json_encode($res));
        $truth = \Illuminate\Support\Facades\DB::build(['driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317, 'database' => 'shopfx',
            'username' => 'root', 'password' => 'fxroot'])->select("SELECT user_id, COUNT(*) n FROM orders WHERE status = 'refunded' GROUP BY user_id ORDER BY n DESC, user_id ASC LIMIT 3");
        $this->assertSame($truth[0]->user_id, $res['rows'][0]['id']);
        $this->assertSame((int) $truth[0]->n, (int) $res['rows'][0]['refunds']);
        $this->assertStringContainsString('refunds', $res['message']);
        $this->assertStringContainsString('Aisa kaun sa user', $this->sqlRequests()[0]['question'], 'the original wording reaches the model');
    }

    public function test_a_top_n_that_ends_inside_a_tie_is_widened_and_every_tied_row_is_named(): void
    {
        // Real data: six customers share the top refund count (2); a "top 5" alone would hide one of them.
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $sql = "SELECT u.id, u.name, COUNT(o.id) AS refunds FROM users u JOIN orders o ON o.user_id = u.id WHERE o.status = 'refunded' GROUP BY u.id, u.name ORDER BY refunds DESC";
        Http::fake([
            '*/v1/ai/data/sql' => Http::response(['success' => true, 'sql' => "{$sql} LIMIT 5", 'assumptions' => [], 'clarification' => ''], 200),
            '*/v1/sql/validate-select' => Http::sequence()
                ->push(['valid' => true, 'sql' => "{$sql} LIMIT 5", 'tables' => ['users', 'orders'], 'errors' => [], 'limit' => 5], 200)
                ->push(['valid' => true, 'sql' => "{$sql} LIMIT 50", 'tables' => ['users', 'orders'], 'errors' => [], 'limit' => 50], 200),
        ]);

        $res = app(DataAgentService::class)->ask($user, 'Aisa kaun sa user hai jisne sabse jyada order refund kare ho', $conn->id);

        $this->assertTrue($res['success']);
        $tied = \Illuminate\Support\Facades\DB::build(['driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317, 'database' => 'shopfx', 'username' => 'root', 'password' => 'fxroot'])
            ->select("SELECT u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'refunded' GROUP BY u.id, u.name HAVING COUNT(*) = (SELECT MAX(c) FROM (SELECT COUNT(*) c FROM orders WHERE status = 'refunded' GROUP BY user_id) m)");
        $this->assertStringStartsWith('It is a tie: ' . count($tied) . ' share the highest refunds (2 each)', $res['message']);
        $this->assertContains('2', $res['facts']);
        foreach ($tied as $t) {
            $this->assertStringContainsString($t->name, $res['message']);
        }
        $this->assertSame(50, Http::recorded(fn ($r) => str_contains($r->url(), 'validate-select'))->last()[0]->data()['force_limit']);
    }

    public function test_orbit_lookup_tool_returns_real_row_labels(): void
    {
        // Was calling a method that did not exist, so every lookup failed.
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $res = \App\Services\Agent\AgentToolRegistry::executeTool($user, 'lookup_table_values', ['connection_id' => $conn->id, 'table' => 'categories']);
        $this->assertTrue($res['success'], json_encode($res));
        $this->assertNotEmpty($res['values']);
        $this->assertArrayHasKey('label', $res['values'][0]);
    }

    public function test_orbit_retrieves_from_every_table_of_every_database_described_from_the_scans(): void
    {
        // Real failure: two databases both had a users table and Orbit used the first one. Every table of every
        // database is described for retrieval, so the model sees each database that has it.
        $user = User::factory()->create();
        $shop = $this->createMysqlConnection($user, 'Shop DB');
        $blog = $this->createMysqlConnection($user, 'Blog DB');
        foreach ([$shop, $blog] as $conn) {
            \App\Models\SchemaSnapshot::create(['user_id' => $user->id, 'connection_id' => $conn->id, 'version' => 1, 'schema_payload' => ['tables' => [
                ['name' => 'users', 'approx_rows' => 12, 'columns' => [
                    ['name' => 'id', 'type' => 'int', 'is_primary_key' => true, 'is_nullable' => false],
                    ['name' => 'email', 'type' => 'varchar(191)', 'is_unique' => true, 'is_nullable' => false],
                    ['name' => 'status', 'type' => 'enum', 'is_nullable' => true, 'enum_values' => ['active', 'banned']],
                ]],
                ['name' => 'orders', 'columns' => [['name' => 'user_id', 'type' => 'int']], 'relationships' => [['foreign_key' => 'user_id', 'referenced_table' => 'users']]],
            ]]]);
        }

        $docs = app(\App\Services\Agent\RuntimeContextBuilder::class)->schemaDocuments($user);

        $users = array_values(array_filter($docs, fn ($d) => $d['table'] === 'users'));
        $this->assertSame([$shop->id, $blog->id], array_column($users, 'connection_id'));
        $this->assertStringContainsString("Table users in \"Shop DB\" (connection_id {$shop->id}, database shopfx)", $users[0]['text']);
        $this->assertStringContainsString('email varchar(191) (unique, required)', $users[0]['text']);
        $this->assertStringContainsString('allowed values: status: active, banned', $users[0]['text']);
        $orders = array_values(array_filter($docs, fn ($d) => $d['table'] === 'orders'))[0];
        $this->assertStringContainsString('links: user_id → users', $orders['text']);
    }

    // ---------------------------------------------------------------------------------------------
    // Orbit's focused path for data questions (the real failure: the big agent prompt asked the user
    // "Please provide the ID of the user" instead of querying).
    // ---------------------------------------------------------------------------------------------

    protected function orbitSay(User $user, string $text): \App\Models\AgentConversation
    {
        $c = \App\Models\AgentConversation::create(['user_id' => $user->id, 'title' => 'Orbit']);
        $this->actingAs($user)->postJson("/api/agent/conversations/{$c->id}/messages", ['content' => $text])->assertStatus(202);

        return $c;
    }

    protected function fakeOrbitDataPath(array $route, ?array $answer = null): void
    {
        $sql = "SELECT u.id, u.name, COUNT(o.id) AS refunds FROM users u JOIN orders o ON o.user_id = u.id WHERE o.status = 'refunded' GROUP BY u.id, u.name ORDER BY refunds DESC, u.id";
        Http::fake([
            '*/v1/ai/agent/route' => Http::response($route, 200),
            '*/v1/ai/agent/answer' => Http::response($answer ?? ['success' => false, 'error_category' => 'MODEL_BUSY_OR_SLOW', 'error' => 'slow'], 200),
            '*/v1/ai/data/sql' => Http::response(['success' => true, 'sql' => $sql, 'assumptions' => ["refund = orders.status 'refunded'"], 'clarification' => ''], 200),
            '*/v1/sql/validate-select' => Http::response(['valid' => true, 'sql' => "{$sql} LIMIT 50", 'tables' => ['users', 'orders'], 'errors' => [], 'limit' => 50], 200),
            '*/v1/ai/agent/decide' => Http::response(['success' => true, 'decision' => ['kind' => 'ANSWER', 'speech_text' => 'From the full loop.'], 'rag' => ['attempted' => false]], 200),
            '*' => Http::response(['success' => true], 200),
        ]);
    }

    protected function urlsCalled(string $part): int
    {
        return Http::recorded(fn ($r) => str_contains($r->url(), $part))->count();
    }

    public function test_orbit_answers_a_hinglish_data_question_through_the_focused_path(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $tied = \Illuminate\Support\Facades\DB::build(['driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3317, 'database' => 'shopfx', 'username' => 'root', 'password' => 'fxroot'])
            ->select("SELECT u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'refunded' GROUP BY u.id, u.name HAVING COUNT(*) = 2");
        $this->fakeOrbitDataPath(
            ['success' => true, 'kind' => 'data_question', 'question' => 'Which user has the most refunded orders?', 'connection_id' => $conn->id],
            ['success' => true, 'speech_text' => 'Sabse zyada refunds ka tie hai: ' . implode(', ', array_column($tied, 'name')) . ', har ek ke 2 refunds.'],
        );

        $c = $this->orbitSay($user, 'Aisa kaun sa user hai jisne sabse jyada order refund kare ho');

        $task = \App\Models\AgentTask::where('conversation_id', $c->id)->first();
        $this->assertContains($task->status, ['SUCCEEDED', 'ANSWERED']);
        $this->assertStringStartsWith('Sabse zyada refunds', $task->last_decision['speech_text']);
        $this->assertSame(0, $this->urlsCalled('/v1/ai/agent/decide'), 'the long agent prompt is not needed');
        $call = \App\Models\AgentToolCall::where('task_id', $task->id)->where('tool', 'ask_database')->first();
        $this->assertSame('succeeded', $call->status);
        $this->assertSame('Which user has the most refunded orders?', $call->args_redacted['question']);
        $answerReq = Http::recorded(fn ($r) => str_contains($r->url(), '/v1/ai/agent/answer'))->first()[0]->data();
        $this->assertNotEmpty($answerReq['result']['rows'], 'the reply is written from the real rows');
        $this->assertSame(1, $task->timelineEvents()->where('step_name', 'UNDERSTOOD')->count());
    }

    public function test_if_the_reply_call_fails_the_verified_result_is_spoken(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeOrbitDataPath(['success' => true, 'kind' => 'data_question', 'question' => 'Which user has the most refunded orders?', 'connection_id' => $conn->id]);

        $c = $this->orbitSay($user, 'which user has the most order refunds');

        $speech = \App\Models\AgentTask::where('conversation_id', $c->id)->first()->last_decision['speech_text'];
        $this->assertStringContainsString('share the highest refunds (2 each)', $speech);
    }

    public function test_a_reply_that_leaves_out_a_verified_fact_is_retried_then_replaced_by_the_facts(): void
    {
        // Real qwen reply: "Rahul Verma ki bahut hi jyada order kiye ho" (the count was missing).
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $sql = 'SELECT u.id, u.name, COUNT(o.id) AS order_count FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.id, u.name ORDER BY order_count DESC, u.id';
        Http::fake([
            '*/v1/ai/agent/route' => Http::response(['success' => true, 'kind' => 'data_question', 'question' => 'Which customer placed the most orders?', 'connection_id' => $conn->id], 200),
            '*/v1/ai/agent/answer' => Http::response(['success' => true, 'speech_text' => 'Rahul Verma ki bahut hi jyada order kiye ho'], 200),
            '*/v1/ai/data/sql' => Http::response(['success' => true, 'sql' => $sql, 'assumptions' => [], 'clarification' => ''], 200),
            '*/v1/sql/validate-select' => Http::response(['valid' => true, 'sql' => "{$sql} LIMIT 50", 'tables' => ['users', 'orders'], 'errors' => [], 'limit' => 50], 200),
            '*' => Http::response(['success' => true], 200),
        ]);

        $c = $this->orbitSay($user, 'Aisa kaun sa customer hai jismein bahut hi jyada order kiye ho');

        $speech = \App\Models\AgentTask::where('conversation_id', $c->id)->first()->last_decision['speech_text'];
        $this->assertStringStartsWith('Rahul Verma has the highest order count: 8', $speech);
        $answers = Http::recorded(fn ($r) => str_contains($r->url(), '/v1/ai/agent/answer'))->values();
        $this->assertCount(2, $answers);
        $this->assertSame(['8'], $answers[1][0]->data()['missing']);
        $this->assertSame([], \App\Services\Agent\AgentOrchestrator::missingFacts('Rahul Verma ne 8 orders kiye', ['Rahul Verma', '8']));
        $this->assertSame(['8'], \App\Services\Agent\AgentOrchestrator::missingFacts('Rahul Verma joined in 2018', ['Rahul Verma', '8']));
        // Real reply: the answer followed by an echo of the question.
        $this->assertSame('Rahul Verma ki order count 8 hai.', \App\Services\Agent\AgentOrchestrator::stripEcho(
            'Rahul Verma ki order count 8 hai. Aisa kaun sa customer hai jismein bahut hi jyada order kiye ho.',
            'Aisa kaun sa customer hai jismein bahut hi jyada order kiye ho'));
    }

    public function test_anything_that_is_not_a_single_data_question_goes_to_the_full_loop(): void
    {
        $user = User::factory()->create();
        $this->createMysqlConnection($user);
        $this->fakeOrbitDataPath(['success' => true, 'kind' => 'other', 'question' => '']);

        $c = $this->orbitSay($user, 'mark all refunded orders of user 1 as cancelled');

        $this->assertSame(1, $this->urlsCalled('/v1/ai/agent/route'));
        $this->assertGreaterThanOrEqual(1, $this->urlsCalled('/v1/ai/agent/decide'));
        $this->assertSame(0, $this->urlsCalled('/v1/ai/data/sql'));
        $this->assertSame('From the full loop.', \App\Models\AgentTask::where('conversation_id', $c->id)->first()->last_decision['speech_text']);
    }

    public function test_a_route_answer_without_one_of_the_users_databases_goes_to_the_full_loop(): void
    {
        // Which database a data question is about must be one the retrieved tables are in; anything else (here no
        // database at all) is left to the full agent loop and no query runs.
        $user = User::factory()->create();
        $this->createMysqlConnection($user);
        $this->fakeOrbitDataPath(['success' => true, 'kind' => 'data_question', 'question' => 'How many users are there?']);

        $this->orbitSay($user, 'how many users are there');

        $route = Http::recorded(fn ($r) => str_contains($r->url(), '/v1/ai/agent/route'))->first()[0]->data();
        $this->assertArrayHasKey('schema_documents', $route);
        $this->assertNotSame('', trim((string) $route['instructions']), 'the administrators\' routing instructions are sent');
        $this->assertContains('/account', array_column($route['pages'], 'route'));
        $this->assertSame(0, $this->urlsCalled('/v1/ai/data/sql'));
        $this->assertGreaterThanOrEqual(1, $this->urlsCalled('/v1/ai/agent/decide'));
    }

    public function test_a_filter_the_question_never_asked_for_gets_one_rewrite(): void
    {
        // Real eval: "what is the average order total?" was written with status IN ('paid', 'shipped').
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $bad = "SELECT AVG(total) AS a FROM orders WHERE status IN ('paid', 'shipped')";
        $good = 'SELECT AVG(total) AS a FROM orders';
        Http::fake([
            '*/v1/ai/data/sql' => Http::sequence()
                ->push(['success' => true, 'sql' => $bad, 'assumptions' => [], 'clarification' => ''], 200)
                ->push(['success' => true, 'sql' => $good, 'assumptions' => [], 'clarification' => ''], 200),
            '*/v1/sql/validate-select' => Http::sequence()
                ->push(['valid' => true, 'sql' => "{$bad} LIMIT 200", 'tables' => ['orders'], 'errors' => [], 'unasked_filters' => ["`orders`.`status` IN ('paid', 'shipped')"], 'missing_order' => false], 200)
                ->push(['valid' => true, 'sql' => "{$good} LIMIT 200", 'tables' => ['orders'], 'errors' => [], 'unasked_filters' => [], 'missing_order' => false], 200),
        ]);

        $res = app(DataAgentService::class)->ask($user, 'what is the average order total?', $conn->id);

        $this->assertTrue($res['success']);
        $this->assertStringNotContainsString('WHERE', $res['diagnostics']['sql']);
        $this->assertStringContainsString('does not ask to filter on', $this->sqlRequests()[1]['previous'][0]['error']);
        $this->assertSame('what is the average order total?', Http::recorded(fn ($r) => str_contains($r->url(), 'validate-select'))->first()[0]->data()['question']);
    }

    public function test_if_the_model_insists_on_the_filter_the_answer_states_it_instead_of_failing(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $bad = "SELECT AVG(total) AS a FROM orders WHERE status IN ('paid', 'shipped')";
        Http::fake([
            '*/v1/ai/data/sql' => Http::response(['success' => true, 'sql' => $bad, 'assumptions' => [], 'clarification' => ''], 200),
            '*/v1/sql/validate-select' => Http::response(['valid' => true, 'sql' => "{$bad} LIMIT 200", 'tables' => ['orders'], 'errors' => [],
                'where' => "`orders`.`status` IN ('paid', 'shipped')", 'unasked_filters' => ["`orders`.`status` IN ('paid', 'shipped')"]], 200),
        ]);

        $res = app(DataAgentService::class)->ask($user, 'what is the average order total?', $conn->id);

        $this->assertTrue($res['success']);
        $this->assertSame(2, $res['diagnostics']['attempts']);
        $this->assertStringContainsString("Counted only rows where orders.status IN ('paid', 'shipped')", $res['message']);
    }

    public function test_plain_lists_are_not_described_as_rankings_and_filters_are_stated(): void
    {
        // Real eval: "list the orders placed by user 1" was described as "ORD-... has the highest total";
        // "average order total" silently filtered by status.
        $rows = [['order_no' => 'ORD-1', 'total' => '900'], ['order_no' => 'ORD-2', 'total' => '100']];
        $this->assertStringStartsWith('2 rows. First:', DataAgentService::describeResult($rows, 2, 50, [])[0]);
        $this->assertStringStartsWith('ORD-1 has the highest total', DataAgentService::describeResult($rows, 2, 50, ['total'])[0]);

        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $sql = "SELECT AVG(total) AS avg_total FROM orders WHERE status IN ('paid', 'shipped')";
        Http::fake([
            '*/v1/ai/data/sql' => Http::response(['success' => true, 'sql' => $sql, 'assumptions' => [], 'clarification' => ''], 200),
            '*/v1/sql/validate-select' => Http::response(['valid' => true, 'sql' => "{$sql} LIMIT 50", 'tables' => ['orders'], 'errors' => [],
                'limit' => 50, 'where' => "`orders`.`status` IN ('paid', 'shipped')", 'order_by' => []], 200),
        ]);
        $res = app(DataAgentService::class)->ask($user, 'what is the average order total?', $conn->id);
        $this->assertStringContainsString("(Counted only rows where orders.status IN ('paid', 'shipped').)", $res['message']);
    }

    public function test_tie_detection_uses_the_measure_column_not_ids(): void
    {
        $this->assertNull(DataAgentService::tieInfo([['id' => 1, 'name' => 'A', 'n' => 5], ['id' => 2, 'name' => 'B', 'n' => 3]]));
        $tie = DataAgentService::tieInfo([['id' => 1, 'name' => 'A', 'n' => '2'], ['id' => 2, 'name' => 'B', 'n' => 2], ['id' => 3, 'name' => 'C', 'n' => 1]]);
        $this->assertSame(['A', 'B'], $tie['names']);
        $this->assertSame('n', $tie['measure']);
        $this->assertFalse($tie['all_tied']);
    }

    public function test_rejected_query_is_repaired_with_the_exact_error(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(
            ['sql' => 'SELECT nme FROM users', 'reject' => "Column 'nme' could not be resolved"],
            ['sql' => 'SELECT name FROM users ORDER BY id'],
        );

        $res = app(DataAgentService::class)->ask($user, 'list user names', $conn->id);

        $this->assertTrue($res['success']);
        $this->assertSame(2, $res['diagnostics']['attempts']);
        $this->assertSame("Column 'nme' could not be resolved", $this->sqlRequests()[1]['previous'][0]['error']);
    }

    public function test_query_the_database_rejects_is_repaired_too(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(
            ['sql' => 'SELECT name FROM users GROUP BY region ORDER BY no_such_alias'],
            ['sql' => 'SELECT region, COUNT(*) AS n FROM users GROUP BY region'],
        );

        $res = app(DataAgentService::class)->ask($user, 'users per region', $conn->id);

        $this->assertTrue($res['success']);
        $this->assertStringStartsWith('The database rejected it', $this->sqlRequests()[1]['previous'][0]['error']);
    }

    public function test_after_three_rejections_it_fails_honestly_and_never_substitutes_another_query(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(...array_fill(0, 3, ['sql' => 'SELECT nope FROM users', 'reject' => "Column 'nope' could not be resolved"]));

        $res = app(DataAgentService::class)->ask($user, 'which customer has the most orders', $conn->id);

        $this->assertFalse($res['success']);
        $this->assertSame('QUERY_NOT_ANSWERED', $res['error_category']);
        $this->assertStringContainsString('Nothing was guessed', $res['message']);
        $this->assertArrayNotHasKey('rows', $res);
    }

    public function test_unavailable_model_is_reported_not_guessed(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        Http::fake(['*/v1/ai/data/sql' => Http::response(['success' => false, 'error_category' => 'MODEL_BUSY_OR_SLOW', 'error' => 'The local model did not answer in time.'], 200)]);

        $res = app(DataAgentService::class)->ask($user, 'how many orders were refunded?', $conn->id);

        $this->assertFalse($res['success']);
        $this->assertSame('MODEL_BUSY_OR_SLOW', $res['error_category']);
        $this->assertStringContainsString('did not answer in time', $res['message']);
    }

    public function test_question_the_tables_cannot_answer_returns_the_models_clarification(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(['sql' => '', 'clarification' => 'There is no shipping-carrier column; which table holds carriers?']);

        $res = app(DataAgentService::class)->ask($user, 'which carrier ships most?', $conn->id);

        $this->assertTrue($res['success']);
        $this->assertSame('clarification', $res['type']);
        $this->assertStringContainsString('carrier', $res['message']);
    }

    public function test_secret_columns_and_blocked_tables_never_reach_the_model_or_the_gate_schema(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(['sql' => 'SELECT name FROM users']);

        app(DataAgentService::class)->ask($user, 'list users and their api tokens', $conn->id);

        $slice = json_encode($this->sqlRequests()[0]['schema_slice']);
        $this->assertStringNotContainsString('password_hash', $slice);
        $this->assertStringNotContainsString('remember_token', $slice);
        $gate = Http::recorded(fn ($r) => str_contains($r->url(), 'validate-select'))->first()[0]->data();
        $schema = json_decode(json_encode($gate['schema']), true);
        $this->assertArrayNotHasKey('api_tokens', $schema);
        $this->assertNotContains('password_hash', $schema['users']);
    }

    public function test_dummy_data_detection_finds_seeded_dummies_without_false_positives(): void
    {
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $detector = app(DummyDataDetector::class);

        $report = $detector->detect($conn, 'users');

        $this->assertGreaterThan(0, $report['dummy_count']);
        $this->assertEquals('high', $report['confidence']);

        // Check that ground truth dummy IDs (57 to 66) are captured
        foreach ([57, 58, 59, 60, 61, 62] as $expectedId) {
            $this->assertContains($expectedId, $report['suspected_ids'], "Expected dummy ID {$expectedId} to be flagged.");
        }

        // Precision check: Adversarial look-alikes that are NOT dummy data must NOT be flagged
        // User 49 (John Dsouza), User 50 (Marco Testa), User 51 (contest.in)
        $this->assertNotContains(49, $report['suspected_ids'], 'John Dsouza must NOT be flagged as dummy data.');
        $this->assertNotContains(50, $report['suspected_ids'], 'Marco Testa must NOT be flagged as dummy data.');
        $this->assertNotContains(51, $report['suspected_ids'], 'contest.in email must NOT be flagged as dummy data.');
    }

    public function test_real_stored_values_are_offered_to_the_model_for_grounding(): void
    {
        // Users write "Rajasthan"; the table stores region codes. No hard-coded mapping: the model sees
        // the real distinct values of short categorical columns and maps the words itself.
        $user = User::factory()->create();
        $conn = $this->createMysqlConnection($user);
        $this->fakeModelSql(['sql' => "SELECT name FROM users WHERE region = 'RJ'", 'assumptions' => ["Rajasthan = region code 'RJ'"]]);

        $res = app(DataAgentService::class)->ask($user, 'Find users from Rajasthan', $conn->id);

        $this->assertTrue($res['success']);
        $regionValues = $this->sqlRequests()[0]['schema_slice']['tables']['users']['columns']['region']['values'] ?? [];
        $this->assertContains('RJ', $regionValues);
        $this->assertGreaterThan(0, $res['row_count']);
    }

    public function test_multi_connection_disambiguation(): void
    {
        $user = User::factory()->create();
        $conn1 = $this->createMysqlConnection($user, 'Shop Primary DB');
        $conn2 = $this->createMysqlConnection($user, 'Shop Replica DB');
        $agent = app(DataAgentService::class);

        // When ambiguous and no active connection: asks user
        $res = $agent->ask($user, 'how many users are there?');

        $this->assertTrue($res['needs_clarification'] ?? false);
        $this->assertEquals('disambiguation', $res['type']);
        $this->assertCount(2, $res['options']);

        // When explicitly specifying connection name in utterance: resolves automatically
        $this->fakeModelSql(['sql' => 'SELECT COUNT(*) AS users FROM users']);
        $resWithConn = $agent->ask($user, 'how many users are in Shop Primary DB?');
        $this->assertEquals('data_query', $resWithConn['type']);
        $this->assertEquals($conn1->id, $resWithConn['connection']['id']);
    }
}
