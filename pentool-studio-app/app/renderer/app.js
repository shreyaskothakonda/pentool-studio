/* Pentool renderer. Renders the queue, mirrors build progress, and gives the
   one pty two faces: a prompt box and the terminal drawer. */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ─────────────────────────────── header ─────────────────────────────── */

window.pentool.onBridge((b) => {
  const ok = b.state === 'running';
  $('bridgeDot').className = 'dot ' + (ok ? 'ok' : 'err');
  $('bridgeText').textContent = ok ? 'bridge :' + b.port : (b.error || 'bridge ' + b.state);
  $('copyToken').hidden = !ok;
});

$('copyToken').onclick = async () => {
  const ok = await window.pentool.copyToken();
  $('copyToken').textContent = ok ? 'copied' : 'no token';
  setTimeout(() => { $('copyToken').textContent = 'copy token'; }, 1400);
};

window.pentool.onPtyStatus((p) => {
  const ok = p.state === 'running';
  $('ptyDot').className = 'dot ' + (ok ? 'ok' : 'err');
  $('ptyText').textContent = ok ? 'claude' : (p.error || 'claude ' + p.state);
  /* The app told people to "restart the agent" and had no way to do it — the
     IPC was wired up in preload and never called from anywhere. */
  $('ptyRestart').hidden = ok || p.state === 'starting';
});

$('ptyRestart').onclick = () => {
  window.pentool.ptyRestart();
  note('Starting the agent again…', null);
};

/* Everything the plugin sends, said out loud. The failure branch used to be
   dropped on the floor: the app stayed silent while Figma showed the error, so a
   capture that never arrived looked exactly like one that did. */
window.pentool.onBridgeWrite((r) => {
  if (!r) return;
  if (!r.ok) return note('Figma capture failed: ' + (r.error || 'unknown error'), 'error');

  note('received ' + r.section + (r.images.length ? ' +' + r.images.length + ' asset(s)' : ''),
       r.warning ? 'warn' : 'success');
  // Saved, but something about it will stop it building. Separate note, because
  // it outlives the success one and needs reading.
  if (r.warning) note(r.section + ': ' + r.warning, 'warn');
});

/* ──────────────────────────────── queue ─────────────────────────────── */

let current = { steps: [], problems: [] };

const STATE_GLYPH = { done: '✓', building: '◷', pending: '○', error: '✗' };

/* ──────────────────────── the agent's messages ────────────────────────
   Rendered from stream-json events, not scraped from the terminal. Only the
   handful of event types worth showing are handled; the rest of the stream
   (hooks, rate-limit notices, system chatter) is deliberately ignored. */

/* A markdown renderer for the subset the agent actually writes: headings, bold,
   italic, inline code, fenced blocks, lists, tables, links and rules.

   It exists because the panel used to set textContent, so every reply arrived
   with its formatting intact as punctuation — tables as pipe soup, `##` in front
   of every heading, asterisks around anything emphasised. That is most of why
   the panel read as a wall.

   Escaping first, always. Everything here runs on text produced by a model that
   is quoting files, shell output and error messages, so the input WILL contain
   angle brackets. Escape once at the top, then only ever add markup — no path
   through this function can put unescaped input into innerHTML. */
