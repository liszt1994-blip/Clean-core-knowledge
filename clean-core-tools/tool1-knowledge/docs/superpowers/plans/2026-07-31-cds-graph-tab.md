# CDS 关系图谱 Tab 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增"关系图谱" Tab，用户输入 CDS View 名称后，用 D3.js 力导向图展示该 View 与其关联对象（association/join）的关系图谱，节点颜色区分 Clean Core 合规性，悬停显示详情卡片。

**Architecture:** 新建 `src/cds-graph-data.js` 封装模拟数据和 BFS 递归展开逻辑；后端在 `knowledge-service.cds` 新增 `analyzeCds` action，`knowledge-service.js` 实现 handler；前端 `App.controller.js` 新增第五个 Tab，通过动态注入 D3.js CDN 渲染力导向图。

**Tech Stack:** SAP UI5 (sap.m)，D3.js v7（CDN 懒加载），Node.js，SAP CAP CDS，Jest 单元测试。

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `src/cds-graph-data.js` |
| 新增 | `src/cds-graph-data.test.js` |
| 修改 | `srv/knowledge-service.cds`（末尾 `}` 之前追加） |
| 修改 | `srv/knowledge-service.js`（require + handler） |
| 修改 | `srv/knowledge-service.test.js`（新增 analyzeCds 测试） |
| 修改 | `app/knowledge/webapp/controller/App.controller.js`（多处） |

---

### Task 1: 新建 `src/cds-graph-data.js` 并通过单元测试

**Files:**
- Create: `src/cds-graph-data.js`
- Create: `src/cds-graph-data.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/cds-graph-data.test.js`：

```javascript
'use strict';

const { buildGraph } = require('./cds-graph-data');

test('buildGraph returns null for unknown view', () => {
  expect(buildGraph('UNKNOWN_VIEW')).toBeNull();
});

test('buildGraph returns root node for known view with depth=0', () => {
  const result = buildGraph('I_SalesOrder');
  expect(result).not.toBeNull();
  const root = result.nodes.find(n => n.id === 'I_SalesOrder');
  expect(root).toBeDefined();
  expect(root.depth).toBe(0);
  expect(root.cleanCore).toBe(true);
  expect(root.releaseState).toBe('Released');
});

test('buildGraph returns depth-1 neighbours', () => {
  const result = buildGraph('I_SalesOrder');
  const ids = result.nodes.map(n => n.id);
  expect(ids).toContain('I_SalesOrderItem');
  expect(ids).toContain('I_BusinessPartner');
  expect(ids).toContain('I_SalesOrganization');
});

test('buildGraph returns edges with correct relation type', () => {
  const result = buildGraph('I_SalesOrder');
  const assocEdge = result.edges.find(
    e => e.source === 'I_SalesOrder' && e.target === 'I_BusinessPartner'
  );
  expect(assocEdge).toBeDefined();
  expect(assocEdge.relation).toBe('association');

  const joinEdge = result.edges.find(
    e => e.source === 'I_SalesOrder' && e.target === 'I_SalesOrganization'
  );
  expect(joinEdge).toBeDefined();
  expect(joinEdge.relation).toBe('join');
});

test('buildGraph expands to depth 2 by default', () => {
  const result = buildGraph('I_SalesOrder');
  const depth2 = result.nodes.filter(n => n.depth === 2);
  expect(depth2.length).toBeGreaterThan(0);
  // I_Material は I_SalesOrderItem の association → depth=2
  const material = result.nodes.find(n => n.id === 'I_Material');
  expect(material).toBeDefined();
  expect(material.depth).toBe(2);
});

test('buildGraph maxDepth=1 does not include depth-2 nodes', () => {
  const result = buildGraph('I_SalesOrder', 1);
  const depth2 = result.nodes.filter(n => n.depth === 2);
  expect(depth2.length).toBe(0);
});

test('buildGraph deduplicates nodes (same node reachable via multiple paths)', () => {
  // I_Material は I_SalesOrderItem からも I_PurchaseOrderItem からも到達可能
  // ただし I_PurchaseOrder から始めたときのみ確認
  const result = buildGraph('I_PurchaseOrder');
  const materials = result.nodes.filter(n => n.id === 'I_Material');
  expect(materials.length).toBe(1);
});

test('buildGraph includes non-cleanCore node (VBAK) from C_SalesOrderTP', () => {
  const result = buildGraph('C_SalesOrderTP');
  const vbak = result.nodes.find(n => n.id === 'VBAK');
  expect(vbak).toBeDefined();
  expect(vbak.cleanCore).toBe(false);
});
```

