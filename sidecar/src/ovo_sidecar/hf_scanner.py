import json
import logging
from dataclasses import dataclass
from pathlib import Path

from ovo_sidecar.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ScannedModel:
    repo_id: str
    revision: str
    snapshot_path: Path
    size_bytes: int
    config: dict
    is_mlx: bool
    source: str = "hf"
    capabilities: tuple[str, ...] = ("text",)


# [START] Modality detection — HF config.json signals which non-text modalities
# the model actually supports. `model_type` is the primary signal (matches
# Transformers' registry); sub-config presence is a fallback for custom/new
# architectures. Each modality is independent so a single model can claim
# multiple (e.g. Phi-4-multimodal has vision + audio).
_VISION_MODEL_TYPES: frozenset[str] = frozenset({
    "qwen2_vl", "qwen2_5_vl", "qwen3_vl",
    "llava", "llava_next", "llava_onevision", "llava_next_video",
    "minicpmv",
    "idefics2", "idefics3",
    "mllama",
    "internvl_chat",
    "paligemma",
    "phi3_v",
    "phi4_multimodal",
    "gemma3",
    "mistral3",
    "smolvlm",
    "pixtral",
})

_AUDIO_MODEL_TYPES: frozenset[str] = frozenset({
    "phi4_multimodal",
    "qwen2_audio",
    "qwen2_5_omni",
})


def detect_capabilities(config: dict) -> tuple[str, ...]:
    model_type = str(config.get("model_type") or "").lower()
    caps: list[str] = ["text"]

    has_vision = (
        model_type in _VISION_MODEL_TYPES
        or "vision_config" in config
        or "vision_tower" in config
    )
    has_audio = (
        model_type in _AUDIO_MODEL_TYPES
        or "audio_config" in config
        or "audio_processor_config" in config
    )

    if has_vision:
        caps.append("vision")
    if has_audio:
        caps.append("audio")
    return tuple(caps)
# [END]


def _repo_id_from_cache(cache_dir: Path) -> str:
    name = cache_dir.name
    if name.startswith("models--"):
        return name[len("models--"):].replace("--", "/")
    return name


def _detect_mlx(config: dict, files: list[Path], repo_id: str = "") -> bool:
    if "mlx" in repo_id.lower():
        return True
    if any("mlx" in p.name.lower() for p in files):
        return True
    for key in ("quantization", "mlx_version"):
        if key in config:
            return True
    return False


def _build_scanned(
    repo_id: str,
    revision: str,
    snapshot: Path,
    source: str,
) -> ScannedModel | None:
    config_path = snapshot / "config.json"
    if not config_path.exists():
        return None
    try:
        config = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        logger.debug("skip %s: %s", snapshot, e)
        return None
    files = [p for p in snapshot.rglob("*") if p.is_file()]
    size_bytes = sum(f.stat().st_size for f in files)
    return ScannedModel(
        repo_id=repo_id,
        revision=revision,
        snapshot_path=snapshot,
        size_bytes=size_bytes,
        config=config,
        is_mlx=_detect_mlx(config, files, repo_id),
        source=source,
        capabilities=detect_capabilities(config),
    )


def scan(cache_root: Path) -> list[ScannedModel]:
    """Scan HF Hub cache layout: `models--Org--Repo/snapshots/<rev>/`."""
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
            repo_id = _repo_id_from_cache(model_dir)
            sm = _build_scanned(repo_id, snapshot.name, snapshot, "hf")
            if sm is not None:
                results.append(sm)

    return results


# [START] LM Studio cache scanner — layout: `<org>/<repo>/<files directly>`
def scan_lmstudio(cache_root: Path) -> list[ScannedModel]:
    """Scan LM Studio cache layout: `<org>/<repo>/config.json`.

    LM Studio does not track HF revisions, so revision is a stable hash-like
    string derived from the snapshot path.
    """
    if not cache_root.exists():
        return []

    results: list[ScannedModel] = []
    for org_dir in cache_root.iterdir():
        if not org_dir.is_dir() or org_dir.name.startswith("."):
            continue
        for repo_dir in org_dir.iterdir():
            if not repo_dir.is_dir():
                continue
            repo_id = f"{org_dir.name}/{repo_dir.name}"
            sm = _build_scanned(repo_id, "lmstudio", repo_dir, "lmstudio")
            if sm is not None:
                results.append(sm)
    return results
# [END]


# [START] Combined scan + path resolver (used by all model-listing APIs)
def scan_all() -> list[ScannedModel]:
    """Return HF + LM Studio models merged, HF wins on repo_id collision."""
    hf_models = scan(settings.hf_cache_dir)
    ls_models = scan_lmstudio(settings.lmstudio_cache_dir)
    seen = {m.repo_id for m in hf_models}
    merged = list(hf_models)
    for m in ls_models:
        if m.repo_id in seen:
            continue
        merged.append(m)
        seen.add(m.repo_id)
    return merged


def resolve_path(repo_id: str) -> Path | None:
    """Given a repo_id, return the local filesystem path if discoverable."""
    for m in scan_all():
        if m.repo_id == repo_id:
            return m.snapshot_path
    return None


def resolve_capabilities(repo_id: str) -> tuple[str, ...]:
    """Look up capabilities for a local model by repo_id. Unknown → text-only."""
    for m in scan_all():
        if m.repo_id == repo_id:
            return m.capabilities
    return ("text",)
# [END]
