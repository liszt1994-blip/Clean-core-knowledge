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

// Construct an APIContent.APIs list response
function makeListResponse(items) {
  return new Response(JSON.stringify({ d: { results: items } }), { status: 200 });
}

// ── searchApis ────────────────────────────────────────────────────────────

test('searchApis returns matching results with serviceGroupName from local map', async () => {
  mockSgnMap({ 'OP_PURCHASEORDER_PROCESS_SRV': { serviceGroupName: 'API_PURCHASEORDER_PROCESS' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_PURCHASEORDER_PROCESS_SRV', Title: 'Purchase Order', ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

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

test('searchApis returns empty serviceGroupName when id not in map', async () => {
  mockSgnMap({});
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_BANK_0003', Title: 'Bank', ServiceCode: 'ODATAV4', ShortText: 'Bank master data' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Bank', 20);
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('');
  expect(results[0].id).toBe('OP_BANK_0003');
});

test('searchApis throws when API_HUB_KEY not set', async () => {
  delete process.env.API_HUB_KEY;
  await expect(searchApis('Purchase')).rejects.toThrow('API_HUB_KEY');
});

test('searchApis returns empty array when no match', async () => {
  mockSgnMap({});
  fetch.mockResolvedValue(makeListResponse([]));
  const results = await searchApis('zzznomatch');
  expect(results).toEqual([]);
});

test('searchApis degrades gracefully when map file is missing', async () => {
  fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_BANK_0003', Title: 'Bank', ServiceCode: 'ODATAV4', ShortText: 'Bank master data' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const results = await searchApis('Bank', 20);
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('');
});

// ── listByModule ───────────────────────────────────────────────────────────

test('listByModule FI returns finance-related results with serviceGroupName', async () => {
  mockSgnMap({ 'OP_JOURNALENTRY_SRV': { serviceGroupName: 'API_JOURNALENTRY' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_JOURNALENTRY_SRV', Title: 'Journal Entry', ServiceCode: 'ODATAV4', ShortText: 'Post journal entries' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

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
  mockSgnMap({ 'OP_PURCHASEORDER_PROCESS_SRV': { serviceGroupName: 'API_PURCHASEORDER_PROCESS' } });
  fetch
    .mockResolvedValueOnce(makeListResponse([
      { Name: 'OP_PURCHASEORDER_PROCESS_SRV',  Title: 'Purchase Order',              ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders' },
      { Name: 'OP_PURCHASEORDER_CONFIRM_SRV',  Title: 'Purchase Order Confirmation', ServiceCode: 'ODATAV4', ShortText: 'Confirm orders' },
    ]))
    .mockResolvedValueOnce(makeListResponse([]));

  const result = await getDetails('Purchase Order');
  expect(result.title).toBe('Purchase Order');
  expect(result.serviceGroupName).toBe('API_PURCHASEORDER_PROCESS');
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
