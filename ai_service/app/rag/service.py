import logging
from typing import List, Dict, Any, Tuple
from ai_service.app.rag.document_parser import DocumentParser
from ai_service.app.rag.chunker import TextChunker
from ai_service.app.rag.embeddings import EmbeddingService
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

    def ensure_product_context_indexed(self, doc_path: str = None) -> int:
        """
        Indexes the global product documentation into user_id=0 partition if not already indexed.
        """
        import os
        if not doc_path:
            candidates = [
                os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../docs/agentic-upgrade/PRODUCT_CONTEXT_RAG.md")),
                os.path.abspath("docs/agentic-upgrade/PRODUCT_CONTEXT_RAG.md"),
            ]
            for c in candidates:
                if os.path.exists(c):
                    doc_path = c
                    break

        if not doc_path or not os.path.exists(doc_path):
            return 0

        user_index = self._get_user_index(0)
        if user_index.index.ntotal > 0 and user_index.index.d == self.embedder.dimension:
            return user_index.index.ntotal

        with open(doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        chunks_created, total = self.index_document_text(
            user_id=0,
            document_id=999999,
            text_content=content,
            file_type="txt"
        )
        logger.info(
            "Product context indexed: %d chunks, %d total vectors (backend=%s)",
            chunks_created, total, self.embedder.backend
        )
        return total

    def query_product_context(self, query_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Queries the global product knowledge base (user_id=0)."""
        self.ensure_product_context_indexed()
        return self.query(user_id=0, query_text=query_text, top_k=top_k)

    def delete_document(self, user_id: int, document_id: int):
        user_index = self._get_user_index(user_id)
        user_index.remove_document(document_id=document_id)
rag_service = RAGService()


