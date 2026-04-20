#!/usr/bin/env bash
#
# repackage-dmg-with-installer.sh
# ================================
# Takes the DMG produced by `npm run tauri build` and adds an
# "Install OVO.command" helper next to OVO.app inside the image.
# The helper is what users double-click to strip the quarantine
# flag that unsigned builds carry (see scripts/dmg-templates/).
#
# Steps (all auditable):
#   1. Find the freshly-built DMG in src-tauri/target/release/bundle/dmg/
#   2. Convert read-only DMG → read-write copy in a temp directory
#   3. Mount the read-write copy
#   4. Copy scripts/dmg-templates/Install OVO.command onto the volume
#      and mark it executable
#   5. Unmount, re-compress as read-only UDZO, overwrite the original
#
# No network calls, no signing identity required, no privilege escalation.
# If you skip this step, the DMG still works — users will just have to
# run `xattr -rd com.apple.quarantine` themselves (see README Install).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
TEMPLATE="$ROOT/scripts/dmg-templates/Install OVO.command"

# Pick the most recent .dmg produced by tauri
DMG_SRC="$(ls -t "$BUNDLE_DIR"/*.dmg 2>/dev/null | head -n 1 || true)"
if [ -z "$DMG_SRC" ]; then
  echo "✗ No DMG found in $BUNDLE_DIR" >&2
  echo "  Run 'npm run tauri build' first." >&2
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "✗ Installer template missing: $TEMPLATE" >&2
  exit 1
fi

echo "→ source DMG: $DMG_SRC"
echo "→ installer:  $TEMPLATE"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RW_DMG="$WORK/ovo-rw.dmg"

# Step 2 — convert to writable
echo "→ converting to read-write copy..."
hdiutil convert "$DMG_SRC" -format UDRW -o "$RW_DMG" -quiet

# Step 3 — mount without showing it in Finder
echo "→ mounting..."
MOUNT_OUT="$(hdiutil attach -nobrowse -noverify -noautoopen "$RW_DMG")"
MOUNT_POINT="$(echo "$MOUNT_OUT" | awk -F'\t' '/\/Volumes\// {print $NF}' | tail -n 1)"
if [ -z "$MOUNT_POINT" ]; then
  echo "✗ could not detect mount point" >&2
  echo "$MOUNT_OUT" >&2
  exit 1
fi
echo "  mounted at: $MOUNT_POINT"

# Step 4 — drop the installer in and make it executable
echo "→ copying Install OVO.command onto the volume..."
cp "$TEMPLATE" "$MOUNT_POINT/Install OVO.command"
chmod +x "$MOUNT_POINT/Install OVO.command"

# Unmount
echo "→ unmounting..."
hdiutil detach "$MOUNT_POINT" -quiet

# Step 5 — recompress and overwrite
echo "→ recompressing (UDZO)..."
TMP_OUT="$WORK/ovo-final.dmg"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$TMP_OUT" -quiet

mv "$TMP_OUT" "$DMG_SRC"

echo ""
echo "✓ repackaged: $DMG_SRC"
ls -lh "$DMG_SRC"
