# OVO Code IDE Pane - Implementation Plan

## Context
OVO는 Tauri 2 + React 18 데스크톱 앱으로 로컬 MLX 모델을 실행한다. 현재 Chat/Image/Wiki/Models/Settings 패인이 있고, CodePane은 플레이스홀더 상태. 이걸 VS Code 수준의 풀 IDE로 구축한다.

## Target Layout
```
+----------+--------------+-------------------------+------------------+
| Sidebar  | File         | Top: Monaco editor tabs  | Agent Chat       |
| + Recent | Explorer     |-------------------------|  (독립 대화창)   |
| Code     | + Search     | Bottom: Terminal (bash)  | + 이미지 첨부    |
| Sessions | + Git panel  |                         | + 파일 자동 조작 |
+----------+--------------+-------------------------+------------------+
```

---

## Phase 1: Foundation (Monaco + File Explorer + 기본 파일 I/O)

### 1.1 New Dependencies
```json
{
  "dependencies": {
    "@monaco-editor/react": "^4.6.0"
  },
  "devDependencies": {
    "vite-plugin-monaco-editor": "^1.1.0"
  }
}
```

### 1.2 New Rust Module - `src-tauri/src/code_fs.rs`

프로젝트 범위 내 파일 I/O 전용. 기존 read_md_file과 달리 확장자 제한 없음.

| Command | 설명 |
|---------|------|
| `code_fs_list_tree(project_root)` | 재귀 디렉토리 트리 반환. .git/, node_modules/, __pycache__/, .DS_Store 제외. depth 10 cap |
| `code_fs_read_file(project_root, path)` | 파일 읽기. 5MB cap. 바이너리는 base64 인코딩 |
| `code_fs_write_file(project_root, path, content)` | 파일 쓰기. 부모 디렉토리 자동 생성 |
| `code_fs_create_file(project_root, path)` | 새 빈 파일 생성 |
| `code_fs_rename(project_root, from, to)` | 파일/디렉토리 이름 변경 |
| `code_fs_delete(project_root, path, force)` | 파일/디렉토리 삭제. 비어있지 않으면 force 필요 |
| `code_fs_mkdir(project_root, path)` | 디렉토리 생성 (with parents) |

보안: 모든 명령에서 project_root 하위 경로만 허용 (canonicalize + starts_with 검증)

### 1.3 DB Migration - `src-tauri/migrations/006_code_sessions.sql`
```sql
CREATE TABLE IF NOT EXISTS code_sessions (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  project_path   TEXT NOT NULL,
  open_files     TEXT,
  active_file    TEXT,
  model_ref      TEXT,
  pinned         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_code_sessions_updated ON code_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS code_session_messages (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES code_sessions(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool_result')),
  content        TEXT NOT NULL,
  attachments_json TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_code_messages_session ON code_session_messages(session_id, created_at ASC);
```

### 1.4 New Frontend Files

| File | 역할 |
|------|------|
| `src/types/code.ts` | CodeSession, FileTreeNode, OpenTab 타입 정의 |
| `src/db/code_sessions.ts` | SQLite CRUD (sessions.ts 패턴 미러) |
| `src/store/code_sessions.ts` | 코드 세션 Zustand 스토어 (.load() 부트스트랩) |
| `src/store/code_editor.ts` | 파일 트리, 열린 탭, 에디터 상태 관리 |
| `src/components/code/FileExplorer.tsx` | 트리 뷰 + 우클릭 컨텍스트 메뉴 (새 파일/폴더/이름변경/삭제) |
| `src/components/code/EditorTabs.tsx` | 탭 바 (dirty 표시, 닫기 버튼, 가운데 클릭 닫기) |
| `src/components/code/MonacoEditor.tsx` | Monaco 래퍼 (OVO 커스텀 테마, Cmd+S 저장) |
| `src/components/code/CodeRecentsPanel.tsx` | 사이드바 최근 코드 세션 패널 (RecentsPanel 패턴 미러) |

