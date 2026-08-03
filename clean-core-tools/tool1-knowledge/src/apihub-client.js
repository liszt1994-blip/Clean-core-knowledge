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
    id:        r.Name        || '',
    title:     r.Title       || '',
    apiType:   r.ServiceCode || '',
    shortText: r.ShortText   || '',
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
