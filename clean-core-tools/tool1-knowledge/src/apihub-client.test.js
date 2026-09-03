// src/apihub-client.test.js
'use strict';

jest.mock('node-fetch');
jest.mock('fs');

const fetch  = require('node-fetch');
const fs     = require('fs');
const { Response } = jest.requireActual('node-fetch');
const { searchApis, listByModule, getDetails, _resetSgnMapCache } = require('./apihub-client');

beforeEach(() => {
  process.env.API_HUB_KEY = 'test-key';
  fetch.mockReset();
  fs.readFileSync.mockReset();
  _resetSgnMapCache();
});

afterEach(() => {
  delete process.env.API_HUB_KEY;
});

// Helper: configure what the module reads from the SGN map file
function mockSgnMap(mapObj) {
  fs.readFileSync.mockImplementation((filePath) => {
    if (String(filePath).includes('apihub-sgn-map')) {
      return JSON.stringify(mapObj);
    }
    return jest.requireActual('fs').readFileSync(filePath);
  });
}

// Construct an APIContent.APIs list response with State field
function makeListResponse(items) {
  return new Response(JSON.stringify({ d: { results: items } }), { status: 200 });
}

// ── searchApis ────────────────────────────────────────────────────────────

test('searchApis returns S4 APIs with serviceGroupName from local map', async () => {
  mockSgnMap({ 'OP_PURCHASEORDER_0001': { serviceGroupName: 'API_PURCHASEORDER_2' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_PURCHASEORDER_0001', Title: 'Purchase Order', ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders', State: 'ACTIVE' },
      { Name: 'some_other_api', Title: 'Purchase Other', ServiceCode: 'REST', ShortText: 'Not S4', State: 'ACTIVE' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Purchase');
  // Only OP_ prefixed APIs returned
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    id:               'OP_PURCHASEORDER_0001',
    title:            'Purchase Order',
    apiType:          'ODATAV4',
    shortText:        'Process purchase orders',
    serviceGroupName: 'API_PURCHASEORDER_2',
    cleanCore:        true,
  });
});

test('searchApis excludes DEPRECATED APIs', async () => {
  mockSgnMap({});
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_ACTIVE_0001', Title: 'Bank Active', ServiceCode: 'ODATAV4', ShortText: 'Active', State: 'ACTIVE' },
      { Name: 'OP_DEPRECATED_0001', Title: 'Bank Deprecated', ServiceCode: 'ODATAV4', ShortText: 'Old', State: 'DEPRECATED' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Bank');
  expect(results).toHaveLength(1);
  expect(results[0].id).toBe('OP_ACTIVE_0001');
});

test('searchApis returns empty serviceGroupName and cleanCore=false when not in map', async () => {
  mockSgnMap({});
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_BANK_0003', Title: 'Bank', ServiceCode: 'ODATAV4', ShortText: 'Bank master data', State: 'ACTIVE' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Bank');
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('');
  expect(results[0].cleanCore).toBe(false);
  expect(results[0].id).toBe('OP_BANK_0003');
});

test('searchApis throws when API_HUB_KEY not set', async () => {
  delete process.env.API_HUB_KEY;
  await expect(searchApis('Purchase')).rejects.toThrow('API_HUB_KEY');
});

test('searchApis returns empty array when no S4 APIs match', async () => {
  mockSgnMap({});
  fetch.mockResolvedValue(makeListResponse([
    { Name: 'googleads', Title: 'Google Ads Bank', ServiceCode: 'REST', ShortText: 'Not S4', State: 'ACTIVE' },
  ]));
  const results = await searchApis('Bank');
  expect(results).toEqual([]);
});

test('searchApis degrades gracefully when map file is missing', async () => {
  fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_BANK_0003', Title: 'Bank', ServiceCode: 'ODATAV4', ShortText: 'Bank master data', State: 'ACTIVE' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Bank');
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('');
});

test('searchApis resolves sap-s4- prefixed map keys via normalization', async () => {
  mockSgnMap({ 'sap-s4-OP_BUDGETREQUESTDOCUMENT_0001-v1': { serviceGroupName: 'API_FNDSMGMTBUDGETREQUEST' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_BUDGETREQUESTDOCUMENT_0001', Title: 'Manage Budget Request', ServiceCode: 'ODATAV4', ShortText: 'Budget', State: 'ACTIVE' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Budget');
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('API_FNDSMGMTBUDGETREQUEST');
  expect(results[0].cleanCore).toBe(true);
});

// ── listByModule ───────────────────────────────────────────────────────────

test('listByModule FI returns S4 finance-related results', async () => {
  mockSgnMap({ 'OP_JOURNALENTRYBULKCREATIONREQUEST_IN': { serviceGroupName: 'API_JOURNALENTRY' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_JOURNALENTRYBULKCREATIONREQUEST_IN', Title: 'Journal Entry', ServiceCode: 'ODATAV4', ShortText: 'Post journal entries', State: 'ACTIVE' },
      { Name: 'some_non_s4', Title: 'GL Account External', ServiceCode: 'REST', ShortText: 'Third party', State: 'ACTIVE' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await listByModule('FI');
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].title).toBe('Journal Entry');
  expect(results[0].serviceGroupName).toBe('API_JOURNALENTRY');
});

test('listByModule throws for unknown module', async () => {
  await expect(listByModule('XX')).rejects.toThrow('不支持模块');
});

// ── getDetails ─────────────────────────────────────────────────────────────

test('getDetails returns exact match first', async () => {
  mockSgnMap({ 'OP_PURCHASEORDER_0001': { serviceGroupName: 'API_PURCHASEORDER_2' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_PURCHASEORDER_0001',  Title: 'Purchase Order',              ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders', State: 'ACTIVE' },
      { Name: 'OP_PURCHASEORDER_CONFIRM_0001', Title: 'Purchase Order Confirmation', ServiceCode: 'ODATAV4', ShortText: 'Confirm orders', State: 'ACTIVE' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const result = await getDetails('Purchase Order');
  expect(result.title).toBe('Purchase Order');
  expect(result.serviceGroupName).toBe('API_PURCHASEORDER_2');
});

test('getDetails throws when not found', async () => {
  mockSgnMap({});
  fetch.mockResolvedValue(makeListResponse([]));
  await expect(getDetails('Nonexistent API')).rejects.toThrow('未找到');
});

// ── HTTP error handling ────────────────────────────────────────────────────

test('searchApis throws on HTTP 401 from list endpoint', async () => {
  mockSgnMap({});
  fetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
  await expect(searchApis('Purchase')).rejects.toThrow('API Hub HTTP 401');
});
