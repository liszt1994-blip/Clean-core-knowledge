# Feature 6 — 迁移路径规划 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在对象分类 Tab 的每个结果卡片上新增"迁移规划"按钮，点击后展示完整迁移计划（替代方案、分步说明、风险评估、工作量预估、代码示例），并支持导出 PDF。

**Architecture:** 后端新增 `plan` CDS action，调用 AI Core 生成结构化 JSON 迁移计划；前端在分类结果卡片底部新增按钮，响应后展开 Panel 展示内容；PDF 导出使用 iframe + `window.print()` 实现。

**Tech Stack:** SAP CAP (CDS + Node.js), SAP UI5, SAP AI Core Orchestration API

---

## 文件改动清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `srv/knowledge-service.cds` | 修改 | 新增 `plan` action 定义 |
| `srv/prompts.js` | 修改 | 新增 `buildPlanPrompt()` 函数 |
| `srv/knowledge-service.js` | 修改 | 新增 `plan` handler |
| `srv/knowledge-service.test.js` | 修改 | 新增 `plan` 相关测试 + mock |
| `app/knowledge/webapp/controller/App.controller.js` | 修改 | 新增迁移规划按钮、Panel、PDF 导出逻辑 |

---

## Task 1: 更新 mock，新增 plan action 测试

**Files:**
- Modify: `srv/knowledge-service.test.js`

- [ ] **Step 1: 在 mock 的 `mockComplete` 函数中新增 plan 分支**

打开 `srv/knowledge-service.test.js`，在现有的 `if/else if` 链中，在最后的 `// Default` 注释之前新增：

```js
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
```

- [ ] **Step 2: 新增 plan 返回正确结构的测试**

在文件末尾（最后一个 `test(...)` 之后）新增：

```js
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
```

- [ ] **Step 3: 运行测试，确认新测试失败（因为 plan action 还未实现）**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm test -- --testPathPattern=knowledge-service.test
```

预期：2 个新测试 FAIL（`plan` action 不存在），其余测试 PASS。

---

## Task 2: 新增 CDS action 定义

**Files:**
- Modify: `srv/knowledge-service.cds`

- [ ] **Step 1: 在 `knowledge-service.cds` 末尾（`}` 之前）新增 plan action**

找到文件中 `rewriteCode` action 结束的 `};` 后，在最后的 `}` 之前插入：

```cds
  action plan(objectName : String) returns {
    objectName      : String;
    replacement     : String;
    replacementType : String;
    riskLevel       : String;
    effortEstimate  : String;
    steps           : String;
    codeExample     : String;
    summary         : String;
  };
```

- [ ] **Step 2: 验证 CDS 语法**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx cds compile srv/knowledge-service.cds --to json > /dev/null && echo "CDS OK"
```

预期：输出 `CDS OK`，无错误。

---

## Task 3: 新增 prompt 函数

**Files:**
- Modify: `srv/prompts.js`

- [ ] **Step 1: 在 `prompts.js` 末尾（`module.exports` 之前）新增 `buildPlanPrompt`**

```js
// ── Feature 6: Migration Path Planning ────────────────────────────────────
function buildPlanPrompt(objectName) {
  return (
    `For the SAP object "${objectName}", generate a detailed Clean Core migration plan.\n\n` +
    `Return ONLY a valid JSON object with no markdown fences and no extra text. The object must have exactly these fields:\n` +
    `- objectName      (string: the input object name)\n` +
    `- replacement     (string: the recommended Clean Core replacement name)\n` +
    `- replacementType (string: one of OData API, RAP BO, CDS View, Released FM, Released BAdI, Key User Extension, Side-by-Side BTP)\n` +
    `- riskLevel       (string: "低" | "中" | "高" — migration complexity risk)\n` +
    `- effortEstimate  (string: estimated effort, e.g. "2-3 天", "1 周")\n` +
    `- steps           (string: a JSON array string, each element has { "step": number, "description": string })\n` +
    `- codeExample     (string: ABAP code snippet showing old API usage → new API usage, with comments in Chinese)\n` +
    `- summary         (string: one sentence summarizing the migration in Chinese)\n\n` +
    `Rules:\n` +
    `- steps must contain 3-5 concrete, actionable migration steps\n` +
    `- codeExample must show real ABAP syntax for both old and new approach\n` +
    `- All text fields (riskLevel, summary, step descriptions) must be in Chinese\n` +
    `- The steps field value must itself be a valid JSON array serialized as a string`
  );
}
```

- [ ] **Step 2: 将 `buildPlanPrompt` 加入 `module.exports`**

找到文件末尾的 `module.exports = {` 块，加入 `buildPlanPrompt`：

```js
module.exports = {
  SYSTEM_PROMPT,
  buildExplainPrompt,
  buildClassifyPrompt,
  buildSingleClassifyPrompt,
  buildMigrationNotePrompt,
  buildRecommendPrompt,
  buildTranslateQueryPrompt,
  buildRerankPrompt,
  buildNoteSummaryFromContentPrompt,
  buildAnalyzeCodePrompt,
  buildAnalyzeAtcPrompt,
  buildIntentPrompt,
  buildRewriteCodePrompt,
  buildExtractObjectsPrompt,
  buildPlanPrompt,
};
```

