// Loads and validates the queue, and resolves it into an ordered build plan.
// Everything here is pure filesystem + parsing: it never talks to Webflow, so it
// is safe to run at any time and is the cheapest place to catch a mistake.

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./yaml');

const PROP_TYPES = new Set([
  'textContent', 'string', 'richText', 'image', 'link',
  'video', 'number', 'boolean', 'id', 'altText'
]);
// update: this Figma frame is the new definition of a Webflow component that
// already exists, so the builder edits it in place rather than creating one.
const BUILD_MODES = new Set(['static', 'component', 'update']);
const POSITIONS = new Set(['append', 'prepend', 'before', 'after']);

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
}

// Class names the plugin proposed, harvested from the `wf:` lines of a dump. Used to
// verify that every prop target and cms binding names an element that exists.
function classesInDump(body) {
  const out = new Set();
  for (const line of String(body).split('\n')) {
    const m = /^\s*wf:\s*(.*)$/.exec(line);
    if (!m) continue;
    const head = m[1].split('[')[0];
    for (const c of head.match(/\.[A-Za-z0-9_-]+/g) || []) out.add(c.slice(1));
  }
  return out;
}

function reusedComponents(body) {
  const out = new Set();
  for (const line of String(body).split('\n')) {
    const m = /REUSE component "([^"]+)"/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

function loadSections(root, problems) {
  const sections = new Map();
  // _done/ is read too. The build skill moves finished sections there, and the
  // page manifests still list them — without this, a project errored with
  // "section does not exist" the moment its first section was completed.
  //
  // Order matters and _done must lose. Recapturing a finished section writes a
  // fresh copy into sections/ while the old one still sits in _done/; loading
  // _done second overwrote the new dump with the stale one, reported it done,
  // and served the superseded markup with no sign anything had happened.
  loadSectionsFrom(path.join(root, 'queue', '_done'), true, sections, problems);
  loadSectionsFrom(path.join(root, 'queue', 'sections'), false, sections, problems);
  return sections;
}

function loadSectionsFrom(dir, done, sections, problems) {
  if (!fs.existsSync(dir)) return sections;

  for (const entry of fs.readdirSync(dir).sort()) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue;
    const sdir = path.join(dir, entry);
    if (!fs.statSync(sdir).isDirectory()) continue;
    const file = path.join(sdir, 'section.md');
    if (!fs.existsSync(file)) {
      problems.push({ level: 'error', where: entry, msg: 'missing section.md' });
      continue;
    }

    let parsed;
    try {
      parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'), `sections/${entry}/section.md`);
    } catch (e) {
      problems.push({ level: 'error', where: entry, msg: e.message });
      continue;
    }

    const d = parsed.data;
    const name = d.name || entry;
    if (d.name && d.name !== entry) {
      problems.push({
        level: 'error', where: entry,
        msg: `name "${d.name}" does not match its folder — rename one so they agree`
      });
    }

    const classes = classesInDump(parsed.body);
    const assetsDir = path.join(sdir, 'assets');
    const assets = fs.existsSync(assetsDir)
      ? fs.readdirSync(assetsDir).filter((f) => !f.startsWith('.')).sort()
      : [];

    const sec = {
      name, dir: sdir, file, done: !!done,
      build: d.build || 'static',
      componentId: d.componentId || null,
      componentName: d.componentName || null,
      group: d.group || null,
      props: d.props || null,
      cms: d.cms || null,
      body: parsed.body,
      classes, assets,
      reuse: [...reusedComponents(parsed.body)]
    };

    // A finished section is a record, not a plan. Re-validating it would raise
    // problems for work that is already built and cannot be edited into shape.
    if (!done) validateSection(sec, problems);
    sections.set(name, sec);
  }
  return sections;
}

function validateSection(sec, problems) {
  const at = (msg, level) => problems.push({ level: level || 'error', where: sec.name, msg });

  if (!BUILD_MODES.has(sec.build)) {
    at(`build must be one of ${[...BUILD_MODES].join(', ')}, got ${JSON.stringify(sec.build)}`);
  }
  // An update with no id names no component, and an id on any other mode would
  // be silently ignored — both are typos worth stopping for.
  if (sec.build === 'update' && !sec.componentId) {
    at('build: update needs componentId — which Webflow component is being replaced?');
  }
  if (sec.build !== 'update' && sec.componentId) {
    at(`componentId is only used when build: update, not ${JSON.stringify(sec.build)}`);
  }
  if (!sec.body.trim()) at('the dump is empty — paste the Pentool Studio output below the frontmatter');
  else if (!sec.classes.size) {
    at('no "wf:" lines found — nothing here can be built', 'warn');
  }

  if (sec.props) {
    if (!Array.isArray(sec.props)) { at('props must be a list'); return; }
    if (sec.build !== 'component') at('props are only used when build: component', 'warn');
    sec.props.forEach((p, i) => {
      const tag = `props[${i}]`;
      if (!p || typeof p !== 'object') return at(`${tag} must be a map`);
      if (!p.name) at(`${tag} is missing name`);
      if (!PROP_TYPES.has(p.type)) {
        at(`${tag} type ${JSON.stringify(p.type)} is not a Webflow prop type (${[...PROP_TYPES].join(', ')})`);
      }
      if (!p.target) at(`${tag} is missing target`);
      else if (!sec.classes.has(p.target)) {
        at(`${tag} target ".${p.target}" is not any element in the dump`);
      }
    });
  }

  if (sec.cms) {
    if (typeof sec.cms !== 'object' || Array.isArray(sec.cms)) return at('cms must be a map');
    if (!sec.cms.collection) at('cms is missing collection');
    if (!sec.cms.element) at('cms is missing element');
    else if (!sec.classes.has(sec.cms.element)) {
      at(`cms.element ".${sec.cms.element}" is not any element in the dump`);
    }
    const bind = sec.cms.bind;
    if (bind) {
      if (typeof bind !== 'object' || Array.isArray(bind)) at('cms.bind must be a map');
      else {
        for (const cls of Object.keys(bind)) {
          if (!sec.classes.has(cls)) at(`cms.bind ".${cls}" is not any element in the dump`);
        }
      }
    }
  }
}

