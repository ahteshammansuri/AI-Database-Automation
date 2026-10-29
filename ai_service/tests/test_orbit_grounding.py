"""
Orbit decides from what each request brings (retrieved knowledge, the schema of the user's databases, the live
context and the administrators' instructions), not from instructions or word lists written in the code.

A deterministic word-based embedder stands in for the embedding model, so these tests do not depend on Ollama.
"""
import json
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ai_service.app.config import settings
from ai_service.app.main import app
from ai_service.app.rag.service import rag_service
from ai_service.app.rag.vector_cache import VectorCache
from ai_service.app.schemas.agent import KIND_MEANINGS, DecideRequest, RetrievedChunk, SchemaDocument
from ai_service.app.services import agent_decider as decider_mod
from ai_service.app.services import agent_fastpath
from ai_service.app.services.agent_decider import AgentDecider, protocol_text

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_TOKEN}


def doc(cid, name, table, columns):
    return SchemaDocument(connection_id=cid, connection=name, database=name.lower().replace(" ", "_"), table=table,
                          text=f'Table {table} in "{name}" (connection_id {cid}, database {name.lower()}): columns: {columns}.')


DOCS = [
    doc(3, "Shop DB", "users", "id int (primary key), name varchar, email varchar (unique)"),
    doc(3, "Shop DB", "orders", "id int (primary key), user_id int, total decimal, status enum"),
    doc(3, "Shop DB", "products", "id int (primary key), title varchar, price decimal"),
    doc(3, "Shop DB", "coupons", "id int (primary key), code varchar, discount int"),
    doc(9, "Blog DB", "users", "id int (primary key), display_name varchar, email varchar"),
    doc(9, "Blog DB", "posts", "id int (primary key), title varchar, body text, published_at datetime"),
    doc(9, "Blog DB", "categories", "id int (primary key), name varchar"),
]
PAGES = [
    {"route": "/data", "title": "Data", "description": "Rows of the user's own tables; add, edit or delete rows"},
    {"route": "/security", "title": "Security & Guardrails", "description": "What the platform enforces"},
    {"route": "/account", "title": "Account settings", "description": "Profile, name, email, password and sessions"},
]


# ---------------------------------------------------------------------------------------------- protocol and prompt

def test_the_protocol_is_generated_from_the_decision_schema():
    text = protocol_text()
    for kind, meaning in KIND_MEANINGS.items():
        assert f"- {kind}: {meaning}" in text
    assert "- thought:" in text and "- then:" in text and "- slot_updates:" in text


def test_no_role_or_situational_rules_are_written_in_the_code():
    req = DecideRequest(user_id=1, utterance="dummy user bana do", provider="mock", use_rag=False)
    system = AgentDecider.build_messages(req, decider_mod.RagInfo())[0][0]["content"]
    assert system.startswith("DECISION PROTOCOL")
    for phrase in ("You are Orbit", "Hinglish", "dummy", "Thodi der", "kaunse database", "choose_option"):
        assert phrase not in system

    req = DecideRequest(user_id=1, utterance="hi", provider="mock", use_rag=False, product_name="Acme",
                        system_prompt="Orbit helps inside {brand}.", system_instructions="Keep {product} replies short.")
    system = AgentDecider.build_messages(req, decider_mod.RagInfo())[0][0]["content"]
    assert system.startswith("Orbit helps inside Acme.") and "Keep Acme replies short." in system


def test_a_promise_to_check_is_never_rewritten_into_another_tool():
    decision = AgentDecider.validate_decision(json.dumps({"kind": "ANSWER", "speech_text": "Let me check, thodi der mein batata hu."}),
                                              ["find_dummy_data", "list_database_connections"])
    assert decision.kind == "ANSWER" and decision.tool_call is None


def test_the_synonym_word_list_is_gone():
    assert not hasattr(rag_service, "_SYNONYMS") and not hasattr(rag_service, "_expand_query")


def test_a_tool_the_retrieved_knowledge_names_is_described_in_full(monkeypatch):
    monkeypatch.setattr(decider_mod.settings, "AGENT_MAX_TOOLS", 1)
    tools = [{"name": n, "description": n, "parameters": {"type": "object", "properties": {}}}
             for n in ("find_dummy_data", "list_automations", "get_dashboard_summary")]
    req = DecideRequest(user_id=1, utterance="test data hai kya", tool_schemas=tools, provider="mock", use_rag=False)
    knowledge = [RetrievedChunk(source_id="product:guide:1", scope="product", text="find_dummy_data scans for placeholder accounts.")]
    assert "find_dummy_data" in decider_mod.select_tools(req, knowledge)


