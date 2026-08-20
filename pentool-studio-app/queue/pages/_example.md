---
# Which Webflow page this builds into. Slug or page id.
page: /example
title: Example                 # only used when the page has to be created
create_if_missing: false

# Where on the page. anchor is a class or #dom-id.
anchor: main-wrapper
position: append

# THE ORDER OF THIS LIST IS THE BUILD ORDER.
sections:
  - example-section        # rename this file and the section folder to activate them            # plain name: use the section's own settings

  # Object form when this page needs to override something:
  # - name: cta-band
  #   position: prepend
  #   props:                   # per-instance values, build: component only
  #     Title: "Talk to us"
---

Notes for humans. Everything below the frontmatter is ignored by the runner.
