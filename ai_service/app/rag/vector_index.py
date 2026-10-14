import os
import pickle
from typing import List, Dict, Any, Tuple
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

    def search(self, query_vector: np.ndarray, top_k: int = 3) -> List[Tuple[Dict[str, Any], float]]:
        if self.index.ntotal == 0:
            return []

        if query_vector.ndim == 1:
            query_vector = np.expand_dims(query_vector, axis=0)
        if query_vector.dtype != np.float32:
            query_vector = query_vector.astype(np.float32)

        k = min(top_k, self.index.ntotal)
        scores, indices = self.index.search(query_vector, k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx != -1 and idx < len(self.chunks_metadata):
                results.append((self.chunks_metadata[idx], float(score)))

        return results

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
