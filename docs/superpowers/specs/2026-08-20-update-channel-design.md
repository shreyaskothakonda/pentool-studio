# Shipping fixes as updates

**Status:** approved 2026-08-20
**Scope:** Pentool Studio App only. The plugin is loaded from disk in Figma and
has no install step to update.

## The problem

Pentool ships as a DMG. A fix reaches the user only if they are told about it,
find the file, and drag it over the old copy. In practice that means fixes do
not reach them at all. The two bugs fixed on 2026-08-20 — the pty exiting 127
under a GUI launch, and an empty page blocking the whole build — would have sat
in an installed app indefinitely.

## The constraint that shapes everything

macOS auto-update, via electron-updater and Squirrel.Mac, validates a downloaded
update against the running app's **designated requirement**. For an ad-hoc or
Apple Development signature that requirement is pinned to the build's own code
directory hash, so no later build can ever satisfy it. Silent auto-update is not
available without a Developer ID Application certificate and notarization, which
require paid Apple Developer Program membership.

This is not a limitation worth working around. Attempting silent updates on an
ad-hoc signature produces an update path that fails at install time, which is
worse than no update path at all: the user is told an update is ready and it
never arrives.

**Decision:** ship a notifier. The app detects a newer release and takes the user
to it. The drag-to-Applications step stays manual until a Developer ID exists.

## Design

### Feed

GitHub Releases on the public monorepo `shreyaskothakonda/pentool-studio`.
Releases are tagged `v<major>.<minor>.<patch>` matching `app/package.json`
`version`, with the built DMG attached as a release asset.

The tag scheme, DMG naming and release layout are deliberately exactly what
electron-updater expects. When a Developer ID is available the release side
needs no change; only the app's install step is swapped.

### `app/update.js`

One module, no new dependencies.

- `compareVersions(a, b)` — numeric field comparison, tolerant of a leading `v`
  and of unequal field counts. A pure function.
- `pickRelease(json, current)` — takes the GitHub API payload and the running
  version, returns `{ version, notes, url, page }` or `null`. Pure; the DMG asset
  is located by extension, and a release without one returns `null` rather than
  offering a download that does not exist.
- `check()` — the single impure function. GETs
  `https://api.github.com/repos/<owner>/<repo>/releases/latest` unauthenticated
  (60 requests/hour per IP; the app makes at most 5 a day) and feeds the result
  to `pickRelease`.

`check()` never rejects. Being offline is the normal state of a laptop, and an
update check that surfaces an error has made the app worse. Every failure path —
no network, rate limit, malformed JSON, HTTP error, timeout — resolves to `null`.

### Schedule and state

Checked once on launch and every six hours after. `userData/ui.json`, which
already holds window bounds and agent mode, gains:

- `lastUpdateCheck` — epoch ms, so a relaunch inside the interval does not
  re-check.
- `dismissedVersion` — the version the user dismissed. A newer one notifies
  again; the same one stays quiet.

### Interface

A dismissible strip below the header: the new version, the release notes,
**Download** (opens the DMG), **What's new** (opens the release page), and a
dismiss control.

Manual checking lives in the existing Settings dialog. The app installs no
custom application menu, and building a full menu template — File, Edit, View,
Window, Help, all of which Electron currently provides for free — to hold one
item is not worth it.

### Releasing

`npm run release [patch|minor|major]` in `app/`, wrapping the existing
`build-mac.sh`:

1. Refuse to run on a dirty tree or off `main`.
2. Bump `app/package.json`, commit, tag `v<version>`.
3. Build and ad-hoc sign the DMG.
4. `gh release create` with the DMG attached and the commits since the last tag
   as the notes.
5. Push the branch and the tag.

Local rather than GitHub Actions, deliberately. The macOS build clears five
documented environment hazards — npm 11 blocking install scripts, Electron's
silently truncated extraction, the `node-pty` rebuild against Electron's ABI, a
broken Homebrew `pyexpat`, and mandatory ad-hoc signing. Reproducing that on a
runner is real work, and the project has one publisher. CI becomes worthwhile at
the second.

## Testing

`app/test.js`, zero dependencies, matching the existing 256-test suite's style.

`compareVersions` and `pickRelease` are pure and carry the logic that decides
whether a user is told anything, so they are tested directly: newer, older,
equal, `v` prefixes, unequal field counts, a release with no DMG asset,
malformed JSON, and a payload missing fields entirely.

`check()`'s contract is that it never throws. It is tested against a stub server
returning a 500, malformed JSON, and a refused connection.

## Out of scope

Windows and Linux builds, delta updates, release channels, and in-app install.
