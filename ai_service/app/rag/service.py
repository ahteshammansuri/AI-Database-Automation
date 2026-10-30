import hashlib
import json
import logging
import os
import re
import time
from typing import List, Dict, Any, Optional, Tuple

import faiss
import numpy as np

from ai_service.app.config import settings
from ai_service.app.rag.document_parser import DocumentParser
from ai_service.app.rag.chunker import TextChunker, chunk_markdown_by_heading
from ai_service.app.rag.embeddings import EmbeddingService
from ai_service.app.rag.vector_cache import vector_cache
from ai_service.app.rag.vector_index import UserVectorIndex

logger = logging.getLogger(__name__)


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

        # Remove any existing chunks for this document to ensure idempotency and prevent duplicates
        user_index.remove_document(document_id)

        user_index.add_chunks(chunks, vectors)

        logger.info(
            "Indexed %d chunks for user %s (doc_id=%s, backend=%s, dim=%d)",
            len(chunks), user_id, document_id, self.embedder.backend, actual_dim
        )
        return len(chunks), user_index.index.ntotal

    @staticmethod
    def _lexical_similarity(query_text: str, chunk_text: str) -> float:
        """Calculate word-level overlap ratio between query keywords and candidate chunk."""
        words = re.findall(r"\b\w{3,}\b", query_text.lower())
        if not words:
            return 0.0
        c_lower = chunk_text.lower()
        matched = sum(1 for w in words if w in c_lower)
        return matched / len(words)

    def query(
        self,
        user_id: int,
        query_text: str,
        top_k: int = 3,
        document_ids: Optional[List[int]] = None,
        min_score: Optional[float] = None,
        hybrid: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Searches the tenant's isolated vector index with optional document filtering
        and hybrid semantic + lexical keyword re-ranking.
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

        # If document_ids is specified, request more candidates to allow post-ranking
        search_k = max(top_k * 3, 10) if (document_ids or hybrid) else top_k
        raw_results = user_index.search(query_vec, top_k=search_k, document_ids=document_ids)

        scored_results = []
        for chunk_meta, dense_score in raw_results:
            txt = chunk_meta.get("text", "")
            if hybrid:
                lex_score = self._lexical_similarity(query_text, txt)
                # Weighted hybrid: 75% dense vector cosine similarity + 25% lexical keyword boost
                final_score = float(0.75 * dense_score + 0.25 * lex_score)
            else:
                final_score = float(dense_score)

            if min_score is not None and final_score < min_score:
                continue

            scored_results.append({
                "chunk_id": chunk_meta.get("chunk_id", ""),
                "document_id": chunk_meta.get("document_id", 0),
                "text": txt,
                "score": round(final_score, 4),
                "dense_score": round(float(dense_score), 4),
                "embedding_backend": self.embedder.backend,
            })

        # Re-sort by hybrid score descending
        scored_results.sort(key=lambda x: x["score"], reverse=True)
        results = scored_results[:top_k]

        if results:
            logger.debug(
                "RAG query '%s' (user=%s, backend=%s, doc_filter=%s): %d results, top score=%.4f",
                query_text[:60], user_id, self.embedder.backend, document_ids, len(results),
                results[0]["score"] if results else 0.0
            )
        return results

    def get_user_status(self, user_id: int) -> Dict[str, Any]:
        """Return diagnostic metrics for user's vector index."""
        user_index = self._get_user_index(user_id)
        status = user_index.get_status()
        status["user_id"] = user_id
        status["backend"] = self.embedder.backend
        status["healthy"] = status["total_vectors"] > 0
        return status

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

    # No word lists of any language here: meaning comes from the embeddings, and the words people use (in any language)
    # belong in the knowledge itself, where the lexical part of the score finds them. When neither matches, the model
    # searches the knowledge with a query it writes (the search_orbit_knowledge tool).

    @classmethod
    def _tokens(cls, text: str) -> set:
        return {w for w in re.sub(r"[^\w\s]", " ", text.lower()).split() if len(w) > 2}

    @classmethod
    def _words(cls, text: str, min_len: int = 3) -> set:
        """Words for ranking, identifiers split too (refund_requests, user-id -> refund, request, user)."""
        return {cls._fold(w) for w in re.split(r"[^0-9a-z]+", text.lower().replace("_", " ")) if len(w) >= min_len}

    @staticmethod
    def _fold(token: str) -> str:
        """users/user, orders/order: one form for matching words (keeps "address", "status" whole)."""
        return token[:-1] if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")) else token

    def rank_texts(self, query_text: str, texts: List[str], top_k: int = 6, names: Optional[List[str]] = None,
                   min_margin: float = 0.10, min_lexical: float = 0.5) -> List[Tuple[int, float]]:
        """
        Indexes of the texts a request is about, best first; empty when none stands out. Both signals are relative to
        this set of texts, because embedding models give unrelated texts high similarities too:
        - meaning: how far a text's similarity to the request is above the median of all of them (min_margin);
        - words: the request's words found in what names each text (`names`, e.g. a table's name; else the text),
          weighted by how rare they are among them (IDF), so words every name shares count for nothing and a word
          only a few names have counts fully. A word match also needs at least average meaning.
        A text whose vector is still being embedded (vector_cache) counts by its words until it is ready.
        """
        if not texts or not query_text.strip():
            return []
        semantic = self.embedder.backend != "lexical-fallback"
        query_vec = self.embedder.encode(query_text) if semantic else None
        vectors = (vector_cache.vectors(texts, self.embedder.backend, self.embedder.encode_batch, query_vec.shape[0])
                   if semantic else [None] * len(texts))
        sims = [float(np.dot(query_vec, v)) if v is not None and v.shape == query_vec.shape else None for v in vectors]
        known = [x for x in sims if x is not None]
        median = float(np.median(known)) if len(known) >= 3 else None

        doc_tokens = [self._words(x, min_len=4) for x in (names if names and len(names) == len(texts) else texts)]
        n = len(texts)
        df: Dict[str, int] = {}
        for toks in doc_tokens:
            for t in toks:
                df[t] = df.get(t, 0) + 1
        idf = {t: float(np.log((n + 1) / (c + 0.5))) for t, c in df.items()}
        # Only words that tell texts apart: in the set at all, and in at most half of it (not its template).
        q_tokens = {t for t in self._words(query_text, min_len=4) if t in df and (n < 4 or df[t] <= n / 2)}
        q_weight = sum(idf[t] for t in q_tokens)

        scored = []
        for i, toks in enumerate(doc_tokens):
            # A name the message says in full ("users", "orders") always matches, however many other words it has
            # (words most names share, like a common prefix, do not need to be said).
            distinct = {t for t in toks if n < 4 or df[t] <= n / 2}
            named = bool(distinct) and distinct <= q_tokens
            lexical = 1.0 if named else ((sum(idf[t] for t in q_tokens & toks) / q_weight) if q_weight > 0 else 0.0)
            margin = (sims[i] - median) if sims[i] is not None and median is not None else 0.0
            if margin >= min_margin or (lexical >= min_lexical and (median is None or margin >= 0.0)):
                scored.append((i, 0.7 * margin + 0.3 * lexical))
        scored.sort(key=lambda r: r[1], reverse=True)
        return scored[:top_k]

    def _hybrid_search(self, user_id: int, query_text: str, query_vec, top_k: int) -> List[Dict[str, Any]]:
        idx = self._get_user_index(user_id)
        if idx.index.ntotal == 0 or query_vec.shape[0] != idx.index.d:
            return []
        candidates = idx.search(query_vec, top_k=max(top_k * 4, 12))
        q_tokens = self._tokens(query_text)
        scored, seen = [], set()
        for meta, vec_score in candidates:
            text = meta.get("text", "")
            heading = meta.get("heading", "")
            key = hashlib.md5((heading + ":" + text.strip()).encode("utf-8")).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            c_tokens = self._tokens(f"{heading} {text}")
            lex = (len(q_tokens & c_tokens) / len(q_tokens)) if q_tokens else 0.0
            combined = 0.7 * float(vec_score) + 0.3 * lex
            scored.append({"meta": meta, "vector": float(vec_score), "lexical": lex, "score": combined})
        scored.sort(key=lambda r: r["score"], reverse=True)
        return scored[:top_k]

    def retrieve_for_agent(
        self,
        user_id: int,
        query_text: str,
        product_k: int = 6,
        user_k: int = 3,
        min_vector: float = 0.25,
        min_lexical: float = 0.06,
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
            candidates = self._hybrid_search(uid, query_text, query_vec, k)
            kept = 0
            for r in candidates:
                if (semantic and r["vector"] >= min_vector) or r["lexical"] >= min_lexical:
                    meta = r["meta"]
                    source_id = f"product:{meta.get('source', 'guide')}:{meta.get('chunk_index', 0)}" if scope == "product" else f"kb:{meta.get('document_id', 0)}:{meta.get('chunk_id', '')}"
                    chunks.append({
                        "source_id": source_id,
                        "scope": scope,
                        "text": meta.get("text", ""),
                        "score": round(r["score"], 4),
                        "heading": meta.get("heading"),
                    })
                    kept += 1
            # If nothing passed the filter for this scope, keep the best candidate if it has reasonable score
            if kept == 0 and candidates and candidates[0]["score"] >= 0.22:
                best = candidates[0]
                meta = best["meta"]
                source_id = f"product:{meta.get('source', 'guide')}:{meta.get('chunk_index', 0)}" if scope == "product" else f"kb:{meta.get('document_id', 0)}:{meta.get('chunk_id', '')}"
                chunks.append({
                    "source_id": source_id,
                    "scope": scope,
                    "text": meta.get("text", ""),
                    "score": round(best["score"], 4),
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