function loadPages(root, problems) {
  const dir = path.join(root, 'queue', 'pages');
  const pages = [];
  if (!fs.existsSync(dir)) return pages;

  const seen = new Map();
  for (const entry of fs.readdirSync(dir).sort()) {
    if (entry.startsWith('_') || entry.startsWith('.') || !entry.endsWith('.md')) continue;
    const file = path.join(dir, entry);
    let parsed;
    try {
      parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'), `pages/${entry}`);
    } catch (e) {
      problems.push({ level: 'error', where: entry, msg: e.message });
      continue;
    }
    const d = parsed.data;
    const id = entry.replace(/\.md$/, '');

    if (!d.page) problems.push({ level: 'error', where: entry, msg: 'missing page (slug or id)' });
    if (seen.has(d.page)) {
      problems.push({
        level: 'error', where: entry,
        msg: `page ${d.page} is already declared by ${seen.get(d.page)}`
      });
    } else if (d.page) seen.set(d.page, entry);

    if (d.position && !POSITIONS.has(d.position)) {
      problems.push({ level: 'error', where: entry, msg: `position ${JSON.stringify(d.position)} is not valid` });
    }
    /* A page the plugin has just created has `sections:` and nothing under it,
       which the parser reports as null — declared, empty. That is the normal
       first state of a new page, not a mistake, so it must not be an error:
       an error blocks the whole build, and the page you are still filling
       would stop every other page from building. It builds nothing, which is
       exactly right until you queue something onto it.

       A missing or non-list `sections` key is different — that is a manifest
       that cannot be read, and it stays an error. */
    if (d.sections === null || (Array.isArray(d.sections) && !d.sections.length)) {
      problems.push({ level: 'warn', where: entry, msg: 'no sections queued yet — nothing to build on this page' });
    } else if (!Array.isArray(d.sections)) {
      problems.push({ level: 'error', where: entry, msg: 'sections must be a list' });
    }

    pages.push({ id, file, data: d });
  }
  return pages;
}

/* ══════════════════════════════════ status ══════════════════════════════════
   Five states.

     done      the section is in _done/, or _state.json records it built on
               this page — a section on three pages can be done on one of them
     building  its build-log.md is being written right now
     stalled   it has a build log, unfinished, and nothing has touched it in
               STALE_AFTER_MS — a run that died partway
     blocked   a validation error names it, so it cannot build as it stands
     queued    everything else: on a page, waiting its turn

   `building` is derived from build-log.md rather than recorded anywhere. The
   build skill already has to write that log as it goes, and already justifies it
   by crash recovery — so it is an artifact the agent keeps for its own sake,
   which is what makes it survive a real run. A flag the agent had to set and
   clear would be one more step to forget, and a crash would strand it set: a
   lie that outlives the run. `_state.json.building` is still honoured if
   anything ever writes it; nothing does today.

   `stalled` exists because a crashed build used to read `queued` forever, which
   is precisely backwards — the queue hid the one section that needed a human.

   A section that is on NO page never becomes a step at all, so it cannot carry a
   status here — it surfaces as the "not referenced by any page" warning instead. */

/* Ten minutes. Long enough that a slow stretch between log writes is never
   mistaken for a crash — the visual check publishes to staging and screenshots,
   which is a genuinely long gap — and short enough that a dead run is visible
   before you have watched a "queued" row for a quarter of an hour. A false
   `stalled` is worse than a late one; if a healthy build ever flickers, raise it. */
const STALE_AFTER_MS = 10 * 60 * 1000;

/* What the section's own build log says about it, or nothing at all.

   Never throws: resolve() is what the CLI, the app, the bridge and the plugin
   all call, and an unreadable log must not be able to take the queue down. */
