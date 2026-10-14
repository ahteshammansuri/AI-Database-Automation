import hashlib
import re
import numpy as np
from typing import List


class EmbeddingService:
    """
    Lightweight, deterministic local dense embedding generator.
    Projects lexical, subword, and semantic n-gram representations into a normalized 256-d space.
    Cosine similarity is computed via dot product on unit-normalized vectors.
    """

    def __init__(self, dimension: int = 256):
        self.dimension = dimension

    def encode(self, text: str) -> np.ndarray:
        tokens = self._tokenize(text)
        vec = np.zeros(self.dimension, dtype=np.float32)

        if not tokens:
            return vec

        for token in tokens:
            h_val = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
            idx = h_val % self.dimension
            sign = 1.0 if ((h_val >> 8) & 1) else -1.0
            vec[idx] += sign

            if len(token) >= 3:
                for i in range(len(token) - 2):
                    tri = token[i:i+3]
                    tri_hash = int(hashlib.md5(tri.encode("utf-8")).hexdigest(), 16)
                    tri_idx = tri_hash % self.dimension
                    tri_sign = 0.5 if ((tri_hash >> 8) & 1) else -0.5
                    vec[tri_idx] += tri_sign

        norm = np.linalg.norm(vec)
        if norm > 1e-6:
            vec = vec / norm
        return vec

    def encode_batch(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        vectors = [self.encode(t) for t in texts]
        return np.vstack(vectors).astype(np.float32)

    def _tokenize(self, text: str) -> List[str]:
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        return [w for w in cleaned.split() if len(w) > 1]
