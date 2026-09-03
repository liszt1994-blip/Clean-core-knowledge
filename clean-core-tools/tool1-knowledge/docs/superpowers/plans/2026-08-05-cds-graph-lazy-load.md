# CDS Graph Infinite Depth Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Tab 6 CDS graph to expand infinitely deep by lazily fetching neighbors from ADT when the user clicks a boundary node that has no cached children.

**Architecture:** Backend `analyzeCds` action gains an optional `parentViewName` parameter; when present it runs `buildGraphFromAdt(viewName, 1)` and returns only the immediate neighbors. Frontend `_renderGraph` adds `nodeMap`/`edgeKeys`/`loadingNodes` state, a `mergeIncrementalGraph` function that splices new nodes/edges into the live D3 simulation, and a lazy-load trigger in the drag.end click handler. The badge logic is updated to show on boundary nodes (no cached children, type !== 'Unknown').

**Tech Stack:** Node.js CAP (srv/knowledge-service.js), CDS (srv/knowledge-service.cds), D3 v7 (frontend), ES5 JavaScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `srv/knowledge-service.cds` | Modify line 120 | Add `parentViewName: String` parameter to `analyzeCds` |
| `srv/knowledge-service.js` | Modify lines 1178–1206 | Add incremental mode branch in `analyzeCds` handler |
| `app/knowledge/webapp/controller/App.controller.js` | Modify `_renderGraph` | Add nodeMap, edgeKeys, loadingNodes, mergeIncrementalGraph, fetchIncrementalGraph, setNodeLoading, updated badge logic, lazy-load trigger |

---

### Task 1: Add `parentViewName` to CDS action definition

**Files:**
- Modify: `srv/knowledge-service.cds` line 120

- [ ] **Step 1: Update the `analyzeCds` action signature**

Find this in `srv/knowledge-service.cds`:
```cds
  action analyzeCds(viewName : String) returns {
```

Replace with:
```cds
  action analyzeCds(viewName : String, parentViewName : String) returns {
```

- [ ] **Step 2: Verify the CDS file compiles**

Run:
```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx cds compile srv/knowledge-service.cds --to json > /dev/null && echo "OK"
```
Expected: `OK` (no errors)

- [ ] **Step 3: Commit**

```bash
git add srv/knowledge-service.cds
git commit -m "feat: add parentViewName param to analyzeCds action"
```

---

### Task 2: Add incremental mode to `analyzeCds` handler

**Files:**
- Modify: `srv/knowledge-service.js` lines 1178–1206

- [ ] **Step 1: Replace the `analyzeCds` handler**

Find this entire block in `srv/knowledge-service.js`:
```javascript
  // ── Tab 6: CDS 关系图谱 ──────────────────────────────────────────────────
  srv.on('analyzeCds', async (req) => {
    const { viewName } = req.data;
    if (!viewName?.trim()) {
      return req.error(400, '请输入 CDS View 名称');
    }
    try {
      const graph = await buildGraphFromAdt(viewName.trim());

      // Enrich nodes with Clean Core classification via AI (same logic as Tab 1)
      // A/B = clean core compliant; C/D = not compliant
      await Promise.all(graph.nodes.map(async (node) => {
        try {
          const result = await classifyWithGrounding(node.id);
          if (result) {
            const tier = (result.tier || '').toUpperCase();
            node.cleanCore      = tier === 'A' || tier === 'B';
            node.classification = tier === 'A' ? 'C1' : tier === 'B' ? 'C2' : 'Not Classified';
            node.releaseState   = tier === 'A' ? 'Released' : tier === 'B' ? 'Restricted' : 'Internal';
          }
        } catch (_err) {
          // Classification failed for this node — keep ADT-parsed defaults
        }
      }));

      return graph;
    } catch (err) {
      return req.error(404, err.message);
    }
  });
```

