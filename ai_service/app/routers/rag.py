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
    RagStatusResponse,
)
from ai_service.app.rag.service import rag_service

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
            top_k=req.top_k,
            document_ids=req.document_ids,
            min_score=req.min_score,
            hybrid=req.hybrid
        )
        chunks = [RetrievedChunk(**c) for c in raw_chunks]
        return QueryResponse(
            query=req.query_text,
            user_id=req.user_id,
            chunks=chunks
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/status/{user_id}", response_model=RagStatusResponse)
def get_user_rag_status(user_id: int):
    try:
        status_info = rag_service.get_user_status(user_id=user_id)
        return RagStatusResponse(**status_info)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")


@router.delete("/index/{user_id}/{document_id}")
async def delete_document_index(user_id: int, document_id: int):
    try:
        rag_service.delete_document(user_id=user_id, document_id=document_id)
        return {"success": True, "message": f"Document {document_id} vectors removed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deletion failed: {str(e)}")


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

