# Proof — the real artifacts

The strongest thing this page can do is show the output. It is unusually
legible for a machine format, and the legibility *is* the pitch: you can read it
and tell whether it understood your design.

Everything below is generated, not mocked up. Regenerate the capture with:

```sh
cd pentool-studio-figma-plugin && DUMP=out.txt node test-e2e.js
```

## A full capture

This is one section walked end to end. Worth showing at length rather than
cropping to three lines — the density is the point.

```text
=== BUILD CONTRACT (webflow / client-first) ===
site: GCE Dev
root: "markets-grid" · section

WEBFLOW API QUIRKS:
  ! set_text is silently ignored on DivBlock — write copy with set_settings key "text", then verify.
  ! Multiple classes need the combo pairing created first via create_style with parent_style_names.
  ! Embed "code" cannot be bound to a component prop — Webflow rejects the binding.

Legend  [new] create it · [existing] already in the style guide · [name inferred] Figma layer name was auto-generated, sanity-check it

=== markets-grid (frame, id n7) ===
frame "markets-grid"  1440×720  · section
    layout: column gap:60 pad:96 80 96 80 align:center w:fill
    fill: #FAF7F5
    wf: Section .section_markets-grid   [new]
        display: flex
        flex-direction: column
        gap: 3.75rem
        padding: 6rem 5rem 6rem 5rem
        align-items: center
        background: #FAF7F5
  text "Markets we serve"  640×48  · element
      fill: #1A1A1A
      type: 40/48 Articulat CF Bold align:center
      text: "Markets we serve"
      wf: Text .section_markets-we-serve .text-size-large .text-align-center   [new]
          color: #1A1A1A
  frame "market-card"  328×344  · component
      layout: column gap:16 pad:32
      fill: #FFFFFF
      stroke: #E6E6E6 1px inside
      radius: 12
      wf: DivBlock .market-card_component   [new]
          display: flex
          flex-direction: column
          gap: 1rem
          padding: 2rem
          border-radius: 0.75rem
          background: #FFFFFF
          border: 1px solid #E6E6E6
    vector "icon"  24×24  · element
        fill: #000000
        -> SVG #1
        wf: HtmlEmbed .market-card_icon .icon-embed-xsmall   [new]
            color: #000000
    text "card-title"  264×32  · element
        fill: #1A1A1A
        type: 24/32 Articulat CF Regular
        text: "Equipment rental"
        wf: Text .market-card_card-title .text-size-large   [new]
            color: #1A1A1A
    text "faint-caption"  264×20  · element
        fill: #EDEDED
        type: 14/20 Articulat CF Regular
        text: "Barely visible"
        wf: Text .market-card_faint-caption .text-size-small   [new]
            color: #EDEDED
    rectangle "photo"  264×160  · element
        fill: IMAGE fill
        -> IMG photo-1.png
        wf: Image .market-card_photo .aspect-ratio-landscape   [new]
            alt="…"  ← required

=== ACCESSIBILITY ===
✗ faint-caption  #EDEDED on #FFFFFF → 1.17:1, fails AA (needs 4.5:1 at 14px)
✗ photo  image needs alt text — the layer name is not alt text

Pentool Studio cannot write alt text — it does not know editorial intent. Every "required" above needs a human string.

=== SVG SOURCES ===
--- SVG #1 — icon ---
<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>

=== IMAGE FILES ===
- _preview-markets-grid.png
- photo-1.png
```

## What to point at in it

Not every line below appears in the capture above — the synthetic tree used to
generate it has no bound variables and no already-built components. The source
column says where each one is real, so nothing gets quoted onto a page from the
wrong artifact.

| Line | Where it appears | The claim it proves |
| --- | --- | --- |
| `wf: Section .section_markets-grid   [new]` | capture above | class proposals, marked new vs existing |
| `gap: 3.75rem` / `border: 1px solid` | capture above | rem everywhere, hairlines left in px |
| `color: #1A1A1A` on a text layer | capture above | fills read as foreground on text, background on boxes |
| `✗ … 1.17:1, fails AA (needs 4.5:1 at 14px)` | capture above | contrast computed outright, not flagged for a human |
| `✗ photo image needs alt text` | capture above | it knows an image needs one, and says it cannot write it |
| `-> SVG #1` + the `SVG SOURCES` block | capture above | icons come through as source, deduplicated |
| `WEBFLOW API QUIRKS:` block | capture above | the hard-won knowledge that usually lives in someone's head |
| `.heading-style-h2   [existing]` | section on disk, below | it knows what your style guide already ships |
| `REUSE component "market-card" — do not rebuild` | section on disk, below | it does not duplicate what you built |
| `fill: surface/subtle (#FAF9F8)` | **needs a real Figma file** | design tokens resolved to their names, not just hex |

The token line is the strongest single claim on the page and it is the one not
yet captured from real data — it needs a frame with bound variables, which the
stub cannot fake. Capture one before writing copy around it.

A screenshot loses tokens, a code export loses them, and they are the difference
between markup that fits your design system and markup you have to reconcile with
it.

## The pipeline, as it actually runs

```text
Figma
  └ select a frame → Capture
      └ bridge (127.0.0.1:8930, token-authed)
          └ queue/sections/<name>/
              ├ section.md      frontmatter + the dump
              └ assets/*.png    screenshots and exports
                  └ node bin/wf-queue.js plan     validate + order
                      └ /webflow-build            one section, then stop
                          └ staging screenshot vs the Figma export
```

## A section on disk

What lands in the queue — frontmatter you can edit, the dump underneath:

```text
---
name: markets-grid
build: static
---
=== BUILD CONTRACT (webflow / client-first) ===
section "Markets"  1440x720  · section
    wf: Section<section> .section_markets   [new]
  text "title"  640x48  · element
      wf: Heading h2 .markets_title .heading-style-h2   [existing]
  frame "grid"  1280x520  · layout
      wf: DivBlock<ul> .markets_list   [new]
    instance "market-card"
        wf: REUSE component "market-card" — do not rebuild
```

`build: static` duplicates the markup per page; `build: component` creates the
component once and places an instance on each page that lists it.

## Screens worth capturing, when there is a page to put them on

None of these exist as assets yet.

- The Figma panel mid-capture, with the progress line counting layers
- The desktop app: queue pane with build order, terminal running the real agent
- A side-by-side of the Figma frame and the built staging page
- The validator refusing — a typo'd prop target, caught before anything is written
