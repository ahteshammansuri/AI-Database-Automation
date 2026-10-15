"""
Tests for Orbit's decision protocol (/v1/ai/agent/decide).

The mock provider is a scripted test double: these tests control the exact model
output, which proves the service adds no keyword routing of its own. The Ollama
tests capture the real request payload at the HTTP boundary.
"""
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ai_service.app.config import settings
from ai_service.app.main import app
from ai_service.app.providers.mock_provider import MockAIProvider
from ai_service.app.providers.ollama_provider import OllamaProvider
from ai_service.app.rag.service import rag_service
from ai_service.app.schemas.agent import AgentDecision, DecideRequest
from ai_service.app.services.agent_decider import AgentDecider

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_TOKEN}

TOOLS = [
    {
        "name": "list_database_connections",
        "description": "List the user's saved connection profiles with status.",
        "parameters": {"type": "object", "properties": {}},
        "side_effect_class": "read",
    },
    {
        "name": "test_database_connection",
        "description": "Test a saved connection (connection_id) or ad-hoc parameters.",
        "parameters": {"type": "object", "properties": {"connection_id": {"type": "integer"}}},
        "side_effect_class": "read",
    },
]


def decide_payload(utterance: str, **extra):
    body = {"user_id": 7, "utterance": utterance, "tool_schemas": TOOLS, "provider": "mock", "use_rag": False}
    body.update(extra)
    return body


@pytest.fixture(autouse=True)
def reset_mock():
    MockAIProvider.reset_script()
    yield
    MockAIProvider.reset_script()


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

def test_decision_rejects_unknown_kind_and_extra_fields():
    with pytest.raises(ValidationError):
        AgentDecision.model_validate({"kind": "DO_ANYTHING", "speech_text": "x"})
    with pytest.raises(ValidationError):
        AgentDecision.model_validate({"kind": "ANSWER", "speech_text": "hi", "sql": "DROP TABLE x"})


def test_decision_requires_tool_call_for_call_tool_and_speech_for_terminal():
    with pytest.raises(ValidationError):
        AgentDecision.model_validate({"kind": "CALL_TOOL", "speech_text": ""})
    with pytest.raises(ValidationError):
        AgentDecision.model_validate({"kind": "COMPLETE", "speech_text": "  "})
    ok = AgentDecision.model_validate(
        {"kind": "CALL_TOOL", "speech_text": "", "tool_call": {"name": "list_database_connections", "args": {}}}
    )
    assert ok.tool_call.name == "list_database_connections"


def test_decision_rejects_secret_args_and_slots():
    with pytest.raises(ValidationError):
        AgentDecision.model_validate(
            {"kind": "CALL_TOOL", "tool_call": {"name": "test_database_connection", "args": {"password": "x"}}}
        )
    with pytest.raises(ValidationError):
        AgentDecision.model_validate({"kind": "ANSWER", "speech_text": "ok", "slot_updates": {"api_key": "sk"}})


# ---------------------------------------------------------------------------
# Endpoint behaviour with a scripted model
# ---------------------------------------------------------------------------

def test_decide_returns_model_decision_and_sends_utterance():
    MockAIProvider.script(json.dumps({"kind": "ANSWER", "speech_text": "Hi! I'm Orbit.", "emotion_hint": "happy"}))
    res = client.post("/v1/ai/agent/decide", json=decide_payload("hey there, who are you?"), headers=AUTH)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["decision"]["kind"] == "ANSWER"
    assert data["decision"]["speech_text"] == "Hi! I'm Orbit."
    sent = MockAIProvider.captured_requests[0]["messages"]
    assert "hey there, who are you?" in sent[-1]["content"]


