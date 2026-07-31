# API Hub 搜索 Tab 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增"API Hub"Tab，允许用户通过关键词搜索或按 SAP 模块（FI/MM/SD/PP/HR/PM）浏览 SAP S/4HANA PCE 官方 API 列表，点击结果可 inline 展开详情。

**Architecture:** 新建 `src/apihub-client.js` 封装对 `api.sap.com` 的 HTTP 调用；后端在 `knowledge-service.cds` 新增 `searchApiHub` action，`knowledge-service.js` 实现 handler；前端 `App.controller.js` 新增第四个 Tab，包含搜索框、模块按钮组、结果列表。API Key 从 `.env` 的 `API_HUB_KEY` 环境变量读取。

**Tech Stack:** SAP UI5 (sap.m)，Node.js `node-fetch` / `https`，SAP CAP CDS，Jest 单元测试。

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `src/apihub-client.js` |
| 新增 | `src/apihub-client.test.js` |
| 修改 | `srv/knowledge-service.cds`（第 104 行末尾追加） |
| 修改 | `srv/knowledge-service.js`（第 6 行 require 列表 + 第 764 行 handler） |
| 修改 | `app/knowledge/webapp/controller/App.controller.js`（多处，见各 Task） |
| 修改 | `.env`（追加 `API_HUB_KEY=`） |
| 新增 | `.gitignore`（创建，确保 `.env` 被忽略） |

---

### Task 1: 新建 `src/apihub-client.js` 并通过单元测试

**Files:**
- Create: `src/apihub-client.js`
- Create: `src/apihub-client.test.js`

- [ ] **Step 1: 写失败测试**

在 `src/apihub-client.test.js` 中写：

```javascript
// src/apihub-client.test.js
'use strict';

// Mock node-fetch globally
jest.mock('node-fetch');
const fetch = require('node-fetch');
const { Response } = jest.requireActual('node-fetch');

const { searchApis, listByModule, getDetails } = require('./apihub-client');

beforeEach(() => {
  process.env.API_HUB_KEY = 'test-key';
  fetch.mockReset();
});

afterEach(() => {
  delete process.env.API_HUB_KEY;
});

// ── searchApis ────────────────────────────────────────────────────────────

test('searchApis returns matching results', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({
    d: {
      results: [
        { Name: 'API_PURCHASEORDER_PROCESS_SRV', DisplayName: 'Purchase Order', Type: 'ODataV2', SubType: 'OData', Description: 'Process purchase orders' },
        { Name: 'API_MATERIAL_SRV', DisplayName: 'Material', Type: 'ODataV2', SubType: 'OData', Description: 'Material master data' },
      ]
    }
  }), { status: 200 }));

  const results = await searchApis('Purchase', 20);
  expect(results).toHaveLength(1);
  expect(results[0]).toEqual({
    name: 'API_PURCHASEORDER_PROCESS_SRV',
    displayName: 'Purchase Order',
    apiType: 'OData',
    description: 'Process purchase orders',
  });
});

test('searchApis throws when API_HUB_KEY not set', async () => {
  delete process.env.API_HUB_KEY;
  await expect(searchApis('Purchase')).rejects.toThrow('API_HUB_KEY');
});

test('searchApis returns empty array when no match', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ d: { results: [] } }), { status: 200 }));
  const results = await searchApis('zzznomatch');
  expect(results).toEqual([]);
});

// ── listByModule ───────────────────────────────────────────────────────────

test('listByModule FI returns finance-related results', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({
    d: {
      results: [
        { Name: 'API_JOURNALENTRY_SRV', DisplayName: 'Journal Entry', Type: 'ODataV2', SubType: 'OData', Description: 'Post journal entries' },
      ]
    }
  }), { status: 200 }));

  const results = await listByModule('FI', 30);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].displayName).toBe('Journal Entry');
});

test('listByModule throws for unknown module', async () => {
  await expect(listByModule('XX')).rejects.toThrow('不支持模块');
});

// ── getDetails ─────────────────────────────────────────────────────────────

test('getDetails returns exact match first', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({
    d: {
      results: [
        { Name: 'API_PURCHASEORDER_PROCESS_SRV', DisplayName: 'Purchase Order', Type: 'ODataV2', SubType: 'OData', Description: 'Process purchase orders' },
        { Name: 'API_PURCHASEORDER_CONFIRM_SRV', DisplayName: 'Purchase Order Confirmation', Type: 'ODataV2', SubType: 'OData', Description: 'Confirm orders' },
      ]
    }
  }), { status: 200 }));

  const result = await getDetails('Purchase Order');
  expect(result.displayName).toBe('Purchase Order');
});

test('getDetails throws when not found', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ d: { results: [] } }), { status: 200 }));
  await expect(getDetails('Nonexistent API')).rejects.toThrow('未找到');
});
```

