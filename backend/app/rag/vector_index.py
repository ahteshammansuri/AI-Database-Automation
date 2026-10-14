import os
import json
from typing import List, Dict, Any, Optional
import numpy as np
import faiss

from backend.app.rag.embeddings import EmbeddingService
from backend.app.config import settings


class FAISSVectorStore:
    """FAISS vector store managing chunk indexing and cosine similarity retrieval."""

    def __init__(self, dimension: int = 256):
        self.dimension = dimension
        self.embedder = EmbeddingService(dimension=dimension)
        self.index = faiss.IndexFlatIP(dimension)
        # Mapping from FAISS index position to chunk metadata
        self.chunk_metadata: List[Dict[str, Any]] = []

    def add_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        """
        Add chunks to the FAISS index.
        Each chunk dict should contain: 'chunk_id', 'document_id', 'document_title', 'content'.
        """
        if not chunks:
            return 0

        texts = [c["content"] for c in chunks]
        vectors = self.embedder.encode_batch(texts)

        # Add to FAISS index
        self.index.add(vectors)
        self.chunk_metadata.extend(chunks)
        return len(chunks)

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Search top_k most similar chunks for a query string."""
        if self.index.ntotal == 0 or not query.strip():
            return []

        top_k = min(top_k, self.index.ntotal)
        query_vec = self.embedder.encode(query).reshape(1, -1)

        distances, indices = self.index.search(query_vec, top_k)
        results: List[Dict[str, Any]] = []

        for score, idx in zip(distances[0], indices[0]):
            if idx == -1 or idx >= len(self.chunk_metadata):
                continue
            meta = self.chunk_metadata[idx]
            results.append({
                "chunk_id": meta.get("chunk_id"),
                "document_id": meta.get("document_id"),
                "document_title": meta.get("document_title"),
                "content": meta.get("content"),
                "similarity_score": round(float(score), 4)
            })

        return results

    def reset(self):
        """Reset index and clear all indexed chunks."""
        self.index = faiss.IndexFlatIP(self.dimension)
        self.chunk_metadata = []

    def count(self) -> int:
        return self.index.ntotal


# Singleton vector store instance for platform runtime
vector_store = FAISSVectorStore()
