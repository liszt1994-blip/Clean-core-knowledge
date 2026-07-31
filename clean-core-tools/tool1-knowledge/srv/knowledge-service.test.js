// Mock AICoreClient to avoid real SAP AI Core API calls in tests
jest.mock('../src/aicore-client', () => ({
  CLEAN_CORE_SYSTEM_PROMPT: 'mock-system-prompt',
  AICoreClient: jest.fn().mockImplementation(() => {
    const mockComplete = jest.fn().mockImplementation((systemPrompt, userContent) => {
      if (userContent && userContent.includes('"intent"')) {
        return Promise.resolve('{"intent":"code"}');
      }
      if (userContent && userContent.includes('callType')) {
        // buildAnalyzeCodePrompt
        return Promise.resolve(
          '[{"objectName":"BAPI_MATERIAL_SAVEDATA","line":1,"callType":"CALL FUNCTION"}]'
        );
      }
      if (userContent && userContent.includes('errorCode')) {
        // buildAnalyzeAtcPrompt
        return Promise.resolve(
          '[{"objectName":"SE16","errorCode":"SLIN_OBSOLETE","line":5,"message":"Object not released"}]'
        );
      }
      if (userContent && userContent.includes('original') && userContent.includes('rewritten') && userContent.includes('abap')) {
        // buildRewriteCodePrompt
        return Promise.resolve(
          '{"original":"CALL FUNCTION \'BAPI_MATERIAL_SAVEDATA\'.","rewritten":"* Clean Core: replaced\\nDATA lo_mat TYPE REF TO cl_material."}'
        );
      }
      if (userContent && userContent.includes('migrationNote')) {
        // buildMigrationNotePrompt path (recommend with known successors)
        return Promise.resolve(
          '[{"replacementName":"I_MATERIAL","type":"CDS View","migrationNote":"Use CDS View I_MATERIAL instead.","source":"official-json+ai-note"}]'
        );
      }
      if (userContent && userContent.includes('replacementName')) {
        // buildRecommendPrompt path (full AI recommend, no JSON data)
        return Promise.resolve(
          '[{"replacementName":"I_MATERIAL","type":"CDS View","migrationNote":"Migrate to I_MATERIAL CDS View.","source":"ai-inference"}]'
        );
      }
      if (userContent && userContent.includes('effortEstimate')) {
        // buildPlanPrompt
        return Promise.resolve(
          JSON.stringify({
            objectName: 'BAPI_MATERIAL_SAVEDATA',
            replacement: 'I_MaterialDocument',
            replacementType: 'OData API',
            riskLevel: '中',
            effortEstimate: '3-5 天',
            steps: JSON.stringify([
              { step: 1, description: '识别所有调用点，使用 where-used list 查找所有 CALL FUNCTION 语句' },
              { step: 2, description: '替换为 OData API I_MaterialDocument，调整字段映射' },
              { step: 3, description: '执行回归测试，验证业务逻辑一致性' },
            ]),
            codeExample: "\" 旧代码\nCALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'\n  EXPORTING material = lv_matnr.\n\n\" 新代码（OData API）\n\" 通过 HTTP Client 调用 I_MaterialDocument OData API",
            summary: '将 BAPI_MATERIAL_SAVEDATA 迁移至 OData API I_MaterialDocument，降低 Clean Core 违规风险。',
          })
        );
      }
      // Default: classify fallback + explain
      return Promise.resolve(
        '[{"objectName":"SE16","tier":"C","state":"classicAPI","explanation":"Classic transaction.","recommendation":"Use CDS View instead.","source":"ai-inference"}]'
      );
    });
    return {
      complete: mockComplete,
      // completeWithGrounding(systemPrompt, userContent, collectionId, maxTokens)
      // delegate to same mock — collectionId arg is ignored
      completeWithGrounding: (systemPrompt, userContent) => mockComplete(systemPrompt, userContent),
    };
  }),
}));

