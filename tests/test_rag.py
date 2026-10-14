import os
import tempfile
import pytest
import pymupdf
from backend.app.rag.document_parser import parse_document, normalize_text
from backend.app.rag.chunker import chunk_text
from backend.app.rag.vector_index import FAISSVectorStore


def test_normalize_text():
    raw = "Line 1 \r\n\r\n\r\n\r\nLine 2   \nLine 3"
    norm = normalize_text(raw)
    assert "\r" not in norm
    assert "Line 1\n\nLine 2\nLine 3" == norm


def test_chunk_text():
    sample = "Paragraph 1 is about database architecture.\n\nParagraph 2 is about RAG indexing and FAISS vector retrieval.\n\nParagraph 3 is about safety guardrails."
    chunks = chunk_text(sample, chunk_size=80, chunk_overlap=20)
    assert len(chunks) >= 2
    assert chunks[0]["chunk_index"] == 0
    assert "database" in chunks[0]["content"]


def test_parse_markdown_and_txt():
    with tempfile.NamedTemporaryFile("w+", suffix=".md", delete=False) as f:
        f.write("# Architecture Guide\n\nAlways validate schema constraints before writing.")
        md_path = f.name

    try:
        content = parse_document(md_path, "md")
        assert "Architecture Guide" in content
        assert "validate schema constraints" in content
    finally:
        os.remove(md_path)


def test_parse_pdf():
    # Create a small synthetic PDF in memory with PyMuPDF
    pdf_doc = pymupdf.open()
    page = pdf_doc.new_page()
    page.insert_text((50, 72), "Synthetic Technical Documentation for PDF Ingestion Testing")
    temp_pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    temp_pdf.close()
    pdf_doc.save(temp_pdf.name)
    pdf_doc.close()

    try:
        content = parse_document(temp_pdf.name, "pdf")
        assert "Synthetic Technical Documentation" in content
    finally:
        os.remove(temp_pdf.name)


def test_faiss_vector_store():
    store = FAISSVectorStore(dimension=256)
    chunks = [
        {"chunk_id": 1, "document_id": 10, "document_title": "Database Security", "content": "All queries must avoid DELETE and DROP commands."},
        {"chunk_id": 2, "document_id": 11, "document_title": "Frontend Design", "content": "Use React, Tailwind CSS, and accessible UI components."},
        {"chunk_id": 3, "document_id": 12, "document_title": "Publishing Strategy", "content": "Schedule blog posts daily at 9am with approval."}
    ]
    added = store.add_chunks(chunks)
    assert added == 3
    assert store.count() == 3

    # Search for security
    results = store.search("database security and forbidden sql", top_k=2)
    assert len(results) >= 1
    top_match = results[0]
    assert top_match["document_title"] == "Database Security"
    assert "DELETE and DROP" in top_match["content"]
    assert top_match["similarity_score"] > 0.0


def test_api_rag_upload_and_query(client):
    # Upload markdown context
    with tempfile.NamedTemporaryFile("w+", suffix=".md", delete=False) as f:
        f.write("# Brand Editorial Guidelines\nTone should always be authoritative, clear, and educational.")
        tmp_name = f.name

    try:
        with open(tmp_name, "rb") as fp:
            upload_res = client.post(
                "/api/v1/knowledge/upload",
                data={"title": "Brand Guidelines"},
                files={"file": ("editorial_guidelines.md", fp, "text/markdown")}
            )
        assert upload_res.status_code == 201
        doc_data = upload_res.json()
        assert doc_data["title"] == "Brand Guidelines"
        assert doc_data["chunk_count"] >= 1

        # Query knowledge base
        query_res = client.post(
            "/api/v1/knowledge/query",
            json={"query": "authoritative tone and educational guidelines", "top_k": 2}
        )
        assert query_res.status_code == 200
        matches = query_res.json()["matches"]
        assert len(matches) >= 1
        assert "Brand Guidelines" in matches[0]["document_title"]
    finally:
        os.remove(tmp_name)
