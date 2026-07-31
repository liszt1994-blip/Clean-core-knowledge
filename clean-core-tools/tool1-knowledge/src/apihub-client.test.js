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

// ── HTTP error handling ────────────────────────────────────────────────────

test('searchApis throws on HTTP 401', async () => {
  fetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
  await expect(searchApis('Purchase')).rejects.toThrow('API Hub HTTP 401');
});
