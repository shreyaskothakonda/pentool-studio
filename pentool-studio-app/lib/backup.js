/* The only thing standing between a bad build and lost work.

   Webflow has no undo API and no backups endpoint. Nothing in this project can
   create or restore a backup — a restore point is made by a human in the
   Designer, and that is the only artifact that can put the site back.

   So this does not take a backup. It records whether you said you had one, for
   this session, and lets the build refuse to start until you have answered. The
   snapshot system it replaces gated on a JSON file that cannot restore anything,
   which meant the gate was satisfied by something that could not save you.

   Answering "skipped" is allowed and is not nagged about again. Being unable to
   proceed is not the goal; drifting past the question without noticing is what
   this exists to stop. */

const fs = require('fs');
const path = require('path');

const ANSWERS = ['confirmed', 'skipped'];
const sessionFile = (root) => path.join(root, 'queue', '_session.json');

function readSession(root) {
  const file = sessionFile(root);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(raw); }
  catch (e) {
    // Never silently reset it. An unreadable session file must not read as
    // "answered" — that is the one failure mode this whole file exists to avoid.
    throw new Error('queue/_session.json is not valid JSON — fix or delete it: ' + e.message);
  }
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/* A session begins when a project is opened, not when the agent starts. Tying it
   to the agent meant every crash recovery re-asked a question you had already
   answered two minutes earlier, which is how a safety prompt turns into noise
   people click through. */
function startSession(root, meta) {
  const payload = Object.assign({
    startedAt: new Date().toISOString(),
    host: 'unknown'
  }, meta || {});
  fs.mkdirSync(path.dirname(sessionFile(root)), { recursive: true });
  writeAtomic(sessionFile(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

/* Has this session answered? Shapes:
     { answered: false, reason }                      — ask
     { answered: true, answer: 'confirmed', at }      — go
     { answered: true, answer: 'skipped', at, note }  — go, but say so */
function backupStatus(root) {
  const s = readSession(root);
  if (!s) return { answered: false, reason: 'no session has started yet' };

  const b = s.backup;
  if (!b || ANSWERS.indexOf(b.answer) === -1) {
    return { answered: false, reason: 'this session has not confirmed a Webflow backup', startedAt: s.startedAt };
  }
  return {
    answered: true, answer: b.answer, at: b.at || null, note: b.note || null,
    startedAt: s.startedAt
  };
}

// Record what the user actually said. Never inferred, never defaulted.
function record(root, answer, note) {
  if (ANSWERS.indexOf(answer) === -1) {
    throw new Error(`answer must be one of ${ANSWERS.join(', ')} — got ${JSON.stringify(answer)}`);
  }
  const s = readSession(root);
  if (!s) throw new Error('no session has started — open the project in Pentool first');

  s.backup = { answer: answer, at: new Date().toISOString() };
  if (note) s.backup.note = String(note);
  writeAtomic(sessionFile(root), JSON.stringify(s, null, 2) + '\n');
  return s.backup;
}

module.exports = { startSession, backupStatus, record, ANSWERS };
