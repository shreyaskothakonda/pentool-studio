# pentool-studio-app

Takes [Pentool Studio](../pentool-studio-figma-plugin) output and builds it into Webflow — a queue of
sections, ordered per page, built one at a time through the Webflow MCP.

```text
Figma → Pentool Studio → bridge → queue/sections/<name>/ → /webflow-build → Webflow
```

No dependencies, no build step. Node built-ins only.

## The model

**Pages own order.** A page manifest lists its sections in build order.
**Sections own content.** A section holds the plugin dump, its images, and how it
should be built — static markup or a component with props, optionally bound to a
CMS collection.

```text
queue/
  _config.json                 siteId and defaults
  pages/markets.md             page manifest: ordered sections
  sections/markets-grid/
    section.md                 frontmatter + the plugin dump
    assets/hero.png
  _done/                       finished sections, each with build-log.md
```

A section listed on several pages is built on each. `build: component` creates the
component **once** and places an instance per page; `build: static` duplicates the
markup per page.

## Getting sections in

**With the bridge** — one click in Figma:

```bash
node bin/pentool-bridge.js          # prints a token on first run
```

Paste the token into the plugin once, then **Pentool Studio selection → send to queue**. The
dump and its screenshots land straight in `queue/sections/<name>/`. The plugin
manifest needs `http://localhost:8930` in `devAllowedDomains` — the slot Figma
provides for local servers, so production network access stays closed.

The bridge binds `127.0.0.1` only, requires the token on every request, slugifies
names, and refuses to write outside `queue/sections/`. It writes files on POST, so
it is deliberately narrow.

**Without it** — copy the Pentool Studio output, make the folder, paste it under the
frontmatter by hand. The bridge only removes the transit step.

## The desktop app

`app/` is **Pentool** — the bridge, the queue and Claude Code in one window.
It wraps this pipeline rather than replacing it; everything below still works
from the command line.

```sh
cd app && npm install && npm start
```

See [app/README.md](app/README.md) for the packaged build and the environment
gotchas (there are four, all real).

## Snapshots — read this before trusting anything

**Webflow's Data API has no backups endpoint.** Restore points are created
automatically every 50th autosave and manually in the Designer, and nothing in
this project can create or restore one.

So there are two different artifacts, and they are not interchangeable:

| | What it is | Can it restore? |
| --- | --- | --- |
| **Snapshot** (`/webflow-snapshot`) | JSON record of pages, styles, components, element trees | **No.** Diff and reference only |
| **Restore point** (you, in the Designer) | Webflow's own backup | **Yes** |

Every agent session owes a snapshot before it builds. The gate is hard:

```sh
node bin/wf-snapshot.js status   # exit 1 while this session still owes one
node bin/wf-snapshot.js list
```

`webflow-build` refuses to start when that exits non-zero. Pentool records the
session boundary when the agent starts and asks it to snapshot automatically —
set `"autoSnapshot": false` in `_config.json` to stop that.

The snapshot skill also asks you to create a real Webflow restore point and
records whether you confirmed it. If you skipped, the header and the CLI both say
**no restore point** rather than implying you are covered.

## Projects

A project is a self-contained pipeline: its own `queue/`, its own `_config.json`,
and its own copy of `lib/`, `bin/` and the skills. Self-contained because the
agent runs with the project as its cwd, and the skills invoke `node bin/…`.

**One agent per project. Many projects in parallel.** Parallel projects are safe —
different sites, different queues, different state. Two agents on *one* project
are not: class creation is check-then-create, element insertion into a page is
order-dependent, `_state.json` is read-modify-write, and Webflow has neither
transactions nor an undo API. The failure mode is duplicated classes and
scrambled section order, repaired by hand in the Designer.

## Building

```bash
node bin/wf-queue.js plan          # resolved build order + validation
node bin/wf-queue.js plan markets  # one page
node bin/wf-queue.js show markets-grid
```

Then in Claude Code:

```text
/webflow-build            # every page
/webflow-build markets    # one page
```

