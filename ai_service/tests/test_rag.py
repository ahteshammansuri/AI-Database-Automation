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


def _publish(guides):
    res = client.post("/v1/rag/product-guides", headers=AUTH_HEADERS, json={"guides": guides})
    assert res.status_code == 200, res.text
    return res.json()


def test_product_guides_are_indexed_together_with_named_sources(tmp_path, monkeypatch):
    """Orbit's product knowledge is the set of guides published from the admin panel, each chunk attributable to its guide."""
    from ai_service.app.rag.service import rag_service

    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path / "idx"))
    assert rag_service.ensure_product_context_indexed() == 0, "no guides until an admin publishes them"
    body = _publish([
        {"name": "security_guide", "title": "Security", "content": "## Never possible\nDROP, TRUNCATE and ALTER can never run against a connected database."},
        {"name": "automations_guide", "title": "Automations", "content": "## Schedule\nPublication must be at least 15 minutes after generation."},
    ])
    assert body["vectors"] == 2

    res = rag_service.retrieve_for_agent(4242, "can truncate or drop run on my database")
    product = [c for c in res["chunks"] if c["scope"] == "product"]
    assert product and product[0]["source_id"].startswith("product:security_guide:")
    assert product[0]["heading"].startswith("Security")

    # Already indexed with the current backend: nothing is re-embedded; publishing an edit re-indexes.
    version = res["index_version"]
    assert rag_service.ensure_product_context_indexed() == 2
    assert rag_service._read_manifest(0)["version"] == version
    body = _publish([
        {"name": "security_guide", "title": "Security", "content": "## Never possible\nDROP, TRUNCATE and ALTER can never run against a connected database."},
        {"name": "automations_guide", "title": "Automations", "content": "## Schedule\nPublication is at least 15 minutes after generation.\n\n## Images\nImage columns get a banner."},
    ])
    assert body["vectors"] == 3 and body["version"] != version
    assert [g["name"] for g in rag_service._read_manifest(0)["guides"]] == ["security_guide", "automations_guide"]


def test_guides_are_re_embedded_when_the_embedding_backend_changes(tmp_path, monkeypatch):
    from ai_service.app.rag.service import rag_service

    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path / "idx"))
    _publish([{"name": "faq", "title": "FAQ", "content": "## Refunds\nRefunds are processed within 5 days."}])
    manifest = rag_service._read_manifest(0)
    manifest["embedding_backend"] = "some-older-backend"
    with open(rag_service._manifest_path(0), "w", encoding="utf-8") as f:
        import json
        json.dump(manifest, f)

    assert rag_service.ensure_product_context_indexed() == 1
    after = rag_service._read_manifest(0)
    assert after["embedding_backend"] == rag_service.embedder.backend
    assert after["guides"] == [{"name": "faq", "title": "FAQ"}]
    found = rag_service.retrieve_for_agent(4244, "how long do refunds take")
    assert any(c["source_id"].startswith("product:faq:") for c in found["chunks"])


def test_published_guides_replace_the_previous_set_and_no_files_are_kept(tmp_path, monkeypatch):
    """Guides an admin publishes become Orbit's product knowledge; nothing is written as Markdown files."""
    from ai_service.app.rag.service import rag_service

    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path / "idx"))
    legacy = tmp_path / "product_guides"
    legacy.mkdir()
    (legacy / "old.md").write_text("# Old\n\nLeft over from an older version.\n")
    assert rag_service.product_guides_status()["source"] == "none"

    body = _publish([
        {"name": "billing_guide", "title": "Billing", "content": "## Plans\nThe Pro plan allows unlimited automations."},
        {"name": "faq", "title": "FAQ", "content": "# FAQ\n\n## Refunds\nRefunds are processed within 5 days."},
    ])
    assert body["source"] == "published" and body["guides"] == 2 and body["chunks"] >= 2
    assert not legacy.exists(), "files from older versions are removed"
    assert not list(tmp_path.rglob("*.md")), "guides are never stored as Markdown files"

    found = rag_service.retrieve_for_agent(4243, "how many automations does the pro plan allow")
    sources = {c["source_id"].split(":")[1] for c in found["chunks"] if c["scope"] == "product"}
    assert sources and sources <= {"billing_guide", "faq"}
    # A title becomes the top heading only when the content has none.
    headings = {c["heading"] for c in found["chunks"] if c["scope"] == "product"}
    assert not any(h.startswith("FAQ › FAQ") for h in headings)

    status = client.get("/v1/rag/product-guides/status", headers=AUTH_HEADERS).json()
    assert status["source"] == "published" and status["guides"] == 2 and status["version"] == body["version"]

    # A smaller set replaces the previous one; an empty set leaves Orbit without product knowledge.
    assert _publish([{"name": "faq", "content": "## Refunds\nRefunds take 5 days."}])["guides"] == 1
    assert [g["name"] for g in rag_service._read_manifest(0)["guides"]] == ["faq"]
    empty = _publish([])
    assert empty["source"] == "none" and rag_service.product_guides_status()["chunks"] == 0
    assert rag_service.ensure_product_context_indexed() == 0

    bad = client.post("/v1/rag/product-guides", headers=AUTH_HEADERS, json={"guides": [{"name": "../etc", "content": "x"}]})
    assert bad.status_code == 422
