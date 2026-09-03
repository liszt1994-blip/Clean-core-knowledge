# CDS Graph Expand/Collapse Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static full-graph render in Tab 6 with an interactive expand/collapse tree — root + depth-1 nodes shown by default, clicking a child node toggles its children, cascading collapse on re-click.

**Architecture:** Frontend-only change. The backend already returns the full pre-fetched graph (all depths). The `_renderGraph` method in `App.controller.js` is rewritten to maintain an `expandedSet` tracking which nodes have their children visible, compute node/edge visibility from that set, and update D3 selections on every click. No other files change.

**Tech Stack:** D3.js v7 (already loaded), plain ES5 JavaScript (existing codebase style), SAP UI5 App.controller.js

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/knowledge/webapp/controller/App.controller.js` | **Modify** — replace `_renderGraph` (lines 513–685) | Expand/collapse state, visibility calc, badge rendering, click handler |

---

### Task 1: Replace `_renderGraph` with expand/collapse version

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js` lines 513–685

This is a full replacement of `_renderGraph`. The new version adds:
1. `expandedSet` — tracks which node IDs have their children visible (initially only root)
2. `nodeVisible(d)` / `edgeVisible(e)` — pure visibility functions
3. `collapseNode(id)` — recursive cascade collapse
4. `updateVisibility()` — applies show/hide to all D3 selections + updates badge
5. Badge circles — amber dot on nodes that have hidden children
6. Click handler with drag-vs-click disambiguation via `dragMoved` flag

- [ ] **Step 1: Replace the entire `_renderGraph` function**

Find this exact line in `app/knowledge/webapp/controller/App.controller.js`:
```javascript
    _renderGraph: function (graphData) {
      // 停止旧 simulation 防止 CPU 泄漏
      if (this._graphSimulation) {
```

Replace the entire `_renderGraph` function (from `_renderGraph: function (graphData) {` through the closing `},` at line 685) with:

```javascript
    _renderGraph: function (graphData) {
      // 停止旧 simulation 防止 CPU 泄漏
      if (this._graphSimulation) {
        this._graphSimulation.stop();
        this._graphSimulation = null;
      }

      var canvas = document.getElementById('ccGraphCanvas');
      if (!canvas) return;

      // 清除旧内容
      canvas.innerHTML = '';

      var width  = canvas.clientWidth  || 800;
      var height = canvas.clientHeight || 600;

      // ── Tooltip div ──────────────────────────────────────────────────
      var tooltip = document.createElement('div');
      tooltip.id = 'ccGraphTooltip';
      tooltip.style.cssText = 'position:absolute;display:none;background:rgba(0,0,0,0.85);color:#fff;' +
        'border:1px solid #0a6ed1;border-radius:6px;padding:10px 14px;font-size:12px;' +
        'pointer-events:none;max-width:260px;z-index:100;line-height:1.7;';
      canvas.appendChild(tooltip);

      var d3 = window.d3;

      // ── SVG ──────────────────────────────────────────────────────────
      var svg = d3.select(canvas)
        .append('svg')
        .attr('width', '100%')
        .attr('height', height)
        .style('background', '#1a1a2e')
        .call(d3.zoom().scaleExtent([0.3, 3]).on('zoom', function (event) {
          g.attr('transform', event.transform);
        }));

      // ── SVG filter: 发光效果（仅合规节点使用）────────────────────────
      var defs = svg.append('defs');
      var g = svg.append('g');
      var filter = defs.append('filter').attr('id', 'glow');
      filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
      var feMerge = filter.append('feMerge');
      feMerge.append('feMergeNode').attr('in', 'coloredBlur');
      feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

      // ── 颜色和大小工具函数 ────────────────────────────────────────────
      function nodeColor(d) {
        if (d.cleanCore === true)  return '#0a6ed1';
        if (d.cleanCore === false) return '#e53935';
        return '#666';
      }
      function nodeRadius(d) {
        if (d.depth === 0) return 28;
        if (d.depth === 1) return 18;
        return 12;
      }

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

      // ── 级联收起：移除节点及其所有后代 ───────────────────────────────
      function collapseNode(id) {
        expandedSet.delete(id);
        var children = childrenOf[id] || [];
        children.forEach(function (childId) {
          if (expandedSet.has(childId)) {
            collapseNode(childId);
          }
        });
      }

      // ── 力导向仿真 ────────────────────────────────────────────────────
      var simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(function (d) { return d.id; }).distance(120))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2));
      this._graphSimulation = simulation;

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
      var dragMoved = false;

      var node = g.append('g')
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
          return (d.depth === 0 || (childrenOf[d.id] && childrenOf[d.id].length === 0))
            ? 'default' : 'pointer';
        })
        .call(d3.drag()
          .on('start', function (event, d) {
            dragMoved = false;
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', function (event, d) {
            dragMoved = true;
            d.fx = event.x; d.fy = event.y;
          })
          .on('end', function (event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
        )
        .on('click', function (event, d) {
          event.stopPropagation();
          if (dragMoved) return;
          if (d.depth === 0) return;
          var children = childrenOf[d.id] || [];
          if (children.length === 0) return;
          if (expandedSet.has(d.id)) {
            collapseNode(d.id);
          } else {
            expandedSet.add(d.id);
          }
          updateVisibility();
          simulation.alpha(0.1).restart();
        })
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

      // ── 更新可见性（节点/边/标签/徽章）──────────────────────────────
      function updateVisibility() {
        node.style('display', function (d) {
          return nodeVisible(d) ? null : 'none';
        });
        label.style('display', function (d) {
          return nodeVisible(d) ? null : 'none';
        });
        link.style('display', function (d) {
          return edgeVisible(d) ? null : 'none';
        });
        linkLabel.style('display', function (d) {
          return edgeVisible(d) ? null : 'none';
        });
        // 徽章：节点可见 AND 有子节点 AND 未展开
        badge.style('display', function (d) {
          if (!nodeVisible(d)) return 'none';
          var children = childrenOf[d.id] || [];
          if (children.length === 0) return 'none';
          return expandedSet.has(d.id) ? 'none' : null;
        });
      }

      // ── 每帧更新位置 ──────────────────────────────────────────────────
      simulation.on('tick', function () {
        link
          .attr('x1', function (d) { return d.source.x; })
          .attr('y1', function (d) { return d.source.y; })
          .attr('x2', function (d) { return d.target.x; })
          .attr('y2', function (d) { return d.target.y; });

        linkLabel
          .attr('x', function (d) { return (d.source.x + d.target.x) / 2; })
          .attr('y', function (d) { return (d.source.y + d.target.y) / 2; });

        node
          .attr('cx', function (d) { return d.x; })
          .attr('cy', function (d) { return d.y; });

        label
          .attr('x', function (d) { return d.x; })
          .attr('y', function (d) { return d.y; });

        badge
          .attr('cx', function (d) { return d.x + nodeRadius(d) * 0.7; })
          .attr('cy', function (d) { return d.y - nodeRadius(d) * 0.7; });
      });

      // ── 初始可见性（simulation 解析 source/target 后 edges 已是对象）──
      // 在第一次 tick 之后更新（edges 的 source/target 此时已是对象引用）
      simulation.on('end.init', function () {
        simulation.on('end.init', null);
        updateVisibility();
      });
      // 也在第一帧就更新一次（alpha 初始较高，确保立即生效）
      setTimeout(function () { updateVisibility(); }, 50);
    },
```