### 1.5 Modify Existing Files

| File | 변경 내용 |
|------|----------|
| `src-tauri/src/lib.rs` | mod code_fs, migration v6 등록, invoke_handler에 명령 추가 |
| `src/panes/CodePane.tsx` | 플레이스홀더를 3-column IDE 레이아웃으로 교체 |
| `src/components/Sidebar.tsx` | active === "code" 일 때 CodeRecentsPanel 렌더 |
| `src/components/AppShell.tsx` | useCodeSessionsStore.getState().load() 부트스트랩 추가 |
| `vite.config.ts` | Monaco 워커 플러그인 추가 |
| `package.json` | 의존성 추가 |
| `src/locales/en.json` | code 관련 i18n 키 추가 |
| `src/locales/ko.json` | code 관련 i18n 키 추가 |

### 1.6 Type Definitions - `src/types/code.ts`
```typescript
export interface CodeSession {
  id: string;
  title: string;
  project_path: string;
  open_files: string[];
  active_file: string | null;
  model_ref: string | null;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface FileTreeNode {
  path: string;
  name: string;
  is_dir: boolean;
  size_bytes: number;
  modified_at: number;
  children?: FileTreeNode[];
}

export interface OpenTab {
  path: string;
  name: string;
  language: string;
  modified: boolean;
  content: string;
  savedContent: string;
}
```

### 1.7 i18n Keys (Phase 1)

**English (en.json)**:
```
code.title = Code
code.open_folder = Open Folder
code.no_project = Open a folder to start coding
code.file_explorer = Explorer
code.unsaved_changes = Unsaved changes
code.save = Save
code.save_all = Save All
code.new_file = New File
code.new_folder = New Folder
code.rename = Rename
code.delete = Delete
code.delete_confirm = Delete {{name}}?
code.recents.title = Code Sessions
code.recents.new = New Session
code.recents.empty = No code sessions yet
code.recents.search_placeholder = Search sessions
code.recents.pinned = PINNED
code.recents.recent = RECENT
```

**Korean (ko.json)**:
```
code.title = 코드
code.open_folder = 폴더 열기
code.no_project = 코딩을 시작하려면 폴더를 여세요
code.file_explorer = 탐색기
code.unsaved_changes = 저장되지 않은 변경
code.save = 저장
code.save_all = 모두 저장
code.new_file = 새 파일
code.new_folder = 새 폴더
code.rename = 이름 변경
code.delete = 삭제
code.delete_confirm = {{name}}을(를) 삭제할까?
code.recents.title = 코드 세션
code.recents.new = 새 세션
code.recents.empty = 아직 코드 세션이 없어
code.recents.search_placeholder = 세션 검색
code.recents.pinned = 고정됨
code.recents.recent = 최근
```

---

## Phase 2: Terminal + Git Integration

### 2.1 New Dependencies
```json
{
  "@xterm/xterm": "^5.5.0",
  "@xterm/addon-fit": "^0.10.0",
  "@xterm/addon-web-links": "^0.11.0"
}
```
Rust: `portable-pty = "0.8"` in Cargo.toml

### 2.2 New Rust Modules

#### `src-tauri/src/pty.rs` - PTY 터미널

| Command | 설명 |
|---------|------|
| `pty_spawn(project_root, cols, rows)` | 셸 프로세스 생성 ($SHELL 감지), pty_id 반환 |
| `pty_write(pty_id, data)` | PTY stdin에 바이트 전송 |
| `pty_resize(pty_id, cols, rows)` | 터미널 크기 변경 (SIGWINCH) |
| `pty_kill(pty_id)` | PTY 프로세스 종료 |

출력 스트리밍: tokio 태스크가 stdout 읽고 `pty://output` Tauri 이벤트로 emit

#### `src-tauri/src/git_ops.rs` - Git CLI 래퍼

