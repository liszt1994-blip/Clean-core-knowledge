# Clean Core Agent UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the 4-Tab form UI into a unified conversational agent interface supporting ABAP code analysis, ATC error parsing, and Clean Core code rewriting in a single chat flow.

**Architecture:** A new `chat` action on the backend receives user input with optional mode hint and conversation history, detects intent (code / atc / explain / classify), orchestrates existing classify/recommend/searchNote logic, and returns a structured `ChatReply`. The SAPUI5 frontend replaces the `IconTabBar` with a scrollable message history and a unified bottom input bar.

**Tech Stack:** SAP CAP (CDS + Node.js), SAPUI5 (sap.m controls), SAP AI Core Orchestration API via `AICoreClient`, Jest + supertest for backend tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `srv/knowledge-service.cds` | Modify | Add `chat`, `analyzeCode`, `analyzeAtc`, `rewriteCode` action signatures |
| `srv/knowledge-service.js` | Modify | Implement 4 new action handlers; existing handlers untouched |
| `srv/prompts.js` | Modify | Add `buildIntentPrompt`, `buildAnalyzeCodePrompt`, `buildAnalyzeAtcPrompt`, `buildRewriteCodePrompt` |
| `srv/knowledge-service.test.js` | Modify | Add tests for 4 new actions |
| `app/knowledge/webapp/view/App.view.xml` | Rewrite | Replace IconTabBar with chat layout (history + input bar) |
| `app/knowledge/webapp/controller/App.controller.js` | Rewrite | Chat model: message list, intent routing, SSE streaming, rewrite toggle |

---

## Task 1: Add new CDS action signatures

**Files:**
- Modify: `srv/knowledge-service.cds`

- [ ] **Step 1: Add the four new actions to the CDS service**

Open `srv/knowledge-service.cds` and append after the existing `searchNote` action:

```cds
service KnowledgeService {

  // Tab 1: Concept explanation (streaming via SSE)
  action explain(term : String) returns String;

  // Tab 2: Object classification
  action classify(objects : array of String) returns array of {
    objectName       : String;
    tier             : String;
    state            : String;
    explanation      : String;
    recommendation   : String;
    replacement      : String;
    replacementType  : String;
    allSuccessors    : array of { name : String; type : String; };
    note             : String;
    objectType       : String;
    softwareComponent: String;
    appComponent     : String;
    source           : String;
  };

  // Tab 3: Replacement API recommendation
  action recommend(deprecatedObject : String) returns array of {
    replacementName : String;
    type            : String;
    migrationNote   : String;
    source          : String;
  };

  // Tab 4: SAP Note search
  action searchNote(query : String) returns array of {
    noteNumber       : String;
    title            : String;
    summary          : String;
    releaseDate      : String;
    url              : String;
    requiresLogin    : Boolean;
    contentSource    : String;
    confidence       : String;
    confidenceReason : String;
    englishQuery     : String;
  };

  // ── Agent chat (unified entry point) ──────────────────────────────────────
  action chat(
    message  : String;
    mode     : String;   // auto | code | atc | question
    history  : array of { role : String; text : String; };
  ) returns {
    replyType  : String;   // explain | violations | rewrite | note | general
    text       : String;
    violations : array of {
      objectName      : String;
      tier            : String;
      state           : String;
      line            : Integer;
      callType        : String;
      replacement     : String;
      replacementType : String;
      note            : String;
    };
    rewrite : {
      original  : String;
      rewritten : String;
    };
    notes : array of {
      title            : String;
      url              : String;
      noteNumber       : String;
      confidenceReason : String;
    };
  };

  // ── Internal helpers exposed for direct testing ───────────────────────────
  action analyzeCode(code : String) returns array of {
    objectName      : String;
    tier            : String;
    state           : String;
    line            : Integer;
    callType        : String;
    replacement     : String;
    replacementType : String;
    note            : String;
  };

  action analyzeAtc(atcOutput : String) returns array of {
    objectName      : String;
    tier            : String;
    state           : String;
    line            : Integer;
    errorCode       : String;
    replacement     : String;
    replacementType : String;
    note            : String;
  };

  action rewriteCode(
    code       : String;
    violations : array of {
      objectName      : String;
      replacement     : String;
      replacementType : String;
    };
  ) returns {
    original  : String;
    rewritten : String;
  };
}
```

- [ ] **Step 2: Verify CDS compiles**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx cds compile srv/knowledge-service.cds
```

Expected: no errors, JSON CSN output printed to stdout.

- [ ] **Step 3: Commit**

```bash
git add srv/knowledge-service.cds
git commit -m "feat: add chat/analyzeCode/analyzeAtc/rewriteCode CDS action signatures"
```

---

## Task 2: Add new prompts

**Files:**
- Modify: `srv/prompts.js`

- [ ] **Step 1: Write failing tests for new prompt builders**

Add to `srv/prompts.test.js`:

```js
const {
  buildIntentPrompt,
  buildAnalyzeCodePrompt,
  buildAnalyzeAtcPrompt,
  buildRewriteCodePrompt,
} = require('./prompts');