- [ ] **Step 2: 启动应用验证基本效果**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm run dev
```

在浏览器打开 Tab 6，输入 `I_SalesOrder`，点击分析。

预期结果：
- 图谱出现，只显示根节点 + 第 1 层直接依赖节点
- 有子节点的第 1 层节点右上角显示**琥珀色小圆点**
- 第 2 层节点不可见

- [ ] **Step 3: 验证展开交互**

点击一个有琥珀色圆点的子节点。

预期结果：
- 该节点的子节点（第 2 层）出现
- 琥珀色圆点消失（因为已展开）
- 再次点击该节点 → 第 2 层节点消失，圆点重新出现

- [ ] **Step 4: 验证级联收起**

先展开节点 A（第 1 层），再展开 A 的子节点 B（第 2 层）。
然后点击 A 收起。

预期结果：
- A 的子节点（包括 B）全部消失
- B 之前展开的子节点也消失（级联）
- A 的琥珀色圆点重新出现

- [ ] **Step 5: 验证拖拽不触发展开**

拖动一个有子节点的节点到新位置（鼠标移动距离 > 5px）。

预期结果：
- 节点被拖拽移动
- 展开/收起状态**不变**（dragMoved 标志阻止了 click 事件）

- [ ] **Step 6: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: add expand/collapse interaction to Tab 6 CDS graph"
```

---

## Self-Review

**Spec coverage:**
- ✅ 初始显示根节点 + 第 1 层（expandedSet 初始只含 root，nodeVisible 对 depth=1 返回 true）
- ✅ 点击子节点展开其子节点
- ✅ 再次点击收起
- ✅ 级联收起（collapseNode 递归）
- ✅ 根节点不可收起（depth=0 check in click handler）
- ✅ 叶节点点击无操作（children.length === 0 check）
- ✅ 拖拽不触发展开（dragMoved flag）
- ✅ 琥珀色徽章提示可展开节点
- ✅ 只改 _renderGraph，其他文件不动

**Placeholder scan:** None found.

**Type consistency:** `expandedSet`、`childrenOf`、`collapseNode`、`updateVisibility`、`nodeVisible`、`edgeVisible`、`badge`、`dragMoved` — 所有名称在函数内一致使用。

**Edge case: simulation 解析 source/target 时序**
D3 forceLink 在第一次 tick 之前将 `edges[i].source` 从字符串 id 转换为节点对象。`childrenOf` 在 simulation 创建之前构建（使用字符串 id），因此不受影响。`nodeVisible` 和 `edgeVisible` 使用 `typeof e.source === 'object' ? e.source.id : e.source` 处理两种格式，安全。`updateVisibility` 通过 `setTimeout(50ms)` 延迟首次调用，确保 D3 已完成第一次 tick 解析。
