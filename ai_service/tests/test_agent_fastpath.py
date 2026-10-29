"""Orbit's focused calls: routing (with retrieved tables and pages) and reply writing (model scripted via the mock provider)."""
import json

import pytest

from ai_service.app.providers.mock_provider import MockAIProvider
from ai_service.app.schemas.agent import SchemaDocument
from ai_service.app.services.agent_fastpath import answer, route

SHOP = [
    SchemaDocument(connection_id=3, connection="Shop fixture", database="shop", table="orders",
                   text='Table orders in "Shop fixture" (connection_id 3, database shop): columns: id int (primary key), '
                        'user_id int, status enum; allowed values: status: paid, refunded.'),
    SchemaDocument(connection_id=3, connection="Shop fixture", database="shop", table="users",
                   text='Table users in "Shop fixture" (connection_id 3, database shop): columns: id int (primary key), name varchar, email varchar.'),
]
ROUTE = "Decide what the message asks for (administrators' routing instructions)."
REPLY = "Write the reply from the verified result (administrators' reply instructions)."


@pytest.fixture(autouse=True)
def _reset(words):
    MockAIProvider.reset_script()
    yield
    MockAIProvider.reset_script()


def test_route_restates_a_hinglish_data_question_in_english_and_sees_the_retrieved_schema():
    MockAIProvider.script(json.dumps({"kind": "data_question", "question": "Which user has the most refunded orders?", "page": "", "connection_id": 3}))
    out = route("Aisa kaun sa user hai jisne sabse jyada order refund kare ho", provider="mock", schema_documents=SHOP, instructions=ROUTE)
    assert out == {"success": True, "kind": "data_question", "question": "Which user has the most refunded orders?", "page": "", "connection_id": 3}
    sent = MockAIProvider.captured_requests[-1]["messages"]
    assert sent[0]["content"].startswith(ROUTE)
    assert "connection_id 3" in sent[0]["content"] and "refunded" in sent[0]["content"]
    assert "Aisa kaun sa user" in sent[1]["content"]


@pytest.mark.parametrize("raw", [
    {"kind": "data_question", "question": "", "page": "", "connection_id": 3},  # no restated question: not usable
    {"kind": "maybe", "question": "x", "page": ""},                            # unknown kind
    {"kind": "other", "question": "", "page": ""},
])
def test_route_falls_back_to_other_unless_the_model_is_clear(raw):
    MockAIProvider.script(json.dumps(raw))
    assert route("remove refunded orders", provider="mock", schema_documents=SHOP, instructions=ROUTE)["kind"] == "other"


def test_route_reports_an_unavailable_model():
    # The message matches the user's tables, so the model is asked; nothing is scripted.
    assert route("how many orders were refunded", provider="mock", schema_documents=SHOP, instructions=ROUTE)["success"] is False


def test_answer_is_written_from_the_rows_and_reports_empty_replies():
    MockAIProvider.script(json.dumps({"speech_text": "Tie hai: Aarav Sharma aur Vihaan Verma."}))
    out = answer("kaun sa user", {"success": True, "rows": [{"name": "Aarav Sharma", "refunds": 2}] * 20}, provider="mock", instructions=REPLY)
    assert out == {"success": True, "speech_text": "Tie hai: Aarav Sharma aur Vihaan Verma."}
    sent = MockAIProvider.captured_requests[-1]["messages"]
    assert sent[0]["content"].startswith(REPLY)
    assert sent[1]["content"].count("Aarav Sharma") == 10, "only the first 10 rows are sent"
    MockAIProvider.script(json.dumps({"speech_text": "  "}))
    assert answer("x", {"success": True}, provider="mock", instructions=REPLY)["success"] is False


PAGES = [
    {"route": "/security", "title": "Security & Guardrails", "description": "What the platform enforces and never allows"},
    {"route": "/audit-logs", "title": "Audit Logs", "description": "Every action recorded in the workspace"},
]


def test_route_can_open_a_catalog_page_but_never_an_unknown_one():
    MockAIProvider.script(json.dumps({"kind": "open_page", "question": "", "page": "/security"}))
    assert route("Please open the security page", provider="mock", pages=PAGES, instructions=ROUTE) == {
        "success": True, "kind": "open_page", "question": "", "page": "/security", "connection_id": None}
    assert "/security (Security & Guardrails)" in MockAIProvider.captured_requests[-1]["messages"][0]["content"]
    MockAIProvider.script(json.dumps({"kind": "open_page", "question": "", "page": "/admin"}))
    assert route("open the security page", provider="mock", pages=PAGES, instructions=ROUTE)["kind"] == "other"
