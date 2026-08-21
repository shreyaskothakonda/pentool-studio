// Pentool — main process.
//
// Hosts three things and owns no build logic of its own:
//   · the bridge, in process, so Figma can post sections straight in
//   · the queue, resolved by lib/queue.js and re-read whenever files change
//   · one interactive `claude` in a pty — your subscription, your MCP, your skills
//
// Build progress is read from the filesystem (_state.json, build-log.md), never
// scraped from the agent's output. That is what keeps the dashboard correct when
// output formatting changes.


const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./update');

/* Where the pipeline lives.
   Running from source it is the parent directory. Packaged, __dirname is inside
   app.asar, so the app must be told — remembered between launches, asked for on
   first run. Getting this wrong ships a .app that silently finds no queue. */

const ROOT_MEMO = () => path.join(app.getPath('userData'), 'root.json');

function rememberedRoot() {
  try { return JSON.parse(fs.readFileSync(ROOT_MEMO(), 'utf8')).root || null; }
  catch (e) { return null; }
}
function rememberRoot(dir) {
  try { fs.writeFileSync(ROOT_MEMO(), JSON.stringify({ root: dir }, null, 2)); }
  catch (e) { /* not fatal — we just ask again next launch */ }
}
const looksLikePipeline = (dir) =>
  !!dir && fs.existsSync(path.join(dir, 'queue')) && fs.existsSync(path.join(dir, 'lib', 'queue.js'));

// Which project to resume, if any. Deliberately non-blocking and allowed to
// return null: the window opens on the project list either way, so a deleted
// folder is a row you can forget rather than an error box before any UI exists.
function resumeRoot() {
  if (process.env.PENTOOL_ROOT && looksLikePipeline(process.env.PENTOOL_ROOT)) {
    return process.env.PENTOOL_ROOT;
  }
  const memo = rememberedRoot();
  return looksLikePipeline(memo) ? memo : null;
}

/* ─────────────────────────── projects & settings ─────────────────────────── */

/* Small, local, and never fatal. Everything a project IS already lives in its
   own folder; this is only how the window was left — size, position, and which
   way the agent was running. Losing it costs a resize, so every read and write
   swallows its own errors rather than blocking a launch. */
const UI_STATE = () => path.join(app.getPath('userData'), 'ui.json');

function readUi() {
  try { return JSON.parse(fs.readFileSync(UI_STATE(), 'utf8')); }
  catch (e) { return {}; }
}
let uiWriteTimer = null;
function writeUi(patch) {
  const next = Object.assign(readUi(), patch);
  // Dragging a window fires continuously; one write per burst is plenty.
  clearTimeout(uiWriteTimer);
  uiWriteTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(UI_STATE()), { recursive: true });
      fs.writeFileSync(UI_STATE(), JSON.stringify(next, null, 2) + '\n');
    } catch (e) { /* not fatal — the window just opens where it defaults to */ }
  }, 400);
}

const REGISTRY = () => path.join(app.getPath('userData'), 'projects.json');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');

// Where a new project's lib/, bin/ and skills are copied from. Packaged, they
// ride along in extraResources; from source they are the repo itself.
const templateRoot = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'));

function projectLib() {
  return require(path.join(templateRoot(), 'lib', 'project'));
}

/* ── Webflow tokens, one per site ──────────────────────────────────────────
   Keyed by siteId rather than by project, because a Webflow Site API token is
   scoped to a site: two projects pointed at the same site want the same token,
   and a token is meaningless anywhere else.

   Stored in userData, never in the project folder — a project stays safe to
   commit or hand to someone else. safeStorage puts it behind the Keychain; the
   plain fallback is flagged so the UI can say the difference out loud. */

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')); }
  catch (e) { return {}; }
}
function writeSettings(next) {
  fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true });
  fs.writeFileSync(SETTINGS(), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}

const decrypt = (rec) => {
  if (!rec || !rec.value) return null;
  if (!rec.encrypted) return rec.value;
  try { return safeStorage.decryptString(Buffer.from(rec.value, 'base64')); }
  catch (e) { return null; }   // keychain denied, or a different machine
};
const encrypt = (token) => {
  const can = safeStorage.isEncryptionAvailable();
  return { value: can ? safeStorage.encryptString(token).toString('base64') : token, encrypted: can };
};

function getToken(siteId) {
  const st = readSettings();
  const tokens = st.tokens || {};
  const direct = siteId ? decrypt(tokens[siteId]) : null;
  if (direct) return direct;
  // A single global token from before tokens were per-site. Kept as a fallback so
  // an existing setup keeps working; the first per-site save supersedes it.
  return decrypt(st.webflowToken ? { value: st.webflowToken, encrypted: !!st.encrypted } : null);
}

