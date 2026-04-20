# [START] Phase 8 — TTS runner (macOS `say` command).
# Uses the built-in `say` CLI (always present on macOS) to synthesise speech
# and returns a base64-encoded AIFF audio blob.
# On non-macOS hosts `say` is absent → RuntimeError → HTTP 501.
import asyncio
import base64
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Hangul syllables / Jamo ranges — used for auto language detection
_HANGUL_RE = re.compile(r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]")
# Hiragana / Katakana / CJK unified ideographs (rough Japanese/Chinese hint)
_JP_RE = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")

_DEFAULT_VOICE_EN = "Samantha"
_DEFAULT_VOICE_KO = "Yuna"
_DEFAULT_VOICE_JA = "Kyoko"
_DEFAULT_VOICE_ZH = "Tingting"


def _pick_voice(text: str) -> str:
    """Auto-pick a `say` voice from the dominant script in `text`."""
    if _HANGUL_RE.search(text):
        return _DEFAULT_VOICE_KO
    if _JP_RE.search(text):
        return _DEFAULT_VOICE_JA
    if _CJK_RE.search(text):
        return _DEFAULT_VOICE_ZH
    return _DEFAULT_VOICE_EN


class TTSRunner:
    def __init__(self) -> None:
        self._say_path: str | None = shutil.which("say")

    async def synthesize(self, text: str, voice: str | None = None) -> tuple[str, str]:
        """Returns (base64_audio, format). Raises RuntimeError on failure.

        If `voice` is None or empty, picks one from the script of `text`.
        """
        resolved = voice if voice else _pick_voice(text)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._synthesize_sync, text, resolved)

    def _synthesize_sync(self, text: str, voice: str) -> tuple[str, str]:
        if not self._say_path:
            raise RuntimeError(
                "`say` command not found — TTS requires macOS"
            )
        tmp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp:
                tmp_path = tmp.name
            try:
                subprocess.run(
                    [self._say_path, "-v", voice, "-o", tmp_path, text],
                    check=True,
                    timeout=30,
                    capture_output=True,
                )
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr.decode(errors="replace") if exc.stderr else ""
                raise RuntimeError(f"`say` failed: {stderr}") from exc
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError("TTS timed out (>30 s)") from exc
            audio_b64 = base64.b64encode(Path(tmp_path).read_bytes()).decode()
            return audio_b64, "aiff"
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)


tts_runner = TTSRunner()
# [END]
