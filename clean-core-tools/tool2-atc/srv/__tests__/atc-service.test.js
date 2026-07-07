// Mock all external dependencies
jest.mock('@clean-core/shared/atc-xml-parser', () => ({
  parseAtcXml: jest.fn().mockResolvedValue({
    ZMY_PROGRAM: [{ program: 'ZMY_PROGRAM', objectType: 'PROG', line: '10', description: 'Test violation' }]
  })
}));

jest.mock('../react-agent', () => ({
  runReActAgent: jest.fn().mockResolvedValue({ replacementCode: 'REPORT z.', explanation: 'Fixed.' })
}));

jest.mock('@clean-core/shared/claude-client', () => ({
  ClaudeClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn().mockResolvedValue(JSON.stringify({ fixedCode: 'REPORT z.' }))
  }))
}));

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ADT_BASE_URL = 'https://test';
process.env.ADT_USERNAME = 'u';
process.env.ADT_PASSWORD = 'p';

const cds = require('@sap/cds');
const supertest = require('supertest');

cds.test('.').in(__dirname + '/../..');

test('POST uploadAtc returns jobId for valid XML', async () => {
  const res = await supertest(cds.app)
    .post('/odata/v4/atc/uploadAtc')
    .set('Content-Type', 'application/json')
    .send({ xmlContent: '<findings><finding program="Z" object="Z" objectType="PROG" line="1" column="1" checkId="X" messageId="Y" description="test"></finding></findings>' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('jobId');
});

test('POST uploadAtc returns 400 for empty xmlContent', async () => {
  const res = await supertest(cds.app)
    .post('/odata/v4/atc/uploadAtc')
    .set('Content-Type', 'application/json')
    .send({});
  expect(res.status).toBe(400);
});

test('POST confirmFixes returns 404 for unknown jobId', async () => {
  const res = await supertest(cds.app)
    .post('/odata/v4/atc/confirmFixes')
    .set('Content-Type', 'application/json')
    .send({ jobId: 'nonexistent', transportRequest: 'DEVK900001', confirmedPrograms: [] });
  expect(res.status).toBe(404);
});
