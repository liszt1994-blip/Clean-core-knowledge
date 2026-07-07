// Mock AICoreClient to avoid real SAP AI Core API calls in tests
jest.mock('../src/aicore-client', () => ({
  CLEAN_CORE_SYSTEM_PROMPT: 'mock-system-prompt',
  AICoreClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn().mockImplementation((systemPrompt, userContent) => {
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
      // Default: classify fallback + explain
      return Promise.resolve(
        '[{"objectName":"SE16","tier":"C","state":"classicAPI","explanation":"Classic transaction.","recommendation":"Use CDS View instead.","source":"ai-inference"}]'
      );
    }),
  })),
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