def test_no_keyword_routing_same_word_different_decisions():
    """Two utterances containing 'connect' get exactly what the model decides; nothing pre-routes them."""
    MockAIProvider.script(
        json.dumps({"kind": "CALL_TOOL", "tool_call": {"name": "list_database_connections", "args": {}}}),
        json.dumps({"kind": "ANSWER", "speech_text": "Connecting means linking your own MySQL database."}),
    )
    a = client.post("/v1/ai/agent/decide", json=decide_payload("check my database connection status"), headers=AUTH).json()
    b = client.post("/v1/ai/agent/decide", json=decide_payload("what does connect mean here?"), headers=AUTH).json()
    assert a["decision"]["kind"] == "CALL_TOOL"
    assert a["decision"]["tool_call"]["name"] == "list_database_connections"
    assert b["decision"]["kind"] == "ANSWER"


def test_destructive_request_still_goes_to_model():
    MockAIProvider.script(json.dumps({"kind": "UNSUPPORTED", "speech_text": "I can't drop tables; that's blocked."}))
    data = client.post("/v1/ai/agent/decide", json=decide_payload("drop the users table"), headers=AUTH).json()
    assert data["decision"]["kind"] == "UNSUPPORTED"
    assert len(MockAIProvider.captured_requests) == 1


def test_observations_reach_the_model():
    MockAIProvider.script(json.dumps({"kind": "COMPLETE", "speech_text": "Blog DB is connected.", "emotion_hint": "celebrating"}))
    payload = decide_payload(
        "check my connection status",
        observations=[{"iteration": 0, "tool": "test_database_connection", "args": {"connection_id": 3},
                       "result": {"success": True, "safe_message": "Connected to Blog DB in 12ms"}}],
    )
    data = client.post("/v1/ai/agent/decide", json=payload, headers=AUTH).json()
    assert data["decision"]["kind"] == "COMPLETE"
    assert "Connected to Blog DB in 12ms" in MockAIProvider.captured_requests[0]["messages"][-1]["content"]


def test_unknown_tool_triggers_bounded_repair_then_success():
    MockAIProvider.script(
        json.dumps({"kind": "CALL_TOOL", "tool_call": {"name": "run_raw_sql", "args": {}}}),
        json.dumps({"kind": "CALL_TOOL", "tool_call": {"name": "list_database_connections", "args": {}}}),
    )
    data = client.post("/v1/ai/agent/decide", json=decide_payload("show connections"), headers=AUTH).json()
    assert data["success"] is True
    assert data["repairs"] == 1
    repair_msg = MockAIProvider.captured_requests[1]["messages"][-1]["content"]
    assert "not an available tool" in repair_msg


def test_repair_is_bounded_and_reports_invalid_output():
    MockAIProvider.script("not json", "{\"kind\": \"NOPE\"}", "still not json")
    data = client.post("/v1/ai/agent/decide", json=decide_payload("hello", max_repairs=2), headers=AUTH).json()
    assert data["success"] is False
    assert data["error_category"] == "MODEL_OUTPUT_INVALID"
    assert data["repairs"] == 2
    assert len(MockAIProvider.captured_requests) == 3
    assert data["decision"] is None


def test_model_unavailable_is_surfaced_not_faked():
    data = client.post("/v1/ai/agent/decide", json=decide_payload("hello"), headers=AUTH).json()
    assert data["success"] is False
    assert data["error_category"] == "MODEL_UNAVAILABLE"
    assert data["decision"] is None


def test_unknown_provider_is_rejected():
    data = client.post("/v1/ai/agent/decide", json=decide_payload("hello", provider="made-up"), headers=AUTH).json()
    assert data["success"] is False
    assert data["error_category"] == "PROVIDER_UNSUPPORTED"


# ---------------------------------------------------------------------------
# Provider-request boundary (Ollama) — RAG must actually reach the model
# ---------------------------------------------------------------------------

class CapturingOllama(OllamaProvider):
    payloads = []
    installed = ["qwen2.5:3b"]
    reply = json.dumps({"kind": "ANSWER", "speech_text": "DataAuto connects your own databases."})

    def _installed_models(self, timeout: float = 5.0):
        return list(self.installed)

    def _stream_chat(self, payload, ttft, idle, deadline):
        type(self).payloads.append(payload)
        return {"content": type(self).reply, "done_reason": "stop"}


