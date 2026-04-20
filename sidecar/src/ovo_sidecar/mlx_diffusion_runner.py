# [START] Phase 7 — Local text-to-image diffusion runner.
# Wraps a diffusers pipeline (SD 1.5 / SDXL / Flux) so the OVO frontend can
# generate images entirely on-device. Keeps feature parity with Draw Things
# for everything the frontend UI exposes:
#   - model swap with single-slot tenancy (siblings + chat models unload)
#   - scheduler/sampler selection (Euler / Euler A / DPM++ 2M (Karras) / DDIM / UniPC)
#   - LoRA load with configurable strength
#   - seed, steps, CFG (guidance scale), width × height, batch
#   - progress callback for SSE streaming to the UI
#   - Flux shift parameter pass-through
#
# ControlNet hooks are prepared but only activate when the caller provides
# both a control_model repo and a control_image — otherwise the runner takes
# the vanilla text-to-image path. Keeps the hot path cheap while still letting
# advanced users wire a control pipeline without a separate runner.

import asyncio
import base64
import io
import logging
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ovo_sidecar.config import settings

logger = logging.getLogger(__name__)


# ── Scheduler registry ───────────────────────────────────────────────────────
# Maps the UI's sampler strings to a (class_name, kwargs) pair so we can
# rebuild the pipeline's `scheduler` slot on demand. We intentionally keep
# this narrow — anything exotic can be added later without touching callers.
_SCHEDULER_REGISTRY: dict[str, tuple[str, dict]] = {
    "euler":           ("EulerDiscreteScheduler", {}),
    "euler_a":         ("EulerAncestralDiscreteScheduler", {}),
    "heun":            ("HeunDiscreteScheduler", {}),
    "dpm++_2m":        ("DPMSolverMultistepScheduler", {}),
    "dpm++_2m_karras": ("DPMSolverMultistepScheduler", {"use_karras_sigmas": True}),
    "dpm++_sde":       ("DPMSolverSDEScheduler", {}),
    "dpm++_sde_karras": ("DPMSolverSDEScheduler", {"use_karras_sigmas": True}),
    "dpm_single":      ("DPMSolverSinglestepScheduler", {}),
    "dpm_single_karras": ("DPMSolverSinglestepScheduler", {"use_karras_sigmas": True}),
    "kdpm2":           ("KDPM2DiscreteScheduler", {}),
    "kdpm2_a":         ("KDPM2AncestralDiscreteScheduler", {}),
    "deis":            ("DEISMultistepScheduler", {}),
    "ddim":            ("DDIMScheduler", {}),
    "unipc":           ("UniPCMultistepScheduler", {}),
    "lms":             ("LMSDiscreteScheduler", {}),
    "pndm":            ("PNDMScheduler", {}),
}


@dataclass
class GenerateRequest:
    prompt: str
    model: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    steps: int = 28
    cfg_scale: float = 7.0
    sampler: str = "dpm++_2m_karras"
    seed: int | None = None
    batch: int = 1
    loras: list[dict] = field(default_factory=list)  # [{path, strength}]
    # Flux-specific scheduler shift (ignored by non-Flux pipelines).
    shift: float | None = None
    # ControlNet (optional — both must be set to activate).
    control_image_b64: str | None = None
    control_model: str | None = None
    control_strength: float = 1.0


@dataclass
class GenerationStepEvent:
    step: int
    total: int
    elapsed_ms: int


@dataclass
class GeneratedImage:
    index: int
    path: str
    base64_png: str
    seed: int
    width: int
    height: int


@dataclass
class GenerationResult:
    model: str
    sampler: str
    images: list[GeneratedImage]
    total_elapsed_ms: int


@dataclass
class LoadedDiffusionPipeline:
    ref: str
    pipe: Any  # diffusers.DiffusionPipeline subclass
    pipeline_class: str  # "StableDiffusionPipeline" | "StableDiffusionXLPipeline" | "FluxPipeline" | ...
    active_loras: list[str]
    # [START] ControlNet cache — avoid reloading on every request.
    active_controlnet_ref: str | None = None
    active_controlnet: Any = None
    # [END]


