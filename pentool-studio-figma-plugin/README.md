# Pentool Studio

A local Figma plugin that captures everything needed to rebuild a design elsewhere —
without the Figma MCP server or its plan quota.

Select a frame, hit **Capture selection**, paste the result into a chat. The Webflow
target adds Client-First class proposals, semantic markup and an accessibility
audit. Icons come through as SVG files and photos as PNGs, alongside the text.

## Install

1. Figma desktop → **Plugins → Development → Manage plugins in development**
2. Remove any older **Relay** or **Pentool Studio** entry first — a renamed folder
   leaves a dead path
   behind and Figma will throw `ENOENT … manifest.json`.
3. **Import plugin from manifest…** → pick `manifest.json` in this folder.

No build step. Plain JS, no dependencies. Runs in Design mode, so it works on the
free plan — Dev Mode plugins do not.

## Connecting

The panel finds Pentool on `localhost:8930` by itself — there is no URL to type and
no token to copy.

1. **Connect this file** opens an approval page in your browser
2. Pick the project this Figma file should send to, and approve
3. The panel shows **Sending to <project>** from then on

The token is kept in `figma.clientStorage`, per user. The **project is stored on the
document**, so every Figma file reopens bound to its own project. **Disconnect**
clears both.

Captures go to the paired project automatically. Unpaired, the output still lands
in the textarea and the shelves, so a stopped bridge never costs you a run.

## Modes

| Mode | Source | Target |
| --- | --- | --- |
| **Auto** | whatever is selected on canvas | inferred downstream |
| **Manual** | a Figma page and frame you pick | a Webflow page, and optionally a component |

Manual mode's Webflow lists come through the bridge — the plugin has no network
access of its own beyond localhost, by design. Pick a component and choose whether
to **reuse** it (the builder places an instance) or **update its definition** (the
frame becomes its new source of truth).

## What it captures

Per layer, in nesting order:

| Field | Example |
| --- | --- |
| type, name, size, role | `frame "action-card"  328×344  · component` |
| variant / instance / props | `variant: State=Default`, `of:label`, `props: text="Popular"` |
| hidden layers | `[hidden]` — how you spot per-state differences |
| auto-layout, incl. grid and inferred | `layout: column gap:60[space/xl] pad:32 align:start` |
| responsive sizing | `sizing: max-w:640 grow:1 constraints:stretch/min` |
| absolute offsets | `abs: t16 r16 b318 l292` |
| fills & strokes **with token names** | `fill: surface/subtle (#FAF9F8)` |
| radius, effects, opacity, blend | `effects: inner-shadow 0,0.5 blur:0 #000000 10%` |
| typography, incl. mixed runs | `type: 24/32 Articulat CF Regular style:Heading/05` |
| text content and segments | `text: "I need equipment"` |
| prototype wiring | `reactions: ON_HOVER -> CHANGE_TO` |

Then an `SVG FILES` section (deduplicated — a grid of six identical icons emits
one) and any exported images.

## Selection

The panel tracks the Figma selection. Selecting a different node **clears the
output**, so a stale paste can never be attributed to the wrong layer — the status
line shows what is selected and waits for you to press Capture. A selection change
during a run is ignored, so clicking around mid-walk won't wipe the incoming result.

## SVGs

Every exported icon appears as a thumbnail below the output with a **Copy SVG**
button that puts the source on your clipboard. The numbering matches the `SVG #n`
markers in the text, and identical icons are exported once and referenced on
repeats.

Sources are **not** inlined in the dump. They are sent to the paired project as
`assets/icon-<n>-<name>.svg` and the text keeps only the `-> SVG #n` reference, so
the layer-to-icon mapping survives without the bulk. Inlining was the only reason
the 180,000-character ceiling ever bit.

Text copy works where image copy does not: `writeText` is generally permitted, and
where it isn't, `execCommand` over a selected textarea is gated on a user gesture
rather than Permissions-Policy.

## Why token names matter

`node.boundVariables` is read for fills, strokes **and** scalar properties —
spacing, padding, radius, stroke weight, text content. So a gap bound to
`space/xl` prints as `gap:60[space/xl]` rather than a bare `60`, and the rebuild
binds a real variable instead of hardcoding a pixel value. Library variables that
can't be resolved say so explicitly rather than degrading silently to hex.

## The Webflow target

Assumes **Client-First v2.1** with the **Relume v3.0** style guide, minus the
`margin-*` / `padding-*` / `spacer-*` utilities — that project spaces with flex
gap, so nothing snaps a pixel value to a spacing class.

Each layer gets classified as **section / layout / component / element** and named
accordingly (`section_markets`, `markets_layout`, `market-card_component`,
`market-card_title`). Every proposal is tagged:

- `[existing]` — already in the style guide, don't create it
- `[new]` — needs creating, with the CSS listed beneath
- `[name inferred]` — the Figma layer name was auto-generated (`Frame 7`), so the
  name came from structure and deserves a glance

