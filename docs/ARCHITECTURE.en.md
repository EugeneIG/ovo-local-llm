# OVO Architecture

> Stack rationale and structural design document. As of 2026-04-17.

## Core Principles

1. **Apple Silicon Optimized** — Primary runtime is MLX (mlx-lm / mlx-vlm / mlx-whisper). Non-MLX checkpoints fall back to `transformers`. Intel Macs are not supported.
2. **HuggingFace Native** — No custom model store like Ollama. Directly uses `~/.cache/huggingface/hub/` + LM Studio cache as-is.
3. **Local Only** — Network calls are limited to model downloads (HF API) and user opt-in features (e.g., web_search). No remote LLM API calls by default.
4. **Claude Code Coexistence** — Optional integration. Never touches sensitive data such as account/session tokens.

## Stack Overview

```
┌─────────────────────────────────────────────────────────┐
│  Tauri 2 (Rust)                                         │
│  ├── Main window: React + TS + Tailwind + shadcn/ui     │
│  └── Pet window:  React + Canvas (sprite animation)     │
├─────────────────────────────────────────────────────────┤
│  Python Sidecar (FastAPI)                               │
│  ├── mlx-lm runtime                                     │
│  ├── HF cache scanner                                   │
│  ├── HF downloader                                      │
│  ├── Ollama-compat API (port 11435)                     │
│  ├── OpenAI-compat API  (port 11436)                    │
│  └── Native OVO API     (port 11437)                    │
├─────────────────────────────────────────────────────────┤
│  Filesystem                                             │
│  ├── ~/.cache/huggingface/hub/   (models)               │
│  ├── ~/Library/Application Support/OVO/                 │
│  │   ├── chats.sqlite                                   │
│  │   ├── settings.json                                  │
│  │   └── audit.log                                      │
│  └── (optional) CLAUDE.md, .claude/  (read-only)        │
└─────────────────────────────────────────────────────────┘
```

## Stack Rationale

### Tauri 2 (vs Electron)

| Criterion | Electron | Tauri 2 | Choice |
|-----------|----------|---------|:------:|
| App size | 150–300 MB | 3–15 MB | ✅ Tauri |
| RAM usage | 200–500 MB | 50–150 MB | ✅ Tauri |
| Startup speed | Slow | Very fast | ✅ Tauri |
| Backend language | Node.js | Rust | ✅ Tauri (stable process management for Python sidecar) |
| Transparent window / pet | Possible but heavy | Native-level | ✅ Tauri |
| Ecosystem | Large | Small but growing | Neutral |

LLM workloads consume significant memory, so the shell must stay lightweight. Tauri is the right call.

### Python Sidecar (vs pure Rust)

- **mlx-lm is Python-ecosystem-first** — Rust bindings exist but lag behind releases.
- Official HuggingFace libraries (`huggingface_hub`, `transformers`) are all Python.
- FastAPI enables rapid HTTP server development.
- PyInstaller packages into a single binary → bundled inside the Tauri app.

### FastAPI (vs Flask / Starlette)

- Type-hint-based automatic schema validation.
- Native SSE streaming support (essential for Ollama/OpenAI compatibility).
- Async-first design handles concurrent requests reliably.

### React + shadcn/ui

- Ecosystem breadth + component quality.
- shadcn/ui provides copy-pasteable components → minimal bundle overhead.
- Tailwind for consistent styling.

## Process Lifecycle

1. User launches the OVO app.
2. Tauri spawns the Python sidecar as a child process.
3. The sidecar starts servers on three ports (11435 / 11436 / 11437).
4. The frontend queries models, settings, etc. via port 11437 (Native API).
5. Chat routes through either OpenAI-compat (11436) or Native (11437).
6. On app exit, Tauri cleans up the sidecar process.

## API Design

### Ollama Compatible (port 11435)

```
GET  /api/tags              → List models
POST /api/chat              → Chat (SSE)
POST /api/generate          → Single generation
POST /api/pull              → Download model
```

### OpenAI Compatible (port 11436)

```
GET  /v1/models
POST /v1/chat/completions   (stream=true supported)
POST /v1/completions
POST /v1/embeddings         (planned)
```

### Native OVO (port 11437)

```
GET  /ovo/models            → Scan HF cache + details
GET  /ovo/models/search     → Search HF Hub (tag:mlx)
POST /ovo/models/download   → Start download
GET  /ovo/download/progress → SSE progress
DEL  /ovo/models/{name}
GET  /ovo/settings
PUT  /ovo/settings
GET  /ovo/claude/context    → Read Claude config (when opted in)
GET  /ovo/audit             → Audit log
```

## Model Detection Logic

1. Scan `~/.cache/huggingface/hub/`.
2. Read `config.json` from each snapshot directory.
3. Determine MLX format from file structure:
   - `*.safetensors` + `tokenizer.json` + `config.json`
   - No explicit `mlx` tag — filtered by `mlx-community/*` or `*-mlx` naming conventions.
4. Surface in the available-models list.

## Claude Integration (Optional)

### What OVO reads
- `.claude/` directories from `CWD` and parent directories (`.` → `..` → `~`).
- `CLAUDE.md`, `.claude/settings.json`, `.claude/plugins/**/*`.

### What OVO never reads
- `~/.claude/projects/**` (session logs).
- API keys, session tokens, `.credentials`.
- Browser cookies or storage.

### Audit
- Every scan is logged to `audit.log` (file path, size, hash).
- Audit history is viewable in the Settings UI.

## OVO Pet Architecture

Uses Tauri's multi-window capability to create a separate `pet.html` window:
- Transparent background (`transparent: true`)
- No decorations (`decorations: false`)
- Always on top (`alwaysOnTop: true`)
- Hidden from taskbar (`skipTaskbar: true`)
- Click-through on transparent regions (`setIgnoreCursorEvents(true)`)

Renders sprite-sheet animation on a Canvas element. Typing/inference state is relayed from the main window via IPC.

## Deployment

- `tauri build` → `OVO.app` + `.dmg`
- macOS notarization (manual, user-signed)
- Auto-update: Tauri updater (GitHub Releases based)

## Open Items

- [ ] Python sidecar packaging: PyInstaller vs py-pkg vs Shiv (affects DMG size)
- [ ] MLX model detection accuracy (extend beyond naming conventions if ML-level detection needed)
- [ ] MCP server mode implementation priority (Phase 6)