test('buildIntentPrompt includes user message and valid intent list', () => {
  const p = buildIntentPrompt('CALL FUNCTION "BAPI_MATERIAL_SAVEDATA"', 'auto');
  expect(p).toMatch(/BAPI_MATERIAL_SAVEDATA/);
  expect(p).toMatch(/code/);
  expect(p).toMatch(/atc/);
  expect(p).toMatch(/explain/);
});

test('buildIntentPrompt skips detection hint when mode is not auto', () => {
  const p = buildIntentPrompt('some text', 'code');
  // When mode is provided, prompt should still contain the message
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest srv/prompts.test.js --no-coverage
```

Expected: 5 new tests FAIL with "buildIntentPrompt is not a function" (or similar).

- [ ] **Step 3: Implement the four new prompt builders in `srv/prompts.js`**

Add after the existing `buildNoteSummaryFromContentPrompt` function, before `module.exports`:

```js
// ── Agent chat: intent detection ──────────────────────────────────────────
// Lightweight call (maxTokens: 50). Returns { "intent": "code"|"atc"|"explain"|"classify"|"general" }
// When mode !== 'auto', the caller skips this prompt entirely.
function buildIntentPrompt(message, mode) {
  return (
    `Classify the following user message into exactly one intent category.\n\n` +
    `Categories:\n` +
    `- "code"     : message contains ABAP source code (CALL FUNCTION, SELECT, CLASS, METHOD, etc.)\n` +
    `- "atc"      : message contains ATC check output / error messages with error codes\n` +
    `- "explain"  : message asks for a concept explanation (what is X, explain X)\n` +
    `- "classify" : message contains only SAP object names to classify (no code, no question)\n` +
    `- "general"  : anything else\n\n` +
    `User message (mode hint: ${mode}):\n"""\n${message}\n"""\n\n` +
    `Return ONLY a JSON object with no markdown fences: { "intent": "<category>" }`
  );
}

// ── Agent chat: ABAP code analysis ───────────────────────────────────────
// Returns JSON array of object references found in the code.
// Each entry: { objectName, line, callType }
// Caller then runs ClassificationClient.lookup() per objectName.
function buildAnalyzeCodePrompt(code) {
  return (
    `Analyze the following ABAP code and identify all SAP object references that may violate ` +
    `Clean Core principles.\n\n` +
    `Look for:\n` +
    `- CALL FUNCTION '...' (function module calls)\n` +
    `- SELECT ... FROM <table> (direct database table access)\n` +
    `- Transaction codes called via CALL TRANSACTION\n` +
    `- Old-style class instantiation or method calls on non-released classes\n` +
    `- SUBMIT <program> (report calls)\n\n` +
    `For each object found, return its name, the line number (count from 1), and the call type.\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have:\n` +
    `- objectName (string: the SAP object name, e.g. "BAPI_MATERIAL_SAVEDATA", "MARA", "SE16")\n` +
    `- line       (number: line number in the code where this object is used)\n` +
    `- callType   (string: "CALL FUNCTION" | "SELECT" | "CALL TRANSACTION" | "CLASS" | "SUBMIT" | "OTHER")\n\n` +
    `Code to analyze:\n\`\`\`abap\n${code}\n\`\`\``
  );
}

// ── Agent chat: ATC output analysis ──────────────────────────────────────
// Parses any ATC error output format (SE80 copy, ABAP Test Cockpit export).
// Returns JSON array: { objectName, errorCode, line, message }
function buildAnalyzeAtcPrompt(atcOutput) {
  return (
    `Parse the following SAP ATC (ABAP Test Cockpit) check output and extract all findings.\n\n` +
    `The input may be in various formats: SE80 copy-paste, XML export, or plain text.\n` +
    `For each finding, extract the SAP object name, error/check code, line number, and message.\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have:\n` +
    `- objectName (string: the SAP object being called or referenced, e.g. "BAPI_MATERIAL_SAVEDATA")\n` +
    `- errorCode  (string: ATC check code, e.g. "SLIN_OBSOLETE", "AMDP_CHECK", "SLIN_DESC_USAGE")\n` +
    `- line       (number: line number if present, 0 if not available)\n` +
    `- message    (string: the ATC finding message)\n\n` +
    `ATC output to parse:\n"""\n${atcOutput}\n"""`
  );
}

// ── Agent chat: ABAP code rewrite ─────────────────────────────────────────
// Given original code and a list of violations with their replacements,
// rewrites the code to be Clean Core compliant.
function buildRewriteCodePrompt(code, violations) {
  const violationList = violations
    .map(v => `- ${v.objectName} → ${v.replacementType ? v.replacementType + ' ' : ''}${v.replacement}`)
    .join('\n');

  return (
    `Rewrite the following ABAP code to be SAP Clean Core compliant.\n\n` +
    `Required replacements:\n${violationList}\n\n` +
    `Rules:\n` +
    `1. Preserve all business logic exactly — only replace non-compliant API calls\n` +
    `2. Replace each listed object with its Clean Core alternative\n` +
    `3. Add a comment "* Clean Core: replaced X with Y" on the line of each change\n` +
    `4. If a replacement requires additional DATA declarations, add them near the top\n` +
    `5. Keep all other code unchanged\n\n` +
    `Return ONLY a JSON object with no markdown fences:\n` +
    `{ "original": "<original code unchanged>", "rewritten": "<rewritten code>" }\n\n` +
    `Original ABAP code:\n\`\`\`abap\n${code}\n\`\`\``
  );
}
```

Also update `module.exports` at the bottom of `srv/prompts.js` to include the four new functions:

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
  buildIntentPrompt,
  buildAnalyzeCodePrompt,
  buildAnalyzeAtcPrompt,
  buildRewriteCodePrompt,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest srv/prompts.test.js --no-coverage
```

Expected: all tests PASS (including the 4 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add srv/prompts.js srv/prompts.test.js
git commit -m "feat: add intent/analyzeCode/analyzeAtc/rewriteCode prompt builders"
```

---

## Task 3: Implement `analyzeCode` and `analyzeAtc` service handlers

**Files:**
- Modify: `srv/knowledge-service.js`
- Modify: `srv/knowledge-service.test.js`

- [ ] **Step 1: Write failing tests**

Add to `srv/knowledge-service.test.js`, inside the existing mock setup (the `jest.mock` block is already present at top of file — these tests go after the existing ones):

```js
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
```

Also update the mock's `complete` function to handle the new prompt patterns. Replace the existing `complete` mock implementation with:

```js
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
  if (userContent && userContent.includes('migrationNote')) {
    return Promise.resolve(
      '[{"replacementName":"I_MATERIAL","type":"CDS View","migrationNote":"Use CDS View I_MATERIAL instead.","source":"official-json+ai-note"}]'
    );
  }
  if (userContent && userContent.includes('replacementName')) {
    return Promise.resolve(
      '[{"replacementName":"I_MATERIAL","type":"CDS View","migrationNote":"Migrate to I_MATERIAL CDS View.","source":"ai-inference"}]'
    );
  }
  // Default: classify fallback + explain
  return Promise.resolve(
    '[{"objectName":"SE16","tier":"C","state":"classicAPI","explanation":"Classic transaction.","recommendation":"Use CDS View instead.","source":"ai-inference"}]'
  );
}),
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest srv/knowledge-service.test.js --no-coverage
```

Expected: 4 new tests FAIL with 404 (actions not yet implemented).

- [ ] **Step 3: Implement `analyzeCode` handler in `srv/knowledge-service.js`**

Add after the `recommend` handler (before `searchNote`):

```js
  // ── analyzeCode: extract non-compliant objects from ABAP code ─────────────
  srv.on('analyzeCode', async (req) => {
    const { code } = req.data;
    if (!code || !code.trim()) return req.error(400, 'code is required');

    // Step 1: AI extracts object references + line numbers
    let rawRefs;
    try {
      const raw = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildAnalyzeCodePrompt(code),
      );
      rawRefs = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
      if (!Array.isArray(rawRefs)) rawRefs = [];
    } catch {
      return req.error(502, 'AI failed to analyze code');
    }

    // Step 2: classify each found object via local JSON first, AI fallback
    const results = [];
    for (const ref of rawRefs) {
      const name = (ref.objectName || '').trim().toUpperCase();
      if (!name) continue;
      const info = getClassifier().lookup(name);
      if (info && info.tier !== 'A') {
        results.push({
          objectName:     name,
          tier:           info.tier,
          state:          info.state || info.clsState,
          line:           ref.line || 0,
          callType:       ref.callType || '',
          replacement:    info.replacement || '',
          replacementType: info.replacementType || '',
          note:           info.note || '',
        });
      } else if (!info) {
        // AI fallback for unknown objects
        try {
          const raw = await getAI().complete(
            CLEAN_CORE_SYSTEM_PROMPT,
            buildSingleClassifyPrompt(name),
          );
          const parsed = JSON.parse(raw.trim());
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].tier !== 'A') {
            results.push({
              objectName:     name,
              tier:           parsed[0].tier || 'unknown',
              state:          parsed[0].state || 'unknown',
              line:           ref.line || 0,
              callType:       ref.callType || '',
              replacement:    '',
              replacementType: '',
              note:           '',
            });
          }
        } catch {
          // skip objects where AI also fails
        }
      }
      // Tier A objects are compliant — skip them
    }
    return results;
  });
