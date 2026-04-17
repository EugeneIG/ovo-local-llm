import logging
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import tomli_w

from ovo_sidecar.config import settings

logger = logging.getLogger(__name__)


class Registry:
    """TOML-backed local model registry.

    Schema:
      default_model: str | None
      aliases: dict[alias, repo_id]
      history: list[{repo_id, downloaded_at}]
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._data: dict[str, Any] = {"default_model": None, "aliases": {}, "history": []}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            with self.path.open("rb") as f:
                loaded = tomllib.load(f)
            self._data = {**self._data, **loaded}
        except (OSError, tomllib.TOMLDecodeError) as e:
            logger.warning("registry parse failed, starting fresh: %s", e)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        serializable = {k: v for k, v in self._data.items() if v is not None}
        serializable.setdefault("aliases", {})
        serializable.setdefault("history", [])
        with self.path.open("wb") as f:
            tomli_w.dump(serializable, f)

    @property
    def default_model(self) -> str | None:
        return self._data.get("default_model")

    @default_model.setter
    def default_model(self, v: str | None) -> None:
        self._data["default_model"] = v
        self.save()

    @property
    def aliases(self) -> dict[str, str]:
        return dict(self._data.get("aliases") or {})

    def set_alias(self, alias: str, repo_id: str) -> None:
        aliases = self._data.setdefault("aliases", {})
        aliases[alias] = repo_id
        self.save()

    def resolve(self, name: str) -> str:
        return (self._data.get("aliases") or {}).get(name, name)

    def record_download(self, repo_id: str) -> None:
        hist = self._data.setdefault("history", [])
        hist.append({"repo_id": repo_id, "downloaded_at": datetime.now(UTC).isoformat()})
        self.save()

    def snapshot(self) -> dict[str, Any]:
        return {
            "default_model": self.default_model,
            "aliases": self.aliases,
            "history": list(self._data.get("history") or []),
        }


registry = Registry(settings.registry_path)
