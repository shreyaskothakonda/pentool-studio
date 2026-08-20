// Exercises the pure helpers in code.js under a minimal `figma` stub.
// Verifies the contrast math, naming rules and class matching — the parts that
// are new and that no amount of syntax checking would catch.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, 'code.js');
let src = fs.readFileSync(SRC, 'utf8');

src += `
globalThis.__t = {
  contrastRatio, luminance, slug, rem, unit, nearest, headingLevel, hashStr,
  cssAlign, cfHeadingClass, cfStyle, selectionInfo, JUNK_NAME, PROFILE, round, hex,
  resolveOpts, svgFileName, KINDS, cfClassName, cfElement, hasIcon,
  useStyleGuide, DEFAULT_PROFILE, pickerTargetFor
};
`;

const figma = {
  mixed: Symbol('mixed'),
  showUI() {},
  on() {},
  ui: { onmessage: null, postMessage() {}, resize() {} },
  clientStorage: { getAsync: async () => null, setAsync: async () => {} },
  currentPage: { selection: [], id: 'page:0' },
  root: { children: [], getPluginData: () => '', setPluginData: () => {} },
  getNodeByIdAsync: async () => null,
  openExternal() {},
  variables: {
    getVariableByIdAsync: async () => null,
    getVariableCollectionByIdAsync: async () => null
  },
  getStyleByIdAsync: async () => null
};

const ctx = { figma, __html__: '', console, Symbol, Math, JSON, Map, Set, Number, String, Object, Array };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const t = ctx.__t;

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         got ' + JSON.stringify(actual) + '\n         want ' + JSON.stringify(expected)); }
}
function near(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log('  ok   ' + label + '  (' + actual + ')'); }
  else { fail++; console.log('  FAIL ' + label + '  got ' + actual + ' want ~' + expected); }
}

console.log('\ncontrast — known WCAG reference pairs');
near('black on white = 21:1', t.contrastRatio('#000000', '#FFFFFF'), 21, 0.01);
near('white on white = 1:1', t.contrastRatio('#FFFFFF', '#FFFFFF'), 1, 0.01);
near('#767676 on white = 4.54:1 (AA boundary)', t.contrastRatio('#767676', '#FFFFFF'), 4.54, 0.05);
near('#6E6E6E on #FAF9F8', t.contrastRatio('#6E6E6E', '#FAF9F8'), 4.9, 0.3);
check('bad hex returns null', t.contrastRatio('nope', '#FFFFFF'), null);
check('luminance of pure red', Math.round(t.luminance('#FF0000') * 10000) / 10000, 0.2126);

console.log('\nslug');
check('spaces and case', t.slug('Action Card'), 'action-card');
check('punctuation collapses', t.slug('I need equipment!'), 'i-need-equipment');
check('leading/trailing junk', t.slug('  --Hero--  '), 'hero');
check('slashes', t.slug('surface/subtle'), 'surface-subtle');

console.log('\nrem');
check('16px', t.rem(16), '1rem');
check('60px', t.rem(60), '3.75rem');
check('0', t.rem(0), '0');
check('null', t.rem(null), '0');
check('odd value', t.rem(14), '0.875rem');

console.log('\nunit — rem above 1px, px at or below (client-first)');
check('60px', t.unit(60), '3.75rem');
check('32px', t.unit(32), '2rem');
check('2px', t.unit(2), '0.125rem');
check('1.5px', t.unit(1.5), '0.094rem');
check('1px stays px (hairline)', t.unit(1), '1px');
check('0.5px stays px', t.unit(0.5), '0.5px');
check('0', t.unit(0), '0');
check('null', t.unit(null), '0');
check('negative above 1px', t.unit(-4), '-0.25rem');
check('negative hairline', t.unit(-1), '-1px');
check('non-numeric passes through', t.unit('mixed'), 'mixed');

