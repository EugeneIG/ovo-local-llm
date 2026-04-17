# OVO (MLX) — Development Plan

> Tauri 2 기반 macOS 데스크톱 앱. Apple Silicon 전용 MLX 로컬 LLM 런타임.
> Claude Code 보조 도구로 설계됨.

---

## Phase 0 — Environment & Scaffolding ✅

- [x] Verify toolchain: Node.js, npm, Rust, Python, mlx_lm
- [x] Install Rust (rustup stable)
- [x] Create project directory `/Volumes/docker/project/ovomlx`
- [x] Write initial `tasks/todo.md` (this file)
- [x] Write `README.md` + `README.ko.md`
- [x] Write `.gitignore`
- [x] Write `docs/ARCHITECTURE.md` (stack rationale)
- [x] Initialize git repo
- [x] Initialize Tauri 2 project (manual scaffold, React + Vite + TS + Tailwind)
- [x] Initialize Python sidecar (FastAPI + mlx-lm, local APFS venv)
- [x] Verify: `npm run build` ✅, HF scanner detects 11 models from `~/.cache/huggingface/hub/` ✅
- [x] OVO owl brand SVG placed at `public/owl.svg`

## Phase 1 — Python Sidecar (FastAPI + mlx-lm)

- [ ] `sidecar/pyproject.toml` — uv-managed
- [ ] `sidecar/src/ovo_sidecar/main.py` — FastAPI entry
- [ ] `sidecar/src/ovo_sidecar/mlx_runner.py` — mlx-lm wrapper
- [ ] `sidecar/src/ovo_sidecar/registry.py` — local model registry (TOML-backed)
- [ ] `sidecar/src/ovo_sidecar/hf_scanner.py` — scan `~/.cache/huggingface/hub/` for MLX models
- [ ] `sidecar/src/ovo_sidecar/hf_downloader.py` — HF API search + download
- [ ] `sidecar/src/ovo_sidecar/api/ollama.py` — Ollama-compat endpoints
- [ ] `sidecar/src/ovo_sidecar/api/openai.py` — OpenAI-compat endpoints
- [ ] `sidecar/src/ovo_sidecar/api/ovo.py` — Native OVO endpoints (model list, download progress, etc.)
- [ ] Streaming support (SSE) for chat responses
- [ ] PyInstaller or similar → single-file binary for Tauri sidecar bundling

## Phase 2 — Tauri Frontend (React + shadcn/ui)

- [ ] Set up Vite + React + TypeScript + Tailwind
- [ ] Install shadcn/ui (dialog, button, input, toggle, slider, tabs)
- [ ] Configure Tauri to spawn Python sidecar on start
- [ ] Global state: Zustand or Jotai
- [ ] IPC layer: Tauri commands ↔ Python sidecar HTTP
- [ ] App shell: sidebar + main pane (Ollama-like layout)
- [ ] i18n: `react-i18next` with `ko.json` / `en.json`

## Phase 3 — Chat UI

- [ ] `ChatSidebar`: New Chat button, conversation history grouped by date
- [ ] `ChatMessage`: user / assistant bubbles (no Ollama-style branding)
- [ ] `ChatInput`: textarea + send button + model selector dropdown
- [ ] Streaming display (token-by-token render)
- [ ] Markdown rendering (code blocks, tables)
- [ ] Copy message button
- [ ] Conversation persistence (SQLite via `tauri-plugin-sql`)

## Phase 4 — Model Management UI

- [ ] `ModelsPage`: grid/list view of local MLX models
- [ ] Auto-detect from HF cache (no double-download)
- [ ] `ModelBrowser`: HuggingFace MLX model search (tag filter: `mlx`)
- [ ] Download progress with cancel support
- [ ] Model size, quantization, estimated RAM display
- [ ] Delete model (confirm dialog)

## Phase 5 — Settings UI

- [ ] `SettingsPage` tabs: General / Models / API / Claude Integration
- [ ] General: language (ko/en), theme, launch-on-login
- [ ] Models: HF cache path, default model, context length slider
- [ ] API: Ollama-compat port (default 11435), OpenAI-compat port (default 11436), expose to network toggle
- [ ] Claude Integration (opt-in):
  - [ ] Toggle: "Read Claude config files"
  - [ ] Checkboxes: CLAUDE.md / .claude/settings.json / plugins
  - [ ] Toggle: "Expose OVO as MCP server" (advanced)
  - [ ] Security banner: "OVO only reads files. Never transmits to external services."

## Phase 6 — Claude Code Integration (opt-in)

- [ ] `claude_bridge.py`: scan current working dir + parent dirs for `.claude/` + `CLAUDE.md`
- [ ] Context injection: prepend found files to system prompt (with size cap)
- [ ] MCP server mode: implement Anthropic MCP protocol (stdio) to expose OVO as a tool to Claude Code
- [ ] Settings-gated: default OFF, explicit opt-in required
- [ ] Audit log: record what files were read, display in Settings

## Phase 7 — OVO Pet (Desktop Owl Mascot)

> Inspired by `clawd-on-desk` (Electron) but **reimplemented in Tauri** as OVO sub-window.
> Integrates with local LLM via Python sidecar.

- [ ] Second Tauri window: `pet.html` (transparent, always-on-top, no decorations, skip taskbar)
- [ ] Click-through on transparent areas (Tauri `setIgnoreCursorEvents`)
- [ ] Pixel-art owl sprite sheet — states: `idle`, `walking`, `typing`, `thinking`, `sleep`, `react`, `notification`
- [ ] Eye-tracking idle (follows cursor)
- [ ] Drag-to-move + snap-to-edge (mini mode)
- [ ] Double-click → speech bubble + local LLM query
- [ ] Typing detection (global key events, only when OVO focused) → `typing` animation
- [ ] LLM generation state → `thinking` animation
- [ ] Idle detection (5 min) → `sleep`
- [ ] System tray menu: enable/disable, size (S/M/L), DND mode
- [ ] Settings UI tab: Pet section with toggles
- [ ] Save position across restarts

## Phase 8 — Polish & Distribution

- [ ] Owl icon design (SVG → PNG → .icns)
- [ ] App metadata (bundle id, version, about pane)
- [ ] macOS notarization flow (manual, user-signed)
- [ ] `tauri build` → `.dmg`
- [ ] Release script (`scripts/release.sh`)
- [ ] Auto-updater config

## Phase 8 — Testing

- [ ] Unit tests: Python sidecar (`pytest`)
- [ ] E2E tests: Tauri WebDriver
- [ ] Manual test matrix: Apple Silicon M1/M2/M3/M4
- [ ] Model compatibility tests: popular MLX models (gemma, qwen, llama, phi)

---

## Open Questions

- Sidecar packaging: PyInstaller vs Shiv vs py-pkg? (impacts .dmg size)
- Should we support GGUF (non-MLX)? → **No, MLX-only per user request**
- Default language detection: `NSLocale` via Tauri or fallback to system? → TBD in Phase 5

## Review Section

_(populated at end of each phase)_
