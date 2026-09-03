# CDS Graph ADT Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tab 6 mock graph data with live CDS View dependency data fetched from the S4T system via ADT REST API.

**Architecture:** New `src/adt-client.js` handles ADT HTTP calls and DDL parsing. The `analyzeCds` handler in `srv/knowledge-service.js` is updated to call `buildGraphFromAdt()` instead of `buildGraph()`. Frontend is untouched. Local env uses `.env` credentials; CF deployment uses BTP Destination (scaffolded for later).

**Tech Stack:** Node.js, axios (already in package.json), ADT REST API (Basic Auth, plain text DDL response), self-signed cert bypass

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/adt-client.js` | **Create** | ADT HTTP client, DDL parser, `buildGraphFromAdt()` |
| `srv/knowledge-service.js` | **Modify** line 8 + `analyzeCds` handler (~line 1178) | Swap import and handler call |
| `.env` | **Modify** | Add `ADT_URL`, `ADT_USER`, `ADT_PASSWORD` |

---

### Task 1: Add ADT credentials to .env

**Files:**
- Modify: `.env`

- [ ] **Step 1: Open `.env` and append the three ADT variables**

The current `.env` ends at line 7 (`API_HUB_KEY=...`). Append these three lines:

```
ADT_URL=https://10.189.198.151:44300
ADT_USER=I524685
ADT_PASSWORD=your_actual_password_here
```

Replace `your_actual_password_here` with the real S4T password for user `I524685`.

- [ ] **Step 2: Verify the file now contains all three variables**

Run:
```bash
grep ADT_ .env
```
Expected output (3 lines):
```
ADT_URL=https://10.189.198.151:44300
ADT_USER=I524685
ADT_PASSWORD=<your password>
```

---

### Task 2: Create `src/adt-client.js` — DDL parser (pure functions, no network)

**Files:**
- Create: `src/adt-client.js`

Start with only the pure parsing logic (no HTTP yet). This lets us test parsing before wiring up the network.

- [ ] **Step 1: Create the file with the DDL parser**

Create `src/adt-client.js` with this content:

```javascript
'use strict';

