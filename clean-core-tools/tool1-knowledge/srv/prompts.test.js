const { SYSTEM_PROMPT, buildExplainPrompt, buildClassifyPrompt, buildRecommendPrompt, buildIntentPrompt, buildAnalyzeCodePrompt, buildAnalyzeAtcPrompt, buildRewriteCodePrompt } = require('./prompts');

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

describe('Agent chat prompt builders', () => {
  const { buildIntentPrompt, buildAnalyzeCodePrompt, buildAnalyzeAtcPrompt, buildRewriteCodePrompt } = require('./prompts');

  test('buildIntentPrompt includes user message and valid intent list', () => {
    const p = buildIntentPrompt('CALL FUNCTION "BAPI_MATERIAL_SAVEDATA"', 'auto');
    expect(p).toMatch(/BAPI_MATERIAL_SAVEDATA/);
    expect(p).toMatch(/code/);
    expect(p).toMatch(/atc/);
    expect(p).toMatch(/explain/);
  });

  test('buildIntentPrompt skips detection hint when mode is not auto', () => {
    const p = buildIntentPrompt('some text', 'code');
    expect(p).toMatch(/some text/);
  });

  test('buildAnalyzeCodePrompt includes the code and requests JSON', () => {
    const p = buildAnalyzeCodePrompt('CALL FUNCTION "SE16".');
    expect(p).toMatch(/SE16/);
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/objectName/);
    expect(p).toMatch(/line/);
  });

  test('buildAnalyzeAtcPrompt includes ATC text and requests JSON', () => {
    const p = buildAnalyzeAtcPrompt('Error: SLIN_OBSOLETE at SE16 line 5');
    expect(p).toMatch(/SLIN_OBSOLETE/);
    expect(p).toMatch(/errorCode/);
    expect(p).toMatch(/JSON/);
  });

  test('buildRewriteCodePrompt includes code and violations', () => {
    const violations = [{ objectName: 'BAPI_MATERIAL_SAVEDATA', replacement: 'I_MATERIAL', replacementType: 'CDS View' }];
    const p = buildRewriteCodePrompt('CALL FUNCTION "BAPI_MATERIAL_SAVEDATA".', violations);
    expect(p).toMatch(/BAPI_MATERIAL_SAVEDATA/);
    expect(p).toMatch(/I_MATERIAL/);
    expect(p).toMatch(/original/);
    expect(p).toMatch(/rewritten/);
  });
});
