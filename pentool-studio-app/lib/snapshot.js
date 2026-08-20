// Session gating and structural snapshots.
//
// IMPORTANT, and the reason this file is careful about naming: Webflow's Data
// API has **no backups endpoint**. Restore points are created automatically
// every 50th autosave and manually in the Designer, and nothing here can create
// or restore one.
//
// So this is a *snapshot*, not a backup:
//   · it records what the site looked like — pages, styles, components, trees
//   · it is diffable, so you can see exactly what a build changed
//   · it CANNOT restore anything
//
// The restorable artifact is Webflow's own restore point, which a human makes in
// the Designer. The snapshot skill asks for one and records whether it was
// confirmed. Calling this a backup would be a lie that costs someone a site.

const fs = require('fs');
const path = require('path');

const snapshotsDir = (root) => path.join(root, 'snapshots');
const sessionFile = (root) => path.join(root, 'queue', '_session.json');

const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-');

/* ─────────────────────────────── sessions ─────────────────────────────── */

/** Called when an agent session begins — Pentool does this on pty start. */
function startSession(root, meta) {
  const payload = Object.assign({
    startedAt: new Date().toISOString(),
    host: 'unknown'
  }, meta || {});
  fs.mkdirSync(path.dirname(sessionFile(root)), { recursive: true });
  fs.writeFileSync(sessionFile(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

function currentSession(root) {
  try { return JSON.parse(fs.readFileSync(sessionFile(root), 'utf8')); }
  catch (e) { return null; }
}

/* ────────────────────────────── snapshots ─────────────────────────────── */

function listSnapshots(root) {
  const dir = snapshotsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => !d.startsWith('.'))
    .map((d) => {
      const manifest = path.join(dir, d, 'manifest.json');
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch (e) { /* partial */ }
      return { id: d, dir: path.join(dir, d), meta };
    })
    .filter((s) => s.meta && s.meta.takenAt)
    .sort((a, b) => (a.meta.takenAt < b.meta.takenAt ? 1 : -1));
}

const newestSnapshot = (root) => listSnapshots(root)[0] || null;

/**
 * Does this session still owe a snapshot?
 * Returns { required, reason, newest, session }.
 *
 * With no session file recorded (CLI use outside Pentool) a snapshot from the
 * last 12 hours counts, so a plain terminal run is not blocked forever.
 */
function snapshotStatus(root, maxAgeHours) {
  const session = currentSession(root);
  const newest = newestSnapshot(root);

  if (!newest) {
    return { required: true, reason: 'no snapshot has ever been taken', newest: null, session };
  }
  if (session && session.startedAt) {
    const fresh = newest.meta.takenAt >= session.startedAt;
    return {
      required: !fresh,
      reason: fresh ? null : 'the newest snapshot predates this session',
      newest, session
    };
  }
  const ageH = (Date.now() - Date.parse(newest.meta.takenAt)) / 36e5;
  const limit = typeof maxAgeHours === 'number' ? maxAgeHours : 12;
  return {
    required: ageH > limit,
    reason: ageH > limit ? `the newest snapshot is ${Math.round(ageH)}h old` : null,
    newest, session
  };
}

/** Create the directory for a new snapshot and return where to write into it. */
function beginSnapshot(root, siteId) {
  const id = stampNow();
  const dir = path.join(snapshotsDir(root), id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir, siteId: siteId || null };
}

/**
 * Seal a snapshot. `restorePointConfirmed` records whether a human said they
 * made a Webflow restore point — the only thing that can actually restore.
 */
function finishSnapshot(root, snap, info) {
  const meta = {
    id: snap.id,
    takenAt: new Date().toISOString(),
    siteId: snap.siteId,
    captured: (info && info.captured) || {},
    restorePointConfirmed: !!(info && info.restorePointConfirmed),
    notes: (info && info.notes) || null,
    warning: 'Structural snapshot only. This CANNOT restore the site — ' +
             'Webflow has no restore API. Use a Designer restore point for recovery.'
  };
  fs.writeFileSync(path.join(snap.dir, 'manifest.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

/** Write one captured artifact into a snapshot. */
function writeArtifact(snap, name, data) {
  const file = path.join(snap.dir, name.replace(/[^\w.\-]/g, '_'));
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(file, body);
  return path.basename(file);
}

module.exports = {
  startSession, currentSession,
  listSnapshots, newestSnapshot, snapshotStatus,
  beginSnapshot, finishSnapshot, writeArtifact,
  snapshotsDir, sessionFile
};