Replace with:
```javascript
  // ── Tab 6: CDS 关系图谱 ──────────────────────────────────────────────────
  srv.on('analyzeCds', async (req) => {
    const { viewName, parentViewName } = req.data;
    if (!viewName?.trim()) {
      return req.error(400, '请输入 CDS View 名称');
    }

    // depth to fetch: incremental mode = 1 level only, full mode = 2 levels
    const maxDepth = parentViewName ? 1 : 2;

    try {
      const graph = await buildGraphFromAdt(viewName.trim(), maxDepth);

      // Enrich nodes with Clean Core classification via AI (same logic as Tab 1)
      // A/B = clean core compliant; C/D = not compliant
      await Promise.all(graph.nodes.map(async (node) => {
        try {
          const result = await classifyWithGrounding(node.id);
          if (result) {
            const tier = (result.tier || '').toUpperCase();
            node.cleanCore      = tier === 'A' || tier === 'B';
            node.classification = tier === 'A' ? 'C1' : tier === 'B' ? 'C2' : 'Not Classified';
            node.releaseState   = tier === 'A' ? 'Released' : tier === 'B' ? 'Restricted' : 'Internal';
          }
        } catch (_err) {
          // Classification failed for this node — keep ADT-parsed defaults
        }
      }));

      return graph;
    } catch (err) {
      return req.error(404, err.message);
    }
  });
```

- [ ] **Step 2: Verify the handler looks correct**

Run:
```bash
grep -A 5 "const { viewName, parentViewName }" "srv/knowledge-service.js"
```
Expected output includes `const maxDepth = parentViewName ? 1 : 2;`

- [ ] **Step 3: Commit**

```bash
git add srv/knowledge-service.js
git commit -m "feat: support incremental (depth=1) mode in analyzeCds handler"
```

---

### Task 3: Update `_renderGraph` with lazy-load infrastructure

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` — `_renderGraph` function

This task rewrites the section of `_renderGraph` from the state variables through the end of the function. The key changes are:

1. Add `nodeMap`, `edgeKeys`, `loadingNodes` alongside existing state
2. Add `rebuildD3Selections()` — recreates D3 node/link/label/badge selections from current `nodes`/`edges` arrays and re-binds tick handler
3. Add `mergeIncrementalGraph(centerNodeId, centerDepth, newNodes, newEdges)` — merges new data and calls `rebuildD3Selections()`
4. Add `fetchIncrementalGraph(viewName, centerDepth, onSuccess, onError)` — POST to analyzeCds with parentViewName
5. Add `setNodeLoading(id, isLoading)` — visual loading indicator
6. Update badge logic to show on boundary nodes (no children, type !== 'Unknown')
7. Update drag.end click handler to trigger lazy load for boundary nodes

- [ ] **Step 1: Replace the state setup block (lines ~575–623)**

Find this block in `_renderGraph`:
```javascript
      var nodes = graphData.nodes.map(function (d) { return Object.assign({}, d); });
      var edges = graphData.edges.map(function (d) { return Object.assign({}, d); });

      // ── 找到根节点 ────────────────────────────────────────────────────
      var rootNode = nodes.find(function (d) { return d.depth === 0; });
      var rootId   = rootNode ? rootNode.id : (nodes[0] && nodes[0].id);

      // ── 展开状态集合：初始只有根节点（表示其子节点可见）────────────────
      var expandedSet = new Set([rootId]);

      // ── 构建 childrenOf 映射：nodeId → [childId, ...] ─────────────────
      // edges 在 simulation 解析后 source/target 会变成对象，先用字符串 id
      var childrenOf = {};
      nodes.forEach(function (n) { childrenOf[n.id] = []; });
      edges.forEach(function (e) {
        var srcId = typeof e.source === 'object' ? e.source.id : e.source;
        var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
        if (childrenOf[srcId]) childrenOf[srcId].push(tgtId);
      });

      // ── 可见性函数 ────────────────────────────────────────────────────
      function nodeVisible(d) {
        if (d.depth === 0) return true;
        // visible if any edge points to it from an expanded node
        for (var i = 0; i < edges.length; i++) {
          var e = edges[i];
          var srcId = typeof e.source === 'object' ? e.source.id : e.source;
          var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
          if (tgtId === d.id && expandedSet.has(srcId)) return true;
        }
        return false;
      }

      function edgeVisible(e) {
        var srcId = typeof e.source === 'object' ? e.source.id : e.source;
        return expandedSet.has(srcId);
      }

      // ── 级联收起：移除节点及其所有后代（根节点始终保留）───────────────
      function collapseNode(id) {
        if (id === rootId) return;   // 根节点不可收起
        expandedSet.delete(id);
        var children = childrenOf[id] || [];
        children.forEach(function (childId) {
          if (childId !== rootId && expandedSet.has(childId)) {
            collapseNode(childId);
          }
        });
      }
