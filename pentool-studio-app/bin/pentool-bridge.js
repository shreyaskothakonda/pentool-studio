#!/usr/bin/env node
// CLI wrapper around lib/bridge.js. The logic lives in the library so the
// Pentool app can host the same server in process.
//
//   node bin/pentool-bridge.js [--port 8930]

const path = require('path');
const { start, DEFAULT_PORT } = require('../lib/bridge');

const ROOT = path.join(__dirname, '..');
const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) : DEFAULT_PORT;

start({
  root: ROOT,
  port: PORT,
  onWrite: (r) => console.log(
    `→ ${r.replaced ? 'replaced' : 'wrote'} ${r.path}` +
    (r.images.length ? `  +${r.images.length} asset(s)` : '') +
    (r.warning ? `  (${r.warning})` : '')
  ),
  onError: (e) => console.log('✗ ' + e.message)
}).then((b) => {
  console.log('pentool-bridge listening on http://127.0.0.1:' + b.port);
  console.log('writing into ' + path.relative(process.cwd(), path.join(ROOT, 'queue', 'sections')));
  console.log('\n  token: ' + b.token + '\n');
  console.log('In Figma: Pentool Studio → Connect this file, then approve it in the browser.');
  console.log('The approval hands the token over; there is nothing to paste.');
  console.log('Add http://localhost:' + b.port + ' to devAllowedDomains in the plugin manifest.');
}).catch((err) => {
  if (err.friendly) {
    console.error('✗ ' + err.friendly);
    console.error('  Start on another port:  node bin/pentool-bridge.js --port 8931');
    console.error("  Then set bridgePort in queue/_config.json to match, and the same");
    console.error("  port in the plugin's devAllowedDomains (manifest.json) and ui.html.");
  } else {
    console.error('✗ ' + err.message);
  }
  process.exit(1);
});
