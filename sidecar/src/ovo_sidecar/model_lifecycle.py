"""Cross-runner model lifecycle coordinator.

Each runner (mlx_runner, mlx_vlm_runner) registers an `unload` callable on
import. Before loading a new model, a runner unloads itself and asks all
*other* registered runners to unload — prevents two giant models sitting in
unified memory at once and forces Metal cache to release GPU buffers.
"""

import gc
import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)

_unloaders: list[Callable[[], None]] = []


def register_unloader(fn: Callable[[], None]) -> None:
    if fn not in _unloaders:
        _unloaders.append(fn)


def unload_others(skip: Callable[[], None] | None) -> None:
    for fn in list(_unloaders):
        if fn is skip:
            continue
        try:
            fn()
        except Exception as e:
            logger.debug("unloader failed: %s", e)


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