```

Replace with:
```javascript
      var nodes = graphData.nodes.map(function (d) { return Object.assign({}, d); });
      var edges = graphData.edges.map(function (d) { return Object.assign({}, d); });

      // ── 找到根节点 ────────────────────────────────────────────────────
      var rootNode = nodes.find(function (d) { return d.depth === 0; });
      var rootId   = rootNode ? rootNode.id : (nodes[0] && nodes[0].id);

      // ── 展开状态集合：初始只有根节点（表示其子节点可见）────────────────
      var expandedSet = new Set([rootId]);

      // ── 懒加载状态 ────────────────────────────────────────────────────
      var nodeMap      = {};          // id → node object
      var edgeKeys     = new Set();   // "src|tgt|rel" 去重
      var loadingNodes = new Set();   // 正在请求的节点 id

      nodes.forEach(function (n) { nodeMap[n.id] = n; });
      edges.forEach(function (e) {
        var src = typeof e.source === 'object' ? e.source.id : e.source;
        var tgt = typeof e.target === 'object' ? e.target.id : e.target;
        edgeKeys.add(src + '|' + tgt + '|' + e.relation);
      });

      // ── 构建 childrenOf 映射：nodeId → [childId, ...] ─────────────────
      var childrenOf = {};
      nodes.forEach(function (n) { childrenOf[n.id] = []; });
      edges.forEach(function (e) {
        var srcId = typeof e.source === 'object' ? e.source.id : e.source;
        var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
        if (childrenOf[srcId]) childrenOf[srcId].push(tgtId);
      });

      // ── 可见性函数 ────────────────────────────────────────────────────
      function nodeVisible(d) {
        if (d.depth === 0) return true;
        for (var i = 0; i < edges.length; i++) {
          var e = edges[i];
          var srcId = typeof e.source === 'object' ? e.source.id : e.source;
          var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
          if (tgtId === d.id && expandedSet.has(srcId)) return true;
        }
        return false;
      }

      function edgeVisible(e) {
        var srcId = typeof e.source === 'object' ? e.source.id : e.source;
        return expandedSet.has(srcId);
      }

      // ── 级联收起：移除节点及其所有后代（根节点始终保留）───────────────
      function collapseNode(id) {
        if (id === rootId) return;
        expandedSet.delete(id);
        var children = childrenOf[id] || [];
        children.forEach(function (childId) {
          if (childId !== rootId && expandedSet.has(childId)) {
            collapseNode(childId);
          }
        });
      }

      // ── 懒加载：合并增量图数据并重建 D3 选择集 ──────────────────────
      function mergeIncrementalGraph(centerNodeId, centerDepth, newNodes, newEdges) {
        // 合并节点
        newNodes.forEach(function (n) {
          if (n.id === centerNodeId) return;   // 中心节点已在图中
          if (!nodeMap[n.id]) {
            var node = Object.assign({}, n, { depth: centerDepth + 1 });
            nodeMap[node.id] = node;
            nodes.push(node);
            childrenOf[node.id] = [];
          }
        });
        // 合并边（去重）
        newEdges.forEach(function (e) {
          var src = typeof e.source === 'object' ? e.source.id : e.source;
          var tgt = typeof e.target === 'object' ? e.target.id : e.target;
          var key = src + '|' + tgt + '|' + e.relation;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({ source: src, target: tgt, relation: e.relation });
            if (childrenOf[src]) childrenOf[src].push(tgt);
          }
        });
        // 重建 D3 选择集和 simulation
        rebuildD3Selections();
        simulation.nodes(nodes);
        simulation.force('link').links(edges);
        simulation.alpha(0.3).restart();
        setTimeout(function () { updateVisibility(); }, 50);
      }

      // ── 懒加载：向后端请求增量数据 ───────────────────────────────────
      function fetchIncrementalGraph(viewName, centerDepth, onSuccess, onError) {
        fetch('/odata/v4/knowledge/analyzeCds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewName: viewName, parentViewName: '_lazy_' }),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (e) {
              throw new Error(e.error && e.error.message || 'error');
            });
            return res.json();
          })
          .then(function (data) { onSuccess(data.nodes || [], data.edges || []); })
          .catch(function (err) { onError(err); });
      }

      // ── 懒加载：loading 视觉状态 ──────────────────────────────────────
      function setNodeLoading(id, isLoading) {
        node.filter(function (d) { return d.id === id; })
          .attr('stroke-dasharray', isLoading ? '4,2' : null)
          .attr('stroke', isLoading ? '#ffb300' : '#fff');
      }
