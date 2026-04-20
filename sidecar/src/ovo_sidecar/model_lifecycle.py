"""Cross-runner model lifecycle coordinator.

Each runner registers an `unload` callable on import plus a *slot* tag.
Slots are independent memory tenants: loading a new model inside one slot
only unloads others in the *same* slot. Defined slots:
  - "llm"       — chat / code LLMs (text runner + VLM runner share this
                  because they both occupy the unified-memory LLM budget)
  - "image"     — diffusion pipelines (SDXL / Flux / Z-Image …)
  - "embedding" — sentence-transformer encoders (<1GB, coexist cheaply)

The explicit slot model means the Image tab no longer evicts the user's
current chat model — users can flip between Chat, Code, and Image without
paying a reload cost for each switch. The top-level /ovo/unload endpoint
still unloads everything regardless of slot (used on hard shutdown).
"""

import gc
import logging
import subprocess
from collections.abc import Callable

logger = logging.getLogger(__name__)

# [START] Phase 8 — MLX memory discipline.
# Keeping MLX from triggering swap is the single biggest performance win on
# unified-memory Macs. Without an explicit limit MLX will happily request
# more VRAM than macOS can wire, which forces the kernel to spill to swap
# and collapses inference throughput (50 ms/token → 600 ms/token). We
# compute a safe budget on startup and plant both a `memory_limit` (hard
# cap per allocation call) and a `cache_limit` (bounded kernel cache so
# long sessions don't bloat forever). Values persist in these module-level
# globals so /ovo/system/info can report the real ceiling to the frontend.
_mlx_memory_limit_bytes: int = 0
_mlx_cache_limit_bytes: int = 0
_gpu_wired_limit_bytes: int = 0


def _read_gpu_wired_limit() -> int:
    """Return `iogpu.wired_limit_mb` converted to bytes, or 0 on macOS default.

    The sysctl ships unset on a fresh install, which Apple treats as ~67 %
    of total RAM. Users who have tuned it (power users with 64 GB+) get
    their explicit override instead.
    """
    try:
        out = subprocess.check_output(
            ["sysctl", "-n", "iogpu.wired_limit_mb"],
            text=True,
            timeout=2,
        )
        mb = int(out.strip())
        return mb * 1024 * 1024 if mb > 0 else 0
    except Exception:
        return 0


def configure_memory_limits() -> None:
    """Wire MLX Metal budgets before the first model loads.

    Called once at sidecar startup. Safe to call again — the limits clamp
    future allocations only; already-resident weights stay put. Silent on
    non-MLX hosts (falls through the `getattr` guards).
    """
    global _mlx_memory_limit_bytes, _mlx_cache_limit_bytes, _gpu_wired_limit_bytes

    try:
        import psutil

        total = psutil.virtual_memory().total
    except Exception:
        total = 0

    _gpu_wired_limit_bytes = _read_gpu_wired_limit()
    if _gpu_wired_limit_bytes > 0:
        usable = _gpu_wired_limit_bytes
    elif total > 0:
        # macOS default wired cap — Apple publishes no exact number; 70 %
        # matches empirical measurements on M-series across 16-128 GB.
        usable = int(total * 0.70)
    else:
        # Can't tell. Don't plant a limit; MLX will fall back to unlimited.
        return

    # Reserve headroom for Python, Tauri, the sidecar, graphics stack,
    # CoreAudio, etc. 2 GB is enough on 16 GB Macs and a rounding error on
    # 64 GB+. Bias conservative.
    headroom = max(2 * 1024**3, int(usable * 0.08))
    mem_limit = max(usable - headroom, usable // 2)

    # Cache limit — kernel / graph cache, separate from model weights.
    # 2 GB plenty for normal use; MoE workloads benefit from a little more.
    cache_limit = min(2 * 1024**3, max(256 * 1024**2, usable // 20))

    _mlx_memory_limit_bytes = mem_limit
    _mlx_cache_limit_bytes = cache_limit

    try:
        import mlx.core as mx

        set_mem = getattr(mx.metal, "set_memory_limit", None)
        if callable(set_mem):
            try:
                set_mem(mem_limit, relaxed=True)
            except TypeError:
                # Older MLX builds don't accept `relaxed`.
                set_mem(mem_limit)
            logger.info(
                "MLX memory_limit=%.1f GB (wired=%s, total=%.1f GB)",
                mem_limit / 1024**3,
                (f"{_gpu_wired_limit_bytes / 1024**3:.1f} GB" if _gpu_wired_limit_bytes else "macOS default ~70 %"),
                total / 1024**3,
            )

        set_cache = getattr(mx.metal, "set_cache_limit", None)
        if callable(set_cache):
            set_cache(cache_limit)
            logger.info("MLX cache_limit=%.2f GB", cache_limit / 1024**3)
    except Exception as e:
        logger.warning("MLX memory limit configuration skipped: %s", e)


def get_mlx_limits() -> dict[str, int]:
    """Snapshot for /ovo/system/info — zeros when unconfigured."""
    return {
        "mlx_memory_limit_bytes": _mlx_memory_limit_bytes,
        "mlx_cache_limit_bytes": _mlx_cache_limit_bytes,
        "gpu_wired_limit_bytes": _gpu_wired_limit_bytes,
    }
# [END]

# (fn, slot) tuples. Slot defaults to "default" for legacy callers.
_unloaders: list[tuple[Callable[[], None], str]] = []


def register_unloader(fn: Callable[[], None], slot: str = "default") -> None:
    if any(existing is fn for existing, _ in _unloaders):
        return
    _unloaders.append((fn, slot))


def unload_others(
    skip: Callable[[], None] | None,
    slot: str | None = None,
) -> None:
    """Invoke every registered unloader except `skip`.

    When `slot` is given, only unloaders tagged with that slot run — runners
    in other slots are left alone. `slot=None` unloads everything (shutdown /
    explicit /ovo/unload).
    """
    for fn, s in list(_unloaders):
        if fn is skip:
            continue
        if slot is not None and s != slot:
            continue
        try:
            fn()
        except Exception as e:
            logger.debug("unloader failed: %s", e)


# [START] Phase 4 — exclusive-slot eviction.
# Inline code-completion loads a dedicated FIM model (often a small Coder-
# variant distinct from the chat model). Before it takes unified-memory
# tenancy we push out everything *outside* its slot — image pipelines,
# embedding encoders, etc. — so the ghost-text model doesn't have to share
# VRAM with idle residents. Sibling runners inside `keep_slot` are left
# alone; their own `ensure_loaded` handles within-slot eviction.
def unload_all_except_slot(keep_slot: str) -> None:
    """Drop every registered model NOT tagged with `keep_slot`.

    Used by the code-completion FIM endpoint to free unified memory for the
    inline model before loading. Follows the same best-effort semantics as
    `unload_others` — individual failures are swallowed — and flushes the
    Metal cache after so the freed weights actually leave VRAM.
    """
    freed_any = False
    for fn, s in list(_unloaders):
        if s == keep_slot:
            continue
        try:
            fn()
            freed_any = True
        except Exception as e:
            logger.debug("unloader failed: %s", e)
    if freed_any:
        release_gpu_memory()
# [END]


def release_gpu_memory() -> None:
    """Force Python GC then ask Metal to drop its command-buffer cache so
    just-unloaded weights actually leave unified memory."""
    gc.collect()
    try:
        import mlx.core as mx

        clear = getattr(mx.metal, "clear_cache", None)
        if callable(clear):
            clear()
        reset = getattr(mx.metal, "reset_peak_memory", None)
        if callable(reset):
            reset()
    except Exception as e:
        logger.debug("metal cache clear skipped: %s", e)
