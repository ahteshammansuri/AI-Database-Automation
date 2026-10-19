"""Orbit's focused data-question calls: routing and reply writing (model scripted via the mock provider)."""
import json

import pytest

from ai_service.app.providers.mock_provider import MockAIProvider
from ai_service.app.services.agent_fastpath import answer, route

HINT = {"connection": "Shop fixture", "tables": ["orders", "users"], "values": ["orders.status = 'refunded'"]}


@pytest.fixture(autouse=True)
def _reset():
    MockAIProvider.reset_script()
    yield
    MockAIProvider.reset_script()


def test_route_restates_a_hinglish_data_question_in_english_and_sees_the_schema_hint():
    MockAIProvider.script(json.dumps({"kind": "data_question", "question": "Which user has the most refunded orders?"}))
    out = route("Aisa kaun sa user hai jisne sabse jyada order refund kare ho", HINT, provider="mock")
    assert out == {"success": True, "kind": "data_question", "question": "Which user has the most refunded orders?", "page": ""}
    sent = MockAIProvider.captured_requests[-1]["messages"]
    assert "orders, users" in sent[0]["content"] and "'refunded'" in sent[0]["content"]
    assert "Aisa kaun sa user" in sent[1]["content"]


@pytest.mark.parametrize("raw", [
    {"kind": "data_question", "question": ""},     # no restated question: not usable
    {"kind": "maybe", "question": "x"},            # unknown kind
    {"kind": "other", "question": ""},
])
def test_route_falls_back_to_other_unless_the_model_is_clear(raw):
    MockAIProvider.script(json.dumps(raw))
    assert route("remove refunded orders", HINT, provider="mock")["kind"] == "other"


def test_route_reports_an_unavailable_model():
    assert route("x", HINT, provider="mock")["success"] is False  # nothing scripted


def test_answer_is_written_from_the_rows_and_reports_empty_replies():
    MockAIProvider.script(json.dumps({"speech_text": "Tie hai: Aarav Sharma aur Vihaan Verma."}))
    out = answer("kaun sa user", {"success": True, "rows": [{"name": "Aarav Sharma", "refunds": 2}] * 20}, provider="mock")
    assert out == {"success": True, "speech_text": "Tie hai: Aarav Sharma aur Vihaan Verma."}
    sent = MockAIProvider.captured_requests[-1]["messages"][1]["content"]
    assert sent.count("Aarav Sharma") == 10, "only the first 10 rows are sent"
    MockAIProvider.script(json.dumps({"speech_text": "  "}))
    assert answer("x", {"success": True}, provider="mock")["success"] is False


PAGES = [{"route": "/security", "title": "Security & Guardrails"}, {"route": "/audit-logs", "title": "Audit Logs"}]


def test_route_can_open_a_catalog_page_but_never_an_unknown_one():
    MockAIProvider.script(json.dumps({"kind": "open_page", "question": "", "page": "/security"}))
    assert route("Please open the security page", {}, provider="mock", pages=PAGES) == {
        "success": True, "kind": "open_page", "question": "", "page": "/security"}
    assert "/audit-logs (Audit Logs)" in MockAIProvider.captured_requests[-1]["messages"][0]["content"]
    MockAIProvider.script(json.dumps({"kind": "open_page", "question": "", "page": "/admin"}))
    assert route("open admin", {}, provider="mock", pages=PAGES)["kind"] == "other"
