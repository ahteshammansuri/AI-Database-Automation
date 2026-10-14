from typing import List, Dict, Any, Tuple
from ai_service.app.rag.document_parser import DocumentParser
from ai_service.app.rag.chunker import TextChunker
from ai_service.app.rag.embeddings import EmbeddingService
from ai_service.app.rag.vector_index import UserVectorIndex


class RAGService:
    """Orchestrates document ingestion, chunking, embeddings, and semantic search."""

    def __init__(self):
        self.chunker = TextChunker(chunk_size=400, chunk_overlap=80)
        self.embedder = EmbeddingService(dimension=256)

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
        """
        clean_text, _ = DocumentParser.parse_string(text_content, file_type=file_type)
        chunks = self.chunker.chunk_text(clean_text, document_id=document_id)

        if not chunks:
            return 0, 0

        texts = [c["text"] for c in chunks]
        vectors = self.embedder.encode_batch(texts)

        user_index = UserVectorIndex(user_id=user_id, dimension=self.embedder.dimension)
        user_index.add_chunks(chunks, vectors)

        return len(chunks), user_index.index.ntotal

    def query(self, user_id: int, query_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Searches the tenant's isolated vector index."""
        user_index = UserVectorIndex(user_id=user_id, dimension=self.embedder.dimension)
        query_vec = self.embedder.encode(query_text)
        raw_results = user_index.search(query_vec, top_k=top_k)

        results = []
        for chunk_meta, score in raw_results:
            results.append({
                "chunk_id": chunk_meta.get("chunk_id", ""),
                "document_id": chunk_meta.get("document_id", 0),
                "text": chunk_meta.get("text", ""),
                "score": round(score, 4)
            })
        return results

    def ensure_product_context_indexed(self, doc_path: str = None) -> int:
        """
        Indexes the global product documentation into user_id=0 partition if not already indexed.
        """
        import os
        if not doc_path:
            # Look in standard locations
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

        user_index = UserVectorIndex(user_id=0, dimension=self.embedder.dimension)
        if user_index.index.ntotal > 0:
            return user_index.index.ntotal

        with open(doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        chunks_created, total = self.index_document_text(
            user_id=0,
            document_id=999999,
            text_content=content,
            file_type="txt"
        )
        return total

    def query_product_context(self, query_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Queries the global product knowledge base (user_id=0)."""
        self.ensure_product_context_indexed()
        return self.query(user_id=0, query_text=query_text, top_k=top_k)

    def delete_document(self, user_id: int, document_id: int):
        user_index = UserVectorIndex(user_id=user_id, dimension=self.embedder.dimension)
        user_index.remove_document(document_id=document_id)


rag_service = RAGService()

