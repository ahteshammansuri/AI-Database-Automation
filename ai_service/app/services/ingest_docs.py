"""
Markdown Vector Ingestion Service (ADR-011, Section 9)
Chunks markdown documentation and prompts by headings, computes content hashes,
generates local embeddings, and incrementally upserts them into Qdrant vector store.
"""
import os
import sys
import glob
import hashlib
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from ai_service.app.rag.chunker import chunk_markdown_by_heading
from ai_service.app.rag.qdrant_store import QdrantStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


class DocIngestionService:
    def __init__(self, store: Optional[QdrantStore] = None):
        self.store = store or QdrantStore()
        self.root_dir = Path(__file__).resolve().parent.parent.parent.parent

    def ingest_file(
        self,
        file_path: Path,
        tenant_id: int = 0,
        namespace: str = "product_docs",
        version: str = "2026-10-15",
    ) -> Dict[str, Any]:
        """
        Chunks and ingests a single markdown file into Qdrant with hash tracking.
        """
        if not file_path.exists():
            logger.warning(f"File not found: {file_path}")
            return {"file": str(file_path), "chunks": 0, "status": "missing"}

        text = file_path.read_text(encoding="utf-8")
        if not text.strip():
            return {"file": str(file_path), "chunks": 0, "status": "empty"}

        rel_path = str(file_path.relative_to(self.root_dir))
        doc_id = hashlib.md5(rel_path.encode("utf-8")).hexdigest()[:16]

        # Chunk markdown cleanly by heading
        raw_chunks = chunk_markdown_by_heading(text, document_id=1, chunk_size=800, overlap=100)
        if not raw_chunks:
            return {"file": rel_path, "chunks": 0, "status": "no_chunks"}

        chunk_texts: List[str] = []
        chunk_hashes: List[str] = []
        for c in raw_chunks:
            chunk_str = f"## {c.get('heading', '')}\n\n{c['text']}".strip()
            chunk_texts.append(chunk_str)
            chunk_hashes.append(hashlib.sha256(chunk_str.encode("utf-8")).hexdigest())

        # Generate embeddings
        vectors = self.store.embed_service.encode_batch(chunk_texts)
        if hasattr(vectors, "tolist"):
            vector_list = vectors.tolist()
        else:
            vector_list = [list(v) for v in vectors]

        metadata = {
            "source": rel_path,
            "filename": file_path.name,
            "version": version,
        }

        self.store.upsert_document_chunks(
            tenant_id=tenant_id,
            namespace=namespace,
            doc_id=doc_id,
            chunks=chunk_texts,
            vectors=vector_list,
            hashes=chunk_hashes,
            metadata=metadata,
        )

        logger.info(f"Ingested {len(chunk_texts)} chunks for {rel_path} into namespace '{namespace}'")
        return {
            "file": rel_path,
            "chunks": len(chunk_texts),
            "doc_id": doc_id,
            "status": "ingested",
        }

    def ingest_default_corpus(self) -> List[Dict[str, Any]]:
        """
        Ingests the standard platform corpus:
        - docs/orbit-agent/product_context_rag.md
        - docs/SECURITY_MODEL.md
        - docs/DECISIONS.md
        - prompts/*.txt, prompts/*.md
        """
        results = []
        files_to_ingest = [
            (self.root_dir / "docs" / "orbit-agent" / "product_context_rag.md", 0, "product_docs"),
            (self.root_dir / "docs" / "SECURITY_MODEL.md", 0, "product_docs"),
            (self.root_dir / "docs" / "DECISIONS.md", 0, "product_docs"),
            (self.root_dir / "docs" / "tasks" / "2026-10-15_nl_data_agent.md", 0, "product_docs"),
        ]

        # Ingest prompts directory
        prompts_dir = self.root_dir / "prompts"
        if prompts_dir.exists():
            for p in prompts_dir.glob("*.*"):
                if p.suffix in [".md", ".txt", ".json"]:
                    files_to_ingest.append((p, 0, "prompts"))

        for file_path, tenant_id, namespace in files_to_ingest:
            if file_path.exists():
                res = self.ingest_file(file_path, tenant_id=tenant_id, namespace=namespace)
                results.append(res)

        return results


if __name__ == "__main__":
    service = DocIngestionService()
    print("Starting vector ingestion into Qdrant...")
    summary = service.ingest_default_corpus()
    total_chunks = sum(s.get("chunks", 0) for s in summary)
    print(f"\nIngestion Complete: {len(summary)} files processed, {total_chunks} chunks stored.")
    for item in summary:
        print(f" - {item['file']}: {item['chunks']} chunks ({item['status']})")
