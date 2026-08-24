// Zero-dependency test runner. `node test.js`
const { parseYaml, parseFrontmatter, YamlError } = require('./lib/yaml');

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(label, actual, expected) {
  if (eq(actual, expected)) { pass++; console.log('  ok   ' + label); }
  else {
    fail++;
    console.log('  FAIL ' + label);
    console.log('         got  ' + JSON.stringify(actual));
    console.log('         want ' + JSON.stringify(expected));
  }
}

function throws(label, fn, matcher) {
  try {
    fn();
    fail++; console.log('  FAIL ' + label + ' — expected a throw, got none');
  } catch (e) {
    if (matcher && !matcher.test(e.message)) {
      fail++;
      console.log('  FAIL ' + label + ' — wrong message: ' + e.message);
    } else { pass++; console.log('  ok   ' + label + '  (' + e.message + ')'); }
  }
}

function section(name) { console.log('\n' + name); }

/* ─────────────────────────── yaml: scalars ─────────────────────────── */
section('yaml — scalar types');
check('string', parseYaml('a: hello'), { a: 'hello' });
check('slug keeps its slash', parseYaml('page: /markets'), { page: '/markets' });
check('boolean true', parseYaml('a: true'), { a: true });
check('boolean false', parseYaml('a: false'), { a: false });
check('integer', parseYaml('a: 12'), { a: 12 });
check('negative integer', parseYaml('a: -3'), { a: -3 });
check('float', parseYaml('a: 1.5'), { a: 1.5 });
check('null', parseYaml('a: null'), { a: null });
check('tilde null', parseYaml('a: ~'), { a: null });
check('double quoted keeps type', parseYaml('a: "true"'), { a: 'true' });
check('single quoted', parseYaml("a: 'hi there'"), { a: 'hi there' });
check('quoted number stays string', parseYaml('a: "12"'), { a: '12' });
check('value containing a colon', parseYaml('a: see http://x'), { a: 'see http://x' });
// An apostrophe in a bare word used to open a quote that never closed, so the
// trailing comment was swallowed into the value.
check('apostrophe in a bare word', parseYaml("a: Don't Panic # note"), { a: "Don't Panic" });
check('apostrophe with no comment', parseYaml("a: it's fine"), { a: "it's fine" });
check('a real single-quoted string still works', parseYaml("a: 'x # y' # note"), { a: 'x # y' });
check('a real double-quoted string still works', parseYaml('a: "x # y" # note'), { a: 'x # y' });
check('apostrophe in a list item', parseYaml("a:\n  - client's site # note"), { a: ["client's site"] });
check('empty key is null', parseYaml('a:'), { a: null });

section('yaml — comments');
check('full line comment', parseYaml('# hi\na: 1'), { a: 1 });
check('trailing comment', parseYaml('a: 1  # note'), { a: 1 });
check('hash inside quotes survives', parseYaml('a: "c#1"'), { a: 'c#1' });
check('blank lines ignored', parseYaml('a: 1\n\n\nb: 2'), { a: 1, b: 2 });

section('yaml — nesting');
check('nested map', parseYaml('cms:\n  collection: Markets\n  limit: 12'),
  { cms: { collection: 'Markets', limit: 12 } });
check('two levels', parseYaml('cms:\n  bind:\n    a_title: name\n    a_text: summary'),
  { cms: { bind: { a_title: 'name', a_text: 'summary' } } });
check('scalar list', parseYaml('sections:\n  - one\n  - two'),
  { sections: ['one', 'two'] });
check('list of maps', parseYaml('props:\n  - name: Title\n    type: textContent'),
  { props: [{ name: 'Title', type: 'textContent' }] });
check('list of maps with nested map',
  parseYaml('sections:\n  - name: grid\n    props:\n      Title: "Hi"'),
  { sections: [{ name: 'grid', props: { Title: 'Hi' } }] });
check('mixed scalar and map items',
  parseYaml('sections:\n  - hero\n  - name: grid\n    position: append\n  - cta'),
  { sections: ['hero', { name: 'grid', position: 'append' }, 'cta'] });

section('yaml — the real page manifest shape');
check('full page manifest', parseYaml([
  'page: /markets',
  'title: Markets',
  'create_if_missing: false',
  'anchor: main-wrapper',
  'sections:',
  '  - markets-hero',
  '  - name: markets-grid',
  '    position: append',
  '    props:',
  '      Title: "Markets we serve"',
  '  - cta-band'
].join('\n')), {
  page: '/markets', title: 'Markets', create_if_missing: false, anchor: 'main-wrapper',
  sections: ['markets-hero',
    { name: 'markets-grid', position: 'append', props: { Title: 'Markets we serve' } },
    'cta-band']
});

section('yaml — hard errors, never a silent misread');
throws('tab indentation', () => parseYaml('a:\n\tb: 1'), /tab/i);
throws('duplicate key', () => parseYaml('a: 1\na: 2'), /duplicate/i);
throws('missing colon', () => parseYaml('just text'), /expected "key: value"/);
throws('unterminated quote', () => parseYaml('a: "oops'), /unterminated/);
throws('inline value plus children', () => parseYaml('a: 1\n  b: 2'), /both an inline value and children/);
throws('reports the line number', () => parseYaml('a: 1\nb: 2\nc: 1\nc: 2'), /line 4/);

section('frontmatter');
const fm = parseFrontmatter('---\nname: grid\nbuild: static\n---\n=== BUILD CONTRACT ===\nbody line\n', 'section.md');
check('data parsed', fm.data, { name: 'grid', build: 'static' });
check('body preserved', fm.body, '=== BUILD CONTRACT ===\nbody line\n');
throws('missing frontmatter', () => parseFrontmatter('no fm here', 'x.md'), /must start with a --- frontmatter/);
throws('unterminated frontmatter', () => parseFrontmatter('---\na: 1\n', 'x.md'), /unterminated frontmatter/);
throws('list frontmatter rejected', () => parseFrontmatter('---\n- a\n- b\n---\nbody', 'x.md'), /must be a map/);


/* ─────────────────────────── queue resolver ─────────────────────────── */
const fs = require('fs');
const os = require('os');
const pathm = require('path');
const { resolve, classesInDump, reusedComponents, errorsIn } = require('./lib/queue');

const DUMP = [
  '=== BUILD CONTRACT (webflow / client-first) ===',
  'site: GCE Dev',
  '',
  'section "Markets"  1440x720  . section',
  '    wf: Section<section> .section_markets   [new]',
  '  frame "grid"  1280x520  . layout',
  '      wf: DivBlock<ul> .markets_list   [new]',
  '    instance "market-card"  405x520  . component',
  '        wf: REUSE component "market-card" — do not rebuild',
  '  text "title"  264x32  . element',
  '      wf: Heading h2 .markets_title .heading-style-h2   [existing]'
].join('\n');

