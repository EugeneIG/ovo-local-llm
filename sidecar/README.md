# OVO Sidecar

FastAPI server that runs inside OVO Tauri app and exposes MLX LLM runtime.

## Ports

- `11435` — Ollama-compatible
- `11436` — OpenAI-compatible
- `11437` — Native OVO API

## Dev

```bash
# Project lives on a network/SMB mount? Set UV_PROJECT_ENVIRONMENT to a local APFS path
# (avoids file-copy permission issues with numpy/torch/etc.)
export UV_PROJECT_ENVIRONMENT="$HOME/Library/Caches/ovo-dev/sidecar-venv"

uv sync
uv run --no-sync ovo-sidecar
```

Or use the helper:

```bash
./scripts/dev.sh
```

## Layout

```
src/ovo_sidecar/
├── main.py           # FastAPI entry, mounts all routers
├── config.py         # Settings via pydantic-settings
├── mlx_runner.py     # mlx-lm wrapper
├── registry.py       # Local model registry (TOML)
├── hf_scanner.py     # Scan ~/.cache/huggingface/hub for MLX models
├── hf_downloader.py  # HF hub search + download
├── claude_bridge.py  # Optional Claude Code config reader
└── api/
    ├── ollama.py     # Ollama-compat routes
    ├── openai.py     # OpenAI-compat routes
    └── ovo.py        # Native OVO routes
```
