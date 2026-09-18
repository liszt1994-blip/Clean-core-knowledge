'use strict';

const https  = require('https');   // used by fetchDdl() added in next task
const axios  = require('axios');

// ── DDL Parsing ──────────────────────────────────────────────────────────────

const VDM_TYPE_MAP = {
  '#BASIC':       'Basic View',
  '#COMPOSITE':   'Composite View',
  '#CONSUMPTION': 'Consumption View',
  '#EXTENSION':   'Extension View',
};

const RELEASE_MAP = {
  '#PUBLIC_LOCAL_API':     'Released',
  '#RESTRICTED_LOCAL_API': 'Restricted',
};

/**
 * Parse a CDS DDL source string into node metadata and neighbor names.
 * @param {string} ddl  - Raw DDL plain text from ADT
 * @returns {{
 *   type: string,
 *   releaseState: string,
 *   cleanCore: boolean,
 *   classification: string,
 *   neighbors: Array<{ name: string, relation: 'from'|'join'|'association' }>
 * }}
 */
function parseDdl(ddl) {
  // @VDM.viewType: #BASIC  (or #COMPOSITE etc.)
  const vdmMatch = ddl.match(/@VDM\.viewType\s*:\s*(#\w+)/);
  const type = (vdmMatch && VDM_TYPE_MAP[vdmMatch[1]]) || 'CDS View';

  // @VDM.lifecycle.contract.type: #PUBLIC_LOCAL_API
  const lcMatch = ddl.match(/@VDM\.lifecycle\.contract\.type\s*:\s*(#\w+)/);
  const releaseState = (lcMatch && RELEASE_MAP[lcMatch[1]]) || 'Internal';

  const cleanCore     = releaseState === 'Released';
  const classification =
    releaseState === 'Released'   ? 'C1' :
    releaseState === 'Restricted' ? 'C2' : 'Not Classified';

  const neighbors = [];

  // primary from source → from; explicit join targets → join
  const fromRe = /\bfrom\s+(\w+)/gi;
  let fm;
  while ((fm = fromRe.exec(ddl)) !== null) {
    neighbors.push({ name: fm[1], relation: 'from' });
  }
  const joinRe = /\bjoin\s+(\w+)/gi;
  let jm;
  while ((jm = joinRe.exec(ddl)) !== null) {
    neighbors.push({ name: jm[1], relation: 'join' });
  }

  // association [card] to [one|many] <Name>  → association
  const assocRe = /association\s*(?:\[[^\]]*\])?\s*to\s+(?:one\s+|many\s+)?(\w+)/gi;
  let m;
  while ((m = assocRe.exec(ddl)) !== null) {
    neighbors.push({ name: m[1], relation: 'association' });
  }

  return { type, releaseState, cleanCore, classification, neighbors };
}

// ── ADT HTTP Client ──────────────────────────────────────────────────────────

// Reuse a single https agent across calls (self-signed cert on S4T)
const HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });

// Pick the language for user-facing errors the same way the rest of the app
// does: any lang string starting with 'en' → English, everything else → Chinese.
function _isEn(lang) {
  return String(lang || '').toLowerCase().startsWith('en');
}

/**
 * Fetch DDL source for a single CDS View from ADT.
 * Reads ADT_URL / ADT_USER / ADT_PASSWORD from process.env.
 *
 * @param {string} viewName
 * @param {string} [lang='zh']  - Language for user-facing error messages
 * @returns {Promise<string>}  raw DDL text
 * @throws Error with user-facing message (localized) on failure
 */
async function fetchDdl(viewName, lang = 'zh') {
  const en = _isEn(lang);
  const { ADT_URL, ADT_USER, ADT_PASSWORD } = process.env;
  if (!ADT_URL || !ADT_USER || !ADT_PASSWORD) {
    throw new Error(en
      ? 'ADT environment variables are not configured (ADT_URL / ADT_USER / ADT_PASSWORD).'
      : 'ADT 环境变量未配置（ADT_URL / ADT_USER / ADT_PASSWORD）');
  }

  // TODO: CF deployment — detect VCAP_SERVICES.destination binding and
  // route through BTP Connectivity proxy with S4T_100_LST destination instead.

  const baseUrl = ADT_URL.replace(/\/$/, '');
  const url = `${baseUrl}/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(viewName)}/source/main`;

  try {
    const resp = await axios.get(url, {
      httpsAgent: HTTPS_AGENT,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${ADT_USER}:${ADT_PASSWORD}`).toString('base64'),
        Accept: 'text/plain',
        'sap-client': '100',
      },
      responseType: 'text',
      timeout: 15000,
      validateStatus: null,
    }).catch(e => {
      if (e.config && e.config.headers) delete e.config.headers['Authorization'];
      throw e;
    });

    if (resp.status === 404) {
      const err = new Error(en
        ? `CDS View "${viewName}" does not exist in the S4T system.`
        : `CDS View "${viewName}" 在 S4T 系统中不存在`);
      err.isUserFacing = true;
      throw err;
    }
    if (resp.status !== 200) {
      const err = new Error(en
        ? `ADT request failed: HTTP ${resp.status}`
        : `ADT 请求失败：HTTP ${resp.status}`);
      err.isUserFacing = true;
      throw err;
    }

    return resp.data;
  } catch (err) {
    if (err.isUserFacing) throw err;
    // Network error (ECONNREFUSED, ETIMEDOUT, etc.)
    throw new Error(en
      ? 'Cannot connect to the S4T system. Please check the network or ADT configuration.'
      : '无法连接 S4T 系统，请检查网络或 ADT 配置');
  }
}

// ── Graph Builder ────────────────────────────────────────────────────────────

/**
 * Build a CDS dependency graph starting from viewName by recursively
 * fetching DDL from ADT (BFS, up to maxDepth levels deep).
 *
 * @param {string} viewName   - Root CDS View name
 * @param {number} maxDepth   - Max BFS depth (default 2)
 * @param {string} [lang='zh'] - Language for user-facing error messages
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
async function buildGraphFromAdt(viewName, maxDepth = 2, lang = 'zh') {
  const nodes   = new Map();   // id → node (keeps lowest depth)
  const edges   = [];
  const edgeKeys = new Set();   // dedup: 'source|target|relation'
  const visited = new Set();   // nodes whose neighbors have been queued

  // Process root node first (throws user-facing error if not found)
  const rootDdl  = await fetchDdl(viewName, lang);
  const rootMeta = parseDdl(rootDdl);
  nodes.set(viewName, {
    id: viewName,
    type:           rootMeta.type,
    releaseState:   rootMeta.releaseState,
    cleanCore:      rootMeta.cleanCore,
    classification: rootMeta.classification,
    depth: 0,
  });
  visited.add(viewName);

  // BFS queue: each entry is { id, depth }
  // Seed with root's neighbors
  let currentQueue = rootMeta.neighbors
    .filter(n => n.name !== viewName)
    .map(n => {
      const ek0 = `${viewName}|${n.name}|${n.relation}`;
      if (!edgeKeys.has(ek0)) { edgeKeys.add(ek0); edges.push({ source: viewName, target: n.name, relation: n.relation }); }
      return { id: n.name, depth: 1 };
    });

  // Expand level by level up to maxDepth
  for (let depth = 1; depth <= maxDepth && currentQueue.length > 0; depth++) {
    // Deduplicate queue entries at this depth
    const unique = [];
    const seen   = new Set();
    for (const item of currentQueue) {
      if (!seen.has(item.id)) { seen.add(item.id); unique.push(item); }
    }

    // Fetch all nodes at this depth in parallel
    const results = await Promise.all(
      unique.map(async ({ id, depth: d }) => {
        // Skip if already recorded at a lower depth
        if (nodes.has(id) && nodes.get(id).depth < d) return { id, meta: null, d };
        try {
          const ddl  = await fetchDdl(id, lang);
          const meta = parseDdl(ddl);
          return { id, meta, d };
        } catch (_err) {
          // Neighbor not found or unreachable — record as unknown, no expansion
          console.warn(`[adt-client] Could not fetch DDL for ${id}: ${_err.message}`);
          return { id, meta: null, d };
        }
      })
    );

    const nextQueue = [];
    for (const { id, meta, d } of results) {
      if (!nodes.has(id) || nodes.get(id).depth > d) {
        nodes.set(id, {
          id,
          type:           meta ? meta.type           : 'Unknown',
          releaseState:   meta ? meta.releaseState    : 'Unknown',
          cleanCore:      meta ? meta.cleanCore       : null,
          classification: meta ? meta.classification  : 'Not Classified',
          depth: d,
        });
      }
      if (meta && !visited.has(id) && d < maxDepth) {
        visited.add(id);
        for (const n of meta.neighbors) {
          if (n.name !== id) {
            const ek = `${id}|${n.name}|${n.relation}`;
            if (!edgeKeys.has(ek)) { edgeKeys.add(ek); edges.push({ source: id, target: n.name, relation: n.relation }); }
            nextQueue.push({ id: n.name, depth: d + 1 });
          }
        }
      }
    }
    currentQueue = nextQueue;
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
}

module.exports = { parseDdl, fetchDdl, buildGraphFromAdt };
