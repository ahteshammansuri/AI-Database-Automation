import os
import shutil
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models import KnowledgeDocument, KnowledgeChunk
from backend.app.rag.document_parser import parse_document
from backend.app.rag.chunker import chunk_text
from backend.app.rag.vector_index import vector_store


class RAGService:
    """Service orchestrating document ingestion, chunking, and FAISS vector retrieval."""

    @classmethod
    def ingest_document(
        cls,
        db: Session,
        title: str,
        filename: str,
        temp_file_path: str,
        file_type: str,
        file_size: int
    ) -> KnowledgeDocument:
        # 1. Ensure storage directory exists
        os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
        dest_filename = f"{int(os.path.getmtime(temp_file_path))}_{filename}"
        permanent_path = os.path.join(settings.UPLOADS_DIR, dest_filename)
        shutil.copy(temp_file_path, permanent_path)

        # 2. Parse text
        text_content = parse_document(permanent_path, file_type)

        # 3. Create document record
        doc_record = KnowledgeDocument(
            title=title,
            filename=filename,
            file_path=permanent_path,
            file_type=file_type.lower().replace(".", ""),
            file_size_bytes=file_size,
            status="INDEXED"
        )
        db.add(doc_record)
        db.commit()
        db.refresh(doc_record)

        # 4. Chunk text
        chunks = chunk_text(text_content, chunk_size=500, chunk_overlap=100)
        chunk_records = []
        chunks_for_index = []

        for ch in chunks:
            chunk_obj = KnowledgeChunk(
                document_id=doc_record.id,
                chunk_index=ch["chunk_index"],
                content=ch["content"]
            )
            db.add(chunk_obj)
            chunk_records.append(chunk_obj)

        db.commit()
        for ch_obj in chunk_records:
            db.refresh(ch_obj)
            chunks_for_index.append({
                "chunk_id": ch_obj.id,
                "document_id": doc_record.id,
                "document_title": doc_record.title,
                "content": ch_obj.content
            })

        # 5. Add to FAISS index
        doc_record.chunk_count = len(chunk_records)
        db.commit()
        db.refresh(doc_record)

        vector_store.add_chunks(chunks_for_index)
        return doc_record

    @classmethod
    def sync_index_from_db(cls, db: Session):
        """Re-index all documents from database into FAISS store."""
        vector_store.reset()
        chunks = db.query(KnowledgeChunk).join(KnowledgeDocument).all()
        chunks_for_index = []
        for ch in chunks:
            chunks_for_index.append({
                "chunk_id": ch.id,
                "document_id": ch.document_id,
                "document_title": ch.document.title if ch.document else "Context",
                "content": ch.content
            })
        vector_store.add_chunks(chunks_for_index)

    @classmethod
    def retrieve_context_for_prompt(
        cls,
        query: str,
        top_k: int = 3,
        document_ids: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve relevant context chunks for a given generation prompt."""
        matches = vector_store.search(query, top_k=top_k * 2 if document_ids else top_k)
        if document_ids:
            matches = [m for m in matches if m["document_id"] in document_ids][:top_k]
        return matches[:top_k]
