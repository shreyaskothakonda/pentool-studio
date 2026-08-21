# Verification record

Last run: **2026-08-22**, on Node v26.7.0 / npm 11.19.0, macOS arm64.

## What passes

| Check | Result |
| --- | --- |
| `pentool-studio-app` — `node test.js` | 301 passed, 0 failed |
| `pentool-studio-app/app` — `node test.js` | 38 passed, 0 failed |
| `pentool-studio-figma-plugin` — `node test.js` | 139 passed, 0 failed |
| `pentool-studio-figma-plugin` — `node test-e2e.js` | 26 passed, 0 failed |
| Live build status | a written `build-log.md` reads `building` in the row with its last line visible; backdated, it reads `stalled` within one tick |
| Capture with no page | the bridge warns and the app shows it — previously silent |
| A capture the app refuses | shown as an error in the app; previously dropped |
| 409 → **Replace** | second capture of a name offers Replace; the re-send keeps hand-written notes |
| **Build again** | `done` → `queued`, `_done/` moves back, log archived, component and asset ids kept |
| `node bin/wf-unbuild.js` | same, with the app closed; `--dry-run` changes nothing |
| Agent **Restart** | appears on a real agent exit, and recovers the TUI |
| `node bin/wf-queue.js plan` | 2 steps, 0 errors, 0 warnings |
| `node bin/wf-snapshot.js status` | exits 1 — correct, the gate is unsatisfied until a snapshot is taken |
| Bridge — health, auth, write, traversal guard | all correct |
| Plugin dump → bridge → queue → planner | round-trips intact, 12 classes and the asset parsed |
| Electron app launch | window renders the real queue, `window.pentool` exposed, xterm loaded, console clean |

The Electron app was verified over the remote debugging port rather than by
screenshot — this shell has no screen-recording permission. The renderer reported
`document.title === 'Pentool'`, the queue rendered (`/markets`, `markets.md`,
Build, Send, Terminal), and the only console output was Electron's dev-only CSP
warning, which it says will not appear once packaged.

## Fixed during this pass

**Text and icon fills were emitted as `background`.** `cfStyle` in the plugin's
`code.js` pushed `background:` for any solid fill, but a Figma TEXT node's fill is
its glyph colour and an inline SVG's fill is what `currentColor` resolves to. Every
text layer's CSS proposal therefore told the builder to paint a block behind the
copy. Now branches to `color:` for TEXT and inline-SVG nodes; boxes still get
`background:`. Guarded by four tests in `test.js`.

**The bridge wrote 0-byte assets silently.** A payload whose image carried no
`base64` field decoded to an empty buffer, got written, and was reported as
successfully saved — failing much later at the Webflow upload instead. Now throws.
Guarded in the app's `test.js`.

**`wf-queue.js` accepted any unknown subcommand and exited 0.** A typo fell through
to the plan summary and printed nothing, which reads as "nothing to build" rather
than "you misspelled it". Its sibling CLIs already rejected unknown commands; it
now matches them.

**Stale cross-links from an earlier rename.** `../webflow-pipeline` and
`../pentool-studio` pointed at directories that no longer exist, in both READMEs
and `plan.md`. The app README's H1 was still `# webflow-pipeline`.

## Added

`pentool-studio-figma-plugin/test-e2e.js` — drives `run()` over a synthetic Figma
document and asserts the dump comes out shaped like a real capture: layout,
typography, fills, strokes, inline SVG, the a11y audit, the preview export. The
existing `test.js` only covers pure helpers, so a break in the traversal itself
would not have been caught. The synthetic tree carries two deliberate
accessibility failures so the audit has something to report.

`DUMP=out.txt node test-e2e.js` writes the generated capture out to eyeball.

## Still untested, and why

**Anything that touches Webflow.** No build has been run against the live API — no
class creation, no asset upload, no element insertion. The planner validates and
the MCP tool names are checked at preflight, but the build path itself is
unexercised here. `_config.json` points at site `00000000…` ("GCE Dev").

**The plugin inside Figma.** Verified against a stubbed `figma` object and a
synthetic node tree, which covers the traversal but not Figma's real API
behaviour — variable resolution, `getStyledTextSegments` on mixed runs, component
property naming, `exportAsync` on real vectors. Import the manifest and capture a
real frame before trusting it.

**The packaged `.app`.** `app/dist/mac-arm64/Pentool.app` exists from an earlier
build but was not launched; only `npm start` from source was. Ad-hoc signing is
mandatory on Apple Silicon and `npm run build` handles it — an unsigned bundle is
killed instantly by macOS with no error.

**The snapshot gate end to end.** `status` and `list` behave correctly, but no
snapshot has ever been taken in this queue, so the satisfied path is unexercised.

## Known rough edges, not fixed

`node bin/pentool-bridge.js --help` starts the server rather than printing usage.
Harmless, but it means there is no way to discover the flags without reading the
source.
