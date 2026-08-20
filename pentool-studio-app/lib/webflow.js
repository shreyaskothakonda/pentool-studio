// A very small Webflow Data API client — page listing only.
//
// Scope note: building stays entirely on the Webflow MCP. This exists because
// the desktop app needs the page list for a dropdown *outside* any Claude
// session, which the MCP cannot provide. It is not a general REST escape hatch,
// and it should not grow into one; if a build step ever needs REST, that is a
// separate decision.
//
// Node built-ins only — global fetch. Injectable for tests.

const fs = require('fs');
const path = require('path');

const API = 'https://api.webflow.com/v2';
const PAGE_LIMIT = 100;

class WebflowError extends Error {
  constructor(msg, status) {
    super(msg);
    this.name = 'WebflowError';
    this.status = status || null;
  }
}

function friendly(status, body) {
  if (status === 401) return 'token rejected (401) — check it has not been revoked';
  if (status === 403) return 'token lacks the pages:read scope (403)';
  if (status === 404) return 'site not found (404) — check siteId';
  if (status === 429) return 'rate limited by Webflow (429) — try again shortly';
  const detail = (body && (body.message || body.msg)) || '';
  return `Webflow responded ${status}${detail ? ': ' + detail : ''}`;
}

/**
 * Every page on a site, following pagination.
 * @param {{siteId: string, token: string, fetchImpl?: Function}} opts
 * @returns {Promise<Array<{id,slug,title,draft,archived,publishedPath,parentId}>>}
 */
/**
 * Every site the token can reach. Unlike the other two calls this needs no
 * siteId — it is what you use to discover one when creating a project.
 * @param {{token: string, fetchImpl?: Function}} opts
 * @returns {Promise<Array<{id,name,shortName,previewUrl,lastPublished}>>}
 */
async function listSites(opts) {
  const token = opts.token;
  const doFetch = opts.fetchImpl || globalThis.fetch;

  if (!token) throw new WebflowError('no Webflow token — add one in Pentool settings');
  if (typeof doFetch !== 'function') throw new WebflowError('no fetch available in this runtime');

  const res = await doFetch(`${API}/sites`, {
    headers: { authorization: 'Bearer ' + token, accept: 'application/json' }
  });

  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) throw new WebflowError(friendly(res.status, body), res.status);
  if (!body || !Array.isArray(body.sites)) throw new WebflowError('unexpected response shape');

  // This endpoint is not paginated the way pages and components are — it returns
  // every site the token can see in one response.
  return body.sites.map((s) => ({
    id: s.id,
    name: s.displayName || s.shortName || '(untitled)',
    shortName: s.shortName || '',
    previewUrl: s.previewUrl || null,
    lastPublished: s.lastPublished || null
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function listPages(opts) {
  const siteId = opts.siteId;
  const token = opts.token;
  const doFetch = opts.fetchImpl || globalThis.fetch;

  if (!siteId) throw new WebflowError('siteId is required');
  if (!token) throw new WebflowError('no Webflow token — add one in Pentool settings');
  if (typeof doFetch !== 'function') throw new WebflowError('no fetch available in this runtime');

  const out = [];
  let offset = 0;
  let total = Infinity;
  let guard = 0;

  while (offset < total) {
    if (++guard > 50) throw new WebflowError('pagination did not terminate');
    const url = `${API}/sites/${encodeURIComponent(siteId)}/pages?limit=${PAGE_LIMIT}&offset=${offset}`;
    const res = await doFetch(url, {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' }
    });

    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new WebflowError(friendly(res.status, body), res.status);
    if (!body || !Array.isArray(body.pages)) throw new WebflowError('unexpected response shape');

    for (const p of body.pages) {
      out.push({
        id: p.id,
        slug: p.slug || '',
        title: p.title || p.slug || '(untitled)',
        draft: !!p.draft,
        archived: !!p.archived,
        parentId: p.parentId || null,
        publishedPath: p.publishedPath || (p.slug ? '/' + p.slug : '/')
      });
    }

    const pg = body.pagination || {};
    total = typeof pg.total === 'number' ? pg.total : out.length;
    const step = body.pages.length || PAGE_LIMIT;
    offset += step;
    if (!body.pages.length) break;
  }

  // Static pages first, then alphabetical — a usable dropdown order.
  out.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.draft !== b.draft) return a.draft ? 1 : -1;
    return a.publishedPath.localeCompare(b.publishedPath);
  });
  return out;
}