- [ ] **Step 2: 运行确认测试失败**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest src/apihub-client.test.js --no-coverage 2>&1 | tail -10
```

预期：`FAIL` — `Cannot find module './apihub-client'`

- [ ] **Step 3: 创建 `src/apihub-client.js`**

```javascript
// src/apihub-client.js
'use strict';

const fetch = require('node-fetch');

const PACKAGE_ID = 'S4HANAOPAPI';
const BASE_URL   = 'https://api.sap.com/odata/1.0/catalog.svc';
const PAGE_SIZE  = 50;

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

async function _fetchPage(skip) {
  const url = `${BASE_URL}/ContentPackages('${PACKAGE_ID}')/Artifacts` +
    `?$format=json&$top=${PAGE_SIZE}&$skip=${skip}` +
    `&$select=Name,DisplayName,Type,SubType,Description`;
  const resp = await fetch(url, {
    headers: { APIKey: _getApiKey() },
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`API Hub HTTP ${resp.status}`);
  const json = await resp.json();
  return (json.d && json.d.results) ? json.d.results : [];
}

async function _searchAll(keywords, maxPages = 10) {
  const matched = [];
  const lowerKws = keywords.map(k => k.toLowerCase());
  for (let page = 0; page < maxPages; page++) {
    const results = await _fetchPage(page * PAGE_SIZE);
    if (results.length === 0) break;
    for (const r of results) {
      const name = (r.DisplayName || '').toLowerCase();
      if (lowerKws.some(k => name.includes(k))) {
        matched.push(r);
      }
    }
  }
  return matched;
}

function _toRecord(r) {
  return {
    name:        r.Name        || '',
    displayName: r.DisplayName || '',
    apiType:     r.SubType     || r.Type || '',
    description: r.Description || '',
  };
}

async function searchApis(query, limit = 20) {
  _getApiKey(); // validate early
  const keywords = query.trim().split(/\s+/);
  const matched = await _searchAll(keywords);
  return matched.slice(0, limit).map(_toRecord);
}

async function listByModule(module, limit = 30) {
  _getApiKey();
  const mod = module.trim().toUpperCase();
  const keywords = MODULE_KEYWORDS[mod];
  if (!keywords) {
    throw new Error(`不支持模块 "${mod}"。可用：${Object.keys(MODULE_KEYWORDS).join('、')}`);
  }
  const matched = await _searchAll(keywords);
  return matched.slice(0, limit).map(_toRecord);
}

async function getDetails(apiName) {
  _getApiKey();
  const keywords = apiName.trim().split(/\s+/);
  const matched = await _searchAll(keywords);
  const exact = matched.find(r => (r.DisplayName || '').toLowerCase() === apiName.toLowerCase());
  const target = exact || matched[0];
  if (!target) throw new Error(`未找到 API "${apiName}"`);
  return _toRecord(target);
}

module.exports = { searchApis, listByModule, getDetails };
```

- [ ] **Step 4: 确认 `node-fetch` 已安装**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
node -e "require('node-fetch'); console.log('ok')"
```

预期：输出 `ok`。如果报错 `Cannot find module`，运行 `npm install node-fetch@2`（使用 v2，CommonJS 兼容）。

- [ ] **Step 5: 运行测试确认通过**

```bash
npx jest src/apihub-client.test.js --no-coverage 2>&1 | tail -15
```

预期：`Tests: 6 passed`

- [ ] **Step 6: Commit**

```bash
git add src/apihub-client.js src/apihub-client.test.js
git commit -m "feat: add apihub-client with search/listByModule/getDetails"
```

---

### Task 2: 更新 `.env` 和 `.gitignore`

**Files:**
- Modify: `.env`
- Create: `.gitignore`

- [ ] **Step 1: 在 `.env` 末尾追加 API_HUB_KEY**

在 `.env` 文件末尾新增一行：
```
API_HUB_KEY=
```
（填入你的 SAP API Hub API Key 值）

- [ ] **Step 2: 创建 `.gitignore` 确保 `.env` 不被提交**

检查项目根目录是否有 `.gitignore`：
```bash
ls -la "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge/.gitignore" 2>/dev/null || echo "missing"
```

如果不存在，创建文件 `C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge/.gitignore`，内容：
```
.env
node_modules/
```

如果已存在，确认文件中含有 `.env` 行，若没有则追加。

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
git add .gitignore
git commit -m "chore: add .gitignore to protect .env secrets"
```

（注意：不要 `git add .env`，`.env` 只在本地使用）

---

### Task 3: 后端 CDS + handler

**Files:**
- Modify: `srv/knowledge-service.cds`（第 104 行 `};` 之后追加）
- Modify: `srv/knowledge-service.js`（第 6 行 require + 第 764 行附近 handler）

- [ ] **Step 1: 在 `srv/knowledge-service.cds` 末尾追加 action 定义**

在 `srv/knowledge-service.cds` 第 104 行（`};` 结束符的上方，即 `plan` action 返回块结束后）添加：

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

完整的 CDS 文件末尾应如下（从第 95 行起）：
```cds
  action plan(objectName : String) returns {
    objectName      : String;
    replacement     : String;
    replacementType : String;
    riskLevel       : String;
    effortEstimate  : String;
    steps           : String;
    codeExample     : String;
    summary         : String;
  };

  action searchApiHub(
    query  : String,
    module : String
  ) returns array of {
    name        : String;
    displayName : String;
    apiType     : String;
    description : String;
  };
}
```

- [ ] **Step 2: 在 `srv/knowledge-service.js` 第 6 行添加 require**

将：
```javascript
const { searchHelpPortal } = require('../src/sap-help-search');
```
改为：
```javascript
const { searchHelpPortal } = require('../src/sap-help-search');
const { searchApis, listByModule } = require('../src/apihub-client');
```

- [ ] **Step 3: 在 `srv/knowledge-service.js` 末尾（第 764 行 `srv.on('searchNote'` 处理函数结束的 `});` 之后，`});` 模块闭合括号之前）添加 handler**

在 `srv.on('searchNote', ...)` 的闭合 `});` 之后、模块最后的 `});` 之前，插入：

```javascript
  // ── Tab 4: API Hub 搜索 ──────────────────────────────────────────────────
  srv.on('searchApiHub', async (req) => {
    const { query, module } = req.data;
    const q = (query || '').trim();
    const m = (module || '').trim().toUpperCase();

    if (!q && !m) {
      return req.error(400, 'query 或 module 至少填写一个');
    }

    try {
      if (m) {
        return await listByModule(m);
      }
      return await searchApis(q);
    } catch (err) {
      if (err.message && err.message.includes('API_HUB_KEY')) {
        return req.error(500, '配置错误：API_HUB_KEY 未设置，请联系管理员。');
      }
      if (err.message && err.message.includes('不支持模块')) {
        return req.error(400, err.message);
      }
      return req.error(502, 'API Hub 请求失败，请稍后重试。');
    }
  });
