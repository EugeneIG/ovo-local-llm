# [START] Phase 6.4 — Local embedding runner.
# Wraps a sentence-transformers model (multilingual MiniLM by default) so the
# OVO frontend can compute vectors locally for semantic search over the Wiki.
# - Single-slot tenancy (same pattern as MlxRunner): loading a different model
#   unloads the previous one.
# - CPU inference by default; the frontend never blocks on first-use cost
#   because the endpoint is intentionally pull-based (no auto-load on startup).
# - Graceful degradation: if `sentence-transformers` is unavailable, /ovo/embed
#   returns HTTP 501 so the caller can fall back to FTS-only search.

import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@dataclass
class LoadedEmbeddingModel:
    ref: str
    model: object  # SentenceTransformer instance
    dim: int


class EmbeddingRunner:
    """Thread-safe lazy loader + batch encoder for sentence-transformer models."""

    def __init__(self) -> None:
        self._loaded: LoadedEmbeddingModel | None = None
        self._load_lock = asyncio.Lock()
        from ovo_sidecar import model_lifecycle

        model_lifecycle.register_unloader(self.unload, slot="embedding")

    def unload(self) -> None:
        if self._loaded is None:
            return
        from ovo_sidecar import model_lifecycle

        logger.info("unloading embedding model: %s", self._loaded.ref)
        self._loaded = None
        model_lifecycle.release_gpu_memory()

    async def ensure_loaded(self, model_ref: str) -> LoadedEmbeddingModel:
        async with self._load_lock:
            if self._loaded is not None and self._loaded.ref == model_ref:
                return self._loaded
            self.unload()
            loaded = await asyncio.to_thread(self._load, model_ref)
            self._loaded = loaded
            return loaded

    def _load(self, ref: str) -> LoadedEmbeddingModel:
        try:
            # Lazy import so the sidecar can start even when ST is missing;
            # only embedding-dependent flows raise.
            from sentence_transformers import SentenceTransformer  # type: ignore
        except ImportError as e:  # pragma: no cover — sidecar optional dep
            raise RuntimeError(
                "sentence-transformers is not installed. Add it to the sidecar "
                "venv (e.g. `uv pip install sentence-transformers`) and retry."
            ) from e

        logger.info("loading embedding model: %s", ref)
        model = SentenceTransformer(ref)
        dim = int(model.get_sentence_embedding_dimension() or 0)
        if dim <= 0:
            # Fall back to probing a tiny encode call — some STs defer dim.
            sample = model.encode(["ping"], normalize_embeddings=True)
            dim = int(getattr(sample, "shape", [0, 0])[-1])
        return LoadedEmbeddingModel(ref=ref, model=model, dim=dim)

    async def encode(
        self,
        texts: list[str],
        model_ref: str | None = None,
        normalize: bool = True,
    ) -> tuple[list[list[float]], str, int]:
        """Return (embeddings, model_ref, dim). Empty-string inputs keep their
        slot in the output so the caller can zip results back to ids."""
        ref = model_ref or DEFAULT_EMBEDDING_MODEL
        loaded = await self.ensure_loaded(ref)
        if not texts:
            return [], ref, loaded.dim

        def _run() -> list[list[float]]:
            # SentenceTransformer.encode handles batching internally.
            raw = loaded.model.encode(
                texts,
                normalize_embeddings=normalize,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            # Shape is (n, dim); cast to plain Python floats for JSON.
            return [[float(x) for x in vec] for vec in raw]

        vectors = await asyncio.to_thread(_run)
        return vectors, ref, loaded.dim


embedding_runner = EmbeddingRunner()
# [END] Phase 6.4
