# Pentool — startup flow and manual capture

**Date:** 2026-08-19
**Status:** design, approved in brainstorming; no implementation started
**Scope:** all three projects — `pentool-studio-app`, `pentool-studio-figma-plugin`, and the pipeline they share

---

## Summary

Two changes that turn out to be one system.

**The app gains a real startup flow.** Today it resolves a project folder before any
window exists, and in dev mode it silently opens the repo itself — which is why the
`markets-grid` and `cta-band` fixtures appear on every launch. It will instead open a
window first, list known projects in a sidebar, and let you create a new one against a
Webflow site you pick from your account.

**The plugin gains a manual capture mode.** Today capture is driven entirely by the
canvas selection and the build target is inferred downstream. Manual mode lets you
choose the Figma page and frame explicitly, and choose the Webflow page and component
the section is destined for — with the component either reused as an instance or
updated in place.

They are one system because the plugin cannot reach Webflow. Its manifest sets
`allowedDomains: ["none"]`, so every Webflow list it offers must arrive through the
bridge, and the bridge only knows which site to ask about once a project is active.
The startup flow is what makes manual mode possible.

---

## Decisions

Each was settled during brainstorming. Rationale is recorded because the alternatives
were reasonable and may look tempting again later.

| # | Decision | Why this over the alternatives |
| --- | --- | --- |
| 1 | Project list is a **permanent sidebar**, not a launch screen | Switching projects is one click with no modal. Costs horizontal space, which the queue pane can absorb. |
| 2 | New project does **full setup**: store a token, list sites, pick one | The alternative — leaving `siteId` blank for later — puts a broken project in the sidebar that fails at first build. |
| 3 | The plugin **pairs to a project through a browser page** the bridge serves | Replaces copying a token by hand. One page does both jobs — proving the request is yours, and choosing the folder. Works with the app minimised. |
| 3a | Pairing is **remembered on the Figma document**, not just the user | Each Figma file remembers its own project, which is what "connect this file to a project" means in practice. |
| 3b | The plugin still sends **`/hello` heartbeats** once paired | Pairing is one-time; the app still needs live "plugin open / not open" state. |
| 4 | **One bridge at a time**, always on `:8930` | The plugin manifest hardcodes that port. Per-project ports would require listing every port in `devAllowedDomains` and telling the plugin which to use. |
| 5 | Component selection supports **both reuse and update**, per capture | Reuse alone cannot express "this Figma frame is the new source of truth for an existing component", which is the flow `listComponents` was written for. |
| 6 | **Remove all five option checkboxes and the target select** from the plugin | Every one is either required for a correct build, derived from another choice, or made unnecessary by decision 7. |
| 6a | Auto keeps **Capture + Copy + the open dump**; Manual collapses the dump and leads with **Add to queue** | Auto is the copy-to-chat path, so the dump is the deliverable. Manual sends to the queue, so the dump is a receipt. |
| 6b | Manual shows **the project's queue inside Figma** | Seeing what is already lined up, and where this capture lands, without switching to the app. Needs `GET /queue`. |
| 7 | **SVG sources become asset files**, not inline dump text | This is what makes removing the inline-SVG toggle safe. Inlining is the only reason the 180k output ceiling binds. |

---

## Current state

What already exists, and what has to be built. This matters because roughly half the
work is wiring up code that is written and tested but unreachable.

### Exists and works

- `lib/project.js` — `createProject`, `registerProject`, `forgetProject`, `listProjects`,
  covered by 18 passing tests. **The app never calls any of it.**
- `lib/webflow.js` — `listPages`, `listComponents`, and both caches, tested against a
  `fetchImpl` stub. Its own docstring describes the flow this spec builds:
  *"the 'update an existing component' flow, where you pick the Webflow component first
  and the Figma frame second."*
- `lib/bridge.js` — token-authed writes, slugified section names, path containment,
  frontmatter preservation across re-sends.
- `lib/edit.js` — surgical page-manifest edits.
- The plugin's traversal, covered by `test.js` and `test-e2e.js`.

### Does not exist

- Any project UI. `resolveRoot()` is a blocking native dialog that only opens folders
  that are already pipelines.
- Webflow token storage, and any settings surface. `lib/webflow.js` throws
  *"no Webflow token — add one in Pentool settings"* — pointing at something unbuilt.
