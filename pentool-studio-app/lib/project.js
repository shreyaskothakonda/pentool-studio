// Project registry and scaffolding.
//
// A project is a self-contained pipeline: its own queue, its own config, its own
// copy of lib/, bin/ and the skills. Self-contained rather than sharing one
// install because the agent runs with the project as its cwd — the skills say
// `node bin/wf-queue.js`, and that has to resolve. A shared install would need
// path indirection everywhere for no real gain.
//
// One agent per project. Projects run in parallel safely because they touch
// different sites, different queues and different state files. Two agents on one
// project would race on class creation and element insertion, which Webflow has
// no transaction or undo for.

const fs = require('fs');
const path = require('path');

const TOOLING = ['lib', 'bin'];
const SKILLS = path.join('.claude', 'skills');

const slug = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const isProject = (dir) =>
  !!dir &&
  fs.existsSync(path.join(dir, 'queue')) &&
  fs.existsSync(path.join(dir, 'lib', 'queue.js'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from)) {
    if (entry === 'node_modules' || entry.startsWith('.DS')) continue;
    const src = path.join(from, entry);
    const dst = path.join(to, entry);
    const st = fs.statSync(src);
    if (st.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/**
 * Create a new project from this installation's tooling.
 * @param {{templateRoot: string, parentDir: string, name: string,
 *          siteId?: string, siteName?: string}} opts
 * @returns {{root: string, name: string, created: boolean}}
 */
function createProject(opts) {
  const name = slug(opts.name);
  if (!name) throw new Error('project name is empty after slugifying');
  if (!fs.existsSync(opts.parentDir)) throw new Error('parent folder does not exist');

  const root = path.resolve(opts.parentDir, name);
  if (root !== path.join(opts.parentDir, name)) throw new Error('name escapes the parent folder');
  if (fs.existsSync(root)) throw new Error(`${name} already exists in that folder`);

  fs.mkdirSync(path.join(root, 'queue', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'queue', 'sections'), { recursive: true });
  fs.mkdirSync(path.join(root, 'queue', '_done'), { recursive: true });
  fs.mkdirSync(path.join(root, 'snapshots'), { recursive: true });

  for (const dir of TOOLING) {
    const from = path.join(opts.templateRoot, dir);
    if (fs.existsSync(from)) copyDir(from, path.join(root, dir));
  }
  // A project without its skills has no /webflow-build and no /webflow-snapshot,
  // which the app types straight into the agent. Silently skipping produced a
  // project that looked fine and could not build, so this is fatal.
  const skillsFrom = path.join(opts.templateRoot, SKILLS);
  if (!fs.existsSync(skillsFrom)) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`no skills found at ${skillsFrom} — the install is incomplete`);
  }
  copyDir(skillsFrom, path.join(root, SKILLS));

  fs.writeFileSync(path.join(root, 'queue', '_config.json'), JSON.stringify({
    siteId: opts.siteId || '',
    siteName: opts.siteName || opts.name,
    componentGroup: '',
    defaultAnchor: 'main-wrapper',
    defaultPosition: 'append',
    bridgePort: opts.bridgePort || 8930,
    mcp: 'webflow',

    // What this site's style guide actually contains. The plugin reads it to mark
    // a class [existing] rather than [new] and to reuse components instead of
    // rebuilding them.
    //
    // `known` is deliberately absent: an empty list would claim the site has no
    // classes and mark everything [new]. Until the first build fills it in from
    // Webflow, the plugin's Client-First defaults stand in. `wf-styleguide.js
    // set` writes the real inventory.
    styleGuide: {
      built: []
    },

    visual: { enabled: true, baseUrl: '', viewport: [1440, 900], publishToStaging: true }
  }, null, 2) + '\n');

  /* Pre-approves the Webflow tools and the project's own bin/. Without it a build
     stops for confirmation on every create_style and every wf-state call —
     hundreds of prompts for one page, which is the difference between "it built
     the page" and "I clicked yes two hundred times". Nothing destructive is on
     the list: publishing stays manual, and the snapshot gate is enforced by the
     skill, not by permissions.

     No .mcp.json is written. A project-scoped server needs its own approval on
     first run, and that approval lives only in ~/.claude.json — which Claude Code
     owns and prunes, so writing it from here does not survive. Scaffolding one
     would have traded a few hundred tool prompts for a startup prompt in every
     new project. The server belongs at user scope, added once; the app says so
     when it is missing. */
  const mcpName = opts.mcp === 'webflow-beta' ? 'webflow-beta' : 'webflow';
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
    permissions: {
      allow: [
        `mcp__${mcpName}__*`,
        'Bash(node bin/wf-queue.js:*)',
        'Bash(node bin/wf-state.js:*)',
        'Bash(node bin/wf-asset.js:*)',
        'Bash(node bin/wf-snapshot.js:*)',
        'Bash(node bin/wf-styleguide.js:*)',
        'Read(queue/**)'
      ]
    }
  }, null, 2) + '\n');

  fs.writeFileSync(path.join(root, '.gitignore'),
    ['queue/_bridge-token', 'queue/_state.json', 'queue/_session.json',
     'queue/_pages.json', 'queue/_components.json', 'snapshots/', '.DS_Store', ''].join('\n'));

  fs.writeFileSync(path.join(root, 'README.md'),
    `# ${opts.name}\n\nA Pentool project. Set \`siteId\` in \`queue/_config.json\`, then send\n` +
    `sections from Figma with Pentool Studio.\n\n` +
    `One agent per project. Run other projects in parallel; never two agents here.\n`);

  return { root, name, created: true };
}

/* ───────────────────────────── the registry ───────────────────────────── */

function readRegistry(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.projects) ? j.projects : [];
  } catch (e) { return []; }
}

function writeRegistry(file, projects) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ projects }, null, 2) + '\n');
  return projects;
}

/** Add a project, keeping the list unique by root and dropping vanished ones. */
function registerProject(file, root, name) {
  const list = readRegistry(file).filter((p) => p.root !== root && isProject(p.root));
  list.push({ root, name: name || path.basename(root), addedAt: new Date().toISOString() });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return writeRegistry(file, list);
}

function forgetProject(file, root) {
  return writeRegistry(file, readRegistry(file).filter((p) => p.root !== root));
}

/** Registered projects that still exist on disk, each flagged valid or not. */
function listProjects(file) {
  return readRegistry(file).map((p) => Object.assign({}, p, {
    exists: fs.existsSync(p.root),
    valid: isProject(p.root)
  }));
}

module.exports = {
  createProject, registerProject, forgetProject, listProjects,
  readRegistry, writeRegistry, isProject, slug
};
