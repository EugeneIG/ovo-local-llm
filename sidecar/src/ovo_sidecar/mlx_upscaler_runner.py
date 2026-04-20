# [START] Phase 7 — Upscaler runner.
# Wraps diffusers' Stable Diffusion x4 upscaler so the UI can enlarge any
# previously-generated image through a one-shot /ovo/images/upscale call.
# Shares the "image" unloader slot with the main diffusion runner so an
# upscale request evicts the currently-loaded generation pipeline (and
# vice-versa) — prevents two large torch pipelines from doubly occupying
# unified memory.
#
# Default model: stabilityai/stable-diffusion-x4-upscaler (~1.5GB). User
# needs to download it via the HF model browser first; if not available,
# the API returns a clear 404 from `snapshot_download` retry.

import asyncio
import base64
import io
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ovo_sidecar.config import settings

logger = logging.getLogger(__name__)

DEFAULT_UPSCALER_MODEL = "stabilityai/stable-diffusion-x4-upscaler"


@dataclass
class LoadedUpscaler:
    ref: str
    pipe: Any
    device: str


class UpscalerRunner:
    """Lazy-load + single-slot upscaler (4x SD)."""

    def __init__(self) -> None:
        self._loaded: LoadedUpscaler | None = None
        self._load_lock = asyncio.Lock()
        self._gen_lock = asyncio.Lock()
        from ovo_sidecar import model_lifecycle

        model_lifecycle.register_unloader(self.unload, slot="image")

    def unload(self) -> None:
        if self._loaded is None:
            return
        from ovo_sidecar import model_lifecycle

        logger.info("unloading upscaler: %s", self._loaded.ref)
        self._loaded = None
        model_lifecycle.release_gpu_memory()

    async def ensure_loaded(self, ref: str) -> LoadedUpscaler:
        async with self._load_lock:
            if self._loaded is not None and self._loaded.ref == ref:
                return self._loaded
            self.unload()
            from ovo_sidecar import model_lifecycle

            # Same slot as diffusion_runner — evict siblings.
            model_lifecycle.unload_others(skip=self.unload, slot="image")
            loaded = await asyncio.to_thread(self._load, ref)
            self._loaded = loaded
            return loaded

    def _load(self, ref: str) -> LoadedUpscaler:
        try:
            from diffusers import StableDiffusionUpscalePipeline
            import torch
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "diffusers + torch are required for upscaling. Install via "
                "`uv pip install diffusers transformers accelerate`."
            ) from e

        # Device + dtype selection. Same logic as the main diffusion runner
        # (bf16 on MPS sidesteps the fp16 NaN issue, fp16 on CUDA).
        if torch.backends.mps.is_available():
            device = "mps"
            dtype = torch.bfloat16
        elif torch.cuda.is_available():
            device = "cuda"
            dtype = torch.float16
        else:
            device = "cpu"
            dtype = torch.float32

        logger.info("loading upscaler: %s (device=%s dtype=%s)", ref, device, dtype)
        pipe = StableDiffusionUpscalePipeline.from_pretrained(ref, torch_dtype=dtype)
        pipe = pipe.to(device)
        if device != "cpu" and hasattr(pipe, "vae") and pipe.vae is not None:
            try:
                pipe.vae.to(dtype=torch.float32)
            except Exception as e:
                logger.debug("upscaler vae upcast skipped: %s", e)
        if device != "cpu" and hasattr(pipe, "enable_attention_slicing"):
            try:
                pipe.enable_attention_slicing()
            except Exception:
                pass
        if hasattr(pipe, "set_progress_bar_config"):
            try:
                pipe.set_progress_bar_config(disable=True)
            except Exception:
                pass
        return LoadedUpscaler(ref=ref, pipe=pipe, device=device)

    async def upscale(
        self,
        source_path: str,
        prompt: str = "",
        steps: int = 20,
        guidance_scale: float = 0.0,
        model: str = DEFAULT_UPSCALER_MODEL,
        seed: int | None = None,
    ) -> dict[str, Any]:
        loaded = await self.ensure_loaded(model)
        async with self._gen_lock:
            return await asyncio.to_thread(
                self._run, loaded, source_path, prompt, steps, guidance_scale, seed
            )

    def _run(
        self,
        loaded: LoadedUpscaler,
        source_path: str,
        prompt: str,
        steps: int,
        guidance_scale: float,
        seed: int | None,
    ) -> dict[str, Any]:
        import torch
        from PIL import Image

        src = Image.open(source_path).convert("RGB")
        # x4 upscaler expects max 512x512 input before upscaling to 2048x2048.
        # Downsample anything larger so we don't blow past Metal VRAM.
        max_in = 512
        if src.width > max_in or src.height > max_in:
            scale = min(max_in / src.width, max_in / src.height)
            new_size = (int(src.width * scale), int(src.height * scale))
            src = src.resize(new_size, Image.LANCZOS)

        generator = None
        if seed is not None:
            gen_dev = "cpu" if loaded.device == "mps" else loaded.device
            generator = torch.Generator(device=gen_dev).manual_seed(int(seed))

        t0 = time.time()
        out = loaded.pipe(
            prompt=prompt or "high quality, detailed, sharp, realistic",
            image=src,
            num_inference_steps=max(1, min(steps, 60)),
            guidance_scale=float(guidance_scale),
            generator=generator,
        )
        img = out.images[0]

        settings.ensure_dirs()
        filename = f"{int(time.time() * 1000)}_upscale.png"
        path = settings.images_dir / filename
        img.save(path)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return {
            "path": str(path),
            "base64_png": b64,
            "width": img.width,
            "height": img.height,
            "elapsed_ms": int((time.time() - t0) * 1000),
        }


upscaler_runner = UpscalerRunner()
# [END] Phase 7