function sectionProgress(dir, now) {
  try {
    const file = path.join(dir, 'build-log.md');
    const st = fs.statSync(file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const note = lines.length ? lines[lines.length - 1] : null;

    if (/(^|\n)\s*done\b/i.test(text)) return { state: 'logged-done', note: note, at: st.mtimeMs };
    const age = (now || Date.now()) - st.mtimeMs;
    return { state: age > STALE_AFTER_MS ? 'stalled' : 'building', note: note, at: st.mtimeMs };
  } catch (e) {
    return { state: 'pending', note: null, at: null };
  }
}

function readState(root) {
  const st = readJson(path.join(root, 'queue', '_state.json'), null);
  return st && typeof st === 'object' ? st : { built: {}, building: null };
}

function stepStatus(sec, page, state, problems, progress) {
  if (sec.done) return 'done';
  const built = (state.built && state.built[page]) || [];
  if (built.indexOf(sec.name) !== -1) return 'done';

  // Live, from the log. Ahead of `blocked` on purpose: if it is being written to
  // right now, that is the more useful thing to say about it.
  if (progress && progress.state === 'building') return 'building';
  if (progress && progress.state === 'stalled') return 'stalled';

  if (state.building === sec.name) return 'building';
  if (problems.some((p) => p.level === 'error' && p.where === sec.name)) return 'blocked';
  return 'queued';
}

function resolve(root) {
  const problems = [];
  const config = readJson(path.join(root, 'queue', '_config.json'), null);
  if (!config) problems.push({ level: 'error', where: '_config.json', msg: 'missing — copy the example and set siteId' });
  else if (!config.siteId) problems.push({ level: 'error', where: '_config.json', msg: 'missing siteId' });

  const sections = loadSections(root, problems);
  const pages = loadPages(root, problems);
  const state = readState(root);
  const used = new Set();
  const steps = [];

  for (const page of pages) {
    const d = page.data;
    const listed = Array.isArray(d.sections) ? d.sections : [];
    for (let mi = 0; mi < listed.length; mi++) {
      const raw = listed[mi];
      const entry = typeof raw === 'string' ? { name: raw } : (raw || {});
      if (!entry.name) {
        problems.push({ level: 'error', where: page.id, msg: 'a sections entry has no name' });
        continue;
      }
      const sec = sections.get(entry.name);
      if (!sec) {
        problems.push({
          level: 'error', where: page.id,
          msg: `section "${entry.name}" does not exist in queue/sections/`
        });
        continue;
      }
      used.add(entry.name);

      if (entry.position && !POSITIONS.has(entry.position)) {
        problems.push({ level: 'error', where: page.id, msg: `position ${JSON.stringify(entry.position)} is not valid` });
      }
      if (entry.props && sec.build !== 'component') {
        problems.push({
          level: 'warn', where: page.id,
          msg: `props were given for "${entry.name}" but it is build: static — they will be ignored`
        });
      }

      // Once per step, not once per consumer.
      const prog = sectionProgress(sec.dir);

      steps.push({
        page: d.page,
        pageFile: path.basename(page.file),
        title: d.title || null,
        createIfMissing: !!d.create_if_missing,
        anchor: entry.anchor || d.anchor || (config && config.defaultAnchor) || 'main-wrapper',
        position: entry.position || d.position || (config && config.defaultPosition) || 'append',
        section: sec.name,
        dir: path.relative(root, sec.dir),
        // Position in the manifest's own `sections:` list. Steps can be skipped
        // — an unknown section produces none — so the rendered order is not a
        // safe index to reorder by.
        manifestIndex: mi,
        status: stepStatus(sec, d.page, state, problems, prog),
        progress: prog,
        build: sec.build,
        group: sec.group || (config && config.componentGroup) || null,
        props: sec.props || null,
        cms: sec.cms || null,
        overrides: entry.props || null,
        assets: sec.assets,
        reuse: sec.reuse
      });
    }
  }

  for (const name of sections.keys()) {
    if (!used.has(name)) {
      problems.push({ level: 'warn', where: name, msg: 'not referenced by any page — it will never be built' });
    }
  }

  /* The gap a crash leaves. Marking a section built and moving it to _done/ are
     two steps, so dying between them leaves a finished log and no record of it —
     and the section then queues up to be built a second time, onto a page that
     already has it. Invisible until now. */
  for (const [name, sec] of sections) {
    if (sec.done) continue;
    const prog = sectionProgress(sec.dir);
    if (prog.state !== 'logged-done') continue;
    const anywhere = Object.keys(state.built || {}).some((pg) => (state.built[pg] || []).indexOf(name) !== -1);
    if (!anywhere) {
      problems.push({
        level: 'warn', where: name,
        msg: 'build-log.md says done but nothing recorded it as built — check the site before building it again'
      });
    }
  }

  return { config, sections, pages, steps, problems };
}

const errorsIn = (problems) => problems.filter((p) => p.level === 'error');

module.exports = {
  resolve, classesInDump, reusedComponents, errorsIn, stepStatus, sectionProgress,
  STALE_AFTER_MS,
  PROP_TYPES, BUILD_MODES, POSITIONS
};
