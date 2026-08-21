# pentool-studio

Two halves of one pipeline: get a Figma design out of Figma, and build it into
Webflow.

```text
Figma → Pentool Studio (plugin) → bridge → queue/sections/<name>/ → /webflow-build → Webflow
```

| | |
| --- | --- |
| [pentool-studio-figma-plugin/](pentool-studio-figma-plugin/) | The Figma plugin. Captures a selection as a text dump — layout, type, fills with token names, inline SVG, an a11y audit — plus Client-First class proposals for the Webflow target. |
| [pentool-studio-app/](pentool-studio-app/) | The pipeline. A queue of sections ordered per page, a local bridge that receives dumps from the plugin, the Claude Code skills that build them into Webflow, and `app/` — the Electron desktop wrapper. |

Neither half has dependencies of its own. The plugin is plain JS with no build
step; the pipeline is Node built-ins only. Only the desktop app has an
`npm install`.

## Running it

**The plugin** — Figma desktop → Plugins → Development → Import plugin from
manifest… → pick `pentool-studio-figma-plugin/manifest.json`. Design mode, so it
works on the free plan.

**The bridge** — from `pentool-studio-app/`:

```sh
node bin/pentool-bridge.js     # prints a token on first run
```

Then in the plugin press **Connect this file**, approve it in the browser tab
that opens, and **Add to queue** lands the dump and its screenshots straight in
`queue/sections/<name>/`. There is no token to copy — the approval hands it over.

**The desktop app** — the bridge, the queue and Claude Code in one window:

```sh
cd pentool-studio-app/app && npm install && npm start
```

**Building** — from `pentool-studio-app/`:

```sh
node bin/wf-queue.js plan      # resolved build order + validation
```

then `/webflow-build` in Claude Code. It stops after each section and waits,
because Webflow has no undo API.

## Tests

```sh
cd pentool-studio-figma-plugin && node test.js && node test-e2e.js
cd pentool-studio-app          && node test.js
```

No dependencies, no runner, no config. See [context/](context/) for the current
verification record and the known gaps.

## Where the docs live

- [pentool-studio-landing-page/](pentool-studio-landing-page/) — positioning, verified claims and real output, for when there is a page to write
- [context/](context/) — current verification state and known gaps
- [pentool-studio-figma-plugin/README.md](pentool-studio-figma-plugin/README.md) — what the plugin captures, its options and known limits
- [pentool-studio-app/README.md](pentool-studio-app/README.md) — the queue model, snapshots, the planner, the Webflow MCP
- [pentool-studio-app/app/README.md](pentool-studio-app/app/README.md) — packaging the desktop app, and four real environment gotchas

## Installing the app

Grab the DMG from [Releases](https://github.com/shreyaskothakonda/pentool-studio/releases),
open it, and drag Pentool to Applications.

The signature is ad-hoc rather than a Developer ID, so the first launch needs a
right-click → **Open** to get past Gatekeeper. After that it opens normally.

The app tells you when a new version is out and links you to it. It cannot
install updates itself — see [the app README](pentool-studio-app/app/README.md#updates)
for why, and what would change that.
