// End-to-end smoke: `node test-e2e.js`
//
// test.js covers the pure helpers. This drives the whole traversal — run() over
// a synthetic Figma document — and asserts the dump comes out shaped like a real
// capture: layout, typography, fills, strokes, inline SVG, the a11y audit and
// the preview export. It is the check that catches a break in the walk itself,
// which no amount of unit testing on the helpers would notice.
//
// The tree deliberately contains two accessibility failures (a low-contrast
// caption and an image fill with no alt) so the audit has something to report.
//
// Set DUMP=/path/to/file.txt to write the generated capture out for eyeballing.
const fs = require('fs'), vm = require('vm'), path = require('path');

const SRC = path.join(__dirname, 'code.js');
let src = fs.readFileSync(SRC, 'utf8') + '\nglobalThis.__run = run;\n';

const SOLID = (r,g,b) => ({ type:'SOLID', visible:true, opacity:1, color:{r,g,b} });

let uid = 0;
function node(o) {
  return Object.assign({
    id: 'n' + (++uid), visible: true, opacity: 1, blendMode: 'PASS_THROUGH',
    isMask: false, x: 0, y: 0, width: 100, height: 40,
    clipsContent: false, constraints: { horizontal:'MIN', vertical:'MIN' },
    effects: [], strokes: [], reactions: [],
    exportAsync: async () => new Uint8Array([137,80,78,71]),
  }, o);
}

const doc = node({
  type: 'FRAME', name: 'markets-grid', width: 1440, height: 720,
  layoutMode: 'VERTICAL', itemSpacing: 60, paddingTop: 96, paddingBottom: 96,
  paddingLeft: 80, paddingRight: 80, primaryAxisAlignItems: 'MIN',
  counterAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL',
  fills: [SOLID(0.98,0.97,0.96)], cornerRadius: 0,
  children: [
    node({ type:'TEXT', name:'Markets we serve', width: 640, height: 48, y: 96,
      characters: 'Markets we serve', fontSize: 40, fontName:{family:'Articulat CF', style:'Bold'},
      lineHeight: { unit:'PIXELS', value: 48 }, letterSpacing:{unit:'PIXELS',value:0},
      textAlignHorizontal:'CENTER', fills:[SOLID(0.1,0.1,0.1)],
      getStyledTextSegments: () => [], textAutoResize:'HEIGHT' }),
    node({ type:'FRAME', name:'market-card', width: 328, height: 344, y: 200,
      layoutMode:'VERTICAL', itemSpacing: 16, paddingTop:32, paddingBottom:32,
      paddingLeft:32, paddingRight:32, primaryAxisAlignItems:'MIN',
      counterAxisAlignItems:'MIN', cornerRadius: 12,
      fills:[SOLID(1,1,1)], strokes:[SOLID(0.9,0.9,0.9)], strokeWeight: 1, strokeAlign:'INSIDE',
      children: [
        node({ type:'VECTOR', name:'icon', width: 24, height: 24,
          fills:[SOLID(0,0,0)],
          exportAsync: async ({format}) => format === 'SVG_STRING'
            ? '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'
            : new Uint8Array([137,80,78,71]) }),
        node({ type:'TEXT', name:'card-title', width: 264, height: 32,
          characters: 'Equipment rental', fontSize: 24,
          fontName:{family:'Articulat CF', style:'Regular'},
          lineHeight:{unit:'PIXELS',value:32}, letterSpacing:{unit:'PIXELS',value:0},
          textAlignHorizontal:'LEFT', fills:[SOLID(0.1,0.1,0.1)],
          getStyledTextSegments: () => [], textAutoResize:'HEIGHT' }),
        node({ type:'TEXT', name:'faint-caption', width: 264, height: 20,
          characters: 'Barely visible', fontSize: 14,
          fontName:{family:'Articulat CF', style:'Regular'},
          lineHeight:{unit:'PIXELS',value:20}, letterSpacing:{unit:'PIXELS',value:0},
          textAlignHorizontal:'LEFT', fills:[SOLID(0.93,0.93,0.93)],
          getStyledTextSegments: () => [], textAutoResize:'HEIGHT' }),
        node({ type:'RECTANGLE', name:'photo', width: 264, height: 160,
          fills:[{ type:'IMAGE', visible:true, opacity:1, scaleMode:'FILL', imageHash:'abc123' }] }),
      ] }),
  ]
});