It stops after each section and waits. Webflow has no undo API, so a wrong class
or a wrong page should cost one section, not a whole page.

## Visual verification

After a section builds, the skill screenshots the result and compares it against
the Figma design — the check that catches what a structural diff cannot: wrong
spacing, wrong stacking, a section that built cleanly and still looks nothing like
the design.

1. Publishes to the **`.webflow.io` staging subdomain only**
   (`publishToWebflowSubdomain: true`, `customDomains: []`). Production is never
   touched — publishing live stays your call.
2. Resizes the browser to the Figma frame width via Chrome DevTools MCP.
3. Takes a `fullPage` screenshot into `queue/sections/<name>/built.png`.
4. Compares it with Pentool Studio's Figma export at `assets/_preview-*.png` and reports
   the differences in words, ranked by significance.

**This needs Pentool Studio's "preview PNG" option switched on** — it is off by default, so
without it there is no Figma reference to compare against. The skill says so rather
than skipping quietly.

Configure it in `_config.json`:

```json
"visual": {
  "enabled": true,
  "baseUrl": "https://example-site.webflow.io",
  "viewport": [1440, 900],
  "publishToStaging": true
}
```

Set `"enabled": false` to skip it entirely.

## Stable and beta Webflow MCP

The skill reads which server to use from `_config.json` rather than hardcoding it:

```json
{ "mcp": "webflow" }        // or "webflow-beta"
```

Register the beta once and both stay connected:

```sh
claude mcp add --transport http webflow-beta https://mcp.webflow.com/beta/mcp
```

Flipping that one key is the whole switch. Preflight also verifies every tool it
needs actually exists on the configured server and stops if one is missing —
Webflow renames tools between MCP versions, and that should fail loudly rather
than half-build a page.

**Interactions (IX3) cannot be automated.** Pentool Studio captures `reactions:` lines, but
neither the MCP nor the Data or Designer API can create Webflow interactions. They
are logged in `build-log.md` under "manual: interactions" so hover and click states
stay a known to-do.

## What the planner catches

Before anything touches Webflow: unknown section, section referenced by no page,
duplicate page slug, folder and `name` disagreeing, missing dump, a prop `target`
or `cms.bind` naming a class that is not in the dump, invalid prop type, invalid
position, malformed frontmatter with a line number.

Errors exit non-zero and block the build. Warnings do not.

## Tools

| | |
| --- | --- |
| `bin/wf-queue.js` | parse, validate, resolve the build order |
| `bin/wf-state.js` | `queue/_state.json` — component ids, asset ids by hash, what is built where |
| `bin/wf-asset.js` | MD5 and the presigned S3 upload Webflow's `create_asset` requires |
| `bin/pentool-bridge.js` | CLI wrapper over `lib/bridge.js` |
| `lib/bridge.js` | the local server that receives dumps and screenshots from Pentool Studio |
| `lib/yaml.js` | a small strict YAML subset — hard errors, never a silent misread |
| `lib/queue.js` | loading, validation, resolution |
| `lib/edit.js` | surgical manifest edits — reorder sections, toggle build mode |
| `lib/snapshot.js` | session gating and structural snapshots |
| `lib/project.js` | project scaffolding and the registry |
| `lib/webflow.js` | Data API client — page and component listing, for the app's pickers |
| `bin/wf-snapshot.js` | the snapshot gate: `status`, `list`, `session` |

## Resuming

`queue/_state.json` records component ids, asset ids keyed by file hash, and which
sections are built on which pages. A re-run skips finished work rather than
duplicating it. `build-log.md` is written as each section proceeds, so a crash
still leaves an accurate record of what exists.

## Tests

```sh
node test.js
```

Covers the YAML subset, frontmatter splitting, dump scanning, and every validation
rule, using temporary fixture queues. No dependencies.

## Not yet

Breakpoints and component variants, creating CMS collections or items (it binds to
existing ones), localization, and Webflow Interactions — which no API can create.

Publishing is deliberately limited: the visual check publishes to the `.webflow.io`
staging subdomain only. Going live is never automated.
