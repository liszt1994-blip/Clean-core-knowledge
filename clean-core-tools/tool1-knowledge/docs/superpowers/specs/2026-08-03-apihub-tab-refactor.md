# API Hub Tab 重构设计文档

**日期：** 2026-08-03
**状态：** 已确认，待实现

---

## 问题背景

当前 API Hub Tab 使用 `ContentPackages('S4HANAOPAPI')/Artifacts` 接口，返回的 `DisplayName` 字段是冗长的 Successor 描述名，与 SAP API Hub 网站上实际显示的名称不符。

用户期望的显示格式（参考 API Hub 网站详情页）：
- **第一行**：Service Group Name，如 `API_BANK`
- **第二行**：Business Object Title，如 `Bank`

---

## 变更范围

| 操作 | 文件 |
|------|------|
| 修改 | `src/apihub-client.js` |
| 修改 | `srv/knowledge-service.cds` |
| 修改 | `srv/knowledge-service.js` |
| 修改 | `app/knowledge/webapp/controller/App.controller.js` |

---

## 数据来源变更

### 旧接口
```
GET /odata/1.0/catalog.svc/ContentPackages('S4HANAOPAPI')/Artifacts
  ?$format=json&$top=50&$skip=N&$select=Name,DisplayName,Type,SubType,Description
```

### 新接口（两步）

**Step 1：获取 API 列表**
```
GET /odata/1.0/catalog.svc/APIContent.APIs
  ?$format=json&$top=50&$skip=N&$select=Name,Title,ShortText,ServiceCode,BusinessObjects
  &$filter=substringof('{keyword}',Title) eq true   ← 关键词搜索时使用
```

返回字段说明：
- `Name`：技术 ID，如 `OP_BANK_0003`
- `Title`：Business Object 名，如 `Bank`
- `ShortText`：简短描述
- `ServiceCode`：API 类型，如 `ODATAV4`、`SOAP`

**Step 2：并发获取每条 API 的 Service Group Name**
```
GET /odata/1.0/catalog.svc/APIContent.APIs('{Name}')/$value?type=json
```
从响应的 `x-sap-ext-overview` 数组中提取：
```json
{ "name": "Service Group Name", "values": [{ "text": "API_BANK" }] }
```

---

## 后端设计

### `src/apihub-client.js` 返回数据结构

```javascript
{
  id:               String,  // Name，如 OP_BANK_0003
  serviceGroupName: String,  // Service Group Name，如 API_BANK（可能为空）
  title:            String,  // Title，如 Bank
  apiType:          String,  // ServiceCode，如 ODATAV4
  shortText:        String,  // ShortText 描述
}
```

### 导出函数签名（不变）

```javascript
async function searchApis(query, limit = 20)    // 关键词搜索
async function listByModule(module, limit = 30) // 按模块浏览
```

### Service Group Name 提取逻辑

```javascript
async function _getServiceGroupName(id) {
  // GET APIContent.APIs('{id}')/$value?type=json
  // 解析 x-sap-ext-overview，找 name === 'Service Group Name'
  // 返回 text 值，失败时返回空字符串（不抛出，降级处理）
}
```

并发方式：`Promise.allSettled`，单条失败不影响整体结果。

### `srv/knowledge-service.cds` 返回结构变更

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

---

## 前端展示格式

### 列表行（收起状态）

```
[ODATAV4]  API_BANK
           Bank
```

- 第一行：`[apiType]` 标签 + `serviceGroupName`（若为空则显示 `id`）
- 第二行：`title`（小字）

### 展开详情

```
描述: Create, read, update and prepare for deletion bank master data...
```

---

## 模块关键词映射

`MODULE_KEYWORDS` 保持不变，但过滤逻辑改为匹配 `Title` 字段（原来匹配 `DisplayName`）。

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| `_getServiceGroupName` 单条失败 | `serviceGroupName` 返回空字符串，前端降级显示 `id` |
| API Hub 接口 HTTP 错误 | 抛出错误，前端显示"请求失败"提示 |
| 搜索结果为空 | 返回空数组，前端显示"未找到相关 API" |
