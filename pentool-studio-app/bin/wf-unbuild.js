#!/usr/bin/env node
// Put a finished section back in the queue so it can be built again.
//
//   node bin/wf-unbuild.js <section>            forget it on every page
//   node bin/wf-unbuild.js <section> <page>     forget it on one page
//   node bin/wf-unbuild.js <section> --dry-run  say what would change
//
// This is not an undo. Webflow has no undo API: everything the build already
// wrote to the live site is still there, and removing it is a manual job in the
// Designer. All this changes is what Pentool believes.

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dry = process.argv.slice(2).indexOf('--dry-run') !== -1;
const [section, page] = args;

if (!section) {
  console.error('usage: wf-unbuild <section> [page] [--dry-run]');
  process.exit(1);
}

if (dry) {
  // Read-only: resolve and report, touch nothing.
  const { resolve } = require('../lib/queue');
  let r;
  try { r = resolve(ROOT); } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
  const sec = r.sections.get(section);
  if (!sec) { console.error(`✗ no section named "${section}" in this queue`); process.exit(1); }

  let state = { built: {} };
  try { state = JSON.parse(fs.readFileSync(path.join(ROOT, 'queue', '_state.json'), 'utf8')); } catch (e) { /* none yet */ }
  const pages = Object.keys(state.built || {})
    .filter((pg) => (!page || pg === page) && (state.built[pg] || []).indexOf(section) !== -1);

  console.log(`would forget ${section} on: ${pages.length ? pages.join(', ') : '(no page — nothing recorded)'}`);
  if (fs.existsSync(path.join(ROOT, 'queue', '_done', section))) {
    console.log(fs.existsSync(path.join(ROOT, 'queue', 'sections', section))
      ? 'would move the finished copy to queue/_trash/ — a newer capture already exists'
      : 'would move it from queue/_done/ back to queue/sections/');
  }
  process.exit(0);
}

let r;
try {
  r = require('../lib/unbuild').unbuild(ROOT, section, page);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}

console.log(`${r.section} is queued again.`);
if (r.pages.length) console.log(`  forgotten on : ${r.pages.join(', ')}`);
else console.log('  nothing recorded it as built — only the files moved');
if (r.movedBack)   console.log('  moved back   : queue/_done/ → queue/sections/');
if (r.trashed)     console.log(`  trashed      : ${r.trashed}  (a newer capture already existed)`);
if (r.logArchived) console.log(`  build log    : ${r.logArchived}`);

console.log('');
console.log('Webflow has no undo. What this section already wrote to the site is');
console.log('still there — delete it in the Designer before building again, or you');
console.log(r.build === 'component'
  ? 'will get a second instance on the page.'
  : 'will get a second copy of the markup.');
