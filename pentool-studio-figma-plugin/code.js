// Pentool Studio — walks the current selection and emits everything needed to
// rebuild a design elsewhere. Single file on purpose: it imports straight from a
// manifest with zero tooling, and that is the whole value proposition.
//
// Two output targets share one traversal:
//   raw      — Figma vocabulary, the original validated contract
//   webflow  — Client-First / Relume classes, semantics and an a11y audit
//
// See plan.md for status, README.md for usage.

/* ════════════════════════════ project profile ════════════════════════════ */
/* These are DEFAULTS, not the answer. A connected project sends its own style
   guide from queue/_config.json and it replaces everything here — which is what
   makes [existing] mean anything on a site that is not the one this shipped
   with. Unconnected, or on a project that has not set one, these stand in.

   The values below are Relume v3.0 / Client-First v2.1. That project strips the
   margin-*, padding-* and spacer-* utilities and spaces with flex gap, so
   nothing here snaps a pixel value to a spacing class. */

const DEFAULT_PROFILE = {

  // Components already built in Webflow. Instances of these are referenced by
  // name and never walked — the builder must reuse them, not rebuild them.
  built: ['label', 'market-card', 'action-card'],

  // rem values are the Relume defaults. If your style guide overrides them,
  // correct them here — Pentool Studio picks the nearest match, so being wrong shifts
  // a class by one step rather than breaking anything.
  textSize: [[12, 'text-size-tiny'], [14, 'text-size-small'], [16, 'text-size-regular'],
             [18, 'text-size-medium'], [20, 'text-size-large']],
  iconEmbed: [[16, 'icon-embed-xxsmall'], [24, 'icon-embed-xsmall'], [32, 'icon-embed-small'],
              [48, 'icon-embed-medium'], [64, 'icon-embed-large'], [80, 'icon-embed-xlarge']],
  weight: { 300: 'text-weight-light', 400: 'text-weight-normal', 500: 'text-weight-medium',
            600: 'text-weight-semibold', 700: 'text-weight-bold', 800: 'text-weight-xbold' },

  // Every class the style guide ships. Used to mark a proposal [existing]
  // rather than [new], so the builder knows what it does not have to create.
  known: new Set([
    'page-wrapper', 'main-wrapper', 'padding-global', 'button-group',
    'container-small', 'container-medium', 'container-large',
    'padding-section-small', 'padding-section-medium', 'padding-section-large',
    'heading-style-display', 'heading-style-h1', 'heading-style-h2', 'heading-style-h3',
    'heading-style-h4', 'heading-style-h5', 'heading-style-h6',
    'text-size-tiny', 'text-size-small', 'text-size-regular', 'text-size-medium', 'text-size-large',
    'text-weight-light', 'text-weight-normal', 'text-weight-medium', 'text-weight-semibold',
    'text-weight-bold', 'text-weight-xbold',
    'text-style-italic', 'text-style-strikethrough', 'text-style-allcaps', 'text-style-nowrap',
    'text-style-quote', 'text-style-link', 'text-style-2lines', 'text-style-3lines',
    'text-style-muted', 'text-style-tagline',
    'text-align-left', 'text-align-center', 'text-align-right', 'text-rich-text',
    'icon-embed-xxsmall', 'icon-embed-xsmall', 'icon-embed-small', 'icon-embed-medium',
    'icon-embed-large', 'icon-embed-xlarge', 'icon-embed-custom1',
    'aspect-ratio-square', 'aspect-ratio-portrait', 'aspect-ratio-landscape',
    'aspect-ratio-widescreen',
    'overflow-visible', 'overflow-hidden', 'overflow-auto', 'overflow-scroll',
    'hide', 'hide-tablet', 'hide-mobile-portrait', 'hide-mobile-landscape',
    'layer', 'spacing-clean', 'align-center', 'z-index-1', 'z-index-2',
    'display-inlineflex', 'margin-top-auto', 'inherit-color', 'truncate-width',
    'no-scrollbar', 'div-square', 'pointer-events-off', 'pointer-events-on',
    'button', 'is-secondary', 'is-small', 'is-link', 'is-icon', 'is-alternate',
    'tag', 'is-text', 'tab-link', 'tabs-menu', 'category-filter-link', 'category-filter-menu',
    'slider-arrow', 'slider-arrow-icon', 'slider-arrow-icon_default',
    'form_component', 'form_form', 'form_field-wrapper', 'form_field-label', 'form_input',
    'is-text-area', 'is-select-input', 'form_checkbox', 'form_checkbox-icon',
    'form_checkbox-label', 'form_radio', 'form_radio-icon', 'form_radio-label',
    'form_message-success', 'form_message-error'
  ]),

  // Restated at the point they bite. Sourced from real failures, see plan.md.
  quirks: [
    'set_text is silently ignored on DivBlock — write copy with set_settings key "text", then verify.',
    'Multiple classes need the combo pairing created first via create_style with parent_style_names.',
    'Embed "code" cannot be bound to a component prop — Webflow rejects the binding.'
  ]
};

/* The profile in force for the current capture. A connected project overrides
   it wholesale; nothing here is site-specific once that has happened. */
let PROFILE = DEFAULT_PROFILE;

// A project's queue/_config.json carries `styleGuide`. Every key is optional, so
// a project can correct only the size scale, or only the class list, and inherit
// the rest rather than restating a hundred class names to change one.
function useStyleGuide(sg) {
  if (!sg || typeof sg !== 'object') { PROFILE = DEFAULT_PROFILE; return PROFILE; }
  PROFILE = {
    built: Array.isArray(sg.built) ? sg.built : DEFAULT_PROFILE.built,
    textSize: Array.isArray(sg.textSize) ? sg.textSize : DEFAULT_PROFILE.textSize,
    iconEmbed: Array.isArray(sg.iconEmbed) ? sg.iconEmbed : DEFAULT_PROFILE.iconEmbed,
    weight: sg.weight && typeof sg.weight === 'object' ? sg.weight : DEFAULT_PROFILE.weight,
    // An empty list is a real answer — a site with no style guide yet — so only
    // a missing key falls back.
    known: Array.isArray(sg.known) ? new Set(sg.known) : DEFAULT_PROFILE.known,
    quirks: Array.isArray(sg.quirks) ? sg.quirks : DEFAULT_PROFILE.quirks
  };
  return PROFILE;
}

const REM = 16;
const ICON_MAX_PX = 96;
const MAX_CHARS = 180000;

const VECTOR_TYPES = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'POLYGON', 'ELLIPSE', 'RECTANGLE'
]);

// Names Figma auto-generates. A node called one of these tells us nothing, so
// its class name gets derived from structure instead.
const JUNK_NAME = /^(frame|group|rectangle|ellipse|vector|line|star|polygon|component|instance|union|subtract|intersect|exclude|mask|shape)[\s._-]*\d*$/i;

// NOTE: never set figma.skipInvisibleInstanceChildren — hidden layers are how
// per-state diffs are read, and skipping them would silently break that.

const DEFAULT_SIZE = { w: 560, h: 680 };

figma.showUI(__html__, { width: DEFAULT_SIZE.w, height: DEFAULT_SIZE.h });

/* ═══════════════════════════════ utilities ═══════════════════════════════ */

const round = (n) => Math.round(n * 100) / 100;

function rem(px) {
  if (px == null || px === 0) return '0';
  return (Math.round((px / REM) * 1000) / 1000) + 'rem';
}

// Client-First is rem-based, so every dimension above 1px converts. Hairlines
// stay in px on purpose: a 1px border should not scale with the root font size,
// and 0.0625rem reads as a mistake rather than an intent.
function unit(px) {
  if (px == null || px === 0) return '0';
  if (typeof px !== 'number') return String(px);
  return Math.abs(px) <= 1 ? round(px) + 'px' : rem(px);
}

function hex(c) {
  const f = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return ('#' + f(c.r) + f(c.g) + f(c.b)).toUpperCase();
}

