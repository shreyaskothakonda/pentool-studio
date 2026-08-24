#!/usr/bin/env node
// The Webflow backup gate.
//
//   node bin/wf-backup.js status            exit 1 while this session has not answered
//   node bin/wf-backup.js confirm [note]    the user says a restore point exists
//   node bin/wf-backup.js skip [reason]     the user chose to go without one
//
// This records an answer. It cannot make a backup: Webflow has no backups
// endpoint, and a restore point is made by a human in the Designer.

const path = require('path');
const backup = require('../lib/backup');

const ROOT = path.join(__dirname, '..');
const [cmd, ...rest] = process.argv.slice(2);
const note = rest.join(' ').trim() || null;

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

try {
  if (cmd === 'status') {
    const s = backup.backupStatus(ROOT);
    if (!s.answered) {
      console.error('✗ ' + s.reason);
      console.error('  Ask for a Webflow restore point, then record the answer:');
      console.error('    node bin/wf-backup.js confirm      # they made one');
      console.error('    node bin/wf-backup.js skip         # they chose not to');
      process.exit(1);
    }
    if (s.answer === 'skipped') {
      console.log('skipped   ✗ no restore point — this session has no way back');
      if (s.note) console.log('          ' + s.note);
      process.exit(0);
    }
    console.log('confirmed ✓ a Webflow restore point exists for this session');
    if (s.at) console.log('          answered ' + s.at);
    process.exit(0);
  }

  if (cmd === 'confirm' || cmd === 'skip') {
    const r = backup.record(ROOT, cmd === 'confirm' ? 'confirmed' : 'skipped', note);
    console.log(r.answer === 'confirmed'
      ? 'recorded: a restore point exists for this session'
      : 'recorded: building without a restore point');
    process.exit(0);
  }

  fail(cmd ? 'unknown command: ' + cmd : 'usage: wf-backup status | confirm [note] | skip [reason]');
} catch (e) {
  fail(e.message);
}