- `listSites()`. Both existing calls require a `siteId` the user must already know.
- Any read endpoint on the bridge.
- Any notion of the plugin being connected, or of it being bound to a project.
- `build: update`. `BUILD_MODES` is `static | component`.

### Known defects to fix along the way

- **`.claude/skills` is not in `extraResources`** in `app/package.json`, so a packaged
  build scaffolds projects with no `/webflow-build` or `/webflow-snapshot`. `copyDir` is
  guarded by `existsSync`, so it fails silently.
- **`visual.enabled` is `true` in `_config.json` while the plugin's preview-PNG option is
  off by default**, so the visual check is configured on and starved. Decision 6 fixes
  this by making the preview unconditional.

---

## Architecture

### App — project activation

The ordering inverts. Today:

```text
app.whenReady() → resolveRoot() [blocking dialog] → loadPipeline → createWindow → startBridge → startPty
```

Becomes:

```text
app.whenReady() → createWindow() → renderer draws the sidebar from the registry
                                 → user selects or creates
                                 → activateProject(root)
```

`activateProject(root)` is the single entry point and is re-runnable, because switching
projects calls it again:

```text
tearDown()          kill pty · close bridge · stop the queue watcher
loadPipeline(root)  queue, bridge, edit, snapshot libs from that project
startBridge()       :8930, that project's queue
startPty()          cwd = root
watchQueue()
send('project', { name, root, sections })
```

`resolveRoot()` and its blocking dialog are deleted, along with the dev-mode shortcut
that hardcodes the repo. `root.json` becomes *last active project*: restored on launch,
but non-blocking — if the folder is gone you land on the sidebar, not an error box.

Teardown ordering matters. The bridge must close before the next one binds `:8930`, and
the pty must be killed before its cwd is invalidated. Sequencing lives in a plain module
so it is testable outside Electron.

### App — registry and sidebar

The registry moves to `userData/projects.json`, read through the existing
`lib/project.js` functions.

Sidebar rows show name, section count, and a status dot. `listProjects` already flags
projects whose folder has vanished; those render greyed with a **Forget** action. The
empty state is "No projects yet" and a **New project** button. A settings control sits
in the footer.

### App — settings and the Webflow token

The token is **global, not per-project** — one Webflow account can own many sites.

Stored with Electron `safeStorage` (Keychain-backed on macOS), falling back to a plain
file with a visible warning when unavailable. Never written into a project folder, and
never sent to the plugin.

`listSites()` is added to `lib/webflow.js`: `GET /v2/sites`, Bearer auth, mirroring
`listPages`' pagination and its `friendly()` status-to-message mapping.

### App — new project

A modal: token (collected inline if unset) → fetch sites → pick one → name and location
→ **Create**. Then `createProject()`, `registerProject()`, `activateProject()`.

Two fixes are required for this to work at all:

- `templateRoot` must resolve per environment — `process.resourcesPath` when packaged,
  `path.join(__dirname, '..')` in dev.
- `.claude/skills` must be added to `extraResources`, and `createProject` must **throw**
  rather than silently skip when the skills source is missing.

### Pipeline — queue model

**`build: update` is added to `BUILD_MODES`**, with a `componentId` frontmatter key.

| Rule | Severity |
| --- | --- |
| `build: update` requires `componentId` | error |
| `componentId` set on `static` or `component` | error |
| `componentId` names a component absent from the components cache | warning — the cache may be stale |

**The bridge begins maintaining page manifests.** Today `queue/pages/*.md` are
hand-written. When a capture names a target Webflow page, the section is appended to
that page's manifest, created from `_config.json` defaults if absent. Appending must be
idempotent: re-sending a section must not duplicate its entry. This belongs in
`lib/edit.js`, which already performs surgical manifest edits.

**`/webflow-build` must learn `build: update`** — diffing an existing component's tree
rather than appending to a page. This is a `SKILL.md` change and is expected to be the
fiddliest part of the work.

### Pipeline — bridge protocol

The bridge gains a read side and an extended write payload.

```text
POST /pair/start          → { pairId, approveUrl }        unauthenticated
GET  /pair/<pairId>       → HTML approval page            opened in the browser
POST /pair/<pairId>/approve { project }                   from that page
GET  /pair/<pairId>/status → { pending } | { ok, token, project }   plugin polls

GET  /projects            → the registry, for the approval page
POST /hello               → { ok, project, queue, webflow: { pages, components, fetchedAt } }
GET  /queue               → resolve(root) — the plan the queue view renders
GET  /pages               → readPagesCache(root)
GET  /components          → readComponentsCache(root)
POST /section             → unchanged shape plus `target` and `svgs`
```