const https  = require('https');
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
  const vmMatch = ddl.match(/@VDM\.viewType\s*:\s*(#\w+)/i);
  const type = (vmMatch && VDM_TYPE_MAP[vmMatch[1]]) || 'CDS View';

  // @VDM.lifecycle.contract.type: #PUBLIC_LOCAL_API
  const lcMatch = ddl.match(/@VDM\.lifecycle\.contract\.type\s*:\s*(#\w+)/i);
  const releaseState = (lcMatch && RELEASE_MAP[lcMatch[1]]) || 'Internal';

  const cleanCore     = releaseState === 'Released';
  const classification =
    releaseState === 'Released'   ? 'C1' :
    releaseState === 'Restricted' ? 'C2' : 'Not Classified';

  const neighbors = [];

  // as select from <Name> [as alias]  → join
  const joinMatch = ddl.match(/as\s+select\s+from\s+(\w+)/i);
  if (joinMatch) {
    neighbors.push({ name: joinMatch[1], relation: 'join' });
  }

  // association [card] to <Name> [as alias]  → association
  const assocRe = /association\b[^t\n]*?\bto\s+(\w+)/gi;
  let m;
  while ((m = assocRe.exec(ddl)) !== null) {
    neighbors.push({ name: m[1], relation: 'association' });
  }

  return { type, releaseState, cleanCore, classification, neighbors };
}

module.exports = { parseDdl };
```

- [ ] **Step 2: Write a quick manual smoke test in the Node REPL**

Run:
```bash
node -e "
const { parseDdl } = require('./src/adt-client');
const ddl = \`
@VDM.viewType: #BASIC
@VDM.lifecycle.contract.type: #PUBLIC_LOCAL_API
define view entity I_SalesOrder
  as select from VBAK as SalesOrder
  association [0..1] to I_BusinessPartner as _BP
  association [0..*] to I_SalesOrderItem as _Item
{ SalesOrder }
\`;
console.log(JSON.stringify(parseDdl(ddl), null, 2));
"
```

Expected output:
```json
{
  "type": "Basic View",
  "releaseState": "Released",
  "cleanCore": true,
  "classification": "C1",
  "neighbors": [
    { "name": "VBAK", "relation": "join" },
    { "name": "I_BusinessPartner", "relation": "association" },
    { "name": "I_SalesOrderItem", "relation": "association" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/adt-client.js
git commit -m "feat: add CDS DDL parser for ADT integration"
```

---

### Task 3: Add ADT HTTP fetch to `src/adt-client.js`

**Files:**
- Modify: `src/adt-client.js`

Add the `fetchDdl()` function that calls ADT REST API.

- [ ] **Step 1: Add `fetchDdl` after the `parseDdl` function, before `module.exports`**

Replace the `module.exports` line at the bottom of `src/adt-client.js` with:

```javascript
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
```

- [ ] **Step 2: Manually test `fetchDdl` against S4T (requires being on internal network)**

Run:
```bash
node -e "
require('dotenv').config();
const { fetchDdl } = require('./src/adt-client');
fetchDdl('I_SalesOrder')
  .then(ddl => console.log(ddl.slice(0, 300)))
  .catch(err => console.error('ERROR:', err.message));
"
```

Expected: First 300 characters of the DDL source for `I_SalesOrder` printed to console.

If not on internal network, expected: `ERROR: 无法连接 S4T 系统，请检查网络或 ADT 配置`

- [ ] **Step 3: Commit**

```bash
git add src/adt-client.js
git commit -m "feat: add ADT HTTP fetch to adt-client"
```

---

### Task 4: Add `buildGraphFromAdt` to `src/adt-client.js`

**Files:**
- Modify: `src/adt-client.js`

Add the BFS graph builder that orchestrates `fetchDdl` + `parseDdl` recursively.

- [ ] **Step 1: Add `buildGraphFromAdt` before `module.exports`, then update exports**

Replace the `module.exports` line at the bottom with:

```javascript
// ── Graph Builder ────────────────────────────────────────────────────────────

/**
 * Build a CDS dependency graph starting from viewName by recursively
 * fetching DDL from ADT (BFS, up to maxDepth levels deep).
 *
 * @param {string} viewName   - Root CDS View name
 * @param {number} maxDepth   - Max BFS depth (default 2)
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
async function buildGraphFromAdt(viewName, maxDepth = 2) {
  const nodes   = new Map();   // id → node (keeps lowest depth)
  const edges   = [];
  const visited = new Set();   // nodes whose neighbors have been queued

  // Process root node first (throws user-facing error if not found)
  const rootDdl  = await fetchDdl(viewName);
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
      edges.push({ source: viewName, target: n.name, relation: n.relation });
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
          const ddl  = await fetchDdl(id);
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
            edges.push({ source: id, target: n.name, relation: n.relation });
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
```

- [ ] **Step 2: Smoke test `buildGraphFromAdt` (requires internal network)**

Run:
```bash
node -e "
require('dotenv').config();
const { buildGraphFromAdt } = require('./src/adt-client');
buildGraphFromAdt('I_SalesOrder')
  .then(g => {
    console.log('nodes:', g.nodes.length);
    console.log('edges:', g.edges.length);
    console.log('first node:', JSON.stringify(g.nodes[0]));
  })
  .catch(err => console.error('ERROR:', err.message));
"
```

Expected (approximate, actual numbers depend on S4T content):
```
nodes: 5+
edges: 4+
first node: {"id":"I_SalesOrder","type":"Basic View","releaseState":"Released","cleanCore":true,"classification":"C1","depth":0}
```

- [ ] **Step 3: Commit**

```bash
git add src/adt-client.js
git commit -m "feat: add BFS graph builder buildGraphFromAdt"
```

---

### Task 5: Wire `buildGraphFromAdt` into `knowledge-service.js`

**Files:**
- Modify: `srv/knowledge-service.js` line 8 (import) and ~line 1178 (handler)

- [ ] **Step 1: Replace the `cds-graph-data` import with `adt-client`**

Find this line in `srv/knowledge-service.js`:
```javascript
const { buildGraph } = require('../src/cds-graph-data');
```

Replace with:
```javascript
const { buildGraphFromAdt } = require('../src/adt-client');
```

- [ ] **Step 2: Replace the `analyzeCds` handler body**

Find this block in `srv/knowledge-service.js` (around line 1178):
```javascript
  srv.on('analyzeCds', async (req) => {
    const { viewName } = req.data;
    if (!viewName?.trim()) {
      return req.error(400, '请输入 CDS View 名称');
    }
    const graph = buildGraph(viewName.trim());
    if (!graph) {
      return req.error(404, `未找到 CDS View "${viewName.trim()}"。可用示例：I_SalesOrder、I_PurchaseOrder、I_JournalEntry、C_SalesOrderTP`);
    }
    return graph;
  });
```

Replace with:
```javascript
  srv.on('analyzeCds', async (req) => {
    const { viewName } = req.data;
    if (!viewName?.trim()) {
      return req.error(400, '请输入 CDS View 名称');
    }
    try {
      const graph = await buildGraphFromAdt(viewName.trim());
      return graph;
    } catch (err) {
      return req.error(404, err.message);
    }
  });
```

- [ ] **Step 3: Start the app and verify Tab 6 works end-to-end**

Run:
```bash
npm run dev
```

Navigate to Tab 6, enter `I_SalesOrder`, click 分析.

Expected: Force-directed graph renders with real nodes from S4T. Node tooltip shows `releaseState`, `classification` values from live DDL.

- [ ] **Step 4: Test error case — non-existent view**

Enter `ZZNOTEXIST` in Tab 6 input, click 分析.

Expected: Graph canvas shows error text `CDS View "ZZNOTEXIST" 在 S4T 系统中不存在`.

- [ ] **Step 5: Commit**

```bash
git add srv/knowledge-service.js
git commit -m "feat: connect analyzeCds handler to live ADT via buildGraphFromAdt"
```