class MlxDiffusionRunner:
    """Single-slot diffusion runner. Thread-safe load; serialized generate."""

    def __init__(self) -> None:
        self._loaded: LoadedDiffusionPipeline | None = None
        self._load_lock = asyncio.Lock()
        self._gen_lock = asyncio.Lock()
        # Register with the central lifecycle so a chat-model swap (or explicit
        # /ovo/unload) drops the pipeline + frees unified memory immediately.
        from ovo_sidecar import model_lifecycle

        model_lifecycle.register_unloader(self.unload, slot="image")

    # ── lifecycle ──────────────────────────────────────────────────────────

    def unload(self) -> None:
        if self._loaded is None:
            return
        from ovo_sidecar import model_lifecycle

        logger.info("unloading diffusion pipeline: %s", self._loaded.ref)
        try:
            # Unload LoRAs first so there are no references left pointing into
            # the pipeline's submodules when we drop it.
            if hasattr(self._loaded.pipe, "unload_lora_weights"):
                try:
                    self._loaded.pipe.unload_lora_weights()
                except Exception as e:  # pragma: no cover — optional
                    logger.debug("unload_lora_weights failed: %s", e)
        finally:
            self._loaded = None
            model_lifecycle.release_gpu_memory()

    # ── loading ────────────────────────────────────────────────────────────

    async def ensure_loaded(self, ref: str) -> LoadedDiffusionPipeline:
        async with self._load_lock:
            if self._loaded is not None and self._loaded.ref == ref:
                return self._loaded
            # Only evict siblings in the SAME slot (image). Chat / code LLMs
            # stay resident so users can flip between tabs without paying a
            # reload cost; embedding encoders are tiny and also left alone.
            self.unload()
            from ovo_sidecar import model_lifecycle

            model_lifecycle.unload_others(skip=self.unload, slot="image")
            loaded = await asyncio.to_thread(self._load, ref)
            self._loaded = loaded
            return loaded

    def _select_device(self) -> str:
        # Apple Silicon: prefer MPS → CPU fallback. On non-Mac, torch auto
        # picks CUDA when available. Diffusers honors device="mps" directly.
        try:
            import torch

            if torch.backends.mps.is_available():
                return "mps"
            if torch.cuda.is_available():
                return "cuda"
        except Exception:  # pragma: no cover — torch optional at import time
            pass
        return "cpu"

    def _dtype(self, device: str) -> Any:
        import torch

        if device == "cpu":
            return torch.float32
        # [START] Phase 7 — MPS black-image workaround.
        # Apple-silicon + fp16 produces NaN latents mid-denoising in SD/SDXL,
        # which the VAE then decodes as a solid black PNG. bfloat16 has the
        # same memory footprint as fp16 but the wider exponent range sidesteps
        # the overflow. Fallback to fp16 on CUDA (where the issue doesn't
        # reproduce and fp16 is universally supported).
        if device == "mps":
            return torch.bfloat16
        return torch.float16
        # [END]

    def _pipeline_class_for(self, snapshot: Path) -> str:
        """Inspect model_index.json / config.json to pick the right pipeline.

        Falls back to StableDiffusionPipeline so user-downloaded SD 1.5 models
        without a full model_index.json still work.
        """
        model_index = snapshot / "model_index.json"
        if model_index.exists():
            try:
                import json

                data = json.loads(model_index.read_text())
                cls_name = data.get("_class_name")
                if isinstance(cls_name, str) and cls_name:
                    return cls_name
            except Exception as e:
                logger.debug("model_index.json parse failed: %s", e)
        # Heuristic: presence of vae/unet suggests SD-family. Fallback.
        return "StableDiffusionPipeline"

    def _load(self, ref: str) -> LoadedDiffusionPipeline:
        """Synchronous load — executed on a worker thread from ensure_loaded."""
        try:
            import diffusers  # noqa: F401  (ensure installed)
            import torch
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "diffusers + torch are required for image generation. Install "
                "via `uv pip install diffusers transformers accelerate`."
            ) from e

        # Resolve to a local snapshot path whenever possible so pipeline load
        # can avoid any HF network call.
        from ovo_sidecar import hf_scanner

        local = hf_scanner.resolve_path(ref)
        target: str = str(local) if local is not None else ref

        pipeline_class = (
            self._pipeline_class_for(local) if local is not None
            else "StableDiffusionPipeline"
        )
        # Known pipelines we instantiate directly — anything else falls back
        # to AutoPipelineForText2Image so exotic models (Kandinsky etc.) work.
        from diffusers import AutoPipelineForText2Image

        device = self._select_device()
        dtype = self._dtype(device)

        try:
            # Diffusers resolves the actual class from the repo's model_index.
            pipe = AutoPipelineForText2Image.from_pretrained(
                target,
                torch_dtype=dtype,
                safety_checker=None,
                requires_safety_checker=False,
            )
        except Exception as e:
            logger.warning(
                "AutoPipelineForText2Image failed for %s (%s) — falling back to StableDiffusionPipeline",
                ref, e,
            )
            from diffusers import StableDiffusionPipeline

            pipe = StableDiffusionPipeline.from_pretrained(
                target,
                torch_dtype=dtype,
                safety_checker=None,
                requires_safety_checker=False,
            )
            pipeline_class = "StableDiffusionPipeline"

        # Memory + throughput tuning. These calls are all no-ops when the
        # pipeline doesn't support them, so we gate with hasattr.
        try:
            pipe = pipe.to(device)
        except Exception as e:
            logger.warning("pipeline.to(%s) failed: %s — staying on cpu", device, e)
            pipe = pipe.to("cpu")
        # [START] Phase 7 — VAE fp32 upcast.
        # Even with bf16 across the rest of the pipeline, the VAE decode step
        # is famously NaN-prone on MPS when the latents dtype doesn't match
        # the VAE dtype exactly. Running the VAE in fp32 costs a few hundred
        # MB of unified memory and fixes the "solid black output" failure
        # mode for SD 1.5 / SDXL / most SD derivatives. Ignore if the
        # pipeline doesn't carry a .vae attribute.
        if device != "cpu" and hasattr(pipe, "vae") and pipe.vae is not None:
            try:
                pipe.vae.to(dtype=torch.float32)
                logger.info("diffusion vae upcast to float32")
            except Exception as e:
                logger.debug("vae upcast skipped: %s", e)
        # [END]
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

        logger.info(
            "diffusion loaded: %s (class=%s device=%s dtype=%s)",
            ref, pipeline_class, device, dtype,
        )
        return LoadedDiffusionPipeline(
            ref=ref, pipe=pipe, pipeline_class=pipeline_class, active_loras=[],
        )

    # ── scheduler / LoRA helpers ──────────────────────────────────────────

    def _apply_scheduler(self, pipe: Any, sampler: str) -> None:
        # [START] Phase 7 — flow-match guard.
        # Flux / SD3 / Z-Image Turbo ship a FlowMatchEulerDiscreteScheduler and
        # internally call `scheduler.set_timesteps(mu=...)`. Swapping to a
        # plain EulerDiscreteScheduler blows up with
        #   `set_timesteps() got an unexpected keyword argument 'mu'`
        # because only the flow-match variant takes that kwarg. We detect the
        # flow-match family by class name and silently skip any swap there —
        # the pipeline's default scheduler is the only safe choice.
        current_name = type(getattr(pipe, "scheduler", None)).__name__
        if "FlowMatch" in current_name or "Flow" in current_name:
            logger.info(
                "skipping scheduler swap — pipeline requires flow-matching scheduler (%s)",
                current_name,
            )
            return
        # [END]
        spec = _SCHEDULER_REGISTRY.get(sampler.lower())
        if spec is None:
            return  # unknown key — keep the pipeline default
        cls_name, extra = spec
        try:
            import diffusers

            SchedulerCls = getattr(diffusers, cls_name, None)
            if SchedulerCls is None:
                logger.debug("scheduler class %s not in diffusers", cls_name)
                return
            pipe.scheduler = SchedulerCls.from_config(pipe.scheduler.config, **extra)
        except Exception as e:
            logger.warning("scheduler swap to %s failed: %s", sampler, e)

    def _apply_loras(self, pipe: Any, loras: list[dict]) -> list[str]:
        """Load one or more LoRA safetensors into the pipeline. Idempotent per
        path — repeat calls with the same path swap the adapter instead of
        stacking. Returns the list of applied LoRA paths for bookkeeping."""
        applied: list[str] = []
        if not loras:
            # Clear any previously-applied adapters so state stays clean.
            if hasattr(pipe, "unload_lora_weights"):
                try:
                    pipe.unload_lora_weights()
                except Exception:
                    pass
            return applied
        # Diffusers supports set_adapters for named LoRAs; we use load_lora_weights
        # which layers additively. For multi-LoRA with weights, use set_adapters.
        try:
            adapter_names: list[str] = []
            weights: list[float] = []
            for idx, entry in enumerate(loras):
                path = entry.get("path")
                strength = float(entry.get("strength", 1.0))
                if not path:
                    continue
                adapter = f"lora_{idx}"
                pipe.load_lora_weights(path, adapter_name=adapter)
                adapter_names.append(adapter)
                weights.append(strength)
                applied.append(str(path))
            if adapter_names and hasattr(pipe, "set_adapters"):
                pipe.set_adapters(adapter_names, adapter_weights=weights)
        except Exception as e:
            logger.warning("LoRA apply failed: %s", e)
        return applied

    # ── generation ─────────────────────────────────────────────────────────

    async def generate(
        self,
        req: GenerateRequest,
        on_progress: Callable[[GenerationStepEvent], None] | None = None,
    ) -> GenerationResult:
        """Generate images for `req`. Emits GenerationStepEvent frames through
        `on_progress` as each denoising step completes (when the pipeline
        supports `callback_on_step_end`)."""
        loaded = await self.ensure_loaded(req.model)
        # Serialize generate calls — a pipeline isn't re-entrant.
        async with self._gen_lock:
            self._apply_scheduler(loaded.pipe, req.sampler)
            loaded.active_loras = self._apply_loras(loaded.pipe, req.loras)
            return await asyncio.to_thread(self._generate_sync, loaded, req, on_progress)

    def _generate_sync(
        self,
        loaded: LoadedDiffusionPipeline,
        req: GenerateRequest,
        on_progress: Callable[[GenerationStepEvent], None] | None,
    ) -> GenerationResult:
        import torch

        seed = req.seed if req.seed is not None and req.seed >= 0 else random.randint(0, 2**32 - 1)
        # Use the pipeline's device for the generator — torch complains
        # otherwise when the pipeline is on mps.
        device = getattr(loaded.pipe, "device", None)
        dev_str = str(device) if device is not None else "cpu"
        generator = torch.Generator(device=dev_str if dev_str != "mps" else "cpu").manual_seed(seed)

        total_steps = max(1, int(req.steps))
        t0 = time.time()

        def _callback(pipe, step: int, timestep, callback_kwargs):
            # Diffusers passes 0-indexed step through callback_on_step_end.
            if on_progress is not None:
                try:
                    on_progress(GenerationStepEvent(
                        step=int(step) + 1,
                        total=total_steps,
                        elapsed_ms=int((time.time() - t0) * 1000),
                    ))
                except Exception:
                    pass
            return callback_kwargs

        # Extra kwargs per pipeline family.
        extra: dict[str, Any] = {}
        if "Flux" in loaded.pipeline_class and req.shift is not None:
            extra["mu"] = float(req.shift)

        # ControlNet activation (optional). When both are set, reload the
        # pipeline with a control net shim. Kept inline to avoid a second
        # LoadedDiffusionPipeline entry — control use is a per-request feature.
        if req.control_image_b64 and req.control_model:
            try:
                # [START] ControlNet cache — reuse if same model, avoid memory leak
                # from loading a fresh ControlNetModel on every request.
                if loaded.active_controlnet_ref == req.control_model and loaded.active_controlnet is not None:
                    control = loaded.active_controlnet
                else:
                    # Drop old ControlNet before loading new one
                    loaded.active_controlnet = None
                    loaded.active_controlnet_ref = None
                    from diffusers import ControlNetModel
                    control = ControlNetModel.from_pretrained(
                        req.control_model,
                        torch_dtype=torch.float16 if dev_str != "cpu" else torch.float32,
                    )
                    loaded.active_controlnet = control
                    loaded.active_controlnet_ref = req.control_model
                # [END]
                extra["controlnet_conditioning_scale"] = float(req.control_strength)
                control_image_bytes = base64.b64decode(req.control_image_b64)
                from PIL import Image

                extra["image"] = Image.open(io.BytesIO(control_image_bytes))
                extra["controlnet"] = control
            except Exception as e:
                logger.warning("control net load failed: %s — skipping", e)

        # [START] Phase 7 — Run the pipeline with progressive fallbacks.
        # 1. Full callback_on_step_end + empty tensor_inputs (so diffusers
        #    doesn't try to index latents arrays that some Lightning/Turbo
        #    pipelines size independently of `num_inference_steps`).
        # 2. If the pipeline rejects those kwargs (TypeError) OR blows up with
        #    an IndexError inside its own step loop, retry WITHOUT the
        #    callback so progress reporting is lost but the image still ships.
        base_kwargs = dict(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt or None,
            width=req.width,
            height=req.height,
            num_inference_steps=total_steps,
            guidance_scale=float(req.cfg_scale),
            num_images_per_prompt=max(1, int(req.batch)),
            generator=generator,
        )
        try:
            out = loaded.pipe(
                **base_kwargs,
                callback_on_step_end=_callback,
                callback_on_step_end_tensor_inputs=[],
                **extra,
            )
        except (TypeError, IndexError) as e:
            logger.warning(
                "pipeline call with callback failed (%s) — retrying without callback",
                type(e).__name__,
            )
            out = loaded.pipe(
                **base_kwargs,
                **{k: v for k, v in extra.items() if k not in {"controlnet"}},
            )
        # [END]

        # Persist + encode. Output images land under settings.images_dir so
        # the frontend can link directly to them for a gallery browse.
        images: list[GeneratedImage] = []
        settings.ensure_dirs()
        images_dir = settings.images_dir
        for i, img in enumerate(out.images):
            filename = f"{int(time.time() * 1000)}_{seed}_{i}.png"
            path = images_dir / filename
            img.save(path)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            images.append(GeneratedImage(
                index=i,
                path=str(path),
                base64_png=b64,
                seed=seed + i,
                width=req.width,
                height=req.height,
            ))

        return GenerationResult(
            model=req.model,
            sampler=req.sampler,
            images=images,
            total_elapsed_ms=int((time.time() - t0) * 1000),
        )


diffusion_runner = MlxDiffusionRunner()
# [END] Phase 7
