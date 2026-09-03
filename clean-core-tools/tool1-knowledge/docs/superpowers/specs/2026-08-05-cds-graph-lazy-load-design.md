# CDS Graph Infinite Depth Lazy Loading Design

**Goal:** Allow the CDS dependency graph in Tab 6 to expand indefinitely deep, by lazily fetching a node's neighbors from ADT when the user clicks a node that has no cached children.

**Architecture:** Hybrid — the initial search pre-fetches 2 levels (existing logic). Local expand/collapse for cached nodes is instant. Clicking a boundary node (no cached children, not Unknown type) triggers an incremental API call that fetches only that node's direct neighbors (depth=1), merges the result into the live D3 simulation, then expands the node.

---

## Scope

- Backend: `analyzeCds` action gains an optional `parentViewName` parameter triggering incremental mode
- Frontend: `_renderGraph` gains `mergeIncrementalGraph`, lazy-load trigger in drag.end, and loading visual state
- No changes to `buildGraphFromAdt` or `adt-client.js`
- No changes to the initial 2-level pre-fetch behavior

---

## Backend Changes

### `srv/knowledge-service.cds`

Add optional `parentViewName` to the `analyzeCds` action:

```cds
action analyzeCds(viewName: String, parentViewName: String) returns {
  nodes: array of {
    id: String; type: String; releaseState: String;
    cleanCore: Boolean; classification: String; depth: Integer;
  };
  edges: array of {
    source: String; target: String; relation: String;
  };
};
```

### `srv/knowledge-service.js` — `analyzeCds` handler

When `parentViewName` is present (incremental mode):
1. Call `buildGraphFromAdt(viewName, 1)` — fetches viewName + its direct neighbors only
2. Enrich all returned nodes with `classifyWithGrounding` (same as full mode)
3. Return `{ nodes: allNodes, edges: allEdges }` — caller deduplicates

When `parentViewName` is absent (full mode): existing behavior unchanged (BFS depth=2).

The `depth` values returned in incremental mode are relative to `viewName` (0 = viewName itself, 1 = its neighbors). The frontend adjusts depth values when merging.

---

## Frontend Changes

### State additions to `_renderGraph`

```javascript
var nodeMap = {};          // id → node object (single source of truth)
var edgeKeys = new Set();  // "source|target|relation" for dedup
var loadingNodes = new Set(); // ids currently being fetched
```

Initial nodes/edges from `graphData` are populated into `nodeMap` and `edgeKeys` at render time.

### `mergeIncrementalGraph(centerNodeId, centerDepth, newNodes, newEdges)`

- For each node in `newNodes`:
  - If `id === centerNodeId`: skip (already in graph)
  - If `id` not in `nodeMap`: add to `nodeMap`, push to `nodes` array, set `depth = centerDepth + 1`
  - Update `childrenOf[centerNodeId]` with the new neighbor ids
- For each edge in `newEdges`:
  - Compute key `source|target|relation`
  - If not in `edgeKeys`: add to `edgeKeys`, push to `edges` array
- Rebuild simulation: `simulation.nodes(nodes)`, `simulation.force('link').links(edges)`, `simulation.alpha(0.3).restart()`
- Call `updateVisibility()`

### Lazy-load trigger (in `drag.end` click handler)

```javascript
// After checking expandedSet.has(d.id) and childrenOf[d.id].length > 0 cases:
// New branch: node has no cached children AND is not Unknown type AND not already loading
if (childrenOf[d.id].length === 0 && d.type !== 'Unknown' && !loadingNodes.has(d.id)) {
  loadingNodes.add(d.id);
  setNodeLoading(d.id, true);
  fetchIncrementalGraph(d.id, d.depth, function(newNodes, newEdges) {
    loadingNodes.delete(d.id);
    setNodeLoading(d.id, false);
    mergeIncrementalGraph(d.id, d.depth, newNodes, newEdges);
    expandedSet.add(d.id);
    updateVisibility();
    simulation.alpha(0.1).restart();
  }, function(err) {
    loadingNodes.delete(d.id);
    setNodeLoading(d.id, false);
    // treat as leaf: mark childrenOf[d.id] as confirmed empty so badge disappears
    d.type = 'Unknown';
    updateVisibility();
  });
}
```

### `fetchIncrementalGraph(viewName, centerDepth, onSuccess, onError)`

```javascript
fetch('/odata/v4/knowledge/analyzeCds', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ viewName: viewName, parentViewName: '_lazy_' }),
})
.then(function(res) {
  if (!res.ok) return res.json().then(function(e) { throw new Error(e.error && e.error.message || 'error'); });
  return res.json();
})
.then(function(data) { onSuccess(data.nodes || [], data.edges || []); })
.catch(function(err) { onError(err); });
```

### `setNodeLoading(id, isLoading)`

Visually marks a node as loading:
- `isLoading=true`: change node circle `stroke-dasharray` to `'4,2'` and `stroke` to `'#ffb300'`
- `isLoading=false`: restore original stroke style

Applied by selecting the specific node element in the D3 selection:
```javascript
node.filter(function(d) { return d.id === id; })
  .attr('stroke-dasharray', isLoading ? '4,2' : null)
  .attr('stroke', isLoading ? '#ffb300' : '#fff');
```

### Badge logic update

The badge (amber dot) should show when:
- Node is visible AND
- (`childrenOf[d.id].length > 0` AND not in expandedSet) OR (`childrenOf[d.id].length === 0` AND `d.type !== 'Unknown'`)

In other words: show badge for collapsed-with-children AND for potentially-expandable boundary nodes (not yet fetched, not Unknown).

---

## Error Handling

| Condition | Behavior |
|-----------|---------|
| ADT returns 404 for neighbor | Node already recorded as `type: 'Unknown'` by buildGraphFromAdt — badge hidden, click is no-op |
| Network error during lazy fetch | `onError` called: node `type` set to `'Unknown'`, badge disappears, loading style removed |
| User clicks same node twice during load | `loadingNodes.has(d.id)` guard prevents duplicate requests |

---

## Files

| File | Change |
|------|--------|
| `srv/knowledge-service.cds` | Add `parentViewName: String` to `analyzeCds` action parameters |
| `srv/knowledge-service.js` | Add incremental mode branch in `analyzeCds` handler |
| `app/knowledge/webapp/controller/App.controller.js` | Add `nodeMap`, `edgeKeys`, `loadingNodes`, `mergeIncrementalGraph`, `fetchIncrementalGraph`, `setNodeLoading`; update badge logic; add lazy-load trigger in drag.end |

---

## Testing

1. Search `I_SalesOrder` → root + depth-1 visible, depth-2 hidden
2. Click depth-1 node → depth-2 expands instantly (cached)
3. Click depth-2 node → loading indicator appears, ADT request fires, new depth-3 nodes appear
4. Click depth-3 node → same lazy load behavior
5. Collapse depth-2 node → its depth-3 children hidden; re-expand → instantly visible (cached)
6. Click a depth-2 node whose type is 'Unknown' → no badge shown, no request fired
7. Rapid double-click on boundary node → only one request fires (loadingNodes guard)