function slug(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Closest entry in a [px, class] table. On an exact tie the earlier (smaller)
// entry wins — tables are ordered ascending, so 13px lands on tiny(12) rather
// than small(14). Arbitrary but deterministic; a tie means the design sits
// between two steps and either answer needs a human glance.
function nearest(table, value) {
  let best = null, bestDiff = Infinity;
  for (const [px, cls] of table) {
    const d = Math.abs(px - value);
    if (d < bestDiff) { bestDiff = d; best = cls; }
  }
  return best;
}

/* ── WCAG contrast. Pentool Studio holds both the text colour and the background,
      so it can answer this outright rather than flagging it for a human. ── */

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hexStr) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexStr || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) +
         0.7152 * channel((n >> 8) & 255) +
         0.0722 * channel(n & 255);
}

function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la == null || lb == null) return null;
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/* ═════════════════════════ variables and styles ═════════════════════════ */

const varCache = new Map();

async function resolveVariable(id) {
  if (varCache.has(id)) return varCache.get(id);
  let info = null;
  try {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) {
      info = { id: id, name: v.name, type: v.resolvedType, collection: null, modes: null };
      try {
        const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
        if (col) {
          info.collection = col.name;
          // Only worth printing modes when there is more than one.
          if (col.modes && col.modes.length > 1) {
            info.modes = col.modes.map((m) => {
              const raw = v.valuesByMode[m.modeId];
              return { name: m.name, value: formatVarValue(raw) };
            });
          }
        }
      } catch (e) { /* collection may live in a library */ }
    }
  } catch (e) { /* unreachable variable */ }
  varCache.set(id, info);
  return info;
}

function formatVarValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return String(round(raw));
  if (typeof raw === 'string' || typeof raw === 'boolean') return String(raw);
  if (raw.type === 'VARIABLE_ALIAS') return '→ alias';
  if (raw.r != null) {
    const h = hex(raw);
    return raw.a != null && raw.a < 1 ? h + ' ' + Math.round(raw.a * 100) + '%' : h;
  }
  return null;
}

// Resolves a single bound scalar property (itemSpacing, paddingTop, radius…).
async function boundName(node, prop, ctx) {
  const bv = node.boundVariables;
  if (!bv || !bv[prop]) return null;
  const alias = bv[prop];
  if (!alias || !alias.id) return null;
  const info = await resolveVariable(alias.id);
  if (info && info.name) { ctx.tokens.set(info.id, info); return info.name; }
  // A library variable resolves to nothing on a free plan. Say so rather than
  // silently degrading to a bare number.
  return '(library variable, name unavailable)';
}

const styleCache = new Map();

async function styleName(id) {
  if (!id || id === figma.mixed) return null;
  if (styleCache.has(id)) return styleCache.get(id);
  let name = null;
  try {
    const st = await figma.getStyleByIdAsync(id);
    if (st) name = st.name;
  } catch (e) { /* library style */ }
  styleCache.set(id, name);
  return name;
}

/* ═════════════════════════════ model building ═════════════════════════════ */

async function paintsToModel(paints, bound, ctx) {
  if (!paints || paints === figma.mixed || !paints.length) return null;
  const out = [];
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      const entry = { kind: 'solid', hex: hex(p.color), token: null, opacity: null };
      if (p.opacity != null && p.opacity < 1) entry.opacity = Math.round(p.opacity * 100);
      const alias = bound && bound[i];
      if (alias && alias.id) {
        const info = await resolveVariable(alias.id);
        if (info && info.name) { entry.token = info.name; ctx.tokens.set(info.id, info); }
        else entry.token = '(library variable, name unavailable)';
      }
      out.push(entry);
    } else if (p.type === 'IMAGE') {
      out.push({ kind: 'image', scaleMode: p.scaleMode || null });
    } else if (p.type.indexOf('GRADIENT') === 0) {
      const stops = (p.gradientStops || []).map((st) =>
        hex(st.color) + (st.color.a < 1 ? ' ' + Math.round(st.color.a * 100) + '%' : '')
      );
      out.push({ kind: 'gradient', type: p.type.toLowerCase(), stops: stops });
    }
  }
  return out.length ? out : null;
}

function paintsToString(list) {
  if (!list) return null;
  return list.map((p) => {
    if (p.kind === 'solid') {
      let s = p.hex + (p.opacity != null ? ' ' + p.opacity + '%' : '');
      return p.token ? p.token + ' (' + s + ')' : s;
    }
    if (p.kind === 'image') return 'IMAGE' + (p.scaleMode ? ' ' + p.scaleMode.toLowerCase() : '');
    return p.type + ' ' + p.stops.join(' -> ');
  }).join(', ');
}

function firstSolid(list) {
  if (!list) return null;
  for (const p of list) if (p.kind === 'solid') return p.hex;
  return null;
}

async function layoutToModel(node, ctx) {
  let src = node, inferred = false;

  if (!('layoutMode' in node) || node.layoutMode === 'NONE') {
    // Figma will tell us what auto-layout this hand-positioned frame would have.
    // That turns absolute soup into a flex rebuild.
    try {
      if ('inferredAutoLayout' in node && node.inferredAutoLayout) {
        src = node.inferredAutoLayout;
        inferred = true;
      } else return null;
    } catch (e) { return null; }
  }

  const mode = src.layoutMode;
  if (!mode || mode === 'NONE') return null;

  const m = {
    inferred: inferred,
    grid: mode === 'GRID',
    dir: mode === 'VERTICAL' ? 'column' : (mode === 'GRID' ? 'grid' : 'row'),
    gap: src.itemSpacing || 0,
    rowGap: null,
    pad: [src.paddingTop || 0, src.paddingRight || 0, src.paddingBottom || 0, src.paddingLeft || 0],
    justify: src.primaryAxisAlignItems || null,
    align: src.counterAxisAlignItems || null,
    wrap: src.layoutWrap === 'WRAP',
    sizeH: node.layoutSizingHorizontal || null,
    sizeV: node.layoutSizingVertical || null,
    cols: null, rows: null,
    tokens: {}
  };

  if (m.wrap && src.counterAxisSpacing != null) m.rowGap = src.counterAxisSpacing;

  if (m.grid) {
    m.cols = node.gridColumnCount != null ? node.gridColumnCount : null;
    m.rows = node.gridRowCount != null ? node.gridRowCount : null;
    if (node.gridColumnGap != null) m.gap = node.gridColumnGap;
    if (node.gridRowGap != null) m.rowGap = node.gridRowGap;
  }

  if (!inferred) {
    const t = {};
    const gapTok = await boundName(node, 'itemSpacing', ctx);
    if (gapTok) t.gap = gapTok;
    for (const [prop, key] of [['paddingTop', 'pt'], ['paddingRight', 'pr'],
                               ['paddingBottom', 'pb'], ['paddingLeft', 'pl']]) {
      const tok = await boundName(node, prop, ctx);
      if (tok) t[key] = tok;
    }
    m.tokens = t;
  }

  return m;
}

function layoutToString(m) {
  if (!m) return null;
  const bits = [m.dir];
  if (m.inferred) bits.push('(inferred)');
  if (m.grid && m.cols) bits.push('cols:' + m.cols);
  if (m.gap) bits.push('gap:' + round(m.gap) + (m.tokens.gap ? '[' + m.tokens.gap + ']' : ''));
  if (m.rowGap) bits.push('row-gap:' + round(m.rowGap));
  const p = m.pad.map(round);
  if (p.some((v) => v)) {
    const same = p[0] === p[1] && p[1] === p[2] && p[2] === p[3];
    bits.push('pad:' + (same ? p[0] : p.join(' ')));
  }
  if (m.justify && m.justify !== 'MIN') bits.push('justify:' + m.justify.toLowerCase());
  if (m.align && m.align !== 'MIN') bits.push('align:' + m.align.toLowerCase());
  if (m.wrap) bits.push('wrap');
  if (m.sizeH) bits.push('w:' + m.sizeH.toLowerCase());
  if (m.sizeV) bits.push('h:' + m.sizeV.toLowerCase());
  return bits.join(' ');
}