```

- [ ] **Step 4: 在 `srv/knowledge-service.test.js` 中添加 `searchApiHub` 测试**

在 `knowledge-service.test.js` 中找到现有测试末尾，添加：

```javascript
// ── searchApiHub ───────────────────────────────────────────────────────────

jest.mock('../src/apihub-client', () => ({
  searchApis: jest.fn().mockResolvedValue([
    { name: 'API_PURCHASEORDER_PROCESS_SRV', displayName: 'Purchase Order', apiType: 'OData', description: 'Process PO' }
  ]),
  listByModule: jest.fn().mockResolvedValue([
    { name: 'API_JOURNALENTRY_SRV', displayName: 'Journal Entry', apiType: 'OData', description: 'Post JE' }
  ]),
}));

describe('searchApiHub', () => {
  test('keyword search returns results', async () => {
    const response = await fetch(
      'http://localhost:4004/odata/v4/knowledge/searchApiHub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Purchase', module: '' }),
      }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.value[0].displayName).toBe('Purchase Order');
  });

  test('module browse returns results', async () => {
    const response = await fetch(
      'http://localhost:4004/odata/v4/knowledge/searchApiHub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', module: 'FI' }),
      }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.value[0].displayName).toBe('Journal Entry');
  });

  test('returns 400 when both query and module empty', async () => {
    const response = await fetch(
      'http://localhost:4004/odata/v4/knowledge/searchApiHub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', module: '' }),
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

预期：所有测试通过（包含新增 3 个 searchApiHub 测试）

- [ ] **Step 6: Commit**

```bash
git add srv/knowledge-service.cds srv/knowledge-service.js srv/knowledge-service.test.js
git commit -m "feat: add searchApiHub CAP action and handler"
```

---

### Task 4: 前端——新增 `apihub` Tab（onInit + onAfterRendering）

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`（多处）

- [ ] **Step 1: 在 `onInit` 中更新 `_TAB_KEYS`、`_messages`、`TAB_CONFIG`**

找到第 52 行：
```javascript
      this._TAB_KEYS = ['concept', 'codeanalysis', 'search'];
      this._currentTab = 'concept';
      this._codeSubMode = 'code'; // 'code' | 'atc'
      this._chatHistories = {};
      this._messages = { concept: [], codeanalysis: [], search: [] };
```
改为：
```javascript
      this._TAB_KEYS = ['concept', 'codeanalysis', 'search', 'apihub'];
      this._currentTab = 'concept';
      this._codeSubMode = 'code'; // 'code' | 'atc'
      this._chatHistories = {};
      this._messages = { concept: [], codeanalysis: [], search: [], apihub: [] };
```

- [ ] **Step 2: 在 `onInit` 中更新 `TAB_CONFIG`**

找到第 58 行的 `TAB_CONFIG` 定义，将：
```javascript
      var TAB_CONFIG = {
        concept:      { icon: 'sap-icon://hint',       text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',                         welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
        codeanalysis: { icon: 'sap-icon://source-code', text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                                         welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
        search:       { icon: 'sap-icon://search',      text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...',                                      welcome: '用于直接在 SAP 门户网站搜索相关内容及 Note。' }
      };
```
改为：
```javascript
      var TAB_CONFIG = {
        concept:      { icon: 'sap-icon://hint',       text: '概念 & 分级', placeholder: '输入 Clean Core 概念或 SAP 对象名...',                         welcome: '你好！请输入 Clean Core 概念或 SAP 对象名，我会解释概念或给出分级和替代 API。' },
        codeanalysis: { icon: 'sap-icon://source-code', text: '代码分析',   placeholder: '粘贴 ABAP 代码片段...',                                         welcome: '请粘贴 ABAP 代码，我会识别所有不合规对象并给出改写对比。' },
        search:       { icon: 'sap-icon://search',      text: 'SAP 搜索',   placeholder: '搜索 SAP Note 或文档...',                                      welcome: '用于直接在 SAP 门户网站搜索相关内容及 Note。' },
        apihub:       { icon: 'sap-icon://api',         text: 'API Hub',    placeholder: '',                                                              welcome: '' }
      };
```

- [ ] **Step 3: 在 `onInit` 中初始化 API Hub 专用控件**

找到第 93 行（`// Tab 4 搜索控件` 注释）：
```javascript
      // Tab 4 搜索控件
      this._noteSearchInput = new TextArea({
```
在其上方插入（API Hub 控件初始化）：
```javascript
      // Tab 4（API Hub）专用控件
      this._apiHubInput = new TextArea({
        placeholder: '输入 API 关键词，例如 Purchase Order...',
        rows: 2,
        growing: false,
        width: '100%'
      });
      this._apiHubSearchBtn = new Button({
        text: '搜索',
        type: 'Emphasized',
        press: [this.onSearchApiHub, this]
      });

```

- [ ] **Step 4: 在 `onAfterRendering` 中添加 API Hub DOM 结构**

找到约第 198 行：
```javascript
          // Tab 4 搜索结果表格容器
          var searchResultDiv = document.createElement('div');
          searchResultDiv.id = 'ccSearchResult';
          searchResultDiv.style.cssText = 'display:none;padding:8px 16px;';
          scrollDiv.appendChild(searchResultDiv);
```
在其**之前**（即紧接在 `_TAB_KEYS.forEach` 循环的闭合 `});` 之后）插入：

```javascript
          // API Hub 结果容器（放在 scrollDiv 内，与 ccChat_apihub 分离，独立控制显示）
          var apiHubResultDiv = document.createElement('div');
          apiHubResultDiv.id = 'ccApiHubResult';
          apiHubResultDiv.style.cssText = 'display:none;padding:8px 16px;';
          scrollDiv.appendChild(apiHubResultDiv);
```

- [ ] **Step 5: 在 `onAfterRendering` 中添加 API Hub 输入区**

找到约第 234 行：
```javascript
          var searchInputDiv = document.createElement('div');
          searchInputDiv.id = 'ccSearchInputArea';
          searchInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(searchInputDiv);
```
在其**之后**、`that._noteSearchInput.placeAt(noteInputWrap);` 之后，找到：
```javascript
          // TextArea 没有 attachSubmit，监听 DOM keydown 触发搜索（Shift+Enter 换行，Enter 搜索）
          that._noteSearchInput.addEventDelegate({
```
在 `that._noteSearchBtn.placeAt(noteBtnWrap);` 之后、`that._noteSearchInput.addEventDelegate` 之前插入：

```javascript
          // ── API Hub 输入区 ───────────────────────────────────────────
          var apiHubInputDiv = document.createElement('div');
          apiHubInputDiv.id = 'ccApiHubInputArea';
          apiHubInputDiv.style.cssText = 'display:none;flex-shrink:0;border-top:1px solid #e8e8e8;background:#fff;padding:8px 16px;';
          wrap.appendChild(apiHubInputDiv);

          // 搜索行：输入框 + 搜索按钮
          var apiHubRow = document.createElement('div');
          apiHubRow.style.cssText = 'display:flex;align-items:flex-end;gap:8px;margin-bottom:8px;';
          apiHubInputDiv.appendChild(apiHubRow);

          var apiHubTextWrap = document.createElement('div');
          apiHubTextWrap.style.cssText = 'flex:1;min-width:0;';
          apiHubRow.appendChild(apiHubTextWrap);

          var apiHubBtnWrap = document.createElement('div');
          apiHubBtnWrap.style.cssText = 'flex-shrink:0;';
          apiHubRow.appendChild(apiHubBtnWrap);

          that._apiHubInput.placeAt(apiHubTextWrap);
          that._apiHubSearchBtn.placeAt(apiHubBtnWrap);

          // 模块按钮组
          var moduleRow = document.createElement('div');
          moduleRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
          apiHubInputDiv.appendChild(moduleRow);

          ['FI', 'MM', 'SD', 'PP', 'HR', 'PM'].forEach(function (mod) {
            var modLabels = { FI: '财务 FI', MM: '物料 MM', SD: '销售 SD', PP: '生产 PP', HR: '人力 HR', PM: '工厂 PM' };
            var modBtn = document.createElement('button');
            modBtn.textContent = modLabels[mod];
            modBtn.dataset.mod = mod;
            modBtn.style.cssText = 'background:#f5f5f5;color:#0a6ed1;border:1px solid #0a6ed1;border-radius:4px;padding:4px 12px;font-size:12px;cursor:pointer;';
            modBtn.onmouseover = function () { this.style.background = '#e8f4ff'; };
            modBtn.onmouseout  = function () { this.style.background = '#f5f5f5'; };
            modBtn.onclick = function () { that.onApiHubModuleSelect(this.dataset.mod); };
            moduleRow.appendChild(modBtn);
          });

          // Enter 键触发搜索
          that._apiHubInput.addEventDelegate({
            onkeydown: function (oEvent) {
              if (oEvent.key === 'Enter' && !oEvent.shiftKey) {
                oEvent.preventDefault();
                that.onSearchApiHub();
              }
            }
          });

```

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: init apihub tab controls and DOM structure in onInit/onAfterRendering"
```

---

### Task 5: 前端——Tab 切换逻辑 + 搜索方法 + 结果渲染

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`（多处）

- [ ] **Step 1: 更新 `onTabSelect` 方法，处理 `apihub` Tab**

找到约第 336 行：
```javascript
      if (key === 'search') {
        if (inputArea) inputArea.style.display = 'none';
        if (searchInputArea) searchInputArea.style.display = 'block';
        if (searchResult) searchResult.style.display = 'block';
      } else {
        if (inputArea) inputArea.style.display = 'block';
        if (searchInputArea) searchInputArea.style.display = 'none';
        if (searchResult) searchResult.style.display = 'none';
        if (key === 'codeanalysis') {
          this._chatInput.setPlaceholder(this._CODE_SUB_CONFIG[this._codeSubMode].placeholder);
        } else {
          this._chatInput.setPlaceholder(this._TAB_CONFIG[key].placeholder);
        }
      }
```
替换为：
```javascript
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

- [ ] **Step 2: 在 `onTabSelect` 之前插入 `onSearchApiHub`、`onApiHubModuleSelect`、`_renderApiHubResults` 三个方法**

在 `onTabSelect: function (oEvent)` 定义的**上方**插入：

```javascript
    // ── API Hub 搜索 ─────────────────────────────────────────────────────────
    onSearchApiHub: function () {
      var query = this._apiHubInput.getValue().trim();
      if (!query) return;
      this._doApiHubSearch({ query: query, module: '' });
    },

    onApiHubModuleSelect: function (mod) {
      this._doApiHubSearch({ query: '', module: mod });
    },

    _doApiHubSearch: function (params) {
      var model = this.getView().getModel();
      if (model.getProperty('/busy')) return;

      model.setProperty('/busy', true);
      this._apiHubSearchBtn.setEnabled(false);
      this._busyIndicator.setVisible(true);

      var that = this;
      fetch('/odata/v4/knowledge/searchApiHub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          model.setProperty('/busy', false);
          that._apiHubSearchBtn.setEnabled(true);
          that._busyIndicator.setVisible(false);
          var results = json.value || [];
          that._renderApiHubResults(results, params.module || params.query);
        })
        .catch(function () {
          model.setProperty('/busy', false);
          that._apiHubSearchBtn.setEnabled(true);
          that._busyIndicator.setVisible(false);
          var resultDiv = document.getElementById('ccApiHubResult');
          if (resultDiv) resultDiv.innerHTML = '<p style="color:#c00;padding:16px;font-size:13px">请求失败，请检查网络或 API Key 配置。</p>';
        });
    },

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
        var typeTag = item.apiType ? '[' + item.apiType + '] ' : '';

        // 主行：类型标签 + 显示名
        var titleHBox = new HBox({
          alignItems: 'Center',
          items: [
            new Text({ text: typeTag, wrapping: false }).addStyleClass('sapUiTinyMarginEnd'),
            new Text({ text: item.displayName || '', wrapping: true })
          ]
        });

        // 详情区（初始隐藏）
        var detailVBox = new VBox({
          visible: false,
          items: [
            new Text({ text: '技术名：' + (item.name || '—') }),
            new Text({ text: '类型：' + (item.apiType || '—') }),
            new Text({ text: '描述：' + (item.description || '（暂无描述）') })
          ]
        }).addStyleClass('sapUiSmallMarginTop sapUiSmallMarginBegin');

        var itemVBox = new VBox({ items: [titleHBox, detailVBox] });

        var listItem = new sap.m.CustomListItem({
          content: [itemVBox],
          press: function () {
            var isOpen = detailVBox.getVisible();
            // 收起上一条展开的
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

- [ ] **Step 3: 更新 `_addWelcomeMessage` 跳过 `apihub` Tab**

找到约第 357 行：
```javascript
      var welcomeText = this._TAB_CONFIG[key].welcome;
      if (!welcomeText) return;
      if (key === 'codeanalysis') return; // 由子模式懒初始化欢迎语
```
确认 `if (!welcomeText) return;` 这行已存在。由于 `apihub` 的 `welcome` 为空字符串，`_addWelcomeMessage` 会自动 return，无需额外修改。

- [ ] **Step 4: 在前端确认 `sap.m.CustomListItem` 可用（检查已有依赖）**

查看 `App.controller.js` 第 1 行 `sap.ui.define` 的依赖列表，确认已有 `'sap/m/List'`（第 20 行）。`CustomListItem` 通过 `sap.m.CustomListItem` 全局访问，无需额外 require（SAP UI5 全局加载）。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: add API Hub tab search/module/render methods and tab-switch logic"
```

---

### Task 6: 手动验证全流程

- [ ] **Step 1: 在 `.env` 填入真实 API Key**

确认 `.env` 中 `API_HUB_KEY=` 后面填了有效的 SAP API Hub API Key。

- [ ] **Step 2: 启动开发服务器**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm run dev
```

- [ ] **Step 3: 验证 Tab 结构**

打开浏览器，确认外层共 4 个 Tab：`概念 & 分级` / `代码分析` / `SAP 搜索` / `API Hub`

- [ ] **Step 4: 验证关键词搜索**

点击"API Hub" Tab，输入 `Purchase Order`，点击"搜索"，确认：
- 结果列表出现（若有数据）
- 点击任意一条结果 → 详情区展开（显示技术名、类型、描述）
- 再次点击 → 收起

- [ ] **Step 5: 验证模块浏览**

点击"财务 FI"按钮，确认返回财务相关 API 列表。

- [ ] **Step 6: 验证 Tab 切换时输入栏正确切换**

从 `API Hub` 切换到 `概念 & 分级`，确认：底部 `_chatInput` 出现，`API Hub` 输入区隐藏。

- [ ] **Step 7: 运行全部测试**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

预期：所有测试通过，无失败。

- [ ] **Step 8: 最终 commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: complete API Hub tab - search, module browse, inline expand"
```