---

## Task 4: 新增 plan handler

**Files:**
- Modify: `srv/knowledge-service.js`

- [ ] **Step 1: 在 `knowledge-service.js` 顶部 import 中加入 `buildPlanPrompt`**

找到现有的 destructuring import：

```js
const {
  buildExplainPrompt,
  // ... 其他 prompt 函数
  buildExtractObjectsPrompt,
} = require('./prompts');
```

在 `buildExtractObjectsPrompt,` 之后加入：

```js
  buildPlanPrompt,
```

- [ ] **Step 2: 在 `rewriteCode` handler 之后新增 `plan` handler**

找到 `rewriteCode` handler 的结束 `});`，在其后新增：

```js
  // ── Feature 6: Migration Path Planning ────────────────────────────────────
  srv.on('plan', async (req) => {
    const { objectName } = req.data;
    if (!objectName || !objectName.trim()) {
      return req.error(400, 'objectName is required');
    }

    const raw = await aiComplete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildPlanPrompt(objectName.trim().toUpperCase()),
      3000
    );

    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (e) {
      console.error('[plan] AI returned non-JSON:', raw);
      return req.error(500, 'AI returned invalid plan format');
    }

    return {
      objectName:      parsed.objectName      || objectName,
      replacement:     parsed.replacement     || '',
      replacementType: parsed.replacementType || '',
      riskLevel:       parsed.riskLevel       || '未知',
      effortEstimate:  parsed.effortEstimate  || '未知',
      steps:           typeof parsed.steps === 'string' ? parsed.steps : JSON.stringify(parsed.steps || []),
      codeExample:     parsed.codeExample     || '',
      summary:         parsed.summary         || '',
    };
  });
```

- [ ] **Step 3: 运行测试，确认 plan 测试通过**

```bash
npm test -- --testPathPattern=knowledge-service.test
```

预期：所有测试 PASS（包括 Task 1 新增的 2 个 plan 测试）。

- [ ] **Step 4: Commit**

```bash
git add srv/knowledge-service.cds srv/prompts.js srv/knowledge-service.js srv/knowledge-service.test.js
git commit -m "feat: add plan action for migration path planning (Feature 6)"
```

---

## Task 5: 前端 — 分类卡片新增"迁移规划"按钮和 Panel

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 找到 `_buildClassifyResultItem` 方法**

在 `App.controller.js` 中搜索 `_buildClassifyResultItem`，找到构建每个分类结果卡片的方法。

- [ ] **Step 2: 在卡片底部新增"迁移规划"按钮**

在该方法中，找到卡片 VBox 的最后一个子元素（通常是 recommendation 文本），在其后新增按钮：

```js
new sap.m.Button({
  text: '迁移规划',
  type: 'Transparent',
  icon: 'sap-icon://map',
  press: (evt) => {
    const btn = evt.getSource();
    this._onPlanPress(objectName, btn);
  }
})
```

（`objectName` 来自当前卡片的数据，即当前循环变量中的 `item.objectName`）

- [ ] **Step 3: 新增 `_onPlanPress` 方法**

在 controller 中新增：

```js
_onPlanPress: function(objectName, triggerBtn) {
  const panelId = 'planPanel_' + objectName.replace(/[^a-zA-Z0-9]/g, '_');
  // 如果已存在则切换显示/隐藏
  const existing = sap.ui.getCore().byId(panelId);
  if (existing) {
    existing.setVisible(!existing.getVisible());
    return;
  }

  // 创建 Panel 并插入到按钮所在的 VBox 之后
  const planPanel = new sap.m.Panel(panelId, {
    headerText: '迁移规划：' + objectName,
    expandable: false,
    visible: true,
  }).addStyleClass('sapUiSmallMarginTop');

  const busyIndicator = new sap.m.BusyIndicator({ size: '1rem' });
  planPanel.addContent(busyIndicator);

  // 插入到触发按钮所在 VBox 的父容器中
  const parentVBox = triggerBtn.getParent();
  parentVBox.addItem(planPanel);

  // 调用后端
  fetch('/odata/v4/knowledge/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectName }),
  })
    .then(r => r.json())
    .then(data => {
      const result = data.value || data;
      planPanel.removeAllContent();
      planPanel.addContent(this._buildPlanContent(result));
    })
    .catch(err => {
      planPanel.removeAllContent();
      planPanel.addContent(new sap.m.Text({ text: '获取迁移规划失败：' + err.message }));
    });
},
```

- [ ] **Step 4: 新增 `_buildPlanContent` 方法**