console.log('\ncfStyle emits rem, never bare px above the hairline');
var css = t.cfStyle({
  layout: { grid: false, dir: 'column', gap: 60, rowGap: null, pad: [32, 32, 32, 32],
            justify: 'MIN', align: 'MIN', wrap: false, tokens: { gap: 'space/xl' }, cols: null },
  radius: '8', radiusToken: null, fills: [{ kind: 'solid', hex: '#FAF9F8', token: 'surface/subtle' }],
  strokes: [{ kind: 'solid', hex: '#E5E5E5', token: null }], strokeW: 1,
  fx: null, maxW: 640, minW: null, maxH: null, minH: null, grow: 0
});
check('gap in rem with token comment', css.indexOf('gap: 3.75rem  /* space/xl */') >= 0, true);
check('column is stated', css.indexOf('flex-direction: column') >= 0, true);
check('padding in rem', css.indexOf('padding: 2rem') >= 0, true);
check('radius in rem', css.indexOf('border-radius: 0.5rem') >= 0, true);
check('1px border stays px', css.indexOf('border: 1px solid #E5E5E5') >= 0, true);
check('max-width in rem', css.indexOf('max-width: 40rem') >= 0, true);
var bare = css.filter(function (d) { return /\d+px/.test(d) && !/\b(0\.\d+|1)px/.test(d); });
check('no dimension above 1px left in px', bare, []);

var css2 = t.cfStyle({
  layout: null, radius: null, fills: null, strokes: [{ kind: 'solid', hex: '#000000' }], strokeW: 4,
  fx: { shadow: '0 0.125rem 0.25rem rgba(0, 0, 0, 0.1)', blur: '0.5rem', backdrop: null },
  maxW: null, minW: null, maxH: null, minH: null, grow: 1
});
check('4px border converts to rem', css2.indexOf('border: 0.25rem solid #000000') >= 0, true);
check('box-shadow emitted', css2.indexOf('box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.1)') >= 0, true);
check('filter blur emitted', css2.indexOf('filter: blur(0.5rem)') >= 0, true);
check('grow becomes flex:1', css2.indexOf('flex: 1') >= 0, true);

// A TEXT fill is the glyph colour and an inline SVG fill is what currentColor
// resolves to. Emitting `background` for either paints a block behind the
// content — the bug this guards.
var cssText = t.cfStyle({
  type: 'TEXT', layout: null, radius: null,
  fills: [{ kind: 'solid', hex: '#1A1A1A', token: null }],
  strokes: null, strokeW: null, fx: null,
  maxW: null, minW: null, maxH: null, minH: null, grow: 0
});
check('text fill becomes color', cssText.indexOf('color: #1A1A1A') >= 0, true);
check('text fill is not a background', cssText.join('|').indexOf('background:') >= 0, false);

var cssIcon = t.cfStyle({
  type: 'VECTOR', svg: 0, layout: null, radius: null,
  fills: [{ kind: 'solid', hex: '#000000', token: null }],
  strokes: null, strokeW: null, fx: null,
  maxW: null, minW: null, maxH: null, minH: null, grow: 0
});
check('inline svg fill becomes color', cssIcon.indexOf('color: #000000') >= 0, true);

// row is the CSS default; emitting it added a line to nearly every node.
var cssRow = t.cfStyle({
  layout: { grid: false, dir: 'row', gap: 8, rowGap: null, pad: [0, 0, 0, 0],
            justify: 'MIN', align: 'CENTER', wrap: false, tokens: {}, cols: null },
  radius: null, fills: null, strokes: null, strokeW: null, fx: null,
  maxW: null, minW: null, maxH: null, minH: null, grow: 0
});
check('row is left implicit', cssRow.join('|').indexOf('flex-direction') >= 0, false);
check('but display:flex still stated', cssRow.indexOf('display: flex') >= 0, true);
check('and alignment still stated', cssRow.indexOf('align-items: center') >= 0, true);

var cssBox = t.cfStyle({
  type: 'FRAME', layout: null, radius: null,
  fills: [{ kind: 'solid', hex: '#FFFFFF', token: 'surface/base' }],
  strokes: null, strokeW: null, fx: null,
  maxW: null, minW: null, maxH: null, minH: null, grow: 0
});
check('a frame fill is still a background', cssBox.indexOf('background: surface/base (#FFFFFF)') >= 0, true);