@pytest.fixture
def capturing_ollama(monkeypatch):
    CapturingOllama.payloads = []
    CapturingOllama.installed = ["qwen2.5:3b"]
    monkeypatch.setattr(
        "ai_service.app.providers.factory.OllamaProvider",
        lambda model=None, **kw: CapturingOllama(base_url="http://ollama.test", model=model),
    )
    return CapturingOllama


def test_retrieved_chunks_are_included_in_ollama_request(capturing_ollama, monkeypatch):
    marker = "UNIQUE-MARKER: connections are tested before they are saved."
    monkeypatch.setattr(rag_service, "retrieve_for_agent", lambda user_id, query_text: {
        "chunks": [{"source_id": "product:doc_1_chk_0", "scope": "product", "text": marker, "score": 0.8, "heading": "Connections"}],
        "index_version": "abc123", "embedding_backend": "ollama:nomic-embed-text",
    })
    req = DecideRequest(user_id=7, utterance="how does connecting work?", tool_schemas=TOOLS, provider="ollama", model="qwen2.5:3b")
    res = AgentDecider.decide(req)

    assert res.success is True
    assert res.rag.used is True and res.rag.source_ids == ["product:doc_1_chk_0"]
    payload = capturing_ollama.payloads[0]
    user_msg = payload["messages"][-1]["content"]
    assert marker in user_msg
    assert "how does connecting work?" in user_msg
    assert payload["model"] == "qwen2.5:3b"
    assert payload["format"]["properties"]["tool_call"]["properties"]["name"]["enum"] == [t["name"] for t in TOOLS]


def test_rag_used_false_when_nothing_retrieved(capturing_ollama, monkeypatch):
    monkeypatch.setattr(rag_service, "retrieve_for_agent", lambda user_id, query_text: {
        "chunks": [], "index_version": "abc123", "embedding_backend": "lexical-fallback",
    })
    res = AgentDecider.decide(DecideRequest(user_id=7, utterance="hi", tool_schemas=TOOLS, provider="ollama", model="qwen2.5:3b"))
    assert res.rag.attempted is True
    assert res.rag.used is False
    assert "RETRIEVED CONTEXT" not in capturing_ollama.payloads[0]["messages"][-1]["content"]


def test_missing_ollama_model_is_not_silently_switched(capturing_ollama):
    capturing_ollama.installed = ["llama3.2:1b"]
    res = AgentDecider.decide(DecideRequest(user_id=7, utterance="hi", tool_schemas=TOOLS, provider="ollama",
                                            model="qwen2.5:3b", use_rag=False))
    assert res.success is False
    assert res.error_category == "MODEL_UNAVAILABLE"
    assert "qwen2.5:3b" in res.error_message
    assert capturing_ollama.payloads == []


# ---------------------------------------------------------------------------
# Tenant-scoped retrieval
# ---------------------------------------------------------------------------

def test_agent_retrieval_never_reads_other_users_knowledge(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path))
    rag_service.index_document_text(9001, 1, "Alpha owner notes: the zebra migration runs nightly.")
    rag_service.index_document_text(9002, 2, "Beta private notes: the zebra migration password rotation.")
    result = rag_service.retrieve_for_agent(9001, "zebra migration notes")
    scopes = {c["source_id"].split(":")[0] + ":" + c["source_id"].split(":")[1] for c in result["chunks"] if c["scope"] == "user_kb"}
    assert scopes == {"kb:1"}
    assert all("Beta" not in c["text"] for c in result["chunks"])


