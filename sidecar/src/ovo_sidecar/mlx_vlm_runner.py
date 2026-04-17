import asyncio
import base64
import binascii
import io
import logging
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class LoadedVlmModel:
    ref: str
    snapshot_path: Path | None
    model: Any
    processor: Any
    config: Any


@dataclass
class VlmChatMessage:
    role: str
    content: str
    images: list[str] = field(default_factory=list)


@dataclass
class GenerationChunk:
    text: str
    token: int | None = None
    done: bool = False
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    generation_tokens: int | None = None


# [START] Image source resolution — mlx-vlm accepts path/URL strings and PIL Images.
# Data URLs (`data:image/png;base64,...`) must be decoded locally since mlx-vlm
# doesn't parse them. Http(s) URLs and local paths pass through unchanged.
def _decode_image(src: str):
    if src.startswith("data:"):
        from PIL import Image

        _, _, b64 = src.partition(",")
        try:
            data = base64.b64decode(b64, validate=False)
        except (binascii.Error, ValueError) as e:
            raise ValueError(f"invalid data URL: {e}") from e
        return Image.open(io.BytesIO(data)).convert("RGB")
    return src
# [END]


class MlxVlmRunner:
    """Thread-safe wrapper around mlx-vlm load + stream_generate.

    Mirrors MlxRunner but loads (model, processor) and passes a flat images
    list alongside the chat-template-formatted prompt.
    """

    def __init__(self) -> None:
        self._loaded: LoadedVlmModel | None = None
        self._load_lock = asyncio.Lock()

    async def ensure_loaded(self, model_ref: str | Path) -> LoadedVlmModel:
        ref_str = str(model_ref)
        async with self._load_lock:
            if self._loaded is not None and self._loaded.ref == ref_str:
                return self._loaded
            logger.info("loading MLX-VLM model: %s", ref_str)
            loaded = await asyncio.to_thread(self._load, ref_str)
            self._loaded = loaded
            return loaded

    def _load(self, ref: str) -> LoadedVlmModel:
        from mlx_vlm import load  # heavy, imported lazily

        path: Path | None = None
        maybe_path = Path(ref)
        if maybe_path.exists():
            path = maybe_path

        model, processor = load(ref if path is None else str(path))
        config = getattr(model, "config", None)
        return LoadedVlmModel(
            ref=ref,
            snapshot_path=path,
            model=model,
            processor=processor,
            config=config,
        )

    async def stream_chat(
        self,
        model_ref: str | Path,
        messages: list[VlmChatMessage],
        max_tokens: int = 512,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> AsyncIterator[GenerationChunk]:
        loaded = await self.ensure_loaded(model_ref)

        # Flatten images across all turns; apply_chat_template only needs num_images.
        images: list = []
        for m in messages:
            for src in m.images:
                images.append(_decode_image(src))

        from mlx_vlm.prompt_utils import apply_chat_template

        flat_msgs = [{"role": m.role, "content": m.content} for m in messages]
        formatted = apply_chat_template(
            loaded.processor,
            loaded.config,
            flat_msgs,
            num_images=len(images),
        )

        async for chunk in self._astream(loaded, formatted, images, max_tokens, temperature, top_p):
            yield chunk

    async def _astream(
        self,
        loaded: LoadedVlmModel,
        prompt: str,
        images: list,
        max_tokens: int,
        temperature: float | None,
        top_p: float | None,
    ) -> AsyncIterator[GenerationChunk]:
        from mlx_vlm import stream_generate

        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def worker() -> None:
            try:
                kwargs: dict = {"max_tokens": max_tokens}
                if temperature is not None:
                    kwargs["temperature"] = float(temperature)
                if top_p is not None:
                    kwargs["top_p"] = float(top_p)

                for chunk in stream_generate(
                    loaded.model, loaded.processor, prompt, images, **kwargs
                ):
                    text = getattr(chunk, "text", "") or ""
                    finish = getattr(chunk, "finish_reason", None)
                    out = GenerationChunk(
                        text=text,
                        token=getattr(chunk, "token", None),
                        done=finish is not None,
                        finish_reason=finish,
                        prompt_tokens=getattr(chunk, "prompt_tokens", None),
                        generation_tokens=getattr(chunk, "generation_tokens", None),
                    )
                    loop.call_soon_threadsafe(queue.put_nowait, out)
            except BaseException as e:
                loop.call_soon_threadsafe(queue.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        threading.Thread(target=worker, daemon=True, name="mlx-vlm-stream").start()

        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, BaseException):
                raise item
            yield item


vlm_runner = MlxVlmRunner()