const figma = {
  mixed: Symbol('mixed'),
  root: { children: [], getPluginData: () => '', setPluginData: () => {} },
  getNodeByIdAsync: async () => null,
  openExternal() {},
  skipInvisibleInstanceChildren: false,
  showUI(){}, on(){},
  ui: { onmessage: null, postMessage(){}, resize(){} },
  clientStorage: { getAsync: async()=>null, setAsync: async()=>{} },
  currentPage: { selection: [doc] },
  variables: { getVariableByIdAsync: async()=>null, getVariableCollectionByIdAsync: async()=>null },
  getStyleByIdAsync: async()=>null,
};

const ctx = { figma, __html__:'', console, Symbol, Math, JSON, Map, Set, Number,
  String, Object, Array, Promise, Uint8Array, Error, RegExp, Boolean, Date, parseInt, parseFloat, isNaN };
vm.createContext(ctx);
vm.runInContext(src, ctx);

(async () => {
  const res = await ctx.__run({ target:'webflow', svg:true, screenshot:true, images:true, a11y:true, expandInstances:false, rootRole:'auto' });
  const text = res.text;
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, text);

  let pass = 0, fail = 0;
  const has = (label, cond) => { cond ? (pass++, console.log('  ok   ' + label))
                                      : (fail++, console.log('  FAIL ' + label)); };
  console.log('\nend-to-end capture — synthetic markets-grid\n');
  has('produced output', text.length > 200);
  has('names the root frame', /markets-grid/.test(text));
  has('walked into the card', /market-card/.test(text));
  has('walked into the text leaf', /Equipment rental/.test(text));
  has('emitted wf: class proposals', /wf:/.test(text));
  // These used to be asserted as Figma-vocabulary lines. They are now carried
  // only by the wf: CSS block, so the checks follow the information rather than
  // the old format — and prove the duplicate lines really are gone.
  has('auto-layout survives as flex css', /display: flex[\s\S]*flex-direction: column/.test(text));
  has('gap survives', /gap: 3\.75rem/.test(text));
  has('padding survives', /padding: 6rem 5rem/.test(text));
  has('fills survive as background', /background: #FAF7F5/.test(text));
  has('strokes survive as border', /border: 1px solid #E6E6E6/.test(text));
  has('radius survives', /border-radius: 0\.75rem/.test(text));
  has('typography is kept — css carries only colour', /type: 40\/48 Articulat CF Bold/.test(text));

  has('no duplicated figma layout line', !/^\s+layout: /m.test(text));
  has('no duplicated figma fill line', !/^\s+fill: /m.test(text));
  has('no duplicated figma stroke line', !/^\s+stroke: /m.test(text));
  has('no duplicated figma radius line', !/^\s+radius: /m.test(text));
  has('lists SVG files rather than inlining them', /=== SVG FILES ===/.test(text));
  has('no raw svg markup left in the dump', !/<svg/.test(text));
  has('keeps the layer-to-icon reference', /-> SVG #1/.test(text));
  has('names the file the bridge will write', /icon-1-icon\.svg/.test(text));
  has('still returns the sources for the shelf', res.svgs.length === 1 && /<svg/.test(res.svgs[0].svg));
  has('ran the a11y audit', /=== ACCESSIBILITY ===/.test(text));
  has('flagged low contrast', /fails AA/.test(text));
  has('flagged missing alt text', /needs alt text/.test(text));
  has('exported a preview png', res.images.some(i => /^_preview-/.test(i.name)));
  has('reported the root name', res.name === 'markets-grid');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:\n' + (e.stack||e)); process.exit(2); });