function setToken(siteId, token) {
  const st = readSettings();
  st.tokens = st.tokens || {};
  if (!siteId) return false;
  if (!token) { delete st.tokens[siteId]; writeSettings(st); return true; }
  st.tokens[siteId] = encrypt(token);
  writeSettings(st);
  return !!st.tokens[siteId].encrypted;
}

// The token for whatever project is open.
const activeToken = () => getToken(config().siteId);

// A project owns frozen copies of lib/ and bin/, taken when it was created. That
// means a fix here never reaches a project made before it — the planner in an old
// project would silently lack status, or _done support, and look broken instead
// of stale. Re-sync the tooling whenever a project is activated.
/* Is the MCP server this project builds through actually configured, and at a
   scope that needs no per-project approval?

   User scope is the right home for it: added once, every project uses it, and
   Claude Code never asks again. A project-scoped .mcp.json would ask on first
   run in each project, and the approval lives in ~/.claude.json — a file Claude
   Code owns and prunes, so pre-writing it does not stick.

   Read-only. It reports; the user runs the command. */
function mcpStatus() {
  const want = config().mcp || 'webflow';
  const beta = want === 'webflow-beta';
  const add = beta
    ? 'claude mcp add --scope user --transport http webflow-beta https://mcp.webflow.com/beta/mcp'
    : 'claude mcp add --scope user --transport sse webflow https://mcp.webflow.com/sse';

  let configured = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath('home'), '.claude.json'), 'utf8'));
    configured = !!(cfg.mcpServers && cfg.mcpServers[want]);
  } catch (e) {
    /* Missing or unreadable ~/.claude.json — which is exactly what a machine
       that has never run Claude Code looks like. `null` is "cannot tell", and
       it is emphatically not the same as "fine": the renderer used to warn only
       on an explicit false, so the commonest case of all was silent. */
    return { name: want, configured: null, add, reason: '~/.claude.json could not be read' };
  }
  return { name: want, configured, add, reason: null };
}

ipcMain.handle('mcp:status', () => mcpStatus());
ipcMain.handle('mcp:copyAdd', () => { clipboard.writeText(mcpStatus().add); return true; });

function syncTooling(root) {
  const from = templateRoot();
  const copied = [];
  for (const dir of ['lib', 'bin']) {
    const src = path.join(from, dir);
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith('.js')) continue;
      const a = path.join(src, f), b = path.join(root, dir, f);
      try {
        if (fs.existsSync(b) && fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8')) continue;
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.copyFileSync(a, b);
        copied.push(dir + '/' + f);
      } catch (e) { /* read-only project — it still runs on what it has */ }
    }
  }
  return copied;
}

let ROOT = null;
let QUEUE = null;
let resolve = null;
let bridgeLib = null;
let reorderSections = null;
let setBuildMode = null;

let snapshotLib = null;

function loadPipeline(root) {
  ROOT = root;
  QUEUE = path.join(ROOT, 'queue');
  resolve = require(path.join(ROOT, 'lib', 'queue')).resolve;
  bridgeLib = require(path.join(ROOT, 'lib', 'bridge'));
  const edit = require(path.join(ROOT, 'lib', 'edit'));
  reorderSections = edit.reorderSections;
  setBuildMode = edit.setBuildMode;
  try { snapshotLib = require(path.join(ROOT, 'lib', 'snapshot')); }
  catch (e) { snapshotLib = null; }   // older project without the snapshot lib
}

let win = null;
let bridge = null;
let bridgeStatus = { state: 'starting', port: null, token: null, error: null };
let term = null;
let ptyStatus = { state: 'starting', error: null };

/* ─────────────────────────────── helpers ─────────────────────────────── */