function fixture(files) {
  const root = fs.mkdtempSync(pathm.join(os.tmpdir(), 'wfq-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = pathm.join(root, rel);
    fs.mkdirSync(pathm.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

const CONFIG = JSON.stringify({ siteId: 'site123', componentGroup: 'GCE' });

function sectionFile(fm) { return '---\n' + fm + '\n---\n' + DUMP + '\n'; }

section('dump scanning');
check('classes harvested from wf: lines',
  [...classesInDump(DUMP)].sort(),
  ['heading-style-h2', 'markets_list', 'markets_title', 'section_markets']);
check('reuse lines found', [...reusedComponents(DUMP)], ['market-card']);
check('tags are not mistaken for classes', classesInDump('    wf: DivBlock .a   [new . not-a-class]').has('not-a-class'), false);

section('resolver — happy path');
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/markets.md': '---\npage: /markets\nanchor: main-wrapper\nsections:\n  - markets-hero\n  - name: markets-grid\n    position: prepend\n---\n',
    'queue/sections/markets-hero/section.md': sectionFile('name: markets-hero\nbuild: static'),
    'queue/sections/markets-grid/section.md': sectionFile('name: markets-grid\nbuild: component\ngroup: GCE')
  });
  const r = resolve(root);
  check('no errors', errorsIn(r.problems).map((p) => p.msg), []);
  check('two steps', r.steps.length, 2);
  check('order follows the manifest', r.steps.map((s) => s.section), ['markets-hero', 'markets-grid']);
  check('page carried through', r.steps[0].page, '/markets');
  check('anchor inherited from the page', r.steps[0].anchor, 'main-wrapper');
  check('entry position overrides the page', r.steps[1].position, 'prepend');
  check('default position when unset', r.steps[0].position, 'append');
  check('build mode carried', r.steps.map((s) => s.build), ['static', 'component']);
  check('reuse detected on the step', r.steps[0].reuse, ['market-card']);
  fs.rmSync(root, { recursive: true, force: true });
}

section('resolver — a section on two pages');
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - cta\n---\n',
    'queue/pages/b.md': '---\npage: /b\nsections:\n  - cta\n---\n',
    'queue/sections/cta/section.md': sectionFile('name: cta\nbuild: component')
  });
  const r = resolve(root);
  check('built once per page', r.steps.map((s) => s.page), ['/a', '/b']);
  check('group falls back to config', r.steps[0].group, 'GCE');
  check('no errors', errorsIn(r.problems).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

section('resolver — catches mistakes before Webflow is touched');
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/markets.md': '---\npage: /markets\nsections:\n  - nope\n---\n',
    'queue/sections/orphan/section.md': sectionFile('name: orphan\nbuild: static')
  });
  const r = resolve(root);
  const msgs = r.problems.map((p) => p.msg).join(' | ');
  check('unknown section is an error', /section "nope" does not exist/.test(msgs), true);
  check('orphan section warned', /not referenced by any page/.test(msgs), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - grid\n---\n',
    'queue/sections/grid/section.md': sectionFile(
      'name: grid\nbuild: component\nprops:\n  - name: Title\n    type: textContent\n    target: does_not_exist')
  });
  const r = resolve(root);
  check('prop target must exist in the dump',
    /target "\.does_not_exist" is not any element/.test(r.problems.map((p) => p.msg).join(' | ')), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - grid\n---\n',
    'queue/sections/grid/section.md': sectionFile(
      'name: grid\nbuild: component\nprops:\n  - name: Title\n    type: nonsense\n    target: markets_title')
  });
  const r = resolve(root);
  check('bad prop type rejected',
    /is not a Webflow prop type/.test(r.problems.map((p) => p.msg).join(' | ')), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - grid\n---\n',
    'queue/sections/grid/section.md': sectionFile(
      'name: grid\nbuild: static\ncms:\n  collection: Markets\n  element: ghost_list')
  });
  const r = resolve(root);
  check('cms element must exist in the dump',
    /cms\.element "\.ghost_list" is not any element/.test(r.problems.map((p) => p.msg).join(' | ')), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - grid\n---\n',
    'queue/pages/b.md': '---\npage: /a\nsections:\n  - grid\n---\n',
    'queue/sections/grid/section.md': sectionFile('name: grid\nbuild: static')
  });
  const r = resolve(root);
  check('duplicate page slug rejected',
    /already declared by/.test(r.problems.map((p) => p.msg).join(' | ')), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - grid\n---\n',
    'queue/sections/grid/section.md': sectionFile('name: mismatch\nbuild: static')
  });
  const r = resolve(root);
  check('folder and name must agree',
    /does not match its folder/.test(r.problems.map((p) => p.msg).join(' | ')), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({ 'queue/pages/a.md': '---\npage: /a\nsections:\n  - x\n---\n' });
  const r = resolve(root);
  check('missing config is an error',
    /_config\.json/.test(errorsIn(r.problems).map((p) => p.where).join(' | ')), true);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - raw\n---\n',
    'queue/sections/raw/section.md': '---\nname: raw\nbuild: static\n---\nframe "x" 10x10\n'
  });
  const r = resolve(root);
  const msgs = r.problems.map((p) => p.msg).join(' | ');
  check('a dump with no wf: lines warns, not fatal', /nothing here can be built/.test(msgs), true);
  check('and it is only a warning', errorsIn(r.problems).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
}


/* ────────────────────────── surgical manifest edits ────────────────────────── */
const { reorderSections, setBuildMode, sectionOrder } = require('./lib/edit');

const PAGE = [
  '---',
  'page: /markets',
  'anchor: main-wrapper',
  'sections:',
  '  # the opener',
  '  - markets-hero',
  '',
  '  - name: markets-grid      # overrides for this page',
  '    position: prepend',
  '    props:',
  '      Title: "Markets we serve"',
  '  - cta-band',
  '---',
  '',
  'Notes below the frontmatter.',
  ''
].join('\n');

section('edit — sectionOrder');
check('reads names in order', sectionOrder(PAGE), ['markets-hero', 'markets-grid', 'cta-band']);

section('edit — reorderSections');
{
  const out = reorderSections(PAGE, 2, 0);
  check('cta-band moves to the front', sectionOrder(out), ['cta-band', 'markets-hero', 'markets-grid']);
  check('nested props travel with their item', /- name: markets-grid[\s\S]*?Title: "Markets we serve"/.test(out), true);
  check('the inline comment survives', out.indexOf('# overrides for this page') >= 0, true);
  check('the standalone comment survives', out.indexOf('  # the opener') >= 0, true);
  check('body after frontmatter untouched', out.endsWith('---\n\nNotes below the frontmatter.\n'), true);
  check('nothing outside sections changed', /^---\npage: \/markets\nanchor: main-wrapper\nsections:\n/.test(out), true);
  check('line count is preserved', out.split('\n').length, PAGE.split('\n').length);
}
{
  const out = reorderSections(PAGE, 0, 2);
  check('hero moves to the end', sectionOrder(out), ['markets-grid', 'cta-band', 'markets-hero']);
  check('its leading comment goes with it', /# the opener\n  - markets-hero/.test(out), true);
}
check('from === to is a no-op', reorderSections(PAGE, 1, 1), PAGE);
throws('from out of range', () => reorderSections(PAGE, 9, 0), /out of range/);
throws('to out of range', () => reorderSections(PAGE, 0, 9), /out of range/);
throws('non-integer index', () => reorderSections(PAGE, 0.5, 1), /must be integers/);
throws('no frontmatter', () => reorderSections('just text', 0, 1), /no --- frontmatter/);
throws('unterminated frontmatter', () => reorderSections('---\nsections:\n  - a\n', 0, 1), /unterminated/);
throws('no sections key', () => reorderSections('---\npage: /x\n---\nbody', 0, 1), /no top-level `sections:`/);
throws('sections with no items', () => reorderSections('---\nsections:\n---\nbody', 0, 1), /no list items/);

section('edit — reorder is stable under repetition');
{
  let t = PAGE;
  for (let i = 0; i < 3; i++) t = reorderSections(t, 0, 2);   // rotate three times
  check('three rotations of three items returns the original order',
    sectionOrder(t), ['markets-hero', 'markets-grid', 'cta-band']);
  check('and the text is byte-identical', t, PAGE);
}

section('edit — setBuildMode');
const SEC = [
  '---',
  'name: markets-grid',
  'build: static            # static | component',
  '# group: GCE',
  '---',
  '',
  '=== BUILD CONTRACT ===',
  ''
].join('\n');
{
  const out = setBuildMode(SEC, 'component');
  check('value swapped', /^build: component {12}# static \| component$/m.test(out), true);
  check('exactly one line differs',
    out.split('\n').filter((l, i) => l !== SEC.split('\n')[i]).length, 1);
  check('the commented group line survives', out.indexOf('# group: GCE') >= 0, true);
  check('body untouched', out.indexOf('=== BUILD CONTRACT ===') >= 0, true);
}
check('setting the current value is a no-op', setBuildMode(SEC, 'static'), SEC);
{
  const bare = '---\nname: x\n---\nbody\n';
  const out = setBuildMode(bare, 'component');
  check('inserts after name when absent', out, '---\nname: x\nbuild: component\n---\nbody\n');
}
{
  const noComment = '---\nname: x\nbuild: static\n---\nbody\n';
  check('no trailing comment to preserve', setBuildMode(noComment, 'component'),
    '---\nname: x\nbuild: component\n---\nbody\n');
}
throws('rejects an unknown mode', () => setBuildMode(SEC, 'wysiwyg'), /must be one of/);
throws('refuses a malformed manifest', () => setBuildMode('no fm', 'static'), /no --- frontmatter/);


/* ─────────────────────────── webflow page listing ─────────────────────────── */
const { listPages, writePagesCache, readPagesCache } = require('./lib/webflow');

function fakeFetch(pagesByOffset, opts) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization });
    if (opts && opts.status) {
      return { ok: false, status: opts.status, json: async () => ({ message: 'nope' }) };
    }
    const off = Number(/offset=(\d+)/.exec(url)[1]);
    const chunk = pagesByOffset[off] || [];
    const total = Object.values(pagesByOffset).reduce((n, c) => n + c.length, 0);
    return { ok: true, status: 200, json: async () => ({ pages: chunk, pagination: { limit: 100, offset: off, total } }) };
  };
  impl.seen = seen;
  return impl;
}

