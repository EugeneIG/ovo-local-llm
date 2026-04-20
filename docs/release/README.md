# OVO MLX

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/ovoment)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

**"All the LLMs. On device."** — Apple Silicon 전용 로컬 LLM 런타임 + Tauri 데스크톱 IDE.

## What is this?

OVO MLX는 로컬에서 LLM을 돌리는 데스크톱 앱입니다. Claude Code / Cursor 같은 코딩 에이전트 기능을 **완전히 로컬**로 구현하는 것이 목표. 외부 API 호출 없이, 당신의 노트북에서만 동작합니다.

### 핵심 기능

- 🤖 **로컬 MLX LLM 채팅** — Qwen, Llama, DeepSeek, Gemma 등 MLX 포맷 모든 모델
- 💻 **코드 IDE** — Monaco 에디터 + 파일 탐색기 + Git 패널 + 터미널
- 🪄 **AI 인라인 자동완성** — FIM 기반 ghost text (Qwen2.5-Coder / DeepSeek-Coder / StarCoder / CodeLlama)
- 🎯 **Agent Chat** — 파일 읽기/쓰기/검색/실행 도구를 가진 코딩 에이전트
- 📝 **Markdown Preview** — .md 파일 split-view 라이브 프리뷰
- 📎 **다양한 파일 첨부** — PDF (PyMuPDF), 엑셀 (SheetJS), Word (mammoth), 이미지
- 🔍 **Wiki 지식베이스** — 세션 간 영속 메모리, BM25 + 임베딩 검색
- 🎙️ **음성 입력/출력** — Whisper STT + macOS TTS (한/영/일/중 자동 음성)
- 🔌 **OpenAI/Ollama API 호환** — 3rd party 클라이언트 연동
- 🦉 **데스크톱 부엉이 펫** — 항상 위에 뜨는 작은 마스코트
- 🧩 **MCP 서버 통합** — Model Context Protocol 도구 확장

## 시스템 요구사항

- **macOS 13.0+** (Ventura 이상)
- **Apple Silicon** (M1/M2/M3/M4) — Intel Mac 미지원
- **16GB+ RAM** 권장 (7B 모델 기준, 14B+는 32GB 권장)
- **10GB+ 여유 디스크** (모델 1-2개 + 앱)

## 설치

### DMG 설치 (권장)

1. [Releases](https://github.com/USER/ovo-mlx/releases)에서 최신 `.dmg` 다운로드
2. 더블클릭 → Applications 폴더로 드래그
3. **Gatekeeper 우회**: 첫 실행 시 "손상된 파일" 에러 나오면:
   ```bash
   xattr -cr /Applications/OVO.app
   ```
4. 실행 → 첫 시작 시 모델 없음. Models 탭 → HF 검색으로 `mlx-community/Qwen2.5-Coder-14B-Instruct-4bit` 등 다운로드

### 소스에서 빌드

[BUILD.md](./BUILD.md) 참조.

## 빠른 시작

1. **모델 다운로드**: Models 탭 → HF 검색 → "Qwen2.5-Coder-14B" → Install
2. **채팅**: Chat 탭 → 모델 선택 → 메시지 보내기
3. **IDE 모드**: Code 탭 → Open Folder → 프로젝트 선택 → 에이전트에게 작업 요청
4. **파일 첨부**: 대화창 좌측 `+` → PDF/Excel/이미지 첨부 → 분석 요청

## 지원 모델 티어

| Tier | 모델 | 툴 사용 | 비고 |
|------|------|:-----:|------|
| 🟢 Supported | Qwen3, Qwen2.5-Coder, Llama 3.1+, DeepSeek-Coder/R1, Mistral/Mixtral/MiniMax | 안정 | 추천 |
| 🟡 Experimental | Gemma, Phi-1/2/3, TinyLlama | 불안정 | 환각 가능 |
| ⚪ Unverified | 그 외 | - | 실사용 시 확인 필요 |

FIM 인라인 자동완성은 **Coder 계열** 필요: Qwen2.5-Coder / DeepSeek-Coder / StarCoder / CodeLlama.

## 라이선스

MIT — [LICENSE](../../LICENSE) 참조.

## 보안 이슈 제보

[SECURITY.md](./SECURITY.md) 참조.

## 기여

[CONTRIBUTING.md](./CONTRIBUTING.md) 참조.

---

💡 자세한 개발 배경, 아키텍처, 디자인 결정은 [IDE.md](../../IDE.md)에.