function config() {
  if (!QUEUE) return {};
  try { return JSON.parse(fs.readFileSync(path.join(QUEUE, '_config.json'), 'utf8')); }
  catch (e) { return {}; }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Atomic: write a temp file beside the target, then rename. A crash mid-write
// must never leave a half-rewritten manifest — these are the user's files.
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/* ──────────────────────────── queue snapshot ─────────────────────────── */

// Per-section progress, read from what the pipeline already writes as it goes.
function progressFor(dirRel) {
  const logFile = path.join(ROOT, dirRel, 'build-log.md');
  if (!fs.existsSync(logFile)) return { state: 'pending', note: null };
  const log = fs.readFileSync(logFile, 'utf8');
  const lastLine = log.trim().split('\n').filter(Boolean).pop() || null;
  return { state: /(^|\n)\s*done\b/i.test(log) ? 'done' : 'building', note: lastLine };
}

function state() {
  try { return JSON.parse(fs.readFileSync(path.join(QUEUE, '_state.json'), 'utf8')); }
  catch (e) { return { components: {}, assets: {}, built: {} }; }
}

function snapshot() {
  // No project is a normal state now that the window opens before one is chosen.
  // Without this the pane showed "resolve is not a function", which reads as a
  // crash rather than an empty app.
  if (!ROOT || !resolve) {
    return { ok: true, noProject: true, config: {}, steps: [], problems: [], errors: 0 };
  }
  let r;
  try {
    r = resolve(ROOT);
  } catch (e) {
    return { ok: false, error: e.message, steps: [], problems: [], config: config() };
  }
  const st = state();
  const steps = r.steps.map((s) => {
    const built = (st.built[s.page] || []).indexOf(s.section) !== -1;
    /* The library derives this now, so the CLI, the bridge and the plugin's own
       queue panel all agree with this window. The local read stays as a fallback:
       a project carries a frozen copy of lib/, and syncTooling swallows its own
       errors on a folder it cannot write to. */
    const prog = built ? { state: 'done', note: null } : (s.progress || progressFor(s.dir));
    return Object.assign({}, s, { built, progress: prog });
  });
  return {
    ok: true,
    config: r.config || config(),
    steps,
    problems: r.problems,
    errors: r.problems.filter((p) => p.level === 'error').length
  };
}

/* ─────────────────────────────── watching ────────────────────────────── */

let watchTimer = null;
function pushSnapshot() {
  clearTimeout(watchTimer);
  // Editors and the bridge both write in bursts; one push per burst is plenty.
  watchTimer = setTimeout(() => send('queue', snapshot()), 150);
}

function watchQueue() {
  if (!fs.existsSync(QUEUE)) return;
  try {
    watcher = fs.watch(QUEUE, { recursive: true }, () => pushSnapshot());
  } catch (e) {
    // recursive watch is unsupported on some filesystems; fall back to polling
    pollTimer = setInterval(pushSnapshot, 3000);
  }
  /* Going stale is the passage of time, not a file change, so no watcher will
     ever fire for it. Without this a dead build sits reading `building` until
     something else happens to touch the queue. */
  staleTimer = setInterval(pushSnapshot, 15000);
}

/* ──────────────────────────────── bridge ─────────────────────────────── */

async function startBridge() {
  const cfg = config();
  try {
    bridge = await bridgeLib.start({
      root: ROOT,
      port: cfg.bridgePort || bridgeLib.DEFAULT_PORT,
      // Lets the plugin ask for a real refresh instead of only ever reading a
      // cache it has no way to fill.
      refresh: refreshWebflow,
      onWrite: (r) => { send('bridge-write', r); pushSnapshot(); },
      onError: (e) => send('bridge-write', { ok: false, error: e.message })
    });
    bridgeStatus = { state: 'running', port: bridge.port, token: bridge.token, error: null };
  } catch (err) {
    bridgeStatus = {
      state: 'failed', port: cfg.bridgePort || bridgeLib.DEFAULT_PORT, token: null,
      error: err.friendly || err.message
    };
  }
  send('bridge', bridgeStatus);
}

/* ───────────────────────── the agent, two ways ────────────────────────────
   terminal — the interactive TUI in a pty. What you drive by hand.
   messages — the same CLI in --output-format stream-json, which emits structured
              events the panel renders as messages.

   Only one runs at a time; they are one conversation each, and two would mean two
   sessions and two bills. Switching restarts.

   Note what this is NOT: the messages view does not scrape the TUI. Parsing a
   full-screen terminal — repaints, cursor moves, spinners — is exactly the
   fragility this file's header rules out. stream-json is structured output, so
   the rule holds. */

/* Read once the app is ready, never at module load. app.getPath('userData') is
   not available before then in a packaged build, and a throw here happens while
   main.js is still evaluating — so whenReady is never registered, no window is
   ever made, and Electron exits 0 with no error anywhere. It looks like the app
   simply refuses to open. */
let agentMode = 'terminal';
let stream = null;
let streamBuf = '';

function startStream() {
  const { spawn } = require('child_process');
  const env = agentEnv();

  try {
    stream = spawn(process.env.SHELL || '/bin/zsh',
      shellArgs('claude --print --output-format stream-json --input-format stream-json --verbose'),
      { cwd: ROOT, env });
  } catch (e) {
    ptyStatus = { state: 'failed', error: 'could not start claude: ' + e.message };
    return send('pty-status', ptyStatus);
  }

  ptyStatus = { state: 'running', error: null };
  send('pty-status', ptyStatus);
  send('agent-reset', { mode: 'messages' });

  stream.stdout.on('data', (d) => {
    // NDJSON, and a chunk boundary lands mid-line often enough to matter.
    streamBuf += d.toString();
    const lines = streamBuf.split('\n');
    streamBuf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      let e; try { e = JSON.parse(t); } catch (err) { continue; }
      send('agent-event', e);
    }
  });
  stream.stderr.on('data', (d) => send('agent-event', { type: 'stderr', text: d.toString() }));
  stream.on('close', (code) => {
    stream = null;
    ptyStatus = { state: 'exited', error: exitReason(code) };
    send('pty-status', ptyStatus);
  });

  if (snapshotLib) {
    try { snapshotLib.startSession(ROOT, { host: 'pentool', startedBy: 'stream' }); }
    catch (e) { /* non-fatal — the gate falls back to an age window */ }
  }
}

