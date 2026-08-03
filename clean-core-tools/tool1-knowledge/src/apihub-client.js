// src/apihub-client.js
'use strict';

const fetch = require('node-fetch');
const path  = require('path');
const fs    = require('fs');
// node-fetch v2 required (CommonJS + timeout option support)

const BASE_URL  = 'https://api.sap.com/odata/1.0/catalog.svc';
const PAGE_SIZE = 50;

// Pre-built mapping: API Name → { title, type, serviceGroupName }
// Built from browser-crawled data; update docs/apihub-sgn-map.json to refresh
const SGN_MAP_PATH = path.join(__dirname, '..', 'docs', 'apihub-sgn-map.json');
let _sgnMap = null;

function _getSgnMap() {
  if (!_sgnMap) {
    try {
      _sgnMap = JSON.parse(fs.readFileSync(SGN_MAP_PATH, 'utf8'));
    } catch (_) {
      _sgnMap = {};
    }
  }
  return _sgnMap;
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

// 将原始 API 记录转换为内部格式，从本地映射表读取 serviceGroupName
function _toRecord(r) {
  const map = _getSgnMap();
  const entry = map[r.Name] || {};
  return {
    id:              r.Name         || '',
    title:           r.Title        || '',
    apiType:         r.ServiceCode  || '',
    shortText:       r.ShortText    || '',
    serviceGroupName: entry.serviceGroupName || '',
  };
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
  const matched = await _searchAll([apiName.trim()]);
  const exact = matched.find(r => (r.Title || '').toLowerCase() === apiName.toLowerCase());
  const target = exact || matched[0];
  if (!target) throw new Error(`未找到 API "${apiName}"`);
  return _toRecord(target);
}

module.exports = { searchApis, listByModule, getDetails, _resetSgnMapCache: () => { _sgnMap = null; } };
