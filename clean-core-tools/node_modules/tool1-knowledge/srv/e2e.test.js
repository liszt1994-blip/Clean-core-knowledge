const runE2E = process.env.RUN_E2E === 'true';
const maybeDescribe = runE2E ? describe : describe.skip;

maybeDescribe('E2E: real Claude API calls', () => {
  const cds = require('@sap/cds/lib');
  const supertest = require('supertest');

  cds.test('.').in(__dirname + '/..');

  test('explain RAP returns non-empty text', async () => {
    const res = await supertest(cds.app)
      .post('/odata/v4/knowledge/explain')
      .send({ term: 'RAP' });
    expect(res.status).toBe(200);
    expect(res.body.value.length).toBeGreaterThan(50);
  }, 30000);

  test('classify SE16 returns tier C or D', async () => {
    const res = await supertest(cds.app)
      .post('/odata/v4/knowledge/classify')
      .send({ objects: ['SE16'] });
    expect(res.status).toBe(200);
    const result = res.body.value[0];
    expect(['C', 'D']).toContain(result.tier);
  }, 30000);
});
