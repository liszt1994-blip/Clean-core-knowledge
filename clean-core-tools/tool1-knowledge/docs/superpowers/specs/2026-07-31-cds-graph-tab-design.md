# CDS 关系图谱 Tab 设计文档

**日期：** 2026-07-31
**状态：** 已确认，待实现

---

## 概述

新增一个"关系图谱" Tab，用户输入 CDS View 名称后，展示该 View 与其关联对象（通过 association / join 连接）的力导向关系图谱。每个节点显示对象的 Release 状态、Clean Core 合规性、分级等信息（悬停显示详情卡片）。现阶段使用模拟数据，后期接入真实 SAP 系统 Agent 替换。

---

## 变更范围

| 操作 | 文件 |
|------|------|
| 新增 | `src/cds-graph-data.js` |
| 修改 | `srv/knowledge-service.cds` |
| 修改 | `srv/knowledge-service.js` |
| 修改 | `app/knowledge/webapp/controller/App.controller.js` |

---

## 数据流

```
用户输入 CDS View 名称
  → 前端 POST /odata/v4/knowledge/analyzeCds
    → knowledge-service.js handler
      → src/cds-graph-data.js（查询模拟数据，递归展开最多 2 层）
        ← 返回 { nodes: [...], edges: [...] }
      ← 返回结构化图谱数据
    ← JSON 响应
  → 前端用 D3.js 力导向图渲染
```

---

## 后端设计

### `src/cds-graph-data.js`

封装模拟数据和图谱构建逻辑，导出一个函数：

```javascript
// 根据 CDS View 名称递归展开关系图（最多 maxDepth 层）
function buildGraph(viewName, maxDepth = 2)
// 返回：{ nodes: Node[], edges: Edge[] } 或 null（未找到）
```

**节点数据结构：**
```javascript
{
  id:           String,   // CDS View 技术名，例如 'I_SalesOrder'
  type:         String,   // 'CDS View' | 'CDS Table Function' | 'Basic View'
  releaseState: String,   // 'Released' | 'Deprecated' | 'Internal'
  cleanCore:    Boolean,  // 是否符合 Clean Core
  classification: String, // 'C1' | 'C2' | 'C3' | 'Not Classified'
  depth:        Number,   // 0=根节点, 1=直接关联, 2=二级关联
}
```

**边数据结构：**
```javascript
{
  source:   String,  // 源节点 id
  target:   String,  // 目标节点 id
  relation: String,  // 'association' | 'join'
}
```

**模拟数据覆盖范围（至少 15 个节点）：**

以 `I_SalesOrder` 为根，覆盖典型 S/4HANA Sales 领域 CDS View 关系：

```javascript
const MOCK_DATA = {
  'I_SalesOrder': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_SalesOrderItem',    relation: 'association' },
      { target: 'I_BusinessPartner',   relation: 'association' },
      { target: 'I_SalesOrganization', relation: 'join' },
    ]
  },
  'I_SalesOrderItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_Material',          relation: 'association' },
      { target: 'I_SalesOrderScheduleLine', relation: 'association' },
    ]
  },
  'I_BusinessPartner': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_BusinessPartnerAddress', relation: 'association' },
    ]
  },
  'I_SalesOrganization': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_Material': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_MaterialText',      relation: 'association' },
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
      { target: 'I_SalesOrder',        relation: 'association' },
      { target: 'VBAK',                relation: 'join' },
    ]
  },
  'VBAK': {
    type: 'Database Table', releaseState: 'Internal', cleanCore: false, classification: 'Not Classified',
    associations: []
  },
  'I_PurchaseOrder': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_PurchaseOrderItem', relation: 'association' },
      { target: 'I_Supplier',          relation: 'association' },
    ]
  },
  'I_PurchaseOrderItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_Material',          relation: 'association' },
    ]
  },
  'I_Supplier': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: []
  },
  'I_JournalEntry': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_JournalEntryItem',  relation: 'association' },
      { target: 'I_CompanyCode',       relation: 'join' },
    ]
  },
  'I_JournalEntryItem': {
    type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1',
    associations: [
      { target: 'I_GLAccount',         relation: 'association' },
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
```

**`buildGraph` 递归逻辑：**
1. 查找根节点，若不存在返回 `null`
2. BFS 展开，每层记录 `depth`，最多展开 `maxDepth` 层
3. 去重：同一节点只出现一次（取最小 depth）
4. 返回 `{ nodes, edges }`

---

