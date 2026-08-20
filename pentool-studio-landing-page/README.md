# pentool-studio-landing-page

Everything needed to write and design a landing page for Pentool — and
deliberately **no page yet**. No HTML, no CSS, no copy decks, no wireframes. Just
the material a page would be built from, so that when one is built it is built
from facts rather than from memory.

| | |
| --- | --- |
| [brief.md](brief.md) | Positioning, the problem, what it does, who it is for, and the honest limits. The messaging source. |
| [claims.md](claims.md) | Every factual claim, and where in the code it is verified. Includes what **not** to claim. |
| [proof.md](proof.md) | Real generated output to show on the page, and what each line proves. |
| [open-questions.md](open-questions.md) | Decisions that change what the page is, not how it looks. Settle these first. |

## Before writing a line of copy

Read [claims.md](claims.md). The temptation on a page like this is to describe the
system as it will be once it has built a real site; it has not built one yet. The
"Do not claim" list exists to stop that happening by accident.

## The shortest true version

> Pentool turns a Figma design into a real Webflow build — with your design
> tokens, your Client-First classes, your existing components, and an
> accessibility audit — one section at a time, so you can check the work.

## Where the material comes from

The brief was written against the built system and moved here from
`pentool-studio-app/project.md`. The proof output is regenerated from the plugin's
own test harness, so it cannot drift from what the code actually emits:

```sh
cd ../pentool-studio-figma-plugin && DUMP=out.txt node test-e2e.js
```

Technical reference lives with each project — see the [root README](../README.md).
Current verification state is in [context/](../context/).