async function textToModel(node, ctx) {
  const t = {
    chars: node.characters,
    size: null, lineHeight: 'auto', family: null, style: null, weight: null,
    letter: null, case: null, decoration: null, align: null,
    styleName: null, truncate: null, maxLines: null, autoResize: null,
    segments: null, mixed: false, token: null
  };

  if (node.fontSize !== figma.mixed) t.size = round(node.fontSize);
  else t.mixed = true;

  const lh = node.lineHeight;
  if (lh && lh !== figma.mixed && lh.unit && lh.unit !== 'AUTO') {
    t.lineHeight = lh.unit === 'PERCENT' ? round(lh.value) + '%' : round(lh.value);
  }
  if (node.fontName && node.fontName !== figma.mixed) {
    t.family = node.fontName.family;
    t.style = node.fontName.style;
  } else if (node.fontName === figma.mixed) t.mixed = true;

  if (node.fontWeight && node.fontWeight !== figma.mixed) t.weight = node.fontWeight;

  const ls = node.letterSpacing;
  if (ls && ls !== figma.mixed && ls.value) {
    t.letter = round(ls.value) + (ls.unit === 'PERCENT' ? '%' : '');
  }
  if (node.textCase && node.textCase !== figma.mixed && node.textCase !== 'ORIGINAL') {
    t.case = node.textCase.toLowerCase();
  }
  if (node.textDecoration && node.textDecoration !== figma.mixed && node.textDecoration !== 'NONE') {
    t.decoration = node.textDecoration.toLowerCase();
  }
  if (node.textAlignHorizontal) t.align = node.textAlignHorizontal;
  if (node.textTruncation === 'ENDING') t.truncate = true;
  if (node.maxLines) t.maxLines = node.maxLines;
  if (node.textAutoResize) t.autoResize = node.textAutoResize;

  t.styleName = await styleName(node.textStyleId);

  const charTok = await boundName(node, 'characters', ctx);
  if (charTok) t.token = charTok;

  // Mixed styling used to drop every typography field on the floor. Read the
  // per-range segments instead so a bold word or an inline link survives.
  if (t.mixed) {
    try {
      const segs = node.getStyledTextSegments(
        ['fontName', 'fontSize', 'fontWeight', 'fills', 'textDecoration', 'hyperlink']
      );
      if (segs && segs.length) {
        t.segments = segs.map((s) => {
          const bits = [];
          if (s.fontSize) bits.push(round(s.fontSize) + 'px');
          if (s.fontName) bits.push(s.fontName.family + ' ' + s.fontName.style);
          if (s.fontWeight) bits.push('w' + s.fontWeight);
          if (s.textDecoration && s.textDecoration !== 'NONE') bits.push(s.textDecoration.toLowerCase());
          if (s.hyperlink) bits.push('link:' + (s.hyperlink.value || s.hyperlink.type));
          const solid = (s.fills || []).filter((f) => f.type === 'SOLID' && f.visible !== false)[0];
          if (solid) bits.push(hex(solid.color));
          return { text: s.characters, style: bits.join(' ') };
        });
      }
    } catch (e) { /* segments unavailable */ }
  }

  return t;
}

function textToString(t) {
  const bits = [];
  if (t.size) bits.push(t.size + '/' + t.lineHeight);
  if (t.family) bits.push(t.family + (t.style ? ' ' + t.style : ''));
  if (t.weight) bits.push('w' + t.weight);
  if (t.letter) bits.push('ls:' + t.letter);
  if (t.case) bits.push(t.case);
  if (t.decoration) bits.push(t.decoration);
  if (t.align && t.align !== 'LEFT') bits.push('align:' + t.align.toLowerCase());
  if (t.styleName) bits.push('style:' + t.styleName);
  if (t.truncate) bits.push('truncate' + (t.maxLines ? ':' + t.maxLines + 'lines' : ''));
  if (t.mixed && !bits.length) bits.push('mixed — see segments');
  return bits.join(' ');
}

function effectsToString(node) {
  if (!node.effects || node.effects === figma.mixed || !node.effects.length) return null;
  const out = node.effects.filter((e) => e.visible !== false).map((e) => {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const c = e.color;
      const a = c.a != null && c.a < 1 ? ' ' + Math.round(c.a * 100) + '%' : '';
      const label = e.type === 'INNER_SHADOW' ? 'inner-shadow' : 'shadow';
      return label + ' ' + round(e.offset.x) + ',' + round(e.offset.y) +
        ' blur:' + round(e.radius) + (e.spread ? ' spread:' + round(e.spread) : '') +
        ' ' + hex(c) + a;
    }
    return e.type.toLowerCase().replace(/_/g, '-') + (e.radius != null ? ' ' + round(e.radius) : '');
  });
  return out.length ? out.join(', ') : null;
}

// Effects as real CSS, so a [new] class definition is complete rather than
// leaving the builder to translate the Figma line by hand.
function effectsToCss(node) {
  if (!node.effects || node.effects === figma.mixed || !node.effects.length) return null;
  const live = node.effects.filter((e) => e.visible !== false);
  if (!live.length) return null;

  const shadows = [];
  let blur = null, backdrop = null;

  for (const e of live) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const c = e.color;
      const rgba = 'rgba(' + Math.round(c.r * 255) + ', ' + Math.round(c.g * 255) + ', ' +
        Math.round(c.b * 255) + ', ' + (c.a != null ? round(c.a) : 1) + ')';
      shadows.push(
        (e.type === 'INNER_SHADOW' ? 'inset ' : '') +
        unit(e.offset.x) + ' ' + unit(e.offset.y) + ' ' + unit(e.radius) +
        (e.spread ? ' ' + unit(e.spread) : '') + ' ' + rgba
      );
    } else if (e.type === 'LAYER_BLUR') {
      blur = unit(e.radius);
    } else if (e.type === 'BACKGROUND_BLUR') {
      backdrop = unit(e.radius);
    }
  }

  if (!shadows.length && !blur && !backdrop) return null;
  return { shadow: shadows.length ? shadows.join(', ') : null, blur: blur, backdrop: backdrop };
}

function radiusToString(node) {
  if (!('cornerRadius' in node)) return null;
  if (node.cornerRadius !== figma.mixed && node.cornerRadius) return String(round(node.cornerRadius));
  const c = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
  if (c.some((v) => v)) return c.map(round).join(' ');
  return null;
}

function reactionsToString(node) {
  if (!node.reactions || !node.reactions.length) return null;
  return node.reactions.map((rx) => {
    const t = rx.trigger ? rx.trigger.type : '?';
    const acts = rx.actions || (rx.action ? [rx.action] : []);
    const a = acts.length ? acts.map((x) => x.type).join('+') : '?';
    return t + ' -> ' + a;
  }).join(', ');
}

/* ═══════════════════════════ structural analysis ═══════════════════════════ */

function onlyVectors(n) {
  if (!('children' in n)) return VECTOR_TYPES.has(n.type);
  if (!n.children.length) return false;
  return n.children.every((c) => VECTOR_TYPES.has(c.type) || ('children' in c && onlyVectors(c)));
}

function isIcon(n) {
  if (VECTOR_TYPES.has(n.type) && n.type !== 'RECTANGLE') return true;
  const container = n.type === 'FRAME' || n.type === 'GROUP' ||
    n.type === 'INSTANCE' || n.type === 'COMPONENT';
  if (container && n.width <= ICON_MAX_PX && n.height <= ICON_MAX_PX) return onlyVectors(n);
  return false;
}

function hasImageFill(n) {
  const f = n.fills;
  return f && f !== figma.mixed && f.some((p) => p.type === 'IMAGE' && p.visible !== false);
}

function hasTextDescendant(n) {
  if (n.type === 'TEXT') return true;
  if (!('children' in n)) return false;
  return n.children.some(hasTextDescendant);
}

function isInteractive(n) {
  return !!(n.reactions && n.reactions.length);
}

