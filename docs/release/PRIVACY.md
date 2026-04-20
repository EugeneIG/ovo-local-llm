# Privacy Policy

OVO MLX는 **100% 로컬 실행** 앱입니다. 기본적으로 사용자 데이터는 본인 기기를 떠나지 않습니다.

## 수집 정보

### OVO가 수집하지 않는 것
- 개인정보 (이름, 이메일, 전화번호 등)
- 사용 통계 / 텔레메트리 / 크래시 리포트
- 채팅 내용 / 파일 첨부 / 코드 내용
- 모델 출력

**OVO는 analytics 서비스를 쓰지 않아.** 기본 상태에서 외부 네트워크로 보내는 데이터는 0바이트.

### 로컬에 저장되는 것
모두 사용자 기기 `~/Library/Application Support/OVO/`:

| 데이터 | 경로 | 용도 |
|--------|------|------|
| 채팅 히스토리 | `chats.sqlite` | SQLite DB. 복사/삭제 가능 |
| 첨부 파일 | `attachments/` | 이미지 / 오디오 원본 |
| 위키 | `chats.sqlite` (내부 테이블) | 영속 지식 베이스 |
| 생성된 이미지 | `images/` | 디퓨전 모델 출력 |
| 펫 위치 | `pet_position.json` | 부엉이 펫 좌표 |
| 사이드카 auth 토큰 | `auth_token.txt` (chmod 600) | 노출 모드 시만 사용 |
| 설정 | localStorage (webview 내부) | UI 프리퍼런스 |

모델 파일은 HuggingFace 표준 경로: `~/.cache/huggingface/hub/` + LM Studio 호환 경로.

## 외부 네트워크 통신

다음 기능을 **사용자가 명시적으로 실행할 때만** 외부 서버와 통신:

| 기능 | 대상 | 데이터 |
|------|------|--------|
| 모델 다운로드 | huggingface.co | HF repo 검색/다운로드 요청 (검색어, repo_id) |
| 웹 검색 (`web_search` 툴) | html.duckduckgo.com | 검색 쿼리 |
| Wiki embedding 다운로드 | huggingface.co | 임베딩 모델 (첫 사용 시만) |
| MCP 서버 (사용자 설정) | 사용자 지정 | 도구별 다름 |

**기본 상태에서는 아무것도 켜져 있지 않아.** Settings에서 `expose_to_network` 를 켜면 사이드카가 LAN 노출됨 (기본 OFF).

## 보관 기간 / 파기

- **사용자 수동 삭제**: Chat/Code 세션은 UI에서 개별/일괄 삭제.
- **자동 파기 없음**: OVO는 사용자 데이터를 자동으로 지우지 않습니다. 본인이 직접 관리하세요.
- **앱 완전 삭제**: 다음 경로 삭제
  ```bash
  rm -rf ~/Library/Application\ Support/OVO
  rm -rf ~/Library/Caches/com.ovoment.ovo
  rm -rf ~/Library/WebKit/com.ovoment.ovo
  ```

## 3rd party

- **HuggingFace**: 모델 다운로드 시 요청이 전달됨. HF 프라이버시 정책 참조.
- **DuckDuckGo**: `web_search` 툴 사용 시. DDG는 IP 기반 추적 안 한다고 명시.

## 아동 개인정보

OVO는 연령 제한 없음. 13세 미만 사용자의 개인정보를 수집하지 않음 (애초에 아무것도 수집 안 함).

## 업데이트

이 문서는 OVO 업데이트 시 같이 갱신될 수 있음. 중대한 변경은 릴리스 노트에 명시.

## 문의

privacy@ovoment.com
