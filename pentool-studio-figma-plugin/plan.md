# Pentool Studio — status & plan

Handoff notes. Everything needed to continue in a fresh session.

---

## Why this exists

The Figma MCP server hit the **Starter plan tool-call limit** mid-project and is no
longer usable. Paying for a Figma paid plan is not an option right now. Pentool Studio
replaces it: the Figma **Plugin API** is free, runs locally, and has no quota.

The workflow it serves:

```text
select frame in Figma → Pentool Studio → paste into Claude Code → agent builds it in Webflow
```

It is not a downgrade. For icons it is strictly better — see "What we learned".

---

## Status

**Working. Runs in Figma, and its output has been used to build real components in
Webflow via Claude + the Webflow MCP.**

| | |
| --- | --- |
| `manifest.json` | valid JSON, Design-mode plugin, id `pentool-studio` |
| `code.js` | passes `node --check` |
| `ui.html` | inline script passes `node --check` |
| `test.js` | 77 assertions, all passing |
| Runs in Figma | ✅ yes |
| Output drove a real Webflow build | ✅ yes, several components |

`node test.js` covers the pure logic under a stubbed `figma`: WCAG contrast against
published reference pairs, slug/rem/unit conversion, `cfStyle` declaration output,
junk-name detection, heading level parsing, nearest-match size scales, class
inventory lookups. It cannot cover anything that touches the real API — that part is
now validated by use rather than by test.

### Still unverified

Not broken, just never exercised — each is off by default or rarely hit:

- **Image export and the download path.** `export images @2x` and `preview PNG` both
  default off. Note that download is the *only* way an image leaves the plugin —
  clipboard and drag-out are both blocked by Figma's iframe sandbox, and the reasons
  are documented in `ui.html` next to `deliver()` so nobody retries them.
- **`icon-embed-*` and `text-size-*` rem values** in `PROFILE` are Relume defaults,
  never checked against the live stylesheet. A wrong value shifts a class by one
  step rather than breaking anything.
- **Grid auto-layout**, **`inferredAutoLayout`**, and **`getStyledTextSegments`** —
  all wrapped, all degrade to omitting a line rather than throwing.

---

## Architecture

Plain JS, no build step, no dependencies. **Keep it that way** — the value is that it
imports straight from a manifest with zero tooling. That constraint is also why
`code.js` is one file: the Figma sandbox has no module loader, so splitting it would
require a bundler.

```text
manifest.json   Design-mode plugin, documentAccess: dynamic-page, no network
code.js         sandbox: PROFILE → utils → model → a11y → renderers → main
ui.html         iframe: target/role pickers, options, textarea, image shelf
test.js         node test.js — pure logic under a stubbed figma
```

One traversal, two renderers:

1. `run(opts)` reads the selection and indexes every node by id.
2. `walk()` builds a **model tree** — no strings. It resolves variables, reads
   component properties, segments mixed text, and collects a11y findings as it goes.
3. `renderNode()` prints the shared layer tree, and for the Webflow target appends a
   `wf:` line per node with the class proposal, element, semantic tag and CSS.
4. Header and a11y sections are rendered from data collected during the walk.