// section / layout / component / element. Wrong sometimes by construction —
// the UI lets you pin the root, and every derived name is marked as inferred.
function inferRole(node, depth, parent) {
  const name = String(node.name || '');

  if (/^section[\s._-]/i.test(name) || /section$/i.test(name)) return 'section';
  if (depth === 0 && 'width' in node && node.width >= 1200) return 'section';

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return 'component';
  if (node.type === 'INSTANCE') return 'component';

  if (!('children' in node) || !node.children.length) return 'element';
  if (node.type === 'TEXT') return 'element';
  if (hasImageFill(node)) return 'element';
  if (isIcon(node)) return 'element';

  const hasSurface = !!(
    (node.fills && node.fills !== figma.mixed && node.fills.length) ||
    (node.strokes && node.strokes.length) ||
    ('cornerRadius' in node && node.cornerRadius)
  );

  // A wrapper that only arranges is layout; one with its own surface that also
  // holds mixed content reads as a self-contained component.
  if (hasSurface && hasTextDescendant(node) && node.children.length > 1) return 'component';
  return 'layout';
}

// Repeated siblings of the same shape almost always want a list.
function looksLikeList(node) {
  if (!('children' in node) || node.children.length < 2) return false;
  const kids = node.children.filter((c) => c.visible !== false);
  if (kids.length < 2) return false;
  const key = (c) => (c.type === 'INSTANCE' ? 'i:' : 't:' + c.type + ':') +
    (c.type === 'INSTANCE' ? '' : Math.round(c.width) + 'x' + Math.round(c.height));
  const first = key(kids[0]);
  return kids.every((c) => key(c) === first);
}

function headingLevel(t) {
  if (!t || !t.styleName) return null;
  const n = t.styleName.toLowerCase();
  if (n.indexOf('display') >= 0) return 'display';
  const m = /h(?:eading)?[\s/_-]*0?([1-6])/.exec(n);
  return m ? Number(m[1]) : null;
}

/* ═════════════════════════════════ walk ═════════════════════════════════ */

// Throttled — the walk is hot, and the point is a live pulse, not a per-node log.
function tick(ctx, label) {
  ctx.count++;
  if (ctx.count % 20 === 0) {
    figma.ui.postMessage({ type: 'progress', count: ctx.count, label: label });
  }
}

async function walk(node, depth, ctx, parent, bg) {
  tick(ctx, node.name);

  const m = {
    id: node.id, type: node.type, name: String(node.name || ''), depth: depth,
    hidden: node.visible === false,
    w: 'width' in node ? Math.round(node.width) : null,
    h: 'height' in node ? Math.round(node.height) : null,
    role: null, variant: null, props: null, of: null, reuse: false,
    opacity: null, clips: !!node.clipsContent, abs: null,
    layout: null, fills: null, strokes: null, strokeW: null, strokeAlign: null,
    radius: null, radiusToken: null, effects: null, fx: null, text: null, reactions: null,
    minW: null, maxW: null, minH: null, maxH: null, grow: null, constraints: null,
    svg: null, img: null, blend: null, isMask: false,
    children: []
  };

  m.role = ctx.opts.rootRole && depth === 0 && ctx.opts.rootRole !== 'auto'
    ? ctx.opts.rootRole
    : inferRole(node, depth, parent);

  if (node.opacity != null && node.opacity < 1) m.opacity = round(node.opacity);
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    m.blend = node.blendMode.toLowerCase();
  }
  if (node.isMask) m.isMask = true;

  if (node.type === 'INSTANCE' || node.type === 'COMPONENT') {
    try {
      const vp = node.variantProperties;
      if (vp) m.variant = Object.keys(vp).map((k) => k + '=' + vp[k]).join(', ');
    } catch (e) { /* not a variant */ }
  }

  if (node.type === 'INSTANCE') {
    try {
      const main = await node.getMainComponentAsync();
      if (main) m.of = main.name;
    } catch (e) { /* detached */ }
    try {
      const cp = node.componentProperties;
      if (cp) {
        const pairs = [];
        for (const key of Object.keys(cp)) {
          const clean = key.split('#')[0];
          const val = cp[key] && cp[key].value;
          if (val !== undefined) pairs.push(clean + '=' + JSON.stringify(val));
        }
        if (pairs.length) m.props = pairs.join(', ');
      }
    } catch (e) { /* no props */ }
  }

  // Absolute offsets, only where they are actually needed to place something.
  if (parent && 'x' in node && 'width' in parent) {
    const abs = !('layoutMode' in parent) || parent.layoutMode === 'NONE' ||
      node.layoutPositioning === 'ABSOLUTE';
    if (abs) {
      m.abs = 't' + round(node.y) +
        ' r' + round(parent.width - node.x - node.width) +
        ' b' + round(parent.height - node.y - node.height) +
        ' l' + round(node.x);
    }
  }

  m.layout = await layoutToModel(node, ctx);

  if ('fills' in node) {
    const bf = node.boundVariables && node.boundVariables.fills;
    m.fills = await paintsToModel(node.fills, bf, ctx);
  }
  if ('strokes' in node && node.strokes && node.strokes.length) {
    const bs = node.boundVariables && node.boundVariables.strokes;
    m.strokes = await paintsToModel(node.strokes, bs, ctx);
    m.strokeW = node.strokeWeight !== figma.mixed ? round(node.strokeWeight) : 'mixed';
    m.strokeAlign = node.strokeAlign ? node.strokeAlign.toLowerCase() : null;
  }

  m.radius = radiusToString(node);
  m.radiusToken = await boundName(node, 'topLeftRadius', ctx);
  m.effects = effectsToString(node);
  m.fx = effectsToCss(node);
  m.reactions = reactionsToString(node);

  if ('minWidth' in node && node.minWidth != null) m.minW = round(node.minWidth);
  if ('maxWidth' in node && node.maxWidth != null) m.maxW = round(node.maxWidth);
  if ('minHeight' in node && node.minHeight != null) m.minH = round(node.minHeight);
  if ('maxHeight' in node && node.maxHeight != null) m.maxH = round(node.maxHeight);
  if ('layoutGrow' in node && node.layoutGrow) m.grow = node.layoutGrow;
  if ('constraints' in node && node.constraints) {
    const c = node.constraints;
    if (c.horizontal !== 'MIN' || c.vertical !== 'MIN') {
      m.constraints = c.horizontal.toLowerCase() + '/' + c.vertical.toLowerCase();
    }
  }

  if (node.type === 'TEXT') m.text = await textToModel(node, ctx);

  // Background inherited by descendants, for contrast checks.
  const ownBg = firstSolid(m.fills);
  const nextBg = ownBg || bg;

  runA11y(m, node, ctx, bg, parent);

  /* ── leaves ── */

  // An instance of something already built in Webflow is a reference, full stop.
  const ofSlug = m.of ? slug(m.of) : null;
  if (ofSlug && PROFILE.built.indexOf(ofSlug) >= 0 && !ctx.opts.expandInstances) {
    m.reuse = true;
    ctx.reuse.add(m.of);
    return m;
  }

  // Anything else: show the structure once, reference every repeat.
  if (node.type === 'INSTANCE' && m.of && !ctx.opts.expandInstances) {
    if (ctx.seenComponents.has(m.of)) { m.reuse = true; return m; }
    ctx.seenComponents.add(m.of);
  }

  if (ctx.opts.images && hasImageFill(node)) {
    try {
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
      const file = (slug(node.name) || 'layer') + '-' + (ctx.images.length + 1) + '.png';
      ctx.images.push({ name: file, bytes: bytes });
      m.img = file;
    } catch (e) {
      m.img = 'export failed: ' + String(e);
    }
    return m;
  }

  if (ctx.opts.svg && isIcon(node)) {
    try {
      const svg = await node.exportAsync({ format: 'SVG_STRING', svgSimplifyStroke: true });
      const key = hashStr(svg);
      // A grid of six cards emits one icon, not six copies of it.
      if (ctx.svgIndex.has(key)) {
        m.svg = ctx.svgIndex.get(key);
      } else {
        ctx.svgs.push({ label: node.name, svg: svg.trim() });
        ctx.svgIndex.set(key, ctx.svgs.length);
        m.svg = ctx.svgs.length;
      }
    } catch (e) {
      m.svg = 'export failed: ' + String(e);
    }
    return m;
  }

  if ('children' in node) {
    for (const child of node.children) {
      m.children.push(await walk(child, depth + 1, ctx, node, nextBg));
    }
  }

  return m;
}

