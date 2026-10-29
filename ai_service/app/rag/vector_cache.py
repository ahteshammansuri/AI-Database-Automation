"""
Vectors of texts that arrive with requests (descriptions of the user's tables, portal surfaces and pages), embedded
once and kept on disk by content hash, so ranking never waits on the embedding model for a text it has seen before.

On a CPU the embedding model takes about 0.2 s per text whether texts are sent one by one or in a batch, so a large set
of new texts (a newly scanned database) is embedded by one background thread; until then those texts are ranked by
their words alone. A few new texts are embedded right away.
"""
import hashlib
import logging
import os
import pickle
import re
import threading
from collections import OrderedDict
from typing import Callable, List, Optional, Sequence, Tuple

import numpy as np

from ai_service.app.config import settings

logger = logging.getLogger(__name__)

INLINE_MAX = 16
MAX_ITEMS = 20000
BATCH = 16

Encoder = Callable[[List[str]], np.ndarray]


class VectorCache:
    def __init__(self, max_items: int = MAX_ITEMS):
        self._items: "OrderedDict[str, np.ndarray]" = OrderedDict()
        self._queue: "OrderedDict[str, Tuple[str, str, int]]" = OrderedDict()  # key -> (backend, text, dimension)
        self._loaded: set = set()
        self._lock = threading.Lock()
        self._worker: Optional[threading.Thread] = None
        self._max = max_items

    @staticmethod
    def key(backend: str, text: str) -> str:
        return f"{backend}:{hashlib.sha1(text.encode('utf-8')).hexdigest()}"

    def vectors(self, texts: Sequence[str], backend: str, encode_batch: Encoder, dimension: int) -> List[Optional[np.ndarray]]:
        """The vector of each text, or None while it is still being embedded in the background."""
        keys = [self.key(backend, t) for t in texts]
        with self._lock:
            self._load(backend)
            missing = {k: t for k, t in zip(keys, texts) if k not in self._items}
        if missing and len(missing) <= INLINE_MAX:
            self._store(backend, list(missing.items()), encode_batch, dimension)
        elif missing:
            self._enqueue(backend, missing, encode_batch, dimension)
        with self._lock:
            out = []
            for k in keys:
                vec = self._items.get(k)
                if vec is not None:
                    self._items.move_to_end(k)
                out.append(vec)
            return out

    def pending(self) -> int:
        with self._lock:
            return len(self._queue)

    # ------------------------------------------------------------------

    def _store(self, backend: str, items: List[Tuple[str, str]], encode_batch: Encoder, dimension: int, save: bool = True) -> None:
        try:
            vecs = encode_batch([t for _, t in items])
        except Exception as e:  # the embedding model is down: these texts stay word-ranked for now
            logger.warning("Embedding %d text(s) failed: %s", len(items), type(e).__name__)
            return
        if vecs.ndim != 2 or vecs.shape[0] != len(items) or vecs.shape[1] != dimension:
            return  # the backend changed while embedding (e.g. Ollama went down): never mix dimensions
        with self._lock:
            for (k, _), vec in zip(items, vecs):
                self._items[k] = vec.astype(np.float32)
            while len(self._items) > self._max:
                self._items.popitem(last=False)
            if save:
                self._save(backend)

    def _enqueue(self, backend: str, missing: dict, encode_batch: Encoder, dimension: int) -> None:
        with self._lock:
            for k, t in missing.items():
                self._queue.setdefault(k, (backend, t, dimension))
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._drain, args=(encode_batch,), name="vector-cache", daemon=True)
                self._worker.start()

    def _drain(self, encode_batch: Encoder) -> None:
        stored = set()
        while True:
            with self._lock:
                batch = [self._queue.popitem(last=False) for _ in range(min(BATCH, len(self._queue)))]
                if not batch:
                    for backend in stored:  # once, when everything queued is embedded
                        self._save(backend)
                    return
            by_backend = {}
            for k, (backend, text, dimension) in batch:
                by_backend.setdefault((backend, dimension), []).append((k, text))
            for (backend, dimension), items in by_backend.items():
                self._store(backend, items, encode_batch, dimension, save=False)
                stored.add(backend)

    def _path(self, backend: str) -> str:
        return os.path.join(settings.INDEX_DIR, "_cache", f"vectors_{re.sub(r'[^A-Za-z0-9_.-]', '_', backend)}.pkl")

    def _load(self, backend: str) -> None:
        """Read the vectors kept on disk for this embedding backend (once per process; caller holds the lock)."""
        if backend in self._loaded:
            return
        self._loaded.add(backend)
        try:
            with open(self._path(backend), "rb") as f:
                stored = pickle.load(f)
        except (OSError, EOFError, pickle.UnpicklingError, ValueError):
            return
        for k, vec in stored.items():
            if isinstance(k, str) and isinstance(vec, np.ndarray):
                self._items.setdefault(k, vec)

    def _save(self, backend: str) -> None:
        """Keep this backend's vectors on disk (caller holds the lock); a failure only costs re-embedding later."""
        prefix = backend + ":"
        path = self._path(backend)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "wb") as f:
                pickle.dump({k: v for k, v in self._items.items() if k.startswith(prefix)}, f, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp, path)
        except OSError as e:
            logger.warning("Could not keep embedded vectors on disk: %s", e)


vector_cache = VectorCache()