```js
_buildPlanContent: function(plan) {
  const vbox = new sap.m.VBox({ renderType: 'Bare' });

  // 替代方案 + 风险 + 工作量
  vbox.addItem(new sap.m.Text({
    text: '替代方案：' + plan.replacement + ' (' + plan.replacementType + ')',
  }).addStyleClass('sapUiTinyMarginBottom'));

  vbox.addItem(new sap.m.HBox({ renderType: 'Bare' }).addItem(
    new sap.m.Text({ text: '风险等级：' + plan.riskLevel })
  ).addItem(
    new sap.m.Text({ text: '　预估工作量：' + plan.effortEstimate })
  ));

  // 迁移步骤
  vbox.addItem(new sap.m.Title({ text: '迁移步骤', level: 'H6' }).addStyleClass('sapUiTinyMarginTop'));
  let steps = [];
  try { steps = JSON.parse(plan.steps); } catch { steps = []; }
  steps.forEach(s => {
    vbox.addItem(new sap.m.Text({ text: s.step + '. ' + s.description }));
  });

  // 代码示例（折叠）
  if (plan.codeExample) {
    const codePanel = new sap.m.Panel({
      headerText: '查看代码示例',
      expandable: true,
      expanded: false,
    });
    const pre = new sap.ui.core.HTML({
      content: '<pre style="font-family:monospace;font-size:0.8rem;white-space:pre-wrap;word-break:break-all;padding:0.5rem;background:#f5f5f5;">'
        + plan.codeExample.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        + '</pre>',
    });
    codePanel.addContent(pre);
    vbox.addItem(codePanel);
  }

  // 导出 PDF 按钮
  vbox.addItem(new sap.m.Button({
    text: '导出 PDF',
    icon: 'sap-icon://pdf-attachment',
    type: 'Transparent',
    press: () => this._exportPlanPDF(plan),
  }).addStyleClass('sapUiTinyMarginTop'));

  return vbox;
},
```

- [ ] **Step 5: 启动应用手动验证**

```bash
npm start
```

在浏览器打开应用，切换到"对象分类" Tab，输入一个对象名（如 `BAPI_MATERIAL_SAVEDATA`）分类后，确认每个结果卡片底部显示"迁移规划"按钮，点击后出现 BusyIndicator，等待后显示迁移计划内容。

---

## Task 6: 前端 — 导出 PDF

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: 新增 `_exportPlanPDF` 方法**

```js
_exportPlanPDF: function(plan) {
  let steps = [];
  try { steps = JSON.parse(plan.steps); } catch { steps = []; }

  const stepsHtml = steps.map(s =>
    '<li><strong>' + s.step + '.</strong> ' + s.description + '</li>'
  ).join('');

  const codeHtml = plan.codeExample
    ? '<h3>代码示例</h3><pre style="background:#f5f5f5;padding:1rem;font-size:0.85rem;white-space:pre-wrap;">'
      + plan.codeExample.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      + '</pre>'
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>迁移规划 - ${plan.objectName}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #333; }
    h1 { color: #0a6ed1; border-bottom: 2px solid #0a6ed1; padding-bottom: 0.5rem; }
    h2 { color: #0a6ed1; margin-top: 1.5rem; }
    .meta { display: flex; gap: 2rem; margin: 1rem 0; }
    .meta span { background: #f0f4ff; padding: 0.3rem 0.8rem; border-radius: 4px; }
    ol { padding-left: 1.5rem; line-height: 2; }
    pre { background: #f5f5f5; padding: 1rem; font-size: 0.85rem; white-space: pre-wrap; }
    .summary { background: #e8f4e8; padding: 0.8rem; border-left: 4px solid #4CAF50; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>迁移规划：${plan.objectName}</h1>
  <div class="summary">${plan.summary}</div>
  <h2>替代方案</h2>
  <p>${plan.replacement} (${plan.replacementType})</p>
  <div class="meta">
    <span>风险等级：${plan.riskLevel}</span>
    <span>预估工作量：${plan.effortEstimate}</span>
  </div>
  <h2>迁移步骤</h2>
  <ol>${stepsHtml}</ol>
  ${codeHtml}
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  iframe.onload = () => {
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  };
},
```

- [ ] **Step 2: 手动验证导出 PDF**

在浏览器中点击"导出 PDF"按钮，确认弹出打印对话框，预览内容包含对象名、替代方案、风险等级、工作量、迁移步骤。选择"另存为 PDF"保存，确认文件内容正确。

- [ ] **Step 3: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: add migration plan UI with PDF export (Feature 6)"
```

---

## 自检

- [x] spec 中所有需求均有对应 task（plan action、prompt、handler、UI button、Panel、代码示例折叠、PDF 导出）
- [x] 无 TBD / TODO / placeholder
- [x] `buildPlanPrompt` 在 Task 3 定义，在 Task 4 使用，名称一致
- [x] `plan` action 在 Task 2 CDS 定义，在 Task 4 handler 实现，在 Task 1 测试
- [x] `_buildPlanContent` 在 Task 5 定义，`_exportPlanPDF` 在 Task 6 定义，不存在前向引用问题
