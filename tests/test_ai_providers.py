import pytest
from backend.app.ai.mock_provider import MockAIProvider
from backend.app.ai.ollama_provider import OllamaProvider
from backend.app.ai.factory import get_all_providers_info, get_ai_provider


def test_mock_provider_generation():
    provider = MockAIProvider()
    data = provider.generate_structured_data(
        prompt="topic: Advanced MySQL Indexing Patterns",
        system_prompt="Generate blog record",
        target_table="posts",
        required_fields=["title", "slug", "excerpt", "content", "status"]
    )
    assert "title" in data
    assert "Advanced Mysql Indexing" in data["title"]
    assert "slug" in data
    assert "advanced-mysql-indexing" in data["slug"]
    assert "excerpt" in data
    assert "content" in data
    assert data["status"] == "published"


def test_mock_provider_with_rejection_feedback():
    provider = MockAIProvider()
    feedback = "Make the tone more practical and emphasize execution guardrails."
    data = provider.generate_structured_data(
        prompt="topic: Automated Publishing Systems",
        system_prompt="Generate blog record",
        target_table="posts",
        required_fields=["title", "slug", "content"],
        rejection_feedback=feedback
    )
    assert "(Revised Edition)" in data["title"]
    assert feedback in data["content"]
    assert "revised" in data["slug"]


def test_list_all_providers():
    info_list = get_all_providers_info()
    provider_ids = [p.provider_id for p in info_list]
    assert "ollama" in provider_ids
    assert "mock" in provider_ids
    assert "openai" in provider_ids
    assert "gemini" in provider_ids
    assert "anthropic" in provider_ids

    mock_info = next(p for p in info_list if p.provider_id == "mock")
    assert mock_info.is_available is True


def test_api_ai_providers_and_preview(client):
    # Test GET /api/v1/ai/providers
    providers_res = client.get("/api/v1/ai/providers")
    assert providers_res.status_code == 200
    providers = providers_res.json()
    assert len(providers) >= 5

    # Test POST /api/v1/ai/test with mock provider
    test_res = client.post("/api/v1/ai/test", json={"provider_id": "mock"})
    assert test_res.status_code == 200
    assert test_res.json()["success"] is True

    # Test POST /api/v1/ai/preview-generate
    preview_res = client.post(
        "/api/v1/ai/preview-generate",
        json={
            "topic": "FastAPI and PyMySQL Async Performance",
            "tone": "Educational",
            "target_table": "posts",
            "fields": ["title", "slug", "excerpt", "content", "status"]
        }
    )
    assert preview_res.status_code == 200
    preview_data = preview_res.json()
    assert preview_data["success"] is True
    assert "title" in preview_data["generated_data"]
    assert preview_data["generation_duration_ms"] > 0
