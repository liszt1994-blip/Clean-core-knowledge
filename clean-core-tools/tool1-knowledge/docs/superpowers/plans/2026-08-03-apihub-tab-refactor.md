# API Hub Tab 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 API Hub Tab 的数据来源从 `Artifacts` 接口改为 `APIContent.APIs` 接口，并发获取每条结果的 Service Group Name，列表首行显示 `API_BANK` 格式的 Service Group Name。

**Architecture:** 后端 `apihub-client.js` 改用 `APIContent.APIs` 接口获取列表，再并发调用每条的 `/$value` 提取 Service Group Name；`knowledge-service.cds` 更新返回字段；前端 `App.controller.js` 更新渲染逻辑，第一行显示 `[apiType] serviceGroupName`，第二行显示 `title`。

**Tech Stack:** Node.js, node-fetch v2, SAP UI5 (sap.m.List / VBox / HBox / Text), CDS (CAP)

---

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/apihub-client.js` | 修改：改接口、新增 `_getServiceGroupName`、更新返回结构 |
| `src/apihub-client.test.js` | 修改：更新所有测试用例匹配新字段 |
| `srv/knowledge-service.cds` | 修改：更新 `searchApiHub` 返回字段 |
| `srv/knowledge-service.js` | 修改：更新 import（`searchApis`, `listByModule` 签名不变，无需改） |
| `app/knowledge/webapp/controller/App.controller.js` | 修改：更新 `_renderApiHubResults` 渲染逻辑 |

---

## Task 1: 重写 `apihub-client.js` 核心逻辑

**Files:**
- Modify: `src/apihub-client.js`

### 背景
当前代码使用 `ContentPackages/Artifacts` 接口，字段为 `Name/DisplayName/SubType/Description`。
新接口为 `APIContent.APIs`，字段为 `Name/Title/ShortText/ServiceCode`。
Service Group Name 需额外调用 `/$value?type=json` 解析 `x-sap-ext-overview`。

- [ ] **Step 1: 完整替换 `src/apihub-client.js` 内容**

用以下内容完整替换文件：

```javascript
// src/apihub-client.js
'use strict';

const fetch = require('node-fetch');
// node-fetch v2 required (CommonJS + timeout option support)

const BASE_URL  = 'https://api.sap.com/odata/1.0/catalog.svc';
const PAGE_SIZE = 50;

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

function _getApiKey() {
  const key = process.env.API_HUB_KEY || '';
  if (!key) throw new Error('API_HUB_KEY 环境变量未设置');
  return key;
}