console.log('\njunk name detection');
check('Frame 7', t.JUNK_NAME.test('Frame 7'), true);
check('Rectangle', t.JUNK_NAME.test('Rectangle'), true);
check('Vector 12', t.JUNK_NAME.test('Vector 12'), true);
check('Group', t.JUNK_NAME.test('Group'), true);
check('action-card is NOT junk', t.JUNK_NAME.test('action-card'), false);
check('title is NOT junk', t.JUNK_NAME.test('title'), false);
check('framework is NOT junk', t.JUNK_NAME.test('framework'), false);

console.log('\nheading level from Figma text-style names');
check('Heading/05', t.headingLevel({ styleName: 'Heading/05' }), 5);
check('Heading 2', t.headingLevel({ styleName: 'Heading 2' }), 2);
check('H3', t.headingLevel({ styleName: 'H3' }), 3);
check('heading-01', t.headingLevel({ styleName: 'heading-01' }), 1);
check('Display', t.headingLevel({ styleName: 'Display/Large' }), 'display');
check('Body/Regular is not a heading', t.headingLevel({ styleName: 'Body/Regular' }), null);
check('no style name', t.headingLevel({ styleName: null }), null);

console.log('\nclient-first heading class');
check('Heading/05 -> heading-style-h5', t.cfHeadingClass({ styleName: 'Heading/05' }), 'heading-style-h5');
check('Display -> heading-style-display', t.cfHeadingClass({ styleName: 'Display' }), 'heading-style-display');
check('body -> null', t.cfHeadingClass({ styleName: 'Body' }), null);

console.log('\nnearest-match utility scales');
check('16px icon', t.nearest(t.PROFILE.iconEmbed, 16), 'icon-embed-xxsmall');
check('40px icon picks medium(48) over small(32)', t.nearest(t.PROFILE.iconEmbed, 41), 'icon-embed-medium');
check('24px icon', t.nearest(t.PROFILE.iconEmbed, 24), 'icon-embed-xsmall');
check('16px text', t.nearest(t.PROFILE.textSize, 16), 'text-size-regular');
check('13.5px text rounds to small(14)', t.nearest(t.PROFILE.textSize, 13.5), 'text-size-small');
check('exact tie at 13px takes the smaller step', t.nearest(t.PROFILE.textSize, 13), 'text-size-tiny');
check('20px text', t.nearest(t.PROFILE.textSize, 20), 'text-size-large');

console.log('\nstyle-guide class inventory');
check('heading-style-h5 known', t.PROFILE.known.has('heading-style-h5'), true);
check('icon-embed-medium known', t.PROFILE.known.has('icon-embed-medium'), true);
check('container-large known', t.PROFILE.known.has('container-large'), true);
check('margin-medium NOT known (stripped from this project)', t.PROFILE.known.has('margin-medium'), false);
check('spacer-large NOT known (stripped)', t.PROFILE.known.has('spacer-large'), false);
check('action-card_component not known -> marked [new]', t.PROFILE.known.has('action-card_component'), false);

console.log('\ncss alignment mapping');
check('MIN', t.cssAlign('MIN'), 'flex-start');
check('MAX', t.cssAlign('MAX'), 'flex-end');
check('SPACE_BETWEEN', t.cssAlign('SPACE_BETWEEN'), 'space-between');
check('CENTER', t.cssAlign('CENTER'), 'center');

console.log('\nsvg dedupe hashing');
check('same string same hash', t.hashStr('<svg>a</svg>') === t.hashStr('<svg>a</svg>'), true);
check('different string different hash', t.hashStr('<svg>a</svg>') === t.hashStr('<svg>b</svg>'), false);

console.log('\nselectionInfo — drives the reset-on-new-selection message');
check('empty selection', t.selectionInfo(), { count: 0, names: [], target: null });
figma.currentPage.selection = [{ name: 'action-card' }];
// No parent chain on this stub, so it resolves to no picker row — which is the
// right answer for a node the picker cannot show.
check('single', t.selectionInfo(), { count: 1, names: ['action-card'], target: null });
figma.currentPage.selection = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }];
check('caps names at 3 but keeps true count',
  t.selectionInfo(), { count: 5, names: ['a', 'b', 'c'], target: null });
