#!/usr/bin/env node
// Webflow's create_asset wants an MD5 of the exact bytes and hands back a
// presigned S3 form. Assembling that multipart POST by hand is fiddly and not
// worth doing in the model, so it lives here.
//
//   node bin/wf-asset.js hash <file>
//   node bin/wf-asset.js upload <file> <uploadUrl> <uploadDetailsJson>
//
// uploadDetailsJson may be the JSON itself or a path to a file containing it.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function hashFile(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

async function upload(file, url, detailsRaw) {
  let details;
  const asPath = !detailsRaw.trim().startsWith('{');
  try {
    details = JSON.parse(asPath ? fs.readFileSync(detailsRaw, 'utf8') : detailsRaw);
  } catch (e) {
    throw new Error('uploadDetails is not valid JSON: ' + e.message);
  }

  const form = new FormData();
  // S3 requires every presigned field before the file part, and in order.
  for (const [k, v] of Object.entries(details)) {
    if (k === 'file') continue;
    form.append(k, String(v));
  }
  const bytes = fs.readFileSync(file);
  form.append('file', new Blob([bytes]), path.basename(file));

  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`S3 responded ${res.status} ${res.statusText}\n${body.slice(0, 600)}`);
  }
  return { status: res.status, bytes: bytes.length };
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'hash') {
    if (!a[0]) throw new Error('usage: wf-asset.js hash <file>');
    console.log(hashFile(a[0]));
    return;
  }
  if (cmd === 'upload') {
    if (a.length < 3) throw new Error('usage: wf-asset.js upload <file> <uploadUrl> <uploadDetailsJson>');
    const r = await upload(a[0], a[1], a[2]);
    console.log(`uploaded ${path.basename(a[0])} (${r.bytes} bytes, HTTP ${r.status})`);
    return;
  }
  throw new Error('unknown command: ' + cmd);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
