#!/bin/bash
#
# OVO — post-install helper
# =========================
# What this does (read the whole thing before running):
#
#   1. Checks that OVO.app is present in /Applications
#   2. Removes the macOS "quarantine" extended attribute from OVO.app
#      so the currently-unsigned build can launch without the
#      "OVO is damaged and can't be opened" dialog.
#   3. Opens OVO.app.
#
# That's the entire script. No network calls, no downloads,
# no background processes, no hidden state. You can read every
# line below, or inspect the source:
#
#   https://github.com/ovoment/ovo-local-llm/blob/main/scripts/dmg-templates/Install%20OVO.command
#
# Why is this needed?
#   OVO's DMG is not yet signed with an Apple Developer ID
#   (99 USD/yr, in progress). macOS Gatekeeper flags downloaded
#   unsigned apps with com.apple.quarantine, which blocks launch.
#   `xattr -rd com.apple.quarantine` removes that flag — nothing else.
#
# You can also do this by hand in Terminal.app if you prefer:
#
#   xattr -rd com.apple.quarantine /Applications/OVO.app
#   open /Applications/OVO.app
#

set -e

APP="/Applications/OVO.app"

echo ""
echo "════════════════════════════════════════════════"
echo "  OVO — post-install helper"
echo "════════════════════════════════════════════════"
echo ""

# ─── Step 1: verify the app has been dragged to /Applications ──────────
if [ ! -d "$APP" ]; then
  osascript -e 'display dialog "OVO.app이 /Applications 에 없어요.\n\n먼저 DMG 창에서 OVO.app을 Applications 폴더로 드래그한 뒤\n다시 이 파일을 더블클릭해주세요.\n\n──────────────\n\nOVO.app was not found in /Applications.\n\nPlease drag OVO.app to the Applications folder from the DMG window,\nthen double-click this file again." buttons {"OK"} default button "OK" with icon stop with title "OVO Installer"' >/dev/null
  echo "✗ /Applications/OVO.app not found — please drag it over first."
  echo ""
  exit 1
fi

# ─── Step 2: show the user exactly what we are about to run ────────────
USER_CONFIRM=$(osascript <<'EOF'
display dialog "OVO 실행 권한을 설정합니다.\n\n실행될 명령 (단 한 줄):\n   xattr -rd com.apple.quarantine /Applications/OVO.app\n\n이게 전부입니다. Apple Developer 서명이 준비되면\n이 단계 자체가 사라집니다.\n\n──────────────\n\nAbout to run this single command:\n   xattr -rd com.apple.quarantine /Applications/OVO.app\n\nThat's the whole thing. This step will go away\nonce Apple Developer signing is in place." buttons {"Cancel", "Run"} default button "Run" cancel button "Cancel" with icon note with title "OVO Installer"
EOF
)

# osascript exits non-zero on cancel; `set -e` handles that.

# ─── Step 3: strip quarantine (user-level, no sudo) ────────────────────
echo "→ xattr -rd com.apple.quarantine \"$APP\""
if xattr -rd com.apple.quarantine "$APP"; then
  echo "  ✓ quarantine flag removed"
else
  echo "  ! could not remove quarantine without admin permission."
  echo "  ! run this in Terminal.app manually:"
  echo ""
  echo "       sudo xattr -rd com.apple.quarantine /Applications/OVO.app"
  echo ""
  exit 1
fi

# provenance is a newer (Sequoia+) sibling flag; absent on older macOS, so
# a failure here is non-fatal. We surface it rather than silencing it.
echo "→ xattr -rd com.apple.provenance \"$APP\""
if xattr -rd com.apple.provenance "$APP" 2>&1; then
  echo "  ✓ provenance flag removed"
else
  echo "  · provenance flag not present (older macOS) — fine, continuing."
fi

# ─── Step 4: launch ────────────────────────────────────────────────────
echo ""
echo "→ open \"$APP\""
open "$APP"

echo ""
echo "✓ Done. OVO is starting up."
echo ""
echo "You can close this Terminal window."
echo ""