```

- [ ] **Step 4: Implement `analyzeAtc` handler in `srv/knowledge-service.js`**

Add immediately after `analyzeCode`:

```js
  // ── analyzeAtc: parse ATC output and classify found objects ──────────────
  srv.on('analyzeAtc', async (req) => {
    const { atcOutput } = req.data;
    if (!atcOutput || !atcOutput.trim()) return req.error(400, 'atcOutput is required');

    // Step 1: AI parses ATC text into structured findings
    let findings;
    try {
      const raw = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildAnalyzeAtcPrompt(atcOutput),
      );
      findings = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
      if (!Array.isArray(findings)) findings = [];
    } catch {
      return req.error(502, 'AI failed to parse ATC output');
    }

    // Step 2: classify each object via local JSON first, AI fallback
    const results = [];
    for (const finding of findings) {
      const name = (finding.objectName || '').trim().toUpperCase();
      if (!name) continue;
      const info = getClassifier().lookup(name);
      if (info) {
        results.push({
          objectName:     name,
          tier:           info.tier,
          state:          info.state || info.clsState,
          line:           finding.line || 0,
          errorCode:      finding.errorCode || '',
          replacement:    info.replacement || '',
          replacementType: info.replacementType || '',
          note:           info.note || '',
        });
      } else {
        results.push({
          objectName:     name,
          tier:           'unknown',
          state:          'unknown',
          line:           finding.line || 0,
          errorCode:      finding.errorCode || '',
          replacement:    '',
          replacementType: '',
          note:           finding.message || '',
        });
      }
    }
    return results;
  });
