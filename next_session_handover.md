# OVO (MLX) — 세션 핸드오버

> **작성일:** 2026-04-17 (2nd pass)
> **인계 방향:** 이전 세션 → 다음 세션
> **현재 위치:** Phase 0, 1 완료 + **E2E 런타임 검증 통과** + **LM Studio 통합** / Phase 2 or 4 선택지

---

## 프로젝트 한줄 요약

Apple Silicon 전용 macOS 데스크톱 앱. MLX 로컬 LLM 런타임 + Ollama/OpenAI 호환 API + 애니메이션 부엉이 마스코트. Tauri 2(React+TS+Tailwind) + FastAPI(mlx-lm) 사이드카. **HF 캐시 + LM Studio 캐시 둘 다 자동 인식**. Claude Code 보조 도구로 공존 설계.

**경로:** `/Volumes/docker/project/ovomlx`

---

## 최근 커밋 (최신 → 과거)

```
04a9f4f  feat(sidecar): multi-cache model discovery — HF + LM Studio
b89a1d2  docs: next_session_handover — Phase 0/1 완료 상태 + Phase 2 이후 선택지 인계
46c7531  feat(sidecar): Phase 1 — MLX runtime + HF downloader + Ollama/OpenAI/OVO APIs
8eda1d1  feat(owl): gaze tracking + pixel thought bubble + error glitch + dynamic typing wings
70929fd  feat(owl): per-state animations + thinking bubble + typing keyboard
2930b23  feat(owl): reusable Owl React component with 8 states + size presets
741a763  chore: gitignore build artifacts (tsbuildinfo)
e6f32d2  feat: scaffold OVO Phase 0 — Tauri + Python sidecar + owl brand
```

---

## 이번 세션에서 한 일 (추가분)

### 1. E2E 런타임 검증 통과 🎯

- `mlx-community/Qwen3.6-35B-A3B-nvfp4` (19GB, nvfp4 quant, Qwen3_5MoE) 로 검증
- **OpenAI `/v1/chat/completions`**: SSE `data:` 청크 실시간 스트리밍 ✅
- **Ollama `/api/chat`**: NDJSON 실시간 스트리밍, `done_reason` + `prompt_eval_count` + `eval_count` 전부 정상 ✅
- 사이드카 3포트(11435/11436/11437) 모두 healthy
- mlx-lm이 nvfp4 양자화 + MoE(Qwen3_5MoeForConditionalGeneration) 둘 다 잘 로드함

### 2. LM Studio 캐시 통합 (신규 기능)

**문제:** 이전 스캐너는 `~/.cache/huggingface/hub/`만 봐서 LM Studio에 있는 MLX 모델 5개를 전부 놓쳤음.

**해결:**
- `config.py`: `lmstudio_cache_dir: Path = ~/.lmstudio/models` 추가
- `hf_scanner.py`:
  - `scan_lmstudio(root)` — `<org>/<repo>/config.json` 레이아웃 처리
  - `scan_all()` — HF + LM Studio 합쳐서 반환, repo_id 충돌 시 HF 우선
  - `resolve_path(repo_id)` — mlx-lm에 넘길 로컬 filesystem path 찾기
  - `ScannedModel.source: str` 필드 추가 (`"hf"` | `"lmstudio"`)
- 3개 API 전부 업데이트:
  - `/ovo/models`: 11개 모델 merged 리스트, `cache_dirs` 응답
  - `/v1/models`: `owned_by`에 source 노출
  - `/api/tags`: Ollama에도 통합 리스트
  - chat 핸들러: `_resolve_ref(name) = resolve_path(registry.resolve(name))` → LM Studio 모델도 로컬 로드
- DELETE: LM Studio 모델은 422 거부 (우리 스토어 아님 — `~/.cache/huggingface/hub/`만 관리)

**결과:** 모델 개수 6개 → **11개**로 증가. 전부 로컬 로드, 중복 다운로드 없음.

### 3. 현재 인식되는 모델 11개

| Source | repo_id | 크기 |
|--------|---------|------|
| hf | JANGQ-AI/MiniMax-M2.7-JANG_3L | 88GB |
| hf | JANGQ-AI/MiniMax-M2.7-JANG_2L | 62GB |
| hf | mlx-community/gemma-4-31b-it-bf16 | 58GB |
| hf | mlx-community/gemma-4-31b-it-8bit | 31GB |
| hf | mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16 | 4GB (TTS, chat 불가) |
| hf | Jiunsong/supergemma4-26b-abliterated-multimodal-mlx-8bit | 26GB |
| lmstudio | cloudyu/GPT-OSS-120B-2experts-MLX-q4... | 59GB |
| lmstudio | m-i/Qwen3.5-40B-Claude-4.6-Opus-Deckard... | 38GB |
| lmstudio | inferencerlabs/gemma-4-31B-MLX-9bit | 33GB |
| lmstudio | **mlx-community/Qwen3.6-35B-A3B-nvfp4** ← 검증됨 | 19GB |
| lmstudio | mlx-community/gpt-oss-20b-MXFP4-Q8 | 11GB |

---