async function wfTests() {
  section('webflow — listSites');
{
  const { listSites } = require('./lib/webflow');
  let seenUrl = null, seenAuth = null;
  const fetchImpl = async (url, o) => {
    seenUrl = url; seenAuth = o.headers.authorization;
    return { ok: true, status: 200, json: async () => ({ sites: [
      { id: 's2', displayName: 'Zebra', shortName: 'zebra' },
      { id: 's1', displayName: 'Acme', shortName: 'acme', previewUrl: 'https://x' }] }) };
  };
  const sites = await listSites({ token: 'tok', fetchImpl });
  check('hits the v2 sites endpoint', /\/v2\/sites$/.test(seenUrl), true);
  check('bearer header sent', seenAuth, 'Bearer tok');
  check('sorted by name', sites.map((x) => x.name), ['Acme', 'Zebra']);
  check('normalised', sites[0], { id: 's1', name: 'Acme', shortName: 'acme',
    previewUrl: 'https://x', lastPublished: null });

  await (async () => {
    try {
      await listSites({ token: '', fetchImpl });
      fail++; console.log('  FAIL a missing token should throw');
    } catch (e) {
      check('a missing token points at settings', /Pentool settings/.test(e.message), true);
    }
  })();

  const bad = async () => ({ ok: false, status: 401, json: async () => ({}) });
  try {
    await listSites({ token: 'x', fetchImpl: bad });
    fail++; console.log('  FAIL 401 should throw');
  } catch (e) {
    check('401 is explained, not raw', /revoked|rejected/.test(e.message), true);
  }
}

section('webflow — listPages');
  {
    const f = fakeFetch({ 0: [
      { id: 'p2', slug: 'markets', title: 'Markets' },
      { id: 'p1', slug: '', title: 'Home' }
    ] });
    const pages = await listPages({ siteId: 'site1', token: 'tok', fetchImpl: f });
    check('normalises each page', pages.map((p) => p.publishedPath), ['/', '/markets']);
    check('titles kept', pages.map((p) => p.title).sort(), ['Home', 'Markets']);
    check('bearer header sent', /^Bearer tok$/.test(f.seen[0].auth), true);
    check('hits the v2 pages endpoint', /\/v2\/sites\/site1\/pages\?/.test(f.seen[0].url), true);
  }
  {
    const many = {};
    many[0] = Array.from({ length: 100 }, (_, i) => ({ id: 'a' + i, slug: 'a' + i, title: 'A' + i }));
    many[100] = [{ id: 'z', slug: 'zzz', title: 'Z' }];
    const pages = await listPages({ siteId: 's', token: 't', fetchImpl: fakeFetch(many) });
    check('follows pagination', pages.length, 101);
  }
  {
    const f = fakeFetch({ 0: [
      { id: '1', slug: 'live', title: 'Live' },
      { id: '2', slug: 'gone', title: 'Gone', archived: true },
      { id: '3', slug: 'wip', title: 'WIP', draft: true }
    ] });
    const pages = await listPages({ siteId: 's', token: 't', fetchImpl: f });
    check('live first, then draft, then archived',
      pages.map((p) => p.title), ['Live', 'WIP', 'Gone']);
  }

  section('webflow — failures are legible');
  for (const [status, re] of [[401, /revoked/], [403, /pages:read/], [404, /siteId/], [429, /rate limited/]]) {
    try {
      await listPages({ siteId: 's', token: 't', fetchImpl: fakeFetch({}, { status }) });
      fail++; console.log('  FAIL ' + status + ' should have thrown');
    } catch (e) {
      if (re.test(e.message)) { pass++; console.log('  ok   ' + status + '  (' + e.message + ')'); }
      else { fail++; console.log('  FAIL ' + status + ' wrong message: ' + e.message); }
    }
  }
  try {
    await listPages({ siteId: 's', fetchImpl: fakeFetch({}) });
    fail++; console.log('  FAIL missing token should throw');
  } catch (e) {
    const ok = /no Webflow token/.test(e.message);
    ok ? (pass++, console.log('  ok   missing token  (' + e.message + ')'))
       : (fail++, console.log('  FAIL wrong message: ' + e.message));
  }

  section('webflow — listComponents');
  {
    const { listComponents } = require('./lib/webflow');
    const impl = async (url) => {
      const off = Number(/offset=(\d+)/.exec(url)[1]);
      const all = [
        { id: 'c1', name: 'market-card', group: 'GCE' },
        { id: 'c2', name: 'navbar', group: 'Relume', readonly: true },
        { id: 'c3', name: 'action-card', group: 'GCE' }
      ];
      const chunk = off === 0 ? all : [];
      return { ok: true, status: 200, json: async () => ({ components: chunk, pagination: { limit: 100, offset: off, total: all.length } }) };
    };
    const cs = await listComponents({ siteId: 's', token: 't', fetchImpl: impl });
    check('hits the components endpoint', cs.length, 3);
    check('updatable before readonly, then grouped by name',
      cs.map((c) => c.name), ['action-card', 'market-card', 'navbar']);
    check('readonly flagged — library components cannot be updated',
      cs.filter((c) => c.readonly).map((c) => c.name), ['navbar']);
  }

  section('snapshot — session gating');
  {
    const snap = require('./lib/snapshot');
    const root = fixture({ 'queue/_config.json': CONFIG });

    let st = snap.snapshotStatus(root);
    check('no snapshot ever taken blocks the build', st.required, true);
    check('and says why', /ever been taken/.test(st.reason), true);

    snap.startSession(root, { host: 'test' });
    const s1 = snap.beginSnapshot(root, 'site1');
    snap.writeArtifact(s1, 'styles.json', [{ name: 'markets_list' }]);
    snap.finishSnapshot(root, s1, { captured: { styles: 1 }, restorePointConfirmed: false });

    st = snap.snapshotStatus(root);
    check('a snapshot taken after session start satisfies the gate', st.required, false);
    check('newest is the one just taken', st.newest.id, s1.id);
    check('artifact written', fs.existsSync(pathm.join(s1.dir, 'styles.json')), true);

    const meta = JSON.parse(fs.readFileSync(pathm.join(s1.dir, 'manifest.json'), 'utf8'));
    check('records that no restore point was confirmed', meta.restorePointConfirmed, false);
    check('manifest carries the cannot-restore warning', /CANNOT restore/.test(meta.warning), true);

    // a session starting later must invalidate the older snapshot
    const future = new Date(Date.now() + 60000).toISOString();
    fs.writeFileSync(snap.sessionFile(root), JSON.stringify({ startedAt: future }));
    st = snap.snapshotStatus(root);
    check('a newer session requires a fresh snapshot', st.required, true);
    check('and says why', /predates this session/.test(st.reason), true);

    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const snap = require('./lib/snapshot');
    const root = fixture({ 'queue/_config.json': CONFIG });
    const s = snap.beginSnapshot(root, 'site1');
    snap.finishSnapshot(root, s, {});
    // no session file at all — CLI use falls back to an age window
    check('recent snapshot passes without a session', snap.snapshotStatus(root, 12).required, false);

    // Age the manifest by 20h rather than racing the clock at 0ms.
    const mf = pathm.join(s.dir, 'manifest.json');
    const aged = JSON.parse(fs.readFileSync(mf, 'utf8'));
    aged.takenAt = new Date(Date.now() - 20 * 36e5).toISOString();
    fs.writeFileSync(mf, JSON.stringify(aged, null, 2));
    check('a stale snapshot requires a new one', snap.snapshotStatus(root, 12).required, true);
    check('and says how stale', /\d+h old/.test(snap.snapshotStatus(root, 12).reason), true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  section('project — scaffolding and registry');
  {
    const proj = require('./lib/project');
    const tmp = fs.mkdtempSync(pathm.join(os.tmpdir(), 'wfp-'));

    const r = proj.createProject({
      templateRoot: pathm.join(__dirname),
      parentDir: tmp,
      name: 'GCE Marketing Site',
      siteId: 'site123'
    });
    check('slugified folder name', pathm.basename(r.root), 'gce-marketing-site');
    check('queue scaffolded', fs.existsSync(pathm.join(r.root, 'queue', 'pages')), true);
    check('tooling copied', fs.existsSync(pathm.join(r.root, 'lib', 'queue.js')), true);
    {
    // Deliberately NOT scaffolded: a project-scoped server needs approval on
    // first run in every project, and that approval lives in ~/.claude.json,
    // which Claude Code owns and prunes. It belongs at user scope, added once.
    check('no project-scoped .mcp.json is written',
      fs.existsSync(pathm.join(r.root, '.mcp.json')), false);

    const set = JSON.parse(fs.readFileSync(pathm.join(r.root, '.claude', 'settings.json'), 'utf8'));
    check('Webflow tools are pre-approved',
      set.permissions.allow.indexOf('mcp__webflow__*') >= 0, true);
    check("and the project's own tooling",
      set.permissions.allow.indexOf('Bash(node bin/wf-queue.js:*)') >= 0, true);
    // Writing .claude/settings.json must not clobber the skills copied into the
    // same directory.
    check('skills survive alongside settings.json',
      fs.existsSync(pathm.join(r.root, '.claude', 'skills', 'webflow-build')), true);
  }
  {
    const parent = fs.mkdtempSync(pathm.join(os.tmpdir(), 'beta-'));
    const b = require('./lib/project').createProject({
      name: 'b', parentDir: parent, templateRoot: process.cwd(), siteId: 's', mcp: 'webflow-beta'
    });
    const set = JSON.parse(fs.readFileSync(pathm.join(b.root, '.claude', 'settings.json'), 'utf8'));
    check('beta pre-approves the beta tools',
      set.permissions.allow.indexOf('mcp__webflow-beta__*') >= 0, true);
    fs.rmSync(parent, { recursive: true, force: true });
  }
  check('the styleguide tool is copied too',
    fs.existsSync(pathm.join(r.root, 'bin', 'wf-styleguide.js')), true);
  {
    // `known` must be ABSENT, not empty: an empty list claims the site has no
    // classes at all and marks every proposal [new].
    const cfg = JSON.parse(fs.readFileSync(pathm.join(r.root, 'queue', '_config.json'), 'utf8'));
    check('a styleGuide block is scaffolded', typeof cfg.styleGuide, 'object');
    check('with no class inventory yet', 'known' in cfg.styleGuide, false);
    check('and an empty built list', cfg.styleGuide.built, []);
  }
  check('bin copied', fs.existsSync(pathm.join(r.root, 'bin', 'wf-queue.js')), true);
    {
    // A project with no skills has no /webflow-build; scaffolding one silently
    // produced something that looked fine and could not build.
    const bare = fs.mkdtempSync(pathm.join(os.tmpdir(), 'tmpl-'));
    fs.mkdirSync(pathm.join(bare, 'lib'), { recursive: true });
    fs.mkdirSync(pathm.join(bare, 'bin'), { recursive: true });
    const parent = fs.mkdtempSync(pathm.join(os.tmpdir(), 'par-'));
    throws('scaffolding without skills is refused',
      () => require('./lib/project').createProject({
        name: 'x', parentDir: parent, templateRoot: bare, siteId: 's'
      }), /skills/);
    check('and it leaves nothing behind',
      fs.existsSync(pathm.join(parent, 'x')), false);
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }

  check('skills copied', fs.existsSync(pathm.join(r.root, '.claude', 'skills', 'webflow-build', 'SKILL.md')), true);
    check('snapshots dir made', fs.existsSync(pathm.join(r.root, 'snapshots')), true);
    check('config carries siteId', JSON.parse(fs.readFileSync(pathm.join(r.root, 'queue', '_config.json'), 'utf8')).siteId, 'site123');
    check('gitignore keeps the token out of git',
      /_bridge-token/.test(fs.readFileSync(pathm.join(r.root, '.gitignore'), 'utf8')), true);
    check('recognised as a project', proj.isProject(r.root), true);
    check('the new project resolves cleanly', require('./lib/queue').resolve(r.root).problems.filter((x) => x.level === 'error').length, 0);

    throws('refuses to overwrite', () => proj.createProject({
      templateRoot: __dirname, parentDir: tmp, name: 'GCE Marketing Site'
    }), /already exists/);
    throws('refuses an empty name', () => proj.createProject({
      templateRoot: __dirname, parentDir: tmp, name: '!!!'
    }), /empty after slugifying/);
    throws('refuses a missing parent', () => proj.createProject({
      templateRoot: __dirname, parentDir: pathm.join(tmp, 'nope'), name: 'x'
    }), /does not exist/);

    const reg = pathm.join(tmp, 'projects.json');
    proj.registerProject(reg, r.root, 'GCE Marketing Site');
    check('registered', proj.listProjects(reg).length, 1);
    check('and marked valid', proj.listProjects(reg)[0].valid, true);
    proj.registerProject(reg, r.root, 'GCE Marketing Site');
    check('registering twice does not duplicate', proj.listProjects(reg).length, 1);

    proj.registerProject(reg, pathm.join(tmp, 'ghost'), 'Ghost');
    const listed = proj.listProjects(reg);
    check('a non-existent project is listed but flagged',
      listed.filter((p) => !p.valid).map((p) => p.name), ['Ghost']);

    proj.forgetProject(reg, r.root);
    check('forgotten', proj.listProjects(reg).map((p) => p.name), ['Ghost']);

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  section('webflow — cache round trip');
  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    writePagesCache(root, [{ id: '1', slug: 'markets', publishedPath: '/markets', title: 'Markets' }], 'site1');
    const back = readPagesCache(root);
    check('siteId stored', back.siteId, 'site1');
    check('pages stored', back.pages.length, 1);
    check('timestamped', typeof back.fetchedAt === 'string', true);
    fs.rmSync(root, { recursive: true, force: true });
  }
  check('missing cache is empty, not an error', readPagesCache('/nonexistent-xyz').pages, []);
  {
    const { writeComponentsCache, readComponentsCache } = require('./lib/webflow');
    const root = fixture({ 'queue/_config.json': CONFIG });
    writeComponentsCache(root, [{ id: 'c1', name: 'market-card', readonly: false }], 'site1');
    check('components cached separately from pages', readComponentsCache(root).components.length, 1);
    check('and pages cache stays empty', readPagesCache(root).pages, []);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* ─────────────────────── bridge: what the plugin POSTs ─────────────────────── */
section('bridge — writeSection');
{
  const { writeSection } = require('./lib/bridge');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // The real shape: every plugin dump opens with the contract header, and
  // writeSection's note recovery anchors on it. A fixture without it would test
  // a format that never reaches disk.
  const dump = '=== BUILD CONTRACT (webflow / client-first) ===\n'
             + 'frame "hero"  1440x600\n  wf: Section .section_hero   [new]\n';

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    const r = writeSection(root, {
      name: 'Hero Band', dump,
      images: [{ name: '_preview-hero.png', base64: PNG.toString('base64') }]
    });
    check('slugifies the section name', r.section, 'hero-band');
    check('reports the section path', r.path, 'queue/sections/hero-band/section.md');
    check('reports the asset', r.images, ['_preview-hero.png']);
    check('no warning for a webflow dump', r.warning, null);
    const md = fs.readFileSync(pathm.join(root, r.path), 'utf8');
    check('frontmatter written', /^---\nname: hero-band\n/.test(md), true);
    check('dump preserved', md.indexOf('wf: Section .section_hero') > 0, true);
    const asset = fs.readFileSync(pathm.join(root, 'queue/sections/hero-band/assets/_preview-hero.png'));
    check('asset bytes round-trip', asset.equals(PNG), true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    const r = writeSection(root, { name: 'raw', dump: 'frame "hero"  1440x600\n' });
    check('flags a dump with no wf: lines', /nothing here can be built/.test(r.warning), true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    /* A section saved with no page is written correctly and then never built.
       Before this warned, the only signal was a queue problem found much later. */
    const root = fixture({ 'queue/_config.json': CONFIG });

    let r = writeSection(root, { name: 'orphan', dump, target: { kind: 'section' } });
    check('a section on no page says so', /on no page/.test(r.warning), true);

    r = writeSection(root, { name: 'placed', dump, target: { kind: 'section', page: '/markets' } });
    check('a section with a page does not', /on no page/.test(r.warning || ''), false);

    // Neither of these has a page to miss.
    r = writeSection(root, { name: 'a-comp', dump, target: { kind: 'component' } });
    check('a new component is exempt', /on no page/.test(r.warning || ''), false);
    r = writeSection(root, { name: 'an-upd', dump, target: { kind: 'update', component: { id: 'c1' } } });
    check('an update is exempt', /on no page/.test(r.warning || ''), false);

    // Two things wrong at once used to report only the first.
    r = writeSection(root, { name: 'both', dump: '=== BUILD CONTRACT ===\nframe "x"  10x10\n', target: { kind: 'section' } });
    check('both warnings are reported',
      /nothing here can be built/.test(r.warning) && /on no page/.test(r.warning), true);

    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    /* Replace is about to become routine in the plugin, and it used to throw
       away the designer's notes every time. */
    const root = fixture({ 'queue/_config.json': CONFIG });
    const file = pathm.join(root, 'queue/sections/noted/section.md');

    writeSection(root, { name: 'noted', dump, notes: 'Use the dark variant.' });
    check('notes are written', /## Notes\n\nUse the dark variant\./.test(fs.readFileSync(file, 'utf8')), true);

    writeSection(root, { name: 'noted', dump, force: true });
    check('a replace with an empty notes box keeps them',
      /## Notes\n\nUse the dark variant\./.test(fs.readFileSync(file, 'utf8')), true);

    writeSection(root, { name: 'noted', dump, notes: 'Actually the light one.', force: true });
    const md = fs.readFileSync(file, 'utf8');
    check('typing new notes replaces them', /Actually the light one\./.test(md), true);
    check('and the old ones are gone', /dark variant/.test(md), false);

    // Multi-line notes are the normal case, and the pattern has to survive them.
    writeSection(root, { name: 'noted', dump, notes: 'One.\n\nTwo.', force: true });
    writeSection(root, { name: 'noted', dump, force: true });
    check('multi-line notes survive a replace',
      /## Notes\n\nOne\.\n\nTwo\.\n/.test(fs.readFileSync(file, 'utf8')), true);

    // A section that never had notes must not grow an empty block.
    writeSection(root, { name: 'plain', dump });
    writeSection(root, { name: 'plain', dump, force: true });
    check('no notes stays no notes',
      /## Notes/.test(fs.readFileSync(pathm.join(root, 'queue/sections/plain/section.md'), 'utf8')), false);

    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    writeSection(root, { name: 'twice', dump });
    throws('refuses to overwrite without force',
      () => writeSection(root, { name: 'twice', dump }), /already exists/);
    const r = writeSection(root, { name: 'twice', dump, force: true });
    check('force replaces', r.replaced, true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // Hand-edited frontmatter is the build contract; a re-send must not reset it.
    const root = fixture({ 'queue/_config.json': CONFIG });
    writeSection(root, { name: 'keeps-fm', dump });
    const file = pathm.join(root, 'queue/sections/keeps-fm/section.md');
    fs.writeFileSync(file, '---\nname: keeps-fm\nbuild: component\ngroup: GCE\n---\nold dump\n');
    writeSection(root, { name: 'keeps-fm', dump, force: true });
    const md = fs.readFileSync(file, 'utf8');
    check('re-send keeps build: component', md.indexOf('build: component') > 0, true);
    check('re-send refreshes the dump', md.indexOf('wf: Section .section_hero') > 0, true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    throws('a traversing name cannot escape queue/sections',
      () => writeSection(root, { name: '../../..', dump }), /empty after slugifying/);
    writeSection(root, { name: '../evil', dump });
    check('a dotted name is slugified, not resolved',
      fs.existsSync(pathm.join(root, 'queue/sections/evil')), true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    throws('empty dump refused', () => writeSection(root, { name: 'x', dump: '  ' }), /dump is empty/);
    // A 0-byte asset would report as written and only fail at the Webflow upload.
    throws('image with no base64 refused',
      () => writeSection(root, { name: 'y', dump, images: [{ name: 'a.png' }] }),
      /carried no data/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

section('backup — the gate that replaced the snapshot');
{
  const b = require('./lib/backup');
  const sess = (root) => pathm.join(root, 'queue', '_session.json');

  {
    const root = fixture({ 'queue/_config.json': CONFIG });

    // No session at all. Must not read as answered.
    check('before any session, unanswered', b.backupStatus(root).answered, false);

    b.startSession(root, { host: 'test' });
    check('a fresh session is unanswered', b.backupStatus(root).answered, false);
    check('and says why', /has not confirmed/.test(b.backupStatus(root).reason), true);

    b.record(root, 'confirmed');
    let st = b.backupStatus(root);
    check('confirmed is answered', st.answered, true);
    check('and remembers which answer', st.answer, 'confirmed');
    check('and when', typeof st.at === 'string' && st.at.length > 0, true);

    // A new session forgets it. A backup from an hour ago is not a backup for
    // this build, which is the entire point of scoping it to a session.
    b.startSession(root, { host: 'test' });
    check('a new session must be asked again', b.backupStatus(root).answered, false);

    b.record(root, 'skipped', 'in a hurry');
    st = b.backupStatus(root);
    check('skipped is answered too', st.answered, true);
    check('but distinguishable', st.answer, 'skipped');
    check('and keeps the reason', st.note, 'in a hurry');

    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    b.startSession(root, { host: 'test' });
    throws('an invented answer is refused', () => b.record(root, 'probably'), /must be one of/);
    throws('and so is nothing', () => b.record(root, ''), /must be one of/);
    check('and none of it counted', b.backupStatus(root).answered, false);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // The failure that matters: an unreadable session file must never read as
    // answered, because that would let a build start with no way back.
    const root = fixture({ 'queue/_config.json': CONFIG, 'queue/_session.json': '{ not json' });
    throws('a corrupt session file is refused, not ignored',
      () => b.backupStatus(root), /not valid JSON/);
    throws('and cannot be recorded into', () => b.record(root, 'confirmed'), /not valid JSON/);
    check('and it is left exactly as it was',
      fs.readFileSync(sess(root), 'utf8'), '{ not json');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // Recording must not lose what else the session carries.
    const root = fixture({ 'queue/_config.json': CONFIG });
    b.startSession(root, { host: 'pentool', startedBy: 'open' });
    b.record(root, 'confirmed');
    const raw = JSON.parse(fs.readFileSync(sess(root), 'utf8'));
    check('the session survives the answer', raw.host, 'pentool');
    check('including how it started', raw.startedBy, 'open');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({ 'queue/_config.json': CONFIG });
    throws('recording without a session is refused', () => b.record(root, 'confirmed'), /no session/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

section('unbuild — putting a finished section back');
{
  const { unbuild } = require('./lib/unbuild');
  const { resolve } = require('./lib/queue');

  const mk = (extra) => fixture(Object.assign({
    'queue/_config.json': CONFIG,
    'queue/pages/a.md': '---\npage: /a\nsections:\n  - shared\n---\n',
    'queue/pages/b.md': '---\npage: /b\nsections:\n  - shared\n---\n',
    'queue/_done/shared/section.md': sectionFile('name: shared\nbuild: static'),
    'queue/_state.json': JSON.stringify({
      components: { 'market-card': 'c1' }, assets: { abc: 'a1' },
      built: { '/a': ['shared'], '/b': ['shared'] }
    })
  }, extra));

  {
    const root = mk();
    const r = unbuild(root, 'shared', '/a');
    check('reports the page it forgot', r.pages, ['/a']);
    check('the finished copy comes back', fs.existsSync(pathm.join(root, 'queue/sections/shared/section.md')), true);
    check('and is gone from _done', fs.existsSync(pathm.join(root, 'queue/_done/shared')), false);

    const st = JSON.parse(fs.readFileSync(pathm.join(root, 'queue/_state.json'), 'utf8'));
    check('only that page forgets it', st.built['/b'], ['shared']);
    check('and the built list for it is dropped, not emptied', '/a' in st.built, false);

    // Forgetting these would make the next build create a second component and
    // re-upload every asset.
    check('component ids are kept', st.components, { 'market-card': 'c1' });
    check('asset ids are kept', st.assets, { abc: 'a1' });

    const by = {}; resolve(root).steps.forEach((x) => { by[x.page] = x.status; });
    check('queued again on the page it forgot', by['/a'], 'queued');
    check('still done on the page it did not', by['/b'], 'done');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // No page given: forget it everywhere.
    const root = mk();
    const r = unbuild(root, 'shared');
    check('forgets every page', r.pages.sort(), ['/a', '/b']);
    check('and the built map is empty',
      Object.keys(JSON.parse(fs.readFileSync(pathm.join(root, 'queue/_state.json'), 'utf8')).built).length, 0);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    /* Recaptured since it was built. The live copy is newer and authoritative,
       so the finished one must not land on top of it. */
    const root = mk({ 'queue/sections/shared/section.md': sectionFile('name: shared\nbuild: static\n# fresh') });
    const live = pathm.join(root, 'queue/sections/shared/section.md');
    const before = fs.readFileSync(live, 'utf8');
    const r = unbuild(root, 'shared');
    check('the live capture is untouched', fs.readFileSync(live, 'utf8'), before);
    check('the finished copy is trashed, not deleted', /_trash/.test(r.trashed || ''), true);
    check('and it still exists there', fs.existsSync(pathm.join(root, r.trashed)), true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    /* The log is the only record of what reached the live site, and leaving it
       in place would make the section read stalled forever. */
    const root = mk();
    fs.writeFileSync(pathm.join(root, 'queue/_done/shared/build-log.md'),
      'started 2026-08-22T10:00:00Z\ncreated .section_x\ndone 2026-08-22T10:05:00Z\n');
    const r = unbuild(root, 'shared');
    check('the log is archived', /build-log-.*\.md$/.test(r.logArchived || ''), true);
    check('and its contents survive',
      /created \.section_x/.test(fs.readFileSync(pathm.join(root, r.logArchived), 'utf8')), true);
    check('the live folder has no build-log.md left',
      fs.existsSync(pathm.join(root, 'queue/sections/shared/build-log.md')), false);
    const by = {}; resolve(root).steps.forEach((x) => { by[x.page] = x.status; });
    check('so it reads queued, not stalled', by['/a'], 'queued');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // There is no honest local undo for "you redefined a component everywhere".
    const root = fixture({
      'queue/_config.json': CONFIG,
      'queue/pages/a.md': '---\npage: /a\nsections:\n  - upd\n---\n',
      'queue/sections/upd/section.md': sectionFile('name: upd\nbuild: update\ncomponentId: c9'),
      'queue/_state.json': JSON.stringify({ components: {}, assets: {}, built: { '/a': ['upd'] } })
    });
    const before = fs.readFileSync(pathm.join(root, 'queue/_state.json'), 'utf8');
    throws('refuses a component update', () => unbuild(root, 'upd'), /nothing local to undo/);
    check('and changed nothing', fs.readFileSync(pathm.join(root, 'queue/_state.json'), 'utf8'), before);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = mk();
    throws('an unknown section is refused', () => unbuild(root, 'nope'), /no section named/);
    throws('and so is an empty name', () => unbuild(root, '  '), /which section/);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // Resetting it would strand every component and asset id in Webflow.
    const root = mk({ 'queue/_state.json': '{ not json' });
    throws('a corrupt _state.json is refused', () => unbuild(root, 'shared'), /not valid JSON/);
    check('and left exactly as it was',
      fs.readFileSync(pathm.join(root, 'queue/_state.json'), 'utf8'), '{ not json');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

section('edit — appending and removing sections');
{
  const e = require('./lib/edit');
  const M = '---\npage: /markets\nanchor: main-wrapper\nposition: append\nsections:\n  # the opener\n  - markets-grid\n  - cta-band\n---\n';

  check('append lands at the end', e.sectionOrder(e.appendSection(M, 'hero')),
    ['markets-grid', 'cta-band', 'hero']);
  check('append is idempotent', e.appendSection(M, 'cta-band'), M);
  check('append keeps the comment', /# the opener/.test(e.appendSection(M, 'hero')), true);

  const empty = e.newPageManifest('/new', {});
  check('a fresh manifest takes its first section', e.sectionOrder(e.appendSection(empty, 'a')), ['a']);
  check('and its defaults are written', /anchor: main-wrapper/.test(empty), true);

  check('remove drops just that one', e.sectionOrder(e.removeSection(M, 'markets-grid')), ['cta-band']);
  check('removing an absent section is a no-op', e.removeSection(M, 'nope'), M);
  check('remove keeps the surviving comment', /# the opener/.test(e.removeSection(M, 'cta-band')), true);
  check('removing the last one leaves the key', /sections:/.test(
    e.removeSection(e.removeSection(M, 'markets-grid'), 'cta-band')), true);
  throws('remove refuses an empty name', () => e.removeSection(M, '  '), /name is empty/);
}

section('queue — a recapture beats its finished copy');
{
  const { resolve } = require('./lib/queue');
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/p.md': '---\npage: /p\nsections:\n  - hero\n---\n',
    'queue/sections/hero/section.md': '---\nname: hero\n---\nwf: Section .fresh\n',
    'queue/_done/hero/section.md': '---\nname: hero\n---\nwf: Section .stale\n'
  });
  const r = resolve(root);
  // _done used to load last and overwrite the live copy, so a recaptured section
  // reported done and served the superseded markup with no sign of it.
  check('the live capture wins', [...r.sections.get('hero').classes], ['fresh']);
  check('and it is queued again, not reported done', r.steps[0].status, 'queued');
  fs.rmSync(root, { recursive: true, force: true });
}

section('queue — status and finished sections');
{
  const { resolve } = require('./lib/queue');
  const mk = (state) => fixture(Object.assign({
    'queue/_config.json': CONFIG,
    'queue/pages/p.md': '---\npage: /p\nsections:\n  - alpha\n  - beta\n  - gamma\n---\n',
    'queue/sections/alpha/section.md': sectionFile('name: alpha\nbuild: static'),
    'queue/sections/beta/section.md': sectionFile('name: beta\nbuild: static'),
    // gamma finished and was moved out of sections/ by the build skill
    'queue/_done/gamma/section.md': sectionFile('name: gamma\nbuild: static')
  }, state));

  {
    const root = mk({ 'queue/_state.json': JSON.stringify({ built: { '/p': ['alpha'] }, building: 'beta' }) });
    const r = resolve(root);
    const by = {}; r.steps.forEach((st) => { by[st.section] = st.status; });
    check('built on this page reads done', by.alpha, 'done');
    check('the section being built reads building', by.beta, 'building');
    check('a section moved to _done reads done', by.gamma, 'done');
    check('a finished section is not an error', errorsIn(r.problems).length, 0);
    check('and it still produces a step', r.steps.length, 3);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = mk({});
    const r = resolve(root);
    const by = {}; r.steps.forEach((st) => { by[st.section] = st.status; });
    check('with no state, unbuilt sections are queued', by.alpha, 'queued');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    /* Live status, derived from the log the build skill already writes. Before
       this, a section went queued straight to done and nothing moved for the
       minutes in between. */
    const root = mk({});
    const log = pathm.join(root, 'queue/sections/beta/build-log.md');
    const statusOf = () => {
      const by = {}; resolve(root).steps.forEach((st) => { by[st.section] = st.status; });
      return by;
    };

    check('no log at all is queued', statusOf().beta, 'queued');

    fs.writeFileSync(log, 'started 2026-08-22T10:00:00Z\nuploaded hero.png\n');
    check('a log being written reads building', statusOf().beta, 'building');
    check('and the last line is carried for display',
      resolve(root).steps.find((st) => st.section === 'beta').progress.note, 'uploaded hero.png');

    // A run that died. This used to read `queued` forever — the queue hiding the
    // one section that needed a human.
    const old = (Date.now() - 40 * 60 * 1000) / 1000;
    fs.utimesSync(log, old, old);
    check('an untouched log goes stalled', statusOf().beta, 'stalled');

    // Finished, but nothing recorded it: the gap a crash leaves between marking
    // built and moving to _done/.
    fs.appendFileSync(log, 'done 2026-08-22T10:09:00Z\n');
    const r2 = resolve(root);
    const by2 = {}; r2.steps.forEach((st) => { by2[st.section] = st.status; });
    check('a finished log alone does not claim done', by2.beta, 'queued');
    check('it warns instead', r2.problems.some((pr) =>
      pr.where === 'beta' && /says done but nothing recorded it/.test(pr.msg)), true);
    check('and that is a warning, not an error', errorsIn(r2.problems).length, 0);

    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // _state.json is the authority on done. A stale log cannot un-finish it.
    const root = mk({ 'queue/_state.json': JSON.stringify({ built: { '/p': ['beta'] } }) });
    fs.writeFileSync(pathm.join(root, 'queue/sections/beta/build-log.md'), 'started\nhalfway\n');
    const by = {}; resolve(root).steps.forEach((st) => { by[st.section] = st.status; });
    check('recorded built outranks a live log', by.beta, 'done');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // An unreadable log must never take the whole queue down with it.
    const { sectionProgress } = require('./lib/queue');
    check('a missing folder is just pending', sectionProgress('/nope/nowhere').state, 'pending');
    const root = mk({});
    fs.mkdirSync(pathm.join(root, 'queue/sections/alpha/build-log.md'));  // a directory, not a file
    check('resolve survives a log it cannot read', resolve(root).steps.length, 3);
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    // built on one page is not built on another
    const root = fixture({
      'queue/_config.json': CONFIG,
      'queue/pages/a.md': '---\npage: /a\nsections:\n  - shared\n---\n',
      'queue/pages/b.md': '---\npage: /b\nsections:\n  - shared\n---\n',
      'queue/sections/shared/section.md': sectionFile('name: shared\nbuild: static'),
      'queue/_state.json': JSON.stringify({ built: { '/a': ['shared'] }, building: null })
    });
    const r = resolve(root);
    const by = {}; r.steps.forEach((st) => { by[st.page] = st.status; });
    check('done on the page that built it', by['/a'], 'done');
    check('still queued on the page that did not', by['/b'], 'queued');
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = fixture({
      'queue/_config.json': CONFIG,
      'queue/pages/p.md': '---\npage: /p\nsections:\n  - broken\n---\n',
      'queue/sections/broken/section.md': sectionFile('name: broken\nbuild: update')
    });
    const r = resolve(root);
    check('a section with an error reads blocked', r.steps[0].status, 'blocked');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function refreshTests() {
  // section() inside, not at module load: these run later in the promise chain,
  // and a header printed at load appears nowhere near its own results.
  section('bridge — refresh delegates to the host');
  const { createBridge } = require('./lib/bridge');
  const root = fixture({ 'queue/_config.json': CONFIG });
  let called = 0;
  const b = createBridge({
    root, port: 8978, name: 'r',
    refresh: async () => { called++; return { ok: true, pages: 4, components: 2 }; }
  });
  await new Promise((r) => b.server.listen(8978, '127.0.0.1', r));
  try {
    const res = await fetch('http://127.0.0.1:8978/refresh', {
      method: 'POST', headers: { 'x-pentool-token': b.token }
    });
    const j = await res.json();
    check('the host is asked', called, 1);
    check('and its answer is passed back', [j.ok, j.pages, j.components], [true, 4, 2]);

    const un = await fetch('http://127.0.0.1:8978/refresh', { method: 'POST' });
    check('refresh still needs the token', un.status, 401);
    check('and an unauthorised call never reaches the host', called, 1);
  } finally {
    b.server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* ─────────────────── bridge: pairing and the read side ─────────────────── */
async function bridgeServerTests() {
  section('bridge — pairing and read endpoints');
  const { createBridge } = require('./lib/bridge');
  const root = fixture({
    'queue/_config.json': CONFIG,
    'queue/pages/markets.md': '---\npage: /markets\nanchor: main-wrapper\nposition: append\nsections:\n  - hero\n---\n',
    'queue/sections/hero/section.md': sectionFile('name: hero\nbuild: static'),
    'queue/_pages.json': JSON.stringify({ siteId: 'site123', fetchedAt: 'T', pages: [{ id: 'wp1', publishedPath: '/markets' }] }),
    'queue/_components.json': JSON.stringify({ siteId: 'site123', fetchedAt: 'T', components: [{ id: 'c1', name: 'market-card', group: 'GCE' }] })
  });
  const b = createBridge({ root, port: 8977, name: 'test-project' });
  await new Promise((r) => b.server.listen(8977, '127.0.0.1', r));
  const base = 'http://127.0.0.1:8977';
  const call = async (path, opts) => {
    const o = opts || {};
    const res = await fetch(base + path, {
      method: o.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json' },
        o.token ? { 'x-pentool-token': o.token } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, json, text };
  };

  try {
    check('health needs no token', (await call('/health')).json.ok, true);
    check('reads refuse without a token', (await call('/queue')).status, 401);

    // pairing
    const started = await call('/pair/start', { method: 'POST' });
    check('pair/start issues an id', /^[a-f0-9]{48}$/.test(started.json.pairId), true);
    check('pair/start issues NO token', started.json.token, undefined);
    const id = started.json.pairId;
    check('approval page renders the project', /test-project/.test((await call('/pair/' + id)).text), true);
    check('status is pending before approval', (await call('/pair/' + id + '/status')).json.pending, true);
    check('an unknown id does not list anything', (await call('/pair/' + 'f'.repeat(48))).status, 404);

    await call('/pair/' + id + '/approve', { method: 'POST' });
    const claimed = await call('/pair/' + id + '/status');
    check('approval hands over the token', claimed.json.token, b.token);
    check('and names the project', claimed.json.project, 'test-project');
    check('the pairing is single use', (await call('/pair/' + id + '/status')).status, 404);

    const T = b.token;
    check('hello reports the project', (await call('/hello', { method: 'POST', token: T })).json.project, 'test-project');
    check('pages come from the cache', (await call('/pages', { token: T })).json.pages.length, 1);
    check('components come from the cache', (await call('/components', { token: T })).json.components.length, 1);
    check('a CLI bridge says the cache is stale, not empty',
      (await call('/components', { token: T })).json.stale, true);
    check('queue serves the resolved plan', (await call('/queue', { token: T })).json.steps.length, 1);
    check('projects names the active one', (await call('/projects', { token: T })).json.active, 'test-project');
    check('unknown endpoints 404', (await call('/nope', { token: T })).status, 404);

    // The standalone CLI bridge holds no Webflow token, so it must say the app is
    // needed rather than pretend a refresh happened.
    const noHost = await call('/refresh', { method: 'POST', token: T });
    check('refresh without a host is refused', noHost.status, 501);
    check('and it names what is missing',
      /Pentool Studio App/.test(noHost.json.error), true);

    // a capture that targets a page and reuses a component
    const posted = await call('/section', { method: 'POST', token: T, body: {
      name: 'cta band', dump: 'frame "cta"\n  wf: Section .section_cta   [new]\n',
      svgs: [{ name: 'icon-1-arrow.svg', source: '<svg/>' }],
      target: { kind: 'section', page: '/markets' }
    }});
    check('section written', posted.json.section, 'cta-band');
    check('svg written as a file', posted.json.images.indexOf('icon-1-arrow.svg') >= 0, true);
    check('queued onto the page it named', posted.json.queuedOn, 'queue/pages/markets.md');
    const md = fs.readFileSync(pathm.join(root, 'queue/pages/markets.md'), 'utf8');
    check('the manifest gained it', /- cta-band/.test(md), true);
    check('a section stays a static build',
      /^build: static/m.test(fs.readFileSync(pathm.join(root, 'queue/sections/cta-band/section.md'), 'utf8')), true);

    // re-sending must not duplicate the manifest entry
    await call('/section', { method: 'POST', token: T, body: {
      name: 'cta band', force: true, dump: 'frame "cta"\n  wf: Section .section_cta   [new]\n',
      target: { page: '/markets' }
    }});
    const md2 = fs.readFileSync(pathm.join(root, 'queue/pages/markets.md'), 'utf8');
    check('re-sending does not duplicate the entry', (md2.match(/- cta-band/g) || []).length, 1);

    // a page capture creates its own manifest rather than joining one
    const pageRes = await call('/section', { method: 'POST', token: T, body: {
      name: 'about-hero', dump: 'frame "about"\n  wf: Section .section_about   [new]\n',
      target: { kind: 'page', page: '/about', createPage: true, title: 'About us' }
    }});
    check('a page capture makes its own manifest', pageRes.json.queuedOn, 'queue/pages/about.md');
    const pageMd = fs.readFileSync(pathm.join(root, 'queue/pages/about.md'), 'utf8');
    check('the manifest names the slug', /^page: \/about$/m.test(pageMd), true);
    check('and carries the title', /^title: About us$/m.test(pageMd), true);
    check('and is marked create_if_missing', /^create_if_missing: true$/m.test(pageMd), true);
    check('a page still builds as static markup',
      /^build: static/m.test(fs.readFileSync(pathm.join(root, 'queue/sections/about-hero/section.md'), 'utf8')), true);
    check('the planner accepts it',
      errorsIn(require('./lib/queue').resolve(root).problems).length, 0);

    // a section names a page that must already exist, so it must NOT create one
    await call('/section', { method: 'POST', token: T, body: {
      name: 'stray', dump: 'frame "s"\n  wf: Section .s   [new]\n',
      target: { kind: 'section', page: '/contact' }
    }});
    const strayMd = fs.readFileSync(pathm.join(root, 'queue/pages/contact.md'), 'utf8');
    check('a section does not mark a page create_if_missing',
      /create_if_missing/.test(strayMd), false);

    // A page capture can target a page that already exists. Inferring "create"
    // from the kind marked those create_if_missing too, which would have had the
    // builder try to make a page that was already there.
    await call('/section', { method: 'POST', token: T, body: {
      name: 'whole-home', dump: 'frame "h"\n  wf: Section .h   [new]\n',
      target: { kind: 'page', page: '/home', createPage: false }
    }});
    const homeMd = fs.readFileSync(pathm.join(root, 'queue/pages/home.md'), 'utf8');
    check('a page built into an existing page does not create one',
      /create_if_missing/.test(homeMd), false);
    check('and it is still placed there', /- whole-home/.test(homeMd), true);

    // Notes travel with the capture, where the build skill reads them.
    const noted = await call('/section', { method: 'POST', token: T, body: {
      name: 'with-notes', dump: 'frame "n"\n  wf: Section .section_n   [new]\n',
      notes: 'Use the dark CTA variant.\nKeep the existing headline copy.',
      target: { kind: 'section', page: '/markets' }
    }});
    check('the write reports notes were kept', noted.json.notes, true);
    const notedMd = fs.readFileSync(pathm.join(root, 'queue/sections/with-notes/section.md'), 'utf8');
    check('a Notes block is written', /^## Notes$/m.test(notedMd), true);
    check('with the prose intact', /Use the dark CTA variant\./.test(notedMd), true);
    check('and multi-line survives', /Keep the existing headline copy\./.test(notedMd), true);
    // It sits between the frontmatter and the dump, and must not disturb either.
    check('the notes come before the dump',
      notedMd.indexOf('## Notes') < notedMd.indexOf('wf: Section'), true);
    check('the planner still reads the classes',
      [...require('./lib/queue').resolve(root).sections.get('with-notes').classes].indexOf('section_n') >= 0, true);
    check('and raises no problem for it',
      require('./lib/queue').resolve(root).problems.filter((p) => p.where === 'with-notes').length, 0);

    // No notes means no empty heading left behind.
    await call('/section', { method: 'POST', token: T, body: {
      name: 'no-notes', dump: 'frame "x"\n  wf: Section .section_x   [new]\n',
      target: { kind: 'section', page: '/markets' }
    }});
    check('no notes writes no block',
      /## Notes/.test(fs.readFileSync(pathm.join(root, 'queue/sections/no-notes/section.md'), 'utf8')), false);

    // ── regressions from the review ──

    // A hand-edited manifest with no `sections:` used to abort the POST and throw
    // the dump away.
    fs.writeFileSync(pathm.join(root, 'queue/pages/broken.md'), '---\npage: /broken\n---\n');
    const salvaged = await call('/section', { method: 'POST', token: T, body: {
      name: 'salvage-me', dump: 'frame "x"\n  wf: Section .s   [new]\n',
      target: { kind: 'section', page: '/broken' }
    }});
    check('a bad manifest does not discard the capture', salvaged.json.ok, true);
    check('the dump is on disk',
      fs.existsSync(pathm.join(root, 'queue/sections/salvage-me/section.md')), true);
    check('and the failure is reported, not swallowed',
      /could not add it to/.test(salvaged.json.warning || ''), true);

    // Recapturing an update as a section must not leave the old componentId,
    // which the validator rejects as an error the user never made.
    await call('/section', { method: 'POST', token: T, body: {
      name: 'flip', dump: 'frame "f"\n  wf: DivBlock .f   [new]\n',
      target: { kind: 'update', component: { id: 'c9', name: 'thing' } }
    }});
    await call('/section', { method: 'POST', token: T, body: {
      name: 'flip', force: true, dump: 'frame "f"\n  wf: DivBlock .f   [new]\n',
      target: { kind: 'section' }
    }});
    const flip = fs.readFileSync(pathm.join(root, 'queue/sections/flip/section.md'), 'utf8');
    check('re-capturing as a section clears componentId', /componentId/.test(flip), false);
    check('and the build mode follows', /^build: static/m.test(flip), true);

    // Frontmatter with no build: line used to make an update build as a plain
    // static section, with the "needs a component" guard never firing.
    const nb = pathm.join(root, 'queue/sections/nobuild');
    fs.mkdirSync(nb, { recursive: true });
    fs.writeFileSync(pathm.join(nb, 'section.md'), '---\nname: nobuild\n---\nold\n');
    await call('/section', { method: 'POST', token: T, body: {
      name: 'nobuild', force: true, dump: 'frame "n"\n  wf: DivBlock .n   [new]\n',
      target: { kind: 'update', component: { id: 'c7', name: 'card' } }
    }});
    const nbMd = fs.readFileSync(pathm.join(nb, 'section.md'), 'utf8');
    check('an update writes its build mode even with no build: line',
      /^build: update/m.test(nbMd), true);
    check('and records the component', /^componentId: c7/m.test(nbMd), true);

    const noComp = await call('/section', { method: 'POST', token: T, body: {
      name: 'no-comp', dump: 'frame "n"\n  wf: DivBlock .n   [new]\n',
      target: { kind: 'update' }
    }});
    check('an update with no component is refused', noComp.status, 400);

    // update mode is a different build
    await call('/section', { method: 'POST', token: T, body: {
      name: 'card', dump: 'frame "card"\n  wf: DivBlock .card   [new]\n',
      target: { kind: 'update', page: '/markets', component: { id: 'c1', name: 'market-card' } }
    }});
    const cardMd = fs.readFileSync(pathm.join(root, 'queue/sections/card/section.md'), 'utf8');
    check('update mode sets build: update', /^build: update/m.test(cardMd), true);
    check('and records the component id', /^componentId: c1/m.test(cardMd), true);
    check('an update is not placed on a page',
      (fs.readFileSync(pathm.join(root, 'queue/pages/markets.md'), 'utf8').match(/- card/g) || []).length, 0);
  } finally {
    b.server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

wfTests().then(bridgeServerTests).then(refreshTests).then(() => {
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
});
