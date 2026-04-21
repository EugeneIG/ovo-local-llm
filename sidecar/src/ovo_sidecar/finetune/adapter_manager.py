"""Adapter Manager — list, load, merge, delete LoRA adapters."""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

from ovo_sidecar.config import settings
from ovo_sidecar.finetune.models import Adapter, TrainingConfig, _now_kst

logger = logging.getLogger(__name__)


def _adapters_dir() -> Path:
    return settings.data_dir / "adapters"


def _adapter_dir(adapter_id: str) -> Path:
    return _adapters_dir() / adapter_id


def list_adapters() -> list[Adapter]:
    base = _adapters_dir()
    if not base.exists():
        return []
    adapters: list[Adapter] = []
    for d in sorted(base.iterdir()):
        meta_path = d / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
            size = sum(f.stat().st_size for f in d.rglob("*.safetensors"))
            adapters.append(Adapter(
                adapter_id=meta["adapter_id"],
                name=meta["name"],
                base_model=meta.get("base_model", ""),
                dataset_id=meta.get("dataset_id", ""),
                dataset_name=meta.get("dataset_name", ""),
                adapter_path=str(d),
                size_bytes=size,
                created_at=meta.get("created_at", ""),
                merged=meta.get("merged", False),
                merged_model_path=meta.get("merged_model_path", ""),
            ))
        except Exception as e:
            logger.warning("Failed to read adapter meta %s: %s", d, e)
    return adapters


def get_adapter(adapter_id: str) -> Adapter | None:
    meta_path = _adapter_dir(adapter_id) / "meta.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text())
    d = _adapter_dir(adapter_id)
    size = sum(f.stat().st_size for f in d.rglob("*.safetensors"))
    return Adapter(
        adapter_id=meta["adapter_id"],
        name=meta["name"],
        base_model=meta.get("base_model", ""),
        dataset_id=meta.get("dataset_id", ""),
        dataset_name=meta.get("dataset_name", ""),
        adapter_path=str(d),
        size_bytes=size,
        created_at=meta.get("created_at", ""),
        merged=meta.get("merged", False),
        merged_model_path=meta.get("merged_model_path", ""),
    )


def save_adapter_meta(adapter: Adapter) -> None:
    d = Path(adapter.adapter_path)
    d.mkdir(parents=True, exist_ok=True)
    meta = {
        "adapter_id": adapter.adapter_id,
        "name": adapter.name,
        "base_model": adapter.base_model,
        "dataset_id": adapter.dataset_id,
        "dataset_name": adapter.dataset_name,
        "created_at": adapter.created_at,
        "merged": adapter.merged,
        "merged_model_path": adapter.merged_model_path,
        "config": {
            "epochs": adapter.config.epochs,
            "learning_rate": adapter.config.learning_rate,
            "lora_rank": adapter.config.lora_rank,
            "lora_layers": adapter.config.lora_layers,
            "batch_size": adapter.config.batch_size,
            "max_seq_length": adapter.config.max_seq_length,
        },
    }
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))


def delete_adapter(adapter_id: str) -> bool:
    d = _adapter_dir(adapter_id)
    if not d.exists():
        return False
    shutil.rmtree(d)
    return True


async def merge_adapter(adapter_id: str) -> str:
    """Fuse LoRA adapter into base model, creating a standalone merged model.

    Returns the path to the merged model directory.
    """
    adapter = get_adapter(adapter_id)
    if not adapter:
        raise ValueError(f"Adapter not found: {adapter_id}")

    if adapter.merged:
        return adapter.merged_model_path

    import asyncio

    def _do_merge() -> str:
        try:
            from mlx_lm import fuse  # type: ignore[import-untyped]
        except ImportError:
            raise RuntimeError("mlx-lm not installed — cannot merge adapter")

        merged_path = str(_adapters_dir() / f"{adapter_id}_merged")

        fuse.main(fuse.FuseArgs(
            model=adapter.base_model,
            adapter_file=str(Path(adapter.adapter_path) / "adapters.safetensors"),
            save_path=merged_path,
            de_quantize=False,
        ))

        return merged_path

    merged_path = await asyncio.to_thread(_do_merge)

    adapter.merged = True
    adapter.merged_model_path = merged_path
    save_adapter_meta(adapter)

    logger.info("Merged adapter %s → %s", adapter.name, merged_path)
    return merged_path
