// Zero-dependency test runner for the app layer. `node test.js`
const http = require('http');
const fs = require('fs');
const pathm = require('path');
const { pickRelease, compareVersions } = require('./update');

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
function section(name) { console.log('\n' + name); }

/* ───────────────────────── compareVersions ───────────────────────── */
section('update — comparing versions');
check('newer patch',            compareVersions('0.1.1', '0.1.0'),  1);
check('older patch',            compareVersions('0.1.0', '0.1.1'), -1);
check('equal',                  compareVersions('0.1.0', '0.1.0'),  0);
check('minor outranks patch',   compareVersions('0.2.0', '0.1.9'),  1);
check('major outranks minor',   compareVersions('1.0.0', '0.9.9'),  1);
check('10 is not less than 9',  compareVersions('0.10.0', '0.9.0'), 1);
check('a v prefix is ignored',  compareVersions('v0.2.0', '0.1.0'), 1);
check('both prefixed',          compareVersions('v1.0.0', 'v1.0.0'), 0);
check('short equals padded',    compareVersions('2.1', '2.1.0'),    0);
check('short vs longer',        compareVersions('2.1', '2.1.1'),   -1);
check('four fields',            compareVersions('1.0.0.2', '1.0.0.1'), 1);
// A malformed field sorts as 0 rather than NaN, so junk can never outrank a
// real version and quietly push out a bogus update.
check('junk field sorts as 0',  compareVersions('1.x.0', '1.0.0'),  0);
check('empty is not newer',     compareVersions('', '0.1.0'),      -1);
check('null is not newer',      compareVersions(null, '0.1.0'),    -1);

/* ─────────────────── markdown: rendering agent output ───────────────────
   The panel renders what a model wrote while quoting files, shell output and
   web pages, into a window that holds the IPC bridge. Every case here is a way
   that text could stop being text. */
