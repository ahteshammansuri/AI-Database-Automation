import json

import pytest
from fastapi.testclient import TestClient

from ai_service.app import usage
from ai_service.app.config import settings
from ai_service.app.main import app
from ai_service.app.providers.base import ProviderUnsupportedError
from ai_service.app.providers.factory import AIProviderFactory
from ai_service.app.providers.mock_provider import MockAIProvider

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_TOKEN}


@pytest.fixture(autouse=True)
def reset_mock():
    MockAIProvider.reset_script()
    yield
    MockAIProvider.reset_script()


def test_usage_of_every_model_call_is_returned_in_a_header(monkeypatch):
    """Providers record usage inside the endpoint's worker thread; the middleware still sees it."""
    original = MockAIProvider.chat_structured

    def counted(self, messages, json_schema, **kw):
        usage.record("ollama", "qwen2.5:3b", 120, 30)
        return original(self, messages, json_schema, **kw)

    monkeypatch.setattr(MockAIProvider, "chat_structured", counted)
    MockAIProvider.script(*[json.dumps(a) for a in (
        {"city": "Paris", "country": "France", "year_completed": 1889},
        {"tool": "pause_automation", "arguments": {"name": "Daily Tech News"}},
        {"table": "orders", "operation": "count", "filters": [{"column": "status", "value": "paid"}]},
        {"publish_time": "10:30", "frequency": "daily"},
    )])

    res = client.post("/v1/ai/readiness", json={"provider": "mock", "model": "m"}, headers=AUTH)

    assert res.status_code == 200
    calls = json.loads(res.headers[usage.HEADER])
    assert calls == [{"provider": "ollama", "model": "qwen2.5:3b", "kind": "chat", "calls": 4, "prompt_tokens": 480, "completion_tokens": 120}]


def test_no_usage_header_when_no_model_was_called():
    res = client.get("/v1/rag/product-guides/status", headers=AUTH)
    assert usage.HEADER not in res.headers


def test_readiness_checks_real_answers_and_reports_each_failure():
    MockAIProvider.script(*[json.dumps(a) for a in (
        {"city": "Paris", "country": "France", "year_completed": 1889},          # right
        {"tool": "answer", "arguments": {"text": "Done!"}},                       # wrong tool
        {"table": "orders", "operation": "count", "filters": [{"column": "status", "value": "paid"}]},  # right
        {"publish_time": "10:30", "frequency": "weekly"},                         # changed what it should keep
    )])

    body = client.post("/v1/ai/readiness", json={"provider": "mock", "model": "m"}, headers=AUTH).json()

    assert body["success"] is True and body["passed"] == 2 and body["total"] == 4 and body["score"] == 50
    by_key = {c["key"]: c for c in body["checks"]}
    assert by_key["json_conformance"]["passed"] and by_key["query_plan_accuracy"]["passed"]
    assert not by_key["tool_calling_safety"]["passed"] and "answer" in by_key["tool_calling_safety"]["details"]
    assert not by_key["slot_correction"]["passed"] and "frequency" in by_key["slot_correction"]["details"]
    # Every check reached the model at temperature 0 (nothing is assumed from the model's name).
    assert len(MockAIProvider.captured_requests) == 4


def test_invalid_json_fails_the_check_instead_of_crashing():
    MockAIProvider.script("not json at all", "{}", "{}", "{}")
    body = client.post("/v1/ai/readiness", json={"provider": "mock"}, headers=AUTH).json()
    assert body["passed"] == 0
    assert body["checks"][0]["details"] == "The answer was not valid JSON."


def test_placeholder_provider_is_refused_unless_tests_enable_it(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_MOCK_PROVIDER", False)
    with pytest.raises(ProviderUnsupportedError):
        AIProviderFactory.get_provider("mock")
    body = client.post("/v1/ai/readiness", json={"provider": "mock"}, headers=AUTH).json()
    assert body["success"] is False and "not available" in body["error"]
