import os
import tempfile
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import KnowledgeDocument, KnowledgeChunk
from backend.app.schemas.knowledge import (
    KnowledgeDocResponse, RagQueryRequest, RagQueryResponse, RagChunkMatch
)
from backend.app.rag.service import RAGService
from backend.app.rag.vector_index import vector_store

router = APIRouter(prefix="/knowledge", tags=["Knowledge Base & RAG"])


@router.get("", response_model=List[KnowledgeDocResponse])
def list_knowledge_documents(db: Session = Depends(get_db)):
    return db.query(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc()).all()


@router.post("/upload", response_model=KnowledgeDocResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    filename = file.filename or "uploaded_document.txt"
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    if ext not in ["md", "markdown", "txt", "pdf"]:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '.{ext}'. Only .md, .txt, and .pdf are supported."
        )

    # Save to temp file first
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    file_size = len(content)

    try:
        doc = RAGService.ingest_document(
            db=db,
            title=title,
            filename=filename,
            temp_file_path=tmp_path,
            file_type=ext,
            file_size=file_size
        )
        return doc
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest knowledge document: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/query", response_model=RagQueryResponse)
def query_knowledge_base(payload: RagQueryRequest, db: Session = Depends(get_db)):
    # Ensure vector store is loaded with chunks if empty
    if vector_store.count() == 0:
        RAGService.sync_index_from_db(db)

    results = vector_store.search(payload.query, top_k=payload.top_k)
    matches = [
        RagChunkMatch(
            chunk_id=r.get("chunk_id") or 0,
            document_id=r.get("document_id") or 0,
            document_title=r.get("document_title") or "Context",
            content=r.get("content") or "",
            similarity_score=r.get("similarity_score") or 0.0
        )
        for r in results
    ]

    return RagQueryResponse(
        query=payload.query,
        matches=matches
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: Session = Depends(get_db)):
    doc = db.query(KnowledgeDocument).filter(KnowledgeDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.file_path and os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except OSError:
            pass

    db.delete(doc)
    db.commit()

    # Re-sync FAISS index
    RAGService.sync_index_from_db(db)
    return None
