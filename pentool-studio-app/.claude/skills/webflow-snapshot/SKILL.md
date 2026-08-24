---
name: webflow-snapshot
description: Record a structural snapshot of the Webflow site — pages, styles, components and element trees — so a later change can be diffed against it. Use only when the user explicitly asks for a snapshot. It is not a backup and cannot restore anything; for that, use webflow-backup.
---

# Webflow snapshot

Records what the site looks like **now**, so a build's effects can be diffed
afterwards. It cannot undo them — see `/webflow-backup` for the only thing that
can.

## Read this before claiming anything is backed up

**Webflow's Data API has no backups endpoint.** Restore points are created
automatically every 50th autosave and manually in the Designer. Nothing here can
create or restore one.

So this skill produces two different things, and they are not interchangeable:

| | What it is | Can it restore? |
| --- | --- | --- |
| **The snapshot** (this skill) | JSON record of pages, styles, components, trees | **No.** Diff and reference only |
| **A Webflow restore point** (you, in the Designer) | Webflow's own backup | **Yes** |

Never describe the snapshot as a backup. If someone loses work believing this
skill protected them, that is the failure.

## 2. Capture

Read `siteId` and the MCP namespace from `queue/_config.json` (see the
`webflow-build` skill for how the namespace works).

```js
const snap = require('./lib/snapshot');
const s = snap.beginSnapshot(ROOT, siteId);   // creates snapshots/<timestamp>/
```

Capture each of these and write it with `snap.writeArtifact(s, name, data)`:

| Artifact | Source |
| --- | --- |
| `pages.json` | `data_pages_tool > list_pages` |
| `styles.json` | `data_style_tool > get_styles` with `include_properties: true` |
| `components.json` | `data_component_tool > get_all_components` with props and variants |
| `page-<slug>.json` | `data_element_tool > get_all_elements` per page, `depth: -1` |
| `variables.json` | `data_variable_tool` — collections and their modes |
| `collections.json` | `data_cms_tool > get_collection_list` (schemas, not items) |

Only the pages a queued section targets need their element tree captured — a full
site can be large. Capture every page when the user asks for a full snapshot.

Then seal it:

```js
snap.finishSnapshot(ROOT, s, {
  captured: { pages: 12, styles: 340, components: 18 },
  notes: 'pre-build for /markets'
});
```

## 3. Report

State what was captured and where it is. Say what it is for — comparing later —
and do not let it be mistaken for a way back:

```text
snapshot  snapshots/2026-08-19T21-14-02-113Z/
captured  12 pages · 340 styles · 18 components · 2 element trees
note      a record to diff against, not a backup — only a Webflow
          restore point can undo a build
```

Whether a restore point exists is `/webflow-backup`'s question, not this one's.

## Diffing later

To show what a build changed, compare the newest snapshot's artifacts against a
fresh capture. `styles.json` and the per-page element trees are the useful ones:
a diff there is exactly the set of classes created and elements inserted.
