import os
import re
import zlib

import numpy as np
import pytest

# The placeholder "mock" provider is refused in the product; the automated tests use it to script model answers.
os.environ.setdefault("AI_ALLOW_MOCK_PROVIDER", "1")


class WordEmbedder:
    """Stand-in for the embedding model in tests: texts that share words are similar (no Ollama needed)."""
    backend = "test:words"
    dimension = 4096

    def encode(self, text):
        v = np.zeros(self.dimension, dtype=np.float32)
        for w in re.findall(r"[a-z0-9]+", text.lower()):
            if len(w) > 2:
                v[zlib.crc32(w.encode()) % self.dimension] += 1.0
        n = np.linalg.norm(v)
        return v / n if n else v

    def encode_batch(self, texts):
        return np.vstack([self.encode(t) for t in texts]) if texts else np.empty((0, self.dimension), dtype=np.float32)


@pytest.fixture
def words(monkeypatch, tmp_path):
    """Retrieval with the word embedder, a fresh vector cache and a temporary index folder."""
    from ai_service.app.config import settings
    from ai_service.app.rag import service as rag_module
    from ai_service.app.rag.vector_cache import VectorCache

    monkeypatch.setattr(settings, "INDEX_DIR", str(tmp_path))
    monkeypatch.setattr(rag_module.rag_service, "embedder", WordEmbedder())
    monkeypatch.setattr(rag_module, "vector_cache", VectorCache())
