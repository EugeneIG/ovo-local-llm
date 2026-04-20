# [START] Phase 8 — Whisper STT runner.
# Wraps mlx-whisper (optional dep) to transcribe audio locally on Apple Silicon.
# If mlx-whisper is not installed every transcribe() call raises RuntimeError
# so the API layer can return HTTP 501 with a friendly install hint.
import asyncio
import base64
import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_WHISPER_MODEL = "mlx-community/whisper-small-mlx"


class WhisperRunner:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()

    async def transcribe(
        self,
        audio_b64: str,
        audio_format: str = "webm",
        model_repo: str = DEFAULT_WHISPER_MODEL,
    ) -> str:
        """Decode base64 audio → temp file → mlx_whisper.transcribe → text.
        Runs in a thread executor so the event loop stays unblocked."""
        async with self._lock:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                self._transcribe_sync,
                audio_b64,
                audio_format,
                model_repo,
            )

    def _transcribe_sync(
        self, audio_b64: str, audio_format: str, model_repo: str
    ) -> str:
        try:
            import mlx_whisper  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "mlx-whisper is not installed. Run: pip install mlx-whisper"
            ) from exc

        audio_bytes = base64.b64decode(audio_b64)
        suffix = f".{audio_format.lstrip('.')}"
        tmp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name
            result: dict = mlx_whisper.transcribe(
                tmp_path, path_or_hf_repo=model_repo
            )
            return result.get("text", "").strip()
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)


    async def transcribe_file(
        self,
        path: str,
        model_repo: str = DEFAULT_WHISPER_MODEL,
    ) -> str:
        """Transcribe an existing audio file at *path* (skips base64 decode step)."""
        async with self._lock:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None, self._transcribe_file_sync, path, model_repo
            )

    def _transcribe_file_sync(self, path: str, model_repo: str) -> str:
        try:
            import mlx_whisper  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "mlx-whisper is not installed. Run: pip install mlx-whisper"
            ) from exc
        result: dict = mlx_whisper.transcribe(path, path_or_hf_repo=model_repo)
        return result.get("text", "").strip()


whisper_runner = WhisperRunner()
# [END]
