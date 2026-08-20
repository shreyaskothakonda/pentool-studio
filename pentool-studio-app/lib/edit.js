// Surgical edits to queue manifests.
//
// The UI reorders sections and toggles build mode. Parsing to a tree and
// serialising back would destroy comments, blank lines and alignment, so these
// operate on the original text and change only the bytes they must. Everything
// outside the touched region comes through byte-identical.

class EditError extends Error {
  constructor(msg) { super(msg); this.name = 'EditError'; }
}

const FM_OPEN = /^---[ \t]*\r?\n/;

// Returns { open, close } line indices of the frontmatter fence, or throws.
function frontmatterBounds(lines, raw) {
  if (!FM_OPEN.test(raw)) throw new EditError('no --- frontmatter block');
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) { close = i; break; }
  }
  if (close === -1) throw new EditError('unterminated frontmatter block');
  return { open: 0, close };
}

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => l.trim() === '';
const isComment = (l) => /^\s*#/.test(l);

/**
 * Locate the `sections:` block and split it into movable items.
 *
 * An item is its `- ` line plus everything that follows until the next `- ` at
 * the same indent. Comment and blank lines sitting immediately before a `- `
 * attach to the item that follows them, which is how a human reads them.
 * Anything trailing after the last item stays put as a tail.
 */