### `srv/knowledge-service.cds` 新增 action

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

---

### `srv/knowledge-service.js` 新增 handler

```javascript
const { buildGraph } = require('../src/cds-graph-data');

srv.on('analyzeCds', async (req) => {
  const { viewName } = req.data;
  if (!viewName?.trim()) return req.error(400, '请输入 CDS View 名称');
  const graph = buildGraph(viewName.trim());
  if (!graph) return req.error(404, `未找到 CDS View "${viewName}"，请检查名称或使用模拟数据中的示例。`);
  return graph;
});
```

---

## 前端设计

### Tab 配置

`_TAB_KEYS` 扩展为：
```javascript
['concept', 'codeanalysis', 'search', 'apihub', 'graph']
```

`TAB_CONFIG` 新增：
```javascript
graph: { icon: 'sap-icon://org-chart', text: '关系图谱', placeholder: '', welcome: '' }
```

### DOM 结构

```
ccGraphInputArea（输入区 div，在 wrap 中，display:none）
  ├── 输入行：_graphInput（TextArea）+ _graphAnalyzeBtn（Button "分析"）
  └── 提示文字（灰色小字："例如：I_SalesOrder、I_PurchaseOrder、I_JournalEntry"）

ccGraphCanvas（图谱区 div，在 scrollDiv 中，display:none）
  └── <svg id="ccGraphSvg">（D3.js 渲染目标，width:100%, height:600px）
```

### 新增方法

```javascript
onAnalyzeCds()               // 触发分析
_doAnalyzeCds(viewName)      // 发送请求、处理响应
_renderGraph(graphData)      // D3.js 渲染力导向图
_loadD3(callback)            // 懒加载 D3.js CDN，加载完成后执行 callback
```

### D3.js 渲染规格

**力导向图参数：**
- `d3.forceSimulation` + `forceLink` + `forceManyBody` + `forceCenter`
- linkDistance: 120，charge strength: -300

**节点样式：**

| 条件 | 颜色 | 半径 |
|------|------|------|
| cleanCore=true | `#0a6ed1`（蓝，发光） | depth=0: 28, depth=1: 18, depth=2: 12 |
| cleanCore=false | `#e53935`（红） | 同上 |
| 未知 | `#666`（灰） | 同上 |

发光效果通过 SVG `<filter>` feGaussianBlur 实现（仅合规节点）。

节点下方显示 `id` 文字标签（白色，12px）。

**连线样式：**
- association：蓝色 `#42a5f5`，strokeDasharray: `"5,3"`（虚线），opacity: 0.7
- join：白色 `rgba(255,255,255,0.5)`，实线，opacity: 0.5

**悬停卡片：**
- 绝对定位 `div#ccGraphTooltip`，黑色半透明背景
- 显示：名称、类型、Release 状态、Clean Core（✅/❌）、分级
- mouseover 显示，mouseout 隐藏

**交互：**
- 节点可拖拽（dragstarted / dragged / dragended）
- SVG 整体支持滚轮缩放 + 平移（`d3.zoom()`）

**背景色：** `ccGraphCanvas` div 背景设为 `#1a1a2e`

### D3.js 懒加载

首次点击"分析"按钮时，检查 `window.d3` 是否存在：
- 不存在：动态创建 `<script src="https://d3js.org/d3.v7.min.js">`，加载完成后执行渲染
- 已存在：直接渲染

### Tab 切换逻辑

切换到 `graph` Tab 时：
- 隐藏：`ccInputArea`、`ccSearchInputArea`、`ccApiHubInputArea`
- 显示：`ccGraphInputArea`、`ccGraphCanvas`

切换离开时：
- 隐藏：`ccGraphInputArea`、`ccGraphCanvas`

---

## 错误处理

| 场景 | 前端展示 |
|------|---------|
| 输入为空 | 按钮 disabled |
| CDS View 不在模拟数据中 | SVG 区域显示提示文字，列出可用示例 |
| 网络错误 | SVG 区域显示"请求失败，请重试" |

---

## 测试要点

1. 输入 `I_SalesOrder` 返回完整 2 层图谱（8 个以上节点）
2. 输入 `I_PurchaseOrder` 返回正确关系
3. 输入不存在的名称返回 404 友好提示
4. 节点拖拽、缩放正常
5. 悬停卡片显示正确信息
6. 切换 Tab 时输入区正确显示/隐藏
7. D3.js 懒加载：首次进入 graph Tab 才加载 D3 脚本
