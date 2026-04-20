# OVO - All the LLMs. On device.

## Overview

OVO is a desktop application that brings the power of large language models directly to your Apple Silicon Mac. It's designed to run every open LLM locally, providing a seamless and privacy-focused experience.

## Key Features

- 🤖 **Every open LLM** — Support for MLX, HuggingFace Transformers, VLM (vision-language), diffusion image models
- 🧑‍💻 **Code IDE** — Monaco editor, file explorer, Git panel, PTY terminal, project search (Cmd+Shift+F), quick open (Cmd+P)
- 🪄 **AI inline completion** — FIM ghost text support for Qwen2.5-Coder, DeepSeek-Coder, StarCoder, CodeLlama
- 🎯 **Agent Chat** — file read/write/search/exec tools, MCP server integration with tool-call approval gates
- 📝 **Markdown preview** — live .md split view with tailwind-typography
- 📎 **Rich attachments** — PDF (PyMuPDF), Excel (SheetJS), Word (mammoth), images, 40+ text formats
- 🔍 **Wiki knowledge base** — persistent memory across sessions with BM25 + semantic search
- 🎙️ **Voice I/O** — Whisper STT + macOS TTS with auto language detection (ko / en / ja / zh)
- 🔌 **Ollama / OpenAI API compatible** — drop-in endpoints for existing clients
- 🧩 **Model Context Protocol** — extend the agent with MCP servers
- 🦉 **Desktop owl mascot** — SVG companion that reacts to your coding state (idle / thinking / typing / happy)
- 🔒 **Zero telemetry** — no analytics, no crash reports, no external API calls by default

## System Requirements

- macOS 13+ (Apple Silicon)
- M1 → M4 processors

## Installation

Download the latest DMG from [Releases](https://github.com/ovoment/ovo/releases)

## Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) for details.