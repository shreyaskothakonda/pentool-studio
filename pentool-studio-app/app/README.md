# Pentool

Desktop app for the Webflow pipeline: the bridge, the queue, and Claude Code
in one window.

```sh
npm install
npm start
```

Packaged build (`dist/mac-arm64/Pentool.app`):

```sh
npm run build
```

## What it is

- **Bridge, in process.** Figma posts sections straight in; no separate terminal.
- **Queue pane.** Pages and sections in build order, with the same validation the
  CLI reports. Drag `≡` to reorder — this rewrites the page manifest surgically,
  preserving comments and formatting. Click a name to open `section.md`. Click the
  mode chip to toggle static/component.
- **Progress**, read from `_state.json` and each section's `build-log.md` — the
  files the pipeline already writes. Nothing is scraped from agent output, so the
  dashboard cannot drift when formatting changes.
- **One Claude session, two faces.** The prompt box and the terminal drawer write
  to the same pty. It spawns the `claude` on your `PATH`, so it uses your
  subscription, your MCP servers and your skills. No Agent SDK, no API key.

## Where the pipeline lives

Running from source, it is the parent directory. Packaged, the app asks once and
remembers. Override any time:

```sh
PENTOOL_ROOT=/path/to/pentool-studio-app npm start
```

A folder qualifies if it contains `queue/` and `lib/queue.js`.

## Environment gotchas, all real and all hit during the build

**`ELECTRON_RUN_AS_NODE`** — set inside some Electron hosts (Claude Code's own
shell, for one). If it leaks through, Electron runs your main script as plain Node
and `require('electron')` returns a string, so `app` is undefined. `npm start` and
`npm run build` unset it, and `main.js` strips it from the pty's environment too.

**A GUI launch has almost no PATH.** Double-clicked from Finder or the Dock, the
app inherits LaunchServices' environment, not your terminal's — so `claude` is
not on `PATH` and the pty exits 127, while everything works perfectly when you
start it with `npm start`. The shell is spawned `zsh -lic`, not `-lc`: `-l`
sources `.zshenv`/`.zprofile`/`.zlogin` but **not** `.zshrc`, which is where
most people set `PATH`. `main.js` also appends the usual install directories
(`~/.local/bin`, `~/.bun/bin`, Homebrew) itself, since a profile that never runs
cannot be relied on to add them.

**npm 11 blocks install scripts.** Electron's binary download and node-pty's build
are postinstall scripts, so a fresh `npm install` can leave you with neither:

```sh
npm install-scripts approve electron
npm install-scripts approve node-pty
```

**Electron's extraction can fail silently** — `install.js` exits 0 having unpacked
only the licence file. If `node_modules/electron/dist/Electron.app` is missing:

```sh
cd node_modules/electron
unzip -q -o ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip -d dist
printf 'Electron.app/Contents/MacOS/Electron' > path.txt
```

**Ad-hoc signing is mandatory on Apple Silicon.** electron-builder replaces the
bundle's resources but leaves Electron's original signature, which invalidates it —
macOS then kills the app instantly with no error. `npm run build` re-signs and
verifies. Without that step the `.app` simply will not launch.

**Gatekeeper** still wants a right-click → Open the first time, since the ad-hoc
signature is not a Developer ID.

## Updates

The app checks GitHub Releases on launch and every six hours, and shows a strip
under the header when a newer version exists. **Check for updates** in Settings
forces a check and always answers, including "you are up to date".

It does not install. macOS validates an update against the running app's
designated requirement, and an ad-hoc signature pins that requirement to the
build's own hash — so no later build can ever satisfy it. Announcing an update
that cannot install is worse than saying nothing, so the app hands you the DMG
and you drag it over Applications yourself.

Silent install needs a Developer ID Application certificate and notarization,
which need paid Apple Developer Program membership. The release layout is
already what electron-updater expects, so that switch touches only the app.

The check never surfaces an error. A laptop is offline as a matter of course;
every failure — no network, rate limit, bad JSON, timeout — reads as "up to
date".

## Cutting a release

```sh
npm run release          # patch: 0.1.0 -> 0.1.1
npm run release minor
npm run release 0.4.2
```

Refuses a dirty tree or any branch but `main`. Bumps the version, runs both test
suites, builds and signs the DMG, and only then tags, pushes, and creates the
GitHub release with the commit subjects since the last tag as its notes — so a
failed build can never leave a tag pointing at a release nobody can download.

Releasing is local rather than CI on purpose: a macOS runner would have to clear
every hazard in the section above, and the project has one publisher.

## Rebuilding native modules

`node-pty` is compiled against Electron's ABI, not Node's. After an Electron
upgrade:

```sh
npm run rebuild
```