```

- [ ] **Step 2: Update the badge visibility logic**

Find this block in `_renderGraph`:
```javascript
        // 徽章：节点可见 AND 有子节点 AND 未展开
        badge.style('display', function (d) {
          if (!nodeVisible(d)) return 'none';
          var children = childrenOf[d.id] || [];
          if (children.length === 0) return 'none';
          return expandedSet.has(d.id) ? 'none' : null;
        });
```

Replace with:
```javascript
        // 徽章：节点可见 AND 未展开 AND (有缓存子节点 OR 是可展开的边界节点)
        badge.style('display', function (d) {
          if (!nodeVisible(d)) return 'none';
          if (expandedSet.has(d.id)) return 'none';
          var children = childrenOf[d.id] || [];
          // 有缓存子节点：显示徽章
          if (children.length > 0) return null;
          // 边界节点：类型已知（非 Unknown）且未加载中 → 显示徽章提示可继续展开
          if (d.type !== 'Unknown' && !loadingNodes.has(d.id)) return null;
          return 'none';
        });
```

- [ ] **Step 3: Update the drag.end click handler to trigger lazy load**

Find this block in `_renderGraph`:
```javascript
            if (Math.sqrt(dx * dx + dy * dy) < 4) {
              var children = childrenOf[d.id] || [];
              if (children.length === 0) return;
              if (expandedSet.has(d.id)) {
                if (d.depth === 0) return;  // 根节点不收起，只能展开
                collapseNode(d.id);
              } else {
                expandedSet.add(d.id);
              }
              updateVisibility();
              simulation.alpha(0.1).restart();
            }
```

Replace with:
```javascript
            if (Math.sqrt(dx * dx + dy * dy) < 4) {
              var children = childrenOf[d.id] || [];

              if (expandedSet.has(d.id)) {
                // 已展开 → 收起（根节点除外）
                if (d.depth === 0) return;
                collapseNode(d.id);
                updateVisibility();
                simulation.alpha(0.1).restart();

              } else if (children.length > 0) {
                // 有缓存子节点 → 本地即时展开
                expandedSet.add(d.id);
                updateVisibility();
                simulation.alpha(0.1).restart();

              } else if (d.type !== 'Unknown' && !loadingNodes.has(d.id)) {
                // 边界节点 → 懒加载
                loadingNodes.add(d.id);
                setNodeLoading(d.id, true);
                updateVisibility();   // 更新徽章（loading 中隐藏徽章）
                fetchIncrementalGraph(d.id, d.depth, function (newNodes, newEdges) {
                  loadingNodes.delete(d.id);
                  setNodeLoading(d.id, false);
                  mergeIncrementalGraph(d.id, d.depth, newNodes, newEdges);
                  expandedSet.add(d.id);
                  updateVisibility();
                }, function (_err) {
                  loadingNodes.delete(d.id);
                  setNodeLoading(d.id, false);
                  // 标记为叶节点，防止重复请求
                  d.type = 'Unknown';
                  updateVisibility();
                });
              }
            }