Everything below the blank line requires the token header. The `/pair/*` endpoints are
the exception, by necessity — they are how a token is obtained.

**The pairing flow:**

```text
plugin                      bridge                        browser
  │                           │                              │
  ├─ POST /pair/start ───────▶│  mint pairId, 2-min expiry   │
  │◀─ { pairId, approveUrl } ─┤                              │
  │                           │                              │
  ├─ figma.openExternal(approveUrl) ───────────────────────▶ opens
  │                           │◀─ GET /pair/<pairId> ────────┤
  │                           ├─ page listing projects ─────▶│
  │                           │◀─ POST …/approve { project } ┤
  │                           │  mint token, bind to project │
  ├─ GET …/status ───────────▶│                              │
  │◀─ { ok, token, project } ─┤  single use, then discarded  │
```

`/pair/start` must be unauthenticated — there is no token yet, which is the whole point.
Its guards are that it issues **no token**, only an id; the id is high-entropy and known
only to the caller; it expires after two minutes; `/status` returns the token **once** and
then discards the record; and the endpoint is rate-limited. Nothing is granted until a
human clicks Approve on a page they reached by a URL only the plugin knew.

*Residual risk, accepted:* a local process that could read the plugin's traffic could poll
`/status` first. Short expiry and single-use are the mitigations. This is the same shape
as a device-code flow and is a deliberate trade for removing the copy-paste step.

Once paired, `/hello` is pinged when the panel opens and every 15s after; the bridge marks
the plugin stale at 40s. It still returns the **project name** so the plugin can display
*"→ sending to acme-rebuild"* — the mitigation for decision 4, where one bridge means a
capture could otherwise land in a project you had switched away from.

`POST /section` grows two fields:

```json
{
  "name": "hero", "dump": "…", "images": [],
  "svgs": [{ "name": "icon-1.svg", "source": "<svg …>" }],
  "target": {
    "page": "/markets",
    "component": { "id": "65f2a1…", "name": "market-card", "mode": "reuse" }
  }
}
```

`target` is optional; omitting it preserves today's behaviour, which is what auto mode
sends.

**Refresh is app-only, deliberately.** Refreshing the caches needs the Webflow token,
which lives in the app. The in-process bridge can refresh on demand. The standalone
`bin/pentool-bridge.js` has no token and serves cache only, responding
`{ stale: true, reason: "no token outside the app" }` rather than an empty list that
would read as "this site has no components".

### Plugin — onboarding

The URL and token fields are removed. Nothing is typed and no secret is ever shown.

```text
1  Looking for Pentool…          auto-probes :8930/health
   ✓ Found Pentool

2  [ Connect this file ]         → /pair/start → browser → approve
   ✓ Connected to acme-rebuild

3  Project   [ acme-rebuild ▾ ]  switchable later, from /projects
             + New project…      → focuses the app's new-project modal
```

**Where each thing is remembered.** The token goes in `figma.clientStorage` — per user,
per machine. The chosen project goes in `figma.root.setPluginData()` — per **document**,
so each Figma file reopens bound to its own project. This is what makes "connect this file
to a project" literally true rather than a global setting.

**Project creation stays app-side.** The approval page offers "New project…", which focuses
the app's existing modal — the plugin initiates, the app completes. A folder picker is not
available to either a plugin sandbox or a browser page: `showDirectoryPicker()` yields a
handle, not a path the bridge could act on.

**States the panel must show:** Pentool not running · found but not paired · paired ·
paired but the project has since been removed from the registry.

### Plugin — modes

A mode switch at the top of the panel. **Auto** is today's behaviour, unchanged: track
the canvas selection, clear the output when it changes, press Capture.

**Manual** replaces inference with explicit choices:

```text
Source    Figma page  [ Marketing        ▾ ]
          Frame       [ markets-grid     ▾ ]

Target    Webflow page      [ /markets    ▾ ]
          Component         [ market-card ▾ ]
                            ( ● ) reuse — place an instance
                            (   ) update its definition
```

Figma dropdowns are local. `documentAccess: "dynamic-page"` makes listing pages cheap via
`figma.root.children`, but reading a page's frames requires `await page.loadAsync()`
first. Pages populate immediately; frames load lazily on selection. `loadAllPagesAsync()`
is **not** called — it stalls on large files.

