# Pentool — messaging brief

The positioning source for the landing page: what Pentool is, who it is for, and
what it will not claim. Everything here is true of the built system, not
aspirational; the limits section is as load-bearing as the features.

Every factual claim below is checked in [claims.md](claims.md). Real output to
show on the page is in [proof.md](proof.md).

---

## One line

Pentool turns a Figma design into a real Webflow build — with your design tokens,
your Client-First classes, your existing components, and an accessibility audit —
one section at a time, so you can check the work.

## The problem it solves

Handing a Figma file to a developer, or to an AI, loses almost everything that
made it a design.

A screenshot loses the tokens. A code export loses the component structure. Figma's
own MCP server hit a Starter-plan tool-call ceiling mid-project and stopped
working. And the usual AI answer — paste a screenshot and hope — produces
hardcoded hex values, invented class names, and markup that ignores the design
system the site is actually built on.

Meanwhile the knowledge that makes a rebuild correct lives nowhere durable: which
components already exist, which classes are in the style guide, that `set_text`
silently does nothing on a DivBlock. It lives in the head of whoever built the
site last, and it gets rediscovered every time.

## What it actually does

**Reads the design properly.** Not pixels — structure. Design tokens bound to
spacing, padding, radius and colour. Component properties. Mixed-run typography.
Prototype wiring. Auto-layout, including what Figma *infers* for hand-positioned
frames.

**Speaks your design system.** Output arrives as Client-First class proposals
mapped against your actual style guide, marked `[existing]` when the class is
already there and `[new]` when it needs creating, with the CSS to create it. Every
dimension in rem, hairlines in px.

**Knows what not to rebuild.** Components you have already built come through as
`REUSE component "market-card" — do not rebuild`, so an agent places an instance
instead of duplicating the markup.

**Audits accessibility while it works.** It holds the text colour and the
background at the same time, so it computes WCAG contrast outright rather than
flagging it for a human. Plus missing alt text, icon-only buttons with no
accessible name, tap targets under 44×44, and skipped heading levels.

**Builds one section at a time.** Then it stops and waits. Webflow has no undo
API, so a wrong class costs one section, not a whole page.

**Checks its own work against the design.** After building, it publishes to
staging, screenshots the live page, and compares it with the Figma export.

---

## The three pieces

### Pentool Studio — the Figma plugin

A local plugin. No build step, no dependencies, no server. It runs in Design mode,
which is why it works on a free Figma plan when Dev Mode does not.

Select a frame, press **Capture**, and it walks the tree resolving variables to
their token names, reading component props, segmenting mixed text, deduplicating
icons and computing contrast as it goes.

### The pipeline — a queue you can read

Sections land in a folder. A page manifest lists them in build order. Each section
declares how it should be built: static markup, or a component with typed props,
optionally bound to a CMS collection.

Before anything touches Webflow, a validator resolves the whole queue and refuses
to proceed on a typo — a prop pointing at a class that is not in the design, a
section on no page, a duplicate page slug. Catching that costs nothing. Catching it
mid-build means half a page is already written.

### Pentool — the desktop app

The bridge, the queue and Claude Code in one window.

One click in Figma writes the design and its screenshots straight into the queue.
The queue pane shows build order with drag-to-reorder. Progress is read from the
files the pipeline writes as it goes — never scraped from agent output, so the
dashboard cannot drift. And the agent is the real `claude` CLI in a terminal, using
your own subscription, your own MCP servers and your own permission prompts.

---

## Things worth saying out loud

**It uses your Claude subscription.** Not an API key, not separate billing. The app
spawns the CLI you already have, which means your Webflow connection, your skills
and your settings come with it.

**Nothing is published without you.** The visual check publishes to the
`.webflow.io` staging subdomain only. Going live is never automated.

**Every session takes a snapshot first.** A structural record of pages, styles,
components and element trees, so you can diff exactly what a build changed.

**It refuses rather than guesses.** A missing MCP tool, an unresolvable class, a
page that does not exist — each is a stop with a reason, not a best effort.

---

## Honest limits

Worth putting on the page. They build more trust than they cost.

**A snapshot is not a backup.** Webflow's API has no backups endpoint, so nothing
here can restore a site. The snapshot is a diffable record; the recoverable backup
is Webflow's own restore point, which you create in the Designer. Pentool asks for
one and records whether you confirmed it.

**Interactions cannot be automated.** Pentool Studio captures your prototype
wiring, but neither Webflow's MCP nor its Data or Designer API can create IX3
interactions. Hover and click states are logged as a manual to-do.

**One agent per project.** Projects run in parallel safely. Two agents on one site
would race on class creation and element insertion, which Webflow has neither
transactions nor undo for.

**It cannot write your alt text.** It knows an image needs one; it does not know
what the image means.

**Class names are proposals.** Derived from your Figma layer names, and marked
`[name inferred]` when the layer was called `Frame 7` and the name had to come from
structure instead.

---

## How it feels to use

```
Figma            select a section, press Capture
   ↓
Pentool          it appears in the queue, validated, in build order
   ↓
Build            one section, then it stops
   ↓
Check            screenshot against the design, differences listed
   ↓
Continue         next section
```

---

## Who it is for

People who build Webflow sites from Figma designs and are tired of doing it twice.
Particularly anyone on Client-First with a real style guide, where the cost of an
AI inventing its own class names is higher than the cost of building by hand.

## Positioning

Not a design-to-code exporter. Those produce a pile of markup you then have to
reconcile with your design system.

Pentool works the other way round: it starts from the system you already have —
your classes, your components, your tokens — and expresses the design in those
terms. The output is not a new site. It is instructions for extending yours.

---

## Facts for the page

| | |
| --- | --- |
| Figma plan required | Free — runs in Design mode |
| Design system | Client-First v2.1 / Relume v3.0 — set in a code block, not a UI |
| Build target | Webflow, via the official MCP |
| AI | Your existing Claude subscription |
| Publishing | Staging subdomain only, never production |
| Platform | macOS |
| Dependencies | Plugin and pipeline: none. App: Electron |
| Tests | 254 across both projects |

## Names

- **Pentool Studio** — the Figma plugin
- **Pentool** — the desktop app
- `pentool.studio` — the domain
