# CDS Graph Expand/Collapse Interaction Design

**Goal:** Replace the static full-graph render in Tab 6 with an interactive expand/collapse tree. After searching, the root node and its direct dependencies (depth=1) are shown by default. Clicking a child node toggles its children visible/hidden. Clicking again collapses recursively.

**Architecture:** Frontend-only change. Backend returns the full pre-fetched graph (all depths) unchanged. The frontend maintains an `expandedSet` to track which nodes are expanded, and filters D3 node/link visibility on every state change.

**Scope:** Only `_renderGraph` in `App.controller.js` is modified. No backend changes.

---

## Interaction Rules

| Action | Result |
|--------|--------|
| Search completes | Root node (depth=0) + all depth=1 nodes are visible; depth≥2 nodes hidden |
| Click depth=0 (root) | No-op — root cannot be collapsed |
| Click unexpanded node | Add to `expandedSet`; its direct children become visible |
| Click expanded node | **Cascade collapse**: remove node and all its descendants from `expandedSet`; their children become hidden |

---

## State: `expandedSet`

A `Set<string>` of node IDs whose children are currently visible.

**Initial state:** contains the root node ID + all depth=1 node IDs.

**Why depth=1 nodes are in the set initially:** They are visible, and if they have children (depth=2) those children should be hidden by default — the set represents "this node's children are shown", and depth=1 nodes start with children hidden.

Correction: depth=1 nodes are visible (their parent = root which is in expandedSet). Whether depth=1 nodes are themselves in `expandedSet` determines if their children (depth=2) show. Initially depth=1 nodes are NOT in `expandedSet` — only root is. This means depth=2 nodes are hidden by default.

**Corrected initial state:** `expandedSet = new Set([rootId])` — only the root node.

---

## Visibility Calculation

Run after every `expandedSet` mutation:

```
nodeVisible(n):
  if n.depth === 0: return true   // root always visible
  return any edge (source→n) where nodeVisible(source) AND source.id ∈ expandedSet

edgeVisible(e):
  return e.source.id ∈ expandedSet AND nodeVisible(source node)
```

Because depth=1 nodes have root as their only parent, and root is always in `expandedSet`, depth=1 nodes are always visible. Depth=2 nodes are visible only when their depth=1 parent is in `expandedSet`.

Apply visibility with D3:
```javascript
node.style('display', function(d) { return nodeVisible(d) ? null : 'none'; });
link.style('display', function(d) { return edgeVisible(d) ? null : 'none'; });
label.style('display', function(d) { return nodeVisible(d) ? null : 'none'; });
linkLabel.style('display', function(d) { return edgeVisible(d) ? null : 'none'; });
```

---

## Cascade Collapse Algorithm

When collapsing node `n`:

```
function collapseNode(id):
  expandedSet.delete(id)
  for each node m where any edge (id → m) exists:
    if m.id ∈ expandedSet:
      collapseNode(m.id)   // recurse
```

This removes the entire subtree from `expandedSet`.

---

## Visual Badge (Expandable Indicator)

Nodes that have hidden children display a small badge:

- A small filled circle (radius 5px) at top-right of the node circle
- Color: `#ffb300` (amber)
- Visible when: node is visible AND node has at least one child edge AND node is NOT in `expandedSet`

Badge is a separate D3 `circle` selection updated alongside node/link visibility.

---

## Click Handler

Added to node circles:

```javascript
.on('click', function(event, d) {
  event.stopPropagation();
  if (d.depth === 0) return;  // root: no-op

  var childEdges = edges.filter(function(e) { return e.source.id === d.id; });
  if (childEdges.length === 0) return;  // leaf node: no-op

  if (expandedSet.has(d.id)) {
    collapseNode(d.id);
  } else {
    expandedSet.add(d.id);
  }
  updateVisibility();
  simulation.alpha(0.1).restart();  // gentle re-layout after visibility change
});
```

---

## Drag vs Click Disambiguation

D3 drag and click both fire on mousedown/mouseup. Disambiguate with a drag distance threshold:

```javascript
var dragMoved = false;
.call(d3.drag()
  .on('start', function(event, d) {
    dragMoved = false;
    ...
  })
  .on('drag', function(event, d) {
    dragMoved = true;
    ...
  })
  .on('end', function(event, d) { ... })
)
.on('click', function(event, d) {
  if (dragMoved) return;  // ignore click after drag
  ...
})
```

---

## Files

| File | Change |
|------|--------|
| `app/knowledge/webapp/controller/App.controller.js` | Modify `_renderGraph` only |

---

## Testing

1. Search `I_SalesOrder` → root + depth=1 nodes visible, depth=2 hidden
2. Click a depth=1 node that has children → its depth=2 children appear
3. Click the same depth=1 node again → depth=2 children disappear
4. Expand two depth=1 nodes → click root's sibling (another depth=1) → its subtree collapses, others unaffected
5. Expand depth=1 A → expand depth=2 B under A → click A → both A's badge and B's children disappear
6. Drag a node (long drag) → click does NOT fire expand/collapse
7. Leaf nodes (no children) → click does nothing, no badge shown