```

- [ ] **Step 4: Add `rebuildD3Selections` function**

This function must be defined AFTER `simulation` is created but BEFORE the initial D3 selections. The tricky part: the current code creates `link`, `linkLabel`, `node`, `label`, `badge` as `var` declarations that are used in `tick` and `updateVisibility`. We need `rebuildD3Selections` to reassign those same variables.

Because JavaScript closures capture variables by reference (not value), we can reassign `link`, `node`, etc. inside `rebuildD3Selections` and all closures (`tick`, `updateVisibility`) will see the new values.

Find this line in `_renderGraph` (after `simulation` is created):
```javascript
      // ── 连线 ──────────────────────────────────────────────────────────
      var link = g.append('g')
```

Insert the following BEFORE that line:
```javascript
      // ── D3 选择集变量（rebuildD3Selections 会重新赋值）──────────────
      var link, linkLabel, node, label, badge;

      // ── 重建 D3 选择集（合并新节点/边后调用）─────────────────────────
      function rebuildD3Selections() {
        // 清除旧的 g 子元素，重新绘制
        g.selectAll('g').remove();

        link = g.append('g')
          .selectAll('line')
          .data(edges)
          .join('line')
          .attr('stroke', function (d) {
            return d.relation === 'association' ? '#42a5f5' : 'rgba(255,255,255,0.5)';
          })
          .attr('stroke-dasharray', function (d) {
            return d.relation === 'association' ? '5,3' : null;
          })
          .attr('stroke-opacity', function (d) {
            return d.relation === 'association' ? 0.7 : 0.5;
          })
          .attr('stroke-width', 1.5);

        linkLabel = g.append('g')
          .selectAll('text')
          .data(edges)
          .join('text')
          .attr('fill', '#888')
          .attr('font-size', '9px')
          .attr('text-anchor', 'middle')
          .text(function (d) { return d.relation; });

        node = g.append('g')
          .selectAll('circle')
          .data(nodes)
          .join('circle')
          .attr('r', nodeRadius)
          .attr('fill', nodeColor)
          .attr('filter', function (d) {
            return d.cleanCore === true ? 'url(#glow)' : null;
          })
          .attr('stroke', '#fff')
          .attr('stroke-width', function (d) { return d.depth === 0 ? 2.5 : 1; })
          .style('cursor', function (d) {
            var ch = childrenOf[d.id] || [];
            return (ch.length === 0 && d.type === 'Unknown') ? 'default' : 'pointer';
          })
          .call(d3.drag()
            .on('start', function (event, d) {
              dragStartX = event.x; dragStartY = event.y;
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x; d.fy = d.y;
            })
            .on('drag', function (event, d) {
              d.fx = event.x; d.fy = event.y;
            })
            .on('end', function (event, d) {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null; d.fy = null;
              var dx = event.x - dragStartX;
              var dy = event.y - dragStartY;
              if (Math.sqrt(dx * dx + dy * dy) < 4) {
                var children = childrenOf[d.id] || [];

                if (expandedSet.has(d.id)) {
                  if (d.depth === 0) return;
                  collapseNode(d.id);
                  updateVisibility();
                  simulation.alpha(0.1).restart();

                } else if (children.length > 0) {
                  expandedSet.add(d.id);
                  updateVisibility();
                  simulation.alpha(0.1).restart();

                } else if (d.type !== 'Unknown' && !loadingNodes.has(d.id)) {
                  loadingNodes.add(d.id);
                  setNodeLoading(d.id, true);
                  updateVisibility();
                  fetchIncrementalGraph(d.id, d.depth, function (newNodes, newEdges) {
                    loadingNodes.delete(d.id);
                    setNodeLoading(d.id, false);
                    mergeIncrementalGraph(d.id, d.depth, newNodes, newEdges);
                    expandedSet.add(d.id);
                    updateVisibility();
                  }, function (_err) {
                    loadingNodes.delete(d.id);
                    setNodeLoading(d.id, false);
                    d.type = 'Unknown';
                    updateVisibility();
                  });
                }
              }
            })
          )
          .on('mouseover', function (event, d) {
            var cleanText = d.cleanCore === true ? '✅ 合规' : d.cleanCore === false ? '❌ 不合规' : '—';
            tooltip.innerHTML =
              '<strong style="font-size:13px;">' + d.id + '</strong><br>' +
              '类型：' + (d.type || '—') + '<br>' +
              'Release：' + (d.releaseState || '—') + '<br>' +
              'Clean Core：' + cleanText + '<br>' +
              '分级：' + (d.classification || '—');
            tooltip.style.display = 'block';
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top  = (event.offsetY - 10) + 'px';
          })
          .on('mousemove', function (event) {
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top  = (event.offsetY - 10) + 'px';
          })
          .on('mouseout', function () {
            tooltip.style.display = 'none';
          });

        label = g.append('g')
          .selectAll('text')
          .data(nodes)
          .join('text')
          .attr('fill', '#fff')
          .attr('font-size', function (d) { return d.depth === 0 ? '13px' : '12px'; })
          .attr('text-anchor', 'middle')
          .attr('dy', function (d) { return nodeRadius(d) + 14; })
          .style('pointer-events', 'none')
          .text(function (d) { return d.id; });

        badge = g.append('g')
          .selectAll('circle')
          .data(nodes)
          .join('circle')
          .attr('r', 5)
          .attr('fill', '#ffb300')
          .attr('stroke', '#1a1a2e')
          .attr('stroke-width', 1.5)
          .style('pointer-events', 'none');
      }