```

- [ ] **Step 5: Add missing imports to the destructure at top of `srv/knowledge-service.js`**

The file already imports from `./prompts`. Update the destructure to add the new builders:

```js
const {
  buildExplainPrompt,
  buildSingleClassifyPrompt,
  buildMigrationNotePrompt,
  buildRecommendPrompt,
  buildTranslateQueryPrompt,
  buildRerankPrompt,
  buildNoteSummaryFromContentPrompt,
  buildAnalyzeCodePrompt,
  buildAnalyzeAtcPrompt,
} = require('./prompts');
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest srv/knowledge-service.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add srv/knowledge-service.js srv/knowledge-service.test.js
git commit -m "feat: implement analyzeCode and analyzeAtc service handlers"
```

---

## Task 4: Implement `rewriteCode` and `chat` service handlers

**Files:**
- Modify: `srv/knowledge-service.js`
- Modify: `srv/knowledge-service.test.js`

- [ ] **Step 1: Write failing tests**

Add to `srv/knowledge-service.test.js`:

```js
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

test('POST /odata/v4/knowledge/chat returns a ChatReply', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/chat')
    .set('Content-Type', 'application/json')
    .send({ message: 'What is RAP?', mode: 'auto', history: [] });
  expect(res.status).toBe(200);
  const body = res.body.value || res.body;
  expect(body).toHaveProperty('replyType');
  expect(body).toHaveProperty('text');
});

