from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from ai_service.app.rag.document_parser import DocumentParser
from ai_service.app.schemas.rag import (
    DocumentIndexRequest,
    DocumentIndexResponse,
    QueryRequest,
    QueryResponse,
    RetrievedChunk,
    FieldClassifyRequest,
    FieldClassifyResponse,
    FieldClassificationResult,
)
from ai_service.app.rag.service import rag_service
from ai_service.app.services.field_classifier import field_classifier

router = APIRouter(prefix="/v1/rag", tags=["RAG"])


class ExtractTextRequest(BaseModel):
    file_path: str


@router.post("/extract-text")
def extract_text_from_file(req: ExtractTextRequest):
    if not os.path.exists(req.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")
    try:
        text, fmt = DocumentParser.parse_file(req.file_path)
        return {"success": True, "text": text, "format": fmt, "length": len(text)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


@router.post("/index", response_model=DocumentIndexResponse)
def index_document(req: DocumentIndexRequest):
    try:
        chunks_created, total_vectors = rag_service.index_document_text(
            user_id=req.user_id,
            document_id=req.document_id,
            text_content=req.text_content,
            file_type=req.file_type
        )
        return DocumentIndexResponse(
            success=True,
            document_id=req.document_id,
            user_id=req.user_id,
            chunks_created=chunks_created,
            total_vectors=total_vectors
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")


@router.post("/query", response_model=QueryResponse)
def query_knowledge(req: QueryRequest):
    try:
        raw_chunks = rag_service.query(
            user_id=req.user_id,
            query_text=req.query_text,
            top_k=req.top_k
        )
        chunks = [RetrievedChunk(**c) for c in raw_chunks]
        return QueryResponse(
            query=req.query_text,
            user_id=req.user_id,
            chunks=chunks
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.delete("/index/{user_id}/{document_id}")
async def delete_document_index(user_id: int, document_id: int):
    try:
        rag_service.delete_document(user_id=user_id, document_id=document_id)
        return {"success": True, "message": f"Document {document_id} vectors removed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deletion failed: {str(e)}")


@router.post("/classify-fields", response_model=FieldClassifyResponse)
def classify_fields(req: FieldClassifyRequest):
    """
    Classify schema columns into semantic roles for automation field mapping.

    Accepts column descriptors from live MySQL schema introspection and returns
    role classifications with confidence scores and evidence strings.
    Low-confidence results (< 0.70) are flagged for user confirmation in the wizard.
    """
    try:
        column_dicts = [col.model_dump() for col in req.columns]
        classifications = field_classifier.classify_from_dicts(column_dicts)
        results = [FieldClassificationResult(**c) for c in classifications]
        return FieldClassifyResponse(success=True, classifications=results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Field classification failed: {str(e)}")


@router.post("/ingest-corpus")
def ingest_platform_corpus():
    """
    Ingest markdown documentation and prompts into Qdrant vector store.
    """
    try:
        from ai_service.app.services.ingest_docs import DocIngestionService
        from ai_service.app.rag.qdrant_store import qdrant_store
        service = DocIngestionService(store=qdrant_store)
        results = service.ingest_default_corpus()
        total_chunks = sum(r.get("chunks", 0) for r in results)
        return {"success": True, "results": results, "total_chunks": total_chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Corpus ingestion failed: {str(e)}")


class ProductGuide(BaseModel):
    name: str
    title: str = ""
    content: str


class PublishGuidesRequest(BaseModel):
    guides: list[ProductGuide]


@router.post("/product-guides")
def publish_product_guides(req: PublishGuidesRequest):
    """Orbit's knowledge of the website, as published by an admin (Laravel admin panel). Re-indexes right away."""
    try:
        return {"success": True, **rag_service.publish_product_guides([g.model_dump() for g in req.guides])}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/product-guides/status")
def product_guides_status():
    return rag_service.product_guides_status()