jest.mock('../src/apihub-client', () => ({
  searchApis: jest.fn().mockResolvedValue([
    { name: 'API_PURCHASEORDER_PROCESS_SRV', displayName: 'Purchase Order', apiType: 'OData', description: 'Process PO' }
  ]),
  listByModule: jest.fn().mockResolvedValue([
    { name: 'API_JOURNALENTRY_SRV', displayName: 'Journal Entry', apiType: 'OData', description: 'Post JE' }
  ]),
}));

// Provide minimal VCAP_SERVICES so AICoreClient constructor doesn't throw
// (the mock above replaces the class, but CDS may still load env at bootstrap)
process.env.VCAP_SERVICES = JSON.stringify({
  aicore: [{ credentials: { clientid: 'test', clientsecret: 'test', url: 'https://test.example.com', serviceurls: { AI_API_URL: 'https://api.test.example.com' } } }],
});

const cds = require('@sap/cds');
const supertest = require('supertest');

// CAP test helper auto-registers beforeAll/afterAll with Jest
cds.test('.').in(__dirname + '/..');

test('POST /odata/v4/knowledge/explain returns 400 without term', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/explain')
    .set('Content-Type', 'application/json')
    .send({});
  expect(res.status).toBe(400);
});

test('POST /odata/v4/knowledge/classify returns classification array', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/classify')
    .set('Content-Type', 'application/json')
    .send({ objects: ['SE16'] });
  expect(res.status).toBe(200);
  const body = res.body.value;
  expect(body[0].objectName).toBe('SE16');
  expect(body[0].tier).toBe('C');
});

test('POST /odata/v4/knowledge/recommend returns recommendation array', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/recommend')
    .set('Content-Type', 'application/json')
    .send({ deprecatedObject: 'BAPI_MATERIAL_SAVEDATA' });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThan(0);
  expect(body[0]).toHaveProperty('replacementName');
  expect(body[0]).toHaveProperty('migrationNote');
});

test('GET /stream/explain streams SSE chunks', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .get('/stream/explain?term=RAP')
    .set('Accept', 'text/event-stream');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  expect(res.text).toContain('data:');
});

test('POST /odata/v4/knowledge/analyzeCode returns violations array', async () => {
  const app = cds.app;
  const code = `CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'\n  EXPORTING material = lv_matnr.`;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/analyzeCode')
    .set('Content-Type', 'application/json')
    .send({ code });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(Array.isArray(body)).toBe(true);
});

test('POST /odata/v4/knowledge/analyzeCode returns 400 without code', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/analyzeCode')
    .set('Content-Type', 'application/json')
    .send({});
  expect(res.status).toBe(400);
});

test('POST /odata/v4/knowledge/analyzeAtc returns violations array', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/analyzeAtc')
    .set('Content-Type', 'application/json')
    .send({ atcOutput: 'SLIN_OBSOLETE: SE16 at line 5 - Object not released' });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(Array.isArray(body)).toBe(true);
});

test('POST /odata/v4/knowledge/analyzeAtc returns 400 without atcOutput', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/analyzeAtc')
    .set('Content-Type', 'application/json')
    .send({});
  expect(res.status).toBe(400);
});

test('POST /odata/v4/knowledge/rewriteCode returns original and rewritten', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/rewriteCode')
    .set('Content-Type', 'application/json')
    .send({
      code: `CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'.`,
      violations: [{ objectName: 'BAPI_MATERIAL_SAVEDATA', replacement: 'I_MATERIAL', replacementType: 'CDS View' }],
    });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(body).toHaveProperty('original');
  expect(body).toHaveProperty('rewritten');
});

test('POST /odata/v4/knowledge/rewriteCode returns 400 without code', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/rewriteCode')
    .set('Content-Type', 'application/json')
    .send({ violations: [] });
  expect(res.status).toBe(400);
});