/* A GUI-launched app inherits almost nothing: LaunchServices hands it a bare
   PATH, not the one your terminal has. Two things follow.

   The shell must be interactive. `-l` sources .zshenv/.zprofile/.zlogin but NOT
   .zshrc, and .zshrc is where most people set PATH — so `zsh -lc claude` exits
   127 from the Dock while working perfectly from a terminal. `-i` sources it.

   And the usual install directories are added directly, because a profile that
   never runs cannot be relied on to add them. Existing entries win; these are
   appended, and only if the directory is really there. */
const EXTRA_BINS = [
  path.join(app.getPath('home'), '.local/bin'),
  path.join(app.getPath('home'), '.bun/bin'),
  path.join(app.getPath('home'), '.volta/bin'),
  path.join(app.getPath('home'), '.nvm/current/bin'),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'
];

const shellArgs = (cmd) => ['-lic', cmd];

function agentEnv() {
  const env = Object.assign({}, process.env);
  // Set inside some Electron hosts; it would make `claude` run as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  env.TERM = 'xterm-256color';
  const seen = new Set((env.PATH || '').split(':').filter(Boolean));
  const add = EXTRA_BINS.filter((d) => !seen.has(d) && fs.existsSync(d));
  env.PATH = (env.PATH ? env.PATH + ':' : '') + add.join(':');
  return env;
}

// 127 is the shell saying "command not found", which is by far the likeliest
// failure here and reads as nothing at all on its own.
function exitReason(code) {
  if (!code) return null;
  if (code === 127) {
    return 'claude was not found on PATH — install the Claude Code CLI, ' +
           'or make sure your shell profile puts it on PATH';
  }
  return 'claude exited with ' + code;
}

function startAgent() {
  if (agentMode === 'messages') startStream();
  else startPty();
}

function stopAgent() {
  if (term) { try { term.kill(); } catch (e) { /* already gone */ } term = null; }
  if (stream) { try { stream.kill(); } catch (e) { /* already gone */ } stream = null; }
  streamBuf = '';
}

ipcMain.handle('agent:mode', () => agentMode);

ipcMain.handle('agent:setMode', (_e, mode) => {
  const next = mode === 'messages' ? 'messages' : 'terminal';
  if (next === agentMode) return { ok: true, mode: agentMode };
  agentMode = next;
  writeUi({ agentMode: agentMode });
  stopAgent();
  if (ROOT) startAgent();
  return { ok: true, mode: agentMode };
});

// One entry point for "say this to the agent", whichever way it is running.
ipcMain.handle('agent:say', (_e, text) => {
  const t = String(text || '');
  if (!t.trim()) return { ok: false, error: 'nothing to send' };
  if (agentMode === 'messages') {
    if (!stream) return { ok: false, error: 'the agent is not running' };
    stream.stdin.write(JSON.stringify({
      type: 'user', message: { role: 'user', content: [{ type: 'text', text: t }] }
    }) + '\n');
    // Echo it back so the panel shows the turn it just started.
    send('agent-event', { type: 'local-user', text: t });
    return { ok: true };
  }
  if (!term) return { ok: false, error: 'the agent is not running' };
  term.write(t + '\r');
  return { ok: true };
});

/* ────────────────────────────────── pty ──────────────────────────────── */

function startPty() {
  let pty;
  try {
    pty = require('node-pty');
  } catch (e) {
    ptyStatus = { state: 'failed', error: 'node-pty failed to load — run `npm run rebuild`' };
    return send('pty-status', ptyStatus);
  }

  const env = agentEnv();

  try {
    term = pty.spawn(process.env.SHELL || '/bin/zsh', shellArgs('claude'), {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: ROOT, env
    });
  } catch (e) {
    ptyStatus = { state: 'failed', error: 'could not start claude: ' + e.message };
    return send('pty-status', ptyStatus);
  }

  ptyStatus = { state: 'running', error: null };
  send('pty-status', ptyStatus);
  send('agent-reset', { mode: 'terminal' });

  // A new agent session owes a snapshot before it touches Webflow. Record the
  // session boundary so the gate in wf-snapshot.js can tell "before" from "now",
  // then ask the agent to take one. Webflow has no undo.
  if (snapshotLib) {
    try { snapshotLib.startSession(ROOT, { host: 'pentool', startedBy: 'pty' }); }
    catch (e) { /* non-fatal — the gate falls back to an age window */ }
  }
  const cfg = config();
  if (cfg.autoSnapshot !== false) {
    // Let the TUI finish drawing before typing into it.
    setTimeout(() => {
      if (term) term.write('/webflow-snapshot\r');
      send('bridge-write', { ok: true, section: 'session snapshot requested', images: [] });
    }, 3500);
  }

  term.onData((d) => send('pty-data', d));
  term.onExit(({ exitCode }) => {
    term = null;
    ptyStatus = { state: 'exited', error: exitReason(exitCode) || 'claude exited (0)' };
    send('pty-status', ptyStatus);
  });
}

