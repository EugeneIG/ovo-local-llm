#!/usr/bin/env bash
# Run OVO sidecar in dev mode.
# Uses a local APFS venv to avoid SMB/network-mount permission issues.
set -euo pipefail

export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-$HOME/Library/Caches/ovo-dev/sidecar-venv}"

cd "$(dirname "$0")/.."

if [ ! -d "$UV_PROJECT_ENVIRONMENT" ]; then
  echo "→ first run: uv sync to $UV_PROJECT_ENVIRONMENT"
  uv sync
fi

exec uv run --no-sync ovo-sidecar "$@"
