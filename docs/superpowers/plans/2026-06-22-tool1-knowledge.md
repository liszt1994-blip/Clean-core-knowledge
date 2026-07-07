# Tool 1: Knowledge Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone SAP CAP + UI5 application that lets any user explore Clean Core concepts, classify SAP objects by A/B/C/D tier, and get replacement API recommendations — all powered by Claude API with an embedded System Prompt knowledge base.

**Architecture:** Single CAP service (`knowledge-srv`) exposes three POST endpoints; all Claude API calls happen server-side to keep the API key out of the browser. The UI5 frontend is a single `App.view.xml` with an `IconTabBar` switching between three panels. SSE streaming is used for Tab 1 (concept explanation) to reduce perceived latency.

**Tech Stack:** SAP CAP (Node.js), SAP UI5, Claude API (`claude-sonnet-4-6`), `@anthropic-ai/sdk`, `xml2js` (ATC parser in shared — not used by Tool 1 but scaffolded here), Jest for unit tests, `supertest` for integration tests.

---

## File Structure

```
clean-core-tools/
├── package.json                          ← workspace root (npm workspaces)
├── shared/
│   ├── package.json
│   ├── claude-client/
│   │   ├── index.js                      ← ClaudeClient class (streaming + non-streaming)
│   │   └── index.test.js
│   └── atc-xml-parser/
│       ├── index.js                      ← parseAtcXml(xmlString) → violation[]
│       └── index.test.js
└── tool1-knowledge/
    ├── package.json
    ├── .env.example
    ├── srv/
    │   ├── knowledge-service.cds         ← CDS service definition
    │   ├── knowledge-service.js          ← CAP service handler
    │   ├── prompts.js                    ← all System Prompts & user prompt builders
    │   └── knowledge-service.test.js     ← integration tests (supertest)
    ├── app/
    │   └── knowledge/
    │       ├── webapp/
    │       │   ├── index.html
    │       │   ├── manifest.json
    │       │   ├── Component.js
    │       │   ├── view/
    │       │   │   └── App.view.xml      ← IconTabBar with 3 panels
    │       │   └── controller/
    │       │       └── App.controller.js ← handles all 3 tab interactions
    │       └── xs-app.json
    └── package.json
```

---

## Task 1: Monorepo + Shared Scaffolding

**Files:**
- Create: `package.json` (workspace root)
- Create: `shared/package.json`
- Create: `shared/claude-client/index.js`
- Create: `shared/claude-client/index.test.js`

- [ ] **Step 1: Create workspace root `package.json`**

```json
{
  "name": "clean-core-tools",
  "private": true,
  "workspaces": ["shared", "tool1-knowledge"],
  "scripts": {
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create `shared/package.json`**

```json
{
  "name": "@clean-core/shared",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  },
  "scripts": {
    "test": "jest"
  }
}
```

- [ ] **Step 3: Write failing test for ClaudeClient**

Create `shared/claude-client/index.test.js`:

```js
const { ClaudeClient } = require('./index');

describe('ClaudeClient', () => {
  test('constructor throws if ANTHROPIC_API_KEY is missing', () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new ClaudeClient()).toThrow('ANTHROPIC_API_KEY');
    process.env.ANTHROPIC_API_KEY = orig;
  });

  test('buildMessages returns correct structure', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const client = new ClaudeClient();
    const msgs = client.buildMessages('Hello');
    expect(msgs).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd shared && npx jest claude-client/index.test.js
```
Expected: FAIL — "Cannot find module './index'"

- [ ] **Step 5: Implement `shared/claude-client/index.js`**

```js
const Anthropic = require('@anthropic-ai/sdk');

class ClaudeClient {
  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = 'claude-sonnet-4-6';
  }

  buildMessages(userContent) {
    return [{ role: 'user', content: userContent }];
  }

  // Returns full text response
  async complete(systemPrompt, userContent) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: this.buildMessages(userContent),
    });
    return response.content[0].text;
  }

  // Yields text chunks for SSE streaming
  async *stream(systemPrompt, userContent) {
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: this.buildMessages(userContent),
    });
    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }
}

module.exports = { ClaudeClient };
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd shared && npx jest claude-client/index.test.js
```
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json shared/
git commit -m "feat: scaffold monorepo and shared ClaudeClient"
```

