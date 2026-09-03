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

describe('Tab 4 BTP prompt builders', () => {
  const {
    buildBtpAnswerPrompt,
    buildBtpGuidePrompt,
    buildBtpIntentPrompt,
    buildBtpServicePrompt,
    buildBtpMcpAnswerPrompt,
  } = require('./prompts');

  test('buildBtpIntentPrompt includes query and the three intents', () => {
    const p = buildBtpIntentPrompt('如何开发一个采购应用');
    expect(p).toMatch(/如何开发一个采购应用/);
    expect(p).toMatch(/service/);
    expect(p).toMatch(/guide/);
    expect(p).toMatch(/general/);
    expect(p).toMatch(/JSON/);
  });

  test('buildBtpAnswerPrompt embeds query and numbered search snippets', () => {
    const results = [
      { title: 'Cloud Foundry Env', url: 'https://help.sap.com/x', summary: 'CF runtime' },
    ];
    const p = buildBtpAnswerPrompt('BTP 有哪些运行时', results);
    expect(p).toMatch(/BTP 有哪些运行时/);
    expect(p).toMatch(/Cloud Foundry Env/);
    expect(p).toMatch(/help\.sap\.com/);
  });

  test('buildBtpAnswerPrompt handles empty search results', () => {
    const p = buildBtpAnswerPrompt('随便问', []);
    expect(p).toMatch(/随便问/);
    expect(p).toMatch(/未找到相关片段/);
  });

  test('buildBtpGuidePrompt includes domain label, scenario and API list', () => {
    const apis = [
      { name: 'Purchase Order API', protocol: 'OData V2', description: '采购订单', endpoint: '/po', keyEntities: ['A_PurchaseOrder'], url: 'https://api.sap.com/po', deprecated: false },
    ];
    const p = buildBtpGuidePrompt('procurement', '搭建采购审批应用', apis);
    expect(p).toMatch(/采购/);
    expect(p).toMatch(/搭建采购审批应用/);
    expect(p).toMatch(/Purchase Order API/);
  });

  test('buildBtpGuidePrompt flags deprecated APIs with successor', () => {
    const apis = [
      { name: 'Legacy PO', protocol: 'OData V2', description: '旧接口', endpoint: '/old', keyEntities: [], url: 'https://api.sap.com/old', deprecated: true, successor: 'API_PURCHASEORDER_PROCESS_SRV' },
    ];
    const p = buildBtpGuidePrompt('procurement', '场景', apis);
    expect(p).toMatch(/DEPRECATED/);
    expect(p).toMatch(/API_PURCHASEORDER_PROCESS_SRV/);
  });

  test('buildBtpGuidePrompt appends grounding context when provided', () => {
    const p = buildBtpGuidePrompt('sales', '销售场景', [], '这是官方文档检索内容');
    expect(p).toMatch(/这是官方文档检索内容/);
  });

  test('buildBtpServicePrompt lists services grouped when more than 5', () => {
    const services = Array.from({ length: 6 }, (_, i) => ({
      id: 's' + i, name: 'Service' + i, description: 'desc' + i, category: 'AI',
    }));
    const p = buildBtpServicePrompt('有哪些 AI 服务', services, {});
    expect(p).toMatch(/有哪些 AI 服务/);
    expect(p).toMatch(/Service0/);
    expect(p).toMatch(/### AI/);
  });

  test('buildBtpServicePrompt shows pricing detail for a specific service', () => {
    const services = [{ id: 's1', name: 'AI Core', description: 'AI 服务', category: 'AI' }];
    const detailsMap = {
      s1: {
        pricing: [{ planName: 'Standard', commercialModels: [{ pricePerUnit: '0.5', metric: 'per call' }] }],
        resources: { documentation: [{ url: 'https://help.sap.com/ai-core' }] },
      },
    };
    const p = buildBtpServicePrompt('AI Core 怎么收费', services, detailsMap);
    expect(p).toMatch(/AI Core 怎么收费/);
    expect(p).toMatch(/Standard/);
    expect(p).toMatch(/help\.sap\.com\/ai-core/);
  });

  test('buildBtpMcpAnswerPrompt includes query and doc snippets', () => {
    const results = [{ title: 'BTP Doc', snippet: '文档片段', url: 'https://help.sap.com/btp' }];
    const p = buildBtpMcpAnswerPrompt('BTP 是什么', results);
    expect(p).toMatch(/BTP 是什么/);
    expect(p).toMatch(/BTP Doc/);
    expect(p).toMatch(/文档片段/);
  });
});
