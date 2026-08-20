// A deliberately small YAML subset — enough for the queue manifests and nothing
// more. Anything outside the subset is a hard error with a line number, never a
// silent misread, because a misparsed manifest writes the wrong thing to a live
// Webflow site and there is no undo.
//
// Supported: nested maps, lists of scalars, lists of maps, quoted and bare
// scalars, booleans, numbers, null, and # comments.
// Not supported: anchors, multi-line strings, flow collections, multi-doc.

class YamlError extends Error {
  constructor(msg, line) {
    super(line ? `line ${line}: ${msg}` : msg);
    this.name = 'YamlError';
    this.line = line || null;
  }
}

// Strips a trailing comment without touching a # inside quotes.
//
// A quote only opens a quoted scalar where a value can begin: at the start of the
// line, or straight after the `:` or `-` that introduces one. Treating every
// quote character as an opener meant an apostrophe in a bare word — Don't, it's,
// the client's — opened a string that never closed, and the rest of the line
// including its trailing comment was swallowed into the value.
function stripComment(raw) {
  let quote = null;
  let valueStart = true;   // nothing but whitespace seen yet
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote && raw[i - 1] !== '\\') quote = null;
      continue;
    }
    if ((c === '"' || c === "'") && valueStart) {
      quote = c;
      valueStart = false;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
    // `:` and `-` introduce a value; whitespace after them does not end that.
    if (c === ':' || c === '-') valueStart = true;
    else if (!/\s/.test(c)) valueStart = false;
  }
  return raw;
}

function scalar(text, line) {
  const t = text.trim();
  if (t === '') return '';
  const q = t[0];
  if ((q === '"' || q === "'") && t.length > 1) {
    if (t[t.length - 1] !== q) throw new YamlError('unterminated quoted string', line);
    return t.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

function tokenize(src) {
  const out = [];
  src.split('\n').forEach((raw, idx) => {
    if (raw.indexOf('\t') !== -1) {
      throw new YamlError('tabs are not valid indentation — use spaces', idx + 1);
    }
    const body = stripComment(raw);
    if (!body.trim()) return;
    out.push({
      indent: body.length - body.trimStart().length,
      text: body.trim(),
      line: idx + 1
    });
  });
  return out;
}

// Every line strictly deeper than `indent`, starting at i.
function childrenOf(lines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent > indent) out.push(lines[i++]);
  return out;
}

function parseNode(lines) {
  if (!lines.length) return null;
  return lines[0].text.startsWith('- ') || lines[0].text === '-'
    ? parseList(lines)
    : parseMap(lines);
}

function parseList(lines) {
  const indent = lines[0].indent;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent !== indent) throw new YamlError('inconsistent list indentation', ln.line);
    if (!ln.text.startsWith('- ') && ln.text !== '-') {
      throw new YamlError('expected a list item starting with "- "', ln.line);
    }
    const content = ln.text === '-' ? '' : ln.text.slice(2).trim();
    const nested = childrenOf(lines, i + 1, indent);

    if (content && /^[^:]+:(\s|$)/.test(content)) {
      // "- key: value" opens a map; deeper lines belong to the same map.
      const synthetic = [{ indent: indent + 2, text: content, line: ln.line }]
        .concat(nested.map((l) => ({ ...l, indent: indent + 2 + (l.indent - (nested[0] ? nested[0].indent : indent + 2)) })));
      out.push(parseMap(synthetic));
    } else if (content) {
      if (nested.length) throw new YamlError('a scalar list item cannot have children', ln.line);
      out.push(scalar(content, ln.line));
    } else {
      if (!nested.length) throw new YamlError('empty list item', ln.line);
      out.push(parseNode(nested));
    }
    i += 1 + nested.length;
  }
  return out;
}

function parseMap(lines) {
  const indent = lines[0].indent;
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent !== indent) throw new YamlError('inconsistent map indentation', ln.line);
    const m = /^([^:]+):(?:\s+(.*))?$/.exec(ln.text);
    if (!m) throw new YamlError(`expected "key: value", got ${JSON.stringify(ln.text)}`, ln.line);
    const key = m[1].trim();
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new YamlError(`duplicate key ${JSON.stringify(key)}`, ln.line);
    }
    const inline = (m[2] || '').trim();
    const nested = childrenOf(lines, i + 1, indent);

    if (inline !== '') {
      if (nested.length) {
        throw new YamlError(`key ${JSON.stringify(key)} has both an inline value and children`, ln.line);
      }
      out[key] = scalar(inline, ln.line);
    } else {
      out[key] = nested.length ? parseNode(nested) : null;
    }
    i += 1 + nested.length;
  }
  return out;
}

function parseYaml(src) {
  const lines = tokenize(src);
  if (!lines.length) return {};
  return parseNode(lines);
}

// Splits "---\nfrontmatter\n---\nbody" into { data, body }.
function parseFrontmatter(src, label) {
  const text = String(src).replace(/^\uFEFF/, '');
  if (!/^---\s*\n/.test(text)) {
    throw new YamlError(`${label || 'file'} must start with a --- frontmatter block`);
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    throw new YamlError(`${label || 'file'} has an unterminated frontmatter block`);
  }
  const fm = text.slice(text.indexOf('\n') + 1, end);
  const rest = text.slice(end + 4).replace(/^[^\n]*\n?/, '');
  const data = parseYaml(fm);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new YamlError(`${label || 'file'} frontmatter must be a map`);
  }
  return { data, body: rest };
}

module.exports = { parseYaml, parseFrontmatter, YamlError };