/* ═════════════════════════════ accessibility ═════════════════════════════ */

function runA11y(m, node, ctx, bg, parent) {
  if (!ctx.opts.a11y) return;
  const label = m.name || m.type.toLowerCase();

  if (m.hidden) return;

  if (node.type === 'TEXT' && m.text) {
    const fg = firstSolid(m.fills);
    if (fg && bg) {
      const ratio = contrastRatio(fg, bg);
      if (ratio != null) {
        const size = m.text.size || 16;
        const bold = (m.text.weight || 400) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        if (ratio < need) {
          ctx.a11y.push({
            level: 'fail',
            msg: label + '  ' + fg + ' on ' + bg + ' → ' + ratio + ':1, fails AA (needs ' +
                 need + ':1 at ' + size + 'px' + (bold ? ' bold' : '') + ')'
          });
        }
      }
    }
    const lvl = headingLevel(m.text);
    if (lvl && lvl !== 'display') ctx.headings.push({ level: lvl, name: label });

    if (m.text.truncate || (m.text.maxLines && m.text.maxLines > 0)) {
      ctx.a11y.push({ level: 'info', msg: label + '  truncated in the design — ensure the full string is still in the DOM' });
    }
  }

  if (hasImageFill(node)) {
    ctx.a11y.push({
      level: 'fail',
      msg: label + '  image needs alt text — the layer name is not alt text'
    });
  }

  if (isInteractive(node)) {
    if (!hasTextDescendant(node)) {
      ctx.a11y.push({ level: 'fail', msg: label + '  interactive but has no text child → needs aria-label' });
    }
    if (m.w != null && m.h != null && (m.w < 44 || m.h < 44)) {
      ctx.a11y.push({ level: 'warn', msg: label + '  tap target ' + m.w + '×' + m.h + ' is below the 44×44 minimum' });
    }
  }

  // Purely decorative shapes inside an interactive or surfaced parent.
  if (/overlay|gradient|bg|background|shadow|blur|decor/i.test(m.name) ||
      (VECTOR_TYPES.has(node.type) && JUNK_NAME.test(m.name))) {
    ctx.a11y.push({ level: 'info', msg: label + '  looks decorative → aria-hidden="true" / alt=""' });
  }
}

function headingOrderFindings(headings) {
  const out = [];
  let prev = null;
  for (const h of headings) {
    if (prev != null && h.level > prev + 1) {
      out.push({ level: 'fail', msg: 'heading order skips h' + prev + ' → h' + h.level + ' at "' + h.name + '"' });
    }
    prev = h.level;
  }
  if (!out.length && headings.length) {
    out.push({ level: 'ok', msg: 'heading order ' + headings.map((h) => 'h' + h.level).join(' → ') + ', no skipped levels' });
  }
  return out;
}

/* ══════════════════════════ client-first mapping ══════════════════════════ */

function cfHeadingClass(t) {
  const lvl = headingLevel(t);
  if (lvl === 'display') return 'heading-style-display';
  if (lvl) return 'heading-style-h' + lvl;
  return null;
}

// A junk-named node gets its name from what it actually is.
function derivedSuffix(m, node) {
  if (hasIcon(m) || (node && isIcon(node))) return 'icon';
  if (m.img != null) return 'image';
  if (looksLikeList(node)) return 'list';
  if (m.role === 'layout') return 'content';
  if (m.text) return 'text';
  return 'wrap';
}

// m.svg is either the index of an exported icon (a number) or the reason the
// export failed (a string). Only the first is something to embed — treating any
// non-null value as an icon produced an HtmlEmbed with nothing in it, plus an
// icon-embed size class, for every layer Figma refused to export.
const hasIcon = (m) => typeof m.svg === 'number';

function cfClassName(m, node, rootSlug, parentSlug, ctx) {
  const raw = m.name;
  const clean = JUNK_NAME.test(raw) ? null : slug(raw);
  const base = clean || derivedSuffix(m, node);

  let cls;
  if (m.depth === 0) {
    if (m.role === 'section') cls = 'section_' + base;
    else if (m.role === 'component') cls = base + '_component';
    else if (m.role === 'layout') cls = base + '_layout';
    else cls = base;
  } else if (m.role === 'component') {
    cls = base + '_component';
  } else {
    cls = (parentSlug || rootSlug) + '_' + base;
  }

  // An auto-named layer falls back to a generic word — "content", "wrap", "list"
  // — so a component full of unnamed Frames produced the SAME class for every one
  // of them. Webflow would have created it once and applied it to all, and a
  // padding change on one would silently move the others. Numbering only the
  // inferred repeats keeps hand-named classes exactly as the designer wrote them.
  if (!clean && ctx) {
    const seen = ctx.classSeen || (ctx.classSeen = new Map());
    const n = (seen.get(cls) || 0) + 1;
    seen.set(cls, n);
    if (n > 1) cls = cls + '-' + n;
  }

  return { cls: cls, inferred: !clean };
}

// Webflow element + semantic tag. A custom element tag is emitted whenever the
// native Webflow set cannot express the right semantics.
function cfElement(m, node, parentModel) {
  const interactive = isInteractive(node);
  const nav = m.reactions && /NAVIGATE|OPEN_URL|SCROLL_TO/.test(m.reactions);

  if (m.text) {
    const lvl = headingLevel(m.text);
    if (lvl && lvl !== 'display') return { el: 'Heading', tag: 'h' + lvl };
    if (lvl === 'display') return { el: 'Heading', tag: 'h1' };
    const chars = m.text.chars || '';
    if (chars.length > 60) return { el: 'Paragraph', tag: 'p' };
    return { el: 'Text', tag: 'div' };
  }

  if (m.img != null) return { el: 'Image', tag: 'img' };
  if (hasIcon(m)) return { el: 'HtmlEmbed', tag: null };

  if (interactive && nav) return { el: 'Link', tag: 'a' };
  if (interactive) return { el: 'Link', tag: 'button' };

  if (looksLikeList(node)) return { el: 'DivBlock', tag: 'ul', custom: true };

  if (m.depth === 0 && m.role === 'section') return { el: 'Section', tag: 'section' };

  if (m.role === 'component' && parentModel && looksLikeList(parentModel.node)) {
    return { el: 'DivBlock', tag: 'article', custom: true };
  }

  return { el: 'DivBlock', tag: null };
}

function cfUtilities(m, node) {
  const out = [];

  if (m.text) {
    const h = cfHeadingClass(m.text);
    if (h) out.push(h);
    else if (m.text.size) out.push(nearest(PROFILE.textSize, m.text.size));

    if (m.text.weight && PROFILE.weight[m.text.weight] && !h) {
      out.push(PROFILE.weight[m.text.weight]);
    }
    if (m.text.align === 'CENTER') out.push('text-align-center');
    if (m.text.align === 'RIGHT') out.push('text-align-right');
    if (m.text.case === 'upper') out.push('text-style-allcaps');
    if (m.text.decoration === 'italic') out.push('text-style-italic');
    if (m.text.maxLines === 2) out.push('text-style-2lines');
    if (m.text.maxLines === 3) out.push('text-style-3lines');
  }

  if (hasIcon(m) && m.w) out.push(nearest(PROFILE.iconEmbed, Math.max(m.w, m.h || 0)));

  if (m.img != null && m.w && m.h) {
    const r = m.w / m.h;
    if (Math.abs(r - 1) < 0.05) out.push('aspect-ratio-square');
    else if (Math.abs(r - 16 / 9) < 0.08) out.push('aspect-ratio-widescreen');
    else if (r > 1.1) out.push('aspect-ratio-landscape');
    else if (r < 0.9) out.push('aspect-ratio-portrait');
  }

  if (m.clips) out.push('overflow-hidden');

  return out.filter(Boolean);
}

