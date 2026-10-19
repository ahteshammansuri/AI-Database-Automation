"""Read gate for model-written SELECT, and the SQL writer's contract (model scripted via the mock provider)."""
import json

import pytest
from fastapi.testclient import TestClient

from ai_service.app.config import settings
from ai_service.app.main import app
from ai_service.app.providers.mock_provider import MockAIProvider
from ai_service.app.services.data_sql_writer import describe_schema, write_select
from ai_service.app.services.sql_analyzer import validate_select

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_TOKEN}

# Readable schema as Laravel sends it: password_hash / remember_token are secret, so they are absent.
SCHEMA = {
    "users": ["id", "name", "email", "region", "status", "created_at"],
    "orders": ["id", "user_id", "order_no", "status", "total", "created_at"],
}


@pytest.fixture(autouse=True)
def _reset_mock():
    MockAIProvider.reset_script()
    yield
    MockAIProvider.reset_script()


def test_ranking_query_with_join_alias_and_tie_friendly_limit_is_accepted():
    sql = ("SELECT u.id, u.name, COUNT(o.id) AS refunds FROM users u JOIN orders o ON o.user_id = u.id "
           "WHERE o.status = 'refunded' GROUP BY u.id, u.name ORDER BY refunds DESC LIMIT 5")
    r = validate_select(sql, "mysql", SCHEMA, 200)
    assert r["valid"], r["errors"]
    assert r["sql"].endswith("LIMIT 5")
    assert sorted(r["tables"]) == ["orders", "users"]


def test_star_expands_to_readable_columns_only_and_limit_is_forced():
    r = validate_select("SELECT * FROM users", "mysql", SCHEMA, 200)
    assert r["valid"]
    assert "password_hash" not in r["sql"] and "`email`" in r["sql"]
    assert r["sql"].endswith("LIMIT 200")
    assert validate_select("SELECT name FROM users LIMIT 100000", "mysql", SCHEMA, 200)["sql"].endswith("LIMIT 200")


@pytest.mark.parametrize("sql, expected", [
    ("SELECT password_hash FROM users", "password_hash"),                 # secret column: not in the readable schema
    ("SELECT * FROM api_tokens", "not available"),                        # table not readable
    ("SELECT nme FROM users", "Columns you can use"),                      # typo: tells the model what exists
    ("SELECT SLEEP(5)", "SLEEP"),
    ("SELECT USER()", "not allowed"),
    ("SELECT name FROM users; DROP TABLE users", "Multi-statement"),
    ("DELETE FROM users", "Only SELECT"),
    ("SELECT name FROM users FOR UPDATE", "Locking"),
    ("SELECT name INTO OUTFILE '/tmp/x' FROM users", ""),
])
def test_unsafe_or_invalid_queries_are_refused_with_a_fixable_reason(sql, expected):
    r = validate_select(sql, "mysql", SCHEMA, 200)
    assert r["valid"] is False and r["sql"] is None
    assert expected in " ".join(r["errors"])


def test_case_mistake_in_table_name_gets_a_hint():
    r = validate_select("SELECT id FROM Users", "mysql", SCHEMA, 200)
    assert not r["valid"] and "Did you mean 'users'" in r["errors"][0]


def test_union_is_wrapped_so_the_limit_applies_to_the_whole_result():
    r = validate_select("SELECT name FROM users UNION SELECT order_no FROM orders", "mysql", SCHEMA, 50)
    assert r["valid"] and r["sql"].startswith("SELECT * FROM (") and r["sql"].endswith("LIMIT 50")


def test_gate_endpoint():
    res = client.post("/v1/sql/validate-select", json={"sql": "SELECT name FROM users", "schema": SCHEMA}, headers=AUTH)
    assert res.status_code == 200 and res.json()["valid"] is True


SLICE = {
    "tables": {
        "users": {"columns": {"id": {"type": "int", "is_primary": True}, "name": {"type": "varchar(100)"}}, "approx_row_count": 30},
        "orders": {"columns": {"id": {"type": "int", "is_primary": True}, "user_id": {"type": "int"},
                               "status": {"type": "enum('pending','refunded')", "values": ["pending", "refunded"]}}},
    },
    "foreign_keys": [{"table": "orders", "columns": ["user_id"], "ref_table": "users", "ref_columns": ["id"]}],
}