function parseSections(text) {
  const raw = String(text);
  const lines = raw.split('\n');
  const { close } = frontmatterBounds(lines, raw);

  let start = -1;
  for (let i = 1; i < close; i++) {
    if (/^sections:[ \t]*(#.*)?$/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) throw new EditError('no top-level `sections:` key in the frontmatter');

  // The block runs to the first non-blank line back at column 0, or the fence.
  let end = close;
  for (let i = start + 1; i < close; i++) {
    if (!isBlank(lines[i]) && indentOf(lines[i]) === 0) { end = i; break; }
  }

  const body = lines.slice(start + 1, end);
  const dashIndents = body.filter((l) => /^\s*- /.test(l)).map(indentOf);
  if (!dashIndents.length) throw new EditError('`sections:` has no list items');
  const itemIndent = Math.min.apply(null, dashIndents);

  const items = [];
  let pending = [];
  for (const line of body) {
    const isItemStart = /^\s*- /.test(line) && indentOf(line) === itemIndent;
    if (isItemStart) {
      items.push(pending.concat([line]));
      pending = [];
    } else if (!items.length) {
      pending.push(line);
    } else if (isBlank(line) || (isComment(line) && indentOf(line) === itemIndent)) {
      // Might belong to the next item; hold it until we know.
      pending.push(line);
    } else {
      items[items.length - 1] = items[items.length - 1].concat(pending, [line]);
      pending = [];
    }
  }

  return { lines, start, end, items, tail: pending, itemIndent };
}

/** Names, in build order — handy for the UI and for asserting in tests. */
function sectionOrder(text) {
  return parseSections(text).items.map((item) => {
    for (const line of item) {
      const m = /^\s*-\s+(?:name:\s*)?(.+?)\s*(?:#.*)?$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
    return null;
  });
}

/**
 * Move one section from index `from` to index `to`, preserving every comment,
 * blank line and nested property that travelled with it.
 */
function reorderSections(text, from, to) {
  const p = parseSections(text);
  const n = p.items.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new EditError('from and to must be integers');
  }
  if (from < 0 || from >= n) throw new EditError(`from ${from} is out of range (0..${n - 1})`);
  if (to < 0 || to >= n) throw new EditError(`to ${to} is out of range (0..${n - 1})`);
  if (from === to) return String(text);

  const items = p.items.slice();
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);

  const rebuilt = [].concat.apply([], items).concat(p.tail);
  const out = p.lines.slice(0, p.start + 1).concat(rebuilt, p.lines.slice(p.end));
  return out.join('\n');
}

/**
 * Append a section to a page manifest, keeping every comment and blank line.
 *
 * Idempotent by design: the plugin re-sends a section whenever you recapture it,
 * and a manifest that grew a duplicate entry on every capture would build the
 * same section twice on the page.
 */
function appendSection(text, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new EditError('section name is empty');

  // A freshly created manifest has `sections:` and nothing under it, which
  // parseSections rejects — there is no list to parse yet. Seed the first item.
  let p;
  try {
    if (sectionOrder(text).indexOf(clean) !== -1) return String(text);
    p = parseSections(text);
  } catch (e) {
    if (!/no list items/.test(e.message)) throw e;
    const lines = String(text).split('\n');
    const { close } = frontmatterBounds(lines, String(text));
    for (let i = 1; i < close; i++) {
      if (/^sections:[ \t]*$/.test(lines[i])) {
        lines.splice(i + 1, 0, '  - ' + clean);
        return lines.join('\n');
      }
    }
    throw new EditError('no `sections:` key to append to');
  }
  // Match the indent already in use so a hand-formatted manifest stays tidy.
  const sample = p.items.length ? p.items[p.items.length - 1].filter((l) => /^\s*-\s/.test(l))[0] : null;
  const indent = sample ? sample.slice(0, sample.length - sample.trimStart().length) : '  ';

  const items = p.items.concat([[indent + '- ' + clean]]);
  const rebuilt = [].concat.apply([], items).concat(p.tail);
  return p.lines.slice(0, p.start + 1).concat(rebuilt, p.lines.slice(p.end)).join('\n');
}

/**
 * Drop a section from a page manifest, taking its attached comments and nested
 * properties with it. Returns the text unchanged when the section is not listed,
 * so removing from every page is safe to call blindly.
 */
function removeSection(text, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new EditError('section name is empty');

  let order;
  try { order = sectionOrder(text); }
  catch (e) {
    if (/no list items/.test(e.message)) return String(text);
    throw e;
  }
  const at = order.indexOf(clean);
  if (at === -1) return String(text);

  const p = parseSections(text);
  const items = p.items.slice();
  items.splice(at, 1);

  // Removing the last item leaves `sections:` with nothing under it, which
  // parseSections refuses to read back. Keep the key and let the caller decide
  // whether an empty page is worth deleting.
  const rebuilt = [].concat.apply([], items).concat(p.tail);
  return p.lines.slice(0, p.start + 1).concat(rebuilt, p.lines.slice(p.end)).join('\n');
}

/** A page manifest for a slug the queue has never seen. */
function newPageManifest(slug, defaults) {
  const d = defaults || {};
  const lines = ['---', 'page: ' + slug];
  if (d.title) lines.push('title: ' + d.title);
  // Only set when the page does not exist in Webflow yet. Left off, the builder
  // expects to find the page and stops rather than inventing one.
  if (d.createIfMissing) lines.push('create_if_missing: true');
  lines.push('anchor: ' + (d.anchor || 'main-wrapper'));
  lines.push('position: ' + (d.position || 'append'));
  lines.push('sections:', '---', '');
  return lines.join('\n');
}

const BUILD_MODES = ['static', 'component', 'update'];

/**
 * Rewrite the `build:` scalar in a section's frontmatter, touching one line and
 * keeping its indentation, spacing and trailing comment intact. Inserts the key
 * after `name:` when it is absent.
 */
function setBuildMode(text, mode) {
  if (BUILD_MODES.indexOf(mode) === -1) {
    throw new EditError(`build mode must be one of ${BUILD_MODES.join(', ')} — got ${JSON.stringify(mode)}`);
  }
  const raw = String(text);
  const lines = raw.split('\n');
  const { close } = frontmatterBounds(lines, raw);

  for (let i = 1; i < close; i++) {
    const m = /^(build:)([ \t]*)(\S+)([ \t]*)(#.*)?$/.exec(lines[i]);
    if (m) {
      if (m[3] === mode) return raw;
      lines[i] = m[1] + m[2] + mode + (m[5] ? m[4] + m[5] : '');
      return lines.join('\n');
    }
  }

  let insertAt = 1;
  for (let i = 1; i < close; i++) {
    if (/^name:/.test(lines[i])) { insertAt = i + 1; break; }
  }
  lines.splice(insertAt, 0, 'build: ' + mode);
  return lines.join('\n');
}

module.exports = {
  reorderSections, setBuildMode, sectionOrder, parseSections, appendSection,
  removeSection, newPageManifest, EditError, BUILD_MODES
};
