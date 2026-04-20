from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OVO_", env_file=".env", extra="ignore")

    ollama_port: int = 11435
    openai_port: int = 11436
    native_port: int = 11437

    hf_cache_dir: Path = Path.home() / ".cache" / "huggingface" / "hub"
    # [START] LM Studio cache integration — discover MLX models from LM Studio layout
    lmstudio_cache_dir: Path = Path.home() / ".lmstudio" / "models"
    # [END]
    # [START] Custom model directories — comma-separated absolute paths
    extra_model_dirs: str = ""
    # [END]
    data_dir: Path = Path.home() / "Library" / "Application Support" / "OVO"

    default_model: str | None = None
    default_context_length: int = 4096
    # [START] Phase 8 — raise max generation cap. 4096 silently truncated long
    # agent answers (Plan docs, full-file rewrites) with no error frame. 16384
    # is ~32 KB of Korean text — enough for Implementation Plan md output.
    # User can override via /ovo/settings PATCH if they need more.
    max_tokens_cap: int = 16384
    # [END]

    expose_to_network: bool = False

    claude_integration_enabled: bool = False
    claude_read_claude_md: bool = False
    claude_read_settings: bool = False
    claude_read_plugins: bool = False

    log_level: str = "info"

    @property
    def registry_path(self) -> Path:
        return self.data_dir / "registry.toml"

    @property
    def audit_log_path(self) -> Path:
        return self.data_dir / "audit.log"

    @property
    def chats_db_path(self) -> Path:
        return self.data_dir / "chats.sqlite"

    # [START] Phase 7 — per-user images output dir for diffusion runner.
    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"
    # [END]

    @property
    def extra_model_paths(self) -> list[Path]:
        if not self.extra_model_dirs.strip():
            return []
        return [Path(p.strip()) for p in self.extra_model_dirs.split(",") if p.strip()]

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # [START] Phase 7 — ensure images dir exists before first save.
        self.images_dir.mkdir(parents=True, exist_ok=True)
        # [END]


settings = Settings()