- [ ] **Step 2: 运行确认测试失败**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest src/cds-graph-data.test.js --no-coverage 2>&1 | tail -5
```

预期：`FAIL` — `Cannot find module './cds-graph-data'`

- [ ] **Step 3: 创建 `src/cds-graph-data.js`**

```javascript
'use strict';

const MOCK_DATA = {
  'I_SalesOrder': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_SalesOrderItem',         relation: 'association' },
      { target: 'I_BusinessPartner',         relation: 'association' },
      { target: 'I_SalesOrganization',       relation: 'join' },
    ]
  },
  'I_SalesOrderItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_Material',                relation: 'association' },
      { target: 'I_SalesOrderScheduleLine',  relation: 'association' },
    ]
  },
  'I_BusinessPartner': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_BusinessPartnerAddress',  relation: 'association' },
    ]
  },
  'I_SalesOrganization': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_Material': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_MaterialText',            relation: 'association' },
    ]
  },
  'I_SalesOrderScheduleLine': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_BusinessPartnerAddress': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C2',
    associations: []
  },
  'I_MaterialText': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'C_SalesOrderTP': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_SalesOrder',             relation: 'association' },
      { target: 'VBAK',                     relation: 'join' },
    ]
  },
  'VBAK': {
    type: 'Database Table', releaseState: 'Internal', cleanCore: false, classification: 'Not Classified',
    associations: []
  },
  'I_PurchaseOrder': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_PurchaseOrderItem',       relation: 'association' },
      { target: 'I_Supplier',               relation: 'association' },
    ]
  },
  'I_PurchaseOrderItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_Material',               relation: 'association' },
    ]
  },
  'I_Supplier': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_JournalEntry': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_JournalEntryItem',       relation: 'association' },
      { target: 'I_CompanyCode',            relation: 'join' },
    ]
  },
  'I_JournalEntryItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_GLAccount',              relation: 'association' },
    ]
  },
  'I_CompanyCode': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_GLAccount': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
};