Splitting traversal from rendering is what makes the targets pluggable. A third
renderer (the deferred Code target, or the roadmap's JSON mode) is a new function,
not a new walk.

### The PROFILE block

Everything site-specific lives in one constant at the top of `code.js`: components
already built, the style-guide class inventory, text/icon size scales, and the
Webflow API quirks. It is derived from the GCE Dev style guide (Relume v3.0 /
Client-First v2.1) **minus the margin/padding/spacer utilities**, which that project
strips in favour of flex gap. That omission is load-bearing: it means no pixel value
is ever snapped to a spacing class, which removes the largest source of guessing.

---

## Output contract

Consumers depend on this shape. Change it deliberately.

```text
=== BUILD CONTRACT (webflow / client-first) ===
site / root role / REUSE list / VARIABLES used / WEBFLOW API QUIRKS / legend

=== <name> (<type>, id <figma id>) ===
frame "action-card"  328×344  clips  · component
    layout: column gap:60[space/xl] pad:32 align:start
    fill: surface/subtle (#FAF9F8)
    wf: DivBlock .action-card_component   [new]
        display: flex
        gap: 3.75rem  /* space/xl */
  text "title"  264×32  · element
      type: 24/32 Articulat CF Regular style:Heading/05
      text: "I need equipment"
      wf: Heading h3 .heading-style-h5   [existing]

=== ACCESSIBILITY ===
✗ / ! / · / ✓ findings

=== SVG SOURCES ===
=== IMAGE FILES ===
```

Load-bearing details:

- `[hidden]` marks invisible layers. This is how per-state diffs are read — the hover
  variant of a card differs from default only by which layers are hidden. **Never**
  set `figma.skipInvisibleInstanceChildren`; it would silently break this.
- `abs: t/r/b/l` is emitted only when the parent is not auto-layout, or the child
  opts out. These are the numbers needed to place overlays.
- Fills print as `token/name (#HEX)` when a variable is bound, bare hex otherwise,
  and `(library variable, name unavailable)` when a name cannot be resolved.
- `[new]` / `[existing]` / `[name inferred]` separate derived fact from inference.
  Never collapse them — the whole point is that the consumer can tell which is which.

---

## Roadmap

### P0 — done

- [x] Run in Figma; fix the first round of errors. *No errors surfaced.*
- [x] Validate the output against a real Webflow build. *Several components built.*

### P1 — tune against real use

Everything here needs observed output to justify, not speculation. Capture a real
paste before changing any of it.

- [ ] **a11y noise.** The "looks decorative" heuristic and the per-image alt warning
      were both predicted to over-fire. If findings are being skimmed rather than
      read, tighten the heuristics or split advisory findings from failures.
- [ ] **Role inference** (section/layout/component/element). The UI pins the root;
      children are still guessed. Worth tuning only where it guesses wrong often.
- [ ] **Class-name inference** for junk-named layers (`Frame 7` → `_icon-wrap`).
      Same test: how often does the `[name inferred]` tag mark something wrong?
- [ ] **List detection** compares sibling type and size, so cards of differing
      height are not recognised as a list.
- [ ] **Original-resolution images.** Currently 2x of the *layer frame*, not the
      source asset. Use `imageHash` → `figma.getImageByHash()` → `getBytesAsync()`.

### P2 — the Code target

Deferred deliberately. The model/renderer split is already in place, so this is a
`renderNode` branch plus a header, not a rewrite. Worth noting: the Relume MCP
connected to this workspace is the **React** library, not the Webflow one — it lines
up with this target, not the Webflow one.

### P3

- [ ] Component-set mode: select a set, capture every variant with a computed diff.
- [ ] JSON output mode as a third renderer.
- [ ] Multi-select and whole-page capture.
- [ ] Colour schemes. `color-scheme-1..10` each expose `--text/--background/
      --foreground/--border/--accent`. Whether Figma's `GCE Colors` variables are
      role-shaped enough to map onto them is unresolved and was parked.

---

## What we learned about the Figma Plugin API

Saves rediscovery:

- **`node.boundVariables`** carries the design-token name per property — and not
  only for fills. `itemSpacing`, `paddingTop/Right/Bottom/Left`, `topLeftRadius`,
  `strokeWeight`, `characters` and more all bind. Reading only fills throws most of
  the design system away.
- **`node.getStyledTextSegments([...])`** is the only way to see a bold word inside
  a sentence. Without it every typography field collapses to `figma.mixed` and the
  entire line gets dropped.
- **`node.componentProperties`** is a superset of `variantProperties` — it carries
  TEXT / BOOLEAN / INSTANCE_SWAP values, which is the component-prop mapping.
- **`node.inferredAutoLayout`** tells you what auto-layout a hand-positioned frame
  *would* have. Turns absolute positioning into a flex rebuild.
- **`node.exportAsync({format:'SVG_STRING'})`** returns one correct flattened SVG.
  The MCP's export was worse — one icon came back as an empty base layer plus ten
  disconnected fragments to be reconstructed by hand from inset percentages.
- **`node.reactions`** exposes real prototype wiring (`ON_HOVER -> CHANGE_TO`).
- **Design mode, not Dev mode.** `"editorType": ["figma"]`. Dev Mode is the surface
  Figma gates on free plans — the same gate that killed the MCP.
- **`documentAccess: "dynamic-page"`** requires the async API variants
  (`getVariableByIdAsync`, `getStyleByIdAsync`).
- **Pentool Studio can compute WCAG contrast itself.** It holds the text fill and the ancestor
  background, so it answers rather than defers. This is the one thing it does that
  neither the MCP nor a screenshot can.

---

## Downstream consumer

Pentool Studio output feeds **[pentool-studio-app](../pentool-studio-app)** — a separate,
zero-dependency project that queues sections per page and builds them into Webflow
through the Webflow MCP. It owns the queue, the build skill, and a local bridge
that receives dumps and screenshots straight from this plugin.

The only coupling is an HTTP contract: `POST /section` with `{ name, dump, images }`
and a token. Pentool Studio's side is one option in `ui.html` plus
`devAllowedDomains: ["http://localhost:8930"]` in the manifest — everything else
about the plugin is unchanged, and it still works with the bridge switched off.

The build targets a **Webflow** site (`GCE Dev`, id `0000000000000000000000ex`)
via the Webflow MCP. Components built so far: `market-card`, `action-card`, `label`,
all in the `GCE` component group, styled with a `GCE Colors` variable collection on
Relume v3.0 / Client-First v2.1.

Next design to build is Figma node `13805-1771` — an image + `label` + two-line copy
block. It composes the existing `label`, so it should come through as a REUSE line.
That makes it a good first real test of the reuse path.

Webflow-side quirks, restated in every Webflow-target header:

- `set_text` is silently ignored on DivBlock — write copy afterwards via
  `set_settings` with key `text`, then verify.
- Applying multiple classes needs the combo pairing created first via `create_style`
  with `parent_style_names`, otherwise `set_style` fails with "styles not found".
- Embed `code` **cannot** be bound to a component prop — Webflow returns
  `Setting "code" does not support bindings`. Slots are the intended workaround but
  were not writable through the API.
