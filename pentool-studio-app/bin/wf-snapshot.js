#!/usr/bin/env node
// Snapshot gate and inspection.
//
//   node bin/wf-snapshot.js status     exit 1 when this session still owes one
//   node bin/wf-snapshot.js list
//   node bin/wf-snapshot.js session    start a session (Pentool does this)

const path = require('path');
const snap = require('../lib/snapshot');

const ROOT = path.join(__dirname, '..');
const [cmd] = process.argv.slice(2);

if (cmd === 'list') {
  const all = snap.listSnapshots(ROOT);
  if (!all.length) { console.log('(no snapshots)'); process.exit(0); }
  for (const s of all) {
    const c = s.meta.captured || {};
    const bits = Object.keys(c).map((k) => c[k] + ' ' + k).join(' · ');
    console.log(`${s.meta.takenAt}  ${s.id}`);
    console.log(`  ${bits || 'nothing recorded'}`);
    console.log(`  restore point: ${s.meta.restorePointConfirmed ? '✓ confirmed' : '✗ none'}`);
  }
  process.exit(0);
}

if (cmd === 'session') {
  const s = snap.startSession(ROOT, { host: 'cli' });
  console.log('session started ' + s.startedAt);
  process.exit(0);
}

const st = snap.snapshotStatus(ROOT);
if (st.required) {
  console.log('✗ snapshot required — ' + st.reason);
  console.log('  run /webflow-snapshot before building.');
  process.exit(1);
}
console.log('✓ snapshot ' + st.newest.id);
console.log('  taken ' + st.newest.meta.takenAt);
console.log('  restore point: ' +
  (st.newest.meta.restorePointConfirmed
    ? '✓ confirmed'
    : '✗ none — diffable record only, nothing can restore'));
process.exit(0);
