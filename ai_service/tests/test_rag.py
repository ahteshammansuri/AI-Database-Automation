import pytest
from fastapi.testclient import TestClient
from ai_service.app.main import app
from ai_service.app.config import settings

client = TestClient(app)
AUTH_HEADERS = {"X-Service-Token": settings.SERVICE_TOKEN}


def test_rag_indexing_and_query():
    user_id = 9999
    doc_id = 101

    text = """
    # Advanced Database Automation
    
    Database migrations and schema evolution require zero downtime deployment strategies.
    Blue-green deployments and ghost table techniques prevent locks on high throughput tables.
    
    Idempotent execution prevents duplicate records during automated scheduled publication.
    Always enforce primary key and unique constraint validation before executing insert statements.
    """

    # 1. Index document
    index_res = client.post(
        "/v1/rag/index",
        json={
            "user_id": user_id,
            "document_id": doc_id,
            "title": "Advanced Database Automation",
            "text_content": text,
            "file_type": "md"
        },
        headers=AUTH_HEADERS
    )
    assert index_res.status_code == 200
    assert index_res.json()["success"] is True
    assert index_res.json()["chunks_created"] > 0

    # 2. Query knowledge
    query_res = client.post(
        "/v1/rag/query",
        json={
            "user_id": user_id,
            "query_text": "idempotent execution and zero downtime",
            "top_k": 2
        },
        headers=AUTH_HEADERS
    )
    assert query_res.status_code == 200
    chunks = query_res.json()["chunks"]
    assert len(chunks) > 0
    assert any("idempotent" in c["text"].lower() for c in chunks)

    # 3. Clean up
    del_res = client.delete(
        f"/v1/rag/index/{user_id}/{doc_id}",
        headers=AUTH_HEADERS
    )
    assert del_res.status_code == 200
