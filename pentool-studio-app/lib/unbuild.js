/* Putting a finished section back in the queue.

   Recovery used to be undocumented file surgery: move the folder out of
   queue/_done/ by hand, then edit queue/_state.json to delete the section from
   built[<page>]. Nothing in the app or the CLI did it, so a section that built
   wrong was a dead end unless you knew the layout.

   What this is NOT, and the caller must say so: an undo. Webflow has no undo
   API. This changes what Pentool believes about a section; everything the build
   already wrote to the live site is still there, and removing it is a manual job
   in the Designer. A function that quietly implied otherwise would be worse than
   no function at all. */

const fs = require('fs');
const path = require('path');

// Temp-then-rename. _state.json is the record of everything ever built, and a
// crash mid-write would leave it truncated — bin/wf-state.js writes it in place,
// which is a bad day waiting to happen.
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readState(file) {
  if (!fs.existsSync(file)) return { components: {}, assets: {}, built: {} };
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  // Throw rather than resetting: a _state.json we cannot read holds the only
  // record of what exists in Webflow, and overwriting it would strand every
  // component and asset id, so the next build would duplicate all of them.
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('queue/_state.json is not valid JSON — fix it before unbuilding: ' + e.message); }
  return Object.assign({ components: {}, assets: {}, built: {} }, parsed);
}

/* Forget that `section` was built — on `page`, or everywhere if `page` is
   omitted. Returns a report of what actually changed, so the caller can tell the
   user rather than guess. */
function unbuild(root, section, page) {
  const name = String(section || '').trim();
  if (!name) throw new Error('which section?');

  const queue = path.join(root, 'queue');
  const { resolve } = require('./queue');
  const r = resolve(root);

  const sec = r.sections.get(name);
  if (!sec) throw new Error(`no section named "${name}" in this queue`);

  /* An update rewrote a component definition wherever that component is used.
     There is no page it was placed on and no local record to roll back — the
     change is in Webflow and only Webflow. Offering to "unbuild" it would be
     theatre. */
  if (sec.build === 'update') {
    throw new Error(
      `"${name}" is a component update — it changed the component everywhere it is used, ` +
      'so there is nothing local to undo. Capture the correction and run it again instead.'
    );
  }

  const stateFile = path.join(queue, '_state.json');
  const state = readState(stateFile);
  const pages = [];

  for (const pg of Object.keys(state.built || {})) {
    if (page && pg !== page) continue;
    const list = state.built[pg] || [];
    const at = list.indexOf(name);
    if (at === -1) continue;
    list.splice(at, 1);
    pages.push(pg);
    // An empty list would keep claiming the page has a build history.
    if (!list.length) delete state.built[pg];
  }
  if (pages.length) writeAtomic(stateFile, JSON.stringify(state, null, 2) + '\n');

  /* _done/ back to sections/. loadSections reads _done first so sections/ wins,
     which means a section recaptured since it was built already has a live copy
     — that one is newer and authoritative, so the finished copy goes to _trash
     rather than over the top of it. Nothing is ever deleted here. */
  const done = path.join(queue, '_done', name);
  const live = path.join(queue, 'sections', name);
  let movedBack = false;
  let trashed = null;

  if (fs.existsSync(done)) {
    if (!fs.existsSync(live)) {
      fs.mkdirSync(path.dirname(live), { recursive: true });
      fs.renameSync(done, live);
      movedBack = true;
    } else {
      const trash = path.join(queue, '_trash');
      fs.mkdirSync(trash, { recursive: true });
      let to = path.join(trash, name + '-done');
      if (fs.existsSync(to)) to = to + '-' + Date.now();
      fs.renameSync(done, to);
      trashed = path.relative(root, to);
    }
  }

  /* The build log has to move aside, for two reasons that point the same way.
     It is the only record of what actually reached the live site, so it must
     survive the rebuild that is about to overwrite it. And a finished log left
     in place would make the queue report this section stalled forever — status
     is derived from that file. */
  let logArchived = null;
  const log = path.join(fs.existsSync(live) ? live : done, 'build-log.md');
  if (fs.existsSync(log)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const to = path.join(path.dirname(log), 'build-log-' + stamp + '.md');
    fs.renameSync(log, to);
    logArchived = path.relative(root, to);
  }

  return {
    section: name,
    pages: pages,
    movedBack: movedBack,
    trashed: trashed,
    logArchived: logArchived,
    build: sec.build,
    // Kept on purpose: the component and the uploaded assets still exist in
    // Webflow, and forgetting their ids would make the next build duplicate them.
    kept: {
      components: Object.keys(state.components || {}).length,
      assets: Object.keys(state.assets || {}).length
    }
  };
}

module.exports = { unbuild };