test('POST /odata/v4/knowledge/chat returns a ChatReply with correct shape', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/chat')
    .set('Content-Type', 'application/json')
    .send({ message: 'What is RAP?', mode: 'auto', history: [] });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(body).toHaveProperty('replyType');
  expect(body).toHaveProperty('text');
  // violations and notes are JSON strings (CDS flattened return type)
  expect(typeof body.violations).toBe('string');
  expect(typeof body.notes).toBe('string');
});

test('POST /odata/v4/knowledge/chat returns 400 without message', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/chat')
    .set('Content-Type', 'application/json')
    .send({ mode: 'auto', history: [] });
  expect(res.status).toBe(400);
});

test('POST /odata/v4/knowledge/plan returns plan with correct shape', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/plan')
    .set('Content-Type', 'application/json')
    .send({ objectName: 'BAPI_MATERIAL_SAVEDATA' });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(body).toHaveProperty('replacement');
  expect(body).toHaveProperty('riskLevel');
  expect(body).toHaveProperty('effortEstimate');
  expect(body).toHaveProperty('steps');
  expect(body).toHaveProperty('codeExample');
  expect(body).toHaveProperty('summary');
});

test('POST /odata/v4/knowledge/plan returns 400 without objectName', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/plan')
    .set('Content-Type', 'application/json')
    .send({});
  expect(res.status).toBe(400);
});

describe('searchApiHub', () => {
  test('keyword search returns results', async () => {
    const app = cds.app;
    const res = await supertest(app)
      .post('/odata/v4/knowledge/searchApiHub')
      .set('Content-Type', 'application/json')
      .send({ query: 'Purchase', module: '' });
    expect(res.status).toBe(200);
    const body = res.body.value || res.body;
    expect(body[0].displayName).toBe('Purchase Order');
  });

  test('module browse returns results', async () => {
    const app = cds.app;
    const res = await supertest(app)
      .post('/odata/v4/knowledge/searchApiHub')
      .set('Content-Type', 'application/json')
      .send({ query: '', module: 'FI' });
    expect(res.status).toBe(200);
    const body = res.body.value || res.body;
    expect(body[0].displayName).toBe('Journal Entry');
  });

  test('returns 400 when both query and module empty', async () => {
    const app = cds.app;
    const res = await supertest(app)
      .post('/odata/v4/knowledge/searchApiHub')
      .set('Content-Type', 'application/json')
      .send({ query: '', module: '' });
    expect(res.status).toBe(400);
  });
});

// ── analyzeCds ─────────────────────────────────────────────────────────────

jest.mock('../src/cds-graph-data', () => ({
  buildGraph: jest.fn((viewName) => {
    if (viewName === 'I_SalesOrder') {
      return {
        nodes: [
          { id: 'I_SalesOrder', type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1', depth: 0 },
          { id: 'I_SalesOrderItem', type: 'CDS View', releaseState: 'Released', cleanCore: true, classification: 'C1', depth: 1 },
        ],
        edges: [
          { source: 'I_SalesOrder', target: 'I_SalesOrderItem', relation: 'association' },
        ],
      };
    }
    return null;
  }),
}));

describe('analyzeCds', () => {
  test('returns graph data for known view', async () => {
    const app = cds.app;
    const res = await supertest(app)
      .post('/odata/v4/knowledge/analyzeCds')
      .set('Content-Type', 'application/json')
      .send({ viewName: 'I_SalesOrder' });
    expect(res.status).toBe(200);
    const body = res.body.value || res.body;
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(body.nodes[0].id).toBe('I_SalesOrder');
  });

  test('returns 404 for unknown view', async () => {
    const app = cds.app;
    const res = await supertest(app)
      .post('/odata/v4/knowledge/analyzeCds')
      .set('Content-Type', 'application/json')
      .send({ viewName: 'UNKNOWN_VIEW' });
    expect(res.status).toBe(404);
  });

  test('returns 400 for empty viewName', async () => {
    const app = cds.app;
    const res = await supertest(app)
      .post('/odata/v4/knowledge/analyzeCds')
      .set('Content-Type', 'application/json')
      .send({ viewName: '' });
    expect(res.status).toBe(400);
  });
});
