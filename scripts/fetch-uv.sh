#!/usr/bin/env bash
# [START] Phase R — Bundle the `uv` binary into Tauri Resources for release.
# Runs before `tauri build` so the released .app can invoke uv to create the
# user's Python runtime on first launch (see src-tauri/src/sidecar.rs).
#
# Pinned to a specific uv version for reproducible builds. Bump UV_VERSION
# when the sidecar's pyproject.toml needs a newer resolver.
set -euo pipefail

UV_VERSION="${UV_VERSION:-0.11.6}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST_DIR="$ROOT/src-tauri/resources/bin"
case "$(uname -m)" in
  arm64)  TRIPLE="aarch64-apple-darwin" ;;
  x86_64) TRIPLE="x86_64-apple-darwin" ;;
  *)      echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
DST_BIN="$DST_DIR/uv-$TRIPLE"

if [ -x "$DST_BIN" ]; then
  echo "✓ uv already present at $DST_BIN"
  exit 0
fi

mkdir -p "$DST_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${TRIPLE}.tar.gz"
echo "↓ fetching uv ${UV_VERSION} for ${TRIPLE}"
echo "  ${URL}"

if ! curl -fsSL "$URL" -o "$TMP_DIR/uv.tar.gz"; then
  echo "✗ download failed — check UV_VERSION / network" >&2
  exit 1
fi

tar -xzf "$TMP_DIR/uv.tar.gz" -C "$TMP_DIR"
# Archive layout: uv-<triple>/uv + uvx
cp "$TMP_DIR/uv-$TRIPLE/uv" "$DST_BIN"
chmod +x "$DST_BIN"

echo "✓ installed uv → $DST_BIN"
du -sh "$DST_BIN"
