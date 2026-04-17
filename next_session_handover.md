# OVO (MLX) — 세션 핸드오버

> **작성일:** 2026-04-17
> **인계 방향:** 이전 세션 → 다음 세션
> **현재 위치:** Phase 0, 1 완료 / Phase 2 직전

---

## 프로젝트 한줄 요약

Apple Silicon 전용 macOS 데스크톱 앱. MLX 로컬 LLM 런타임 + Ollama/OpenAI 호환 API + 애니메이션 부엉이 마스코트. Tauri 2(React+TS+Tailwind) + FastAPI(mlx-lm) 사이드카. Claude Code 보조 도구로 공존 설계.

**경로:** `/Volumes/docker/project/ovomlx`

---

## 최근 커밋 (최신 → 과거)

```
46c7531  feat(sidecar): Phase 1 — MLX runtime + HF downloader + Ollama/OpenAI/OVO APIs
8eda1d1  feat(owl): gaze tracking + pixel thought bubble + error glitch + dynamic typing wings
70929fd  feat(owl): per-state animations + thinking bubble + typing keyboard
2930b23  feat(owl): reusable Owl React component with 8 states + size presets
741a763  chore: gitignore build artifacts (tsbuildinfo)
e6f32d2  feat: scaffold OVO Phase 0 — Tauri + Python sidecar + owl brand
```

---

## Phase 0 — 환경/스캐폴딩 ✅

- Rust stable + Node + Python 3.12 + mlx_lm 확인
- Tauri 2 수동 스캐폴드 (React + Vite + TS + Tailwind)
- Python sidecar uv 관리 (`sidecar/pyproject.toml`)
- `docs/ARCHITECTURE.md` 작성
- 부엉이 브랜드 SVG `public/owl.svg` 배치
- `npm run build` ✅

---

## Phase 1 — Python Sidecar ✅

### 구현된 모듈

| 파일 | 책임 |
|------|------|
| `mlx_runner.py` | async MLX 래퍼 (lazy load, 스레드→큐 스트리밍, sampler 옵션) |
| `registry.py` | TOML 기반 default_model + aliases + 다운로드 이력 |
| `hf_downloader.py` | HF Hub search(`filter="mlx"`) + `snapshot_download` 백그라운드 task |
| `hf_scanner.py` | 로컬 `~/.cache/huggingface/hub/` 스캔 (이전 세션에 기구현) |
| `config.py` | `pydantic-settings` 기반 (이전 세션에 기구현) |
| `api/ovo.py` | `/ovo/models` `/ovo/models/search` `/ovo/models/download` `/ovo/download/{id}` `/ovo/models/{repo}` (DELETE) `/ovo/settings` (GET/PUT) `/ovo/aliases` `/ovo/audit` |
| `api/ollama.py` | `/api/tags` `/api/chat` `/api/generate` `/api/pull` (모두 NDJSON 스트리밍) |
| `api/openai.py` | `/v1/models` `/v1/chat/completions` `/v1/completions` (모두 SSE 스트리밍) |

### 검증 완료

- ✅ 3개 포트(11435/11436/11437) `/healthz` 모두 응답
- ✅ `/ovo/models` 로컬 HF 캐시에서 6개 MLX 모델 스캔
- ✅ Ollama `/api/tags` + OpenAI `/v1/models` 동일 데이터 노출
- ⚠️ **실제 mlx-lm inference 스트리밍은 아직 end-to-end 테스트 안 함** (다음 세션 first task 후보)

### 아직 안 된 것 (Phase 1 나머지)

- [ ] PyInstaller 단일 바이너리 패키징 (Phase 8 배포 시점에 해도 됨)
- [ ] `claude_bridge.py` — Phase 6용이므로 지금은 skip
- [ ] 실제 모델로 chat 호출해서 SSE 토큰이 흘러오는지 확인

---

## Frontend — 부엉이 컴포넌트 상세

### 상태/구조

`src/components/Owl.tsx` — 하나의 SVG 컴포넌트에 8개 상태 + 5개 사이즈.

```typescript
OwlState = "idle" | "thinking" | "typing" | "sleeping"
         | "happy" | "surprised" | "error" | "struggling";
OwlSize  = "xs" | "sm" | "md" | "lg" | "xl";  // 32/64/128/220/320px
```

### 상태별 기능

