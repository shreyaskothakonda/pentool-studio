#!/usr/bin/env node
// queue/_state.json read/write, so the runner never hand-edits JSON and the
// format stays consistent across resumed runs.
//
//   node bin/wf-state.js get
//   node bin/wf-state.js component <name>              -> id, or empty + exit 1
//   node bin/wf-state.js set-component <name> <id>
//   node bin/wf-state.js asset <hash>                  -> id, or empty + exit 1
//   node bin/wf-state.js set-asset <hash> <id> [name]
//   node bin/wf-state.js is-built <page> <section>     -> exit 0 if built
//   node bin/wf-state.js mark-built <page> <section>

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'queue', '_state.json');
const EMPTY = { components: {}, assets: {}, built: {} };

const load = () => {
  if (!fs.existsSync(FILE)) return { ...EMPTY };
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch (e) { console.error(`✗ ${FILE} is not valid JSON: ${e.message}`); process.exit(1); }
};
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n');

const [cmd, ...a] = process.argv.slice(2);
const s = load();

switch (cmd) {
  case 'get':
    console.log(JSON.stringify(s, null, 2));
    break;
  case 'component': {
    const id = s.components[a[0]];
    if (!id) process.exit(1);
    console.log(id);
    break;
  }
  case 'set-component':
    s.components[a[0]] = a[1];
    save(s);
    break;
  case 'asset': {
    const rec = s.assets[a[0]];
    if (!rec) process.exit(1);
    console.log(typeof rec === 'string' ? rec : rec.id);
    break;
  }
  case 'set-asset':
    s.assets[a[0]] = { id: a[1], name: a[2] || null };
    save(s);
    break;
  case 'is-built':
    process.exit((s.built[a[0]] || []).includes(a[1]) ? 0 : 1);
    break;
  case 'mark-built':
    s.built[a[0]] = s.built[a[0]] || [];
    if (!s.built[a[0]].includes(a[1])) s.built[a[0]].push(a[1]);
    save(s);
    break;
  default:
    console.error('unknown command: ' + cmd);
    process.exit(1);
}
