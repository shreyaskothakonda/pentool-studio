/* The update channel.

   Pentool ships as a DMG, so a fix only reaches anyone who is told about it.
   This module is the telling. It does NOT install: macOS validates an update
   against the running app's designated requirement, and for an ad-hoc or Apple
   Development signature that requirement is pinned to the build's own hash, so
   no later build can ever satisfy it. Silent update needs a Developer ID.

   Announcing an update we cannot install would be worse than saying nothing —
   the user would be promised something that never arrives. So the app finds the
   release and hands it over; the drag to Applications stays theirs.

   The feed is GitHub Releases, in the shape electron-updater already expects.
   When there is a Developer ID, the release side needs no change at all. */

const https = require('https');

const REPO = 'shreyaskothakonda/pentool-studio';
const API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const RELEASES = 'https://github.com/' + REPO + '/releases';

// Unauthenticated: 60 requests an hour per IP, against at most five a day here.
// A token would have to ship inside the app, which is how tokens get published.
const TIMEOUT_MS = 8000;

/* Compare two versions numerically. Tolerant of a leading `v`, of unequal field
   counts (2.1 vs 2.1.0 are equal), and of junk in a field, which sorts as 0
   rather than NaN — a malformed tag must not silently outrank a real one. */
function compareVersions(a, b) {
  const parts = (v) => String(v == null ? '' : v).trim().replace(/^v/i, '')
    .split('.').map((n) => { const x = parseInt(n, 10); return Number.isFinite(x) ? x : 0; });
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/* Turn a GitHub release payload into something to show, or null.

   Null — not an exception — for every "nothing to say" case: already current,
   a draft, no DMG attached. A release with no DMG is the interesting one: it
   happens when a build fails halfway through publishing, and offering a
   download that 404s is a worse experience than staying quiet. */
function pickRelease(json, current) {
  if (!json || typeof json !== 'object') return null;
  if (json.draft) return null;

  const version = String(json.tag_name || '').trim().replace(/^v/i, '');
  if (!version) return null;
  if (compareVersions(version, current) <= 0) return null;

  const assets = Array.isArray(json.assets) ? json.assets : [];
  const dmg = assets.find((a) => a && typeof a.name === 'string' && /\.dmg$/i.test(a.name));
  if (!dmg || !dmg.browser_download_url) return null;

  return {
    version: version,
    notes: String(json.body || '').trim(),
    url: dmg.browser_download_url,
    page: json.html_url || RELEASES
  };
}

/* The one impure function, and the only one that can fail.

   It never rejects. A laptop is offline as a matter of course, GitHub rate
   limits, DNS fails — none of that is the user's problem to see. Every failure
   path resolves to null, which reads identically to "you are up to date". */
function check(current) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    let req;
    try {
      req = https.get(API, {
        headers: {
          // GitHub rejects requests with no User-Agent outright.
          'User-Agent': 'Pentool/' + current,
          'Accept': 'application/vnd.github+json'
        },
        timeout: TIMEOUT_MS
      }, (res) => {
        // Not followed by hand: the API returns the payload directly, and a
        // redirect here means something has changed that should be looked at.
        if (res.statusCode !== 200) { res.resume(); return done(null); }

        let body = '';
        res.setEncoding('utf8');
        // A malformed or hostile response must not be able to exhaust memory.
        res.on('data', (d) => {
          body += d;
          if (body.length > 512 * 1024) { req.destroy(); done(null); }
        });
        res.on('end', () => {
          try { done(pickRelease(JSON.parse(body), current)); }
          catch (e) { done(null); }
        });
        res.on('error', () => done(null));
      });
    } catch (e) { return done(null); }

    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

module.exports = { check, pickRelease, compareVersions, REPO, RELEASES, API };
