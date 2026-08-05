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
 *   neighbors: Array<{ name: string, relation: 'join'|'association' }>
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

  // primary from source + any additional join targets → join
  const fromRe = /\bfrom\s+(\w+)/gi;
  let fm;
  while ((fm = fromRe.exec(ddl)) !== null) {
    neighbors.push({ name: fm[1], relation: 'join' });
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

/**
 * Fetch DDL source for a single CDS View from ADT.
 * Reads ADT_URL / ADT_USER / ADT_PASSWORD from process.env.
 *
 * @param {string} viewName
 * @returns {Promise<string>}  raw DDL text
 * @throws Error with user-facing Chinese message on failure
 */
async function fetchDdl(viewName) {
  const { ADT_URL, ADT_USER, ADT_PASSWORD } = process.env;
  if (!ADT_URL || !ADT_USER || !ADT_PASSWORD) {
    throw new Error('ADT 环境变量未配置（ADT_URL / ADT_USER / ADT_PASSWORD）');
  }

  // TODO: CF deployment — detect VCAP_SERVICES.destination binding and
  // route through BTP Connectivity proxy with S4T_100_LST destination instead.

  const url = `${ADT_URL}/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(viewName)}/source/main`;

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
      validateStatus: null,   // handle all status codes manually
    });

    if (resp.status === 404) {
      const err = new Error(`CDS View "${viewName}" 在 S4T 系统中不存在`);
      err.isNotFound = true;
      throw err;
    }
    if (resp.status !== 200) {
      throw new Error(`ADT 请求失败：HTTP ${resp.status}`);
    }

    return resp.data;
  } catch (err) {
    if (err.isNotFound || err.message.startsWith('ADT ') || err.message.startsWith('CDS View')) {
      throw err;   // already user-facing
    }
    // Network error (ECONNREFUSED, ETIMEDOUT, etc.)
    throw new Error('无法连接 S4T 系统，请检查网络或 ADT 配置');
  }
}

module.exports = { parseDdl, fetchDdl };
