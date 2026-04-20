# Security Policy

## 지원 버전

현재 0.0.x — 초기 개발. 보안 픽스는 최신 main 브랜치에만 반영.

## 취약점 제보

보안 취약점을 발견하면:
1. **공개 이슈로 올리지 마세요.**
2. security@ovoment.com 로 이메일 (또는 maintainer GitHub 프로필 연락처)
3. 48시간 내 응답 목표

## 위협 모델

### 커버 범위 (In-scope)

- 원격 공격자가 노출 모드(`expose_to_network=true`) 사이드카에 접근
- 악성 PDF/이미지/Wiki 페이지를 로드한 모델이 도구를 악용해 사용자 시스템을 손상
- XSS → RCE 체인 (React 이스케이프 우회)
- 모델 출력 프롬프트 인젝션으로 에이전트가 민감 파일 읽기/삭제
- MCP 서버 localStorage 주입으로 persistent RCE
- 첨부 파일 경로 traversal

### 커버 바깥 (Out-of-scope)

- 이미 로컬 루트 권한 가진 공격자
- 물리 접근 공격
- HuggingFace에서 다운로드한 모델 자체의 weights 악성
- macOS 시스템 권한 / FileVault 신뢰 이슈

## 현재 방어막 (Phase 5 기준)

### 셸 실행
- `code_fs_exec` — 에이전트의 셸 실행은 Rust deny-list로 필터링 (rm -rf, curl|sh, sudo, launchctl, keychain, dd 등). 터미널 패널은 사용자 직접 입력이라 필터 없음.
- `open -a` 로 브라우저 열 때 **Rust argv로 직접 실행** (shell 우회) + URL/앱 이름 둘 다 strict allowlist.

### 파일 접근
- `code_fs_read_file` — 프로젝트 루트 내부 한정 (canonicalize + starts_with).
- `code_fs_read_external_file` — Rust-side whitelist (`AttachmentWhitelist` state). 사용자가 UI로 첨부한 절대 경로만 읽기 가능.
- `fs:allow-remove` — `$APPDATA/attachments`, `$APPDATA/sql`, `$APPDATA/images` 서브트리로 스코프 제한.

### 사이드카 HTTP
- `expose_to_network=true` 시 bearer token 강제 (loopback 제외). 토큰은 `data_dir/auth_token.txt` (chmod 600).
- CORS origin allowlist: `http://localhost:1420`, `tauri://localhost` 만. `allow_origins=*` 금지.

### 프론트엔드
- CSP 활성화: `object-src 'none'`, script-src에 `'unsafe-inline'` 제외 (Tauri IPC + Monaco blob worker 허용).
- 직접 HTML 삽입 API 사용처 0건.
- react-markdown 기본 sanitization.

### 툴 호출 파서
- `parseToolUseBlock` 3단 방어 (canonical → name-as-tag → raw JSON) — BUILTIN_TOOL_NAMES allowlist에 있는 도구만 rescue 대상.
- `<think>`, `<editor_selection>` 등 예약 태그는 도구로 오해 금지.
- Grammar-constrained (Outlines) fallback이 code agent 루프에 내장.

### MCP
- Auto-start 시 localStorage configs를 best-effort로 재시작. 재확인 프롬프트는 계획된 추가 사항.

## 알려진 이슈 / 설계상 취약점

### xlsx ReDoS
`xlsx@0.18.5` has `GHSA-5pgg-2g8v-p4x9` ReDoS + `GHSA-4r6h-8v6p-xvw6` prototype pollution. 업스트림 라이선스 이슈로 패치 미제공. 첨부 업로드는 단일 사용자가 의도적으로 행하는 trusted input이라 실질 위험 낮음. 장기적으로 pymupdf처럼 사이드카로 이관 검토.

### pdfjs-dist v3
Tauri WebView 호환성 때문에 v3.11.174 (2023) 고정. v5 업그레이드는 worker + ReadableStream 이슈 해결 후 가능. PDF 파싱은 현재 사이드카 PyMuPDF 경로.

### MCP 서버 localStorage
사용자가 외부 소스에서 MCP config를 import하는 흐름이 생기면 악성 config가 자동 실행될 수 있음. UI는 아직 수동 설정만.

## 책임 있는 공개

취약점 제보 시:
- 48시간 내 접수 확인
- 합당한 경우 CVE 등록
- 픽스 릴리스 + 발견자 크레딧 (원하면)
- 30일 임베고 기본 (심각도에 따라 조정)