// Two frames name no single section, so nothing is pointed at.
figma.currentPage.selection = [
  { name: 'a', type: 'FRAME', parent: { id: 'p', type: 'PAGE' } },
  { name: 'b', type: 'FRAME', parent: { id: 'p', type: 'PAGE' } }
];
check('a multi-selection points at nothing', t.selectionInfo().target, null);
figma.currentPage.selection = [];

console.log('\nhex conversion');
check('white', t.hex({ r: 1, g: 1, b: 1 }), '#FFFFFF');
check('black', t.hex({ r: 0, g: 0, b: 0 }), '#000000');


console.log('\nresolveOpts — the options that stopped being checkboxes');
var base = t.resolveOpts({});
check('target is always webflow', base.target, 'webflow');
check('svg fixed on', base.svg, true);
check('images fixed on', base.images, true);
check('preview fixed on', base.screenshot, true);
check('a11y fixed on', base.a11y, true);
check('rootRole defaults to auto', base.rootRole, 'auto');
check('rootRole passes through', t.resolveOpts({ rootRole: 'section' }).rootRole, 'section');

// expandInstances is the exact inverse of REUSE. Getting this backwards means the
// builder rebuilds a component the user asked it to reuse, so it is pinned here.
check('defaults to a section', base.expandInstances, false);
check('section -> keep inner components as REUSE',
  t.resolveOpts({ kind: 'section' }).expandInstances, false);
check('new component -> still keep inner components as REUSE',
  t.resolveOpts({ kind: 'component' }).expandInstances, false);
check('a page walks like a section',
  t.resolveOpts({ kind: 'page' }).expandInstances, false);
check('update -> must expand, or the dump is one REUSE line',
  t.resolveOpts({ kind: 'update' }).expandInstances, true);
check('every kind the panel offers is known',
  t.KINDS, ['section', 'page', 'component', 'update']);
check('no site is asserted when unconnected', t.resolveOpts({}).site, null);
check('the connected project supplies the site',
  t.resolveOpts({ site: 'Acme Marketing' }).site, 'Acme Marketing');
check('an unknown kind falls back to section',
  t.resolveOpts({ kind: 'nonsense' }).expandInstances, false);

console.log('\npickerTargetFor — a canvas selection maps to a picker row');
{
  // page > Home > hero > title > span   — the picker only lists Home and hero
  var page  = { id: 'p1', type: 'PAGE', name: 'Marketing', parent: null };
  var home  = { id: 'home', type: 'FRAME', name: 'Home', parent: page };
  var hero  = { id: 'hero', type: 'FRAME', name: 'hero', parent: home };
  var title = { id: 't', type: 'TEXT', name: 'title', parent: hero };
  var span  = { id: 'sp', type: 'TEXT', name: 'span', parent: title };

  check('the page frame maps to itself', t.pickerTargetFor(home).nodeId, 'home');
  check('a section maps to itself', t.pickerTargetFor(hero).nodeId, 'hero');
  // The whole point: selecting deep inside a section should point at the section
  // you would queue, not at the page that contains it.
  check('a layer inside a section maps to the section', t.pickerTargetFor(title).nodeId, 'hero');
  check('however deep', t.pickerTargetFor(span).nodeId, 'hero');
  check('and it names the page each time', t.pickerTargetFor(span).pageId, 'p1');

  // A non-frame sitting straight on the page has no row to point at.
  var loose = { id: 'l', type: 'TEXT', name: 'stray', parent: page };
  check('a loose layer resolves to no row', t.pickerTargetFor(loose).nodeId, null);
  check('but still names the page', t.pickerTargetFor(loose).pageId, 'p1');

  check('a detached node resolves to nothing',
    t.pickerTargetFor({ id: 'x', type: 'FRAME', parent: null }), null);
  check('and so does nothing', t.pickerTargetFor(null), null);
}

