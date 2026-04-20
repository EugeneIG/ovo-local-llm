# Build Guide

OVO MLX를 소스에서 빌드하는 가이드.

## 필수 도구

```bash
# Node.js 20+ (npm, npx)
# Rust stable + cargo (rustup 권장)
# Python 3.12+ (uv로 관리)
# Xcode Command Line Tools (macOS)
xcode-select --install
```

설치:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# uv (Python 패키지 매니저)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Node은 brew/nvm로
brew install node
```

## 클론 + 의존성

```bash
git clone https://github.com/USER/ovo-mlx.git
cd ovo-mlx

# 프론트엔드 의존성
npm install

# 사이드카 venv (로컬 APFS 캐시에 생성 — SMB 볼륨 회피)
export VIRTUAL_ENV="$HOME/Library/Caches/ovo-dev/sidecar-venv"
cd sidecar && uv sync && cd ..
```

### SMB 볼륨에서 개발할 때 (예: /Volumes/docker)

Cargo는 네트워크 파일시스템에서 hard link / lock 이슈로 제대로 못 돌아. `src-tauri/.cargo/config.toml` 에 로컬 타겟 디렉토리 지정돼 있어:

```toml
[build]
target-dir = "/Users/YOUR_USERNAME/Library/Caches/ovo-dev/target"
incremental = false
```

본인 홈 디렉토리 경로로 수정해서 사용하세요.

## 개발 모드

```bash
# cargo 경로 PATH에
export PATH="$HOME/.cargo/bin:$PATH"

# Tauri dev (프론트 HMR + Rust + 사이드카 자동 실행)
npm run tauri dev
```

- 프론트 변경 → HMR 즉시 반영
- Rust 변경 → 자동 재컴파일 (cargo check)
- 사이드카 Python 변경 → Cmd+Q 재시작 필요
- `tauri.conf.json` / `capabilities/` 변경 → 재시작 필요

## 프로덕션 빌드

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build
```

산출물:
- `.app`: `{CARGO_TARGET_DIR}/release/bundle/macos/OVO.app`
- `.dmg`: `{CARGO_TARGET_DIR}/release/bundle/dmg/OVO_0.0.1_aarch64.dmg`

## 체크리스트

- [ ] `npx tsc --noEmit` 0 에러
- [ ] `python3 -c "import ast; [ast.parse(open(f).read()) for f in ['sidecar/src/ovo_sidecar/main.py','sidecar/src/ovo_sidecar/api/ovo.py','sidecar/src/ovo_sidecar/mlx_runner.py','sidecar/src/ovo_sidecar/model_lifecycle.py']]"`
- [ ] i18n ko/en 키 수 일치
- [ ] `npm audit` HIGH/CRITICAL 없음 (xlsx ReDoS는 업스트림 미패치 — known)
- [ ] `cargo check` 0 에러
- [ ] `npm run tauri build` 성공 + `.app` 실행 확인

## 알려진 이슈

### `Top-level await` 빌드 에러

`vite.config.ts` 에 `build.target: "esnext"` 있어야 `main.tsx`의 lazy PetApp import 빌드 됨.

### Gatekeeper "손상된 파일"

서명 안 한 로컬 빌드 .app은 macOS가 격리시킴. 해제:

```bash
xattr -cr /Applications/OVO.app
```

공식 배포 시 Developer ID + notarization 필요 — [RELEASE.md](./RELEASE.md) 참조.

### pdfjs-dist 버전 고정

v5는 Tauri WebView에서 ReadableStream 호환성 깨짐. v3.11.174 고정 (package.json).
