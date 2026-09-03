# CDS Graph ADT Integration Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Tab 6 (CDS 关系图谱) mock data with live data fetched from the S4T system via ADT REST API.

**Architecture:** A new `src/adt-client.js` module handles all ADT communication and DDL parsing. The `analyzeCds` handler in `knowledge-service.js` switches from `buildGraph()` (mock) to `buildGraphFromAdt()` (live). The frontend (`App.controller.js`) is unchanged.

**Tech Stack:** Node.js, axios, ADT REST API (Basic Auth), BTP Destination Service (for CF deployment)

---

## Scope

- Replace mock data in `cds-graph-data.js` with live ADT calls
- Support two environments: local (direct IP) and CF (BTP Destination)
- No frontend changes required
- `cds-graph-data.js` is kept but no longer called by the main handler

---

## Environment Detection

The client detects which environment it is running in at call time:

**Local (default):** Read from `.env`:
```
ADT_URL=https://10.189.198.151:44300
ADT_USER=I524685
ADT_PASSWORD=<password>
```

**CF deployment:** When `VCAP_SERVICES` contains a `destination` service binding, use the BTP Connectivity proxy to call the `S4T_100_LST` destination:
- Proxy host: from `VCAP_SERVICES.connectivity[0].credentials.onpremise_proxy_host`
- Proxy port: from `VCAP_SERVICES.connectivity[0].credentials.onpremise_proxy_port`
- Add header `SAP-Connectivity-SCC-Location_ID: S4T`
- Destination URL/credentials fetched from Destination Service REST API

For the current phase (local only), only the `.env` path is implemented. CF support is scaffolded with a TODO comment.

---

## ADT API

**Endpoint:**
```
GET {ADT_URL}/sap/bc/adt/ddic/ddl/sources/{viewName}/source/main
Headers:
  Authorization: Basic base64(ADT_USER:ADT_PASSWORD)
  Accept: text/plain
  sap-client: 100
```

**S4T uses a self-signed certificate.** axios must be called with `httpsAgent: new https.Agent({ rejectUnauthorized: false })`.

**Response:** Plain text DDL source, e.g.:
```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@VDM.viewType: #BASIC
@VDM.lifecycle.contract.type: #PUBLIC_LOCAL_API
define view entity I_SalesOrder
  as select from VBAK as SalesOrder
  association [0..1] to I_BusinessPartner as _BusinessPartner ...
  association [0..*] to I_SalesOrderItem as _Item ...
{ ... }
```

---

## DDL Parsing Rules

All parsing is done with regex on the DDL plain text.

| Field | Source | Rule |
|-------|--------|------|
| `type` | `@VDM.viewType` annotation | `#BASIC`→`'Basic View'`, `#COMPOSITE`→`'Composite View'`, `#CONSUMPTION`→`'Consumption View'`, `#EXTENSION`→`'Extension View'`, none→`'CDS View'` |
| `releaseState` | `@VDM.lifecycle.contract.type` annotation | `#PUBLIC_LOCAL_API`→`'Released'`, `#RESTRICTED_LOCAL_API`→`'Restricted'`, none→`'Internal'` |
| `cleanCore` | derived | `releaseState === 'Released'` → `true`, else `false` |
| `classification` | derived | `'Released'`→`'C1'`, `'Restricted'`→`'C2'`, `'Internal'`→`'Not Classified'` |
| edges (join) | `as select from <name>` | regex: `/as\s+select\s+from\s+(\w+)/i` → `relation: 'join'` |
| edges (association) | `association ... to <name>` | regex: `/association\b.*?\bto\s+(\w+)/gi` → `relation: 'association'` |

Parsing extracts the primary `select from` source and all `association ... to` targets as neighbor nodes for BFS expansion.

---

## Graph Building (`buildGraphFromAdt`)

BFS traversal identical to the existing `buildGraph()` in `cds-graph-data.js`:

```
queue = [{ id: viewName, depth: 0 }]
while queue not empty:
  { id, depth } = queue.shift()
  if node already recorded at lower depth: skip
  fetch DDL for id via ADT
  parse → record node
  if depth < maxDepth:
    for each neighbor in (join target + association targets):
      edges.push({ source: id, target: neighbor, relation })
      queue.push({ id: neighbor, depth: depth + 1 })
return { nodes, edges }
```

**Concurrency:** Nodes at the same depth are fetched in parallel using `Promise.all` (per-depth batch, not all at once).

**Failure handling per node:**
- ADT returns 404 for a neighbor → record node as `{ type: 'Unknown', releaseState: 'Unknown', cleanCore: null, classification: 'Not Classified' }`, no further expansion
- ADT network error for a neighbor → same fallback, log warning, do not throw

**Failure handling for root node (the view the user typed):**
- ADT returns 404 → throw error with message `'CDS View "${viewName}" 在 S4T 系统中不存在'`
- Network/connection error → throw error with message `'无法连接 S4T 系统，请检查网络或 ADT 配置'`
- Other HTTP error → throw error with message `'ADT 请求失败：HTTP {status}'`

---

## Files

| File | Change |
|------|--------|
| `src/adt-client.js` | **New.** ADT HTTP client + DDL parser + `buildGraphFromAdt()` |
| `srv/knowledge-service.js` | **Modify.** Import `buildGraphFromAdt`, replace `buildGraph()` call in `analyzeCds` handler |
| `.env` | **Modify.** Add `ADT_URL`, `ADT_USER`, `ADT_PASSWORD` |
| `src/cds-graph-data.js` | **Keep unchanged.** No longer called by main handler, retained for reference |
| `app/knowledge/webapp/controller/App.controller.js` | **No change.** |

---

## Error Messages (frontend visible)

These error strings come from the CAP `req.error()` call and are displayed in the graph canvas by the existing error handler in `_doAnalyzeCds`:

| Condition | Message |
|-----------|---------|
| Root view not found (404) | `CDS View "${viewName}" 在 S4T 系统中不存在` |
| Connection failure | `无法连接 S4T 系统，请检查网络或 ADT 配置` |
| Other HTTP error | `ADT 请求失败：HTTP {status}` |

---

## Testing

Manual test steps (no automated test needed for this feature):

1. Start app with `npm run dev`, navigate to Tab 6
2. Enter `I_SalesOrder` → should render live graph with real nodes/edges from S4T
3. Enter a non-existent name (e.g. `ZZNOTEXIST`) → should show error message in canvas
4. Disconnect from VPN/network → should show connection error message
5. Verify node tooltip shows correct `releaseState`, `classification`, `cleanCore` values from live DDL