console.log('\nuseStyleGuide — a project replaces the shipped defaults');
{
  var d = t.DEFAULT_PROFILE;
  check('defaults ship a class inventory', d.known.has('heading-style-h2'), true);

  var p1 = t.useStyleGuide({ known: ['only-this'], built: ['card'] });
  check('a project class list replaces the shipped one', p1.known.has('only-this'), true);
  check('and the shipped one is gone', p1.known.has('heading-style-h2'), false);
  check('built components come from the project', p1.built, ['card']);
  // Partial guides are the common case: correct one thing, inherit the rest
  // rather than restating a hundred class names.
  check('unset keys fall back', p1.textSize, d.textSize);

  // A site with no style guide yet is a real answer, not a missing key.
  var p2 = t.useStyleGuide({ known: [] });
  check('an empty list is honoured, not treated as absent', p2.known.size, 0);

  var p3 = t.useStyleGuide(null);
  check('no guide at all restores the defaults', p3.known.has('heading-style-h2'), true);
  t.useStyleGuide(null);   // leave the module as the rest of the suite expects
}

console.log('\nhasIcon — a failed export is not an icon');
{
  check('an exported icon is an icon', t.hasIcon({ svg: 0 }), true);
  check('index 3 too', t.hasIcon({ svg: 3 }), true);
  // Figma returns a reason string when it will not export a node; treating that
  // as an icon produced an HtmlEmbed with nothing to embed.
  check('a failure string is not', t.hasIcon({ svg: 'export failed: no visible layers' }), false);
  check('and neither is nothing', t.hasIcon({ svg: null }), false);

  var withIcon = t.cfElement({ svg: 0, w: 16, h: 16 }, { type: 'VECTOR' }, null);
  check('a real icon becomes an HtmlEmbed', withIcon.el, 'HtmlEmbed');
  var failed = t.cfElement({ svg: 'export failed: nope', w: 16, h: 16 }, { type: 'FRAME' }, null);
  check('a failed one does not', failed.el === 'HtmlEmbed', false);
}

console.log('\ncfClassName — auto-named layers must not collide');
{
  var cc = {};
  var mk = function (name, role) { return { name: name, role: role || 'layout', depth: 1 }; };
  var node = { type: 'FRAME', children: [] };
  // Three unnamed frames under one root used to become one class, so Webflow
  // would have created it once and applied it to all three.
  var a = t.cfClassName(mk('Frame'), node, 'hero', 'hero', cc);
  var b = t.cfClassName(mk('Frame 12'), node, 'hero', 'hero', cc);
  var c = t.cfClassName(mk('Group'), node, 'hero', 'hero', cc);
  check('first inferred keeps the plain name', a.cls, 'hero_content');
  check('second is disambiguated', b.cls, 'hero_content-2');
  check('third too', c.cls, 'hero_content-3');
  check('all three are marked inferred', [a.inferred, b.inferred, c.inferred], [true, true, true]);
  check('they are actually distinct', new Set([a.cls, b.cls, c.cls]).size, 3);

  // A hand-named layer is the designer's word and must never be renumbered,
  // even when the same name is used twice.
  var cc2 = {};
  var d = t.cfClassName(mk('card-body'), node, 'hero', 'hero', cc2);
  var e = t.cfClassName(mk('card-body'), node, 'hero', 'hero', cc2);
  check('hand-named is left alone', d.cls, 'hero_card-body');
  check('and repeats stay identical on purpose', e.cls, 'hero_card-body');
  check('not marked inferred', d.inferred, false);
}

console.log('\nsvgFileName — stable names for the files the bridge writes');
check('slugified with its index', t.svgFileName(0, 'Arrow Right'), 'icon-1-arrow-right.svg');
check('index keeps duplicates apart', t.svgFileName(3, 'Arrow Right'), 'icon-4-arrow-right.svg');
check('unnamed vectors still get a name', t.svgFileName(0, ''), 'icon-1-icon.svg');
check('junk characters cannot escape the name', t.svgFileName(1, '../../etc/passwd'),
  'icon-2-etc-passwd.svg');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
