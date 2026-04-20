# Changelog

## [0.0.1] — 2026-04-20 (미공개, 개발 중)

### ✨ 추가
- **Phase 4**: AI Inline Completion — FIM ghost text (Qwen Coder / DeepSeek / StarCoder / CodeLlama)
  - Monaco `InlineCompletionsProvider` + 300ms 디바운스 (조정 가능)
  - 사이드카 `/ovo/code/complete` SSE 엔드포인트
  - 채팅↔FIM 우선권 시스템으로 동시 요청 충돌 방지
- **Phase 5 Polish**:
  - Cmd+P Quick Open (파일 퍼지 검색)
  - Cmd+Shift+F 프로젝트 검색 + 키바인딩
  - 에디터 설정 모달 (폰트/탭/wrap/미니맵/자동저장)
  - 키바인딩 (Cmd+W/\`/Shift+E/Shift+G)
- **Inline Chat** Cmd+I + ✨ 드래그 버튼 (VS Code Copilot 스타일)
- **Markdown Preview Enhanced** — .md 파일 split-view 라이브 프리뷰 (tailwind-typography)
- **AgentChat 패리티 A그룹**: Mic 음성 입력, 모델 추천 칩, 위키 #스니펫, 컴팩트 (/compact)
- **파일 첨부 확장**:
  - PDF (사이드카 PyMuPDF)
  - 엑셀/xlsx (SheetJS, 모든 시트 CSV)
  - Word/docx (mammoth)
  - 텍스트 전방위 (txt/md/csv/json/코드 확장자 40+)
- **툴 호출 파서 3단 방어**:
  - canonical `<tool_use>`
  - name-as-tag fallback (`<memory_search>...`)
  - raw JSON fallback (`{"name":...,"arguments":...}`)
- **모델 Tier 배지** — Supported / Experimental / Unknown (추천 엔진 가중치 포함)
- **하드웨어 적합도 llmfit 컬럼** — Score/tok/s/Quant/Mode/Mem%/Ctx/Use
- **부엉이 펫 위치 영속화** (Rust 파일 저장)
- **앱 아이콘** macOS squircle 스타일
- **브라우저 선택 기능** — Safari (기본) / Chrome / Firefox / Arc / Edge / Custom
- **웹/localhost URL 자동 열기** (run_command 감지 → 지정 브라우저)
- **Wiki auto-capture + 저장/검색** (BM25 FTS5)

### 🔒 보안 강화
- `code_fs_exec` deny-list (rm -rf, curl|sh, sudo, launchctl, keychain, dd 등)
- `code_fs_read_external_file` Rust-side attachment whitelist
- `fs:allow-remove` 범위를 `$APPDATA/{attachments,sql,images}/**` 로 축소
- 사이드카 `expose_to_network=true` 시 bearer token 강제 (loopback 제외)
- CORS origin allowlist (`allow_origins=*` 제거)
- CSP 활성화 (`object-src 'none'`, tight script-src)
- 브라우저 open은 argv 분리 (shell 이스케이프 우회 방지)
- Tool call allowlist (name-as-tag, raw JSON rescue에 필수)

### 🐛 수정
- First-token 타임아웃 60s → 5분 (14B/30B 콜드 로드 커버)
- FIM/chat 우선권 시스템으로 동시 요청 시 60초 대기 현상 해결
- Vision 모델이 `<think>` 블록에 답변 trap 되는 현상 복구
- PDF 파싱 Tauri WebView ReadableStream 호환성 (사이드카 PyMuPDF로 이관)
- MCP 자동 재시작 (재시작마다 수동 클릭 필요했던 문제)
- 사용자 메시지 bubble에서 `<attached_files>` XML 노출
- Tool result 메시지 오른쪽 정렬 (왼쪽으로 수정)
- Self-talk 패턴 확장 (한/영/중, "The document..." 등 문서 분석 노이즈)
- TypeScript 3개 장기 에러 수정 (code_agent.ts, AgentChat.tsx, FileExplorer.tsx)

### 📚 문서
- `docs/release/` 공개 문서 정비 (README, BUILD, SECURITY, CONTRIBUTING, CHANGELOG, PRIVACY)

---

## [Pre-0.0.1] — 2026-04-18 (세션 #7)

### 안정성 가드
- Stuck 30s watchdog
- First-token timeout
- Malformed tool_use 복구
- jsonrepair 폴백
- tool_result 10KB 축약
- Context compaction (60KB)
- Self-abort 흡수
- Loop budget 5→50

### Grammar-Constrained Generation
- Outlines 1.x 통합 (`/ovo/tool_call` 엔드포인트)
- 프론트 rescue wiring

### UI 대규모 추가
- 탐색기 우클릭 메뉴 + 자동 새로고침
- Monaco 우클릭 OVO 그룹 (선택 영역 챗 추가 등)
- AgentChat 컴포저 카드화 + 슬래시 팔레트
- IME 한글 터미널 자체 구현 (Korean-IME.nvim 접근법)

### Model Lifecycle
- `unload_all_except_slot(keep_slot)` — 코드 모델 로드 시 이미지 등 언로드

---

형식은 [Keep a Changelog](https://keepachangelog.com/) 기준.
