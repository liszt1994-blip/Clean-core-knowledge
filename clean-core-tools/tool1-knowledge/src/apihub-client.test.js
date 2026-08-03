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
  fetch.mockImplementation((url) => {
    if (url.includes('/$value')) {
      // spec 接口请求
      return makeSpecResponse('API_PURCHASEORDER_PROCESS');
    } else if (url.includes('APIContent.APIs')) {
      // 列表接口请求
      if (url.includes('$skip=0')) {
        return makeListResponse([
          { Name: 'OP_PURCHASEORDER_PROCESS_SRV', Title: 'Purchase Order', ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders' },
        ]);
      } else if (url.includes('$skip=50')) {
        return makeListResponse([]);
      }
    }
    return new Response('error', { status: 500 });
  });

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
  fetch.mockImplementation(() => makeListResponse([]));
  const results = await searchApis('zzznomatch');
  expect(results).toEqual([]);
});

test('searchApis degrades gracefully when spec fetch fails', async () => {
  fetch.mockImplementation((url) => {
    if (url.includes('/$value')) {
      // spec 接口失败
      return new Response('error', { status: 500 });
    } else if (url.includes('APIContent.APIs')) {
      if (url.includes('$skip=0')) {
        return makeListResponse([
          { Name: 'OP_BANK_0003', Title: 'Bank', ServiceCode: 'ODATAV4', ShortText: 'Bank master data' },
        ]);
      } else if (url.includes('$skip=50')) {
        return makeListResponse([]);
      }
    }
    return new Response('error', { status: 500 });
  });

  const results = await searchApis('Bank', 20);
  expect(results).toHaveLength(1);
  expect(results[0].serviceGroupName).toBe('');
  expect(results[0].id).toBe('OP_BANK_0003');
});

// ── listByModule ───────────────────────────────────────────────────────────

test('listByModule FI returns finance-related results with serviceGroupName', async () => {
  fetch.mockImplementation((url) => {
    if (url.includes('/$value')) {
      return makeSpecResponse('API_JOURNALENTRY');
    } else if (url.includes('APIContent.APIs')) {
      if (url.includes('$skip=0')) {
        return makeListResponse([
          { Name: 'OP_JOURNALENTRY_SRV', Title: 'Journal Entry', ServiceCode: 'ODATAV4', ShortText: 'Post journal entries' },
        ]);
      } else if (url.includes('$skip=50')) {
        return makeListResponse([]);
      }
    }
    return new Response('error', { status: 500 });
  });

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
  fetch.mockImplementation((url) => {
    if (url.includes('/$value')) {
      return makeSpecResponse('API_PURCHASEORDER_PROCESS');
    } else if (url.includes('APIContent.APIs')) {
      if (url.includes('$skip=0')) {
        return makeListResponse([
          { Name: 'OP_PURCHASEORDER_PROCESS_SRV',  Title: 'Purchase Order',              ServiceCode: 'ODATAV4', ShortText: 'Process purchase orders' },
          { Name: 'OP_PURCHASEORDER_CONFIRM_SRV',  Title: 'Purchase Order Confirmation', ServiceCode: 'ODATAV4', ShortText: 'Confirm orders' },
        ]);
      } else if (url.includes('$skip=50')) {
        return makeListResponse([]);
      }
    }
    return new Response('error', { status: 500 });
  });

  const result = await getDetails('Purchase Order');
  expect(result.title).toBe('Purchase Order');
  expect(result.serviceGroupName).toBe('API_PURCHASEORDER_PROCESS');
});

test('getDetails throws when not found', async () => {
  fetch.mockImplementation(() => makeListResponse([]));
  await expect(getDetails('Nonexistent API')).rejects.toThrow('未找到');
});

// ── HTTP error handling ────────────────────────────────────────────────────

test('searchApis throws on HTTP 401 from list endpoint', async () => {
  fetch.mockImplementation(() => new Response('Unauthorized', { status: 401 }));
  await expect(searchApis('Purchase')).rejects.toThrow('API Hub HTTP 401');
});