Webflow dropdowns come from the bridge and are disabled with a stated reason when it is
not connected, which `/hello` already reports.

### Plugin — options removed

All five checkboxes and the target select are removed. Values become fixed:

| Option | Fixed to | Why it cannot be a preference |
| --- | --- | --- |
| inline SVG | n/a — replaced | Superseded by SVG asset files (decision 7) |
| export images @2x | on | `wf: Image` has no asset without it |
| preview PNG | on | The visual check has nothing to compare against without it |
| a11y audit | on | Free, advisory, affects nothing that gets built |
| expand instances | derived | It is the exact inverse of the reuse/update choice |
| target | webflow | Three render branches; the product is Webflow-specific |

**`expandInstances` is derived, not fixed.** `code.js:704` emits `REUSE` only when it is
off. So `reuse` mode requires it off and `update` mode requires it on. Left as a free
checkbox it permits a state that silently contradicts the user's own choice — ticking
expand while choosing reuse means the `REUSE` line never appears and the builder rebuilds
the component. Manual mode sets it from the radio and displays it as derived. Auto mode
has no component decision, so it is simply off.

**`STORE_KEY` must be bumped to `pentool.opts.v2`.** This is mandatory, not hygiene.
`code.js:1243` persists options in `clientStorage`, and anyone who has already run the
plugin has `svg: false` and `images: false` saved from today's defaults. Without the
bump, those values keep overriding the new fixed ones and captures silently come out
missing icons and images. The comment above that line warns about exactly this, and the
failure is invisible when testing on a fresh Figma profile.

`root is` (`rootRole`) is kept. It overrides an auto-detection that is sometimes wrong,
and it is not Webflow-specific.

**"send to queue" stops being a toggle.** With pairing automatic and a project bound to the
document, sending is the default: a capture goes to the paired project unless the panel is
unpaired, in which case the output is still shown for copying. The checkbox, the URL field
and the token field all disappear from the panel.

### Plugin — SVGs as files

The plugin sends an `svgs` array; the bridge writes each to `assets/<name>.svg`. The dump
keeps its compact `-> SVG #1` references, so the layer-to-icon mapping survives — this is
why references are not dropped entirely. The shelf and its copy buttons are unaffected.

This removes the reason the 180k `MAX_CHARS` ceiling binds. Truncation stays as a
backstop, but its message must no longer advise turning off inline SVG, which will no
longer be an option.

### Removing the target — downstream

`opts.target` is three render branches (`code.js` lines 1006, 1055, 1099), no traversal
difference, and no test coverage of raw mode. Removal does not foreclose the deferred
Code target in `plan.md` P2: what makes that cheap is the model/renderer split, which is
untouched.

Two consequences in `lib/bridge.js`:

- The frontmatter `# NOTE: no "wf:" lines in this dump — was the target set to Webflow?`
  becomes unanswerable. Delete it.
- `writeSection`'s warning `'no "wf:" lines — this looks like a Raw Figma dump'` keeps its
  **check** — an empty frame or a hand-pasted dump can still produce no `wf:` lines — but
  the wording becomes false. Reword to *"no `wf:` lines — nothing here can be built"*.
  The existing test asserting `/Raw Figma/` must be updated with it.

---

## Data flow

```text
plugin ── /pair/start ──▶ browser approval ──▶ token + project
                                                  └ bound to the Figma document

Webflow account
  └ listSites()            app, on new project
      └ siteId → queue/_config.json
          └ listPages() / listComponents()      app, with the stored token
              └ queue/_pages.json, _components.json
                  └ GET /pages, GET /components  bridge, cache only
                      └ plugin manual-mode dropdowns
                          └ POST /section { dump, images, svgs, target }
                              └ queue/sections/<name>/     section.md, assets/
                              └ queue/pages/<slug>.md      appended, idempotent
                                  └ wf-queue.js plan       validate + order
                                      └ /webflow-build     one section, then stop
```

---

## Error handling

