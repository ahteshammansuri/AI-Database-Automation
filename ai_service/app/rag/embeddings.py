import hashlib
import re
import time
import numpy as np
from typing import List, Optional
try:
    import httpx as _httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False

# ---------------------------------------------------------------------------
# Ollama embedding dimension for nomic-embed-text (768) and bge-m3 (1024).
# We auto-probe on first use and cache the result.
# ---------------------------------------------------------------------------
_OLLAMA_EMBED_DIM_CACHE: Optional[int] = None
_OLLAMA_AVAILABLE_CACHE: Optional[bool] = None
_OLLAMA_PROBE_TS: float = 0.0
_PROBE_TTL: float = 60.0   # re-probe at most once per minute


def _probe_ollama_embed(base_url: str, model: str, timeout: float = 4.0):
    """
    Attempt one embedding call to find dimension and availability.
    Returns (available: bool, dimension: int).
    """
    global _OLLAMA_EMBED_DIM_CACHE, _OLLAMA_AVAILABLE_CACHE, _OLLAMA_PROBE_TS
    now = time.monotonic()
    if now - _OLLAMA_PROBE_TS < _PROBE_TTL and _OLLAMA_AVAILABLE_CACHE is not None:
        return _OLLAMA_AVAILABLE_CACHE, (_OLLAMA_EMBED_DIM_CACHE or 768)

    _OLLAMA_PROBE_TS = now
    if not _HTTPX_AVAILABLE:
        _OLLAMA_AVAILABLE_CACHE = False
        return False, 256

    try:
        with _httpx.Client(timeout=timeout) as client:
            res = client.post(
                f"{base_url}/api/embeddings",
                json={"model": model, "prompt": "probe"},
            )
            if res.status_code == 200:
                vec = res.json().get("embedding", [])
                dim = len(vec)
                if dim > 0:
                    _OLLAMA_EMBED_DIM_CACHE = dim
                    _OLLAMA_AVAILABLE_CACHE = True
                    return True, dim
    except Exception:
        pass

    _OLLAMA_AVAILABLE_CACHE = False
    return False, 256


class EmbeddingService:
    """
    Semantic embedding service.

    Primary path: Ollama /api/embeddings with a configurable model
    (default: nomic-embed-text, 768-dim; bge-m3, 1024-dim also supported).

    Fallback path (when Ollama is offline or model unavailable): deterministic
    hash-projection encoding — dimension 256 — for backwards compatibility
    and offline development.

    The dimension is determined on first use based on which path is active.
    """

    # Default Ollama embedding model preferences (tried in order)
    _EMBED_MODELS = ["nomic-embed-text", "bge-m3", "nomic-embed-text:latest"]

    def __init__(self, dimension: int = 256, ollama_base_url: str = None, embed_model: str = None):
        from ai_service.app.config import settings
        self._ollama_base_url = (ollama_base_url or settings.OLLAMA_BASE_URL).rstrip("/")
        self._embed_model = embed_model or "nomic-embed-text"
        self._hash_dimension = dimension  # used by fallback

        # Probe Ollama on init; dimension will be set accordingly
        available, dim = _probe_ollama_embed(self._ollama_base_url, self._embed_model)
        self._ollama_ok = available
        self.dimension = dim if available else self._hash_dimension

    def _ensure_ollama_ready(self) -> bool:
        """Re-probe if cache has expired."""
        available, dim = _probe_ollama_embed(self._ollama_base_url, self._embed_model)
        if available and dim != self.dimension:
            # Dimension changed (e.g. model swapped) — caller must handle re-indexing
            self.dimension = dim
        self._ollama_ok = available
        return available

    def encode(self, text: str) -> np.ndarray:
        if self._ensure_ollama_ready():
            try:
                return self._ollama_encode(text)
            except Exception:
                pass
        return self._hash_encode(text)

    def encode_batch(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        if self._ensure_ollama_ready():
            try:
                return self._ollama_encode_batch(texts)
            except Exception:
                pass
        vectors = [self._hash_encode(t) for t in texts]
        return np.vstack(vectors).astype(np.float32)

    # ------------------------------------------------------------------
    # Ollama backend
    # ------------------------------------------------------------------

    def _ollama_encode(self, text: str) -> np.ndarray:
        with _httpx.Client(timeout=30.0) as client:
            res = client.post(
                f"{self._ollama_base_url}/api/embeddings",
                json={"model": self._embed_model, "prompt": text},
            )
            if res.status_code != 200:
                raise RuntimeError(f"Ollama embeddings returned {res.status_code}: {res.text[:200]}")
            vec = np.array(res.json()["embedding"], dtype=np.float32)
            norm = np.linalg.norm(vec)
            if norm > 1e-6:
                vec = vec / norm
            return vec

    def _ollama_encode_batch(self, texts: List[str]) -> np.ndarray:
        """Batch encode via sequential Ollama calls (Ollama doesn't have a native batch endpoint)."""
        vectors = []
        with _httpx.Client(timeout=30.0) as client:
            for text in texts:
                res = client.post(
                    f"{self._ollama_base_url}/api/embeddings",
                    json={"model": self._embed_model, "prompt": text},
                )
                if res.status_code != 200:
                    raise RuntimeError(f"Ollama embeddings returned {res.status_code}")
                vec = np.array(res.json()["embedding"], dtype=np.float32)
                norm = np.linalg.norm(vec)
                if norm > 1e-6:
                    vec = vec / norm
                vectors.append(vec)
        return np.vstack(vectors).astype(np.float32)

    # ------------------------------------------------------------------
    # Hash-projection fallback (deterministic, dimension=self._hash_dimension)
    # ------------------------------------------------------------------

    def _hash_encode(self, text: str) -> np.ndarray:
        dim = self._hash_dimension
        tokens = self._tokenize(text)
        vec = np.zeros(dim, dtype=np.float32)

        if not tokens:
            return vec

        for token in tokens:
            h_val = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
            idx = h_val % dim
            sign = 1.0 if ((h_val >> 8) & 1) else -1.0
            vec[idx] += sign

            if len(token) >= 3:
                for i in range(len(token) - 2):
                    tri = token[i:i+3]
                    tri_hash = int(hashlib.md5(tri.encode("utf-8")).hexdigest(), 16)
                    tri_idx = tri_hash % dim
                    tri_sign = 0.5 if ((tri_hash >> 8) & 1) else -0.5
                    vec[tri_idx] += tri_sign

        norm = np.linalg.norm(vec)
        if norm > 1e-6:
            vec = vec / norm
        return vec

    def _tokenize(self, text: str) -> List[str]:
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        return [w for w in cleaned.split() if len(w) > 1]

    # ------------------------------------------------------------------
    # Info
    # ------------------------------------------------------------------

    @property
    def backend(self) -> str:
        # "lexical-fallback" is token-hash retrieval, not semantic embeddings; report it honestly.
        return f"ollama:{self._embed_model}" if self._ollama_ok else "lexical-fallback"
