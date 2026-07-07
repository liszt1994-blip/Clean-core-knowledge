jest.mock('@clean-core/shared/atc-xml-parser', () => ({
  parseAtcXml: jest.fn().mockResolvedValue({
    ZMY_PROG: [{ program: 'ZMY_PROG', objectType: 'PROG', line: '5', description: 'ATC violation' }],
    ZMY_PROG2: [{ program: 'ZMY_PROG2', objectType: 'PROG', line: '10', description: 'Another violation' }]
  })
}));

jest.mock('@clean-core/shared/claude-client', () => ({
  ClaudeClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn().mockResolvedValue(JSON.stringify({
      edges: [],
      sprints: [
        {
          sprintNumber: 1,
          items: [
            { program: 'ZMY_PROG', assignee: 'Dev 1', storyPoints: 3, violationCount: 1, dependencies: [], explanation: 'Fix' },
            { program: 'ZMY_PROG2', assignee: 'Dev 1', storyPoints: 3, violationCount: 1, dependencies: [], explanation: 'Fix' }
          ]
        }
      ]
    }))
  }))
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const cds = require('@sap/cds');
const supertest = require('supertest');

cds.test('.').in(__dirname + '/../..');

test('importAtcData returns sessionId for valid XML', async () => {
  const res = await supertest(cds.app)
    .post('/odata/v4/planner/importAtcData')
    .set('Content-Type', 'application/json')
    .send({ xmlContent: '<findings></findings>', tool2Json: '' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('sessionId');
  expect(res.body).toHaveProperty('programCount', 2);
});

test('importAtcData accepts tool2 JSON format', async () => {
  const tool2Json = JSON.stringify({
    ZMY_PROG: { replacementCode: 'REPORT z.', explanation: 'Fixed' }
  });
  const res = await supertest(cds.app)
    .post('/odata/v4/planner/importAtcData')
    .set('Content-Type', 'application/json')
    .send({ tool2Json, xmlContent: '' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('sessionId');
  expect(res.body.programCount).toBe(1);
});

test('importAtcData returns 400 for empty input', async () => {
  const res = await supertest(cds.app)
    .post('/odata/v4/planner/importAtcData')
    .set('Content-Type', 'application/json')
    .send({ xmlContent: '', tool2Json: '' });
  expect(res.status).toBe(400);
});

test('generatePlan returns planJson for valid session', async () => {
  // First import
  const importRes = await supertest(cds.app)
    .post('/odata/v4/planner/importAtcData')
    .set('Content-Type', 'application/json')
    .send({ xmlContent: '<findings></findings>', tool2Json: '' });
  expect(importRes.status).toBe(200);

  const { sessionId } = importRes.body;
  const teamConfig = JSON.stringify({ teamSize: 2, sprintDuration: 10, velocityPerDev: 8 });

  const planRes = await supertest(cds.app)
    .post('/odata/v4/planner/generatePlan')
    .set('Content-Type', 'application/json')
    .send({ sessionId, teamConfig });
  expect(planRes.status).toBe(200);
  expect(planRes.body).toHaveProperty('planJson');
  const plan = JSON.parse(planRes.body.planJson);
  expect(plan).toHaveProperty('sprints');
  expect(plan).toHaveProperty('summary');
});

test('generatePlan returns 404 for unknown sessionId', async () => {
  const res = await supertest(cds.app)
    .post('/odata/v4/planner/generatePlan')
    .set('Content-Type', 'application/json')
    .send({ sessionId: 'nonexistent', teamConfig: '{}' });
  expect(res.status).toBe(404);
});

test('updatePlan persists plan changes', async () => {
  // Import first
  const importRes = await supertest(cds.app)
    .post('/odata/v4/planner/importAtcData')
    .set('Content-Type', 'application/json')
    .send({ xmlContent: '<findings></findings>', tool2Json: '' });
  const { sessionId } = importRes.body;

  // Generate plan
  await supertest(cds.app)
    .post('/odata/v4/planner/generatePlan')
    .set('Content-Type', 'application/json')
    .send({ sessionId, teamConfig: '{}' });

  // Update plan
  const updatedPlan = JSON.stringify({
    sprints: [{ sprintNumber: 1, items: [] }],
    summary: { totalPrograms: 0, totalSprints: 1, estimatedWeeks: 1 }
  });
  const updateRes = await supertest(cds.app)
    .post('/odata/v4/planner/updatePlan')
    .set('Content-Type', 'application/json')
    .send({ sessionId, planJson: updatedPlan });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.status).toBe('updated');
});