function mdEscape(t) {
  return String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Quotes too. Only one thing here builds an attribute — the link href — but
    // escaping them at the source means no future addition can put text into an
    // attribute and break out of it. As element content these render back as
    // ordinary quotes, so nothing is lost.
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Belt and braces for anything going into an attribute value. mdEscape has
   normally handled these already; this is the layer that does not depend on
   that having happened. */
function attrEscape(t) {
  return String(t).replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inline: applied to already-escaped text. Code spans are extracted first so
// nothing inside them is treated as emphasis — `**` in a shell command is a glob.
function mdInline(escaped) {
  const spans = [];
  let out = escaped.replace(/`([^`]+)`/g, (m, code) => {
    spans.push(code);
    return '\u0000' + (spans.length - 1) + '\u0000';
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    /* Links. The scheme is pinned to http(s) so javascript: and data: can never
       reach an anchor — but that alone was not enough, and this got it wrong
       once: the character class allowed a double quote, so a URL could close the
       href attribute early and open an event handler after it
       (`[x](https://a/"onmouseover="…)`). A breakout here is not cosmetic; this
       renderer holds the IPC bridge, and the text being rendered is a model
       quoting files and web pages.

       Three things stop it now, any one of which would do: quotes are escaped
       upstream in mdEscape, the pattern refuses them and angle brackets outright,
       and the href is attribute-escaped again on the way in. */
    /* \u0000 is the code-span placeholder. Without excluding it a URL could
       swallow one, and the restore pass afterwards would put <code> markup
       inside the href attribute. Harmless as a quoted value, but markup has no
       business in an attribute and it would not stay harmless. */
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"'`<>\u0000]+)\)/g,
             (m, text, href) => '<a href="' + attrEscape(href) +
                                '" target="_blank" rel="noreferrer">' + text + '</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + spans[Number(i)] + '</code>');
}

function renderMarkdown(src) {
  const lines = mdEscape(src).split('\n');
  const out = [];
  let i = 0;

  const isTableRule = (l) => /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(l) && l.indexOf('-') !== -1;
  const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. Taken verbatim — no inline pass, or a shell pipeline becomes
    // italics.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push('<pre><code>' + body.join('\n') + '</code></pre>');
      continue;
    }

    // Tables. The reason this renderer handles them at all: a build report is
    // mostly tables, and as plain text they are unreadable.
    if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => '<th>' + mdInline(c) + '</th>').join('') +
               '</tr></thead><tbody>' +
               rows.map((r) => '<tr>' + r.map((c) => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('') +
               '</tbody></table>');
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      // Capped at h4: these sit inside a panel, not a document, and an h1 the
      // size of the app title for "1. Snapshot gate fails" reads as chrome.
      const level = Math.min(h[1].length + 2, 4);
      out.push('<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>');
      i++; continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const bullet = /^\s*[-*+]\s+(.*)$/;
    const number = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = !bullet.test(line);
      const items = [];
      while (i < lines.length && (bullet.test(lines[i]) || number.test(lines[i]))) {
        const m = bullet.exec(lines[i]) || number.exec(lines[i]);
        items.push('<li>' + mdInline(m[1]) + '</li>');
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // A paragraph runs until a blank line or anything that starts a block.
    const para = [];
    while (i < lines.length && lines[i].trim() &&
           !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
           !bullet.test(lines[i]) && !number.test(lines[i]) &&
           !/^\s*(---+|\*\*\*+)\s*$/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push('<p>' + mdInline(para.join(' ')) + '</p>');
  }
  return out.join('');
}

function msgEl(kind, who) {
  const box = el('div', 'msg ' + kind);
  if (who) box.appendChild(el('span', 'who', who));
  return box;
}

function addMsg(node) {
  const box = $('messages');
  const first = box.querySelector('.empty');
  if (first) first.remove();
  // Only follow the tail when already at it, or reading scrollback fights you.
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.appendChild(node);
  if (atEnd) box.scrollTop = box.scrollHeight;
}

/* Tool calls, made small.

   Every call used to get a full-width row carrying its raw input, so nine
   exploratory shell commands outweighed the answer they were gathering — and
   each row was mostly an absolute path whose last fifteen characters were the
   only part that meant anything.

   Consecutive calls now collapse into one line that counts them and can be
   opened. A burst of exploration is a footnote until you want it. */
let toolRun = null;

function toolGist(c) {
  const inp = c.input || {};
  if (inp.file_path) return String(inp.file_path).split('/').pop();
  if (inp.command) {
    // The first clause is what it is doing; the rest is usually redirection,
    // chained echoes and a second copy of the same path.
    const first = String(inp.command).split(/\s*(?:&&|\|\||;|\|)\s*/)[0].trim();
    return first.length > 48 ? first.slice(0, 47) + '…' : first;
  }
  if (inp.pattern) return String(inp.pattern);
  if (inp.style_name || inp.name) return String(inp.style_name || inp.name);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(', ') : '';
}

function addToolCall(c) {
  const line = el('div', 'tool-line');
  line.appendChild(el('span', 'name', c.name));
  line.appendChild(el('span', 'arg', toolGist(c)));

  // Still in the same burst: add to it rather than starting a new row.
  if (toolRun && toolRun.box.isConnected && toolRun.box === $('messages').lastElementChild) {
    toolRun.lines.appendChild(line);
    toolRun.count++;
    toolRun.head.textContent = toolRun.count + ' steps';
    toolRun.box.classList.remove('single');
    return;
  }

  const box = msgEl('tool');
  const head = el('button', 'tool-head', '1 step');
  const lines = el('div', 'tool-lines');
  lines.appendChild(line);
  box.classList.add('single');
  head.setAttribute('aria-expanded', 'false');
  head.onclick = () => {
    const open = box.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
  };
  box.appendChild(head);
  box.appendChild(lines);
  addMsg(box);
  toolRun = { box, head, lines, count: 1 };
}

function renderAgentEvent(e) {
  if (!e || !e.type) return;
  // Any non-tool event ends the current burst.
  if (e.type !== 'assistant') toolRun = null;

  if (e.type === 'local-user') {
    const m = msgEl('user', 'you');
    m.appendChild(el('div', 'body', e.text));
    return addMsg(m);
  }

  if (e.type === 'assistant') {
    for (const c of (e.message && e.message.content) || []) {
      if (c.type === 'text' && c.text.trim()) {
        const m = msgEl('assistant', 'claude');
        const body = el('div', 'body');
        // Rendered, not printed. See renderMarkdown: input is escaped first and
        // only markup this file generates is ever added.
        body.innerHTML = renderMarkdown(c.text.trim());
        m.appendChild(body);
        toolRun = null;              // prose ends the burst that preceded it
        addMsg(m);
      } else if (c.type === 'tool_use') {
        addToolCall(c);
      }
    }
    return;
  }

  if (e.type === 'result') {
    const failed = e.subtype && e.subtype !== 'success';
    const m = msgEl('result' + (failed ? ' err' : ''));
    const bits = [failed ? 'failed: ' + e.subtype : 'done'];
    if (e.num_turns) bits.push(e.num_turns + ' turn' + (e.num_turns === 1 ? '' : 's'));
    if (typeof e.total_cost_usd === 'number') bits.push('$' + e.total_cost_usd.toFixed(3));
    if (e.duration_ms) bits.push(Math.round(e.duration_ms / 1000) + 's');
    m.appendChild(el('div', 'body', bits.join(' · ')));
    return addMsg(m);
  }

  if (e.type === 'stderr' && e.text.trim()) {
    const m = msgEl('result err');
    m.appendChild(el('div', 'body', e.text.trim()));
    return addMsg(m);
  }
}

window.pentool.onAgentEvent(renderAgentEvent);
window.pentool.onAgentReset((p) => {
  $('messages').textContent = '';
  // Any route into a mode change lands here, so the header tag follows it.
  if (p && p.mode) { window.__agentMode = p.mode; paintAgentMode(); }
});

/* ── which pane is showing, and which agent is running ── */

/* Which pane and whether the drawer was open. localStorage is the right home:
   it is per-install, on disk, and needs no round trip to the main process for
   something this small. Nothing here is project data — that all lives in the
   project folder. */
const REMEMBER = 'pentool.view.v1';
function recall() {
  try { return JSON.parse(localStorage.getItem(REMEMBER) || '{}'); }
  catch (e) { return {}; }
}
function remember(patch) {
  try { localStorage.setItem(REMEMBER, JSON.stringify(Object.assign(recall(), patch))); }
  catch (e) { /* private mode, or a full disk — the app still works */ }
}

function setView(v) {
  $('viewProgress').setAttribute('aria-pressed', String(v === 'progress'));
  $('viewMessages').setAttribute('aria-pressed', String(v === 'messages'));
  $('progress').hidden = v !== 'progress';
  $('messages').hidden = v !== 'messages';
  remember({ view: v });
}
$('viewProgress').onclick = () => setView('progress');
$('viewMessages').onclick = async () => {
  setView('messages');
  // Messages only arrive in stream mode, so offer the switch rather than showing
  // a pane that will stay empty forever.
  const mode = await window.pentool.agentMode();
  if (mode !== 'messages') {
    note('The agent is running as a terminal. Switch it to Messages?');
    const last = document.querySelector('#noteStack .note:last-child');
    if (last) {
      last.style.cursor = 'pointer';
      last.addEventListener('click', async () => {
        await window.pentool.setAgentMode('messages');
        window.__agentMode = 'messages';
        paintAgentMode();
        note('Agent restarted in Messages mode.', 'success');
      });
    }
  }
};

async function paintAgentMode() {
  const mode = await window.pentool.agentMode();
  const tag = $('agentMode');
  tag.textContent = 'agent: ' + mode;
  tag.title = mode === 'messages'
    ? 'Structured stream — replies render in this pane'
    : 'Interactive TUI — open the Terminal drawer to see it';
}

/* ───────────────────────────── projects ───────────────────────────── */

let activeRoot = null;

function renderProjects(payload) {
  activeRoot = payload.active || null;
  const list = $('projectList');
  list.textContent = '';
  const projects = payload.projects || [];

  if (!projects.length) {
    list.appendChild(el('p', 'empty', 'No projects yet.'));
    return;
  }

  for (const p of projects) {
    const row = el('div', 'proj-row' + (p.root === activeRoot ? ' active' : '') +
                              (p.exists === false ? ' missing' : ''));
    const name = el('span', 'proj-name', p.name || p.root.split('/').pop());
    name.title = p.root;
    row.appendChild(name);

    if (p.root === activeRoot) {
      const ren = el('button', 'ghost icon');
      ren.setAttribute('aria-label', 'Rename project');
      ren.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">' +
        '<path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" ' +
        'stroke-width="1.3" stroke-linejoin="round"/></svg>';
      ren.title = 'Rename — the label only, the folder is not moved';
      ren.onclick = async (e) => {
        e.stopPropagation();
        const next = prompt('Rename this project', p.name || '');
        if (next === null) return;
        const r = await window.pentool.rename(p.root, next);
        r.ok ? note('Renamed to ' + r.name, 'success') : note(r.error || 'could not rename', 'error');
      };
      row.appendChild(ren);
    }

    if (p.exists === false) {
      // listProjects flags a folder that has gone. Offering "forget" is the only
      // honest action — activating it would fail.
      row.appendChild(el('span', 'proj-note', 'missing'));
      const f = el('button', 'ghost tiny', 'Forget');
      f.onclick = (e) => { e.stopPropagation(); window.pentool.forget(p.root); };
      row.appendChild(f);
    } else if (p.root !== activeRoot) {
      row.onclick = () => window.pentool.activate(p.root);
    }
    list.appendChild(row);
  }
}

function renderProject(payload) {
  $('projName').textContent = payload.ok ? payload.name : 'no project';
  $('projName').classList.toggle('none', !payload.ok);
  if (!payload.ok && payload.error) note(payload.error, 'error');
  /* The build cannot run without it, and the fix is one command — so say which.
     Anything but a positive yes is worth saying. `configured === null` means
     ~/.claude.json could not be read, which is what a machine that has never run
     Claude Code looks like; warning only on an explicit `false` meant the
     commonest case of all passed in silence. */
  if (payload.ok && payload.mcp && payload.mcp.configured !== true) {
    const unknown = payload.mcp.configured === null;
    note(unknown
      ? 'Pentool cannot tell whether the ' + payload.mcp.name + ' MCP server is set up — ' +
        (payload.mcp.reason || 'the Claude Code config could not be read') + '. ' +
        'If a build fails at its first Webflow call, this is why. Click to copy the command that adds it.'
      : 'The ' + payload.mcp.name + ' MCP server is not set up. ' +
        'Click to copy the command that adds it.',
      unknown ? 'warn' : 'error');
    const last = document.querySelector('#noteStack .note:last-child');
    if (last) {
      last.style.cursor = 'pointer';
      last.title = payload.mcp.add;
      last.addEventListener('click', async () => {
        await window.pentool.copyMcpAdd();
        note('Command copied. Run it in a terminal, then press Restart in the header.', 'success');
        checkMcp();
      });
    }
  }
  if (payload.ok && payload.synced && payload.synced.length) {
    // Say it rather than fixing it silently: a project carries frozen copies of
    // lib/ and bin/, and this is the moment they stopped being stale.
    note('updated project tooling: ' + payload.synced.join(', '), null);
  }
}

/* Ask again. The status is read once, when a project is activated, so after you
   run the `claude mcp add` command the app went on insisting it was not set up
   until you switched projects and back. */
async function checkMcp() {
  const mcp = await window.pentool.mcpStatus();
  if (mcp && mcp.configured === true) note('The ' + mcp.name + ' MCP server is set up.', 'success');
  return mcp;
}

/* ──────────────────────────── build again ────────────────────────────
   A confirm() is not enough here. What this does is small and local — Pentool
   forgets a section was built. What it does NOT do is the part that matters,
   and it is the part everyone assumes: Webflow has no undo API, so everything
   the build already wrote to the live site stays exactly where it is.

   The confirm button says "Forget the build", not "Build again", because it
   does not start a build. A button that misnames its own action is the kind of
   thing this whole pass exists to remove. */

let rebuilding = null;

function openRebuild(step) {
  rebuilding = step;
  const site = (current.config && (current.config.siteName || current.config.siteId)) || 'your site';

  $('rbTitle').textContent = 'Build again — ' + step.section;
  $('rbWhat').textContent =
    'Pentool will forget that this section was built on ' + step.page +
    ', move it back into queue/sections/, and archive its build log.';
  $('rbWarn').textContent =
    'Webflow has no undo. Everything this section already wrote to ' + site +
    ' is still on the site, and Pentool cannot remove it.';
  $('rbDup').textContent = step.build === 'component'
    ? 'The component itself is kept, so a rebuild will not duplicate it — but it ' +
      'will insert a second instance on the page. Delete the existing one in the ' +
      'Webflow Designer first.'
    : 'Rebuilding appends a second copy under .' + step.anchor +
      '. Delete the existing one in the Webflow Designer first.';

  /* Always offered: a section that reached `done` was built, and being built is
     what writes the log. Whether the file is actually there is the main
     process's question to answer — it has the filesystem and this does not. */
  const log = $('rbLog');
  log.hidden = false;
  log.onclick = async () => {
    const r = await window.pentool.openSection(step.dir, 'build-log.md');
    if (!r.ok) note('No build log for ' + step.section + ' — it was built before Pentool kept one.', 'warn');
  };

  $('rebuildDlg').showModal();
}

$('rebuildDlg').addEventListener('close', async () => {
  const step = rebuilding;
  rebuilding = null;
  if (!step || $('rebuildDlg').returnValue !== 'go') return;

  const r = await window.pentool.unbuildSection({ section: step.section, page: step.page });
  if (!r.ok) return note(r.error || 'could not forget the build', 'error');

  note(step.section + ' is queued again' +
       (r.logArchived ? '. Its build log is at ' + r.logArchived : '.'), 'success');
  // Said separately so it survives the success note fading.
  note('Webflow still has what it built. Delete it in the Designer before building again.', 'warn');
});

/* ───────────────────────────── settings ───────────────────────────── */

let settingsSite = null;

async function openSettings() {
  window.pentool.appVersion().then((v) => {
    $('verHint').textContent = 'Pentool ' + v + ' — updates install by hand, ' +
      'by dragging the new copy over Applications.';
  });
  const st = await window.pentool.getSettings();
  settingsSite = st.siteId;
  $('tokenIn').value = '';
  $('tokenIn').placeholder = st.hasToken ? 'saved — type to replace' : 'site token';
  $('saveToken').disabled = !st.siteId;

  $('tokenHint').textContent = !st.hasProject
    ? 'Open a project first — a token belongs to the site that project builds.'
    : !st.siteId
      ? 'This project has no siteId in queue/_config.json, so there is no site to attach a token to.'
      : !st.canEncrypt
        ? 'Token for ' + (st.siteName || st.siteId) +
          '. This machine has no secure storage, so it is saved as plain text.'
        : st.hasToken
          ? 'Stored in the Keychain for ' + (st.siteName || st.siteId) + '.'
          : 'Needed to read pages and components for ' + (st.siteName || st.siteId) + '.';
  $('settingsDlg').showModal();
}
/* ──────────────────────────────── updates ─────────────────────────────
   The app cannot install its own updates — macOS pins an ad-hoc signature to
   the build that made it, so no later build can satisfy it. What it can do is
   notice, and say so exactly once per release. */

let offered = null;

window.pentool.onUpdate((u) => {
  const bar = $('updateBar');

  if (!u.available) {
    bar.hidden = true;
    // Only a person who clicked gets told there was nothing; the scheduled
    // check stays silent, which is the whole point of it being scheduled.
    if (u.manual) note('Pentool ' + u.current + ' is the latest version', 'success');
    return;
  }

  offered = u.available;
  $('updateMsg').textContent = 'Pentool ' + offered.version + ' is available';
  // One line of it. The full notes are one click away on the release page, and
  // a strip that grows to fit a changelog would push the queue off the screen.
  $('updateNotes').textContent = firstLine(offered.notes);
  bar.hidden = false;
});

/* Release notes are markdown. The first line is usually a heading — "What
   changed" — which tells the user nothing they did not already infer from the
   strip they are reading. Prefer the first actual bullet, and fall back to any
   prose line only when there are no bullets at all. */
function firstLine(notes) {
  const lines = String(notes || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const bullet = lines.find((l) => /^[-*+]\s+/.test(l));
  const prose  = lines.find((l) => !/^#/.test(l));
  const line = (bullet || prose || '').replace(/^[#\-*+\s]+/, '').trim();
  if (!line) return '';
  return line.length > 90 ? line.slice(0, 89) + '…' : line;
}

$('updateGet').onclick  = () => { if (offered) window.pentool.openUpdate(offered.url); };
$('updateNews').onclick = () => { if (offered) window.pentool.openUpdate(offered.page); };
$('updateHide').onclick = () => {
  $('updateBar').hidden = true;
  if (offered) window.pentool.dismissUpdate(offered.version);
};

$('checkUpdate').onclick = async () => {
  const b = $('checkUpdate');
  b.disabled = true; b.textContent = 'Checking…';
  try { await window.pentool.checkUpdate(); }
  finally { b.disabled = false; b.textContent = 'Check for updates'; }
};

$('settingsBtn').onclick = openSettings;

$('saveToken').onclick = async () => {
  const v = $('tokenIn').value.trim();
  if (!v) return;
  const r = await window.pentool.setToken(v, settingsSite);
  if (!r.ok) { note(r.error, 'error'); return; }
  note(r.encrypted ? 'Token saved to the Keychain.' : 'Token saved as plain text.', 'success');
};

/* ──────────────────────────── new project ──────────────────────────── */

const HINT_TOKEN = 'A Site API token comes from Webflow → Site settings → Apps & integrations.';

$('newProject').onclick = () => {
  $('npName').value = '';
  $('npDir').value = '';
  $('npToken').value = '';
  $('npHint').textContent = HINT_TOKEN;
  const sel = $('npSite');
  sel.innerHTML = '<option value="">verify a token first…</option>';
  sel.disabled = true;
  $('newDlg').showModal();
};

// A site token reaches exactly one site, so this usually resolves to a single
// answer and selects it. A workspace token reaches several, and then it is a
// choice.
$('npVerify').onclick = async () => {
  const token = $('npToken').value.trim();
  const sel = $('npSite');
  if (!token) { $('npHint').textContent = 'Paste a token to verify it.'; return; }

  $('npVerify').disabled = true;
  $('npHint').textContent = 'Checking the token…';
  const r = await window.pentool.verifyToken(token);
  $('npVerify').disabled = false;

  if (!r.ok) {
    sel.innerHTML = '<option value="">could not verify</option>';
    sel.disabled = true;
    $('npHint').textContent = r.error + '  ' + HINT_TOKEN;
    return;
  }

  sel.innerHTML = '';
  r.sites.forEach((x) => sel.appendChild(new Option(x.name, x.id)));
  sel.disabled = false;
  $('npHint').textContent = r.sites.length === 1
    ? 'This token is for ' + r.sites[0].name + '.'
    : 'This token reaches ' + r.sites.length + ' sites — pick the one this project builds.';
  if (!$('npName').value.trim()) $('npName').value = slugish(r.sites[0].name);
};

// Webflow site names are display names; a project folder wants a slug.
function slugish(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

$('npPick').onclick = async () => {
  const dir = await window.pentool.pickFolder();
  if (dir) $('npDir').value = dir;
};

$('npCreate').onclick = async (e) => {
  const name = $('npName').value.trim();
  const parentDir = $('npDir').value.trim();
  // Always cancel the dialog's own submit. preventDefault() after an await comes
  // too late — the form has already closed — so on failure the error was written
  // into a hidden element and the dialog vanished.
  e.preventDefault();
  if (!name || !parentDir) {
    $('npHint').textContent = 'A name and a location are both needed.';
    return;
  }
  const sel = $('npSite');
  const r = await window.pentool.createProject({
    name, parentDir,
    siteId: sel.value || '',
    siteName: sel.value ? sel.options[sel.selectedIndex].text : name,
    token: $('npToken').value.trim()
  });
  if (!r.ok) { $('npHint').textContent = r.error; return; }
  note('Created ' + r.name + '.', 'success');
  $('newDlg').close();   // only on success, now that the submit never closes it
};

$('openProject').onclick = async () => {
  const r = await window.pentool.openProject(null);
  if (!r || r.cancelled) return;
  if (r.error) { note(r.error, 'error'); return; }
  // An existing project carries its siteId but never its secret, so the token is
  // the one thing opening a folder cannot recover.
  if (r.needsToken) {
    note('This project has no saved token for ' + (r.siteName || r.siteId) + '.');
    openSettings();
  }
};

function render(snap) {
  current = snap;

  $('mcpTag').textContent = 'mcp: ' + ((snap.config && snap.config.mcp) || 'webflow');
  const qt = $('queueTag');
  qt.textContent = snap.ok
    ? snap.steps.length + ' section' + (snap.steps.length === 1 ? '' : 's') +
      ' · ' + snap.errors + ' error' + (snap.errors === 1 ? '' : 's')
    : 'queue unreadable';
  qt.className = 'tag' + (!snap.ok || snap.errors ? ' bad' : '');

  const pages = $('pages');
  pages.textContent = '';

  if (!snap.ok) {
    pages.appendChild(el('p', 'issue error', snap.error));
    return;
  }
  if (snap.noProject) {
    pages.appendChild(el('p', 'empty', 'No project open. Create one, or open a folder.'));
    return;
  }
  if (!snap.steps.length) {
    pages.appendChild(el('p', 'empty',
      'Queue is empty. Capture a frame with the Pentool Studio Plugin in Figma.'));
  }

  // problems keyed by the thing they are about, so they render next to it
  const byWhere = {};
  for (const p of snap.problems) (byWhere[p.where] = byWhere[p.where] || []).push(p);

  const order = [];
  const grouped = {};
  for (const s of snap.steps) {
    if (!grouped[s.page]) { grouped[s.page] = []; order.push(s.page); }
    grouped[s.page].push(s);
  }

  for (const pageName of order) {
    const steps = grouped[pageName];
    const box = el('div', 'page');
    const h = el('h2');
    h.appendChild(el('span', null, pageName));
    h.appendChild(el('span', 'file', steps[0].pageFile));
    // Scoped to this page: one section building elsewhere used to put "Stop
    // build" on every page card, so the button lied about what it would stop.
    // `stalled` too: a wedged run is exactly when you need the stop button.
    const anyBuilding = steps.some((s) => ['building', 'stalled'].indexOf(s.status || '') !== -1);
    if (anyBuilding) {
      const stop = el('button', 'danger', 'Stop build');
      stop.title = 'Interrupt the agent (Esc)';
      stop.onclick = async () => {
        const r = await window.pentool.stopBuild();
        r.ok ? note('Sent interrupt.', 'success') : note(r.error || 'could not stop', 'error');
      };
      h.appendChild(stop);
    } else {
      const build = el('button', 'primary', 'Start build');
      build.onclick = async () => {
        const r = await window.pentool.startBuild(pageName);
        if (!r.ok) note(r.error, 'error');
        else openDrawer();
      };
      h.appendChild(build);
    }
    box.appendChild(h);

    steps.forEach((s, i) => {
      const row = el('div', 'sec');
      row.draggable = true;
      // reorderSections indexes the raw `sections:` list. Using the rendered
      // position meant any entry resolve() skipped — an unknown section, a bad
      // frontmatter — shifted every index after it and the drop moved a
      // different section than the one under the cursor.
      row.dataset.index = String(s.manifestIndex != null ? s.manifestIndex : i);
      row.dataset.pageFile = s.pageFile;

      row.appendChild(el('span', 'grip', '≡'));

      // Status comes from resolve(): _done/ and _state.json, never scraped from
      // the agent's output, so it stays right when its formatting changes.
      const status = s.status || (s.built ? 'done' : 'queued');
      if (status === 'done') row.classList.add('is-done');

      // Title over meta, the way the kit lists records.
      const lines = el('div', 'lines');
      const name = el('span', 'name', s.section);
      name.title = 'Open section.md';
      name.onclick = () => window.pentool.openSection(s.dir);
      lines.appendChild(name);

      const bits = [s.build];
      if (s.assets.length) bits.push(s.assets.length + ' asset' + (s.assets.length === 1 ? '' : 's'));
      if (s.reuse.length) bits.push('reuse ' + s.reuse.join(', '));
      const meta = el('span', 'meta', bits.join(' · '));
      lines.appendChild(meta);

      /* The last line of build-log.md — what the agent is doing to this section
         right now. It was computed all along and put in a `title`, so the only
         live signal in the whole window was behind a hover nobody knew to try. */
      if (s.progress && s.progress.note && (status === 'building' || status === 'stalled')) {
        const live = el('span', 'note-line', s.progress.note);
        live.title = s.progress.note;          // the untruncated text, still
        if (status === 'stalled') live.classList.add('cold');
        lines.appendChild(live);
      }
      row.appendChild(lines);

      row.appendChild(el('span', 'state-word st-' + status, status));

      const actions = el('div', 'actions');
      // The build mode already reads in the meta line; clicking it there toggles.
      const meta2 = lines.querySelector('.meta');
      meta2.title = 'Click to toggle static / component';
      meta2.style.cursor = 'pointer';
      meta2.onclick = async () => {
        const next = s.build === 'static' ? 'component' : 'static';
        const r = await window.pentool.setBuildMode(s.dir, next);
        if (!r.ok) note('could not change mode: ' + r.error, 'error');
      };

      const del = el('button', 'ghost icon');
      del.setAttribute('aria-label', 'Remove ' + s.section);
      del.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">' +
        '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8h6l.5-8" stroke="currentColor" ' +
        'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      del.title = 'Take it off this page, or off the queue entirely';
      del.onclick = async (e) => {
        e.stopPropagation();
        const both = confirm(
          'Remove "' + s.section + '" from ' + s.page + '.\n\n' +
          'OK also moves the captured section to queue/_trash/ so it is gone from the queue.\n' +
          'Cancel just takes it off this page and leaves the capture in place.');
        const r = await window.pentool.removeSection({
          section: s.section, pageFile: s.pageFile, alsoDelete: both
        });
        // "Removed from no page" is a success, and the old severity guess
        // turned its "no " into a red note that never went away.
        r.ok
          ? note('Removed from ' + (r.pages.join(', ') || 'no page') +
                 (r.trashed ? ' → ' + r.trashed : ''), 'success')
          : note(r.error || 'could not remove', 'error');
      };
      actions.appendChild(del);

      /* Only on something already built — the point of it is to undo the
         "done", and offering it on a queued section would be noise. */
      if (status === 'done') {
        const again = el('button', 'ghost tiny', 'Build again');
        again.title = 'Forget that this section was built, so it can be built again';
        again.onclick = (e) => { e.stopPropagation(); openRebuild(s); };
        actions.appendChild(again);
      }

      const attach = el('button', 'ghost tiny', 'Claude');
      attach.title = 'Give the agent this section as context';
      attach.onclick = async (e) => {
        e.stopPropagation();
        const r = await window.pentool.attachSection(s);
        r.ok ? note('Attached ' + s.section + ' — press return to send.', 'success')
             : note(r.error || 'could not attach', 'error');
        if (r.ok) openDrawer();
      };
      actions.appendChild(attach);
      row.appendChild(actions);

      wireDrag(row);
      box.appendChild(row);

      for (const p of byWhere[s.section] || []) {
        box.appendChild(el('div', 'issue ' + p.level, p.msg));
      }
    });

    for (const p of byWhere[steps[0].pageFile.replace(/\.md$/, '')] || []) {
      box.appendChild(el('div', 'issue ' + p.level, p.msg));
    }
    pages.appendChild(box);
  }

  // problems that belong to no rendered section (orphans, config, parse errors)
  const shown = new Set(snap.steps.map((s) => s.section));
  const rest = snap.problems.filter((p) => !shown.has(p.where));
  for (const p of rest) pages.appendChild(el('div', 'issue ' + p.level, p.where + ': ' + p.msg));

  renderProgress(snap);
}

function renderProgress(snap) {
  const box = $('progress');
  box.textContent = '';
  // One source for status, so this pane and the queue can never disagree.
  const statusOf = (s) => s.status || (s.built ? 'done' : 'queued');
  const MARK = { done: '✓', building: '◐', stalled: '!', blocked: '!', queued: '○' };

  const active = snap.steps.filter((s) => statusOf(s) !== 'queued');
  const list = active.length ? active : snap.steps;
  if (!list.length) { box.appendChild(el('p', 'empty', 'Nothing queued.')); return; }

  for (const s of list) {
    const st = statusOf(s);
    const row = el('div', 'prow');
    row.appendChild(el('span', 'status st-' + st, MARK[st] || '○'));
    row.appendChild(el('span', 'n', s.section));
    const bits = [];
    if (s.assets.length) bits.push(s.assets.length + ' asset(s)');
    if (s.reuse.length) bits.push('reuse ' + s.reuse.join(', '));
    if (s.cms) bits.push('cms ' + s.cms.collection);
    row.appendChild(el('span', 'detail', s.progress.note || bits.join(' · ')));
    box.appendChild(row);
  }
}

/* ─────────────────────────── drag to reorder ────────────────────────── */

let dragFrom = null;
function wireDrag(row) {
  row.addEventListener('dragstart', () => {
    dragFrom = { index: Number(row.dataset.index), pageFile: row.dataset.pageFile };
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.querySelectorAll('.sec.over').forEach((n) => n.classList.remove('over'));
  });
  row.addEventListener('dragover', (e) => {
    if (!dragFrom || row.dataset.pageFile !== dragFrom.pageFile) return;
    e.preventDefault();
    row.classList.add('over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('over');
    if (!dragFrom || row.dataset.pageFile !== dragFrom.pageFile) return;
    const to = Number(row.dataset.index);
    if (to === dragFrom.index) return;
    const r = await window.pentool.reorder(dragFrom.pageFile, dragFrom.index, to);
    if (!r.ok) note('reorder failed: ' + r.error, 'error');
    dragFrom = null;
  });
}

/* ──────────────────────────── prompt + pty ──────────────────────────── */

function sendToClaude(text) {
  if (window.__agentMode === 'messages') { window.pentool.say(text); return; }
  window.pentool.ptyWrite(text + '\r');
  note('sent: ' + text, null);
}

let flashTimer = null;
/* The kit has a Note for this. Borrowing the prompt field's placeholder was a
   workaround: it vanished the moment you typed, and could not show severity. */
function note(msg, variant) {
  let stack = $('noteStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'noteStack';
    stack.className = 'note-stack';
    document.body.appendChild(stack);
  }
  const el_ = document.createElement('div');
  el_.className = 'note' + (variant ? ' ' + variant : '');
  el_.setAttribute('role', variant === 'error' ? 'alert' : 'status');

  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = variant === 'success' ? '✓' : variant === 'error' ? '!'
                   : variant === 'warn' ? '▲' : '·';

  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = msg;

  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.onclick = () => el_.remove();

  el_.appendChild(mark); el_.appendChild(body); el_.appendChild(close);
  stack.appendChild(el_);
  // Errors and warnings stay until dismissed; the rest are transient. A warning
  // says something was saved but will not build — it has to be read to be acted on.
  if (variant !== 'error' && variant !== 'warn') setTimeout(() => el_.remove(), 4000);
}


$('promptForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('prompt').value.trim();
  if (!v) return;
  sendToClaude(v);
  $('prompt').value = '';
};

/* ───────────────────────────── terminal ─────────────────────────────── */

const term = new Terminal({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12, cursorBlink: true,
  theme: { background: '#14161a', foreground: '#e6e8ec' }
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($('term'));

term.onData((d) => window.pentool.ptyWrite(d));
window.pentool.onPtyData((d) => term.write(d));

function refit() {
  if ($('drawer').classList.contains('closed')) return;
  try {
    fit.fit();
    window.pentool.ptyResize(term.cols, term.rows);
  } catch (e) { /* not laid out yet */ }
}

function openDrawer() {
  $('drawer').classList.remove('closed');
  remember({ drawer: 'open' });
  setTimeout(refit, 30);
}

$('drawerToggle').onclick = () => {
  const closed = $('drawer').classList.toggle('closed');
  remember({ drawer: closed ? 'closed' : 'open' });
  setTimeout(refit, 30);
};
window.addEventListener('resize', refit);

/* ────────────────────────────── startup ─────────────────────────────── */

/* The header's one safety light. It used to report whether a *snapshot* existed —
   a JSON record that cannot restore anything — which meant it could read ✓ while
   the site had no way back at all. It reports the only thing that matters now:
   has this session confirmed a Webflow restore point. */
async function refreshBackup() {
  const st = await window.pentool.backupStatus();
  const tag = $('snapTag');

  if (st.noProject) { tag.textContent = ''; tag.className = 'tag'; tag.title = ''; return; }

  if (!st.answered) {
    tag.textContent = 'backup?';
    tag.className = 'tag bad';
    tag.title = (st.reason || 'this session has not confirmed a Webflow backup') +
                ' — run /webflow-backup before building';
    return;
  }
  if (st.answer === 'skipped') {
    tag.textContent = 'no backup';
    tag.className = 'tag bad';
    tag.title = 'You chose to build without a restore point. Anything written must be undone by hand.';
    return;
  }
  tag.textContent = 'backup ✓';
  tag.className = 'tag';
  tag.title = 'A Webflow restore point was confirmed for this session' +
              (st.at ? ', ' + st.at : '') + '. Restore it in the Designer if a build goes wrong.';
}
setInterval(refreshBackup, 5000);
refreshBackup();

/* A question in a collapsed drawer is not a question. When the agent is asked to
   raise the backup prompt, put the panel that shows it in front of the user. */
window.pentool.onAttention((a) => {
  if (!a || a.reason !== 'backup') return;
  // Messages mode renders the agent's question in the panel; terminal mode has
  // it inside the drawer, which is collapsed by default.
  if (window.__agentMode === 'messages') setView('messages');
  else openDrawer();
  note('Claude is asking about a Webflow backup before this session builds anything.', 'warn');
});

window.pentool.onQueue((s) => { render(s); refreshBackup(); });
window.pentool.onProject(renderProject);
window.pentool.onProjects(renderProjects);
window.pentool.getQueue().then(render);
window.pentool.agentMode().then((m) => { window.__agentMode = m; paintAgentMode(); });

// Reopen where it was left.
{
  const was = recall();
  setView(was.view === 'messages' ? 'messages' : 'progress');
  if (was.drawer === 'open') { $('drawer').classList.remove('closed'); setTimeout(refit, 60); }
}
window.pentool.listProjects().then((p) => {
  renderProjects(p);
  renderProject(p.active ? { ok: true, name: p.activeName } : { ok: false });
});
window.pentool.getBridge().then((b) => {
  const ok = b.state === 'running';
  $('bridgeDot').className = 'dot ' + (ok ? 'ok' : 'err');
  $('bridgeText').textContent = ok ? 'bridge :' + b.port : (b.error || 'bridge ' + b.state);
  $('copyToken').hidden = !ok;
});