test('POST /odata/v4/knowledge/chat returns 400 without message', async () => {
  const app = cds.app;
  const res = await supertest(app)
    .post('/odata/v4/knowledge/chat')
    .set('Content-Type', 'application/json')
    .send({ mode: 'auto', history: [] });
  expect(res.status).toBe(400);
});
```

Also update the `complete` mock to handle `rewriteCode` and `chat` intent prompts. Add these two cases to the mock's `complete` implementation (before the default return):

```js
if (userContent && userContent.includes('original') && userContent.includes('rewritten') && userContent.includes('ABAP')) {
  // buildRewriteCodePrompt
  return Promise.resolve(
    '{"original":"CALL FUNCTION \'BAPI_MATERIAL_SAVEDATA\'.","rewritten":"* Clean Core: replaced BAPI_MATERIAL_SAVEDATA with I_MATERIAL\\nDATA lo_mat TYPE REF TO cl_material."}'
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest srv/knowledge-service.test.js --no-coverage
```

Expected: 4 new tests FAIL with 404.

- [ ] **Step 3: Implement `rewriteCode` handler**

Add after `analyzeAtc` in `srv/knowledge-service.js`:

```js
  // ── rewriteCode: rewrite ABAP code to Clean Core compliant version ────────
  srv.on('rewriteCode', async (req) => {
    const { code, violations } = req.data;
    if (!code || !code.trim()) return req.error(400, 'code is required');
    if (!violations || violations.length === 0) {
      return { original: code, rewritten: code };
    }

    const raw = await getAI().complete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildRewriteCodePrompt(code, violations),
      4096,
    );

    let parsed;
    try {
      const text = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      parsed = JSON.parse(text);
    } catch {
      return req.error(502, 'AI returned invalid JSON for rewrite');
    }

    return {
      original:  parsed.original  || code,
      rewritten: parsed.rewritten || code,
    };
  });
```

- [ ] **Step 4: Implement `chat` handler**

Add after `rewriteCode` in `srv/knowledge-service.js`:

```js
  // ── chat: unified agent entry point ───────────────────────────────────────
  srv.on('chat', async (req) => {
    const { message, mode = 'auto', history = [] } = req.data;
    if (!message || !message.trim()) return req.error(400, 'message is required');

    // Step 1: detect intent (skip if mode is explicit)
    let intent = mode;
    if (mode === 'auto') {
      try {
        const raw = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildIntentPrompt(message, mode),
          64,
        );
        const parsed = JSON.parse(raw.trim());
        intent = parsed.intent || 'general';
      } catch {
        intent = 'general';
      }
    }

    // Step 2: build multi-turn history for context
    const historyMessages = (history || []).slice(-6).map(h => ({
      role:    h.role === 'agent' ? 'assistant' : 'user',
      content: h.text,
    }));

    // Step 3: route to handler
    if (intent === 'explain') {
      const text = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildExplainPrompt(message),
      );
      return { replyType: 'explain', text, violations: [], rewrite: null, notes: [] };
    }

    if (intent === 'classify') {
      const objects = message.split(/[\n,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const violations = [];
      for (const name of objects) {
        const info = getClassifier().lookup(name);
        if (info) {
          violations.push({
            objectName:     name,
            tier:           info.tier,
            state:          info.state || info.clsState,
            line:           0,
            callType:       '',
            replacement:    info.replacement || '',
            replacementType: info.replacementType || '',
            note:           info.note || '',
          });
        }
      }
      return {
        replyType:  'violations',
        text:       violations.length > 0
          ? `发现 ${violations.length} 个对象，分级结果如下：`
          : '在本地数据中未找到这些对象，建议手动核实。',
        violations,
        rewrite:    null,
        notes:      [],
      };
    }

    if (intent === 'code') {
      // analyzeCode inline (reuse the same logic without a second HTTP call)
      let rawRefs = [];
      try {
        const raw = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildAnalyzeCodePrompt(message),
        );
        rawRefs = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
        if (!Array.isArray(rawRefs)) rawRefs = [];
      } catch { /* fall through with empty */ }

      const violations = [];
      for (const ref of rawRefs) {
        const name = (ref.objectName || '').trim().toUpperCase();
        if (!name) continue;
        const info = getClassifier().lookup(name);
        if (info && info.tier !== 'A') {
          violations.push({
            objectName:     name,
            tier:           info.tier,
            state:          info.state || info.clsState,
            line:           ref.line || 0,
            callType:       ref.callType || '',
            replacement:    info.replacement || '',
            replacementType: info.replacementType || '',
            note:           info.note || '',
          });
        }
      }

      if (violations.length === 0) {
        return { replyType: 'general', text: '代码中未发现 Clean Core 违规对象，可以安全使用。', violations: [], rewrite: null, notes: [] };
      }

      // Also generate rewrite
      const rewrite = await (async () => {
        try {
          const raw = await getAI().complete(
            CLEAN_CORE_SYSTEM_PROMPT,
            buildRewriteCodePrompt(message, violations),
            4096,
          );
          const text = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
          return JSON.parse(text);
        } catch { return null; }
      })();

      return {
        replyType:  'violations',
        text:       `发现 ${violations.length} 个 Clean Core 违规对象：`,
        violations,
        rewrite:    rewrite || null,
        notes:      [],
      };
    }

    if (intent === 'atc') {
      let findings = [];
      try {
        const raw = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildAnalyzeAtcPrompt(message),
        );
        findings = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
        if (!Array.isArray(findings)) findings = [];
      } catch { /* fall through */ }

      const violations = findings.map(f => {
        const name = (f.objectName || '').trim().toUpperCase();
        const info = getClassifier().lookup(name);
        return {
          objectName:     name,
          tier:           info ? info.tier : 'unknown',
          state:          info ? (info.state || info.clsState) : 'unknown',
          line:           f.line || 0,
          callType:       f.errorCode || '',
          replacement:    info ? (info.replacement || '') : '',
          replacementType: info ? (info.replacementType || '') : '',
          note:           f.message || (info ? info.note : '') || '',
        };
      });

      return {
        replyType:  violations.length > 0 ? 'violations' : 'general',
        text:       violations.length > 0
          ? `解析到 ${violations.length} 个 ATC 违规，分级结果如下：`
          : '未能从 ATC 输出中解析到违规对象，请确认输入格式。',
        violations,
        rewrite:    null,
        notes:      [],
      };
    }

    // Fallback: general question → explain
    const text = await getAI().complete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildExplainPrompt(message),
    );
    return { replyType: 'general', text, violations: [], rewrite: null, notes: [] };
  });
```

- [ ] **Step 5: Add missing prompt imports at top of `srv/knowledge-service.js`**

Update the destructure to include all new prompt builders:

```js
const {
  buildExplainPrompt,
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
} = require('./prompts');
```

- [ ] **Step 6: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add srv/knowledge-service.js srv/knowledge-service.test.js
git commit -m "feat: implement rewriteCode and chat service handlers"
```

---

## Task 5: Rewrite the SAPUI5 view (App.view.xml)

**Files:**
- Modify: `app/knowledge/webapp/view/App.view.xml`

- [ ] **Step 1: Replace the entire view with the chat layout**

Replace the full contents of `app/knowledge/webapp/view/App.view.xml` with:

```xml
<mvc:View
  controllerName="knowledge.controller.App"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  xmlns:core="sap.ui.core"
  displayBlock="true">
  <Shell>
    <App>
      <pages>
        <Page id="mainPage" showHeader="true">
          <customHeader>
            <Bar>
              <contentLeft>
                <Title text="🤖 Clean Core Agent" level="H4" />
              </contentLeft>
              <contentRight>
                <Button text="清空" icon="sap-icon://delete" press=".onClearChat" type="Transparent" />
              </contentRight>
            </Bar>
          </customHeader>
          <content>
            <!-- Message history -->
            <VBox id="chatHistory"
              class="sapUiSmallMargin"
              width="100%"
              binding="{/messages}">
            </VBox>
          </content>
          <footer>
            <Toolbar>
              <content>
                <VBox width="100%">
                  <!-- Mode toggle -->
                  <SegmentedButton id="modeToggle"
                    selectedKey="auto"
                    selectionChange=".onModeChange">
                    <items>
                      <SegmentedButtonItem key="auto"  text="自动" />
                      <SegmentedButtonItem key="code"  text="&lt;/&gt; 代码" />
                      <SegmentedButtonItem key="atc"   text="⚡ ATC报错" />
                      <SegmentedButtonItem key="question" text="💬 问题" />
                    </items>
                  </SegmentedButton>
                  <!-- Input row -->
                  <HBox width="100%" alignItems="End">
                    <TextArea id="chatInput"
                      placeholder="输入问题，或粘贴 ABAP 代码 / ATC 报错..."
                      rows="3"
                      growing="true"
                      growingMaxLines="8"
                      width="100%"
                      class="sapUiTinyMarginEnd" />
                    <Button id="sendBtn"
                      icon="sap-icon://paper-plane"
                      type="Emphasized"
                      press=".onSend"
                      enabled="{= !${/busy} }" />
                  </HBox>
                  <BusyIndicator id="chatBusy" visible="{/busy}" size="Auto" />
                </VBox>
              </content>
            </Toolbar>
          </footer>
        </Page>
      </pages>
    </App>
  </Shell>
</mvc:View>
```

