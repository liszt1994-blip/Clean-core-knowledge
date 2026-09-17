// src/apihub-client.js
'use strict';

const fetch = require('node-fetch');
const path  = require('path');
const fs    = require('fs');
// node-fetch v2 required (CommonJS + timeout option support)

const BASE_URL  = 'https://api.sap.com/odata/1.0/catalog.svc';
const PAGE_SIZE = 50;
// 最多扫描 60 页（3000 条），覆盖 API Hub 全量（当前约 2500 条）
const MAX_PAGES = 60;

// Pre-built mapping: API Name → { title, type, serviceGroupName }
// Built from browser-crawled data; update docs/apihub-sgn-map.json to refresh
const SGN_MAP_PATH = path.join(__dirname, '..', 'docs', 'apihub-sgn-map.json');
let _sgnMap = null;
// Secondary index: normalized key (strip sap-s4- prefix and -vN suffix) → entry
let _sgnMapNorm = null;

function _normKey(k) {
  return k.replace(/^sap-s4-/, '').replace(/-v\d+$/, '');
}

function _getSgnMap() {
  if (!_sgnMap) {
    try {
      _sgnMap = JSON.parse(fs.readFileSync(SGN_MAP_PATH, 'utf8'));
    } catch (_) {
      _sgnMap = {};
    }
    // Build normalized lookup for keys like 'sap-s4-OP_XXX-v1' → accessible by 'OP_XXX'
    _sgnMapNorm = {};
    Object.keys(_sgnMap).forEach(function (k) {
      var norm = _normKey(k);
      if (norm !== k) _sgnMapNorm[norm] = _sgnMap[k];
    });
  }
  return _sgnMap;
}

function _lookupSgn(name) {
  _getSgnMap();
  return _sgnMap[name] || _sgnMapNorm[name] || null;
}

// S/4HANA PCE API 的 Name 都以 OP_ 或 sap-s4-OP_ 开头
function _isS4Api(name) {
  return name.startsWith('OP_') || name.startsWith('sap-s4-OP_');
}

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

// 获取单页 API 列表（APIContent.APIs 接口），包含 State 字段
async function _fetchApisPage(skip) {
  const url = `${BASE_URL}/APIContent.APIs` +
    `?$format=json&$top=${PAGE_SIZE}&$skip=${skip}` +
    `&$select=Name,Title,ShortText,ServiceCode,State`;
  const resp = await fetch(url, {
    headers: { APIKey: _getApiKey() },
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`API Hub HTTP ${resp.status}`);
  const json = await resp.json();
  return (json.d && json.d.results) ? json.d.results : [];
}

// 将原始 API 记录转换为内部格式，从本地映射表读取 serviceGroupName
// cleanCore: OData V4 API 且有 SGN 时为 true；ODATA/SOAP/REST 为 false（不代表不合规，需人工判断）
function _toRecord(r) {
  const entry = _lookupSgn(r.Name) || {};
  const hasSgn = !!(entry.serviceGroupName);
  return {
    id:              r.Name        || '',
    title:           r.Title       || '',
    apiType:         r.ServiceCode || '',
    shortText:       r.ShortText   || '',
    serviceGroupName: entry.serviceGroupName || '',
    cleanCore:        hasSgn && r.ServiceCode === 'ODATAV4',
  };
}

// 每批并发拉取的页数。API Hub 总量约 2500 条（~50 页），串行逐页拉满 60 页
// 是主要耗时来源。分批并发可把 60 次串行往返压缩到约 10 批。
const PAGE_BATCH = 6;

// 全量扫描 API Hub，只收集 S/4HANA PCE API（OP_ 或 sap-s4-OP_ 开头），过滤已废弃。
// 分批并发拉页：一次并发 PAGE_BATCH 页，若本批出现空页或不足页（说明已到末尾）则停止。
async function _fetchAllS4Apis() {
  const all = [];
  let reachedEnd = false;
  for (let start = 0; start < MAX_PAGES && !reachedEnd; start += PAGE_BATCH) {
    const batch = [];
    for (let p = start; p < Math.min(start + PAGE_BATCH, MAX_PAGES); p++) {
      batch.push(p);
    }
    const pages = await Promise.all(batch.map(page => _fetchApisPage(page * PAGE_SIZE)));
    for (const results of pages) {
      if (results.length === 0 || results.length < PAGE_SIZE) reachedEnd = true;
      for (const r of results) {
        if (_isS4Api(r.Name) && r.State !== 'DEPRECATED') {
          all.push(r);
        }
      }
    }
  }
  return all;
}

async function searchApis(query, { offset = 0, limit = 20 } = {}) {
  _getApiKey();
  const lowerKws = query.trim().split(/\s+/).map(k => k.toLowerCase());
  const all = await _fetchAllS4Apis();
  const matched = all.filter(r => {
    const title = (r.Title || '').toLowerCase();
    return lowerKws.some(k => title.includes(k));
  });
  return matched.slice(offset, offset + limit).map(_toRecord);
}

async function listByModule(module, { offset = 0, limit = 500 } = {}) {
  _getApiKey();
  const mod = module.trim().toUpperCase();
  const keywords = MODULE_KEYWORDS[mod];
  if (!keywords) {
    throw new Error(`不支持模块 "${mod}"。可用：${Object.keys(MODULE_KEYWORDS).join('、')}`);
  }
  const lowerKws = keywords.map(k => k.toLowerCase());
  const all = await _fetchAllS4Apis();
  const matched = all.filter(r => {
    const title = (r.Title || '').toLowerCase();
    return lowerKws.some(k => title.includes(k));
  });
  return matched.slice(offset, offset + limit).map(_toRecord);
}

async function getDetails(apiName) {
  _getApiKey();
  const lowerName = apiName.trim().toLowerCase();
  const all = await _fetchAllS4Apis();
  const exact = all.find(r => (r.Title || '').toLowerCase() === lowerName);
  const partial = all.find(r => (r.Title || '').toLowerCase().includes(lowerName));
  const target = exact || partial;
  if (!target) throw new Error(`未找到 API "${apiName}"`);
  return _toRecord(target);
}

module.exports = { searchApis, listByModule, getDetails, _resetSgnMapCache: () => { _sgnMap = null; _sgnMapNorm = null; } };
