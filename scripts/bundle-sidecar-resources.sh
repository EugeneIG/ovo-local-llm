#!/usr/bin/env bash
# [START] Phase R — Bundle Python sidecar source into Tauri Resources.
# Runs before `tauri build` so the released `.app` ships:
#   Contents/Resources/_up_/sidecar/{src,scripts,pyproject.toml,uv.lock,README.md}
# First-run bootstrap (Rust side) then calls bundled `uv` to create a venv
# inside the user's Application Support directory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/sidecar"
DST="$ROOT/src-tauri/resources/sidecar"

if [ ! -d "$SRC" ]; then
  echo "✗ sidecar source missing at $SRC" >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$DST"

# rsync preserves perms (scripts must stay +x) and lets us exclude dev debris.
rsync -a \
  --exclude='.omc/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache/' \
  --exclude='.ruff_cache/' \
  --exclude='.venv/' \
  --exclude='build/' \
  --exclude='dist/' \
  --exclude='*.egg-info/' \
  --include='src/***' \
  --include='scripts/***' \
  --include='pyproject.toml' \
  --include='uv.lock' \
  --include='README.md' \
  --exclude='*' \
  "$SRC/" "$DST/"

echo "✓ bundled sidecar → $DST"
du -sh "$DST" 2>/dev/null || true
