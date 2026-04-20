# [START] Phase 8 — Audio recorder (sidecar-side).
# Records from the default microphone using sounddevice (which uses CoreAudio on
# macOS) and saves to a temp WAV file for downstream Whisper transcription.
# Running inside the sidecar process (child of the Tauri bundle) inherits the
# app's NSMicrophoneUsageDescription grant — no WebView secure-context needed.
import asyncio
import logging
import tempfile

logger = logging.getLogger(__name__)

_SAMPLE_RATE = 16_000  # Whisper is trained on 16 kHz mono
_DEFAULT_WHISPER_MODEL = "mlx-community/whisper-small-mlx"


class AudioRecorder:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._recording = False
        self._frames: list = []
        self._stream = None

    async def start(self) -> None:
        async with self._lock:
            if self._recording:
                return
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._start_sync)

    def _start_sync(self) -> None:
        try:
            import sounddevice as sd  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "sounddevice not installed. Run: pip install sounddevice soundfile"
            ) from exc

        self._frames = []
        self._recording = True

        def _cb(indata, frames, time, status):  # noqa: ARG001
            if self._recording:
                self._frames.append(indata.copy())

        self._stream = sd.InputStream(
            samplerate=_SAMPLE_RATE,
            channels=1,
            dtype="float32",
            callback=_cb,
        )
        self._stream.start()
        logger.info("[AudioRecorder] recording started (16kHz mono)")

    async def stop_and_save(self) -> str:
        """Stop recording and return path to a temporary WAV file."""
        async with self._lock:
            self._recording = False
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._stop_sync)

    def _stop_sync(self) -> str:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

        try:
            import numpy as np  # type: ignore[import]
            import soundfile as sf  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "sounddevice/soundfile not installed. Run: pip install sounddevice soundfile"
            ) from exc

        if not self._frames:
            raise RuntimeError("No audio captured — did recording start correctly?")

        audio = np.concatenate(self._frames, axis=0)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, _SAMPLE_RATE)
            logger.info("[AudioRecorder] saved %d samples → %s", len(audio), tmp.name)
            return tmp.name

    async def cancel(self) -> None:
        """Discard current recording without transcribing."""
        async with self._lock:
            self._recording = False
            if self._stream is not None:
                self._stream.stop()
                self._stream.close()
                self._stream = None
            self._frames = []


audio_recorder = AudioRecorder()
# [END]