def test_schema_description_shows_types_keys_references_and_allowed_values():
    text = describe_schema(SLICE)
    assert "orders(id int [PK], user_id int [-> users.id]" in text
    assert "values: 'pending', 'refunded'" in text


def test_writer_returns_the_models_sql_and_sends_rejections_back_for_repair():
    MockAIProvider.script(json.dumps({"sql": "SELECT u.name, COUNT(*) AS n FROM orders o JOIN users u ON u.id=o.user_id GROUP BY u.name ORDER BY n DESC LIMIT 5;",
                                      "assumptions": ["customers are users"], "clarification": ""}))
    out = write_select("Aisa kaun sa customer hai jisne sabse jyada order kiye", SLICE, provider="mock",
                       previous=[{"sql": "SELECT nme FROM users", "error": "Column 'nme' could not be resolved"}])
    assert out["success"] and out["sql"].endswith("LIMIT 5") and not out["sql"].endswith(";")
    msgs = MockAIProvider.captured_requests[-1]["messages"]
    assert "Hindi, Hinglish" in msgs[0]["content"]
    assert "Aisa kaun sa customer" in msgs[1]["content"]
    assert "could not be resolved" in msgs[-1]["content"]


def test_writer_can_say_the_tables_do_not_answer_the_question():
    MockAIProvider.script(json.dumps({"sql": "", "assumptions": [], "clarification": "There is no refunds table; should I use orders.status?"}))
    out = write_select("refunds by city", SLICE, provider="mock")
    assert out["success"] and out["sql"] == "" and "refunds" in out["clarification"]


def test_writer_reports_an_unavailable_model_honestly():
    out = write_select("anything", SLICE, provider="mock")  # nothing scripted: the double refuses
    assert out["success"] is False and out["error_category"]


FKS = [{"table": "orders", "columns": ["user_id"], "ref_table": "users", "ref_columns": ["id"]},
       {"table": "order_items", "columns": ["order_id"], "ref_table": "orders", "ref_columns": ["id"]}]
SCHEMA_ITEMS = {**SCHEMA, "order_items": ["id", "order_id", "qty"]}
PKS = {t: ["id"] for t in SCHEMA_ITEMS}


def test_fan_out_count_of_parent_rows_is_counted_distinct():
    # Real qwen2.5:3b output for "user with the most refunds": an unneeded join to order_items tripled the counts.
    sql = ("SELECT u.id, u.name, COUNT(o.id) AS order_count FROM users u JOIN orders o ON u.id = o.user_id "
           "JOIN order_items oi ON oi.order_id = o.id WHERE o.status = 'refunded' GROUP BY u.id, u.name ORDER BY order_count DESC LIMIT 5")
    r = validate_select(sql, "mysql", SCHEMA_ITEMS, 200, FKS, PKS)
    assert r["valid"] and "COUNT(DISTINCT `o`.`id`)" in r["sql"]
    assert "order_items" in r["notes"][0]
    users_with_orders = validate_select("SELECT COUNT(u.id) FROM users u JOIN orders o ON o.user_id = u.id", "mysql", SCHEMA_ITEMS, 200, FKS, PKS)
    assert "COUNT(DISTINCT `u`.`id`)" in users_with_orders["sql"]


def test_fan_out_sum_is_refused_with_a_fixable_reason_but_child_sums_are_fine():
    bad = validate_select("SELECT u.id, SUM(o.total) FROM users u JOIN orders o ON u.id = o.user_id "
                          "JOIN order_items oi ON oi.order_id = o.id GROUP BY u.id", "mysql", SCHEMA_ITEMS, 200, FKS, PKS)
    assert not bad["valid"] and "would be inflated" in bad["errors"][0] and "order_items" in bad["errors"][0]
    ok = validate_select("SELECT o.id, SUM(oi.qty) FROM orders o JOIN order_items oi ON oi.order_id = o.id GROUP BY o.id",
                         "mysql", SCHEMA_ITEMS, 200, FKS, PKS)
    assert ok["valid"] and "COUNT(DISTINCT" not in ok["sql"]
    plain = validate_select("SELECT u.id, COUNT(o.id) FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.id",
                            "mysql", SCHEMA_ITEMS, 200, FKS, PKS)
    assert plain["valid"] and "DISTINCT" not in plain["sql"]