- [ ] **Step 2: Start the app and verify it loads without errors**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npm run dev
```

Open browser at `http://localhost:4004/knowledge/webapp/index.html`. Expected: blank chat page with header "🤖 Clean Core Agent", mode toggle buttons, and a text input area. No console errors.

- [ ] **Step 3: Commit**

```bash
git add app/knowledge/webapp/view/App.view.xml
git commit -m "feat: replace IconTabBar with chat layout view"
```

---

## Task 6: Rewrite the SAPUI5 controller (App.controller.js)

**Files:**
- Modify: `app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: Replace the full controller**

Replace all contents of `app/knowledge/webapp/controller/App.controller.js` with:

```js
sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageBox',
  'sap/m/VBox',
  'sap/m/HBox',
  'sap/m/Text',
  'sap/m/FormattedText',
  'sap/m/Title',
  'sap/m/Button',
  'sap/m/Panel',
  'sap/m/ObjectStatus',
  'sap/m/MessageStrip',
  'sap/m/Link',
  'sap/ui/core/HTML'
], function (
  Controller, JSONModel, MessageBox,
  VBox, HBox, Text, FormattedText, Title, Button, Panel, ObjectStatus, MessageStrip, Link, HTML
) {
  'use strict';

  // Tier → ObjectStatus state mapping
  var TIER_STATE = { A: 'Success', B: 'Warning', C: 'Error', D: 'Error' };

  return Controller.extend('knowledge.controller.App', {

    onInit: function () {
      var model = new JSONModel({
        messages: [],
        inputMode: 'auto',
        inputText: '',
        busy: false
      });
      this.getView().setModel(model);
      this._addWelcomeMessage();
    },

    // ── Welcome message ────────────────────────────────────────────────────
    _addWelcomeMessage: function () {
      var container = this.byId('chatHistory');
      var welcomeBox = new VBox({
        width: '100%',
        items: [
          new MessageStrip({
            text: '你好！我可以帮你：\n• 分析 ABAP 代码中的 Clean Core 违规\n• 解读 ATC check 报错并给出修复方案\n• 查询对象分级和替代 API\n• 解释 Clean Core 概念',
            type: 'Information',
            showIcon: true
          })
        ]
      }).addStyleClass('sapUiSmallMarginBottom');
      container.addItem(welcomeBox);
    },

    // ── Mode toggle ────────────────────────────────────────────────────────
    onModeChange: function (oEvent) {
      var key = oEvent.getParameter('item').getKey();
      this.getView().getModel().setProperty('/inputMode', key);
      var placeholders = {
        auto:     '输入问题，或粘贴 ABAP 代码 / ATC 报错...',
        code:     '粘贴 ABAP 代码片段，Agent 将识别所有不合规对象...',
        atc:      '粘贴 ATC check 报错信息（SE80 或 ABAP Test Cockpit 格式）...',
        question: '输入 Clean Core 或 ATC 相关问题...'
      };
      this.byId('chatInput').setPlaceholder(placeholders[key] || placeholders.auto);
    },

    // ── Send message ───────────────────────────────────────────────────────
    onSend: function () {
      var input = this.byId('chatInput');
      var message = input.getValue().trim();
      if (!message) return;

      var model = this.getView().getModel();
      var mode = model.getProperty('/inputMode') || 'auto';

      // Collect last 6 messages as history for multi-turn context
      var container = this.byId('chatHistory');
      var history = (model.getProperty('/messages') || [])
        .slice(-6)
        .map(function (m) { return { role: m.role, text: m.textSummary || m.text || '' }; });

      // Add user bubble
      this._addUserBubble(message, mode);
      input.setValue('');
      model.setProperty('/busy', true);

      var that = this;

      // Use SSE for question/explain mode — else POST /chat
      if (mode === 'question') {
        that._streamExplain(message);
        return;
      }

      fetch('/odata/v4/knowledge/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, mode: mode, history: history })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          model.setProperty('/busy', false);
          var reply = data.value || data;
          that._addAgentBubble(reply);
        })
        .catch(function (err) {
          model.setProperty('/busy', false);
          MessageBox.error('请求失败：' + err.message);
        });
    },

    // ── SSE streaming for explain-type replies ─────────────────────────────
    _streamExplain: function (term) {
      var model = this.getView().getModel();
      var that = this;
      var bubbleText = new FormattedText({ htmlText: '', width: '100%' });
      var bubbleBox = that._buildAgentShell([bubbleText]);
      that.byId('chatHistory').addItem(bubbleBox);

      var accumulated = '';
      var evtSource = new EventSource('/stream/explain?term=' + encodeURIComponent(term));

      evtSource.onmessage = function (e) {
        if (e.data === '[DONE]') {
          evtSource.close();
          model.setProperty('/busy', false);
          // Store in messages array
          var msgs = model.getProperty('/messages') || [];
          msgs.push({ role: 'agent', replyType: 'explain', text: accumulated, textSummary: accumulated.slice(0, 120) });
          model.setProperty('/messages', msgs);
          return;
        }
        try {
          var chunk = JSON.parse(e.data);
          if (chunk.error) { evtSource.close(); model.setProperty('/busy', false); return; }
          accumulated += chunk.text;
          bubbleText.setHtmlText(accumulated.replace(/\n/g, '<br>'));
        } catch (err) { /* ignore partial parse errors */ }
      };

      evtSource.onerror = function () {
        evtSource.close();
        model.setProperty('/busy', false);
      };
    },

    // ── Add user bubble to chat ────────────────────────────────────────────
    _addUserBubble: function (message, mode) {
      var model = this.getView().getModel();
      var msgs = model.getProperty('/messages') || [];
      msgs.push({ role: 'user', mode: mode, text: message, textSummary: message.slice(0, 120) });
      model.setProperty('/messages', msgs);

      var isCode = mode === 'code' || /CALL FUNCTION|SELECT\s+\*|CLASS\s+/i.test(message);
      var content = isCode
        ? new HTML({ content: '<pre style="background:#1e1e1e;color:#d4d4d4;padding:8px;border-radius:4px;overflow:auto;font-size:12px;white-space:pre-wrap">' + this._escapeHtml(message) + '</pre>' })
        : new Text({ text: message, wrapping: true });

      var bubble = new HBox({
        justifyContent: 'End',
        width: '100%',
        items: [
          new VBox({
            items: [content],
            width: '75%'
          }).addStyleClass('sapUiSmallPadding').addStyleClass('cleanCoreUserBubble')
        ]
      }).addStyleClass('sapUiSmallMarginBottom');

      this.byId('chatHistory').addItem(bubble);
      this._scrollToBottom();
    },

    // ── Add agent bubble to chat ───────────────────────────────────────────
    _addAgentBubble: function (reply) {
      var items = [];
      var replyType = reply.replyType || 'general';

      // Main text
      if (reply.text) {
        items.push(new FormattedText({
          htmlText: reply.text.replace(/\n/g, '<br>'),
          width: '100%'
        }).addStyleClass('sapUiSmallMarginBottom'));
      }

      // Violation cards
      if (Array.isArray(reply.violations) && reply.violations.length > 0) {
        reply.violations.forEach(function (v) {
          items.push(this._buildViolationCard(v));
        }.bind(this));
      }

      // Rewrite button + code diff (if rewrite data present)
      if (reply.rewrite && reply.rewrite.rewritten) {
        var diffPanel = this._buildCodeDiffPanel(reply.rewrite);
        var toggleBtn = new Button({
          text: '📋 查看改写代码',
          type: 'Transparent',
          press: function () {
            var expanded = diffPanel.getExpanded();
            diffPanel.setExpanded(!expanded);
            toggleBtn.setText(expanded ? '📋 查看改写代码' : '📋 收起改写代码');
          }
        }).addStyleClass('sapUiSmallMarginTop');
        items.push(toggleBtn);
        items.push(diffPanel);
      }

      // Related notes
      if (Array.isArray(reply.notes) && reply.notes.length > 0) {
        var notesBox = new VBox({ items: [] }).addStyleClass('sapUiSmallMarginTop');
        notesBox.addItem(new Text({ text: '相关 SAP Note：' }).addStyleClass('sapUiSmallMarginBottom'));
        reply.notes.forEach(function (n) {
          notesBox.addItem(new Link({
            text: (n.noteNumber ? 'Note ' + n.noteNumber + ': ' : '') + n.title,
            href: n.url,
            target: '_blank'
          }));
        });
        items.push(notesBox);
      }

      var bubbleBox = this._buildAgentShell(items);
      this.byId('chatHistory').addItem(bubbleBox);

      // Store summary in model
      var model = this.getView().getModel();
      var msgs = model.getProperty('/messages') || [];
      var summary = replyType === 'violations'
        ? (reply.text || '') + (reply.violations ? ' [' + reply.violations.length + '个违规]' : '')
        : (reply.text || '').slice(0, 120);
      msgs.push({ role: 'agent', replyType: replyType, text: reply.text || '', textSummary: summary });
      model.setProperty('/messages', msgs);

      this._scrollToBottom();
    },

    // ── Build agent bubble shell (left-aligned) ────────────────────────────
    _buildAgentShell: function (items) {
      return new HBox({
        width: '100%',
        items: [
          new VBox({ items: items, width: '90%' })
            .addStyleClass('sapUiSmallPadding')
            .addStyleClass('cleanCoreAgentBubble')
        ]
      }).addStyleClass('sapUiSmallMarginBottom');
    },

    // ── Build a single violation card ─────────────────────────────────────
    _buildViolationCard: function (v) {
      var state = TIER_STATE[v.tier] || 'None';
      var headerBox = new HBox({
        alignItems: 'Center',
        items: [
          new ObjectStatus({ text: 'Tier ' + v.tier, state: state }).addStyleClass('sapUiSmallMarginEnd'),
          new Title({ text: v.objectName, level: 'H5' }).addStyleClass('sapUiSmallMarginEnd'),
          v.line ? new Text({ text: '第 ' + v.line + ' 行' }).addStyleClass('sapUiTinyMarginEnd') : new Text({ text: '' })
        ]
      });

      var details = [];
      if (v.state) details.push(new Text({ text: '状态：' + v.state, wrapping: true }));
      if (v.replacement) details.push(new Text({ text: '建议替换：' + (v.replacementType ? v.replacementType + ' ' : '') + v.replacement, wrapping: true }));
      if (v.note) details.push(new Text({ text: v.note, wrapping: true }).addStyleClass('sapUiSmallMarginTop'));

      return new Panel({
        expandable: true,
        expanded: false,
        headerText: '',
        headerToolbar: new sap.m.Toolbar({ content: [headerBox] }),
        content: [new VBox({ items: details }).addStyleClass('sapUiSmallMargin')]
      }).addStyleClass('sapUiSmallMarginBottom');
    },

    // ── Build two-column code diff panel ──────────────────────────────────
    _buildCodeDiffPanel: function (rewrite) {
      var that = this;
      var copyBtn = new Button({
        text: '📋 复制代码',
        type: 'Transparent',
        press: function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(rewrite.rewritten).catch(function () {});
          }
        }
      });

      var diffBox = new HBox({
        width: '100%',
        items: [
          new VBox({
            width: '50%',
            items: [
              new Title({ text: '原代码', level: 'H6' }),
              new HTML({ content: '<pre style="background:#1e1e1e;color:#f44747;padding:8px;border-radius:4px;font-size:11px;overflow:auto;white-space:pre-wrap">' + that._escapeHtml(rewrite.original || '') + '</pre>' })
            ]
          }).addStyleClass('sapUiSmallMarginEnd'),
          new VBox({
            width: '50%',
            items: [
              new Title({ text: '改写后', level: 'H6' }),
              new HTML({ content: '<pre style="background:#1e1e1e;color:#4ec9b0;padding:8px;border-radius:4px;font-size:11px;overflow:auto;white-space:pre-wrap">' + that._escapeHtml(rewrite.rewritten || '') + '</pre>' })
            ]
          })
        ]
      });

      return new Panel({
        expandable: true,
        expanded: false,
        headerText: '代码对比',
        content: [
          new VBox({ items: [diffBox, copyBtn] }).addStyleClass('sapUiSmallMargin')
        ]
      });
    },

    // ── Clear conversation ─────────────────────────────────────────────────
    onClearChat: function () {
      var container = this.byId('chatHistory');
      container.destroyItems();
      this.getView().getModel().setProperty('/messages', []);
      this._addWelcomeMessage();
    },

    // ── Scroll chat to bottom ──────────────────────────────────────────────
    _scrollToBottom: function () {
      var page = this.byId('mainPage');
      if (page && page.scrollTo) {
        setTimeout(function () { page.scrollTo(0, 99999); }, 100);
      }
    },

    // ── HTML escape utility ────────────────────────────────────────────────
    _escapeHtml: function (str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

  });
});
```

- [ ] **Step 2: Start the app and smoke-test the UI**

```bash
npm run dev
```

Open `http://localhost:4004/knowledge/webapp/index.html`.

