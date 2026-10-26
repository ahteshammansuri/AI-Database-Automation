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

    PRODUCT_DOC_BASE_ID = 999000

    # Product knowledge comes only from the admin panel (Laravel stores the guides in its database and publishes
    # them here). Nothing is read from Markdown files; older versions kept published guides in this folder.
    def _legacy_guide_dir(self) -> str:
        return os.path.join(os.path.dirname(os.path.abspath(settings.INDEX_DIR)), "product_guides")

    def _remove_legacy_guide_files(self) -> None:
        folder = self._legacy_guide_dir()
        if not os.path.isdir(folder):
            return
        for f in os.listdir(folder):
            if f.endswith(".md"):
                os.remove(os.path.join(folder, f))
        try:
            os.rmdir(folder)
        except OSError:
            pass

    def publish_product_guides(self, guides: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Replace Orbit's product knowledge with the guides an admin published (name, title, content) and index them.
        Names are slugs; anything else is refused. An empty list leaves Orbit without product knowledge.
        """
        docs: List[Tuple[str, str, str]] = []
        seen = set()
        for g in guides:
            name = str(g.get("name", "")).strip()
            if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,80}", name):
                raise ValueError(f"Invalid guide name: {name!r}")
            if name in seen:
                raise ValueError(f"Guide {name!r} was sent twice")
            seen.add(name)
            content = str(g.get("content", "")).strip()
            title = str(g.get("title", "")).strip() or name
            if not content.startswith("# "):
                content = f"# {title}\n\n{content}"
            docs.append((name, title, content + "\n"))
        self._index_product_guides(docs)
        self._remove_legacy_guide_files()
        manifest = self._read_manifest(0)
        return {
            "guides": len(docs),
            "vectors": self._get_user_index(0).index.ntotal,
            "chunks": manifest.get("chunks", 0),
            "version": manifest.get("version"),
            "indexed_at": manifest.get("indexed_at"),
            "embedding_backend": manifest.get("embedding_backend"),
            "source": "published" if docs else "none",
        }

    def product_guides_status(self) -> Dict[str, Any]:
        manifest = self._read_manifest(0)
        chunks = int(manifest.get("chunks", 0) or 0)
        return {
            "source": "published" if chunks else "none",
            "guides": len(manifest.get("guides") or []) if chunks else 0,
            "chunks": chunks,
            "version": manifest.get("version"),
            "indexed_at": manifest.get("indexed_at"),
            "embedding_backend": manifest.get("embedding_backend"),
        }

    def _manifest_path(self, user_id: int) -> str:
        return os.path.join(settings.INDEX_DIR, f"user_{user_id}", "manifest.json")

    def _read_manifest(self, user_id: int) -> Dict[str, Any]:
        try:
            with open(self._manifest_path(user_id), "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _index_product_guides(self, docs: List[Tuple[str, str, str]]) -> int:
        """Chunk, embed and store (name, title, content) guides in the product partition (user 0); returns vectors."""
        digest = hashlib.sha256()
        for name, _, content in docs:
            digest.update(name.encode("utf-8") + b"\0" + content.encode("utf-8") + b"\0")
        sha = digest.hexdigest()

        self.embedder._ensure_ollama_ready()
        chunks: List[Dict[str, Any]] = []
        for i, (name, title, content) in enumerate(docs):
            for c in chunk_markdown_by_heading(content, document_id=self.PRODUCT_DOC_BASE_ID + i):
                c["source"] = name
                c["heading"] = f"{title} › {c['heading']}" if c.get("heading") and c["heading"] != title else title
                chunks.append(c)
        return self._store_product_chunks(chunks, sha, [{"name": n, "title": t} for n, t, _ in docs])

    def _store_product_chunks(self, chunks: List[Dict[str, Any]], sha: str, guides: List[Dict[str, str]]) -> int:
        dim = self.embedder.dimension
        if chunks:
            vectors = self.embedder.encode_batch([c["text"] for c in chunks])
            dim = vectors.shape[1] if vectors.ndim == 2 and vectors.shape[0] else dim
        fresh = UserVectorIndex(user_id=0, dimension=dim)
        fresh.index = faiss.IndexFlatIP(dim)
        fresh.chunks_metadata = []
        if chunks:
            fresh.add_chunks(chunks, vectors)
        else:
            fresh._save()

        version = sha[:12]
        with open(self._manifest_path(0), "w", encoding="utf-8") as f:
            json.dump({
                "guides": guides,
                "sha256": sha,
                "version": version,
                "embedding_backend": self.embedder.backend,
                "dimension": dim,
                "chunks": len(chunks),
                "indexed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, f, indent=2)
        logger.info("Product guides indexed: %d guides, %d chunks, version=%s, backend=%s",
                    len(guides), len(chunks), version, self.embedder.backend)
        return fresh.index.ntotal

    def ensure_product_context_indexed(self) -> int:
        """
        Product guides as published from the admin panel. When the embedding backend or dimension changed since they
        were indexed (for example Ollama became reachable), they are re-embedded from the stored sections.
        Returns the number of vectors (0 until an admin publishes guides).
        """
        manifest = self._read_manifest(0)
        if not manifest.get("chunks"):
            return 0
        self.embedder._ensure_ollama_ready()
        backend, dim = self.embedder.backend, self.embedder.dimension
        stored = UserVectorIndex(user_id=0, dimension=int(manifest.get("dimension") or dim))
        if manifest.get("embedding_backend") == backend and stored.index.ntotal > 0 and stored.index.d == dim:
            return stored.index.ntotal
        chunks = [dict(c) for c in stored.chunks_metadata]
        if not chunks:
            return 0
        return self._store_product_chunks(chunks, str(manifest.get("sha256") or ""), list(manifest.get("guides") or []))

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
        product_k: int = 4,
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
                if scope == "product":
                    source_id = f"product:{meta.get('source', 'guide')}:{meta.get('chunk_index', 0)}"
                else:
                    source_id = f"kb:{meta.get('document_id', 0)}:{meta.get('chunk_id', '')}"
                chunks.append({
                    "source_id": source_id,
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


