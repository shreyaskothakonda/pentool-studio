---
name: webflow-build
description: Build queued Pentool Studio sections into Webflow pages, one at a time. Use when the user asks to build the queue, build a page, process queued sections, or run the Webflow pipeline. Reads queue/pages and queue/sections, then creates classes, uploads assets, and builds elements via the Webflow MCP.
---

# Webflow build

Builds sections from `queue/` into a Webflow site, in the order the page
manifests declare, **stopping after each section** so mistakes are caught after
one item rather than ten.

Webflow has **no undo API**. Everything below is check-before-create, and nothing
is written until the plan has been printed.

## Invocation

- `/webflow-build` — every page
- `/webflow-build markets` — one page, by slug or manifest filename

## 0. Which MCP server

Tool names below are written unprefixed — `data_element_builder`, `data_style_tool`
and so on. The actual namespace comes from `queue/_config.json`:

```json
{ "mcp": "webflow" }        // or "webflow-beta"
```

Read that key and use the matching server for every call. **Never hardcode a
namespace**, and never mix the two within one run.

Webflow renames tools between MCP versions and publishes a migration guide for
exactly that reason, so **verify before building**. Confirm each of these exists
on the configured server:

```text
data_sites_tool          data_pages_tool         data_element_tool
data_element_builder     data_style_tool         data_variable_tool
data_component_tool      data_component_builder  data_agent_instructions_tool
```

Plus, only when the queue needs them: `data_assets_tool` (assets),
`data_component_props_tool` (props), `data_cms_tool` (cms).

If any is missing, **stop and name it**. A rename must be a loud failure, not a
half-built page. Check Webflow's skill-migration guide for the current name and
update this file.

## 1. Preflight — once per session

**Snapshot gate, before anything else.** No build starts without a snapshot for
this session:

```bash
node bin/wf-snapshot.js status     # exit 1 means a snapshot is required
```

If it exits non-zero, **stop and run `/webflow-snapshot`**, then come back.
Webflow has no undo API, so the record of what the site looked like beforehand is
the only way to see — or reverse by hand — what a bad build did.

If the snapshot exists but `restorePointConfirmed` is false, say so before
building: there is a diffable record but **nothing that can actually restore**.

```bash
node bin/wf-queue.js plan          # resolved order + validation; exit 1 on error
node bin/wf-state.js get           # what previous runs already built
```

**If `wf-queue.js` exits non-zero, stop and report.** A validation error means a
manifest is wrong, and building from a wrong manifest writes the wrong thing to a
live site.

Then, with `siteId` from `_config.json`:

- `data_sites_tool > get_site` — confirm the site matches `siteName`.
- `data_agent_instructions_tool > search_instructions` — site rules. Read the
  relevant ones; they override guidance here.
- `data_pages_tool > list_pages` — resolve slugs to page ids.
- `data_style_tool > get_styles` — the existing class inventory. **Record it**, so
  the plugin can mark a class `[existing]` rather than `[new]` on the next
  capture instead of guessing from the defaults it shipped with:

  ```bash
  node bin/wf-styleguide.js set --known-file <the get_styles result as json>
  node bin/wf-styleguide.js set --built <components already built, comma separated>
  ```

  Until this runs, every capture assumes a Client-First style guide that may not
  be this site's.
- `data_cms_tool > get_collection_list` — only if some section declares `cms`.

Print the resolved build order and what preflight found before writing anything.

## 2. Per section — the next unbuilt step only

Skip any step where `node bin/wf-state.js is-built <page> <section>` exits 0.

### 2.0 Read the notes

If `section.md` has a `## Notes` block between the frontmatter and the dump, that
is the designer writing to you directly — a variant to use, copy to keep,
something the Figma file cannot say on its own. **Read it before deciding
anything**, and say in `build-log.md` how you acted on it. It outranks your own
reading of the dump where the two disagree.

### 2.1 Open the log, then resolve the target

**First act on any section, before anything else:** create
`queue/sections/<name>/build-log.md` with a single line, `started <ISO time>`.

It exists from this moment so that a crash at any later point still leaves a
record of how far you got. It is also how Pentool knows this section is being
worked on — a section with an open log reads `building` in the queue, and one
whose log has not changed in ten minutes reads `stalled`. Nothing else tells it.

Then find the page id from `list_pages`. If it is missing and `create_if_missing` is
false, **stop** — do not invent a page. If true, `data_pages_tool > create_page`
with `title` and the slug.

