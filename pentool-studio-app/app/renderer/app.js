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
});

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

function renderAgentEvent(e) {
  if (!e || !e.type) return;

  if (e.type === 'local-user') {
    const m = msgEl('user', 'you');
    m.appendChild(el('div', 'body', e.text));
    return addMsg(m);
  }

  if (e.type === 'assistant') {
    for (const c of (e.message && e.message.content) || []) {
      if (c.type === 'text' && c.text.trim()) {
        const m = msgEl('assistant', 'claude');
        m.appendChild(el('div', 'body', c.text.trim()));
        addMsg(m);
      } else if (c.type === 'tool_use') {
        const m = msgEl('tool');
        m.appendChild(el('span', 'name', c.name));
        // One line: the whole input is usually far too much to read inline.
        const inp = c.input || {};
        const gist = inp.file_path || inp.command || inp.pattern ||
          inp.style_name || inp.name || Object.keys(inp).join(', ');
        m.appendChild(el('span', 'arg', String(gist || '')));
        addMsg(m);
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
        note('Command copied — run it in a terminal, then restart the agent.', 'success');
      });
    }
  }
  if (payload.ok && payload.synced && payload.synced.length) {
    // Say it rather than fixing it silently: a project carries frozen copies of
    // lib/ and bin/, and this is the moment they stopped being stale.
    note('updated project tooling: ' + payload.synced.join(', '), null);
  }
}

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
    const anyBuilding = steps.some((s) => (s.status || '') === 'building');
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
      // build-log.md's last line is the only detail the status itself lacks.
      if (s.progress && s.progress.note) meta.title = s.progress.note;
      lines.appendChild(meta);
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
  const MARK = { done: '✓', building: '◐', blocked: '!', queued: '○' };

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

async function refreshSnapshot() {
  const st = await window.pentool.snapshotStatus();
  const tag = $('snapTag');
  // With no project there is nothing to have snapshotted, and the fall-through
  // branch used to claim "snapshot ✓".
  if (st.noProject) {
    tag.textContent = '';
    tag.className = 'tag';
    tag.title = '';
    return;
  }
  // Cannot tell. Distinct from "none taken" so the reason is not misread as a
  // finding, but still `bad`, because proceeding on an unknown is the risk.
  if (st.unknown) {
    tag.textContent = 'snapshot ?';
    tag.className = 'tag bad';
    tag.title = st.reason;
    return;
  }
  if (st.required) {
    tag.textContent = 'no snapshot';
    tag.className = 'tag bad';
    tag.title = st.reason + ' — run /webflow-snapshot before building';
  } else if (st.newest && !st.newest.meta.restorePointConfirmed) {
    tag.textContent = 'snapshot · no restore point';
    tag.className = 'tag';
    tag.title = 'A diffable record exists, but nothing can restore the site.';
  } else {
    tag.textContent = 'snapshot ✓';
    tag.className = 'tag';
    tag.title = st.newest ? 'taken ' + st.newest.meta.takenAt : '';
  }
}
setInterval(refreshSnapshot, 5000);
refreshSnapshot();

window.pentool.onQueue((s) => { render(s); refreshSnapshot(); });
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
