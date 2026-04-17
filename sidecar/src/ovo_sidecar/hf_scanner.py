import json
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class ScannedModel:
    repo_id: str
    revision: str
    snapshot_path: Path
    size_bytes: int
    config: dict
    is_mlx: bool


def _repo_id_from_cache(cache_dir: Path) -> str:
    name = cache_dir.name
    if name.startswith("models--"):
        return name[len("models--"):].replace("--", "/")
    return name


def _detect_mlx(config: dict, files: list[Path]) -> bool:
    if any("mlx" in p.name.lower() for p in files):
        return True
    for key in ("quantization", "mlx_version"):
        if key in config:
            return True
    return False


def scan(cache_root: Path) -> list[ScannedModel]:
    if not cache_root.exists():
        return []

    results: list[ScannedModel] = []
    for model_dir in cache_root.iterdir():
        if not model_dir.is_dir() or not model_dir.name.startswith("models--"):
            continue

        snapshots_dir = model_dir / "snapshots"
        if not snapshots_dir.exists():
            continue

        for snapshot in snapshots_dir.iterdir():
            if not snapshot.is_dir():
                continue

            config_path = snapshot / "config.json"
            if not config_path.exists():
                continue

            try:
                config = json.loads(config_path.read_text())
            except (OSError, json.JSONDecodeError) as e:
                logger.debug("skip %s: %s", snapshot, e)
                continue

            files = list(snapshot.rglob("*"))
            size_bytes = sum(f.stat().st_size for f in files if f.is_file())
            repo_id = _repo_id_from_cache(model_dir)

            results.append(
                ScannedModel(
                    repo_id=repo_id,
                    revision=snapshot.name,
                    snapshot_path=snapshot,
                    size_bytes=size_bytes,
                    config=config,
                    is_mlx="mlx" in repo_id.lower() or _detect_mlx(config, files),
                )
            )

    return results
