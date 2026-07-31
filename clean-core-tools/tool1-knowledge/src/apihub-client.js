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
    const lastPage = results.length < PAGE_SIZE;
    for (const r of results) {
      const name = (r.DisplayName || '').toLowerCase();
      if (lowerKws.some(k => name.includes(k))) {
        matched.push(r);
      }
    }
    if (lastPage) break;
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