# ---------------------------------------------------------------------------------------------- schema retrieval

def test_a_table_in_several_databases_is_retrieved_from_each(words):
    req = DecideRequest(user_id=1, utterance="add a dummy user", schema_documents=DOCS, provider="mock")
    found = {(c.source_id) for c in AgentDecider.retrieve_schema(req, AgentDecider.retrieval_query(req))}
    assert {"schema:3:users", "schema:9:users"} <= found


def test_a_message_about_nothing_in_the_databases_retrieves_no_tables(words):
    req = DecideRequest(user_id=1, utterance="hello, how are you today", schema_documents=DOCS, provider="mock")
    assert AgentDecider.retrieve_schema(req, AgentDecider.retrieval_query(req)) == []


def test_a_short_reply_is_understood_with_the_turns_before_it(words):
    req = DecideRequest(user_id=1, utterance="the shop one", schema_documents=DOCS, provider="mock",
                        conversation_summary=[{"role": "user", "content": "add a dummy user"},
                                              {"role": "assistant", "content": "Which database: Shop DB or Blog DB?"}])
    assert "add a dummy user" in AgentDecider.retrieval_query(req)
    assert any(c.source_id == "schema:3:users" for c in AgentDecider.retrieve_schema(req, AgentDecider.retrieval_query(req)))


def test_the_page_the_user_is_on_never_steers_which_tables_are_retrieved(words):
    # Real failure: on the Dashboard, "dummy user bana do" retrieved the customer's "pages" tables instead of "users".
    docs = DOCS + [doc(3, "Shop DB", "pages", "id int (primary key), slug varchar"),
                   doc(3, "Shop DB", "page_translations", "id int (primary key), page_id int, lang varchar")]
    req = DecideRequest(user_id=1, utterance="dummy user bana do", schema_documents=docs, provider="mock",
                        runtime_context={"page": {"route": "/dashboard", "title": "Dashboard page"}})
    assert "page" in AgentDecider.retrieval_query(req) and "page" not in AgentDecider.retrieval_query(req, with_page=False)
    found = [c.source_id for c in AgentDecider.retrieve_schema(req, AgentDecider.retrieval_query(req, with_page=False))]
    assert {"schema:3:users", "schema:9:users"} <= set(found) and "schema:3:pages" not in found


def test_a_table_named_in_full_matches_in_a_long_question(words):
    names = [d.table for d in DOCS]
    found = {DOCS[i].table for i, _ in rag_service.rank_texts("which user has the most refunded orders in the last month",
                                                               [d.text for d in DOCS], top_k=8, names=names)}
    assert {"users", "orders"} <= found


def test_the_retrieved_schema_is_given_to_the_model_by_database(words):
    req = DecideRequest(user_id=1, utterance="add a dummy user", schema_documents=DOCS, provider="mock")
    chunks = AgentDecider.retrieve_schema(req, AgentDecider.retrieval_query(req))
    user = AgentDecider.build_messages(req, decider_mod.RagInfo(chunks=chunks))[0][1]["content"]
    assert "RETRIEVED SCHEMA" in user and '"Shop DB"' in user and '"Blog DB"' in user


def test_words_every_text_shares_count_for_nothing(words):
    texts = [d.text for d in DOCS]
    assert rag_service.rank_texts("connect a new database", texts, names=[d.table for d in DOCS]) == []
    top = rag_service.rank_texts("how many orders were refunded", texts, names=[d.table for d in DOCS])
    assert top and DOCS[top[0][0]].table == "orders"


# ---------------------------------------------------------------------------------------------- the focused route call

def _no_model(*a, **k):
    raise AssertionError("no model call expected")


def test_route_makes_no_model_call_when_nothing_matches(words, monkeypatch):
    monkeypatch.setattr(agent_fastpath, "_call", _no_model)
    out = agent_fastpath.route("hello there, nice to meet you", pages=PAGES, schema_documents=DOCS, instructions="Decide.")
    assert out["kind"] == "other" and out["reason"] == "NOTHING_MATCHED"


def test_route_without_instructions_leaves_everything_to_the_agent_loop(words, monkeypatch):
    monkeypatch.setattr(agent_fastpath, "_call", _no_model)
    out = agent_fastpath.route("how many users", pages=PAGES, schema_documents=DOCS, instructions=None)
    assert out["kind"] == "other" and out["reason"] == "NOT_CONFIGURED"