```

- [ ] **Step 5: Replace the original static D3 selections with a call to `rebuildD3Selections`**

Now find the original static selections block. It starts with:
```javascript
      // ── 连线 ──────────────────────────────────────────────────────────
      var link = g.append('g')
        .selectAll('line')
        .data(edges)
        .join('line')
```

And ends just before:
```javascript
      // ── 节点标签 ──────────────────────────────────────────────────────
      var label = g.append('g')
```

Wait — with `rebuildD3Selections` now handling all selections, we need to remove the original inline declarations and replace them with a single call. The original code has:
- `var link = g.append('g')...` (連線)
- `var linkLabel = g.append('g')...` (連線標籤)
- The node circle block with drag handler (lines ~658–724)
- `var label = g.append('g')...` (節點標籤)
- `var badge = g.append('g')...` (徽章)

All of these are now handled by `rebuildD3Selections`. Replace all of them with a single call.

Find from:
```javascript
      // ── 连线 ──────────────────────────────────────────────────────────
      var link = g.append('g')
        .selectAll('line')
        .data(edges)
        .join('line')
        .attr('stroke', function (d) {
          return d.relation === 'association' ? '#42a5f5' : 'rgba(255,255,255,0.5)';
        })
        .attr('stroke-dasharray', function (d) {
          return d.relation === 'association' ? '5,3' : null;
        })
        .attr('stroke-opacity', function (d) {
          return d.relation === 'association' ? 0.7 : 0.5;
        })
        .attr('stroke-width', 1.5);

      // ── 连线标签（relation 类型）──────────────────────────────────────
      var linkLabel = g.append('g')
        .selectAll('text')
        .data(edges)
        .join('text')
        .attr('fill', '#888')
        .attr('font-size', '9px')
        .attr('text-anchor', 'middle')
        .text(function (d) { return d.relation; });

      // ── 节点圆圈 ──────────────────────────────────────────────────────
      // D3 drag 会阻止 click 事件，因此在 drag.end 中判断是否为点击（位移 < 4px）
      var dragStartX, dragStartY;

      var node = g.append('g')
```

To just before the `// ── 节点标签` comment. The entire block ends at `.on('mouseout'...)` closure.

Replace the entire block (from `// ── 连线` through the closing `);` of the node block) with:

```javascript
      // ── D3 初始渲染 ───────────────────────────────────────────────────
      var dragStartX, dragStartY;
      rebuildD3Selections();

```

- [ ] **Step 6: Clean up now-duplicate label and badge declarations**

After step 5, the code after `rebuildD3Selections()` still has:
```javascript
      // ── 节点标签 ──────────────────────────────────────────────────────
      var label = g.append('g')
        ...
      // ── 展开提示徽章（amber 小圆点，表示有隐藏子节点）──────────────────
      var badge = g.append('g')
        ...
```

