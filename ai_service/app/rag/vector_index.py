import os
import pickle
from typing import List, Dict, Any, Tuple, Optional
import numpy as np
import faiss
from ai_service.app.config import settings


class UserVectorIndex:
    """FAISS vector store partitioned per-user/tenant."""

    def __init__(self, user_id: int, dimension: int = 256):
        self.user_id = user_id
        self.dimension = dimension
        self.user_dir = os.path.join(settings.INDEX_DIR, f"user_{user_id}")
        os.makedirs(self.user_dir, exist_ok=True)
        self.index_file = os.path.join(self.user_dir, "faiss.index")
        self.meta_file = os.path.join(self.user_dir, "metadata.pkl")

        self.index: faiss.IndexFlatIP = faiss.IndexFlatIP(dimension)
        self.chunks_metadata: List[Dict[str, Any]] = []
        self._load()

    def add_chunks(self, chunks: List[Dict[str, Any]], vectors: np.ndarray):
        if len(chunks) == 0:
            return

        if vectors.dtype != np.float32:
            vectors = vectors.astype(np.float32)

        self.index.add(vectors)
        self.chunks_metadata.extend(chunks)
        self._save()

    def search(
        self,
        query_vector: np.ndarray,
        top_k: int = 3,
        document_ids: Optional[List[int]] = None
    ) -> List[Tuple[Dict[str, Any], float]]:
        if self.index.ntotal == 0:
            return []

        if query_vector.ndim == 1:
            query_vector = np.expand_dims(query_vector, axis=0)
        if query_vector.dtype != np.float32:
            query_vector = query_vector.astype(np.float32)

        target_doc_ids = set(int(d) for d in document_ids) if document_ids else None

        # If filtering by specific document IDs, retrieve more candidates from FAISS to ensure
        # matches from target documents are found
        candidate_k = min(self.index.ntotal, max(top_k * 10, 200)) if target_doc_ids else min(top_k, self.index.ntotal)
        scores, indices = self.index.search(query_vector, candidate_k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx != -1 and idx < len(self.chunks_metadata):
                chunk = self.chunks_metadata[idx]
                if target_doc_ids is not None:
                    chunk_doc_id = chunk.get("document_id")
                    if chunk_doc_id is None or int(chunk_doc_id) not in target_doc_ids:
                        continue
                results.append((chunk, float(score)))
                if len(results) >= top_k:
                    break

        return results

    def get_status(self) -> Dict[str, Any]:
        """Return diagnostic metrics about indexed documents and vectors."""
        doc_ids = set()
        chunk_counts: Dict[str, int] = {}
        for chunk in self.chunks_metadata:
            doc_id = chunk.get("document_id")
            if doc_id is not None:
                doc_ids.add(int(doc_id))
                k = str(doc_id)
                chunk_counts[k] = chunk_counts.get(k, 0) + 1
        return {
            "total_vectors": self.index.ntotal,
            "dimension": self.dimension,
            "document_ids": sorted(list(doc_ids)),
            "chunk_counts": chunk_counts,
        }

    def remove_document(self, document_id: int):
        new_meta = []
        remaining_indices = []

        for idx, chunk in enumerate(self.chunks_metadata):
            if chunk.get("document_id") != document_id:
                new_meta.append(chunk)
                remaining_indices.append(idx)

        if len(new_meta) == len(self.chunks_metadata):
            return

        # Rebuild index with remaining vectors if any
        if remaining_indices and self.index.ntotal > 0:
            all_vecs = np.zeros((self.index.ntotal, self.dimension), dtype=np.float32)
            for i in range(self.index.ntotal):
                all_vecs[i] = self.index.reconstruct(i)

            kept_vecs = all_vecs[remaining_indices]
            new_index = faiss.IndexFlatIP(self.dimension)
            new_index.add(kept_vecs)
            self.index = new_index
            self.chunks_metadata = new_meta
        else:
            self.index = faiss.IndexFlatIP(self.dimension)
            self.chunks_metadata = []

        self._save()

    def _save(self):
        faiss.write_index(self.index, self.index_file)
        with open(self.meta_file, "wb") as f:
            pickle.dump(self.chunks_metadata, f)

    def _load(self):
        if os.path.exists(self.index_file) and os.path.exists(self.meta_file):
            try:
                self.index = faiss.read_index(self.index_file)
                with open(self.meta_file, "rb") as f:
                    self.chunks_metadata = pickle.load(f)
            except Exception:
                self.index = faiss.IndexFlatIP(self.dimension)
                self.chunks_metadata = []
