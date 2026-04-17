import asyncio
import logging
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class LoadedModel:
    ref: str
    snapshot_path: Path | None
    model: object
    tokenizer: object


@dataclass
class ChatMessage:
    role: str
    content: str


@dataclass
class GenerationChunk:
    text: str
    token: int | None = None
    done: bool = False
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    generation_tokens: int | None = None


class MlxRunner:
    """Thread-safe wrapper around mlx-lm load + stream_generate.

    Keeps at most one model in memory; loading a different ref swaps it.
    Streaming works by pushing GenerationResponse chunks from a worker
    thread onto an asyncio.Queue consumed by async generators.
    """

    def __init__(self) -> None:
        self._loaded: LoadedModel | None = None
        self._load_lock = asyncio.Lock()

    async def ensure_loaded(self, model_ref: str | Path) -> LoadedModel:
        ref_str = str(model_ref)
        async with self._load_lock:
            if self._loaded is not None and self._loaded.ref == ref_str:
                return self._loaded
            logger.info("loading MLX model: %s", ref_str)
            loaded = await asyncio.to_thread(self._load, ref_str)
            self._loaded = loaded
            return loaded

    def _load(self, ref: str) -> LoadedModel:
        from mlx_lm import load  # heavy, imported lazily

        path: Path | None = None
        maybe_path = Path(ref)
        if maybe_path.exists():
            path = maybe_path

        model, tokenizer = load(ref if path is None else str(path))
        return LoadedModel(ref=ref, snapshot_path=path, model=model, tokenizer=tokenizer)

    async def stream_chat(
        self,
        model_ref: str | Path,
        messages: list[ChatMessage],
        max_tokens: int = 512,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> AsyncIterator[GenerationChunk]:
        loaded = await self.ensure_loaded(model_ref)
        prompt = self._apply_chat_template(loaded.tokenizer, messages)
        async for chunk in self._astream(loaded, prompt, max_tokens, temperature, top_p):
            yield chunk

    async def stream_generate(
        self,
        model_ref: str | Path,
        prompt: str,
        max_tokens: int = 512,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> AsyncIterator[GenerationChunk]:
        loaded = await self.ensure_loaded(model_ref)
        async for chunk in self._astream(loaded, prompt, max_tokens, temperature, top_p):
            yield chunk

    def _apply_chat_template(self, tokenizer, messages: list[ChatMessage]) -> str:
        dicts = [{"role": m.role, "content": m.content} for m in messages]
        apply = getattr(tokenizer, "apply_chat_template", None)
        if callable(apply):
            try:
                return apply(dicts, tokenize=False, add_generation_prompt=True)
            except Exception as e:  # tokenizer w/o chat template
                logger.debug("chat template failed, falling back: %s", e)
        return "\n".join(f"{m.role}: {m.content}" for m in messages) + "\nassistant:"

    async def _astream(
        self,
        loaded: LoadedModel,
        prompt: str,
        max_tokens: int,
        temperature: float | None,
        top_p: float | None,
    ) -> AsyncIterator[GenerationChunk]:
        from mlx_lm import stream_generate

        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def worker() -> None:
            try:
                kwargs: dict = {"max_tokens": max_tokens}
                try:
                    from mlx_lm.sample_utils import make_sampler

                    kwargs["sampler"] = make_sampler(
                        temp=float(temperature) if temperature is not None else 0.0,
                        top_p=float(top_p) if top_p is not None else 1.0,
                    )
                except Exception as e:  # older mlx_lm without make_sampler
                    logger.debug("sampler helper unavailable: %s", e)

                for chunk in stream_generate(loaded.model, loaded.tokenizer, prompt, **kwargs):
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

        threading.Thread(target=worker, daemon=True, name="mlx-stream").start()

        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, BaseException):
                raise item
            yield item


runner = MlxRunner()
