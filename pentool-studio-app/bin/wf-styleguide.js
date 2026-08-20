#!/usr/bin/env node
// Records what the site's style guide actually contains, so the plugin can mark
// a class [existing] instead of [new].
//
//   node bin/wf-styleguide.js set --known a,b,c --built card,label
//   node bin/wf-styleguide.js set --known-file styles.json
//   node bin/wf-styleguide.js show
//
// The agent already reads this inventory during preflight via
// `data_style_tool > get_styles`; without this it was fetched and thrown away,
// and every capture kept guessing from the defaults the plugin shipped with.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'queue', '_config.json');
const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name) {
  const i = argv.indexOf('--' + name);
  return i === -1 ? null : argv[i + 1];
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) {
    console.error(`✗ cannot read ${path.relative(ROOT, FILE)}: ${e.message}`);
    process.exit(1);
  }
}

// Accepts a comma list, or a JSON file holding either an array of names or the
// get_styles response shape ({ styles: [{ name }] } / [{ name }]).
function names(inline, file) {
  if (inline) return inline.split(',').map((s) => s.trim()).filter(Boolean);
  if (!file) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`✗ cannot read ${file}: ${e.message}`); process.exit(1); }
  const list = Array.isArray(raw) ? raw : (raw.styles || raw.results || []);
  return list
    .map((x) => (typeof x === 'string' ? x : x && (x.name || x.styleName)))
    .filter(Boolean);
}

if (cmd === 'show') {
  const sg = readConfig().styleGuide || {};
  console.log(`known : ${(sg.known || []).length} class(es)` +
    (sg.known ? '' : '  (unset — the plugin uses its Client-First defaults)'));
  console.log(`built : ${(sg.built || []).join(', ') || '(none)'}`);
  process.exit(0);
}

if (cmd !== 'set') {
  console.error('usage: wf-styleguide.js <set|show> [--known a,b] [--known-file f.json] [--built a,b]');
  process.exit(1);
}

const cfg = readConfig();
cfg.styleGuide = cfg.styleGuide || {};

const known = names(flag('known'), flag('known-file'));
const built = names(flag('built'), flag('built-file'));
if (known === null && built === null) {
  console.error('✗ nothing to set — pass --known/--known-file and/or --built/--built-file');
  process.exit(1);
}
// Sorted and de-duplicated so a re-run produces no diff when nothing changed.
if (known !== null) cfg.styleGuide.known = [...new Set(known)].sort();
if (built !== null) cfg.styleGuide.built = [...new Set(built)].sort();

const tmp = FILE + '.tmp-' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
fs.renameSync(tmp, FILE);

if (known !== null) console.log(`✓ ${cfg.styleGuide.known.length} class(es) recorded`);
if (built !== null) console.log(`✓ ${cfg.styleGuide.built.length} built component(s) recorded`);