Find the anchor with `data_element_tool > query_elements`, filtering on the
`anchor` class or dom id. If it is missing, stop and say so.

### 2.2 Assets

For each file in the section's `assets/`:

```bash
HASH=$(node bin/wf-asset.js hash <file>)
node bin/wf-state.js asset "$HASH"      # exit 0 prints an existing id — reuse it
```

Otherwise `data_assets_tool > create_asset` with `site_id`, `file_name`, `file_hash`,
then:

```bash
node bin/wf-asset.js upload <file> "<uploadUrl>" '<uploadDetails json>'
node bin/wf-state.js set-asset "$HASH" "<assetId>" "<file_name>"
```

Files whose name starts with `_preview` are human reference — do not upload them.

### 2.3 Classes — before any element is created

`set_style` only accepts classes that **already exist**, so every class in the dump
must exist first.

Collect class names from the dump's `wf:` lines. For each one absent from the
preflight inventory, `data_style_tool > create_style`:

- `name` — the class.
- `parent_style_names` — **an array**. A class beginning `is-` is a combo of the
  class immediately before it on the same `wf:` line, so `.button .is-secondary`
  creates `is-secondary` with `parent_style_names: ["button"]`.
- `properties` — from the CSS block Pentool Studio prints under each `[new]`, one entry per
  declaration using longhand names.
- Where a declaration carries a token comment (`gap: 3.75rem  /* space/xl */`),
  look the variable up with `data_variable_tool` and pass `variable_as_value` with
  its id instead of `property_value`. Only fall back to the literal if no variable
  of that name exists — binding the real variable is the entire point of Pentool Studio.

Classes marked `[existing]` are never created or modified.

### 2.4 Build

**`build: static`** — one `data_element_builder` call carrying the whole nested
tree, with `parent_element_id` set to the anchor and `creation_position` from the
step.

**`build: component`** —

1. `data_component_tool > get_component` by name. If absent,
   `create_blank_component` with `name` and `group`, and record the id with
   `node bin/wf-state.js set-component <name> <id>`.
2. Build the tree **once** with `data_element_builder` and
   `scope_component_id: <componentId>`.
3. For each entry in `props`, `data_component_props_tool > create_prop`, then bind
   the target element's setting to the prop id via the element's `settings[]` with
   `binding: { source_type: "prop", prop_id }`. `binds: visibility` binds the
   `visibility` key; otherwise bind the element's text or image key.
4. `data_component_builder > insert_in_element` to place the instance on the page.
5. If the page entry has `props` overrides,
   `data_component_props_tool > set_component_instance_prop_values`.

On a second page, steps 1–3 are already done: only insert and set values.

### 2.5 CMS

When the section declares `cms`, create the `element` as type `CMSCollection`
bound to the collection id, and give each `bind` entry's element a `settings[]`
binding of `{ source_type: "cms", collection_id, field_id }`. Field ids come from
`data_cms_tool > get_collection_details`.

This binds to collections that already exist. Do not create collections or items.

### 2.6 Reuse

Every `REUSE component "X"` line is an existing component. Place it with
`data_component_builder > insert_in_element` at the right parent. **Never rebuild
its markup** — that is the whole reason Pentool Studio emits the line.

### 2.7 Verify — structure

`data_element_tool > get_all_elements` over the new subtree and compare against the
dump: element count, applied classes, text content, bindings. Report differences
plainly. Do not claim success without having looked.

### 2.8 Verify — visual, against the Figma design

Only when `config.visual.enabled`. This is the check that catches what a structural
diff cannot: wrong spacing, wrong stacking, a section that built cleanly and still
looks nothing like the design.

1. **Publish to staging.** Changes are not visible on the `.webflow.io` domain
   until published:

   ```
   data_sites_tool > publish_site
     site_id: <siteId>
     publishToWebflowSubdomain: true
     customDomains: []            ← MUST stay empty
   ```

   **`customDomains` must be empty.** Passing a production domain publishes the
   live site, which this pipeline never does without being asked.

2. **Match the Figma frame width**, from `config.visual.viewport`:
   `mcp__chrome-devtools__resize_page` → `{ width: 1440, height: 900 }`.

3. **Navigate** to `config.visual.baseUrl` + the page slug with
   `mcp__chrome-devtools__navigate_page`.

4. **Full-page screenshot** into the section folder:

   ```
   mcp__chrome-devtools__take_screenshot
     fullPage: true
     filePath: queue/sections/<name>/built.png
   ```