section('markdown — agent output cannot become markup');
{
  // The renderer lives in the browser half, so it is loaded the way the page
  // loads it: source between its two markers, evaluated on its own.
  const src = fs.readFileSync(pathm.join(__dirname, 'renderer', 'app.js'), 'utf8');
  const slice = src.slice(src.indexOf('function mdEscape'), src.indexOf('function msgEl'));
  const md = {};
  new Function('exports', slice + '\nexports.renderMarkdown = renderMarkdown;')(md);
  const R = md.renderMarkdown;

  const hasLiveTag = (html, tag) => new RegExp('<' + tag + '[\\s>]', 'i').test(html);

  check('script tags are inert', hasLiveTag(R('<script>alert(1)</script>'), 'script'), false);
  check('img onerror is inert',  hasLiveTag(R('<img src=x onerror=alert(1)>'), 'img'), false);
  check('and shown as text',     /&lt;script&gt;/.test(R('<script>x</script>')), true);

  /* The one that was real. The href character class allowed a double quote, so
     a URL closed the attribute early and opened an event handler after it. */
  const broke = R('[x](https://a.com/"onmouseover="alert1")');
  check('a quote cannot close the href', /onmouseover="/.test(broke), false);
  check('it is encoded instead', /&quot;onmouseover/.test(broke), true);
  check('single quotes too',
    /onmouseover=&#39;/.test(R("[x](https://a.com/'onmouseover='alert1')")), true);

  // Only http(s) reaches an anchor.
  check('javascript: is not a link', /<a /.test(R('[x](javascript:alert(1))')), false);
  check('data: is not a link', /<a /.test(R('[x](data:text/html,<script>alert(1)</script>)')), false);

  // Nothing may put markup inside an attribute, by any route.
  const attrs = R('[a](https://a.com/`c`) [b](https://b.com/<i>) [c](https://c.com/"q")');
  check('no markup ever lands inside an href', /href="[^"]*[<>]/.test(attrs), false);

  // ...while ordinary links still work.
  const ok = R('see [the release](https://github.com/x/y?a=1&b=2)');
  check('a real link is still a link', /<a href="https:\/\/github.com\/x\/y\?a=1&amp;b=2"/.test(ok), true);
  check('with noreferrer', /rel="noreferrer"/.test(ok), true);

  // Formatting the panel exists to render.
  check('tables become tables', /<table>.*<th>Page<\/th>/.test(R('| Page |\n|---|\n| a |')), true);
  check('fences become blocks', /<pre><code>/.test(R('```\nls -la\n```')), true);
  check('html inside a fence is escaped', /&lt;div&gt;/.test(R('```\n<div>\n```')), true);
  check('headings are demoted, not h1', /<h[34]>/.test(R('# Title')), true);
  check('a glob in code is not emphasis', /<code>ls \*\*\/\*.md<\/code>/.test(R('run `ls **/*.md`')), true);
  check('bold is bold', /<strong>x<\/strong>/.test(R('**x**')), true);
}

/* ────────────────────────── pickRelease ────────────────────────── */
section('update — choosing a release');
const dmg = { name: 'Pentool-0.2.0-arm64.dmg', browser_download_url: 'https://example.test/p.dmg' };
const rel = (over) => Object.assign({
  tag_name: 'v0.2.0', body: 'Fixes the terminal.', assets: [dmg],
  html_url: 'https://example.test/releases/tag/v0.2.0'
}, over || {});

check('a newer release is offered', pickRelease(rel(), '0.1.0'), {
  version: '0.2.0', notes: 'Fixes the terminal.',
  url: 'https://example.test/p.dmg', page: 'https://example.test/releases/tag/v0.2.0'
});
check('the running version is not', pickRelease(rel(), '0.2.0'), null);
check('an older release is not',    pickRelease(rel({ tag_name: 'v0.0.9' }), '0.1.0'), null);
check('a draft is never offered',   pickRelease(rel({ draft: true }), '0.1.0'), null);

// The one that matters: a build that failed halfway through publishing leaves a
// release with no DMG. Offering a download that 404s is worse than silence.
check('no DMG attached → nothing', pickRelease(rel({ assets: [] }), '0.1.0'), null);
check('only a zip → nothing',
  pickRelease(rel({ assets: [{ name: 'Pentool.zip', browser_download_url: 'https://x.test/z' }] }), '0.1.0'), null);
check('an asset with no url → nothing',
  pickRelease(rel({ assets: [{ name: 'a.dmg' }] }), '0.1.0'), null);
check('the DMG is found among others', pickRelease(rel({
  assets: [{ name: 'Pentool.zip', browser_download_url: 'https://x.test/z' }, dmg]
}), '0.1.0').url, 'https://example.test/p.dmg');
check('uppercase extension still counts', pickRelease(rel({
  assets: [{ name: 'Pentool.DMG', browser_download_url: 'https://x.test/u' }]
}), '0.1.0').url, 'https://x.test/u');

check('no tag → nothing',      pickRelease(rel({ tag_name: '' }), '0.1.0'), null);
check('empty body is empty',   pickRelease(rel({ body: null }), '0.1.0').notes, '');
check('missing html_url falls back to the releases page',
  pickRelease(rel({ html_url: undefined }), '0.1.0').page,
  'https://github.com/shreyaskothakonda/pentool-studio/releases');
check('null payload',          pickRelease(null, '0.1.0'), null);
check('a string payload',      pickRelease('nope', '0.1.0'), null);
check('an array payload',      pickRelease([], '0.1.0'), null);
check('assets not a list',     pickRelease(rel({ assets: 'x' }), '0.1.0'), null);

/* ──────────────────────────── check() ───────────────────────────
   Its whole contract is that it never throws and never rejects: a laptop is
   offline as a matter of course, and an update check that surfaces an error
   has made the app worse. Each case is driven against a real local server. */
section('update — check() survives everything');

// The module's URL is fixed, so exercise the same code against a stub host by
// re-requiring it with the API pointed at a local server.
function checkAgainst(port, path, current) {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'update.js'), 'utf8')
    .replace("const https = require('https');", "const https = require('http');")
    .replace(/const API = [^;]+;/, `const API = 'http://127.0.0.1:${port}${path}';`);
  const m = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', src)(m, m.exports, require, __dirname);
  return m.exports.check(current);
}

function serve(handler) {
  return new Promise((res) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const server = await serve((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(rel()));
    }
    if (req.url === '/500')      { res.writeHead(500); return res.end('boom'); }
    if (req.url === '/garbage')  { res.writeHead(200); return res.end('<html>not json'); }
    if (req.url === '/empty')    { res.writeHead(200); return res.end(''); }
    if (req.url === '/cut')      { res.writeHead(200); res.write('{"tag_'); return req.socket.destroy(); }
    if (req.url === '/huge')     { res.writeHead(200); return res.end('{"x":"' + 'a'.repeat(600 * 1024) + '"}'); }
    res.writeHead(404); res.end();
  });
  const port = server.address().port;

  check('a good payload comes back', (await checkAgainst(port, '/ok', '0.1.0')).version, '0.2.0');
  check('a 500 is silence',          await checkAgainst(port, '/500', '0.1.0'), null);
  check('garbage is silence',        await checkAgainst(port, '/garbage', '0.1.0'), null);
  check('an empty body is silence',  await checkAgainst(port, '/empty', '0.1.0'), null);
  check('a cut connection is silence', await checkAgainst(port, '/cut', '0.1.0'), null);
  check('an oversized body is silence', await checkAgainst(port, '/huge', '0.1.0'), null);
  check('a 404 is silence',          await checkAgainst(port, '/nope', '0.1.0'), null);

  server.close();

  // Nothing listening at all — the offline case, and the commonest one.
  check('a refused connection is silence', await checkAgainst(port, '/ok', '0.1.0'), null);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