| Command | git 명령 | 반환 |
|---------|---------|------|
| `git_status(project_root)` | `git status --porcelain=v2 --branch` | branch, files |
| `git_diff(project_root, path?, staged?)` | `git diff` | diff 텍스트 |
| `git_log(project_root, limit?)` | `git log --oneline` | commit 목록 |
| `git_commit(project_root, message)` | `git add -A && git commit` | commit hash |
| `git_branch_list(project_root)` | `git branch -a` | 브랜치 목록 |
| `git_checkout(project_root, branch)` | `git checkout` | void |
| `git_stage(project_root, path)` | `git add` | void |
| `git_unstage(project_root, path)` | `git restore --staged` | void |

### 2.3 New Frontend Files

| File | 역할 |
|------|------|
| `src/components/code/Terminal.tsx` | xterm.js 터미널 (PTY 이벤트 연결, FitAddon 리사이즈) |
| `src/components/code/GitPanel.tsx` | 소스 컨트롤 패널 (브랜치, staged/unstaged, 커밋) |
| `src/components/code/DiffViewer.tsx` | Monaco diff editor 래퍼 |
| `src/store/code_git.ts` | Git 상태 Zustand 스토어 |

### 2.4 Layout Update
CodePane 하단에 리사이즈 가능한 터미널 패널 추가.
좌측 사이드바 모드 전환 툴바: 탐색기 / 검색 / Git

---

## Phase 3: Agent Chat + 파일 자동 조작

### 3.1 핵심 컨셉
에이전트가 대화하면서 파일을 직접 생성/수정/삭제하고 셸 명령을 실행한다.
VS Code의 Copilot Chat / Claude Code 확장프로그램과 동일한 패턴.

### 3.2 New Rust Commands (code_fs.rs 확장)

| Command | 설명 |
|---------|------|
| `code_fs_search(project_root, pattern, path?, regex?)` | 프로젝트 내 grep. 결과 500건 cap |
| `code_fs_exec(project_root, command)` | 셸 명령 동기 실행. 30초 타임아웃 |
| `code_fs_watch_start(project_root)` | FSEvents 파일 감시 시작. Tauri 이벤트로 변경 전파 |
| `code_fs_watch_stop()` | 파일 감시 중지 |

New Rust dependency: `notify = { version = "6", features = ["macos_fsevent"] }`

### 3.3 Agent Tools (코드 에이전트 전용 built-in)
```
read_file    - 파일 내용 읽기
write_file   - 파일 쓰기/생성
create_file  - 새 파일 생성
delete_file  - 파일 삭제
list_dir     - 디렉토리 목록
run_command  - 셸 명령 실행
search_files - 파일 내용 검색
rename_file  - 파일 이름 변경
```

### 3.4 New Frontend Files

| File | 역할 |
|------|------|
| `src/store/code_agent.ts` | 에이전트 대화 스토어 (chat.ts 패턴 미러, tool loop max 10) |
| `src/components/code/AgentChat.tsx` | 우측 에이전트 대화 패널 (이미지 첨부, ModelSelector) |
| `src/components/code/AgentToolResult.tsx` | 도구 실행 결과 인라인 표시 |
| `src/lib/codeAgentTools.ts` | 도구 정의 + dispatch 라우팅 |

### 3.5 파일 감시 통합
- setProjectPath() 시 code_fs_watch_start 호출
- code://fs-change 이벤트 수신하여 트리/탭 자동 갱신
- 더티 탭은 디스크 변경 알림 표시
- cleanup 시 code_fs_watch_stop 호출

---

## Phase 4: AI Code Completion (Inline)

### 4.1 Model Lifecycle 변경
model_lifecycle.py에 상호 배타적 정책 추가:
```
unload_all_except_slot(keep_slot) - keep_slot 외 모든 슬롯 언로드
```
- 코드 모델 로드 시에는 채팅/이미지 모델 언로드
- 채팅/이미지 모델 로드 시에는 코드 모델 언로드

