# API Hub 搜索 Tab 设计文档

**日期：** 2026-07-31  
**状态：** 已确认，待实现

---

## 概述

新增一个"API Hub"Tab，允许用户通过关键词搜索或按 SAP 模块浏览 SAP S/4HANA PCE 官方 API 列表。数据来源为 SAP API Hub 的 OData REST 接口（`api.sap.com`），通过后端 action 代理调用，API Key 存放于 `.env` 文件。

---

## 变更范围

| 操作 | 文件 |
|------|------|
| 新增 | `src/apihub-client.js` |
| 修改 | `srv/knowledge-service.cds` |
| 修改 | `srv/knowledge-service.js` |
| 修改 | `app/knowledge/webapp/controller/App.controller.js` |
| 确认 | `.env`（添加 `API_HUB_KEY`） |
| 确认 | `.gitignore`（确保 `.env` 已被忽略） |

后端 `prompts.js`、CDS 实体定义、现有 action 均不需要改动。

---

## 数据流

```
用户输入关键词 / 点击模块按钮
  → 前端 fetch POST /odata/v4/knowledge/searchApiHub
    → knowledge-service.js handler
      → src/apihub-client.js
        → api.sap.com OData REST（Header: APIKey: <API_HUB_KEY>）
          GET /odata/1.0/catalog.svc/ContentPackages('S4HANAOPAPI')/Artifacts
          ?$format=json&$top=50&$skip=N&$select=Name,DisplayName,Type,SubType,Description
        ← 返回过滤后的结果数组
      ← 返回结构化结果
    ← JSON 响应
  → 前端渲染卡片列表，点击展开 inline 详情
```

---

## 后端设计

### `src/apihub-client.js`

封装所有对 SAP API Hub 的 HTTP 调用，导出三个函数：

```javascript
// 按关键词搜索（翻页，最多 10 页 × 50 条）
async function searchApis(query, limit = 20)

// 按模块关键词列出（使用 MODULE_KEYWORDS 映射）
async function listByModule(module, limit = 30)

// 获取单个 API 详情（精确匹配优先，退回模糊第一条）
async function getDetails(apiName)
```

**模块关键词映射（复用 MCP Python 实现）：**
```javascript
const MODULE_KEYWORDS = {
  FI: ['Journal','Ledger','Account','Payment','Invoice','Tax','Asset','Budget',
       'Cost','Profit','Revenue','Posting','Finance','Fiscal','Bank','Cash',
       'Receivable','Payable','Controlling','GL','Billing'],
  MM: ['Material','Purchase','Procurement','Inventory','Goods','Stock',
       'Vendor','Supplier','Batch','BOM','Bill of Material','Warehouse','Product','Storage'],
  SD: ['Sales','Order','Customer','Delivery','Shipment','Pricing','Contract',
       'Quotation','Billing','Distribution'],
  PP: ['Production','Manufacturing','Work Center','Routing','BOM','Capacity',
       'Planning','MRP','Shop Floor'],
  HR: ['Employee','Personnel','Payroll','Attendance','Leave','Org','Position',
       'Recruitment','Training'],
  PM: ['Maintenance','Equipment','Functional Location','Notification','Work Order','Plant'],
};
```

**返回数据结构（每条记录）：**
```javascript
{
  name:        String,  // 技术名（artifacts Name 字段）
  displayName: String,  // 显示名（DisplayName 字段）
  apiType:     String,  // 类型（SubType || Type，例如 'OData'、'REST'）
  description: String,  // 描述（Description 字段，可为空字符串）
}
```

**API Key：** 通过 `process.env.API_HUB_KEY` 读取，未设置时抛出明确错误信息。

---

### `srv/knowledge-service.cds` 新增 action

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
```

- `query`：关键词搜索，传空字符串表示不使用
- `module`：模块代码（FI/MM/SD/PP/HR/PM），传空字符串表示不使用
- `query` 和 `module` 不能同时为空，handler 中校验，否则返回 `req.error(400, ...)`
- 若 `module` 非空则优先使用 `listByModule`，否则使用 `searchApis`

---

### `srv/knowledge-service.js` 新增 handler

```javascript
const { searchApis, listByModule } = require('../src/apihub-client');

srv.on('searchApiHub', async (req) => {
  const { query, module } = req.data;
  if (!query?.trim() && !module?.trim()) {
    return req.error(400, 'query 或 module 至少填写一个');
  }
  if (module?.trim()) {
    return await listByModule(module.trim().toUpperCase());
  }
  return await searchApis(query.trim());
});
```

---

## 前端设计

### Tab 配置变更

`_TAB_KEYS` 从 `['concept', 'codeanalysis', 'search']` 扩展为：
```javascript
this._TAB_KEYS = ['concept', 'codeanalysis', 'search', 'apihub'];
```

`TAB_CONFIG` 新增：
```javascript
apihub: {
  icon: 'sap-icon://api',
  text: 'API Hub',
  placeholder: '',   // 不使用 _chatInput
  welcome: ''        // 不使用 _addWelcomeMessage
}
```

### `apihub` Tab DOM 结构

```
ccChat_apihub（外层容器 div）
  ├── ccApiHubSearch（搜索区 div）
  │     ├── _apiHubInput（TextArea，placeholder: 输入 API 关键词...）
  │     ├── _apiHubSearchBtn（Button，"搜索"）
  │     └── ccApiHubModules（模块按钮组 div）
  │           └── [FI] [MM] [SD] [PP] [HR] [PM]（6个 Button）
  └── ccApiHubResult（结果区 div）
        └── _apiHubList（List，按需 placeAt 挂载）
```

### 新增方法

```javascript
// 触发搜索（关键词模式）
onSearchApiHub: function ()

// 触发模块浏览
onApiHubModuleSelect: function (module)

// 渲染结果列表（List + CustomListItem，支持 inline 展开）
_renderApiHubResults: function (results)
```

### 结果列表交互

- 每条 `CustomListItem` 显示：`[apiType]` 标签 + `displayName`
- 点击任意一条 → 展开该条详情区域（`name`、`apiType`、`description`）
- 再次点击 → 收起
- 同一时间只有一条展开（展开新条时收起上一条）

### 输入栏隐藏逻辑

切换到 `apihub` Tab 时，隐藏底部 `_chatInput` 区域（与现有 `search` Tab 的处理方式一致）。

---

## 错误处理

| 场景 | 前端展示 |
|------|---------|
| API Key 未设置 | `"配置错误：API_HUB_KEY 未设置，请联系管理员。"` |
| 网络超时 / HTTP 错误 | `"API Hub 请求失败，请稍后重试。"` |
| 搜索结果为空 | `"未找到相关 API，请换个关键词或选择模块浏览。"` |
| query 和 module 均为空 | 前端禁用搜索按钮（输入框为空时 disabled） |

---

## 测试要点

1. 关键词搜索返回正确结果列表
2. 按模块浏览（如 FI）返回财务相关 API
3. 点击结果条目正确展开/收起详情
4. API Key 未配置时显示友好错误信息
5. 切换到 `apihub` Tab 时底部输入栏正确隐藏
6. 切换回其他 Tab 时底部输入栏正确恢复