def test_php_empty_arrays_are_accepted_as_objects():
    """Laravel serialises empty associative arrays as [] (live acceptance found a 422 here)."""
    MockAIProvider.script(json.dumps({"kind": "ANSWER", "speech_text": "You have no saved connections yet."}))
    payload = decide_payload("check my connections", slots=[], runtime_context=[],
                             observations=[{"iteration": 0, "tool": "list_database_connections", "args": [], "result": []}])
    res = client.post("/v1/ai/agent/decide", json=payload, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["success"] is True


# ---------------------------------------------------------------------------
# Reliability: streaming watchdog, deadline, model lock, tool selection
# ---------------------------------------------------------------------------

import time as _time

import httpx

from ai_service.app.providers.base import ProviderTimeoutError
from ai_service.app.services import agent_decider as decider_mod


class _SlowStream(httpx.SyncByteStream):
    def __init__(self, delay_before_first):
        self.delay = delay_before_first

    def __iter__(self):
        _time.sleep(self.delay)
        yield b'{"message":{"content":"{\\"kind\\":\\"ANSWER\\",\\"speech_text\\":\\"hi\\"}"},"done":false}\n'
        yield b'{"message":{"content":""},"done":true,"done_reason":"stop"}\n'


def _patch_transport(monkeypatch, stream):
    real_client = httpx.Client

    def factory(*a, **kw):
        kw["transport"] = httpx.MockTransport(lambda request: httpx.Response(200, stream=stream))
        return real_client(*a, **kw)

    monkeypatch.setattr("ai_service.app.providers.ollama_provider.httpx.Client", factory)


def test_stream_returns_content_when_model_answers(monkeypatch):
    _patch_transport(monkeypatch, _SlowStream(0))
    p = OllamaProvider(base_url="http://ollama.test", model="qwen2.5:3b")
    out = p._stream_chat({"model": "x"}, ttft=5, idle=5, deadline=_time.monotonic() + 30)
    assert '"kind":"ANSWER"' in out["content"].replace(" ", "")


def test_stream_watchdog_cancels_slow_first_token(monkeypatch):
    _patch_transport(monkeypatch, _SlowStream(2.0))
    p = OllamaProvider(base_url="http://ollama.test", model="qwen2.5:3b")
    with pytest.raises(ProviderTimeoutError) as e:
        p._stream_chat({"model": "x"}, ttft=0.6, idle=5, deadline=_time.monotonic() + 30)
    assert e.value.category == "MODEL_BUSY_OR_SLOW"


def test_deadline_skips_repair_instead_of_overrunning():
    MockAIProvider.script("not json", json.dumps({"kind": "ANSWER", "speech_text": "late"}))
    data = client.post("/v1/ai/agent/decide", json=decide_payload("hi", deadline_seconds=30), headers=AUTH).json()
    assert data["error_category"] == "MODEL_OUTPUT_INVALID"
    assert data["repairs"] == 0
    assert len(MockAIProvider.captured_requests) == 1


def test_busy_model_lock_reports_busy_not_crash():
    decider_mod._MODEL_LOCK.acquire()
    try:
        data = client.post("/v1/ai/agent/decide", json=decide_payload("hi", deadline_seconds=10), headers=AUTH).json()
    finally:
        decider_mod._MODEL_LOCK.release()
    assert data["success"] is False
    assert data["error_category"] == "MODEL_BUSY_OR_SLOW"


def test_tool_selection_keeps_core_tools_and_caps_count(monkeypatch):
    many = [{"name": f"extra_tool_{i}", "description": f"does thing {i}", "parameters": {"type": "object", "properties": {}}}
            for i in range(40)]
    core = [{"name": n, "description": n, "parameters": {"type": "object", "properties": {}}} for n in decider_mod.CORE_TOOLS]
    req = DecideRequest(user_id=7, utterance="do thing 3", tool_schemas=core + many, provider="mock", use_rag=False)
    offered = decider_mod.select_tools(req)
    assert all(n in offered for n in decider_mod.CORE_TOOLS)
    assert len(offered) <= decider_mod.settings.AGENT_MAX_TOOLS
    msgs, _ = AgentDecider.build_messages(req, decider_mod.RagInfo(), offered)
    assert "OTHER TOOLS" in msgs[0]["content"] and "extra_tool_39" in msgs[0]["content"]
