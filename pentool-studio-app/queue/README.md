# Authoring the queue

## A page — `queue/pages/<name>.md`

Owns **which sections and in what order**.

```yaml
---
page: /markets              # slug or page id
title: Markets              # only used if the page must be created
create_if_missing: false
anchor: main-wrapper        # class or #dom-id to build into
position: append            # append | prepend | before | after
sections:
  - markets-hero            # order here is the build order
  - name: markets-grid      # object form to override for this page
    position: prepend
    props:
      Title: "Markets we serve"
---
```

## A section — `queue/sections/<name>/section.md`

Owns **what it is and how it is built**. `name` must match the folder.

```yaml
---
name: markets-grid
build: static               # static | component
group: GCE                  # component group, when build: component

props:                      # component only
  - name: Title
    type: textContent       # textContent string richText image link video number boolean id altText
    target: markets-grid_title    # a class that appears in the dump
  - name: Show badge
    type: boolean
    target: markets-grid_badge
    binds: visibility

cms:                        # bind to an existing collection
  collection: Markets
  element: markets-grid_list
  limit: 12
  bind:
    markets-card_title: name
    markets-card_text: summary
---

=== BUILD CONTRACT (webflow / client-first) ===
...the plugin dump, verbatim...
```

Images go in `assets/`. Anything named `_preview*` is treated as human reference
and is not uploaded.

## Rules worth knowing

- Set Pentool Studio's target to **Webflow · Client-First**. A Raw Figma dump has no `wf:`
  lines and the planner will warn.
- `props.target` and `cms.bind` keys must name classes that appear in the dump.
  The planner checks this.
- Listing a `static` section on three pages duplicates its markup three times.
  Listing a `component` section on three pages creates one component and three
  instances.
- `_config.json` supplies the defaults for `anchor`, `position`, and `group`.

Run `node bin/wf-queue.js plan` after editing. It is free and it is the cheapest
place to find a mistake.
