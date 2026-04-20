# Release Checklist

정식 릴리즈 전 점검 사항.

## 코드 품질

- [ ] `npx tsc --noEmit` — 0 에러
- [ ] `python3 -c "import ast; [ast.parse(open(f).read()) for f in [...]]"` — 사이드카 파일 모두 ok
- [ ] `cargo check` — 0 경고 이상 (warnings 허용)
- [ ] i18n ko/en 키 개수 일치 (node one-liner)
- [ ] `npm audit` — HIGH/CRITICAL 모두 해결 또는 문서화 (xlsx는 known)
- [ ] 모든 TODO/HACK/FIXME 주석 주석 정리 or 이슈 트래커

## 기능 검증 (수동)

### Chat
- [ ] 7B 모델 로드 → "안녕" 응답 받음
- [ ] 비전 모델(Qwen2-VL) → 이미지 첨부 → 분석 응답
- [ ] PDF 첨부 → 본문 요약 (사이드카 pymupdf 경로)
- [ ] 엑셀 첨부 → 시트 분석
- [ ] 음성 입력 → Whisper 전사 → Yuna TTS 출력
- [ ] Wiki #스니펫 삽입 (슬래시)
- [ ] 모델 추천 칩 표시 + 적용
- [ ] 툴 호출 (`web_search`) → 결과 통합

### Code IDE
- [ ] 폴더 열기 → 트리 표시
- [ ] Monaco 편집 + Cmd+S 저장
- [ ] 탭 20개 이상 → LRU 퇴거
- [ ] Cmd+P Quick Open → 파일 이동
- [ ] Cmd+Shift+F 검색 → 결과 이동
- [ ] Cmd+I Inline Chat → 선택 영역 치환 → Cmd+Z 롤백
- [ ] 드래그 → ✨ 버튼 → Inline Chat
- [ ] FIM 자동완성 (Coder 모델 필요) → 300ms 후 ghost text
- [ ] 에이전트에 "Button.tsx 만들어" → 파일 생성 → 트리 반영
- [ ] 에이전트 + dev server 실행 → 지정 브라우저 자동 열기
- [ ] 터미널 + 한글 IME 토글

### 프리뷰
- [ ] .md 파일 → Eye 버튼 → split-view 라이브 프리뷰
- [ ] 헤딩/표/코드/인용/링크 스타일 일관

### 시스템
- [ ] MCP 서버 등록 → 앱 재시작 → 자동 재시작 확인
- [ ] 부엉이 펫 이동 → 재시작 → 위치 복원
- [ ] 사이드카 `expose_to_network=true` → bearer 토큰 강제 확인 (외부에서 curl 401)
- [ ] 사이드카 로그 `.omc/logs/` 에 비밀번호/토큰 유출 없음

## 보안

- [ ] `code_fs_exec`에 `rm -rf ~` 시도 → blocked
- [ ] `code_fs_read_external_file` 에 `/etc/passwd` 직접 호출 → whitelist 에러
- [ ] MCP auto-start 로그가 외부에 유출 안 됨
- [ ] CSP가 `object-src 'none'` 에서 plugin 로드 차단 확인
- [ ] `.app` 실행 시 Keychain 접근 시도 없음

## 번들

- [ ] `npm run tauri build` — `OVO.app` 생성
- [ ] `OVO_0.0.1_aarch64.dmg` 생성
- [ ] `.dmg` 더블클릭 → Applications로 드래그 → 실행
- [ ] Gatekeeper 우회 명령 문서화 (`xattr -cr ...`)
- [ ] (이상적) Developer ID 코드사인 + notarization

## 릴리즈 프로세스

```bash
# 1. 버전 업
# package.json, src-tauri/tauri.conf.json, sidecar/pyproject.toml 동시에

# 2. CHANGELOG 업데이트 (docs/release/CHANGELOG.md)

# 3. 빌드
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build

# 4. git tag
git add -A
git commit -m "Release 0.0.1"
git tag v0.0.1
git push origin main --tags

# 5. GitHub Release 생성
# docs/release/*.md 첨부, .dmg 업로드, CHANGELOG 복붙
```

## 배포 후

- [ ] README의 다운로드 링크 업데이트
- [ ] Issue 템플릿 확인
- [ ] 보안 제보용 이메일 모니터링
- [ ] 첫 주 피드백 Wiki `session-log` 에 정리
