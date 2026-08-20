#!/usr/bin/env bash
# Cut a release: bump, test, build, tag, publish.
#
#   ./release.sh            # patch: 0.1.0 -> 0.1.1
#   ./release.sh minor      # 0.1.0 -> 0.2.0
#   ./release.sh major      # 0.1.0 -> 1.0.0
#   ./release.sh 0.4.2      # exactly that
#
# Everything that can fail is done BEFORE anything is published. The tag and the
# GitHub release are created only once a DMG exists on disk, so a broken build
# can never leave a tag pointing at a release nobody can download.
set -euo pipefail

APP="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$APP/../.." && pwd)"
BUMP="${1:-patch}"

die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

cd "$ROOT"

# ── preflight ────────────────────────────────────────────────────────────────
command -v gh >/dev/null   || die "the GitHub CLI is not installed — brew install gh"
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub — gh auth login"
git remote get-url origin >/dev/null 2>&1 || die "no 'origin' remote — see the release section of the README"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "on branch $BRANCH — releases are cut from main"
[ -z "$(git status --porcelain)" ] || die "the working tree is dirty — commit or stash first"

CURRENT="$(node -p "require('$APP/package.json').version")"

case "$BUMP" in
  major|minor|patch)
    NEXT="$(node -e '
      const [maj,min,pat] = process.argv[1].split(".").map(Number);
      const b = process.argv[2];
      console.log(b === "major" ? [maj+1,0,0].join(".")
                : b === "minor" ? [maj,min+1,0].join(".")
                :                 [maj,min,pat+1].join("."));
    ' "$CURRENT" "$BUMP")" ;;
  [0-9]*.[0-9]*.[0-9]*) NEXT="$BUMP" ;;
  *) die "expected major, minor, patch, or an exact version — got '$BUMP'" ;;
esac

git rev-parse -q --verify "refs/tags/v$NEXT" >/dev/null && die "v$NEXT already exists"

printf '\n  %s  →  %s\n\n' "$CURRENT" "$NEXT"

# ── bump, and undo the bump if anything below fails ──────────────────────────
restore() { git checkout -- "$APP/package.json" 2>/dev/null || true; }
trap restore ERR INT TERM

node -e '
  const fs = require("fs"), f = process.argv[1];
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  p.version = process.argv[2];
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$APP/package.json" "$NEXT"

echo "── tests ──────────────────────────────────────────"
( cd "$ROOT/pentool-studio-app" && node test.js | tail -1 )
( cd "$APP" && node test.js | tail -1 )

echo
echo "── build ──────────────────────────────────────────"
"$APP/build-mac.sh"

DMG="$(ls -t "$APP/dist/"*.dmg 2>/dev/null | head -1)"
[ -n "$DMG" ] && [ -f "$DMG" ] || die "the build produced no DMG"

trap - ERR INT TERM

# ── publish ──────────────────────────────────────────────────────────────────
# Notes are the commit subjects since the last tag. A release with no notes is
# a release nobody can judge, and this is the record that already exists.
LAST="$(git describe --tags --abbrev=0 2>/dev/null || true)"
NOTES="$(git log --no-merges --pretty='- %s' ${LAST:+"$LAST"..}HEAD || true)"
[ -n "$NOTES" ] || NOTES="- $CURRENT → $NEXT"

git add "$APP/package.json"
git commit -qm "Release v$NEXT"
git tag -a "v$NEXT" -m "v$NEXT"
git push -q origin main
git push -q origin "v$NEXT"

gh release create "v$NEXT" "$DMG" \
  --title "v$NEXT" \
  --notes "$NOTES"$'\n\n''Download the DMG, open it, and drag Pentool over Applications, replacing the old copy.'$'\n\n''The signature is ad-hoc, so the first launch needs a right-click → Open.'

printf '\n✓ v%s published\n  %s\n' "$NEXT" "$(gh release view "v$NEXT" --json url -q .url)"
