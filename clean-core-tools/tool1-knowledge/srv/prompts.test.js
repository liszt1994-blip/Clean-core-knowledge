const { SYSTEM_PROMPT, buildExplainPrompt, buildClassifyPrompt, buildRecommendPrompt } = require('./prompts');

test('SYSTEM_PROMPT contains Clean Core tier definitions', () => {
  expect(SYSTEM_PROMPT).toMatch(/Tier 1/);
  expect(SYSTEM_PROMPT).toMatch(/Tier 2/);
  expect(SYSTEM_PROMPT).toMatch(/Clean Core/);
});

test('buildExplainPrompt includes the term', () => {
  const p = buildExplainPrompt('RAP');
  expect(p).toMatch(/RAP/);
});

test('buildClassifyPrompt includes all object names and requests JSON', () => {
  const p = buildClassifyPrompt(['BAPI_MATERIAL_SAVEDATA', 'SE16']);
  expect(p).toMatch(/BAPI_MATERIAL_SAVEDATA/);
  expect(p).toMatch(/SE16/);
  expect(p).toMatch(/JSON/);
});

test('buildRecommendPrompt includes deprecated object and requests JSON', () => {
  const p = buildRecommendPrompt('BAPI_MATERIAL_SAVEDATA');
  expect(p).toMatch(/BAPI_MATERIAL_SAVEDATA/);
  expect(p).toMatch(/JSON/);
});