Verify:
1. Welcome message strip appears
2. Mode toggle shows 4 options
3. Typing in the TextArea and pressing Send shows a user bubble (right-aligned)
4. Agent bubble appears (left-aligned) after the fetch response
5. No console errors

- [ ] **Step 3: Commit**

```bash
git add app/knowledge/webapp/controller/App.controller.js
git commit -m "feat: rewrite controller for chat agent interface"
```

---

## Task 7: Run full test suite and final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

```bash
cd "C:/Users/I524685/Desktop/Claude works/clean-core-tools/tool1-knowledge"
npx jest --no-coverage
```

Expected: all tests PASS. Note counts: existing 4 + new 13 = 17 total.

- [ ] **Step 2: Verify app loads end-to-end**

```bash
npm run dev
```

Test each scenario manually:

| Scenario | Input | Expected agent reply |
|----------|-------|----------------------|
| Concept question | "什么是 RAP" | explain-type text |
| Code analysis | `CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'.` | violations card + 查看改写代码 button |
| ATC output | `SLIN_OBSOLETE: BAPI_MATERIAL_SAVEDATA line 5` | violations card with errorCode |
| Object name | `SE16` (in auto mode) | classify result with tier badge |
| Clear | Press 清空 | chat resets to welcome message only |

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat: complete Clean Core Agent UI redesign - chat interface with code analysis and rewrite"
```