## Phase 0 ~ Phase 1 상태 (기존)

- ✅ Tauri 2 + React + TS + Tailwind 스캐폴드
- ✅ Python sidecar uv + pyproject
- ✅ `docs/ARCHITECTURE.md`
- ✅ 부엉이 브랜드 SVG `public/owl.svg`
- ✅ `src/components/Owl.tsx` — 8 states × 5 sizes, 픽셀아트 말풍선/에디터/날개 타이핑
- ✅ mlx_runner, registry, hf_downloader, hf_scanner(+ LM Studio), ovo/ollama/openai APIs
- ✅ 3포트(11435/11436/11437) 서비스 기동 + `/healthz`
- ✅ **mlx-lm inference end-to-end 검증 통과** (이번 세션)
- [ ] PyInstaller 단일 바이너리 패키징 (Phase 8에 해도 됨)
- [ ] `claude_bridge.py` (Phase 6)

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

1. **커밋 최신 확인:** `git log --oneline -5` — 맨 위가 `04a9f4f feat(sidecar): multi-cache...` 여야 함.
2. **RTK 상태 확인:** `rtk --version` — 커맨드 rewrite가 작동하는지. curl 응답이 스키마 요약으로 오면 정상. 실제 JSON이 필요하면 `rtk proxy curl ...`.
3. **사이드카 dev 실행:**
   ```bash
   cd /Volumes/docker/project/ovomlx/sidecar
   ./scripts/dev.sh
   ```
   venv는 `$HOME/Library/Caches/ovo-dev/sidecar-venv` 에 있음.
4. **모델 확인:** `rtk proxy curl -s http://127.0.0.1:11437/ovo/models | jq '.count, .models[].repo_id'` — 11개 나오면 OK.
5. **프론트 dev (React 단독):** `cd /Volumes/docker/project/ovomlx && npm run dev`
6. **Tauri 통합 실행:** (아직 미구현) `npm run tauri dev` — 현재는 React-only 테스트 페이지만 있음.

---

## 🔥 반드시 지킬 주의사항

### 금지
- ❌ `git config` 글로벌 수정 금지. 커밋 시 `git -c user.name=OVO -c user.email=ovo@ovoment.com commit ...` 사용.
- ❌ Playwright MCP 브라우저 프리뷰 사용 금지 — 세션 멈춤. `npm run build` 성공으로 검증.
- ❌ `any` / `unknown` 타입 금지, `alert()` 금지.
- ❌ 부분 구현 금지 — 시작했으면 끝까지.
- ❌ 모델 포맷 GGUF 지원 금지 (MLX 전용).
- ❌ Ollama 처럼 별도 모델 저장소 만들지 말 것. HF 캐시 + LM Studio 캐시만 **읽기 전용**으로 인식. 다운로드는 오직 `~/.cache/huggingface/hub/`로.

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

## Phase 2 이후 남은 선택지

E2E 런타임 검증(4번)은 이번 세션에 끝남. 다음 세션은 아래 중 택1:

1. **Phase 2-3 Chat UI** — sidebar + streaming 채팅창. 부엉이가 `thinking`/`typing`/`happy`/`error` 상태로 실시간 반응. OpenAI `/v1/chat/completions` fetch SSE 소비. Zustand/Jotai 상태관리. **이제 런타임 검증됐으니 UI 얹어도 안전.**
2. **Phase 4 Model Management UI** — HF 검색/다운로드/삭제 + LM Studio 모델 리스팅 그리드. source 배지 UI 포함. `/ovo/models/search` + `/ovo/models/download` + `/ovo/models` 연동. 11개 모델 중 source별 그룹핑 필요.
3. **Phase 7 OVO Pet** — 투명 Tauri sub-window. `project_ovo_pet_settings.md` 메모리 참조해서 우클릭 메뉴 + Settings 윈도우까지.
4. **Tauri 통합 (Phase 2 인프라)** — `src-tauri/` 본격 설정. 사이드카 subprocess spawn + IPC + 앱 셸. UI보다 이거 먼저 해야 진짜 데스크톱 앱 됨.

**추천 순서:** 4(Tauri 인프라) → 1(Chat UI) → 2(Model UI) → 3(Pet). UI 작업 들어가기 전에 Tauri subprocess spawn이 먼저 필요. 하지만 오빠가 고르는 대로.

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
- **모델 캐시 경로 두 군데:**
  - `~/.cache/huggingface/hub/` (HF Hub 다운로드 — OVO가 관리)
  - `~/.lmstudio/models/` (LM Studio — 읽기만, 삭제 거부)

---

## 마지막 한마디 (다음 세션 첫 메시지용)

> 다음 세션 시작할 때 이 파일부터 `Read` 하고, 사용자한테 "오빠, Tauri subprocess spawn(4번)부터 갈까 아니면 Chat UI(1번)부터 갈까?" 물어보고 진행.
> 커밋 히스토리(`git log --oneline -5`)로 최신 상태 한 번 더 확인 필수.
> 런타임은 검증됐으니 이제 UI/Tauri 쪽으로 무게중심 이동.

🦉💕✨