| Condition | Behaviour |
| --- | --- |
| `:8930` already bound | Bridge reports `failed` naming the likely cause — another Pentool window, or a standalone `pentool-bridge` |
| Project folder deleted while listed | Row greys out, offers **Forget**; activation refuses rather than half-loading |
| Webflow token missing or rejected | Settings surfaces `friendly()`'s message; site and component pickers disable with that reason |
| Plugin sends a stale `componentId` | Warning at validation, not an error — the cache may simply be old |
| Pairing not approved within 2 minutes | Record expires; the plugin says so and offers to retry rather than polling forever |
| Approval page opened without a valid `pairId` | 404 with no project list — an unknown or expired id must not enumerate projects |
| Paired project later removed from the registry | Panel shows "project no longer exists" and offers re-pairing; captures refuse rather than falling back to another project |
| Capture arrives mid project-switch | The in-flight POST fails; the plugin reports the bridge restarted. `/hello` naming the project is the preventative half |
| Skills source missing at scaffold time | `createProject` throws — a project without its skills is broken, not degraded |
| Output exceeds `MAX_CHARS` | Truncation stays, with a message that no longer references a removed option |

---

## Testing

Everything below runs without Figma, Webflow, or Electron, which is the point.

| Area | Cases |
| --- | --- |
| `listSites()` | pagination, auth failure mapping, via `fetchImpl` stub as `listPages` is tested |
| Bridge read endpoints | `/pages`, `/components`, token required, the no-token stale path |
| Pairing | `/pair/start` issues no token; expiry; single-use `/status`; unknown id does not list projects; approve binds the chosen project |
| `/projects` | serves the registry, flags missing folders |
| `/queue` | serves the resolved plan; grouping and order match `wf-queue.js plan` |
| `/hello` | auth required, project name returned, staleness after 40s |
| `POST /section` | `target` handling, `svgs` written as files, existing cases still pass |
| Manifest maintenance | append creates a manifest from config defaults; re-send does not duplicate |
| Queue model | `build: update` requires `componentId`; `componentId` rejected on other modes |
| Plugin | manual-mode payload construction kept as a pure function so `test.js` covers it |
| Regression | `test-e2e.js` continues to cover auto mode end to end |

`activateProject` sequencing is kept in a plain module so its teardown order can be
tested without an Electron host.

---

## Build order

Each stage leaves all three projects working. Ordered so dependencies land first — model
before protocol, protocol before UI.

| | Stage | Project | Notes |
| --- | --- | --- | --- |
| 1 | Activation refactor — sidebar, registry, switching | app | Fixes the reported problem on its own; the fixtures stop appearing |
| 2 | Token storage, settings, `listSites()` | app | Unlocks stage 3 |
| 3 | New project — plus `extraResources` and `templateRoot` fixes | app | |
| 4 | Queue model — `build: update`, `componentId`, manifest maintenance, `/webflow-build` | pipeline | Deepest change; includes a skill rewrite |
| 5 | Bridge protocol — pairing, `/projects`, `/hello`, `/pages`, `/components`, `target`, `svgs` | pipeline | Includes the served approval page |
| 6 | Plugin — onboarding, manual mode, option removal, SVG files, `STORE_KEY` v2 | plugin | Token and URL fields deleted |

Stage 1 alone resolves what prompted this work. Stages 4–6 carry most of the weight.

---

## Risks

**The skill rewrite is the least predictable part.** `build: update` requires
`/webflow-build` to diff an existing component tree rather than append to a page, and
Webflow has no undo API. It should be built last within stage 4 and exercised against a
throwaway site first.

**`PROFILE.built` fed live from Webflow widens `REUSE` considerably.** Today it is three
hardcoded names; the live component list may be dozens. More instances will come through
as references rather than expanded trees. That is the intended behaviour — if it exists
in Webflow, reuse it — but it is a visible change in output on existing captures, and
worth watching on the first real build.

**Pairing trades a small amount of security for a large amount of friction.** The
copy-paste token was unambiguous: you could not pair without access to the app's console.
The browser flow is safer than no check and materially easier, but `/pair/start` is
necessarily unauthenticated. The guards are listed above; they should be reviewed before
this ships rather than treated as settled.

**No live Webflow build has ever run.** This spec is written against a system whose build
path is validated but unexercised. Estimates for stage 4 in particular should be treated
as provisional.

---

## Out of scope

- Per-project Webflow tokens — one account is assumed
- Webflow OAuth. The Webflow token stays in app settings and never enters the Figma
  sandbox; the plugin receives lists through the bridge and never credentials. Worth
  revisiting, but it needs checking whether Webflow supports PKCE for public clients
- Windows or Linux packaging
- Breakpoints, component variants, CMS collection creation, localization
- Webflow Interactions (IX3) — no API can create them
- The deferred Code target from `plan.md` P2
