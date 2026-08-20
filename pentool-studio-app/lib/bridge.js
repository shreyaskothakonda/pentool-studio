// Local bridge: Pentool Studio POSTs a dump and its screenshots here, and they
// land directly in queue/sections/<name>/ instead of the clipboard and Downloads.
//
// Exported as a factory so both the CLI and the Pentool app can host it —
// the app needs the server object and the token to show status, which a
// module that starts listening on import cannot give it.
//
// Security posture — this writes files on POST, so it is deliberately narrow:
//   · binds 127.0.0.1 only, never 0.0.0.0
//   · requires a shared token; any page in your browser can reach localhost,
//     so the origin alone proves nothing
//   · section names are slugified and the resolved path must stay inside
//     queue/sections/
//   · refuses to overwrite an existing section unless force is set

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 8930;
const MAX_BODY = 64 * 1024 * 1024;

const slug = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function readToken(root) {
  const file = path.join(root, 'queue', '_bridge-token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const t = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}

// Resolves inside sectionsDir or throws — the guard against "../.." in a name.
function sectionDir(sectionsDir, name) {
  const s = slug(name);
  if (!s) throw new Error('name is empty after slugifying');
  const dir = path.resolve(sectionsDir, s);
  if (dir !== path.join(sectionsDir, s) || !dir.startsWith(sectionsDir + path.sep)) {
    throw new Error('name resolves outside queue/sections');
  }
  return { slug: s, dir };
}

function frontmatter(name, hasWf) {
  return [
    '---',
    `name: ${name}`,
    'build: static            # static | component',
    '# group: GCE             # component group, when build: component',
    '#',
    '# props:                 # only when build: component',
    '#   - name: Title',
    '#     type: textContent',
    '#     target: ' + name + '_title',
    '#',
    '# cms:',
    '#   collection: Markets',
    '#   element: ' + name + '_list',
    '#   bind:',
    '#     ' + name + '_title: name',
    '---',
    '',
    hasWf ? '' : '# NOTE: no "wf:" lines in this dump — was the target set to Webflow?\n'
  ].join('\n');
}

const safeAssetName = (n, fallback) => {
  const f = path.basename(String(n || fallback)).replace(/[^\w.\-]/g, '_');
  return (!f || f === '.' || f === '..') ? fallback : f;
};

// What the capture IS, written where the builder reads it.
//
//   section    static markup placed on a page
//   component  create the component once, place an instance per page
//   update     this frame replaces an existing component's definition — it is
//              not placed anywhere, because it changes the component everywhere
//
// Reuse is deliberately absent: instances of already-built components inside the
// capture are referenced automatically during the walk. It was never a property
// of the captured frame.
// A page is still static markup — what differs is where it lands: a manifest of
// its own, marked create_if_missing, rather than appended to a page that exists.
const KINDS = { section: 'static', page: 'static', component: 'component', update: 'update' };

function applyKind(head, kind, comp) {
  const build = KINDS[kind] || 'static';
  if (build === 'update' && (!comp || !comp.id)) {
    throw new Error('an update needs the component it replaces');
  }

  // Preserved frontmatter from an earlier capture may carry a build: line, a
  // componentId, both or neither. Rewriting only what is found meant:
  //   · no build: line   -> an update silently became a plain static section
  //   · a stale id       -> re-capturing as a section left componentId behind,
  //                         which the validator then rejects as an error the
  //                         user never made
  // So this owns both keys outright: strip them, then write what this kind needs.
  const lines = head.split('\n')
    .filter((l) => !/^build:/.test(l) && !/^componentId:/.test(l) && !/^componentName:/.test(l));

  const out = [];
  let placed = false;
  for (const line of lines) {
    out.push(line);
    if (!placed && /^name:/.test(line)) {
      out.push('build: ' + build);
      if (build === 'update') {
        out.push('componentId: ' + comp.id);
        out.push('componentName: ' + (comp.name || ''));
      }
      placed = true;
    }
  }
  // No name: line to anchor to — put it directly after the opening fence.
  if (!placed) {
    const at = out[0] === '---' ? 1 : 0;
    const ins = ['build: ' + build];
    if (build === 'update') {
      ins.push('componentId: ' + comp.id, 'componentName: ' + (comp.name || ''));
    }
    out.splice(at, 0, ...ins);
  }
  return out.join('\n');
}

// Put the section on a page, creating the manifest when the page is new.
// Returns the manifest path, or null when nothing changed.
function addToPage(root, pageSlug, sectionName, opts) {
  const edit = require('./edit');
  const o = opts || {};
  const slug = String(pageSlug).trim();
  if (!slug) return null;

  const file = path.join(root, 'queue', 'pages',
    (slug.replace(/^\/+/, '').replace(/[^\w.\-]/g, '-') || 'index') + '.md');

  let text;
  if (fs.existsSync(file)) {
    text = fs.readFileSync(file, 'utf8');
  } else {
    let defaults = {};
    try { defaults = JSON.parse(fs.readFileSync(path.join(root, 'queue', '_config.json'), 'utf8')); }
    catch (e) { /* no config — the defaults in newPageManifest still apply */ }
    text = edit.newPageManifest(slug, {
      anchor: defaults.defaultAnchor, position: defaults.defaultPosition,
      title: o.title, createIfMissing: o.createIfMissing
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  fs.writeFileSync(file, edit.appendSection(text, sectionName));
  return path.relative(root, file);
}

// Pure enough to test: given a root and a payload, write the section and
// report what happened. Exported so the app can reuse it without HTTP.
function writeSection(root, payload) {
  const sectionsDir = path.join(root, 'queue', 'sections');
  const { slug: name, dir } = sectionDir(sectionsDir, payload.name);
  const exists = fs.existsSync(dir);
  if (exists && !payload.force) {
    const e = new Error(`section "${name}" already exists — re-send with force to replace it`);
    e.code = 'exists';
    throw e;
  }

  const dump = String(payload.dump || '');
  if (!dump.trim()) throw new Error('dump is empty');
  const hasWf = /^\s*wf:/m.test(dump);

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'section.md');

  // Preserve hand-written frontmatter across a re-send; only the dump refreshes.
  let head = frontmatter(name, hasWf);
  if (exists && fs.existsSync(file)) {
    const prev = fs.readFileSync(file, 'utf8');
    const end = prev.indexOf('\n---', 3);
    if (/^---\s*\n/.test(prev) && end !== -1) head = prev.slice(0, end + 4) + '\n';
  }

  // The plugin picked a Webflow page and/or component: record it where the
  // builder looks, and put the section on that page in build order.
  const target = payload.target || {};
  if (target.kind) head = applyKind(head, target.kind, target.component);

  /* Anything the designer typed alongside the capture. It goes between the
     frontmatter and the dump, where the build skill reads it before deciding
     anything — a variant to use, copy to keep, something the design cannot say
     on its own.

     A block rather than a frontmatter key: notes are prose and often several
     lines, which the strict YAML subset would either mangle or reject. It is
     inert to the parser — classesInDump and reusedComponents only look for
     `wf:` lines — so it costs the pipeline nothing. */
  const notes = String(payload.notes || '').trim();
  const noteBlock = notes ? '## Notes\n\n' + notes + '\n\n' : '';

  // The capture is written FIRST. Placing it on a page can fail — a hand-edited
  // manifest missing its `sections:` key throws — and doing that first meant the
  // POST aborted with the dump discarded and an empty folder left behind. The
  // capture is the irreplaceable half; the manifest edit can be retried.
  fs.writeFileSync(file, head + noteBlock + dump.replace(/\s*$/, '') + '\n');

  // An update is not placed on a page — it changes the component wherever it is
  // already used — so a page target is ignored rather than quietly creating a
  // manifest entry that would build the same thing a second time.
  let queuedOn = null;
  let queueError = null;
  if (target.page && target.kind !== 'update') {
    try {
      queuedOn = addToPage(root, target.page, name, {
        title: target.title,
        // Explicit, not inferred from the kind. A page capture can just as well
        // land on a page that already exists, and inferring "create" from the
        // kind marked those create_if_missing too. Only an explicit request
        // creates, so a mistyped slug still fails loudly instead of conjuring a
        // page nobody asked for.
        createIfMissing: target.kind === 'page' && target.createPage === true
      });
    } catch (e) {
      queueError = `saved, but could not add it to ${target.page}: ${e.message}`;
    }
  }

  const written = [];

  // SVG sources arrive as files rather than inlined in the dump — the text only
  // carries the "-> SVG #n" reference, which is what keeps it under the ceiling.
  for (const sv of payload.svgs || []) {
    const fname = safeAssetName(sv.name, 'icon.svg');
    const body = String(sv.source || '');
    if (!body.trim()) throw new Error(`svg "${fname}" carried no source`);
    const adir = path.join(dir, 'assets');
    fs.mkdirSync(adir, { recursive: true });
    fs.writeFileSync(path.join(adir, fname), body);
    written.push(fname);
  }

  for (const img of payload.images || []) {
    const fname = safeAssetName(img.name, 'image.png');
    // A missing or undecodable base64 would otherwise land as a 0-byte PNG that
    // still reports as written, and only fails much later at the Webflow upload.
    const bytes = Buffer.from(String(img.base64 || ''), 'base64');
    if (!bytes.length) {
      throw new Error(`image "${fname}" carried no data — expected a base64 field`);
    }
    const adir = path.join(dir, 'assets');
    fs.mkdirSync(adir, { recursive: true });
    fs.writeFileSync(path.join(adir, fname), bytes);
    written.push(fname);
  }

  return {
    ok: true,
    section: name,
    path: path.relative(root, file),
    images: written,
    queuedOn: queuedOn,
    queueError: queueError,
    notes: !!notes,
    replaced: exists,
    warning: queueError || (hasWf ? null : 'no "wf:" lines — nothing here can be built')
  };
}

/* ═════════════════════════════════ pairing ═════════════════════════════════
   Replaces copying a token by hand. The plugin asks for a pairing, opens the
   approval URL in a browser, and polls until a human approves it there.

   /pair/start has to be unauthenticated — there is no token yet, which is the
   whole point. What keeps it honest:
     · it issues no token, only a high-entropy id
     · that id is the approval URL, so only its holder can reach the page
     · it expires after two minutes
     · /status hands the token over exactly once, then forgets the pairing
     · concurrent pairings are capped, so it cannot be used to churn ids

   Approval grants the bridge token, not a per-pairing one. One bridge serves one
   project, so every token would confer identical access — minting more would add
   a token store without adding a boundary. */

const PAIR_TTL = 120000;
const MAX_PENDING = 8;

function makePairings() {
  const byId = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [id, p] of byId) if (now - p.at > PAIR_TTL) byId.delete(id);
  };
  return {
    start() {
      sweep();
      if (byId.size >= MAX_PENDING) throw new Error('too many pairing attempts in flight');
      const id = crypto.randomBytes(24).toString('hex');
      byId.set(id, { at: Date.now(), approved: false });
      return id;
    },
    get(id) { sweep(); return byId.get(id) || null; },
    approve(id) {
      sweep();
      const p = byId.get(id);
      if (!p) return false;
      p.approved = true;
      return true;
    },
    // Single use: the token leaves exactly once, so a second reader gets nothing.
    claim(id) {
      sweep();
      const p = byId.get(id);
      if (!p || !p.approved) return null;
      byId.delete(id);
      return p;
    },
    size() { sweep(); return byId.size; }
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Served to a real browser, so it carries its own styles and no external assets.
function approvalPage(opts) {
  const project = esc(opts.project);
  const root = esc(opts.root);
  const done = opts.approved;
  return `<!doctype html><meta charset="utf-8"><title>Connect Figma to Pentool</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --mut:#666; --bd:#e5e5e5; --brand:#0d99ff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1e1e1e; --fg:#eee; --mut:#999; --bd:#3a3a3a; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,sans-serif; }
  .card { width:min(420px,92vw); border:1px solid var(--bd); border-radius:12px; padding:28px; }
  h1 { font-size:17px; margin:0 0 6px; }
  p { color:var(--mut); margin:0 0 20px; }
  .proj { border:1px solid var(--bd); border-radius:8px; padding:12px 14px; margin-bottom:20px; }
  .proj b { display:block; font-size:15px; }
  .proj code { color:var(--mut); font-size:11px; word-break:break-all; }
  button { font:inherit; font-weight:600; padding:10px 18px; border:none; border-radius:8px;
           background:var(--brand); color:#fff; cursor:pointer; width:100%; }
  button:disabled { opacity:.5; cursor:default; }
  .ok { color:#14ae5c; font-weight:600; }
  .note { font-size:12px; color:var(--mut); margin-top:16px; }
</style>
<div class="card">
  <h1>Connect Figma to Pentool</h1>
  <p>Figma is asking to send captured sections into this project.</p>
  <div class="proj"><b>${project}</b><code>${root}</code></div>
  ${done
    ? '<p class="ok">Connected. You can close this tab and go back to Figma.</p>'
    : `<button id="go">Connect</button>
       <p class="note">Only approve this if you just clicked <b>Connect this file</b> in Figma.
       To send to a different project, switch projects in Pentool first.</p>
       <script>
         document.getElementById('go').onclick = async function () {
           this.disabled = true; this.textContent = 'Connecting…';
           await fetch(location.pathname + '/approve', { method: 'POST' });
           location.reload();
         };
       <\/script>`}
</div>`;
}

function sendHtml(res, code, html) {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html)
  });
  res.end(html);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-pentool-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

/**
 * Build the bridge. Does not listen — call `.listen()` on the returned server,
 * or use `start()` for the common case.
 *
 * @param {{root: string, port?: number, onWrite?: Function, onError?: Function}} opts
 * @returns {{server: import('http').Server, token: string, port: number, root: string}}
 */
function createBridge(opts) {
  const root = opts.root;
  const port = opts.port || DEFAULT_PORT;
  const token = readToken(root);
  const name = opts.name || path.basename(root);
  const onWrite = opts.onWrite || (() => {});
  const onError = opts.onError || (() => {});
  const pairings = makePairings();

  // Cache only. Refreshing needs the Webflow token, which lives in the app — the
  // standalone CLI bridge has no way to fetch, so it says so rather than
  // returning an empty list that would read as "this site has no components".
  const canRefresh = !!opts.refresh;
  const cached = () => {
    let pages = [], components = [], fetchedAt = null;
    try {
      const wf = require('./webflow');
      const pc = wf.readPagesCache(root), cc = wf.readComponentsCache(root);
      pages = pc.pages || []; components = cc.components || [];
      fetchedAt = pc.fetchedAt || cc.fetchedAt || null;
    } catch (e) { /* older project without the webflow lib */ }
    return {
      pages, components, fetchedAt,
      stale: !canRefresh,
      reason: canRefresh ? null : 'no Webflow token outside the Pentool app — showing the cache'
    };
  };

  const listKnown = () => {
    try { return opts.listProjects ? opts.listProjects() : []; }
    catch (e) { return []; }
  };

  const tokenOk = (given) => {
    if (!given) return false;
    const a = Buffer.from(String(given));
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const given = req.headers['x-pentool-token'] || url.searchParams.get('token');

    const p = url.pathname;

    if (p === '/health') {
      return send(res, 200, { ok: true, service: 'pentool-bridge', authed: tokenOk(given) });
    }

    /* ── pairing: unauthenticated by necessity, guarded by the id ── */

    if (p === '/pair/start' && req.method === 'POST') {
      try { const id = pairings.start();
        return send(res, 200, { pairId: id, approveUrl: `http://localhost:${port}/pair/${id}` });
      } catch (e) { return send(res, 429, { ok: false, error: e.message }); }
    }

    const pair = /^\/pair\/([a-f0-9]{48})(\/approve|\/status)?$/.exec(p);
    if (pair) {
      const id = pair[1], sub = pair[2];
      // An unknown or expired id must not reveal anything, least of all the
      // project list — otherwise the page doubles as an enumeration oracle.
      const rec = pairings.get(id);

      if (!sub) {
        if (!rec) return sendHtml(res, 404, '<!doctype html><meta charset="utf-8">' +
          '<p style="font:14px system-ui;padding:2rem">This link has expired. ' +
          'Press <b>Connect this file</b> in Figma again.</p>');
        return sendHtml(res, 200, approvalPage({ project: name, root, approved: rec.approved }));
      }
      if (sub === '/approve' && req.method === 'POST') {
        return send(res, pairings.approve(id) ? 200 : 404, { ok: !!rec });
      }
      if (sub === '/status') {
        if (!rec) return send(res, 404, { ok: false, error: 'unknown or expired pairing' });
        if (!rec.approved) return send(res, 200, { pending: true });
        pairings.claim(id);
        return send(res, 200, { ok: true, token: token, project: name });
      }
    }

    /* ── everything below needs the token ── */

    if (!tokenOk(given)) return send(res, 401, { ok: false, error: 'bad or missing token' });

    if (p === '/hello' && req.method === 'POST') {
      const wf = cached();
      const cfg = (() => {
        try { return JSON.parse(fs.readFileSync(path.join(root, 'queue', '_config.json'), 'utf8')); }
        catch (e) { return {}; }
      })();
      return send(res, 200, {
        ok: true, project: name, root: root, queue: 'queue/sections',
        // The plugin used to assert a hardcoded site name in every dump. Now it
        // states the project's own, or says nothing.
        site: cfg.siteName || null, siteId: cfg.siteId || null,
        // The class inventory, built components and size scales this site
        // actually uses. Without it the plugin marks [existing] against whatever
        // style guide it happened to ship with, which is right for exactly one site.
        styleGuide: cfg.styleGuide || null,
        webflow: { pages: wf.pages.length, components: wf.components.length,
                   fetchedAt: wf.fetchedAt, stale: wf.stale, reason: wf.reason }
      });
    }

    if (p === '/refresh' && req.method === 'POST') {
      // Only the host can do this — it holds the Webflow token. The standalone
      // CLI bridge has none, so it says so rather than silently doing nothing.
      if (!opts.refresh) {
        return send(res, 501, { ok: false, error: 'refresh needs the Pentool Studio App' });
      }
      Promise.resolve()
        .then(() => opts.refresh())
        .then((r) => send(res, r && r.ok ? 200 : 400, r || { ok: false, error: 'refresh failed' }))
        .catch((e) => send(res, 400, { ok: false, error: e.message }));
      return;
    }

    if (p === '/pages' && req.method === 'GET') {
      const wf = cached();
      return send(res, 200, { pages: wf.pages, fetchedAt: wf.fetchedAt,
                              stale: wf.stale, reason: wf.reason });
    }

    if (p === '/components' && req.method === 'GET') {
      const wf = cached();
      return send(res, 200, { components: wf.components, fetchedAt: wf.fetchedAt,
                              stale: wf.stale, reason: wf.reason });
    }

    if (p === '/queue' && req.method === 'GET') {
      try {
        const r = require('./queue').resolve(root);
        return send(res, 200, { steps: r.steps, problems: r.problems, project: name });
      } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
    }

    if (p === '/projects' && req.method === 'GET') {
      return send(res, 200, { active: name, root: root, projects: listKnown() });
    }

    if (p !== '/section' || req.method !== 'POST') {
      return send(res, 404, { ok: false, error: 'no such endpoint' });
    }

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(res, 413, { ok: false, error: 'body too large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (e) { return send(res, 400, { ok: false, error: 'body is not valid JSON' }); }
      try {
        const result = writeSection(root, payload);
        onWrite(result);
        send(res, 200, result);
      } catch (e) {
        onError(e);
        send(res, e.code === 'exists' ? 409 : 400, { ok: false, error: e.message });
      }
    });
  });

  return { server, token, port, root };
}

/**
 * createBridge plus listen, with the port-in-use case reported usefully rather
 * than as an unhandled stack trace.
 * @returns {Promise<{server, token, port, root}>}
 */
function start(opts) {
  const bridge = createBridge(opts);
  return new Promise((resolve, reject) => {
    bridge.server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        err.friendly = `port ${bridge.port} is already in use — ` +
          `something else is listening on 127.0.0.1:${bridge.port}`;
      }
      reject(err);
    });
    bridge.server.listen(bridge.port, '127.0.0.1', () => resolve(bridge));
  });
}

module.exports = { createBridge, start, writeSection, slug, sectionDir, DEFAULT_PORT };