// The CSS the custom class needs. Spacing comes straight from flex gap, so
// nothing here snaps to a utility scale, and every dimension goes through
// unit() so the output is rem apart from hairlines.
function cfStyle(m) {
  const d = [];
  if (m.layout) {
    d.push(m.layout.grid ? 'display: grid' : 'display: flex');
    // row is the CSS default, so stating it adds a line to almost every node and
    // tells the builder nothing it would not already do.
    if (!m.layout.grid && m.layout.dir !== 'row') d.push('flex-direction: ' + m.layout.dir);
    if (m.layout.grid && m.layout.cols) d.push('grid-template-columns: repeat(' + m.layout.cols + ', 1fr)');
    if (m.layout.gap) {
      d.push('gap: ' + unit(m.layout.gap) +
        (m.layout.tokens.gap ? '  /* ' + m.layout.tokens.gap + ' */' : ''));
    }
    if (m.layout.rowGap) d.push('row-gap: ' + unit(m.layout.rowGap));
    const p = m.layout.pad;
    if (p.some((v) => v)) {
      const same = p[0] === p[1] && p[1] === p[2] && p[2] === p[3];
      d.push('padding: ' + (same ? unit(p[0]) : p.map(unit).join(' ')));
    }
    if (m.layout.justify && m.layout.justify !== 'MIN') {
      d.push('justify-content: ' + cssAlign(m.layout.justify));
    }
    if (m.layout.align && m.layout.align !== 'MIN') {
      d.push('align-items: ' + cssAlign(m.layout.align));
    }
    if (m.layout.wrap) d.push('flex-wrap: wrap');
  }
  if (m.radius) {
    d.push('border-radius: ' + m.radius.split(' ').map((v) => unit(Number(v))).join(' ') +
      (m.radiusToken ? '  /* ' + m.radiusToken + ' */' : ''));
  }
  if (m.fills) {
    const bgv = m.fills.filter((f) => f.kind === 'solid')[0];
    // A fill is a background on a box, but on a TEXT node it is the glyph colour,
    // and on an inline SVG it is what currentColor resolves to. Emitting
    // `background` for those paints a block behind the content instead.
    const fg = m.type === 'TEXT' || hasIcon(m);
    const prop = fg ? 'color: ' : 'background: ';
    if (bgv) d.push(prop + (bgv.token ? bgv.token + ' (' + bgv.hex + ')' : bgv.hex));
  }
  if (m.strokes && m.strokeW) {
    const s = m.strokes.filter((f) => f.kind === 'solid')[0];
    if (s) d.push('border: ' + unit(m.strokeW) + ' solid ' + (s.token || s.hex));
  }
  if (m.fx) {
    if (m.fx.shadow) d.push('box-shadow: ' + m.fx.shadow);
    if (m.fx.blur) d.push('filter: blur(' + m.fx.blur + ')');
    if (m.fx.backdrop) d.push('backdrop-filter: blur(' + m.fx.backdrop + ')');
  }
  if (m.maxW) d.push('max-width: ' + unit(m.maxW));
  if (m.minW) d.push('min-width: ' + unit(m.minW));
  if (m.maxH) d.push('max-height: ' + unit(m.maxH));
  if (m.minH) d.push('min-height: ' + unit(m.minH));
  if (m.grow) d.push('flex: 1');
  return d;
}

function cssAlign(v) {
  return { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end',
           SPACE_BETWEEN: 'space-between', BASELINE: 'baseline' }[v] || v.toLowerCase();
}

/* ════════════════════════════════ renderers ═══════════════════════════════ */

function renderNode(m, lines, opts, ctx, rootSlug, parentSlug, parentModel) {
  const pad = '  '.repeat(m.depth);
  const sub = pad + '    ';
  const head = [m.type.toLowerCase() + ' "' + m.name + '"'];

  if (m.hidden) head.push('[hidden]');
  if (m.w != null) head.push(m.w + '×' + m.h);
  if (m.variant) head.push('variant: ' + m.variant);
  if (m.of) head.push('of:' + m.of);
  if (m.opacity != null) head.push('opacity:' + m.opacity);
  if (m.blend) head.push('blend:' + m.blend);
  if (m.isMask) head.push('mask');
  if (m.clips) head.push('clips');
  if (m.abs) head.push('abs: ' + m.abs);
  head.push('· ' + m.role);

  lines.push(pad + head.join('  '));

  if (m.props) lines.push(sub + 'props: ' + m.props);

  /* Everything the wf: block below already states is left out here.
     `layout:` became display/flex-direction/gap/padding/justify/align, `fill:`
     became background or color, `stroke:` became border, `radius:` became
     border-radius, `effects:` became box-shadow, and grow/min/max became flex
     and min-/max-width. Printing both said the same thing twice in Figma's
     vocabulary and then in Webflow's, and roughly doubled the length of every
     capture. What survives is what the CSS cannot carry. */

  // Constraints describe resize behaviour, which has no CSS equivalent here.
  if (m.constraints) lines.push(sub + 'constraints: ' + m.constraints);

  if (m.text) {
    const t = textToString(m.text);
    if (t) lines.push(sub + 'type: ' + t);
    lines.push(sub + 'text: ' + JSON.stringify(m.text.chars));
    if (m.text.token) lines.push(sub + 'text-var: ' + m.text.token);
    if (m.text.segments) {
      for (const s of m.text.segments) {
        lines.push(sub + '  segment ' + JSON.stringify(s.text) + '  ' + s.style);
      }
    }
  }

  if (m.reactions) lines.push(sub + 'reactions: ' + m.reactions);
  if (typeof m.svg === 'number') lines.push(sub + '-> SVG #' + m.svg);
  else if (m.svg != null) lines.push(sub + '! icon could not be exported: ' + m.svg);
  if (m.img != null) lines.push(sub + '-> IMG ' + m.img);

  /* ── the webflow translation line ── */
  let mySlug = parentSlug || rootSlug;

  {
    if (m.reuse) {
      lines.push(sub + 'wf: REUSE component "' + m.of + '" — do not rebuild');
      if (m.props) lines.push(sub + '    bind props: ' + m.props);
    } else {
      const node = ctx.nodeById.get(m.id);
      const named = cfClassName(m, node, rootSlug, parentSlug, ctx);
      const el = cfElement(m, node, parentModel);
      const utils = cfUtilities(m, node);

      const tag = el.tag && el.custom ? '<' + el.tag + '>' :
                  (el.tag && el.el === 'Heading' ? ' ' + el.tag : '');
      const isNew = !PROFILE.known.has(named.cls);
      const marks = [];
      marks.push(isNew ? 'new' : 'existing');
      if (named.inferred) marks.push('name inferred');

      const classes = ['.' + named.cls].concat(utils.map((u) => '.' + u)).join(' ');
      lines.push(sub + 'wf: ' + el.el + tag + ' ' + classes + '   [' + marks.join(' · ') + ']');

      if (isNew) {
        const decls = cfStyle(m);
        for (const d of decls) lines.push(sub + '    ' + d);
      }

      const aria = [];
      if (el.custom && el.tag === 'ul') aria.push('role="list"');
      if (isInteractive(node) && !hasTextDescendant(node)) aria.push('aria-label="…"  ← required');
      if (m.img != null) aria.push('alt="…"  ← required');
      if (aria.length) lines.push(sub + '    ' + aria.join('  '));

      if (named.cls.indexOf('_') > 0 && m.role !== 'element') {
        mySlug = named.cls.split('_')[0];
      }
    }
  }

  for (const child of m.children) {
    renderNode(child, lines, opts, ctx, rootSlug, mySlug, { node: ctx.nodeById.get(m.id), m: m });
  }
}