// 获取单页 API 列表（APIContent.APIs 接口）
async function _fetchApisPage(skip) {
  const url = `${BASE_URL}/APIContent.APIs` +
    `?$format=json&$top=${PAGE_SIZE}&$skip=${skip}` +
    `&$select=Name,Title,ShortText,ServiceCode`;
  const resp = await fetch(url, {
    headers: { APIKey: _getApiKey() },
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`API Hub HTTP ${resp.status}`);
  const json = await resp.json();
  return (json.d && json.d.results) ? json.d.results : [];
}

// 从 /$value spec 中提取 Service Group Name，失败时返回空字符串
async function _getServiceGroupName(id) {
  try {
    const url = `${BASE_URL}/APIContent.APIs('${encodeURIComponent(id)}')/$value?type=json`;
    const resp = await fetch(url, {
      headers: { APIKey: _getApiKey() },
      timeout: 15000,
    });
    if (!resp.ok) return '';
    const spec = await resp.json();
    const overview = spec['x-sap-ext-overview'];
    if (!Array.isArray(overview)) return '';
    const entry = overview.find(e => e.name === 'Service Group Name');
    return (entry && entry.values && entry.values[0] && entry.values[0].text) || '';
  } catch (_) {
    return '';
  }
}

// 将原始 API 记录转换为内部格式（不含 serviceGroupName）
function _toRecord(r) {
  return {
    id:       r.Name      || '',
    title:    r.Title     || '',
    apiType:  r.ServiceCode || '',
    shortText: r.ShortText || '',
  };
}

// 并发为每条记录补充 serviceGroupName
async function _enrichWithServiceGroupNames(records) {
  const results = await Promise.allSettled(
    records.map(r => _getServiceGroupName(r.id))
  );
  return records.map((r, i) => ({
    ...r,
    serviceGroupName: results[i].status === 'fulfilled' ? results[i].value : '',
  }));
}

// 逐页扫描所有 API，按关键词匹配 Title 字段
async function _searchAll(keywords, maxPages = 10) {
  const matched = [];
  const lowerKws = keywords.map(k => k.toLowerCase());
  for (let page = 0; page < maxPages; page++) {
    const results = await _fetchApisPage(page * PAGE_SIZE);
    if (results.length === 0) break;
    const lastPage = results.length < PAGE_SIZE;
    for (const r of results) {
      const title = (r.Title || '').toLowerCase();
      if (lowerKws.some(k => title.includes(k))) {
        matched.push(r);
      }
    }
    if (lastPage) break;
  }
  return matched;
}

async function searchApis(query, limit = 20) {
  _getApiKey(); // validate early
  const keywords = query.trim().split(/\s+/);
  const matched = await _searchAll(keywords);
  const records = matched.slice(0, limit).map(_toRecord);
  return _enrichWithServiceGroupNames(records);
}

async function listByModule(module, limit = 30) {
  _getApiKey();
  const mod = module.trim().toUpperCase();
  const keywords = MODULE_KEYWORDS[mod];
  if (!keywords) {
    throw new Error(`不支持模块 "${mod}"。可用：${Object.keys(MODULE_KEYWORDS).join('、')}`);
  }
  const matched = await _searchAll(keywords);
  const records = matched.slice(0, limit).map(_toRecord);
  return _enrichWithServiceGroupNames(records);
}

async function getDetails(apiName) {
  _getApiKey();
  const matched = await _searchAll([apiName.trim()]);
  const exact = matched.find(r => (r.Title || '').toLowerCase() === apiName.toLowerCase());
  const target = exact || matched[0];
  if (!target) throw new Error(`未找到 API "${apiName}"`);
  const records = [_toRecord(target)];
  const enriched = await _enrichWithServiceGroupNames(records);
  return enriched[0];
}

module.exports = { searchApis, listByModule, getDetails };
```

- [ ] **Step 2: 验证文件已保存**

用编辑器或 `cat` 确认 `src/apihub-client.js` 第一行为 `// src/apihub-client.js`，并包含 `_getServiceGroupName` 函数。

---

## Task 2: 更新测试文件

**Files:**
- Modify: `src/apihub-client.test.js`

### 背景
旧测试 mock 返回的是 `DisplayName/SubType/Description` 字段，新接口返回 `Title/ServiceCode/ShortText`。
还需要新增对 `/$value` 接口的 mock（用于 `_getServiceGroupName`）。

- [ ] **Step 1: 完整替换 `src/apihub-client.test.js` 内容**

```javascript
// src/apihub-client.test.js
'use strict';

jest.mock('node-fetch');
const fetch = require('node-fetch');
const { Response } = jest.requireActual('node-fetch');

const { searchApis, listByModule, getDetails } = require('./apihub-client');

// 构造 APIContent.APIs 列表响应
function makeListResponse(items) {
  return new Response(JSON.stringify({ d: { results: items } }), { status: 200 });
}

// 构造 /$value spec 响应（含 Service Group Name）
function makeSpecResponse(serviceGroupName) {
  return new Response(JSON.stringify({
    'x-sap-ext-overview': [
      { name: 'Service Group Name', values: [{ text: serviceGroupName }] }
    ]
  }), { status: 200 });
}

beforeEach(() => {
  process.env.API_HUB_KEY = 'test-key';
  fetch.mockReset();
});

afterEach(() => {
  delete process.env.API_HUB_KEY;
});

// ── searchApis ────────────────────────────────────────────────────────────

test('searchApis returns matching results with serviceGroupName', async () => {
  // 第一次 fetch: 列表接口
  fetch.mockResolvedValueOnce(makeListResponse([
    { Name: 'OP_PURCHASEORDER_PROCESS_SRV', Title: 'Purchase Order', ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders' },
    { Name: 'OP_MATERIAL_SRV',              Title: 'Material',        ServiceCode: 'ODATAV4', ShortText: 'Material master data' },
  ]));
  // 第二次 fetch: 列表接口第二页（空，终止循环）
  fetch.mockResolvedValueOnce(makeListResponse([]));
  // 第三次 fetch: /$value for OP_PURCHASEORDER_PROCESS_SRV
  fetch.mockResolvedValueOnce(makeSpecResponse('API_PURCHASEORDER_PROCESS'));

  const results = await searchApis('Purchase', 20);
  expect(results).toHaveLength(1);
  expect(results[0]).toEqual({
    id:               'OP_PURCHASEORDER_PROCESS_SRV',
    title:            'Purchase Order',
    apiType:          'ODATAV4',
    shortText:        'Process purchase orders',
    serviceGroupName: 'API_PURCHASEORDER_PROCESS',
  });
});

test('searchApis throws when API_HUB_KEY not set', async () => {
  delete process.env.API_HUB_KEY;
  await expect(searchApis('Purchase')).rejects.toThrow('API_HUB_KEY');
});

test('searchApis returns empty array when no match', async () => {
  fetch.mockResolvedValue(makeListResponse([]));
  const results = await searchApis('zzznomatch');
  expect(results).toEqual([]);
});

test('searchApis degrades gracefully when spec fetch fails', async () => {
  fetch.mockResolvedValueOnce(makeListResponse([
    { Name: 'OP_BANK_0003', Title: 'Bank', ServiceCode: 'ODATAV4', ShortText: 'Bank master data' },
  ]));
  fetch.mockResolvedValueOnce(makeListResponse([]));
  // spec 请求失败
  fetch.mockResolvedValueOnce(new Response('error', { status: 500 }));

  const results = await searchApis('Bank', 20);
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('');
  expect(results[0].id).toBe('OP_BANK_0003');
});

// ── listByModule ───────────────────────────────────────────────────────────

test('listByModule FI returns finance-related results with serviceGroupName', async () => {
  fetch.mockResolvedValueOnce(makeListResponse([
    { Name: 'OP_JOURNALENTRY_SRV', Title: 'Journal Entry', ServiceCode: 'ODATAV4', ShortText: 'Post journal entries' },
  ]));
  fetch.mockResolvedValueOnce(makeListResponse([]));
  fetch.mockResolvedValueOnce(makeSpecResponse('API_JOURNALENTRY'));

  const results = await listByModule('FI', 30);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].title).toBe('Journal Entry');
  expect(results[0].serviceGroupName).toBe('API_JOURNALENTRY');
});

test('listByModule throws for unknown module', async () => {
  await expect(listByModule('XX')).rejects.toThrow('不支持模块');
});

// ── getDetails ─────────────────────────────────────────────────────────────

test('getDetails returns exact match first', async () => {
  fetch.mockResolvedValueOnce(makeListResponse([
    { Name: 'OP_PURCHASEORDER_PROCESS_SRV',  Title: 'Purchase Order',              ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders' },
    { Name: 'OP_PURCHASEORDER_CONFIRM_SRV',  Title: 'Purchase Order Confirmation', ServiceCode: 'ODATAV4', ShortText: 'Confirm orders' },
  ]));
  fetch.mockResolvedValueOnce(makeListResponse([]));
  fetch.mockResolvedValueOnce(makeSpecResponse('API_PURCHASEORDER_PROCESS'));

  const result = await getDetails('Purchase Order');
  expect(result.title).toBe('Purchase Order');
  expect(result.serviceGroupName).toBe('API_PURCHASEORDER_PROCESS');
});

test('getDetails throws when not found', async () => {
  fetch.mockResolvedValue(makeListResponse([]));
  await expect(getDetails('Nonexistent API')).rejects.toThrow('未找到');
});

// ── HTTP error handling ────────────────────────────────────────────────────

test('searchApis throws on HTTP 401 from list endpoint', async () => {
  fetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
  await expect(searchApis('Purchase')).rejects.toThrow('API Hub HTTP 401');
});
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest src/apihub-client.test.js --verbose
```

预期输出：所有测试 PASS，无 FAIL。

- [ ] **Step 3: Commit**

```bash
git add src/apihub-client.js src/apihub-client.test.js
git commit -m "feat: refactor apihub-client to use APIContent.APIs and fetch Service Group Name"
```

---

## Task 3: 更新 CDS 定义

**Files:**
- Modify: `srv/knowledge-service.cds`

- [ ] **Step 1: 替换 `searchApiHub` action 的返回字段**

找到以下代码（行 106-114）：

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

替换为：

```cds
  action searchApiHub(
    query  : String,
    module : String
  ) returns array of {
    id              : String;
    serviceGroupName: String;
    title           : String;
    apiType         : String;
    shortText       : String;
  };
```

- [ ] **Step 2: Commit**

```bash
git add srv/knowledge-service.cds
git commit -m "feat: update searchApiHub return fields to id/serviceGroupName/title/apiType/shortText"
```

---

## Task 4: 更新后端 handler

**Files:**
- Modify: `srv/knowledge-service.js`

### 背景
`knowledge-service.js` 的 `searchApiHub` handler 调用 `searchApis` / `listByModule`，这两个函数签名不变，但返回字段已变。handler 本身逻辑不需要改，只需确认 import 正确。

- [ ] **Step 1: 确认 import 行**

打开 `srv/knowledge-service.js`，第 7 行应为：

```javascript
const { searchApis, listByModule } = require('../src/apihub-client');
```

如已正确，无需修改。

- [ ] **Step 2: 找到 searchApiHub handler，确认逻辑正确**

找到 handler（搜索 `srv.on('searchApiHub'`），确认内容为：

```javascript
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

如已正确，无需修改。如不一致，按上述内容修正。

- [ ] **Step 3: Commit（仅在有改动时）**

```bash
git add srv/knowledge-service.js
git commit -m "fix: ensure searchApiHub handler imports from updated apihub-client"
```

---

## Task 5: 更新前端渲染逻辑

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

### 背景
当前 `_renderApiHubResults` 方法使用 `item.displayName`、`item.name`、`item.description`。
需改为使用 `item.serviceGroupName`（或降级 `item.id`）、`item.title`、`item.shortText`。

新列表行格式：
```
第一行：[ODATAV4] API_BANK          ← apiType 标签 + serviceGroupName（降级显示 id）
第二行：Bank                        ← title（小字，灰色）
```

展开详情：
```
描述: Create, read, update...      ← shortText
```

- [ ] **Step 1: 替换 `_renderApiHubResults` 方法**

找到方法起始行（`_renderApiHubResults: function (results, label) {`），将整个方法替换为：

```javascript
    _renderApiHubResults: function (results, label) {
      var resultDiv = document.getElementById('ccApiHubResult');
      if (!resultDiv) return;

      if (this._apiHubList) {
        this._apiHubList.destroy();
        this._apiHubList = null;
      }
      resultDiv.innerHTML = '';

      if (results.length === 0) {
        resultDiv.innerHTML = '<p style="color:#888;padding:16px;font-size:13px">未找到相关 API，请换个关键词或选择其他模块。</p>';
        return;
      }

      var countText = document.createElement('p');
      countText.style.cssText = 'font-size:12px;color:#666;margin:8px 0 4px;';
      countText.textContent = '找到 ' + results.length + ' 个 API（' + label + '）';
      resultDiv.appendChild(countText);

      var that = this;
      var expandedIndex = -1;

      this._apiHubList = new List({ mode: 'None' });

      results.forEach(function (item, idx) {
        var typeTag   = item.apiType ? '[' + item.apiType + '] ' : '';
        var firstName = item.serviceGroupName || item.id || '';

        // 主行：类型标签 + Service Group Name，第二行：Title（小字）
        var titleVBox = new VBox({
          items: [
            new HBox({
              alignItems: 'Center',
              items: [
                new Text({ text: typeTag, wrapping: false }).addStyleClass('sapUiTinyMarginEnd'),
                new Text({ text: firstName, wrapping: true })
              ]
            }),
            new Text({ text: item.title || '', wrapping: false })
              .addStyleClass('sapUiTinyMarginTop')
          ]
        });

        // 详情区（初始隐藏）
        var detailVBox = new VBox({
          visible: false,
          items: [
            new Text({ text: '描述：' + (item.shortText || '（暂无描述）') })
          ]
        }).addStyleClass('sapUiSmallMarginTop sapUiSmallMarginBegin');

        var itemVBox = new VBox({ items: [titleVBox, detailVBox] });

        var listItem = new sap.m.CustomListItem({
          content: [itemVBox],
          press: function () {
            var isOpen = detailVBox.getVisible();
            if (expandedIndex >= 0 && expandedIndex !== idx) {
              var prevItem = that._apiHubList.getItems()[expandedIndex];
              if (prevItem) {
                var prevDetail = prevItem.getContent()[0].getItems()[1];
                if (prevDetail) prevDetail.setVisible(false);
              }
            }
            detailVBox.setVisible(!isOpen);
            expandedIndex = isOpen ? -1 : idx;
          }
        });

        that._apiHubList.addItem(listItem);
      });

      this._apiHubList.placeAt(resultDiv);
      this._scrollToBottom();
    },
```

- [ ] **Step 2: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: update API Hub list to show Service Group Name as primary title"
```

---

## Task 6: 端到端验证

- [ ] **Step 1: 启动应用**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm start
```

确认启动无报错，监听端口正常。

- [ ] **Step 2: 验证关键词搜索**

打开应用，切换到 API Hub Tab，输入 `Bank`，点击搜索。

预期：
- 结果列表第一条显示 `[ODATAV4] API_BANK`，第二行显示 `Bank`
- 点击展开，显示描述文字

- [ ] **Step 3: 验证模块浏览**

点击 `FI` 模块按钮。

预期：
- 返回财务相关 API 列表
- 每条第一行为 Service Group Name 格式（如 `API_JOURNALENTRY`）

- [ ] **Step 4: 验证降级展示**

若某条结果 Service Group Name 为空（spec 请求失败），前端应显示 `id`（如 `OP_BANK_0003`）而非空白。

- [ ] **Step 5: 运行全量测试**

```bash
npx jest --verbose
```

预期：所有测试 PASS。

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "feat: API Hub Tab refactor complete - show Service Group Name as primary title"
git push
```
