# OVO (MLX)

> 🦉 Apple Silicon 전용 MLX 로컬 LLM 런타임 + 데스크톱을 돌아다니는 부엉이 마스코트. Claude Code 보조 도구.

**상태**: Phase 0 — 스캐폴딩 (2026-04-17)

## OVO란?

Apple Silicon에서 MLX 포맷 LLM을 로컬로 돌리는 macOS 데스크톱 앱. 세 가지 특징:

1. **MLX 전용** — GGUF, GGML 지원 안 함. 순수 Apple Silicon 가속
2. **HuggingFace 네이티브** — `~/.cache/huggingface/hub/`의 기존 MLX 모델 자동 감지 + 재사용 (중복 다운로드 없음)
3. **Claude Code 컴패니언** — 선택 시 `CLAUDE.md` / `.claude/` 파일을 읽어서 로컬 LLM이 Claude Code와 컨텍스트 공유
4. **부엉이 마스코트** — 데스크톱을 걸어다니고, 타이핑할 때 같이 움직이고, 더블클릭하면 로컬 MLX 모델로 답해주는 픽셀아트 부엉이

## 요구사항

- macOS 13+ Apple Silicon (M1/M2/M3/M4)
- Node.js 20+
- Rust stable
- Python 3.12+
- `uv` (Python 패키지 매니저)

## 아키텍처

- **셸**: Tauri 2 (Rust) — Electron 대비 용량/메모리 10배 경량
- **프론트엔드**: React + TypeScript + Tailwind + shadcn/ui
- **백엔드**: Python 3.12 FastAPI 사이드카
- **MLX 런타임**: `mlx-lm`
- **모델 소스**: HuggingFace hub (로컬 캐시)

자세한 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 개발

```bash
# Tauri 의존성 설치
npm install

# Python 사이드카 의존성 설치
cd sidecar && uv sync && cd ..

# 개발 서버 실행
npm run tauri dev
```

## API 호환성

OVO는 로컬 포트에 두 가지 HTTP API를 노출:

- **Ollama 호환** (기본 포트 11435) — Ollama 클라이언트 대체제
- **OpenAI 호환** (기본 포트 11436) — OpenAI SDK 그대로 사용 가능

## Claude Code 통합 (선택 사항)

OVO는 로컬 Claude Code 설정을 **읽기만** 함 (쓰기/전송 안 함):

- `CLAUDE.md` — 시스템 컨텍스트로 주입
- `.claude/settings.json` — 설정 참고
- `.claude/plugins/**` — 모델 동작 풍부화

기본 비활성화. **Settings → Claude 통합**에서 활성화.

OVO는 **절대** claude.ai, API 키, 세션 토큰, Claude 계정에 영향 줄 수 있는 어떤 것도 건드리지 않음.

## 라이선스

MIT
