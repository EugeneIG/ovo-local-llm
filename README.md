# OVO (MLX)

> 🦉 Local MLX LLM runtime with a walking desktop owl mascot. For Claude Code companions on Apple Silicon.

**Status**: Phase 0 — Scaffolding (2026-04-17)

## What is OVO?

OVO is a macOS desktop app that runs MLX-format LLMs locally on Apple Silicon with three distinctive traits:

1. **MLX-only** — no GGUF, no GGML, pure Apple Silicon acceleration
2. **HuggingFace-native** — auto-detects and re-uses existing `~/.cache/huggingface/hub/` models
3. **Claude Code companion** — optionally reads your `CLAUDE.md` / `.claude/` configs so the local LLM shares context with Claude Code
4. **Desktop owl mascot** — a pixel-art owl that walks your desktop, types alongside you, and responds using your local MLX model

## Requirements

- macOS 13+ on Apple Silicon (M1/M2/M3/M4)
- Node.js 20+
- Rust stable
- Python 3.12+
- `uv` (Python package manager)

## Architecture

- **Shell**: Tauri 2 (Rust)
- **Frontend**: React + TypeScript + Tailwind + shadcn/ui
- **Backend**: Python 3.12 FastAPI sidecar
- **MLX runtime**: `mlx-lm`
- **Model source**: HuggingFace hub (local cache)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Development

```bash
# install Tauri deps
npm install

# install Python sidecar deps
cd sidecar && uv sync && cd ..

# run dev server
npm run tauri dev
```

## API Compatibility

OVO exposes two HTTP APIs on local ports:

- **Ollama-compatible** (default port 11435) — drop-in replacement for Ollama clients
- **OpenAI-compatible** (default port 11436) — works with any OpenAI SDK

## Claude Code Integration (opt-in)

OVO can read (not write, not transmit) your local Claude Code config:

- `CLAUDE.md` — injected as system context
- `.claude/settings.json` — respects your preferences
- `.claude/plugins/**` — enriches model behavior

Disabled by default. Enable in **Settings → Claude Integration**.

OVO **never** touches claude.ai, API keys, session tokens, or anything that could compromise your Claude account.

## License

MIT