---

## Task 2: CAP Project Scaffold + CDS Service Definition

**Files:**
- Create: `tool1-knowledge/package.json`
- Create: `tool1-knowledge/.env.example`
- Create: `tool1-knowledge/srv/knowledge-service.cds`

- [ ] **Step 1: Create `tool1-knowledge/package.json`**

```json
{
  "name": "tool1-knowledge",
  "version": "1.0.0",
  "dependencies": {
    "@sap/cds": "^8.0.0",
    "@clean-core/shared": "*",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "supertest": "^6.0.0",
    "@sap/cds-dk": "^8.0.0"
  },
  "scripts": {
    "start": "cds-serve",
    "dev": "cds watch",
    "test": "jest"
  },
  "cds": {
    "requires": {
      "auth": "dummy"
    }
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```
ANTHROPIC_API_KEY=your_api_key_here
```

- [ ] **Step 3: Write failing test for CDS service endpoints**

Create `tool1-knowledge/srv/knowledge-service.test.js`:

```js
const cds = require('@sap/cds');
const supertest = require('supertest');

let app;

beforeAll(async () => {
  app = await cds.connect.to('KnowledgeService');
  // Use CDS test server
});

describe('POST /explain', () => {
  test('returns 400 if term is missing', async () => {
    const server = await cds.test('.').in(__dirname + '/..');
    const res = await supertest(server.app)
      .post('/odata/v4/knowledge/explain')
      .send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd tool1-knowledge && npx jest srv/knowledge-service.test.js
```
Expected: FAIL — service not yet defined

- [ ] **Step 5: Create `tool1-knowledge/srv/knowledge-service.cds`**

```cds
service KnowledgeService {

  // Tab 1: Concept explanation (streaming via SSE)
  action explain(term : String) returns String;

  // Tab 2: Object classification
  action classify(objects : array of String) returns array of {
    objectName : String;
    tier        : String;  // A, B, C, or D
    explanation : String;
    recommendation : String;
  };

  // Tab 3: Replacement API recommendation
  action recommend(deprecatedObject : String) returns array of {
    replacementName : String;
    type            : String;  // OData, RAP BO, CDS View, etc.
    migrationNote   : String;
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add tool1-knowledge/
git commit -m "feat: scaffold tool1 CAP project and CDS service definition"
```

---

## Task 3: System Prompts

**Files:**
- Create: `tool1-knowledge/srv/prompts.js`

- [ ] **Step 1: Write failing test for prompt builders**

Create `tool1-knowledge/srv/prompts.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tool1-knowledge && npx jest srv/prompts.test.js
```
Expected: FAIL — "Cannot find module './prompts'"

- [ ] **Step 3: Implement `tool1-knowledge/srv/prompts.js`**

```js
const SYSTEM_PROMPT = `
You are a SAP Clean Core expert assistant. Your job is to help SAP developers understand and apply Clean Core principles.

## SAP Clean Core Overview
SAP Clean Core means keeping the SAP S/4HANA system close to standard by avoiding or minimizing custom modifications to the core system. This ensures easier upgrades, cloud readiness, and lower total cost of ownership.

## SAP Extensibility Tiers
- **Tier 1 (On-Stack, Key User):** No-code/low-code extensions using SAP-provided tools (Custom Fields, Custom Logic via BAdIs in UI). Fully upgrade-safe. Examples: Custom Fields and Logic app, SAP AppGyver.
- **Tier 2 (On-Stack, Developer):** ABAP Cloud development using only Released APIs (C1-released objects). Extensions stay in a separate namespace. Examples: RAP BOs, CDS Views marked as Released.
- **Tier 3 (Side-by-Side):** Extensions deployed outside S/4HANA on SAP BTP. Communicate via stable APIs (OData, Events). Fully decoupled from the core.

## SAP Object Classification (Clean Core Tiers A/B/C/D)
- **A — Fully Compliant:** Released API (C1), safe to use in cloud/upgrade scenarios. Examples: CDS Views with @VDM.viewType, OData services in API Business Hub, RAP Business Objects.
- **B — Conditionally Compliant:** Not officially released but low modification risk. Internal SAP tables accessed via stable views, classic BAPIs still maintained. Use only if no A-tier alternative exists.
- **C — Non-Compliant (Legacy):** Classic enhancements, implicit enhancements, classic BAdIs (not released), direct table modifications via SE16/SE11 in production. Must be migrated.
- **D — Deprecated / Forbidden:** Objects SAP has explicitly deprecated or forbidden for cloud: direct DB table writes to SAP tables (no API), obsolete FMs without C1 release, SAP_BASIS modifications.

## Common Migration Paths
- Classic BAPI → OData V4 API (API Business Hub) or RAP Business Object
- SE16 table browsing → Custom CDS View with proper authorization
- Classic BAdI (non-released) → Released BAdI via ABAP Cloud
- Direct table SELECT on SAP tables → CDS View (C1 released)
- Function Module extractors (BW) → CDS-based extraction via amdp or released CDS View

Always respond in the same language the user asks in. Be concise but precise.
`;

function buildExplainPrompt(term) {
  return `Explain the following SAP Clean Core concept in plain language suitable for an SAP developer who is new to Clean Core: "${term}". Include a practical example if possible. Keep it under 300 words.`;
}

function buildClassifyPrompt(objects) {
  const list = objects.map((o, i) => `${i + 1}. ${o}`).join('\n');
  return `Classify each of the following SAP objects according to the Clean Core A/B/C/D tier system described in your system prompt. Return ONLY a JSON array with no markdown fences, where each element has these exact fields: objectName, tier (A/B/C/D), explanation (1-2 sentences), recommendation (what the developer should do).

Objects to classify:
${list}`;
}

function buildRecommendPrompt(deprecatedObject) {
  return `For the deprecated or non-compliant SAP object "${deprecatedObject}", provide replacement recommendations. Return ONLY a JSON array with no markdown fences, where each element has: replacementName, type (one of: OData API, RAP BO, CDS View, Released BAdI, Key User Extension, Side-by-Side BTP), migrationNote (2-3 sentences describing how to migrate).`;
}

module.exports = { SYSTEM_PROMPT, buildExplainPrompt, buildClassifyPrompt, buildRecommendPrompt };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tool1-knowledge && npx jest srv/prompts.test.js
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add tool1-knowledge/srv/prompts.js tool1-knowledge/srv/prompts.test.js
git commit -m "feat: add Clean Core system prompt and user prompt builders"
```

---

## Task 4: CAP Service Handler

**Files:**
- Create: `tool1-knowledge/srv/knowledge-service.js`

- [ ] **Step 1: Write failing integration test**

Add to `tool1-knowledge/srv/knowledge-service.test.js` (replace the placeholder):

```js
const cds = require('@sap/cds/lib');
const supertest = require('supertest');

// Mock ClaudeClient to avoid real API calls in tests
jest.mock('@clean-core/shared/claude-client', () => ({
  ClaudeClient: jest.fn().mockImplementation(() => ({
    complete: jest.fn().mockResolvedValue(
      '[{"objectName":"SE16","tier":"C","explanation":"Classic transaction.","recommendation":"Use CDS View instead."}]'
    ),
    stream: jest.fn(async function* () { yield 'RAP stands for'; yield ' RESTful ABAP Programming.'; }),
  })),
}));

let server;
beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  server = await cds.test('.').in(__dirname + '/..');
});

afterAll(() => cds.shutdown());

test('POST /odata/v4/knowledge/explain returns 400 without term', async () => {
  const res = await supertest(server.app)
    .post('/odata/v4/knowledge/explain')
    .set('Content-Type', 'application/json')
    .send({});
  expect(res.status).toBe(400);
});

test('POST /odata/v4/knowledge/classify returns classification array', async () => {
  const res = await supertest(server.app)
    .post('/odata/v4/knowledge/classify')
    .set('Content-Type', 'application/json')
    .send({ objects: ['SE16'] });
  expect(res.status).toBe(200);
  const body = res.body.value;
  expect(body[0].objectName).toBe('SE16');
  expect(body[0].tier).toBe('C');
});

test('POST /odata/v4/knowledge/recommend returns recommendation array', async () => {
  const res = await supertest(server.app)
    .post('/odata/v4/knowledge/recommend')
    .set('Content-Type', 'application/json')
    .send({ deprecatedObject: 'BAPI_MATERIAL_SAVEDATA' });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tool1-knowledge && npx jest srv/knowledge-service.test.js
```
Expected: FAIL — handler not implemented

- [ ] **Step 3: Implement `tool1-knowledge/srv/knowledge-service.js`**

```js
const cds = require('@sap/cds');
const { ClaudeClient } = require('@clean-core/shared/claude-client');
const { SYSTEM_PROMPT, buildExplainPrompt, buildClassifyPrompt, buildRecommendPrompt } = require('./prompts');

module.exports = cds.service.impl(async function (srv) {
  const claude = new ClaudeClient();

  // Tab 1: Explanation — streams via SSE when client requests it,
  // falls back to full response for OData action calls
  srv.on('explain', async (req) => {
    const { term } = req.data;
    if (!term || !term.trim()) {
      return req.error(400, 'term is required');
    }
    const result = await claude.complete(SYSTEM_PROMPT, buildExplainPrompt(term));
    return result;
  });

  // Tab 2: Classification
  srv.on('classify', async (req) => {
    const { objects } = req.data;
    if (!objects || objects.length === 0) {
      return req.error(400, 'objects array is required');
    }
    const raw = await claude.complete(SYSTEM_PROMPT, buildClassifyPrompt(objects));
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return req.error(502, 'Claude returned invalid JSON for classification');
    }
    return parsed;
  });

  // Tab 3: Replacement recommendation
  srv.on('recommend', async (req) => {
    const { deprecatedObject } = req.data;
    if (!deprecatedObject || !deprecatedObject.trim()) {
      return req.error(400, 'deprecatedObject is required');
    }
    const raw = await claude.complete(SYSTEM_PROMPT, buildRecommendPrompt(deprecatedObject));
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return req.error(502, 'Claude returned invalid JSON for recommendations');
    }
    return parsed;
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tool1-knowledge && npx jest srv/
```
Expected: PASS (all tests in prompts.test.js + knowledge-service.test.js)

- [ ] **Step 5: Commit**

```bash
git add tool1-knowledge/srv/knowledge-service.js tool1-knowledge/srv/knowledge-service.test.js
git commit -m "feat: implement KnowledgeService CAP handler with Claude integration"
```

---

## Task 5: SSE Streaming Endpoint

**Files:**
- Modify: `tool1-knowledge/srv/knowledge-service.js` — add SSE route via express middleware

The OData action for `/explain` returns full text. For streaming, we add a dedicated `/stream/explain` Express route alongside the CAP OData service.

- [ ] **Step 1: Write failing test for SSE endpoint**

Add to `tool1-knowledge/srv/knowledge-service.test.js`:

```js
test('GET /stream/explain streams SSE chunks', async () => {
  const res = await supertest(server.app)
    .get('/stream/explain?term=RAP')
    .set('Accept', 'text/event-stream');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  // The mock yields 'RAP stands for' + ' RESTful ABAP Programming.'
  expect(res.text).toContain('data:');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tool1-knowledge && npx jest --testNamePattern="SSE"
```
Expected: FAIL — `/stream/explain` route not found

- [ ] **Step 3: Add SSE middleware to `knowledge-service.js`**

Add at the bottom of the `module.exports = cds.service.impl(...)` function, after the `srv.on('recommend', ...)` block:

```js
  // SSE streaming endpoint — mounted on the Express app at CAP bootstrap
  cds.on('bootstrap', (app) => {
    app.get('/stream/explain', async (req, res) => {
      const term = req.query.term;
      if (!term) {
        res.status(400).json({ error: 'term query parameter is required' });
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        for await (const chunk of claude.stream(SYSTEM_PROMPT, buildExplainPrompt(term))) {
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      } finally {
        res.end();
      }
    });
  });
```

- [ ] **Step 4: Run tests**

```bash
cd tool1-knowledge && npx jest srv/
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add tool1-knowledge/srv/knowledge-service.js
git commit -m "feat: add SSE streaming endpoint for concept explanation"
```

---

## Task 6: UI5 Frontend — Scaffold

**Files:**
- Create: `tool1-knowledge/app/knowledge/webapp/index.html`
- Create: `tool1-knowledge/app/knowledge/webapp/manifest.json`
- Create: `tool1-knowledge/app/knowledge/webapp/Component.js`
- Create: `tool1-knowledge/app/knowledge/xs-app.json`

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Clean Core Knowledge</title>
  <script id="sap-ui-bootstrap"
    src="https://ui5.sap.com/1.120/resources/sap-ui-core.js"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-resourceroots='{"knowledge": "./"}'
    data-sap-ui-compatVersion="edge"
    data-sap-ui-oninit="module:sap/ui/core/ComponentSupport"
    data-sap-ui-async="true">
  </script>
</head>
<body class="sapUiBody">
  <div data-sap-ui-component data-name="knowledge" data-id="container"
       data-settings='{"id":"knowledge"}'></div>
</body>
</html>
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "_version": "1.65.0",
  "sap.app": {
    "id": "knowledge",
    "type": "application",
    "title": "Clean Core Knowledge",
    "description": "Learn SAP Clean Core concepts",
    "applicationVersion": { "version": "1.0.0" },
    "dataSources": {
      "KnowledgeService": {
        "uri": "/odata/v4/knowledge/",
        "type": "OData",
        "settings": { "odataVersion": "4.0" }
      }
    }
  },
  "sap.ui": { "technology": "UI5" },
  "sap.ui5": {
    "rootView": {
      "viewName": "knowledge.view.App",
      "type": "XML",
      "async": true,
      "id": "app"
    },
    "dependencies": {
      "minUI5Version": "1.120.0",
      "libs": { "sap.m": {}, "sap.ui.core": {} }
    },
    "models": {
      "": {
        "dataSource": "KnowledgeService",
        "settings": { "synchronizationMode": "None", "operationMode": "Server" }
      }
    },
    "routing": {}
  }
}
```

- [ ] **Step 3: Create `Component.js`**

```js
sap.ui.define(['sap/ui/core/UIComponent'], function (UIComponent) {
  'use strict';
  return UIComponent.extend('knowledge.Component', {
    metadata: { manifest: 'json' },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
    }
  });
});
```

- [ ] **Step 4: Create `xs-app.json`**

```json
{
  "welcomeFile": "/index.html",
  "routes": [
    {
      "source": "^/odata/v4/(.*)$",
      "destination": "knowledge-srv",
      "authenticationType": "none"
    },
    {
      "source": "^/stream/(.*)$",
      "destination": "knowledge-srv",
      "authenticationType": "none"
    },
    {
      "source": "^(.*)$",
      "localDir": "webapp",
      "authenticationType": "none"
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add tool1-knowledge/app/
git commit -m "feat: scaffold UI5 app for tool1 knowledge"
```

---

## Task 7: UI5 Frontend — App View & Controller

**Files:**
- Create: `tool1-knowledge/app/knowledge/webapp/view/App.view.xml`
- Create: `tool1-knowledge/app/knowledge/webapp/controller/App.controller.js`

- [ ] **Step 1: Create `App.view.xml`**

```xml
<mvc:View
  controllerName="knowledge.controller.App"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  displayBlock="true">
  <Shell>
    <App>
      <pages>
        <Page title="Clean Core Knowledge">
          <content>
            <IconTabBar id="tabBar" select=".onTabSelect" expanded="true">

              <!-- Tab 1: Concept Explanation -->
              <items>
                <IconTabFilter text="概念解读" icon="sap-icon://learning-assistant" key="explain">
                  <content>
                    <VBox class="sapUiSmallMargin" width="100%">
                      <SearchField id="explainInput" placeholder="输入 Clean Core 概念，例如：RAP, Tier 1, Stable API"
                        search=".onExplain" width="100%" />
                      <BusyIndicator id="explainBusy" visible="false" />
                      <FormattedText id="explainResult"
                        htmlText=""
                        class="sapUiSmallMarginTop"
                        width="100%" />
                    </VBox>
                  </content>
                </IconTabFilter>

                <!-- Tab 2: Object Classification -->
                <IconTabFilter text="对象分级" icon="sap-icon://classify" key="classify">
                  <content>
                    <VBox class="sapUiSmallMargin" width="100%">
                      <TextArea id="classifyInput"
                        placeholder="输入 SAP 对象名，每行一个，例如：&#xa;BAPI_MATERIAL_SAVEDATA&#xa;SE16"
                        rows="5" width="100%" />
                      <Button text="开始分级" press=".onClassify" type="Emphasized"
                        class="sapUiSmallMarginTop" />
                      <BusyIndicator id="classifyBusy" visible="false" />
                      <Table id="classifyTable" class="sapUiSmallMarginTop"
                        items="{/classifyResults}" visible="{= ${/classifyResults} !== undefined}">
                        <columns>
                          <Column><Text text="对象名" /></Column>
                          <Column><Text text="等级" /></Column>
                          <Column><Text text="说明" /></Column>
                          <Column><Text text="建议行动" /></Column>
                        </columns>
                        <items>
                          <ColumnListItem>
                            <cells>
                              <Text text="{objectName}" />
                              <ObjectStatus
                                text="{tier}"
                                state="{= ${tier} === 'A' ? 'Success' : ${tier} === 'B' ? 'Warning' : 'Error'}" />
                              <Text text="{explanation}" wrapping="true" />
                              <Text text="{recommendation}" wrapping="true" />
                            </cells>
                          </ColumnListItem>
                        </items>
                      </Table>
                    </VBox>
                  </content>
                </IconTabFilter>

                <!-- Tab 3: Replacement API -->
                <IconTabFilter text="替代 API" icon="sap-icon://activity-2" key="recommend">
                  <content>
                    <VBox class="sapUiSmallMargin" width="100%">
                      <SearchField id="recommendInput"
                        placeholder="输入废弃对象名，例如：BAPI_MATERIAL_SAVEDATA"
                        search=".onRecommend" width="100%" />
                      <BusyIndicator id="recommendBusy" visible="false" />
                      <List id="recommendList" class="sapUiSmallMarginTop"
                        items="{/recommendResults}" visible="{= ${/recommendResults} !== undefined}">
                        <items>
                          <StandardListItem
                            title="{replacementName}"
                            description="{migrationNote}"
                            info="{type}"
                            infoState="Success" />
                        </items>
                      </List>
                    </VBox>
                  </content>
                </IconTabFilter>
              </items>
            </IconTabBar>
          </content>
        </Page>
      </pages>
    </App>
  </Shell>
</mvc:View>
```

- [ ] **Step 2: Create `App.controller.js`**

```js
sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
  'sap/m/MessageBox'
], function (Controller, JSONModel, MessageToast, MessageBox) {
  'use strict';

  return Controller.extend('knowledge.controller.App', {

    onInit: function () {
      this.getView().setModel(new JSONModel({}));
    },

    // Tab 1: Stream explanation via SSE
    onExplain: function (oEvent) {
      const term = oEvent.getParameter('query') || oEvent.getSource().getValue();
      if (!term.trim()) { return; }

      const resultControl = this.byId('explainResult');
      const busyIndicator = this.byId('explainBusy');

      resultControl.setHtmlText('');
      busyIndicator.setVisible(true);

      let accumulated = '';
      const evtSource = new EventSource(`/stream/explain?term=${encodeURIComponent(term)}`);

      evtSource.onmessage = (e) => {
        if (e.data === '[DONE]') {
          evtSource.close();
          busyIndicator.setVisible(false);
          return;
        }
        try {
          const chunk = JSON.parse(e.data);
          if (chunk.error) {
            MessageBox.error(chunk.error);
            evtSource.close();
            busyIndicator.setVisible(false);
            return;
          }
          accumulated += chunk.text;
          // Convert newlines to <br> for FormattedText
          resultControl.setHtmlText(accumulated.replace(/\n/g, '<br>'));
        } catch { /* ignore parse errors on partial chunks */ }
      };

      evtSource.onerror = () => {
        evtSource.close();
        busyIndicator.setVisible(false);
        MessageBox.error('连接失败，请重试');
      };
    },

    // Tab 2: Classify objects
    onClassify: function () {
      const input = this.byId('classifyInput').getValue().trim();
      if (!input) { MessageToast.show('请输入至少一个对象名'); return; }

      const objects = input.split('\n').map(s => s.trim()).filter(Boolean);
      const model = this.getView().getModel();
      const busyIndicator = this.byId('classifyBusy');

      busyIndicator.setVisible(true);
      model.setProperty('/classifyResults', undefined);

      fetch('/odata/v4/knowledge/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects })
      })
        .then(r => r.json())
        .then(data => {
          model.setProperty('/classifyResults', data.value || data);
          busyIndicator.setVisible(false);
        })
        .catch(err => {
          busyIndicator.setVisible(false);
          MessageBox.error('分级失败：' + err.message);
        });
    },

    // Tab 3: Recommend replacements
    onRecommend: function (oEvent) {
      const deprecatedObject = oEvent.getParameter('query') || oEvent.getSource().getValue();
      if (!deprecatedObject.trim()) { return; }

      const model = this.getView().getModel();
      const busyIndicator = this.byId('recommendBusy');

      busyIndicator.setVisible(true);
      model.setProperty('/recommendResults', undefined);

      fetch('/odata/v4/knowledge/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deprecatedObject })
      })
        .then(r => r.json())
        .then(data => {
          model.setProperty('/recommendResults', data.value || data);
          busyIndicator.setVisible(false);
        })
        .catch(err => {
          busyIndicator.setVisible(false);
          MessageBox.error('推荐失败：' + err.message);
        });
    }
  });
});
```

- [ ] **Step 3: Install dependencies and start dev server to verify visually**

```bash
cd tool1-knowledge && npm install
cp .env.example .env
# Edit .env and set your real ANTHROPIC_API_KEY
npm run dev
```
Expected: CDS watch starts, open http://localhost:4004 — see UI5 app with 3 tabs.

- [ ] **Step 4: Run all tests**

```bash
cd tool1-knowledge && npx jest
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tool1-knowledge/app/
git commit -m "feat: complete UI5 frontend for tool1 with 3-tab layout and SSE streaming"
```

---

## Task 8: End-to-End Smoke Test

**Files:**
- Create: `tool1-knowledge/srv/e2e.test.js`

This test makes real Claude API calls. It is skipped in CI unless `RUN_E2E=true` is set.

- [ ] **Step 1: Create `e2e.test.js`**

```js
const cds = require('@sap/cds/lib');
const supertest = require('supertest');

const runE2E = process.env.RUN_E2E === 'true';
const maybeDescribe = runE2E ? describe : describe.skip;

maybeDescribe('E2E: real Claude API calls', () => {
  let server;
  beforeAll(async () => {
    server = await cds.test('.').in(__dirname + '/..');
  });
  afterAll(() => cds.shutdown());

  test('explain RAP returns non-empty text', async () => {
    const res = await supertest(server.app)
      .post('/odata/v4/knowledge/explain')
      .send({ term: 'RAP' });
    expect(res.status).toBe(200);
    expect(res.body.value.length).toBeGreaterThan(50);
  }, 30000);

  test('classify SE16 returns tier C or D', async () => {
    const res = await supertest(server.app)
      .post('/odata/v4/knowledge/classify')
      .send({ objects: ['SE16'] });
    expect(res.status).toBe(200);
    const result = res.body.value[0];
    expect(['C', 'D']).toContain(result.tier);
  }, 30000);
});
```

- [ ] **Step 2: Run unit tests (E2E skipped)**

```bash
cd tool1-knowledge && npx jest
```
Expected: PASS, E2E suite marked as skipped.

- [ ] **Step 3: Final commit**

```bash
git add tool1-knowledge/srv/e2e.test.js
git commit -m "test: add E2E smoke tests for tool1 (skipped unless RUN_E2E=true)"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Tab 1 (explain + SSE) ✓, Tab 2 (classify table) ✓, Tab 3 (recommend list) ✓, CAP backend ✓, shared ClaudeClient ✓, monorepo structure ✓
- [x] **Placeholder scan:** No TBDs. All code blocks are complete.
- [x] **Type consistency:** `ClaudeClient.complete()` and `ClaudeClient.stream()` defined in Task 1 and used in Tasks 4–5 consistently. CDS action signatures in Task 2 match handler parameters in Task 4.