def test_force_limit_widens_a_top_n_but_never_beyond_the_maximum():
    sql = "SELECT name FROM users ORDER BY id LIMIT 5"
    assert validate_select(sql, "mysql", SCHEMA, 200, force_limit=50)["sql"].endswith("LIMIT 50")
    assert validate_select(sql, "mysql", SCHEMA, 20, force_limit=50)["sql"].endswith("LIMIT 20")


def test_a_list_that_joins_an_unused_child_table_is_refused_because_it_repeats_rows():
    # Real qwen output for "products out of stock": LEFT JOIN order_items (unused) repeated every product.
    schema = {"products": ["id", "name", "stock"], "order_items": ["id", "order_id", "product_id", "qty"]}
    fks = [{"table": "order_items", "columns": ["product_id"], "ref_table": "products", "ref_columns": ["id"]}]
    bad = validate_select("SELECT p.id, p.name FROM products p LEFT JOIN order_items oi ON p.id = oi.product_id WHERE p.stock = 0",
                          "mysql", schema, 50, fks, {})
    assert not bad["valid"] and "repeats each products row" in bad["errors"][0]
    assert validate_select("SELECT p.name, oi.qty FROM products p JOIN order_items oi ON p.id = oi.product_id", "mysql", schema, 50, fks, {})["valid"]


def test_gate_reports_the_real_filter_and_sort_for_transparent_answers():
    r = validate_select("SELECT AVG(total) FROM orders WHERE status IN ('paid')", "mysql", SCHEMA, 50)
    assert r["where"] == "`orders`.`status` IN ('paid')" and r["order_by"] == []



@pytest.mark.parametrize("question, sql, unasked, missing_order", [
    ("what is the average order total?", "SELECT AVG(total) FROM orders WHERE status IN ('paid', 'shipped')", 1, False),
    ("what is the highest product price?", "SELECT MAX(id) FROM users WHERE status = 'active'", 1, False),
    ("Rajasthan ke kitne users hain?", "SELECT COUNT(id) FROM users WHERE region = 'RJ'", 0, False),
    ("Aisa kaun sa user hai jisne sabse jyada order refund kare ho",
     "SELECT user_id, COUNT(*) n FROM orders WHERE status = 'refunded' GROUP BY user_id ORDER BY n DESC", 0, False),
    ("list the orders placed by user 1", "SELECT id FROM orders WHERE user_id = 1", 0, False),
    ("which orders total more than 50000?", "SELECT id FROM orders WHERE total > 50000", 0, False),
    ("how many orders today?", "SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURDATE()", 0, False),
    ("top 3 users", "SELECT id, name FROM users LIMIT 3", 0, True),
    ("what is the highest order total?", "SELECT MAX(total) FROM orders", 0, False),
])
def test_filters_and_rankings_are_checked_against_the_questions_own_words(question, sql, unasked, missing_order):
    r = validate_select(sql, "mysql", SCHEMA, 200, question=question)
    assert r["valid"]
    assert len(r["unasked_filters"]) == unasked, r["unasked_filters"]
    assert r["missing_order"] is missing_order



def test_ranking_entities_by_raw_child_rows_is_flagged():
    # Real qwen output for "top 3 products by quantity sold": order lines sorted by qty, no GROUP BY.
    schema = {"products": ["id", "name"], "order_items": ["id", "order_id", "product_id", "qty"]}
    fks = [{"table": "order_items", "columns": ["product_id"], "ref_table": "products", "ref_columns": ["id"]}]
    bad = validate_select("SELECT p.name, oi.qty FROM products p JOIN order_items oi ON p.id = oi.product_id ORDER BY oi.qty DESC LIMIT 3",
                          "mysql", schema, 50, fks, {}, question="top 3 products by quantity sold")
    assert bad["ranks_child_rows"] == {"entity": "products", "child": "order_items", "column": "qty"}
    good = validate_select("SELECT p.name, SUM(oi.qty) AS sold FROM products p JOIN order_items oi ON p.id = oi.product_id "
                           "GROUP BY p.id, p.name ORDER BY sold DESC LIMIT 3", "mysql", schema, 50, fks, {}, question="top 3 products by quantity sold")
    assert good["ranks_child_rows"] is None