5. **Compare against the Figma reference.** Pentool Studio writes its preview screenshot to
   `queue/sections/<name>/assets/_preview-*.png`. Read both images and compare:
   section order, spacing rhythm, type scale, colour, image placement, and whether
   anything is missing or doubled.

   If there is no `_preview-*.png`, say so rather than skipping silently — the
   **preview PNG** option in the plugin is off by default and has to be switched on for
   this check to have anything to compare against.

6. **Report differences in words**, ranked by how much they matter. Do not fix
   them silently. A pixel-perfect match is not the bar; "is this recognisably the
   design" is.

Also useful here, from the same MCP: `list_console_messages` for JS errors the
build introduced, and `mcp__chrome-devtools__take_snapshot` if you need the
rendered DOM to explain a difference.

### 2.9 Record and stop

```bash
node bin/wf-state.js mark-built "<page>" "<section>"
```

Keep writing `build-log.md` **as you go**, not at the end — assets uploaded,
classes created, element ids, verification result. A crash must still leave an
accurate record.

The format is load-bearing, so it is fixed:

```
started 2026-08-22T10:04:11Z
uploaded hero.png → asset 65f…
created .section_markets
inserted Section into .main-wrapper → element 12a…
done 2026-08-22T10:09:40Z
```

One line per thing that actually happened, in the order it happened. **The last
line is shown live in Pentool while the section builds**, so write it as a
statement of what is happening now — "uploading hero.png", "creating
.markets_list" — never as a heading or a blank separator.

The final line must be `done <ISO time>`. That word is what marks the section
finished; without it Pentool goes on reporting the section as building, and then
as stalled.

Move fully built sections to `queue/_done/<section>/`, but only when every page
that references them is done.

Then **stop**. Report what was built and wait for the go-ahead.

## Element mapping

| Pentool Studio `wf:` line | Webflow |
| --- | --- |
| `Section<section> .section_x` | `Section` |
| `DivBlock .x_component` | `DivBlock` |
| `DivBlock<ul> .x_list role="list"` | `BY_CUSTOM_TAG`, `custom_tag: ul`, `set_attributes` |
| `Heading h3 .heading-style-h5` | `Heading` + `set_heading_level: 3` |
| `Paragraph .x_text` | `Paragraph` + `set_text` |
| `Text .x_label` | `TextBlock` + `set_text` |
| `Link .x_component` | `LinkBlock` (+ `set_link`) |
| `Image .x_image` | `Image` + `set_image_asset` + alt |
| `HtmlEmbed .icon-embed-medium` | `HtmlEmbed` carrying the matching `SVG SOURCES` entry |
| `REUSE component "pricing-card"` | `data_component_builder` |

**Never put text on a DivBlock.** `set_text` is only valid on text-capable
elements; on a DivBlock it silently no-ops. Use `TextBlock` or `Paragraph`.

Pentool Studio's units are already correct — rem above 1px, px for hairlines. Pass them
through unchanged.

## Interactions are a manual step

Pentool Studio emits `reactions: ON_HOVER -> CHANGE_TO` for prototype wiring, and **nothing
can build those automatically**. Webflow's MCP cannot create Interactions (IX3),
and neither can the Data or Designer API — it is a platform gap, not a tooling one.

When a dump contains `reactions:` lines, list them in `build-log.md` under
**"manual: interactions"** with the element and the trigger, so the hover and click
states are a known to-do rather than a silent omission.

## When something fails

Stop immediately. Do not continue to the next section.

- Leave the section in `queue/`; never mark it built.
- **Leave `build-log.md` without its `done` line.** That absence is the signal:
  the section shows as building, then stalled, which is how a human finds the
  one that needs them. Writing `done` on a failed section hides it.
- Report what was already written to Webflow, from `build-log.md`.
- Say what a retry will skip and what it will redo.
- Never retry a partially built section from zero — that duplicates elements.

## Never

- Build without a snapshot for this session.
- Describe a snapshot as a backup. It cannot restore anything.
- Build a section that `wf-queue.js` flagged as an error.
- Build when a required MCP tool is missing — stop and name it.
- Hardcode an MCP namespace instead of reading `config.mcp`.
- Create a page that `create_if_missing` did not authorise.
- **Publish to a production domain.** `publish_site` is used only for visual
  verification, only with `publishToWebflowSubdomain: true` and an empty
  `customDomains`. Publishing live is always the human's call.
- Create or delete CMS collections or items.
- Modify a class marked `[existing]`.
- Report success without running both verify steps.
- Claim a visual match without having looked at both images.
