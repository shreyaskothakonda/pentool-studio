#!/usr/bin/env bash
# Packages Pentool for macOS. Order matters, twice over:
#
#   1. electron-builder replaces the bundle's resources but leaves Electron's own
#      signature behind, which invalidates it — macOS then kills the app on launch
#      with no error at all. So the .app is re-signed ad-hoc afterwards.
#
#   2. The DMG must be built FROM the signed .app. Letting electron-builder do
#      both in one pass packages the app before step 1 runs, and the copy inside
#      the DMG carries the broken signature instead.
#
# Run this rather than electron-builder directly.
set -euo pipefail
cd "$(dirname "$0")"

APP=dist/mac-arm64/Pentool.app

# ELECTRON_RUN_AS_NODE is set inside some Electron hosts (Claude Code's shell, for
# one). Left set, electron-builder and the app itself run as plain Node.
export -n ELECTRON_RUN_AS_NODE 2>/dev/null || true
unset ELECTRON_RUN_AS_NODE || true

# dmgbuild needs a Python whose pyexpat works. Homebrew's can be linked against a
# newer libexpat than macOS ships, which breaks the import; the system one is
# fine. Scoped to this script — nothing on the machine is changed.
PYSHIM="$(mktemp -d)"
trap 'rm -rf "$PYSHIM"' EXIT
if [ -x /usr/bin/python3 ]; then
  ln -sf /usr/bin/python3 "$PYSHIM/python3"
  ln -sf /usr/bin/python3 "$PYSHIM/python"
  export PATH="$PYSHIM:$PATH"
fi

rm -rf dist

echo "→ packaging the .app"
./node_modules/.bin/electron-builder --mac dir

echo "→ signing (ad-hoc; mandatory on Apple Silicon)"
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"

if [ "${1:-}" = "--no-dmg" ]; then
  echo "✓ $APP"
  exit 0
fi

echo "→ building the DMG from the signed app"
./node_modules/.bin/electron-builder --mac dmg --prepackaged "$APP"

DMG=$(ls dist/*.dmg 2>/dev/null | head -1)
echo "✓ $APP"
echo "✓ $DMG"
echo
echo "Gatekeeper wants a right-click → Open the first time: the signature is"
echo "ad-hoc, not a Developer ID."