/**
 * BFS 递归展开 CDS View 关系图
 * @param {string} viewName - 根节点名称
 * @param {number} maxDepth - 最大展开层数（默认 2）
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
function buildGraph(viewName, maxDepth = 2) {
  if (!MOCK_DATA[viewName]) return null;

  const nodes = new Map(); // id → node（保证唯一，取最小 depth）
  const edges = [];
  const queue = [{ id: viewName, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift();

    // 节点去重：已存在且 depth 更小则跳过
    if (nodes.has(id) && nodes.get(id).depth <= depth) continue;

    const data = MOCK_DATA[id];
    nodes.set(id, {
      id,
      type:           data ? data.type           : 'Unknown',
      releaseState:   data ? data.releaseState    : 'Unknown',
      cleanCore:      data ? data.cleanCore       : null,
      classification: data ? data.classification  : 'Not Classified',
      depth,
    });

    if (!data || depth >= maxDepth) continue;

    for (const assoc of data.associations) {
      edges.push({ source: id, target: assoc.target, relation: assoc.relation });
      queue.push({ id: assoc.target, depth: depth + 1 });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
}

module.exports = { buildGraph };
```

- [ ] **Step 4: 运行测试确认全部通过**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest src/cds-graph-data.test.js --no-coverage 2>&1 | tail -10
```

预期：`Tests: 8 passed`

- [ ] **Step 5: Commit**

```bash
git add src/cds-graph-data.js src/cds-graph-data.test.js
git commit -m "feat: add cds-graph-data with BFS graph builder and mock data"
```

---

### Task 2: 后端 CDS action + handler + 集成测试

**Files:**
- Modify: `srv/knowledge-service.cds`
- Modify: `srv/knowledge-service.js`
- Modify: `srv/knowledge-service.test.js`

- [ ] **Step 1: 在 `srv/knowledge-service.cds` 末尾（`}` 之前）追加 action**

找到文件末尾的 `}` 闭合符，在其之前插入：

```cds
  action analyzeCds(viewName : String) returns {
    nodes : array of {
      id             : String;
      type           : String;
      releaseState   : String;
      cleanCore      : Boolean;
      classification : String;
      depth          : Integer;
    };
    edges : array of {
      source   : String;
      target   : String;
      relation : String;
    };
  };
```

完整末尾应如下（从 `searchApiHub` action 之后）：

```cds
  action searchApiHub(
    query  : String,
    module : String
  ) returns array of {
    name        : String;
    displayName : String;
    apiType     : String;
    description : String;
  };

  action analyzeCds(viewName : String) returns {
    nodes : array of {
      id             : String;
      type           : String;
      releaseState   : String;
      cleanCore      : Boolean;
      classification : String;
      depth          : Integer;
    };
    edges : array of {
      source   : String;
      target   : String;
      relation : String;
    };
  };
}
```

- [ ] **Step 2: 在 `srv/knowledge-service.js` 中添加 require**

找到文件顶部（第 7 行附近）现有的 require 列表，在 `require('../src/apihub-client')` 这行之后添加：

```javascript
const { buildGraph } = require('../src/cds-graph-data');
```

- [ ] **Step 3: 在 `srv/knowledge-service.js` 末尾 `searchApiHub` handler 的闭合 `});` 之后、模块最后的 `});` 之前添加 handler**

```javascript
  // ── Tab 5: CDS 关系图谱 ──────────────────────────────────────────────────
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

- [ ] **Step 4: 在 `srv/knowledge-service.test.js` 末尾添加集成测试**

在文件末尾（现有所有 describe 块之后）添加：

```javascript
// ── analyzeCds ─────────────────────────────────────────────────────────────

jest.mock('../src/cds-graph-data', () => ({
  buildGraph: jest.fn((viewName) => {
    if (viewName === 'I_SalesOrder') {
      return {
        nodes: [
          { id: 'I_SalesOrder', type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1', depth: 0 },
          { id: 'I_SalesOrderItem', type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1', depth: 1 },
        ],
        edges: [
          { source: 'I_SalesOrder', target: 'I_SalesOrderItem', relation: 'association' },
        ],
      };
    }
    return null;
  }),
}));

describe('analyzeCds', () => {
  test('returns graph data for known view', async () => {
    const response = await fetch(
      'http://localhost:4004/odata/v4/knowledge/analyzeCds',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewName: 'I_SalesOrder' }),
      }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(body.nodes[0].id).toBe('I_SalesOrder');
  });

  test('returns 404 for unknown view', async () => {
    const response = await fetch(
      'http://localhost:4004/odata/v4/knowledge/analyzeCds',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewName: 'UNKNOWN_VIEW' }),
      }
    );
    expect(response.status).toBe(404);
  });

  test('returns 400 for empty viewName', async () => {
    const response = await fetch(
      'http://localhost:4004/odata/v4/knowledge/analyzeCds',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewName: '' }),
      }
    );
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 5: 运行全部测试确认通过**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest --no-coverage 2>&1 | tail -10
```

预期：所有测试通过（含新增 3 个 analyzeCds 测试）

- [ ] **Step 6: Commit**

```bash
git add srv/knowledge-service.cds srv/knowledge-service.js srv/knowledge-service.test.js
git commit -m "feat: add analyzeCds CAP action and handler"
```

---

### Task 3: 前端——新增 `graph` Tab（onInit + onAfterRendering）

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

#### 背景：现有代码结构

- 第 52 行：`this._TAB_KEYS = ['concept', 'codeanalysis', 'search', 'apihub'];`
- 第 58 行：`var TAB_CONFIG = { concept: ..., codeanalysis: ..., search: ..., apihub: ... };`
- 第 93 行附近：API Hub 控件初始化（`this._apiHubInput`、`this._apiHubSearchBtn`）
- 第 212 行附近：`ccApiHubResult` div 插入 scrollDiv
- 第 272 行附近：`ccApiHubInputArea` div 插入 wrap

- [ ] **Step 1: 更新 `_TAB_KEYS` 和 `_messages`（第 52 行附近）**

将：
```javascript
      this._TAB_KEYS = ['concept', 'codeanalysis', 'search', 'apihub'];
      this._currentTab = 'concept';
      this._codeSubMode = 'code'; // 'code' | 'atc'
      this._chatHistories = {};
      this._messages = { concept: [], codeanalysis: [], search: [], apihub: [] };
```
改为：
```javascript
      this._TAB_KEYS = ['concept', 'codeanalysis', 'search', 'apihub', 'graph'];
      this._currentTab = 'concept';
      this._codeSubMode = 'code'; // 'code' | 'atc'
      this._chatHistories = {};
      this._messages = { concept: [], codeanalysis: [], search: [], apihub: [], graph: [] };
```

- [ ] **Step 2: 更新 `TAB_CONFIG`（第 58 行附近）**

将：
```javascript
        apihub:       { icon: 'sap-icon://product',       text: 'API Hub',    placeholder: '',                                                              welcome: '' }
```
改为：
```javascript
        apihub:       { icon: 'sap-icon://product',       text: 'API Hub',    placeholder: '',                                                              welcome: '' },
        graph:        { icon: 'sap-icon://org-chart',     text: '关系图谱',    placeholder: '',                                                              welcome: '' }
```

- [ ] **Step 3: 在 `onInit` 中初始化 graph 专用控件**

找到 API Hub 控件初始化代码（含 `this._apiHubInput`、`this._apiHubSearchBtn` 的那段），在其**之后**插入：

```javascript
      // Tab 5（关系图谱）专用控件
      this._graphInput = new TextArea({
        placeholder: '输入 CDS View 名称，例如 I_SalesOrder...',
        rows: 1,
        growing: false,
        width: '100%'
      });
      this._graphAnalyzeBtn = new Button({
        text: '分析',
        type: 'Emphasized',
        press: [this.onAnalyzeCds, this]
      });
```

- [ ] **Step 4: 在 `onAfterRendering` 中添加 `ccGraphCanvas` div 到 scrollDiv**

找到：
```javascript
          // API Hub 结果容器
          var apiHubResultDiv = document.createElement('div');
          apiHubResultDiv.id = 'ccApiHubResult';
          apiHubResultDiv.style.cssText = 'display:none;padding:8px 16px;';
          scrollDiv.appendChild(apiHubResultDiv);
```
在其**之后**插入：

```javascript
          // 关系图谱画布容器
          var graphCanvasDiv = document.createElement('div');
          graphCanvasDiv.id = 'ccGraphCanvas';
          graphCanvasDiv.style.cssText = 'display:none;flex:1;background:#1a1a2e;min-height:600px;position:relative;';
          scrollDiv.appendChild(graphCanvasDiv);
```

- [ ] **Step 5: 在 `onAfterRendering` 中添加 `ccGraphInputArea` div 到 wrap**

找到：
```javascript
          // ── API Hub 输入区 ───────────────────────────────────────────
          var apiHubInputDiv = document.createElement('div');
          apiHubInputDiv.id = 'ccApiHubInputArea';
```
在整个 API Hub 输入区代码块**之后**（即模块按钮组和 Enter 键 delegate 之后）插入：

```javascript
          // ── 关系图谱输入区 ────────────────────────────────────────────
          var graphInputDiv = document.createElement('div');
          graphInputDiv.id = 'ccGraphInputArea';
          graphInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(graphInputDiv);

          var graphRow = document.createElement('div');
          graphRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;margin-bottom:4px;';
          graphInputDiv.appendChild(graphRow);

          var graphTextWrap = document.createElement('div');
          graphTextWrap.style.cssText = 'flex:1;min-width:0;';
          graphRow.appendChild(graphTextWrap);

          var graphBtnWrap = document.createElement('div');
          graphBtnWrap.style.cssText = 'flex-shrink:0;';
          graphRow.appendChild(graphBtnWrap);

          that._graphInput.placeAt(graphTextWrap);
          that._graphAnalyzeBtn.placeAt(graphBtnWrap);

          var graphHint = document.createElement('p');
          graphHint.style.cssText = 'font-size:11px;color:#999;margin:2px 0 0;';
          graphHint.textContent = '示例：I_SalesOrder · I_PurchaseOrder · I_JournalEntry · C_SalesOrderTP';
          graphInputDiv.appendChild(graphHint);

          // Enter 键触发分析
          that._graphInput.addEventDelegate({
            onkeydown: function (oEvent) {
              if (oEvent.key === 'Enter' && !oEvent.shiftKey) {
                oEvent.preventDefault();
                that.onAnalyzeCds();
              }
            }
          });
```

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: init graph tab controls and DOM structure"
```

---

### Task 4: 前端——Tab 切换逻辑 + `onAnalyzeCds` + `_doAnalyzeCds`

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 更新 `onTabSelect` 处理 `graph` Tab**

找到（第 520 行附近）：
```javascript
      var inputArea       = document.getElementById('ccInputArea');
      var searchInputArea = document.getElementById('ccSearchInputArea');
      var searchResult    = document.getElementById('ccSearchResult');
      var apiHubInputArea = document.getElementById('ccApiHubInputArea');
      var apiHubResult    = document.getElementById('ccApiHubResult');

      if (key === 'search') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'block';
        if (searchResult)    searchResult.style.display    = 'block';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
      } else if (key === 'apihub') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'block';
        if (apiHubResult)    apiHubResult.style.display    = 'block';
      } else {
        if (inputArea)       inputArea.style.display       = 'block';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
        if (key === 'codeanalysis') {
          this._chatInput.setPlaceholder(this._CODE_SUB_CONFIG[this._codeSubMode].placeholder);
        } else {
          this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
        }
      }
```

替换为：
```javascript
      var inputArea       = document.getElementById('ccInputArea');
      var searchInputArea = document.getElementById('ccSearchInputArea');
      var searchResult    = document.getElementById('ccSearchResult');
      var apiHubInputArea = document.getElementById('ccApiHubInputArea');
      var apiHubResult    = document.getElementById('ccApiHubResult');
      var graphInputArea  = document.getElementById('ccGraphInputArea');
      var graphCanvas     = document.getElementById('ccGraphCanvas');

      if (key === 'search') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'block';
        if (searchResult)    searchResult.style.display    = 'block';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
        if (graphInputArea)  graphInputArea.style.display  = 'none';
        if (graphCanvas)     graphCanvas.style.display     = 'none';
      } else if (key === 'apihub') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'block';
        if (apiHubResult)    apiHubResult.style.display    = 'block';
        if (graphInputArea)  graphInputArea.style.display  = 'none';
        if (graphCanvas)     graphCanvas.style.display     = 'none';
      } else if (key === 'graph') {
        if (inputArea)       inputArea.style.display       = 'none';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
        if (graphInputArea)  graphInputArea.style.display  = 'block';
        if (graphCanvas)     graphCanvas.style.display     = 'block';
      } else {
        if (inputArea)       inputArea.style.display       = 'block';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult)    searchResult.style.display    = 'none';
        if (apiHubInputArea) apiHubInputArea.style.display = 'none';
        if (apiHubResult)    apiHubResult.style.display    = 'none';
        if (graphInputArea)  graphInputArea.style.display  = 'none';
        if (graphCanvas)     graphCanvas.style.display     = 'none';
        if (key === 'codeanalysis') {
          this._chatInput.setPlaceholder(this._CODE_SUB_CONFIG[this._codeSubMode].placeholder);
        } else {
          this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
        }
      }
```

- [ ] **Step 2: 在 `onSearchApiHub` 方法之前插入 `onAnalyzeCds` 和 `_doAnalyzeCds` 方法**

找到：
```javascript
    // ── API Hub 搜索 ─────────────────────────────────────────────────────────
    onSearchApiHub: function () {
```

在其**之前**插入：

```javascript
    // ── CDS 关系图谱 ──────────────────────────────────────────────────────────
    onAnalyzeCds: function () {
      var viewName = this._graphInput.getValue().trim();
      if (!viewName) return;
      this._doAnalyzeCds(viewName);
    },

    _doAnalyzeCds: function (viewName) {
      var model = this.getView().getModel();
      if (model.getProperty('/busy')) return;

      model.setProperty('/busy', true);
      this._graphAnalyzeBtn.setEnabled(false);
      this._busyIndicator.setVisible(true);

      var that = this;
      fetch('/odata/v4/knowledge/analyzeCds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewName: viewName }),
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (e) { throw new Error(e.error && e.error.message || 'error'); });
          return res.json();
        })
        .then(function (data) {
          model.setProperty('/busy', false);
          that._graphAnalyzeBtn.setEnabled(true);
          that._busyIndicator.setVisible(false);
          that._loadD3(function () { that._renderGraph(data); });
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          that._graphAnalyzeBtn.setEnabled(true);
          that._busyIndicator.setVisible(false);
          var canvas = document.getElementById('ccGraphCanvas');
          if (canvas) {
            canvas.innerHTML = '<p style="color:#e53935;padding:24px;font-size:13px;">' +
              (err.message || '请求失败，请重试。') +
              '<br><span style="color:#888;font-size:12px;">可用示例：I_SalesOrder · I_PurchaseOrder · I_JournalEntry · C_SalesOrderTP</span></p>';
          }
        });
    },

    _loadD3: function (callback) {
      if (window.d3) { callback(); return; }
      var script = document.createElement('script');
      script.src = 'https://d3js.org/d3.v7.min.js';
      script.onload = callback;
      document.head.appendChild(script);
    },

```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: add graph tab switch logic and analyzeCds request methods"
```

---

### Task 5: 前端——D3.js 力导向图渲染 `_renderGraph`

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 在 `_loadD3` 方法之后插入 `_renderGraph` 方法**

找到：
```javascript
    _loadD3: function (callback) {
      if (window.d3) { callback(); return; }
      var script = document.createElement('script');
      script.src = 'https://d3js.org/d3.v7.min.js';
      script.onload = callback;
      document.head.appendChild(script);
    },
```

在其**之后**插入：

```javascript
    _renderGraph: function (graphData) {
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

      var g = svg.append('g');

      // ── SVG filter: 发光效果（仅合规节点使用）────────────────────────
      var defs = svg.append('defs');
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

      // ── 力导向仿真 ────────────────────────────────────────────────────
      var simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(function (d) { return d.id; }).distance(120))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2));

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
        .style('cursor', 'pointer')
        .call(d3.drag()
          .on('start', function (event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', function (event, d) {
            d.fx = event.x; d.fy = event.y;
          })
          .on('end', function (event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
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

      // ── 节点标签 ──────────────────────────────────────────────────────
      var label = g.append('g')
        .selectAll('text')
        .data(nodes)
        .join('text')
        .attr('fill', '#fff')
        .attr('font-size', function (d) { return d.depth === 0 ? '13px' : '11px'; })
        .attr('text-anchor', 'middle')
        .attr('dy', function (d) { return nodeRadius(d) + 14; })
        .style('pointer-events', 'none')
        .text(function (d) { return d.id; });

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
      });
    },

```

- [ ] **Step 2: 运行全部测试确认无回归**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest --no-coverage 2>&1 | tail -10
```

预期：所有测试通过。

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: add D3.js force-directed graph renderer for CDS graph tab"
```

---

### Task 6: 手动验证全流程

- [ ] **Step 1: 启动开发服务器**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm run dev
```

- [ ] **Step 2: 验证 Tab 结构**

打开浏览器，确认共 5 个 Tab：`概念 & 分级` / `代码分析` / `SAP 搜索` / `API Hub` / `关系图谱`

- [ ] **Step 3: 验证 I_SalesOrder 图谱**

点击"关系图谱" Tab，输入 `I_SalesOrder`，点击"分析"：
- 深色背景画布出现
- 力导向图渲染，节点可见（蓝色发光节点）
- 根节点 `I_SalesOrder` 最大，depth-1 节点中等，depth-2 最小
- association 连线为蓝色虚线，join 连线为白色实线

- [ ] **Step 4: 验证悬停卡片**

鼠标悬停在任意节点上，确认弹出详情卡片，显示：名称、类型、Release、Clean Core、分级。

- [ ] **Step 5: 验证 VBAK 节点（不合规）**

输入 `C_SalesOrderTP`，确认 `VBAK` 节点为红色（cleanCore=false）。

- [ ] **Step 6: 验证拖拽和缩放**

拖动节点，滚轮缩放，确认正常。

- [ ] **Step 7: 验证未知 View 错误提示**

输入 `UNKNOWN_VIEW`，确认画布显示错误信息和示例列表。

- [ ] **Step 8: 验证 Tab 切换**

从"关系图谱"切换到其他 Tab，确认输入区和画布正确隐藏；切回后正确显示。

- [ ] **Step 9: 运行全部测试**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

预期：所有测试通过。

- [ ] **Step 10: 最终 commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: complete CDS graph tab with D3.js force-directed visualization"
```
