# Contributing

OVO MLX에 기여해줘서 고마워 💕

## 개발 철학

- **로컬 우선**: 모든 기능은 인터넷 없이 돌아야 함. 예외는 명시적으로 (web_search 같은 opt-in).
- **모델-agnostic**: Qwen, Llama, Gemma, DeepSeek 등 어떤 MLX 모델이 와도 동작. 특정 모델 의존 금지.
- **Claude Code 패리티**: 기능 추가 시 "Claude Code는 어떻게 할까?" 자문. Tool use, think 블록, 멀티턴 에이전트 loop 등.
- **UX 친화**: 에러는 한국어 + 영어 둘 다. 다국어 지원 (react-i18next).

## 코딩 컨벤션

### TypeScript/React
- 파일 상단에 `[START] Phase N — 목적` 주석으로 컨텍스트 표시.
- 기존 파일 수정 시: `// [START] Phase N — 변경 이유` / `// [END]` 블록으로 변경점 마크.
- 스토어는 Zustand. `useXStore((s) => s.field)` 선택자 패턴.
- 비동기는 `async/await` + `try/catch` 항상.
- `any`/`unknown` 최소화. `unknown`은 명시적 narrowing 필수.
- `React.memo`, `useMemo`, `useCallback`은 측정된 이유 있을 때만.

### Rust
- `#[tauri::command]` 시그니처는 `Result<T, String>`.
- 파일시스템 접근은 반드시 `safe_resolve`로 스코프 체크.
- 외부 프로세스 실행은 argv로 분리 (절대 shell 이스케이프 수동 하지 말 것).
- State는 `Mutex<T>` 로 감싸서 `app.manage()`.

### Python (Sidecar)
- FastAPI endpoint는 `ovo.py`, `openai.py`, `ollama.py` 중 API flavor에 맞는 곳에.
- 타입 힌트 필수 (`from __future__ import annotations` 권장).
- 무거운 import는 함수 내부로 (`from mlx_lm import ...`) — startup latency 방지.
- Optional dep은 ImportError catch → 501 HTTPException.

### i18n
- 하드코딩 문자열 금지. `t("...")` 로 통과.
- 새 키 추가 시 `ko.json` / `en.json` 둘 다 업데이트. 키 개수 같아야 CI 통과.

## 커밋 메시지

```
Phase N — 한 줄 제목 (과거형 or 명령형)

본문 (왜 이 변경이 필요했는지).
```

예:
```
Phase 5 — Inline Chat 드래그 트리거 ✨ 버튼 추가

Monaco 선택 영역 끝에 Sparkles 아이콘을 띄워 Cmd+I 외에도
클릭으로 Inline Chat을 열 수 있게 함. VS Code Copilot 스타일.
```

## PR 체크리스트

- [ ] `npx tsc --noEmit` 0 에러
- [ ] i18n ko/en 키 수 일치
- [ ] Python 사이드카 `ast.parse` 통과
- [ ] 파일 상단에 `[START] ... [END]` 블록으로 변경점 마크
- [ ] 브레이킹 체인지면 `CHANGELOG.md` 업데이트
- [ ] UI 변경은 스크린샷 첨부
- [ ] 자체 테스트 시나리오 본문에 명시 (E2E 자동화 전까지)

## 이슈 템플릿

### 버그
```
**모델**: (예: Qwen2.5-Coder-14B-Instruct-4bit)
**OVO 버전**: 0.0.x
**OS**: macOS 14.5 (M2)
**재현 단계**: ...
**기대 결과**: ...
**실제 결과**: ...
**로그** (상세모드 Settings로 켜서): ...
```

### 기능 제안
- 왜 필요한지 (유스케이스)
- 어느 패널/탭에 들어갈지
- 비슷한 레퍼런스 앱 (Cursor / Claude Code / etc)

## 개발 셋업

[BUILD.md](./BUILD.md) 참조.

## 리뷰 프로세스

- Maintainer 1명이 approve 하면 merge.
- 보안 영향 있는 PR은 SECURITY.md 체크리스트 갱신 필요.
- WIP은 Draft PR로.

💕 즐거운 코딩 되세요.
