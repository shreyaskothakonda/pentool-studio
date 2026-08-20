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
