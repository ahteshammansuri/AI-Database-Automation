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


def test_product_guides_are_indexed_together_with_named_sources(tmp_path, monkeypatch):
    """Orbit's product knowledge is every guide in docs/orbit-agent, each chunk attributable to its guide."""
    from ai_service.app.rag.service import rag_service

    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path / "idx"))
    guides = tmp_path / "guides"
    guides.mkdir()
    (guides / "security_guide.md").write_text(
        "# Security\n\n## Never possible\nDROP, TRUNCATE and ALTER can never run against a connected database.\n")
    (guides / "automations_guide.md").write_text(
        "# Automations\n\n## Schedule\nPublication must be at least 15 minutes after generation.\n")
    paths = sorted(str(p) for p in guides.glob("*.md"))
    monkeypatch.setattr(rag_service, "_product_doc_paths", lambda: paths)

    total = rag_service.ensure_product_context_indexed()
    assert total == 2

    res = rag_service.retrieve_for_agent(4242, "can truncate or drop run on my database")
    product = [c for c in res["chunks"] if c["scope"] == "product"]
    assert product and product[0]["source_id"].startswith("product:security_guide:")
    assert product[0]["heading"].startswith("Security")

    # Editing any guide re-indexes; unchanged guides are not re-embedded.
    version = res["index_version"]
    assert rag_service.ensure_product_context_indexed() == 2
    assert rag_service._read_manifest(0)["version"] == version
    (guides / "automations_guide.md").write_text(
        "# Automations\n\n## Schedule\nPublication is at least 15 minutes after generation.\n\n## Images\nImage columns get a banner.\n")
    assert rag_service.ensure_product_context_indexed() == 3
    assert rag_service._read_manifest(0)["version"] != version
    assert len(rag_service._read_manifest(0)["sources"]) == 2


def test_real_product_guides_exist_and_cover_the_portal():
    from ai_service.app.rag.service import rag_service

    names = {p.rsplit("/", 1)[-1] for p in rag_service._product_doc_paths()}
    assert {"product_context_rag.md", "automations_guide.md", "security_guide.md", "portal_tour.md"} <= names


def test_published_guides_replace_bundled_ones_and_reindex(tmp_path, monkeypatch):
    """Guides an admin publishes become Orbit's product knowledge; publishing nothing falls back to the bundled guides."""
    from ai_service.app.rag.service import rag_service

    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path / "idx"))
    bundled = tmp_path / "bundled.md"
    bundled.write_text("# Bundled\n\n## Old\nThe bundled guide.\n")
    monkeypatch.setattr(rag_service, "_product_doc_paths", lambda: [str(bundled)])
    assert rag_service.product_guides_status()["source"] == "bundled"

    res = client.post("/v1/rag/product-guides", headers=AUTH_HEADERS, json={"guides": [
        {"name": "billing_guide", "title": "Billing", "content": "## Plans\nThe Pro plan allows unlimited automations."},
        {"name": "faq", "title": "FAQ", "content": "# FAQ\n\n## Refunds\nRefunds are processed within 5 days."},
    ]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "published" and body["guides"] == 2 and body["chunks"] >= 2
    files = sorted(p.name for p in (tmp_path / "product_guides").glob("*.md"))
    assert files == ["billing_guide.md", "faq.md"]
    # A title is added as the top heading only when the content has none.
    assert (tmp_path / "product_guides" / "billing_guide.md").read_text().startswith("# Billing\n")
    assert (tmp_path / "product_guides" / "faq.md").read_text().count("# FAQ") == 1

    found = rag_service.retrieve_for_agent(4243, "how many automations does the pro plan allow")
    sources = {c["source_id"].split(":")[1] for c in found["chunks"] if c["scope"] == "product"}
    assert sources and sources <= {"billing_guide", "faq"}

    status = client.get("/v1/rag/product-guides/status", headers=AUTH_HEADERS).json()
    assert status["source"] == "published" and status["guides"] == 2 and status["version"] == body["version"]

    # Unpublished guides are removed; publishing none restores the bundled set.
    assert client.post("/v1/rag/product-guides", headers=AUTH_HEADERS, json={"guides": [
        {"name": "faq", "content": "## Refunds\nRefunds take 5 days."}]}).json()["guides"] == 1
    assert [p.name for p in (tmp_path / "product_guides").glob("*.md")] == ["faq.md"]
    back = client.post("/v1/rag/product-guides", headers=AUTH_HEADERS, json={"guides": []}).json()
    assert back["source"] == "bundled" and rag_service._read_manifest(0)["sources"][0].endswith("bundled.md")


def test_published_guide_names_must_be_slugs_and_endpoint_needs_the_service_token():
    bad = client.post("/v1/rag/product-guides", headers=AUTH_HEADERS, json={"guides": [{"name": "../etc/passwd", "content": "x"}]})
    assert bad.status_code == 422
    assert client.get("/v1/rag/product-guides/status").status_code in (401, 403)