def test_route_sees_every_database_with_the_table_and_keeps_only_those(words, monkeypatch):
    seen = {}

    def model(messages, schema, *a, **k):
        seen["system"] = messages[0]["content"]
        return {"success": True, "data": seen["answer"]}

    monkeypatch.setattr(agent_fastpath, "_call", model)
    seen["answer"] = {"kind": "data_question", "question": "How many users are there?", "page": "", "connection_id": 3}
    out = agent_fastpath.route("how many users are there", schema_documents=DOCS, instructions="Decide.")
    assert out == {"success": True, "kind": "data_question", "question": "How many users are there?", "page": "", "connection_id": 3}
    assert "connection_id 3" in seen["system"] and "connection_id 9" in seen["system"]

    seen["answer"] = {"kind": "data_question", "question": "How many users?", "page": "", "connection_id": 77}
    assert agent_fastpath.route("how many users", schema_documents=DOCS, instructions="Decide.")["reason"] == "DATABASE_NOT_CLEAR"

    seen["answer"] = {"kind": "data_question", "question": "How many users?", "page": ""}  # two databases, none named
    assert agent_fastpath.route("how many users", schema_documents=DOCS, instructions="Decide.")["kind"] == "other"

    only_shop = [d for d in DOCS if d.connection_id == 3]
    out = agent_fastpath.route("how many users", schema_documents=only_shop, instructions="Decide.")
    assert out["kind"] == "data_question" and out["connection_id"] == 3


def test_route_opens_only_a_page_it_was_given(words, monkeypatch):
    monkeypatch.setattr(agent_fastpath, "_call", lambda *a, **k: {"success": True, "data": {"kind": "open_page", "question": "", "page": "/admin"}})
    assert agent_fastpath.route("open the security page", pages=PAGES, instructions="Decide.")["reason"] == "PAGE_NOT_LISTED"
    monkeypatch.setattr(agent_fastpath, "_call", lambda *a, **k: {"success": True, "data": {"kind": "open_page", "question": "", "page": "/security"}})
    assert agent_fastpath.route("open the security page", pages=PAGES, instructions="Decide.")["page"] == "/security"


def test_answer_needs_the_administrators_instructions(monkeypatch):
    monkeypatch.setattr(agent_fastpath, "_call", _no_model)
    assert agent_fastpath.answer("how many users", {"success": True}, instructions="")["error_category"] == "NOT_CONFIGURED"


# ---------------------------------------------------------------------------------------------- vector cache

class CountingEncoder:
    def __init__(self, dim=64):
        self.dim, self.calls, self.lock = dim, 0, threading.Lock()

    def __call__(self, texts):
        with self.lock:
            self.calls += len(texts)
        return np.ones((len(texts), self.dim), dtype=np.float32)


def test_a_few_new_texts_are_embedded_now_and_many_in_the_background(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path))
    cache, enc = VectorCache(), CountingEncoder()
    assert all(v is not None for v in cache.vectors(["a", "b"], "test:x", enc, 64))

    many = [f"table {i}" for i in range(40)]
    first = cache.vectors(many, "test:x", enc, 64)
    assert all(v is None for v in first)  # nothing waits for the embedding model
    cache._worker.join(timeout=10)
    assert all(v is not None for v in cache.vectors(many, "test:x", enc, 64))

    again = VectorCache()  # a restart: vectors come from disk, nothing is embedded again
    enc2 = CountingEncoder()
    assert all(v is not None for v in again.vectors(many + ["a"], "test:x", enc2, 64)) and enc2.calls == 0


def test_vectors_of_another_dimension_are_never_mixed_in(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path))
    cache = VectorCache()
    assert cache.vectors(["a"], "test:x", CountingEncoder(dim=8), 64) == [None]


# ---------------------------------------------------------------------------------------------- knowledge search

def test_knowledge_search_reads_only_orbits_knowledge_and_the_users_own_documents(monkeypatch):
    seen = {}

    def retrieve(user_id, query_text, product_k=6, user_k=3, **kw):
        seen.update(user_id=user_id, query=query_text, product_k=product_k)
        return {"chunks": [{"source_id": "product:guide:1", "scope": "product", "text": "Approve a draft on Approvals.", "score": 0.8}]}

    monkeypatch.setattr(rag_service, "retrieve_for_agent", retrieve)
    res = client.post("/v1/ai/agent/knowledge", json={"user_id": 5, "query": "how to approve a draft", "top_k": 4}, headers=AUTH).json()
    assert seen == {"user_id": 5, "query": "how to approve a draft", "product_k": 4}
    assert res["passages"][0]["source_id"] == "product:guide:1"
