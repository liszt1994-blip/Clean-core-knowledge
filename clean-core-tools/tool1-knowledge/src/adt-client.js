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

module.exports = { parseDdl };