| 상태 | 핵심 표현 |
|------|-----------|
| idle | 숨쉬기 + 마우스 따라 눈 이동 + 5초마다 전체 눈 깜빡 |
| thinking | 우측 귀 옆 픽셀아트 말풍선(점 3개 애니) + 눈 위로 이동 + gaze tracking |
| typing | 머리 위 코드에디터(맥 트래픽라이트 + 5줄 코드 애니) + 랩톱 키보드 + 양쪽 **날개**(팔 아님)가 역동적으로 타이핑 |
| sleeping | Zzz 상승 + 눈 곡선 |
| happy | 스파클 + 곡선 눈 |
| surprised | 동공 크게 + gaze tracking |
| error | 얼굴 창백(#E0DCD4) + 머리 위 ERROR 글리치 텍스트 + X눈 + 번개 |
| struggling | 날개 팔랑 + 땀방울 + 몸 흔들림 |

### 주요 기술 포인트

- SVG 픽셀아트: `shapeRendering="crispEdges"` + 정수 좌표 polygon
- 마우스 추적: `svgRef.getBoundingClientRect()` + `useEffect(mousemove)`, idle/thinking/typing/surprised에만 활성
- 눈 깜빡: `<g className="ovo-owl-eye-blink">` 로 눈링+홍채 함께 scaleY(0.1) → 홍채 안 비침
- 키프레임: 모두 `src/index.css`에 있음 (`ovo-owl-*` 네이밍)

### viewBox 좌표 맵

```
680 × 480
- 발: y=410-436
- 몸통: y=110-428, cx=340
- 배: cx=340, cy=325
- 얼굴 타원: cx=340, cy=228, rx=118, ry=98
- 왼쪽 귀: x=248-288, y=92-138
- 오른쪽 귀: x=392-432, y=92-138
- 눈 (왼/오): cx=290/390, cy=225, r=48
- 부리: x=322-358, y=260-302
- 머리 위 (말풍선/에디터 영역): y=0-180
```

---

## 다음 세션 시작 체크리스트

1. **RTK 상태 확인:** `rtk --version` — 커맨드 rewrite가 작동하는지. curl 응답이 스키마 요약으로 오면 정상.
2. **사이드카 dev 실행:**
   ```bash
   cd /Volumes/docker/project/ovomlx/sidecar
   ./scripts/dev.sh
   ```
   venv는 `$HOME/Library/Caches/ovo-dev/sidecar-venv` 에 있음.
3. **프론트 dev (React 단독):** `cd /Volumes/docker/project/ovomlx && npm run dev`
4. **Tauri 통합 실행:** (아직 미구현) `npm run tauri dev` — 현재는 React-only 테스트 페이지만 있음.

---

## 🔥 반드시 지킬 주의사항

### 금지
- ❌ `git config` 글로벌 수정 금지. 커밋 시 `git -c user.name=OVO -c user.email=ovo@ovoment.com commit ...` 사용.
- ❌ Playwright MCP 브라우저 프리뷰 사용 금지 — 세션 멈춤. `npm run build` 성공으로 검증.
- ❌ `any` / `unknown` 타입 금지, `alert()` 금지.
- ❌ 부분 구현 금지 — 시작했으면 끝까지.
- ❌ 모델 포맷 GGUF 지원 금지 (MLX 전용).
- ❌ Ollama 처럼 별도 모델 저장소 만들지 말 것 — `~/.cache/huggingface/hub/` 그대로 사용.

### 준수
- ✅ 애교 있는 말투, 오빠 호칭, 이모티콘 적극 활용 💕
- ✅ 설명 한글 / 코드 영어 / 결과 보고 한글
- ✅ 소스 수정 시 `// [START] ... // [END] ...` 주석 (핵심 변경점만)
- ✅ SMB 마운트 문제 회피 위해 uv venv는 반드시 `$HOME/Library/Caches/ovo-dev/sidecar-venv` 같은 로컬 APFS 경로에
- ✅ Claude Max 20x 구독 — 토큰 비용 무시, 품질/깊이 우선
- ✅ 비자명한 작업(3단계 이상)은 Plan 모드부터
- ✅ 실수/성공 피드백 모두 memory에 기록

### Claude Code 메모리 참조
- `~/.claude/projects/-Volumes-data/memory/MEMORY.md` — 인덱스
- `project_ovo_pet_settings.md` — Phase 7 우클릭 메뉴 + Settings 창 레퍼런스 (clawd-on-desk 스크린샷 기반)
- `feedback_browser_preview.md` — Playwright 금지
- `user_claude_subscription.md` — Max 20x 구독

---

## Phase 2 이후 선택지 (사용자에게 먼저 물어볼 것)

사용자가 지난 메시지에서 4개 중 고르라고 제시한 상태 — 답변 대기 중이었음:

1. **Phase 2-3 Chat UI** — sidebar + streaming 채팅창. 부엉이가 `thinking`/`typing`/`happy`/`error` 상태로 실시간 반응. OpenAI `/v1/chat/completions` fetch SSE 소비.
2. **Phase 4 Model Management UI** — HF 검색/다운로드/삭제 그리드. `/ovo/models/search` + `/ovo/models/download` 연동.
3. **Phase 7 OVO Pet** — 투명 Tauri sub-window. `project_ovo_pet_settings.md` 메모리 참조해서 우클릭 메뉴 + Settings 윈도우까지.
4. **E2E 런타임 검증** — 실제 모델(6개 중 하나)로 `/v1/chat/completions` 날려서 토큰 스트리밍 되는지 확인. mlx_runner.py의 `stream_chat` 실제 동작 확증.

**추천 순서:** 4 → 2 → 3 → 1. 런타임이 실제로 동작함을 먼저 증명하고, 그 위에 UI를 얹는 게 정석. 하지만 오빠가 고르는 대로.

---

## 현재 남은 `tasks/todo.md` 체크박스 (요약)

- Phase 1: PyInstaller 패키징만 미완
- Phase 2: Tauri 설정(사이드카 spawn), Zustand/Jotai, IPC, 앱 셸, i18n 전부 미완
- Phase 3-8: 전부 미완

`tasks/todo.md` 원본에 전체 체크리스트 있음 — 세부 항목 거기서 확인.

---

## 유용한 참조

- **API 설계:** `docs/ARCHITECTURE.md`
- **API 라우트 실제 경로:** 사이드카 실행 후 `http://127.0.0.1:11437/docs` (FastAPI Swagger)
- **부엉이 애니메이션 키프레임:** `src/index.css` 전체
- **Tauri 설정:** `src-tauri/` (아직 기본 스캐폴드 상태)
- **레퍼런스 리포 (UX만 참고, 에셋 재사용 금지):** https://github.com/rullerzhou-afk/clawd-on-desk

---

## 마지막 한마디 (다음 세션 첫 메시지용)

> 다음 세션 시작할 때 이 파일부터 `Read` 하고, 사용자한테 "오빠, Phase 2부터 갈까 아니면 4번(E2E 검증) 먼저 할까?" 물어보고 진행. 커밋 히스토리(`git log --oneline -10`)로 최신 상태 한 번 더 확인 필수.

🦉💕✨