/* ──────────────────────────────── window ─────────────────────────────── */

// A saved rectangle is only usable if some display still contains its origin.
function onScreen(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return {};
  try {
    const { screen } = require('electron');
    const fits = screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return b.x >= w.x - 40 && b.y >= w.y - 40 &&
             b.x < w.x + w.width - 80 && b.y < w.y + w.height - 40;
    });
    if (!fits) return { width: b.width, height: b.height };   // size yes, place no
  } catch (e) { return {}; }
  return b;
}

function createWindow() {
  const saved = readUi().bounds;

  win = new BrowserWindow(Object.assign({
    width: 1180, height: 800, minWidth: 900, minHeight: 600,
    title: 'Pentool',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1E1E1E',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  }, onScreen(saved)));

  if (readUi().maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Position is only restored if it still lands on a display that exists. Plug a
  // second monitor in, close the app there, unplug it — without this the window
  // reopens off-screen and looks like a launch failure.
  const remember = () => {
    if (!win || win.isDestroyed()) return;
    writeUi({ maximized: win.isMaximized() });
    if (!win.isMaximized() && !win.isMinimized()) writeUi({ bounds: win.getBounds() });
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  win.on('close', remember);

  win.webContents.on('did-finish-load', () => {
    send('bridge', bridgeStatus);
    send('pty-status', ptyStatus);
    send('queue', snapshot());
  });
}

/* ────────────────────────────────── IPC ──────────────────────────────── */

ipcMain.handle('queue:get', () => snapshot());
ipcMain.handle('snapshot:status', () => {
  // Must match the shape the header reads. Returning {owed, note} left `required`
  // undefined, so with no project open the header claimed a snapshot existed.
  if (!ROOT) return { required: false, reason: 'no project open', newest: null, noProject: true };
  /* A project scaffolded before lib/snapshot.js existed. `required: false` read
     as `snapshot ✓` in the header — the app asserting a backup exists for the
     one thing in this pipeline that has no undo. Not knowing must look like not
     knowing. `required: true` also makes an older renderer fail safe. */
  if (!snapshotLib) {
    return {
      required: true, unknown: true, newest: null,
      reason: 'this project has no lib/snapshot.js — Pentool cannot tell whether a snapshot exists'
    };
  }
  try { return snapshotLib.snapshotStatus(ROOT); }
  catch (e) { return { required: true, reason: e.message }; }
});
ipcMain.handle('bridge:get', () => bridgeStatus);
ipcMain.handle('bridge:copyToken', () => {
  if (bridgeStatus.token) clipboard.writeText(bridgeStatus.token);
  return !!bridgeStatus.token;
});

ipcMain.handle('section:open', (_e, dirRel, fileName) => {
  // basename, because the name comes from the renderer and this opens whatever
  // it is handed. Defaults to section.md; the rebuild dialog asks for the
  // archived build log by name.
  const leaf = path.basename(String(fileName || 'section.md'));
  const file = path.join(ROOT, dirRel, leaf);
  if (!fs.existsSync(file)) return { ok: false, error: leaf + ' not found' };
  shell.openPath(file);
  return { ok: true };
});

/* Forget that a section was built, so it can be built again. Deliberately not
   called "undo": see lib/unbuild.js, and the dialog that fronts this. */
ipcMain.handle('section:unbuild', (_e, { section, page }) => {
  if (!ROOT) return { ok: false, error: 'no project is open' };
  try {
    const { unbuild } = require(path.join(ROOT, 'lib', 'unbuild'));
    const r = unbuild(ROOT, section, page || null);
    pushSnapshot();
    return Object.assign({ ok: true }, r);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('section:reorder', (_e, { pageFile, from, to }) => {
  const file = path.join(QUEUE, 'pages', pageFile);
  try {
    const out = reorderSections(fs.readFileSync(file, 'utf8'), from, to);
    writeAtomic(file, out);
    pushSnapshot();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('section:setBuild', (_e, { dirRel, mode }) => {
  const file = path.join(ROOT, dirRel, 'section.md');
  try {
    const out = setBuildMode(fs.readFileSync(file, 'utf8'), mode);
    writeAtomic(file, out);
    pushSnapshot();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ───────────────────────── projects, settings, Webflow ───────────────────── */

ipcMain.handle('projects:list', () => {
  let list = [];
  try { list = projectLib().listProjects(REGISTRY()); } catch (e) { list = []; }
  return { active: ROOT, activeName, projects: list };
});

ipcMain.handle('projects:activate', (_e, root) => activateProject(root));

// Renames the *label*, never the folder. Moving a project on disk would break
// the registry, the remembered root, and any terminal history pointing at it —
// and the folder name is not what anything keys on.
ipcMain.handle('projects:rename', (_e, { root, name }) => {
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: 'a name is needed' };
  const cfgFile = path.join(root, 'queue', '_config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.projectName = clean;
    writeAtomic(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  } catch (e) {
    return { ok: false, error: 'could not write _config.json: ' + e.message };
  }
  try { projectLib().registerProject(REGISTRY(), root, clean); } catch (e) { /* convenience */ }
  if (root === ROOT) { activeName = clean; send('project', { ok: true, root, name: clean }); }
  sendProjects();
  return { ok: true, name: clean };
});

ipcMain.handle('projects:forget', (_e, root) => {
  try { projectLib().forgetProject(REGISTRY(), root); } catch (e) { /* already gone */ }
  sendProjects();
  return true;
});

ipcMain.handle('projects:pickFolder', () => {
  const picked = dialog.showOpenDialogSync(win, {
    title: 'Where should the project live?',
    properties: ['openDirectory', 'createDirectory']
  });
  return (picked && picked[0]) || null;
});

ipcMain.handle('projects:open', async (_e, root) => {
  const picked = root || (dialog.showOpenDialogSync(win, {
    title: 'Open a project',
    message: 'Choose the folder containing queue/ and lib/',
    properties: ['openDirectory']
  }) || [])[0];
  if (!picked) return { ok: false, cancelled: true };
  if (!looksLikePipeline(picked)) {
    return { ok: false, error: 'that folder has no queue/ and lib/queue.js' };
  }
  await activateProject(picked);
  const cfg = config();
  // The caller opens the token prompt when this comes back false — an existing
  // project carries its siteId but never its secret.
  return {
    ok: true, root: picked,
    siteId: cfg.siteId || null, siteName: cfg.siteName || null,
    needsToken: !!cfg.siteId && !activeToken()
  };
});

ipcMain.handle('projects:create', async (_e, { name, parentDir, siteId, siteName, token }) => {
  try {
    const r = projectLib().createProject({
      name, parentDir, templateRoot: templateRoot(), siteId, siteName
    });
    // Store before activating, so the bridge and the queue see it immediately.
    if (siteId && token) setToken(siteId, token);
    await activateProject(r.root);
    return { ok: true, root: r.root, name: r.name };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('settings:get', () => {
  const cfg = config();
  return {
    siteId: cfg.siteId || null,
    siteName: cfg.siteName || null,
    hasToken: !!activeToken(),
    canEncrypt: safeStorage.isEncryptionAvailable(),
    hasProject: !!ROOT
  };
});

ipcMain.handle('settings:setToken', (_e, { token, siteId }) => {
  const id = siteId || config().siteId;
  if (!id) return { ok: false, error: 'this project has no siteId to attach a token to' };
  const encrypted = setToken(id, token);
  return { ok: true, encrypted };
});

/* A site-scoped token cannot browse an account, so this is a verification step
   rather than a picker: paste the token, and Webflow tells you which site it is
   for. A workspace-wide token returns several, and then it is a picker. */
ipcMain.handle('webflow:verify', async (_e, token) => {
  if (!token) return { ok: false, error: 'paste a Webflow API token' };
  try {
    const wf = require(path.join(templateRoot(), 'lib', 'webflow'));
    const sites = await wf.listSites({ token });
    if (!sites.length) return { ok: false, error: 'that token can reach no sites' };
    return { ok: true, sites };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Fetching lives here, not in the bridge: the token must not reach the Figma
// sandbox, and the standalone CLI bridge has no way to get one.
/* Pulls the site's pages and components from Webflow into the project's cache.
   Shared, because two callers want it: the app's own refresh, and the plugin
   asking through the bridge — the plugin cannot call Webflow itself, and the
   token deliberately never leaves this process. */
async function refreshWebflow() {
  if (!ROOT) return { ok: false, error: 'no project is open' };
  const siteId = config().siteId;
  if (!siteId) return { ok: false, error: 'this project has no siteId in _config.json' };
  const token = getToken(siteId);
  if (!token) return { ok: false, error: 'no token for this site — add one in Pentool settings' };
  try {
    const wf = require(path.join(ROOT, 'lib', 'webflow'));
    const [pages, components] = await Promise.all([
      wf.listPages({ siteId, token }), wf.listComponents({ siteId, token })
    ]);
    wf.writePagesCache(ROOT, pages, siteId);
    wf.writeComponentsCache(ROOT, components, siteId);
    pushSnapshot();
    return { ok: true, pages: pages.length, components: components.length };
  } catch (e) { return { ok: false, error: e.message }; }
}

ipcMain.handle('webflow:refresh', () => refreshWebflow());

/* ────────────────────── handing a section to the agent ────────────────────
   The point of the app: pick a row, and the agent starts with that section's
   context instead of you retyping the path, the kind and the page. */

/* ────────────────────────── removing from the queue ────────────────────────
   Two levels, because they are different decisions. Taking a section off a page
   leaves the capture on disk to re-place; removing it entirely puts the folder in
   _trash/ rather than deleting it, since these are the user's files and Figma is
   the only other copy. */

ipcMain.handle('section:remove', (_e, { section, pageFile, alsoDelete }) => {
  if (!ROOT) return { ok: false, error: 'no project is open' };
  const edit = require(path.join(ROOT, 'lib', 'edit'));
  const pagesDir = path.join(QUEUE, 'pages');
  const touched = [];

  try {
    const files = pageFile ? [pageFile]
      : (fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md')) : []);
    for (const f of files) {
      const file = path.join(pagesDir, f);
      if (!fs.existsSync(file)) continue;
      const before = fs.readFileSync(file, 'utf8');
      const after = edit.removeSection(before, section);
      if (after !== before) { writeAtomic(file, after); touched.push(f); }
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }

  let trashed = null;
  if (alsoDelete) {
    const from = path.join(QUEUE, 'sections', section);
    if (fs.existsSync(from)) {
      const trash = path.join(QUEUE, '_trash');
      fs.mkdirSync(trash, { recursive: true });
      // Stamped, so removing the same name twice cannot clobber the first copy.
      let to = path.join(trash, section);
      if (fs.existsSync(to)) to = to + '-' + Date.now();
      try { fs.renameSync(from, to); trashed = path.relative(ROOT, to); }
      catch (e) { return { ok: false, error: 'could not move it to _trash: ' + e.message }; }
    }
  }

  pushSnapshot();
  return { ok: true, pages: touched, trashed };
});

/* ────────────────────────────── build control ───────────────────────────── */

ipcMain.handle('build:start', (_e, page) => {
  const cmd = '/webflow-build' + (page ? ' ' + page : '');
  if (agentMode === 'messages') {
    if (!stream) return { ok: false, error: 'the agent is not running' };
    stream.stdin.write(JSON.stringify({
      type: 'user', message: { role: 'user', content: [{ type: 'text', text: cmd }] }
    }) + '\n');
    send('agent-event', { type: 'local-user', text: cmd });
    return { ok: true };
  }
  if (!term) return { ok: false, error: 'the agent is not running' };
  term.write(cmd + '\r');
  return { ok: true };
});

// ESC is Claude Code's interrupt. Ctrl-C would work too, but a second Ctrl-C
// exits the CLI entirely, which would take the session and its snapshot with it.
ipcMain.handle('build:stop', () => {
  // ESC is the TUI's interrupt. A stream session has no such key, so it is
  // stopped by ending the turn — restarting is the only clean interrupt there.
  if (agentMode === 'messages') {
    if (!stream) return { ok: false, error: 'the agent is not running' };
    stopAgent(); startAgent();
    return { ok: true, restarted: true };
  }
  if (!term) return { ok: false, error: 'the agent is not running' };
  term.write('\x1b');
  return { ok: true };
});

ipcMain.handle('section:attach', (_e, step) => {
  if (!term) return { ok: false, error: 'the agent is not running' };
  const bits = [
    `Work on the queued section "${step.section}".`,
    `Its files are in ${step.dir}.`,
    `It builds as ${step.build}${step.componentId ? ` (component ${step.componentId})` : ''}.`
  ];
  if (step.build !== 'update') bits.push(`It goes on page ${step.page}, ${step.position} into .${step.anchor}.`);
  if (step.status) bits.push(`It is currently ${step.status}.`);
  if (step.reuse && step.reuse.length) bits.push(`It reuses: ${step.reuse.join(', ')}.`);
  if (step.assets && step.assets.length) bits.push(`Assets: ${step.assets.join(', ')}.`);
  bits.push('Read the section file first, then tell me what you plan to do before doing it.');
  // No trailing \r: the agent should not start until the user has read it and
  // pressed return themselves.
  term.write(bits.join(' '));
  return { ok: true };
});

ipcMain.on('pty:write', (_e, data) => { if (term) term.write(data); });
ipcMain.on('pty:resize', (_e, { cols, rows }) => {
  if (term && cols > 0 && rows > 0) { try { term.resize(cols, rows); } catch (e) { /* racing a teardown */ } }
});
ipcMain.on('pty:restart', () => {
  // Restart whichever mode is running, not always the pty.
  stopAgent();
  if (ROOT) startAgent();
});

/* ──────────────────────────── project activation ──────────────────────────
   One entry point, re-runnable, because switching projects calls it again.
   Order matters on the way down as much as the way up: the bridge has to release
   :8930 before the next one binds it, and the pty has to die before its cwd stops
   being a project. */

let activeName = null;
let watcher = null;
let pollTimer = null;
let staleTimer = null;

function tearDown() {
  stopAgent();
  ptyStatus = { state: 'starting', error: null };
  if (bridge && bridge.server) { try { bridge.server.close(); } catch (e) { /* already closed */ } }
  bridge = null;
  bridgeStatus = { state: 'starting', port: null, token: null, error: null };
  if (watcher) { try { watcher.close(); } catch (e) { /* already closed */ } watcher = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
  clearTimeout(watchTimer);
}

// Serialised, because it is async and re-entrant: two quick clicks in the
// sidebar had a second activation tearing down and rebinding :8930 while the
// first was still starting, which could leave the previous project's bridge and
// pty alive with ROOT already pointing somewhere else.
let activating = Promise.resolve();

function activateProject(root) {
  const next = activating.then(() => activateNow(root), () => activateNow(root));
  activating = next.catch(() => {});
  return next;
}

async function activateNow(root) {
  if (!looksLikePipeline(root)) {
    send('project', { ok: false, root, error: 'that folder has no queue/ and lib/queue.js' });
    return false;
  }
  tearDown();

  const synced = syncTooling(root);
  // require() caches by absolute path, so a project reactivated after a sync
  // would otherwise keep serving the modules loaded before it.
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(root, 'lib') + path.sep)) delete require.cache[key];
  }

  loadPipeline(root);
  activeName = config().projectName || path.basename(root);
  rememberRoot(root);
  try { projectLib().registerProject(REGISTRY(), root, activeName); } catch (e) { /* registry is a convenience */ }

  send('project', { ok: true, root, name: activeName, synced, mcp: mcpStatus() });
  await startBridge();
  startAgent();
  watchQueue();
  pushSnapshot();
  sendProjects();
  return true;
}

function sendProjects() {
  let list = [];
  try { list = projectLib().listProjects(REGISTRY()); } catch (e) { list = []; }
  send('projects', { active: ROOT, projects: list });
}

/* ──────────────────────────────── updates ─────────────────────────────
   Pentool ships as a DMG, so a fix reaches nobody unless the app says so.
   This finds the release and hands it over; it does not install — see
   update.js for why macOS will not let it. */

const SIX_HOURS = 6 * 60 * 60 * 1000;
let updateTimer = null;

/* `manual` distinguishes the two callers, and it is the whole reason this takes
   an argument. The scheduled check is allowed to say nothing at all; a person
   who clicked "Check for updates" must always get an answer, including "you are
   up to date" — silence there reads as a broken button. */
async function checkUpdate(manual) {
  const current = app.getVersion();
  const found = await updater.check(current);

  writeUi({ lastUpdateCheck: Date.now() });

  if (!found) return send('update', { manual: manual, current: current, available: null });

  // A version already dismissed stays dismissed. The next one asks again.
  if (!manual && readUi().dismissedUpdate === found.version) return;

  send('update', { manual: manual, current: current, available: found });
}

function startUpdateChecks() {
  if (updateTimer) return;

  // Not on the same tick as launch: the first seconds belong to the project
  // opening, the bridge binding and the agent starting.
  const last = Number(readUi().lastUpdateCheck) || 0;
  const due = Math.max(0, SIX_HOURS - (Date.now() - last));
  setTimeout(() => checkUpdate(false), Math.min(due, 20 * 1000) || 20 * 1000);

  updateTimer = setInterval(() => checkUpdate(false), SIX_HOURS);
}

ipcMain.handle('update:check', () => checkUpdate(true));

ipcMain.handle('update:dismiss', (_e, version) => {
  writeUi({ dismissedUpdate: String(version || '') });
  return { ok: true };
});

ipcMain.handle('update:open', (_e, url) => {
  // Only ever GitHub, and only ever https. The URL comes from a network
  // response, and openExternal hands whatever it is given to the OS.
  const u = String(url || '');
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(u)) {
    return { ok: false, error: 'refused a link that was not on github.com' };
  }
  shell.openExternal(u);
  return { ok: true };
});

ipcMain.handle('app:version', () => app.getVersion());

/* ─────────────────────────────── lifecycle ───────────────────────────── */

app.whenReady().then(async () => {
  // Safe now: everything below may touch app paths.
  if (readUi().agentMode === 'messages') agentMode = 'messages';

  // Window first. Project resolution used to happen before any UI existed, which
  // is why a missing folder could only be an error box, and why dev builds
  // silently opened the repo itself.
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

  startUpdateChecks();

  const root = resumeRoot();
  if (root) await activateProject(root);
  else { send('project', { ok: false, root: null, error: null }); sendProjects(); }
});

app.on('window-all-closed', () => {
  if (term) { try { term.kill(); } catch (e) { /* already gone */ } }
  if (bridge && bridge.server) bridge.server.close();
  if (process.platform !== 'darwin') app.quit();
});