/**
 * Every component on a site, following pagination. Used for the "update an
 * existing component" flow, where you pick the Webflow component first and the
 * Figma frame second.
 * @param {{siteId: string, token: string, fetchImpl?: Function}} opts
 * @returns {Promise<Array<{id,name,group,description,readonly}>>}
 */
async function listComponents(opts) {
  const siteId = opts.siteId;
  const token = opts.token;
  const doFetch = opts.fetchImpl || globalThis.fetch;

  if (!siteId) throw new WebflowError('siteId is required');
  if (!token) throw new WebflowError('no Webflow token — add one in Pentool settings');
  if (typeof doFetch !== 'function') throw new WebflowError('no fetch available in this runtime');

  const out = [];
  let offset = 0;
  let total = Infinity;
  let guard = 0;

  while (offset < total) {
    if (++guard > 50) throw new WebflowError('pagination did not terminate');
    const url = `${API}/sites/${encodeURIComponent(siteId)}/components?limit=${PAGE_LIMIT}&offset=${offset}`;
    const res = await doFetch(url, {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' }
    });

    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new WebflowError(friendly(res.status, body), res.status);
    if (!body || !Array.isArray(body.components)) throw new WebflowError('unexpected response shape');

    for (const c of body.components) {
      out.push({
        id: c.id,
        name: c.name || '(unnamed)',
        group: c.group || null,
        description: c.description || null,
        // readonly components come from an installed library and cannot be updated
        readonly: !!c.readonly
      });
    }

    const pg = body.pagination || {};
    total = typeof pg.total === 'number' ? pg.total : out.length;
    offset += body.components.length || PAGE_LIMIT;
    if (!body.components.length) break;
  }

  // Updatable first, then grouped, then by name — a usable dropdown order.
  out.sort((a, b) => {
    if (a.readonly !== b.readonly) return a.readonly ? 1 : -1;
    const g = (a.group || '').localeCompare(b.group || '');
    return g !== 0 ? g : a.name.localeCompare(b.name);
  });
  return out;
}

const cacheFile = (root) => path.join(root, 'queue', '_pages.json');
const componentsCacheFile = (root) => path.join(root, 'queue', '_components.json');

function writePagesCache(root, pages, siteId) {
  const payload = {
    siteId: siteId || null,
    fetchedAt: new Date().toISOString(),
    pages: pages
  };
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.writeFileSync(cacheFile(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

function readPagesCache(root) {
  try { return JSON.parse(fs.readFileSync(cacheFile(root), 'utf8')); }
  catch (e) { return { siteId: null, fetchedAt: null, pages: [] }; }
}

function writeComponentsCache(root, components, siteId) {
  const payload = {
    siteId: siteId || null,
    fetchedAt: new Date().toISOString(),
    components: components
  };
  fs.mkdirSync(path.dirname(componentsCacheFile(root)), { recursive: true });
  fs.writeFileSync(componentsCacheFile(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

function readComponentsCache(root) {
  try { return JSON.parse(fs.readFileSync(componentsCacheFile(root), 'utf8')); }
  catch (e) { return { siteId: null, fetchedAt: null, components: [] }; }
}

module.exports = {
  listSites, listPages, listComponents,
  writePagesCache, readPagesCache,
  writeComponentsCache, readComponentsCache,
  WebflowError, cacheFile, componentsCacheFile
};
