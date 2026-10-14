import pytest
from ai_service.app.schemas.agent import AgentPlanRequest, SynthesizeResponseRequest
from ai_service.app.services.agent_planner import AgentPlanner
from ai_service.app.rag.service import rag_service


def test_rag_product_context_ingestion():
    total = rag_service.ensure_product_context_indexed()
    assert total > 0, "Product RAG context should be indexed into FAISS"
    results = rag_service.query_product_context("how do I connect a database?", top_k=2)
    assert len(results) > 0, "Querying product RAG should return relevant chunks"
    assert "chunk_id" in results[0]
    assert len(results[0]["text"]) > 10


def test_agent_planner_extracts_slots_without_erasure():
    req = AgentPlanRequest(
        goal_prompt="Connect to my MySQL database on host 192.168.1.50, port 3307, database production_db, user admin",
        provider="mock"
    )
    res = AgentPlanner.plan(req)
    assert res.success is True
    assert res.task_type == "ADD_CONNECTION"
    assert res.outcome == "MISSING_INFORMATION"
    assert res.missing_fields == ["password"], "Only password should be missing"
    assert res.extracted_slots.get("host") == "192.168.1.50"
    assert res.extracted_slots.get("port") == 3307
    assert res.extracted_slots.get("database") == "production_db"
    assert res.extracted_slots.get("username") == "admin"
    assert "admin" in res.question or "password" in res.question.lower()
    assert len(res.rag_citations) > 0, "RAG citations should be included"


def test_agent_planner_all_slots_provided_steps_generated():
    req = AgentPlanRequest(
        goal_prompt="Connect to MySQL database test_db on host 127.0.0.1, user root, port 3306, password secretpass",
        provider="mock"
    )
    res = AgentPlanner.plan(req)
    assert res.success is True
    assert res.outcome == "SUPPORTED_AND_SPECIFIED"
    assert len(res.steps) >= 2
    step_tools = [s.tool for s in res.steps]
    assert "test_database_connection" in step_tools
    assert "save_database_connection" in step_tools


def test_agent_planner_disallows_destructive_sql():
    req = AgentPlanRequest(
        goal_prompt="Drop table users and delete all records",
        provider="mock"
    )
    res = AgentPlanner.plan(req)
    assert res.outcome == "DISALLOWED_BY_POLICY"
    assert "prohibited" in res.explanation.lower()
    assert len(res.steps) == 0


def test_agent_planner_unsupported_task():
    req = AgentPlanRequest(
        goal_prompt="Please book a flight from London to New York for tomorrow",
        provider="mock"
    )
    res = AgentPlanner.plan(req)
    assert res.outcome == "UNSUPPORTED"
    assert "outside the platform's supported capabilities" in res.explanation


def test_synthesize_response():
    req = SynthesizeResponseRequest(
        goal_prompt="Connect to database blog_db",
        executed_steps=[
            {"step": "Testing Connection", "result": {"success": True, "safe_summary": "Handshake OK"}},
            {"step": "Saving Connection", "result": {"success": True, "safe_summary": "Profile Saved"}}
        ],
        final_status="SUCCEEDED",
        domain_data={"database_name": "blog_db", "host": "127.0.0.1"},
        provider="mock"
    )
    res = AgentPlanner.synthesize_response(req)
    assert "blog_db" in res.spoken_text or "verified" in res.spoken_text
