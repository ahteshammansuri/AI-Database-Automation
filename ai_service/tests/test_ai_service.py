import pytest
from fastapi.testclient import TestClient
from ai_service.app.main import app
from ai_service.app.config import settings

client = TestClient(app)
AUTH_HEADERS = {"X-Service-Token": settings.SERVICE_TOKEN}


def test_health_check():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"


def test_unauthorized_without_service_token():
    res = client.post("/v1/ai/generate", json={"prompt": "Hello"})
    assert res.status_code == 401
    assert "Unauthorized" in res.json()["detail"]


def test_mock_ai_generation():
    payload = {
        "provider": "mock",
        "model": "mock-llama3-synthetic",
        "prompt": "Write a blog post about topic: Scalable Database Indexing",
        "target_table": "posts",
        "required_fields": ["title", "slug", "content", "excerpt"]
    }
    res = client.post("/v1/ai/generate", json=payload, headers=AUTH_HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "title" in body["data"]
    assert "Scalable Database Indexing" in body["data"]["title"]
    assert "slug" in body["data"]
    assert "content" in body["data"]


def test_mock_ai_rejection_feedback():
    payload = {
        "provider": "mock",
        "prompt": "Write a blog post about topic: MySQL Performance",
        "target_table": "posts",
        "required_fields": ["title", "content"],
        "rejection_feedback": "Please add benchmarks"
    }
    res = client.post("/v1/ai/generate", json=payload, headers=AUTH_HEADERS)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "Revised" in data["title"]
    assert "Please add benchmarks" in data["content"]


def test_provider_health_mock():
    res = client.post(
        "/v1/ai/health",
        json={"provider": "mock"},
        headers=AUTH_HEADERS
    )
    assert res.status_code == 200
    assert res.json()["available"] is True


def test_propose_automation_natural_language():
    sample_tables = [
        {
            "name": "posts",
            "category": "RECOMMENDED",
            "is_sensitive": False,
            "columns": [
                {"name": "id", "is_primary_key": True, "data_type": "int"},
                {"name": "title", "is_primary_key": False, "data_type": "varchar"},
                {"name": "slug", "is_primary_key": False, "data_type": "varchar"},
                {"name": "content", "is_primary_key": False, "data_type": "text"},
                {"name": "category_id", "is_primary_key": False, "data_type": "int", "is_foreign_key": True},
                {"name": "status", "is_primary_key": False, "data_type": "enum", "enum_values": ["draft", "published"]}
            ],
            "relationships": [
                {"foreign_key": "category_id", "referenced_table": "categories", "referenced_column": "id"}
            ]
        },
        {
            "name": "users",
            "category": "RESTRICTED",
            "is_sensitive": True,
            "columns": [{"name": "id", "is_primary_key": True}]
        }
    ]

    res = client.post(
        "/v1/ai/propose-automation",
        json={
            "goal_prompt": "Create one useful article about cars per day for ten days. Assign it to the Cars category, send preview at 8 AM, and publish at 9 AM.",
            "tables": sample_tables
        },
        headers=AUTH_HEADERS
    )
    assert res.status_code == 200
    plan = res.json()
    assert plan["success"] is True
    assert plan["target_table"] == "posts"
    assert plan["category_name"] == "Cars"
    assert plan["generation_time"] == "08:00"
    assert plan["publication_time"] == "09:00"
    assert plan["schedule_type"] == "DAILY"

    # Verify field mappings include derived slug and relational lookup
    field_names = [m["field_name"] for m in plan["field_mappings"]]
    assert "title" in field_names
    assert "slug" in field_names
    assert "category_id" in field_names

    cat_mapping = next(m for m in plan["field_mappings"] if m["field_name"] == "category_id")
    assert cat_mapping["mapping_type"] == "RELATIONAL_LOOKUP"
    assert cat_mapping["relation_config"]["creation_policy"] == "CREATE_IF_MISSING"
