---
name: webflow-snapshot
description: Record a structural snapshot of the Webflow site before any build, and prompt for a Designer restore point. Use at the start of every session, or when the user asks to snapshot, back up, or record the current state of the site before making changes.
---

# Webflow snapshot

Records what the site looks like **now**, so a build's effects are diffable and a mistake is recoverable.

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

## 1. Ask for the restore point first

Before capturing anything, tell the user plainly:

> Before I build, create a restore point in Webflow: open the Designer →
> Settings → Backups → **Create backup**. That is the only thing that can undo a
> bad build. Say **done** when it exists, or **skip** to proceed without one.

Record their answer — it goes into the manifest as `restorePointConfirmed`. If
they skip, capture the snapshot anyway and say clearly in the summary that there
is no recoverable backup for this session.

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
  restorePointConfirmed: true,     // whatever the user actually said
  notes: 'pre-build for /markets'
});
```

## 3. Report

State what was captured, where it is, and — unambiguously — whether a
restorable backup exists:

```text
snapshot  snapshots/2026-08-19T21-14-02-113Z/
captured  12 pages · 340 styles · 18 components · 2 element trees
restore   ✓ Webflow restore point confirmed by the user
          (or)
restore   ✗ NO restore point — this session has no way back
```

## Diffing later

To show what a build changed, compare the newest snapshot's artifacts against a
fresh capture. `styles.json` and the per-page element trees are the useful ones:
a diff there is exactly the set of classes created and elements inserted.
