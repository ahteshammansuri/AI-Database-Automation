import hashlib
import json
import logging
import os
import re
import time
from typing import List, Dict, Any, Optional, Tuple

import faiss

from ai_service.app.config import settings
from ai_service.app.rag.document_parser import DocumentParser
from ai_service.app.rag.chunker import TextChunker, chunk_markdown_by_heading
from ai_service.app.rag.embeddings import EmbeddingService
from ai_service.app.rag.vector_index import UserVectorIndex

logger = logging.getLogger(__name__)

_STOPWORDS = {
    "the", "and", "for", "are", "you", "your", "with", "this", "that", "what", "how", "can",
    "does", "into", "from", "have", "has", "was", "were", "will", "about", "please", "orbit",
}


class RAGService:
    """
    Orchestrates document ingestion, chunking, embeddings, and semantic search.

    Embedding dimension is resolved dynamically:
    - 768 when Ollama (nomic-embed-text) is available
    - 256 (hash-projection fallback) otherwise

    When Ollama comes online after a previous offline session, the FAISS index
    dimension changes. Old indexes are safely rebuilt on next index_document_text call.
    """

    def __init__(self):
        self.chunker = TextChunker(chunk_size=400, chunk_overlap=80)
        # EmbeddingService probes Ollama on init and sets self.dimension accordingly
        self.embedder = EmbeddingService()

    def _get_user_index(self, user_id: int) -> UserVectorIndex:
        """Return a UserVectorIndex with the correct current dimension."""
        return UserVectorIndex(user_id=user_id, dimension=self.embedder.dimension)

    def index_document_text(
        self,
        user_id: int,
        document_id: int,
        text_content: str,
        file_type: str = "txt"
    ) -> Tuple[int, int]:
        """
        Parses text, chunks it, generates embeddings, and saves into the user's FAISS index.
        Returns (chunks_created, total_vectors_in_index).

        If the FAISS index has a different dimension than the current embedder (e.g., Ollama
        came online), removes the stale index and rebuilds.
        """
        clean_text, _ = DocumentParser.parse_string(text_content, file_type=file_type)
        chunks = self.chunker.chunk_text(clean_text, document_id=document_id)

        if not chunks:
            return 0, 0

        texts = [c["text"] for c in chunks]
        vectors = self.embedder.encode_batch(texts)

        # Re-check dimension after encode (might have changed if Ollama just came up)
        actual_dim = vectors.shape[1] if vectors.ndim == 2 and vectors.shape[0] > 0 else self.embedder.dimension

        user_index = UserVectorIndex(user_id=user_id, dimension=actual_dim)

        # If existing index has wrong dimension, reset it
        if user_index.index.d != actual_dim:
            logger.warning(
                "FAISS index dimension mismatch for user %s: index=%d, embedder=%d. "
                "Rebuilding index.",
                user_id, user_index.index.d, actual_dim
            )
            import faiss
            user_index.index = faiss.IndexFlatIP(actual_dim)
            user_index.chunks_metadata = []

        user_index.add_chunks(chunks, vectors)

        logger.info(
            "Indexed %d chunks for user %s (doc_id=%s, backend=%s, dim=%d)",
            len(chunks), user_id, document_id, self.embedder.backend, actual_dim
        )
        return len(chunks), user_index.index.ntotal

    def query(self, user_id: int, query_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Searches the tenant's isolated vector index.
        Returns results with source attribution for audit logging.
        """
        user_index = self._get_user_index(user_id)
        if user_index.index.ntotal == 0:
            return []

        query_vec = self.embedder.encode(query_text)
        # Handle dimension mismatch (index built with different dim)
        if query_vec.shape[0] != user_index.index.d:
            logger.warning(
                "Query vector dimension %d != index dimension %d for user %s. "
                "Returning empty — index needs rebuild.",
                query_vec.shape[0], user_index.index.d, user_id
            )
            return []

        raw_results = user_index.search(query_vec, top_k=top_k)

        results = []
        for chunk_meta, score in raw_results:
            results.append({
                "chunk_id": chunk_meta.get("chunk_id", ""),
                "document_id": chunk_meta.get("document_id", 0),
                "text": chunk_meta.get("text", ""),
                "score": round(score, 4),
                "embedding_backend": self.embedder.backend,
            })

        if results:
            logger.debug(
                "RAG query '%s' (user=%s, backend=%s): %d results, top score=%.4f",
                query_text[:60], user_id, self.embedder.backend, len(results),
                results[0]["score"] if results else 0.0
            )
        return results

    # ------------------------------------------------------------------
    # Global product knowledge (partition user_0), versioned by content hash
    # ------------------------------------------------------------------

    PRODUCT_DOC_ID = 999999
    PRODUCT_DOC_CANDIDATES = [
        "docs/orbit-agent/product_context_rag.md",
        "docs/agentic-upgrade/PRODUCT_CONTEXT_RAG.md",
    ]

    def _product_doc_path(self) -> Optional[str]:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
        for rel in self.PRODUCT_DOC_CANDIDATES:
            for base in (repo_root, os.getcwd()):
                path = os.path.join(base, rel)
                if os.path.exists(path):
                    return path
        return None

    def _manifest_path(self, user_id: int) -> str:
        return os.path.join(settings.INDEX_DIR, f"user_{user_id}", "manifest.json")

    def _read_manifest(self, user_id: int) -> Dict[str, Any]:
        try:
            with open(self._manifest_path(user_id), "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def ensure_product_context_indexed(self, doc_path: str = None) -> int:
        """
        Index the product knowledge document into the user_0 partition. Re-indexes when the
        document content, embedding backend, or dimension changes. Returns total vectors.
        """
        doc_path = doc_path or self._product_doc_path()
        if not doc_path or not os.path.exists(doc_path):
            logger.warning("Product context document not found; product RAG is empty.")
            return 0

        with open(doc_path, "r", encoding="utf-8") as f:
            content = f.read()
        sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
        # Probe first so backend/dimension reflect what this query will use.
        self.embedder._ensure_ollama_ready()
        backend, dim = self.embedder.backend, self.embedder.dimension

        manifest = self._read_manifest(0)
        user_index = self._get_user_index(0)
        if (
            manifest.get("sha256") == sha
            and manifest.get("embedding_backend") == backend
            and user_index.index.ntotal > 0
            and user_index.index.d == dim
        ):
            return user_index.index.ntotal

        chunks = chunk_markdown_by_heading(content, document_id=self.PRODUCT_DOC_ID)
        vectors = self.embedder.encode_batch([c["text"] for c in chunks])
        actual_dim = vectors.shape[1] if vectors.ndim == 2 and vectors.shape[0] else dim

        fresh = UserVectorIndex(user_id=0, dimension=actual_dim)
        fresh.index = faiss.IndexFlatIP(actual_dim)
        fresh.chunks_metadata = []
        fresh.add_chunks(chunks, vectors)

        version = sha[:12]
        with open(self._manifest_path(0), "w", encoding="utf-8") as f:
            json.dump({
                "source": os.path.relpath(doc_path),
                "sha256": sha,
                "version": version,
                "embedding_backend": self.embedder.backend,
                "dimension": actual_dim,
                "chunks": len(chunks),
                "indexed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, f, indent=2)
        logger.info("Product context indexed: %d chunks, version=%s, backend=%s", len(chunks), version, self.embedder.backend)
        return fresh.index.ntotal

    def query_product_context(self, query_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Queries the global product knowledge base (user_id=0)."""
        self.ensure_product_context_indexed()
        return self.query(user_id=0, query_text=query_text, top_k=top_k)

    # ------------------------------------------------------------------
    # Agent retrieval: product docs + this user's knowledge base, hybrid scored
    # ------------------------------------------------------------------

    @staticmethod
    def _tokens(text: str) -> set:
        return {w for w in re.sub(r"[^\w\s]", " ", text.lower()).split() if len(w) > 2 and w not in _STOPWORDS}

    def _hybrid_search(self, user_id: int, query_text: str, query_vec, top_k: int) -> List[Dict[str, Any]]:
        idx = self._get_user_index(user_id)
        if idx.index.ntotal == 0 or query_vec.shape[0] != idx.index.d:
            return []
        candidates = idx.search(query_vec, top_k=max(top_k * 4, 12))
        q_tokens = self._tokens(query_text)
        scored, seen = [], set()
        for meta, vec_score in candidates:
            text = meta.get("text", "")
            key = hashlib.md5(text.strip().encode("utf-8")).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            c_tokens = self._tokens(text)
            lex = (len(q_tokens & c_tokens) / len(q_tokens)) if q_tokens else 0.0
            combined = 0.7 * float(vec_score) + 0.3 * lex
            scored.append({"meta": meta, "vector": float(vec_score), "lexical": lex, "score": combined})
        scored.sort(key=lambda r: r["score"], reverse=True)
        return scored[:top_k]

    def retrieve_for_agent(
        self,
        user_id: int,
        query_text: str,
        product_k: int = 3,
        user_k: int = 2,
        min_vector: float = 0.45,
        min_lexical: float = 0.2,
    ) -> Dict[str, Any]:
        """
        Tenant-scoped retrieval for Orbit. Only the product partition (user_0) and the
        requesting user's own partition are searched. A chunk is kept when it is either
        semantically close (vector) or shares enough query terms (lexical).
        """
        if user_id < 1:
            raise ValueError("retrieve_for_agent requires a real user id")
        self.ensure_product_context_indexed()
        query_vec = self.embedder.encode(query_text)
        semantic = self.embedder.backend != "lexical-fallback"

        chunks: List[Dict[str, Any]] = []
        for scope, uid, k in (("product", 0, product_k), ("user_kb", user_id, user_k)):
            for r in self._hybrid_search(uid, query_text, query_vec, k):
                if not ((semantic and r["vector"] >= min_vector) or r["lexical"] >= min_lexical):
                    continue
                meta = r["meta"]
                prefix = "product" if scope == "product" else f"kb:{meta.get('document_id', 0)}"
                chunks.append({
                    "source_id": f"{prefix}:{meta.get('chunk_id', '')}",
                    "scope": scope,
                    "text": meta.get("text", ""),
                    "score": round(r["score"], 4),
                    "heading": meta.get("heading"),
                })
        return {
            "chunks": chunks,
            "index_version": self._read_manifest(0).get("version"),
            "embedding_backend": self.embedder.backend,
        }

    def delete_document(self, user_id: int, document_id: int):
        user_index = self._get_user_index(user_id)
        user_index.remove_document(document_id=document_id)
rag_service = RAGService()