Remove both of these blocks entirely — they are now handled inside `rebuildD3Selections`.

Find and delete:
```javascript
      // ── 节点标签 ──────────────────────────────────────────────────────
      var label = g.append('g')
        .selectAll('text')
        .data(nodes)
        .join('text')
        .attr('fill', '#fff')
        .attr('font-size', function (d) { return d.depth === 0 ? '13px' : '12px'; })
        .attr('text-anchor', 'middle')
        .attr('dy', function (d) { return nodeRadius(d) + 14; })
        .style('pointer-events', 'none')
        .text(function (d) { return d.id; });

      // ── 展开提示徽章（amber 小圆点，表示有隐藏子节点）──────────────────
      var badge = g.append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('r', 5)
        .attr('fill', '#ffb300')
        .attr('stroke', '#1a1a2e')
        .attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
```

- [ ] **Step 7: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: add lazy-load infinite depth expansion to Tab 6 CDS graph"
```

---

### Task 4: End-to-end verification

- [ ] **Step 1: Start the app**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm run dev
```

- [ ] **Step 2: Test initial render**

Navigate to Tab 6, enter `I_SalesOrder`, click 分析.

Expected: root + depth-1 nodes visible. Depth-1 nodes with children show amber badge. Depth-2 nodes hidden.

- [ ] **Step 3: Test cached expand/collapse**

Click a depth-1 node with a badge → depth-2 nodes appear instantly (no loading indicator).
Click same depth-1 node again → depth-2 nodes disappear.

- [ ] **Step 4: Test lazy load**

Click a depth-2 node that shows an amber badge → node gets dashed amber stroke (loading indicator) → after 2–5 seconds, depth-3 nodes appear around it.

- [ ] **Step 5: Test collapse after lazy expand**

After depth-3 nodes appear, click the depth-2 node again → depth-3 nodes disappear (cascade collapse). Click again → depth-3 nodes reappear instantly from cache (no new request).

- [ ] **Step 6: Test error case**

Disconnect from VPN. Click a boundary node. Expected: loading indicator appears then disappears, amber badge disappears (node marked as Unknown leaf).

---

## Self-Review

**Spec coverage:**
- ✅ `parentViewName` added to CDS action (Task 1)
- ✅ Incremental mode uses `maxDepth=1` (Task 2)
- ✅ `nodeMap`, `edgeKeys`, `loadingNodes` state added (Task 3 Step 1)
- ✅ `mergeIncrementalGraph` merges nodes+edges and rebuilds simulation (Task 3 Step 1)
- ✅ `fetchIncrementalGraph` POSTs with `parentViewName: '_lazy_'` (Task 3 Step 1)
- ✅ `setNodeLoading` visual indicator (Task 3 Step 1)
- ✅ Badge shows on boundary nodes (Task 3 Step 2)
- ✅ drag.end handler routes to lazy-load branch (Task 3 Step 3)
- ✅ `rebuildD3Selections` centralizes all D3 selections (Task 3 Step 4)
- ✅ Duplicate selections removed (Task 3 Steps 5–6)
- ✅ Error handling: marks node as Unknown on failure (Task 3 Step 3)
- ✅ Guard against duplicate requests: `loadingNodes.has(d.id)` (Task 3 Step 3)
- ✅ Re-expand after collapse uses cache (expandedSet.add + updateVisibility, no new fetch)

**Placeholder scan:** None found.

**Type consistency:** `link`, `linkLabel`, `node`, `label`, `badge` declared as `var` before `rebuildD3Selections`, reassigned inside it, read by `tick` and `updateVisibility` closures — consistent throughout. `childrenOf`, `expandedSet`, `nodeMap`, `edgeKeys`, `loadingNodes` all in same closure scope.

**Important note on rebuildD3Selections:** It calls `g.selectAll('g').remove()` before redrawing. This means the tooltip div (which is a direct child of `canvas`, not `g`) is unaffected. The SVG `g` element only contains the visualization groups. This is correct.