### 4.2 New Sidecar Endpoint
`POST /ovo/code/complete`:
- Request: model, prefix, suffix, language, max_tokens, temperature
- Response: SSE 스트리밍 delta
- FIM (Fill-In-the-Middle) 프롬프트 포맷 자동 감지

### 4.3 Monaco Integration
MonacoEditor.tsx에 InlineCompletionItemProvider 등록:
- 300ms 디바운스 후 completion 요청
- prefix = 커서 앞 텍스트, suffix = 커서 뒤 텍스트
- Tab 수락, Esc 거절 (ghost text)

### 4.4 New File
- `src/lib/codeCompletion.ts` - SSE 소비자 (streamCodeCompletion)

---

## Phase 5: Polish (검색, Quick Open, 설정, 키바인딩)

### 5.1 프로젝트 검색
- `src/components/code/SearchPanel.tsx`
- Cmd+Shift+F, regex/대소문자/전체단어 토글
- 파일별 결과 그룹, 클릭으로 해당 위치 열기

### 5.2 Quick Open
- `src/components/code/QuickOpen.tsx`
- Cmd+P 파일 퍼지 검색 모달

### 5.3 에디터 설정
code_editor 스토어에 editorSettings 추가:
- 폰트 크기 (12-24)
- 탭 크기 (2/4/8)
- 자동 줄바꿈 (on/off)
- 미니맵 (on/off)
- 줄 번호 (on/off)
- 자동 저장 (off / afterDelay / onFocusChange)
- localStorage에 영속화

### 5.4 키바인딩

| 키 | 동작 |
|----|------|
| Cmd+S | 파일 저장 |
| Cmd+W | 탭 닫기 |
| Cmd+P | Quick Open |
| Cmd+Shift+F | 검색 패널 |
| Cmd+` | 터미널 토글 |
| Cmd+Shift+E | 파일 탐색기 |
| Cmd+Shift+G | Git 패널 |

---

## Phase 실행 순서
```
Phase 1 (Foundation)  <-  먼저 구현
  +-- Phase 2 (Terminal + Git)
  |     +-- Phase 3 (Agent Chat)  <-  terminal exec 의존
  |           +-- Phase 4 (AI Completion)  <-  model lifecycle 변경
  +-- Phase 5 (Polish)  <-  Phase 1 이후 병렬 가능
