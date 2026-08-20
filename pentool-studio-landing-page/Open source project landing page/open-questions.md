# Open questions

Decisions that change what the page *is*, not how it looks. Worth settling before
any markup exists, because each one moves the copy.

## What is the page actually asking for

There is no signup, no download link, and no pricing. Until one exists the page
has no call to action, and that determines its whole shape.

Candidates: a waitlist, a "read the docs" link into the repo, a GitHub star, or a
demo video with no ask at all.

## Is this a product or a public build log

The honest state is: works end to end, never run against live Webflow. Two very
different pages follow from that.

- **Product page** — needs the live-build gap closed first, or it overclaims
- **Build-in-public page** — the gap becomes the story, and the limits section
  becomes an asset rather than a liability

The brief is written for the second and can be tightened into the first later.

## Who lands here

The brief says "people who build Webflow sites from Figma designs". Two distinct
readers hide inside that, and they need different first screens:

- **The Client-First agency dev** — cares that class names are not invented, that
  components get reused, that nothing publishes to production
- **The solo designer-builder** — cares that it works on a free Figma plan and
  uses the Claude subscription they already pay for

## How much does it lead with Claude Code

The app spawns the real `claude` CLI. That is a genuine differentiator — your MCP
servers, your permissions, your billing — but it narrows the audience to people
who already have a subscription and know what an MCP server is. Front and centre,
or a detail further down?

## Does the plugin stand alone

Pentool Studio is useful without any of the Webflow pipeline — it is a good Figma
reader on its own, and it works on a free plan. That might be the wider door, with
the pipeline as the deeper story behind it.

## macOS-only, said where

True of the desktop app only; the plugin and the pipeline run anywhere Node does.
Burying it reads as a bait-and-switch, leading with it undersells the parts that
are cross-platform.

## Assets that do not exist yet

No screenshots, no demo video, no real-Figma capture showing resolved tokens. The
token capture is the highest-value one — see the note in
[proof.md](proof.md#what-to-point-at-in-it).
