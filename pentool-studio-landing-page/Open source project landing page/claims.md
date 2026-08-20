# Claims, and where each one is verified

Checked 2026-08-19 against the code, not the READMEs. Anything a page asserts
should be traceable to a row here.

## Safe to state plainly

| Claim | Verified against |
| --- | --- |
| Runs on a free Figma plan | `manifest.json` — `editorType: ["figma"]`, Design mode. Dev Mode plugins are the ones gated |
| No build step, no dependencies (plugin) | Plain JS, no `package.json` in the plugin folder |
| No dependencies (pipeline) | `pentool-studio-app` has no `package.json`; Node built-ins only |
| Publishes to staging only | `_config.json` → `visual.publishToStaging`; `publishToWebflowSubdomain: true`, `customDomains: []` |
| Builds one section at a time, then stops | `.claude/skills/webflow-build/SKILL.md` |
| Validator refuses on a typo before touching Webflow | `node bin/wf-queue.js plan` exits non-zero on errors — 12 distinct rules |
| Computes WCAG contrast outright | `contrastRatio` / `luminance` in `code.js`, tested in `test.js` |
| Marks classes `[existing]` vs `[new]` | `PROFILE.known` lookup in `code.js` |
| Reuses built components instead of rebuilding | `PROFILE.built` → `REUSE component "…" — do not rebuild` |
| Every dimension in rem, hairlines in px | `unit()` in `code.js`, tested |
| Uses your own Claude subscription | The app spawns the real `claude` CLI in a pty |
| 254 tests across both projects | 81 plugin + 156 pipeline + 17 end-to-end |
| macOS | `package.json` build target is `mac` / arm64 only |

## True, but needs care in the wording

**"Configurable design system."** It is a `PROFILE` block at the top of
`code.js` that you edit — component inventory, class list, size scales. Real, but
it is a code edit, not a settings screen. Say "set in one code block", not
"configurable".

**"Knows your style guide."** It knows the class list you gave it. The shipped
`PROFILE` is the GCE Dev style guide specifically, and that project strips the
`margin-*` / `padding-*` / `spacer-*` utilities. Another site needs its own
inventory before `[existing]` means anything.

**"Checks its own work."** The visual check needs the plugin's preview-PNG option
switched on, and that is **off by default**. Without it there is no Figma
reference to compare against. If the page shows the comparison, it should not
imply it happens automatically.

**"Every session takes a snapshot."** The gate is real and hard — `webflow-build`
refuses to start while `wf-snapshot.js status` exits non-zero. But a snapshot is
not a backup; see the brief's limits section, which should stay on the page.

## Do not claim

- **Any live Webflow build.** Nothing in this repo has run against the Webflow API
  — no class creation, no asset upload, no element insertion. The path is written
  and validated, not exercised. Do not put a "sites built" or "sections shipped"
  number on the page.
- **Verified inside Figma.** The plugin is tested against a stubbed `figma` object
  and a synthetic node tree. That covers the traversal, not Figma's real variable
  resolution, mixed-run segmentation, or `exportAsync` on real vectors.
- **Cross-platform.** macOS arm64 only, and the packaged app needs ad-hoc signing
  plus a right-click → Open on first launch.
- **Interactions.** No API can create Webflow IX3. They are captured and logged as
  a manual to-do, and the page should say so rather than stay quiet.