function renderHeader(ctx, opts, roots) {
  const lines = [];


  lines.push('=== BUILD CONTRACT (webflow / client-first) ===');
  // Only what we actually know. The site comes from the connected project's
  // _config.json; unconnected, no line is better than a wrong one.
  if (ctx.opts.site) lines.push('site: ' + ctx.opts.site);
  lines.push('root: ' + roots.map((r) => '"' + r.name + '" · ' + r.role).join(', '));

  if (ctx.reuse.size) {
    lines.push('');
    lines.push('REUSE — already built, do not rebuild:');
    for (const name of ctx.reuse) lines.push('  · ' + name);
  }

  if (ctx.tokens.size) {
    lines.push('');
    lines.push('VARIABLES used by this selection:');
    for (const info of ctx.tokens.values()) {
      let line = '  · ' + info.name + (info.collection ? '   [' + info.collection + ']' : '');
      if (info.modes) line += '   ' + info.modes.map((m) => m.name + '=' + m.value).join('  ');
      lines.push(line);
    }
  }

  lines.push('');
  lines.push('WEBFLOW API QUIRKS:');
  for (const q of PROFILE.quirks) lines.push('  ! ' + q);

  lines.push('');
  lines.push('Legend  [new] create it · [existing] already in the style guide · ' +
             '[name inferred] Figma layer name was auto-generated, sanity-check it');
  lines.push('');
  return lines;
}

function renderA11y(ctx) {
  const lines = [];
  if (!ctx.opts.a11y) return lines;

  const findings = ctx.a11y.concat(headingOrderFindings(ctx.headings));
  if (!findings.length) return lines;

  lines.push('=== ACCESSIBILITY ===');
  const icon = { fail: '✗', warn: '!', info: '·', ok: '✓' };
  const order = { fail: 0, warn: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  for (const f of findings) lines.push(icon[f.level] + ' ' + f.msg);
  lines.push('');
  lines.push('Pentool Studio cannot write alt text — it does not know editorial ' +
             'intent. Every "required" above needs a human string.');
  lines.push('');
  return lines;
}

/* ═══════════════════════════════════ main ═══════════════════════════════════ */

async function run(opts, roots) {
  // Set before anything walks: class naming, [existing] marks, REUSE detection
  // and the size scales all read PROFILE.
  useStyleGuide(opts.styleGuide);

  const sel = roots && roots.length ? roots : figma.currentPage.selection;
  if (!sel.length) {
    return { text: 'Nothing selected. Select a frame or component in Figma, then run again.', images: [] };
  }

  const ctx = {
    opts: opts, tokens: new Map(), svgs: [], svgIndex: new Map(), images: [],
    a11y: [], headings: [], reuse: new Set(), seenComponents: new Set(),
    nodeById: new Map(), count: 0
  };

  // Renderers need the live node for structural questions the model does not carry.
  const index = (n) => {
    ctx.nodeById.set(n.id, n);
    if ('children' in n) n.children.forEach(index);
  };
  figma.ui.postMessage({ type: 'progress', phase: 'Indexing' });
  sel.forEach(index);

  figma.ui.postMessage({ type: 'progress', phase: 'Reading layers', total: ctx.nodeById.size });
  const models = [];
  for (const node of sel) {
    models.push(await walk(node, 0, ctx, null, null));
  }

  if (opts.screenshot) {
    figma.ui.postMessage({ type: 'progress', phase: 'Exporting preview' });
    for (const node of sel) {
      try {
        const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
        ctx.images.unshift({ name: '_preview-' + (slug(node.name) || 'selection') + '.png', bytes: bytes });
      } catch (e) { /* preview is a nicety, never fatal */ }
    }
  }

  figma.ui.postMessage({ type: 'progress', phase: 'Rendering' });

  const lines = [];
  lines.push.apply(lines, renderHeader(ctx, opts, models.map((m) => ({ name: m.name, role: m.role }))));

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    lines.push('=== ' + m.name + ' (' + m.type.toLowerCase() + ', id ' + m.id + ') ===');
    renderNode(m, lines, opts, ctx, slug(m.name), null, null);
    lines.push('');
  }

  lines.push.apply(lines, renderA11y(ctx));

  // SVG sources are written as assets/<name>.svg by the bridge rather than
  // inlined here. The "-> SVG #n" markers above still carry the layer-to-icon
  // mapping, which is why they stay. Inlining was the only reason the MAX_CHARS
  // ceiling ever bit.
  if (ctx.svgs.length) {
    lines.push('=== SVG FILES ===');
    ctx.svgs.forEach((s, i) => lines.push('- SVG #' + (i + 1) + '  ' + svgFileName(i, s.label)));
    lines.push('');
  }

  if (ctx.images.length) {
    lines.push('=== IMAGE FILES ===');
    ctx.images.forEach((im) => lines.push('- ' + im.name));
    lines.push('');
  }

  let text = lines.join('\n');
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) +
      '\n\n=== TRUNCATED ===\nOutput exceeded ' + MAX_CHARS.toLocaleString() +
      ' characters and was cut here. Capture one section at a time.\n';
  }

  return { text: text, images: ctx.images, svgs: ctx.svgs, name: models[0].name };
}

/* ════════════════════════════ options & naming ════════════════════════════ */

// Every capture option that used to be a checkbox is now fixed, because each was
// either required for a build to work or derived from another choice:
//
//   images / screenshot  a wf: Image with no asset, and a visual check with
//                        nothing to compare against, are both silent failures
//   a11y                 free, advisory, changes nothing that gets built
//   svg                  icons still export; they travel as files now
//   expandInstances      the exact inverse of reuse — see below
//
// expandInstances is DERIVED from what you say the capture IS:
//
//   section / component   inner instances of components that already exist in
//                         Webflow stay as REUSE references — you are not
//                         rebuilding market-card just because it sits inside
//   update                you selected an instance of the component you mean to
//                         redefine, so it has to be walked in full. Left off,
//                         the dump would be a single REUSE line naming the very
//                         component it was supposed to replace.
// page: the frame is a whole Webflow page, not a band on one. It still walks and
// renders identically — only its destination differs — so it shares section's
// traversal settings.
const KINDS = ['section', 'page', 'component', 'update'];

function resolveOpts(ui) {
  const u = ui || {};
  const kind = KINDS.indexOf(u.kind) === -1 ? 'section' : u.kind;
  return {
    target: 'webflow',
    svg: true,
    images: true,
    screenshot: true,
    a11y: true,
    expandInstances: kind === 'update',
    rootRole: u.rootRole || 'auto',
    // Both supplied by the connected project; absent when capturing unpaired.
    site: u.site || null,
    styleGuide: u.styleGuide || null
  };
}

// Stable, collision-free names for the SVG files the bridge writes. The index
// keeps repeats apart when two icons slugify to the same thing.
function svgFileName(i, label) {
  const base = slug(label) || 'icon';
  return 'icon-' + (i + 1) + '-' + base + '.svg';
}

/* ═══════════════════════════════ selection ═══════════════════════════════ */

/* Which row of the frame picker a canvas selection corresponds to.

   The picker lists a page's top-level frames and one level of their children, so
   an arbitrary selection — a text layer six levels down — has to be resolved to
   the nearest thing the list can actually show. Walking up to the PAGE gives the
   whole chain; the most specific representable ancestor is the depth-1 child if
   there is one, otherwise the depth-0 frame.

   Selecting a heading inside "hero" therefore points at hero, not at the page
   that contains it, which is the section you would want to queue. */
const FRAMEISH = ['FRAME', 'COMPONENT', 'COMPONENT_SET'];

function pickerTargetFor(node) {
  if (!node) return null;
  const chain = [];
  let n = node;
  while (n && n.type !== 'PAGE') { chain.push(n); n = n.parent; }
  if (!n || n.type !== 'PAGE') return null;          // detached, or the page itself

  const page = n;
  const depth0 = chain[chain.length - 1];            // direct child of the page
  const depth1 = chain.length >= 2 ? chain[chain.length - 2] : null;
  if (!depth0 || FRAMEISH.indexOf(depth0.type) === -1) return { pageId: page.id, nodeId: null };

  const useDepth1 = depth1 && FRAMEISH.indexOf(depth1.type) !== -1;
  const target = useDepth1 ? depth1 : depth0;
  return { pageId: page.id, nodeId: target.id, name: String(target.name) };
}