```

## 전체 New Files 요약

### Rust (src-tauri/src/)
- `code_fs.rs` - 파일 I/O + 검색 + 파일 감시
- `pty.rs` - PTY 터미널 관리
- `git_ops.rs` - Git CLI 래퍼

### Migration
- `src-tauri/migrations/006_code_sessions.sql`

### TypeScript (src/)
- `types/code.ts`
- `db/code_sessions.ts`
- `store/code_sessions.ts`
- `store/code_editor.ts`
- `store/code_git.ts`
- `store/code_agent.ts`
- `lib/codeAgentTools.ts`
- `lib/codeCompletion.ts`
- `components/code/FileExplorer.tsx`
- `components/code/EditorTabs.tsx`
- `components/code/MonacoEditor.tsx`
- `components/code/CodeRecentsPanel.tsx`
- `components/code/Terminal.tsx`
- `components/code/GitPanel.tsx`
- `components/code/DiffViewer.tsx`
- `components/code/AgentChat.tsx`
- `components/code/AgentToolResult.tsx`
- `components/code/SearchPanel.tsx`
- `components/code/QuickOpen.tsx`

## Verification Checklist
- [ ] Phase 1: 폴더 열기 > 트리 표시 > 파일 편집 > Cmd+S 저장 > 최근 세션 표시
- [ ] Phase 2: 터미널에서 ls, git status > Git 패널에서 커밋
- [ ] Phase 3: 에이전트에 "foo.ts 만들어줘" > 파일 생성 > 탐색기/에디터 반영
- [ ] Phase 4: .ts 편집 중 ghost text 자동완성 > Tab 수락
- [ ] Phase 5: Cmd+P 파일 검색 > Cmd+Shift+F 프로젝트 검색

## Risk Areas
1. Monaco 번들 크기 (~4MB) - lazy load + Vite 워커 플러그인으로 완화
2. PTY on macOS - portable-pty + Apple Silicon + Tauri 샌드박싱 호환성 테스트 필요
3. 파일 감시 성능 - node_modules 등 대량 이벤트 필터링 필수 (notify debounce)
4. 모델 상호 배타 - Phase 4의 slot 정책 변경이 기존 채팅/이미지에 영향. 피처 플래그 권장
5. 메모리 - Monaco + xterm + 다수 파일 버퍼. 탭 20개 제한 + LRU 퇴거 정책

---

## Session #1 Progress (2026-04-18)

### Completed
- [x] Phase 1: Foundation (Monaco + FileExplorer + 세션 + CodeRecentsPanel)
- [x] Phase 2: Terminal (xterm.js + PTY) + Git (status/diff/log/commit/branch)
- [x] Phase 3: Agent Chat + 검색 패널 + 모델 선택/언로드
- [x] 리사이즈 핸들 (탐색기/에디터/터미널/에이전트 드래그 조절)
- [x] 부엉이 상태 연동 (thinking/typing/happy/error)
- [x] YAML tool_use 파싱 (오픈소스 모델 호환)
- [x] 사이드카 auto-restart 무한루프 수정 (60초 안정 후 카운터 리셋)
- [x] VLM 토큰 카운팅 수정 (mlx-vlm usage 0 버그)
- [x] 코드 리뷰 12개 버그 수정 + 교차검증

### Created Files (22+)
- Rust: code_fs.rs, pty.rs, git_ops.rs
- Migration: 006_code_sessions.sql
- Types: types/code.ts
- DB: db/code_sessions.ts
- Stores: code_sessions.ts, code_editor.ts, code_git.ts, code_agent.ts
- Components: MonacoEditor, EditorTabs, FileExplorer, CodeRecentsPanel, Terminal, GitPanel, DiffViewer, AgentChat, SearchPanel, ResizeHandle
- Lib: codeAgentTools.ts

---

## Next Session: 채팅-에이전트 기능 동등화

### 접근법: 공유 함수 추출
채팅의 _sendOne 로직을 공유 함수(lib/chatEngine.ts)로 추출하여
채팅과 코드 에이전트가 동일한 엔진을 사용. 코드 에이전트 전용 도구만 추가 주입.

### A그룹 - 필수 (에이전트가 제대로 동작)
1. 시스템 프롬프트 주입 - 프로필 페르소나, honorific, 프로젝트 컨텍스트(CLAUDE.md), 스킬 카탈로그, MCP 도구, Wiki FTS
2. MCP 도구 + 빌트인 도구(web_search, memory_*) 통합
3. wire 정규화 (빈 메시지 제거, 역할 병합)
4. 샘플링 파라미터 (temperature, top_p, repetition_penalty)
5. 반복 감지 (repetition guard)

### B그룹 - UX 동일성 (채팅처럼 보이려면)
6. 말풍선 컴포넌트 공유 (ChatMessageBubble 재사용)
7. Think 블록 접기 UI
8. 코드 블록 구문 하이라이팅
9. 슬래시 커맨드 (/wiki, /models 등)
10. 이미지/오디오 첨부 + 드래그앤드롭

### C그룹 - 폴리시
11. 완료 사운드 (owl hoot)
12. 토큰 사용량 추적 + perf 기록
13. 자동 압축 (auto-compact)
14. 큐/인터럽트 모드

### Phase 4: AI 인라인 자동완성
- model_lifecycle.py에 unload_all_except_slot 추가
- POST /ovo/code/complete (FIM 엔드포인트)
- Monaco InlineCompletionItemProvider

### Phase 5: 에디터 설정 + Quick Open
- Cmd+P 파일 퍼지 검색
- 폰트 크기, 탭 크기, 자동 줄바꿈, 미니맵, 자동 저장 설정