Instances of components listed in `PROFILE.built` are emitted as
`REUSE component "label" — do not rebuild`. Any other component shows its
structure once and is referenced on every repeat.

### Units

Client-First is rem-based, so **every dimension above 1px is emitted in rem** —
gap, padding, radius, borders, shadows, blurs, min/max sizing. Values at or below
1px stay in px: a hairline border should not scale with the root font size, and
`0.0625rem` reads as a mistake rather than an intent.

This applies to the generated CSS only. The layer tree above it still reports
Figma's own numbers in px (`328×344`, `stroke: … 1px`, `type: 24/32`), because
that half of the output describes the design rather than the build.

### Accessibility

Pentool Studio holds both the text colour and the background, so it computes WCAG contrast
outright instead of flagging it for a human. It also reports missing alt text,
icon-only interactives with no accessible name, tap targets under 44×44, skipped
heading levels, and layers that look decorative.

It does **not** invent alt text — it doesn't know editorial intent, so it marks
the requirement and leaves the string to you.

## Options

There is one, because the rest stopped being preferences.

- **root is** — pin the top-level node as section / layout / component / element
  instead of letting Pentool Studio guess. The one inference worth overriding by hand.

Everything else is now fixed or derived:

| Was a checkbox | Now | Why |
| --- | --- | --- |
| export images @2x | always on | a `wf: Image` with no asset is a silent failure |
| preview PNG | always on | the visual check has nothing to compare against without it |
| a11y audit | always on | free, advisory, changes nothing that gets built |
| inline SVG | replaced | icons still export, but travel as `assets/*.svg` files |
| expand instances | derived | it is the exact inverse of reuse — see below |
| target | removed | the output is Webflow-specific |

**expand instances is derived, not fixed.** `REUSE` is only emitted while it is off,
so "reuse this component" needs it off and "update its definition" needs it on. As a
free control it allowed a state that contradicted your own choice: tick expand while
choosing reuse and the `REUSE` line never appears, so the builder rebuilds the very
component you asked it to reuse.

`root is` and the mode persist between runs via `figma.clientStorage`.

## Resizing

Drag the grip in the bottom-right corner. Figma plugin windows have no native
resize affordance — the plugin has to call `figma.ui.resize()` itself — so the grip
is the only way to grow the panel. The output area absorbs all the extra space, and
the size is remembered between sessions. Bounds are 420×360 to 1600×1400.

## Images

Exported images appear as thumbnails under the output with a **Save PNG** button.
Nothing is written to disk unless you press it — no automatic downloads.

**Downloading is the only way an image leaves the plugin**, and that is a platform
limit rather than a missing feature. Both alternatives were tried and neither can
work from a Figma plugin:

- *Clipboard* — needs `navigator.clipboard.write()`. Figma's plugin iframe is a
  sandboxed opaque origin that Permissions-Policy denies `clipboard-write`. The
  `execCommand` workaround only writes a `text/html` flavour that no paste target
  reads as an image.
- *Drag and drop* — a drop target reads `dataTransfer.files`, which only a real OS
  file drag populates. `DownloadURL` cannot synthesize one from a `data:` URL, and
  Figma desktop is a separate application from the browser you would drop into.

**To put a design image on your clipboard, use Figma's own right-click → Copy as
PNG on the canvas.** It is the right tool and it already works. Pentool Studio's image
export exists for pulling out individual asset layers, not for replacing that.

## Configuring it for your site

Everything site-specific lives in the `PROFILE` block at the top of
[`code.js`](code.js): which components already exist, the utility class inventory,
the text/icon size scales, and the Webflow API quirks worth restating. Edit that
block; nothing else assumes a particular project.

## Tests

```sh
node test.js       # pure logic
node test-e2e.js   # the whole traversal
```

`test.js` runs the pure logic — contrast math, naming rules, class matching, size
scales — under a stubbed `figma`.

`test-e2e.js` drives `run()` over a synthetic Figma document and asserts the dump
comes out shaped like a real capture: layout, typography, fills, strokes, inline
SVG, the accessibility audit and the preview export. It catches a break in the
walk itself, which testing the helpers alone would not. `DUMP=out.txt node
test-e2e.js` writes the generated capture out to eyeball.

No dependencies, either way.

## Known limits

- Images export at 2x of the layer frame, not the original asset resolution.
- Output is capped at 180k characters with a visible truncation notice.
- Icon and text rem scales are the Relume defaults; correct them in `PROFILE` if
  your style guide overrides them.

## Downstream

Pentool Studio output feeds [pentool-studio-app](../pentool-studio-app), which queues sections
per page and builds them into Webflow through the Webflow MCP. Start its bridge
and connect this file to a project, and a section lands in `queue/sections/<name>/` on every
run — dump and screenshots together, no clipboard involved.

`manifest.json` allowlists `http://localhost:8930` under `devAllowedDomains`, the
slot Figma provides for local development servers. Production network access stays
closed (`allowedDomains: ["none"]`), and the plugin works unchanged with the bridge
switched off.

See `plan.md` for current status and the roadmap.