function selectionInfo() {
  const sel = figma.currentPage.selection;
  const target = sel.length === 1 ? pickerTargetFor(sel[0]) : null;
  return {
    count: sel.length,
    names: sel.slice(0, 3).map((n) => String(n.name)),
    // Only ever one target: two selected frames name no single section.
    target: target
  };
}

// Output describes one selection. When that selection changes the panel must
// clear, otherwise a stale paste gets attributed to the wrong node — the kind
// of mistake that is invisible until it reaches Webflow.
figma.on('selectionchange', () => {
  const info = selectionInfo();
  figma.ui.postMessage({
    type: 'selection', count: info.count, names: info.names, target: info.target
  });
});

/* ════════════════════════════════ messaging ════════════════════════════════ */

// Bump this whenever a default changes — persisted options would otherwise keep
// overriding the new default for anyone who has already run the plugin.
// v2 because the capture options stopped being checkboxes and became fixed.
// Anyone who has run v1 has svg:false and images:false persisted from the old
// defaults; without this bump those saved values would keep winning and captures
// would silently come out with no icons and no assets.
const STORE_KEY = 'pentool.opts.v2';
const SIZE_KEY = 'pentool.size.v1';
const TOKEN_KEY = 'pentool.bridge-token.v1';

// The chosen project lives on the DOCUMENT, not the user, so each Figma file
// reopens bound to the project it was paired with.
const PROJECT_KEY = 'pentool.project';

function readProject() {
  try { return JSON.parse(figma.root.getPluginData(PROJECT_KEY) || 'null'); }
  catch (e) { return null; }
}
function writeProject(p) {
  try { figma.root.setPluginData(PROJECT_KEY, p ? JSON.stringify(p) : ''); }
  catch (e) { /* read-only file — the panel still works, it just will not stick */ }
}

figma.ui.onmessage = async (msg) => {
  if (!msg) return;

  if (msg.type === 'ready') {
    let saved = null, size = null, token = null;
    try { saved = await figma.clientStorage.getAsync(STORE_KEY); } catch (e) { /* first run */ }
    try { size = await figma.clientStorage.getAsync(SIZE_KEY); } catch (e) { /* first run */ }
    try { token = await figma.clientStorage.getAsync(TOKEN_KEY); } catch (e) { /* never paired */ }
    if (size && size.w && size.h) {
      try { figma.ui.resize(size.w, size.h); } catch (e) { /* stored size out of range */ }
    }
    figma.ui.postMessage({
      type: 'restore', opts: saved || null, token: token || null, project: readProject()
    });
    const info = selectionInfo();
    figma.ui.postMessage({
      type: 'selection', count: info.count, names: info.names, target: info.target
    });
    return;
  }

  // Only the main thread can reach these; the iframe does the fetching, so
  // pairing is a two-step dance between them.
  if (msg.type === 'openExternal') {
    try { figma.openExternal(msg.url); } catch (e) { /* blocked — the panel says so */ }
    return;
  }

  if (msg.type === 'paired') {
    try { await figma.clientStorage.setAsync(TOKEN_KEY, msg.token || null); } catch (e) { /* non-fatal */ }
    writeProject(msg.project || null);
    return;
  }

  if (msg.type === 'unpair') {
    try { await figma.clientStorage.setAsync(TOKEN_KEY, null); } catch (e) { /* non-fatal */ }
    writeProject(null);
    return;
  }

  // Manual mode: pages are cheap to list, frames are not. documentAccess is
  // "dynamic-page", so a page's children need loadAsync first — done per page on
  // demand rather than via loadAllPagesAsync, which stalls on a large file.
  if (msg.type === 'pages') {
    const pages = figma.root.children.map((p) => ({ id: p.id, name: String(p.name) }));
    figma.ui.postMessage({ type: 'pages', pages: pages, current: figma.currentPage.id });
    return;
  }

  if (msg.type === 'frames') {
    // Two levels, not one. A page frame holds the sections you actually queue,
    // and listing only the top level meant the whole page was the only thing you
    // could pick — you could not send one band of it.
    const TOP = ['FRAME', 'COMPONENT', 'COMPONENT_SET'];
    let frames = [];
    try {
      const page = figma.root.children.filter((p) => p.id === msg.pageId)[0];
      if (page) {
        if (page.loadAsync) await page.loadAsync();
        for (const n of page.children) {
          if (TOP.indexOf(n.type) === -1) continue;
          frames.push({
            id: n.id, name: String(n.name), depth: 0,
            w: Math.round(n.width), h: Math.round(n.height),
            children: 'children' in n ? n.children.filter((c) => TOP.indexOf(c.type) !== -1).length : 0
          });
          if (!('children' in n)) continue;
          for (const c of n.children) {
            // Instances are excluded on purpose: an instance of a built
            // component is something to reuse, not a section to queue.
            if (TOP.indexOf(c.type) === -1) continue;
            frames.push({
              id: c.id, name: String(c.name), depth: 1, parent: n.id,
              w: Math.round(c.width), h: Math.round(c.height), children: 0
            });
          }
        }
      }
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: 'could not read that page: ' + String(e.message || e) });
      return;
    }
    figma.ui.postMessage({ type: 'frames', frames: frames, pageId: msg.pageId });
    return;
  }

  // Figma plugin windows have no native resize affordance; the corner grip in
  // the iframe drives this, and the size is remembered between sessions.
  if (msg.type === 'resize' || msg.type === 'resizeEnd') {
    const s = msg.size;
    if (!s || !s.w || !s.h) return;
    try { figma.ui.resize(s.w, s.h); } catch (e) { return; }
    if (msg.type === 'resizeEnd') {
      try { await figma.clientStorage.setAsync(SIZE_KEY, s); } catch (e) { /* non-fatal */ }
    }
    return;
  }

  if (msg.type !== 'run') return;

  const ui = msg.ui || {};
  const opts = resolveOpts(ui);
  // Only what the user still controls is worth persisting.
  try { await figma.clientStorage.setAsync(STORE_KEY, { rootRole: opts.rootRole, mode: ui.mode }); }
  catch (e) { /* non-fatal */ }

  try {
    let roots = null;
    if (ui.mode === 'manual') {
      if (!ui.nodeId) throw new Error('pick a frame to capture');
      // getNodeByIdAsync, not the sync form: under dynamic-page access the node
      // may live on a page that has not been loaded yet.
      const node = await figma.getNodeByIdAsync(ui.nodeId);
      if (!node) throw new Error('that frame no longer exists — pick another');
      roots = [node];

      // "Queue each section separately" walks the page's children one at a time
      // and emits a capture per section, which is what the queue is built for —
      // a page arrives as the bands it is made of, each buildable on its own.
      if (ui.eachSection && 'children' in node) {
        const KIND = ['FRAME', 'COMPONENT', 'COMPONENT_SET'];
        const parts = node.children.filter((c) => KIND.indexOf(c.type) !== -1);
        if (!parts.length) throw new Error('that frame holds no sections to queue');

        for (let i = 0; i < parts.length; i++) {
          figma.ui.postMessage({ type: 'progress', phase: 'Section ' + (i + 1) + '/' + parts.length });
          const r = await run(opts, [parts[i]]);
          figma.ui.postMessage({
            type: 'result', text: r.text, images: r.images,
            svgs: (r.svgs || []).map((sv, n) => ({
              label: sv.label, svg: sv.svg, file: svgFileName(n, sv.label)
            })),
            name: r.name,
            // The panel needs to know this is one of a run, so it sends each to
            // the queue instead of treating the last one as the whole answer.
            batch: { index: i, total: parts.length }
          });
        }
        return;
      }
    }

    const result = await run(opts, roots);
    figma.ui.postMessage({
      type: 'result', text: result.text, images: result.images,
      svgs: (result.svgs || []).map((sv, i) => ({
        label: sv.label, svg: sv.svg, file: svgFileName(i, sv.label)
      })),
      name: result.name
    });
  } catch (err) {
    figma.ui.postMessage({ type: 'error', message: String((err && err.stack) || err) });
  }
};
