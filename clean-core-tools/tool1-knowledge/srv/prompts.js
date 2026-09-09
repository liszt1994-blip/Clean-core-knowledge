// tool1-knowledge/srv/prompts.js
const { CLEAN_CORE_SYSTEM_PROMPT } = require('../src/aicore-client');

// Re-export SYSTEM_PROMPT for backwards compatibility
const SYSTEM_PROMPT = CLEAN_CORE_SYSTEM_PROMPT;

// ── Tab 1: Concept Explanation ─────────────────────────────────────────────
function buildExplainPrompt(term, lang = 'zh') {
  if (lang === 'en') {
    return (
      `Explain the following SAP Clean Core concept or object in English, targeted at SAP developers ` +
      `who are new to Clean Core. Keep the language clear and concise, give a practical example where ` +
      `possible, and keep the answer within 400 words.\n\n` +
      `Important requirements:\n` +
      `- If it involves replacement APIs or migration approaches, only give generic, cross-business-scenario alternatives\n` +
      `- Do not infer replacement APIs based on a specific business domain (e.g. sales orders, purchase orders)\n` +
      `- The alternatives should apply to all scenarios that use this object\n\n` +
      `Topic: "${term}".`
    );
  }
  return (
    `请用中文解释以下 SAP Clean Core 概念或对象，面向刚接触 Clean Core 的 SAP 开发者，` +
    `语言简洁易懂，如有可能请给出实际示例，回答控制在 400 字以内。\n\n` +
    `重要要求：\n` +
    `- 如果涉及替代 API 或迁移方案，只给出通用的、跨业务场景的替代方案\n` +
    `- 不要根据某个特定业务领域（如销售订单、采购单）来推断替代 API\n` +
    `- 替代方案应适用于所有使用该对象的场景\n\n` +
    `主题："${term}"。`
  );
}

// ── Tab 2: Classification — AI fallback (object not found in local JSON) ───
// Used when ClassificationClient.lookup() returns null.
function buildClassifyPrompt(objects, lang = 'zh') {
  const list = objects.map((o, i) => `${i + 1}. ${o}`).join('\n');
  const langNote = lang === 'en'
    ? `\n\nThe "explanation" and "recommendation" fields must be written in English.`
    : `\n\nThe "explanation" and "recommendation" fields must be written in Chinese (简体中文).`;
  return (
    `Classify each of the following SAP objects according to the Clean Core A/B/C/D tier system ` +
    `described in your system prompt.\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have exactly these fields:\n` +
    `- objectName  (string)\n` +
    `- tier        (string: "A", "B", "C", or "D")\n` +
    `- state       (string: "released" | "deprecated" | "notToBeReleased" | "classicAPI" | "noAPI" | "unknown")\n` +
    `- explanation (string: 1-2 sentences describing why it has this tier)\n` +
    `- recommendation (string: what the developer should do)\n` +
    `- source      (string: always "ai-inference" for objects classified by this prompt)\n\n` +
    `Objects to classify:\n${list}` + langNote
  );
}

// ── Tab 2: Classification — AI fallback for a single object ───────────────
// Used when an individual object is not in the JSON; returns single-element array.
function buildSingleClassifyPrompt(objectName, lang = 'zh') {
  return buildClassifyPrompt([objectName], lang);
}

// ── Tab 3: Replacement — AI generates migrationNote for known successors ──
// Used when ClassificationClient.lookup() found successors but no note.
function buildMigrationNotePrompt(deprecatedObject, successors, lang = 'zh') {
  const succList = successors
    .map(s => `- ${s.name} (${s.type})`)
    .join('\n');
  const langNote = lang === 'en'
    ? `\n\nThe "migrationNote" field must be written in English.`
    : `\n\nThe "migrationNote" field must be written in Chinese (简体中文).`;
  return (
    `For the deprecated SAP object "${deprecatedObject}", the official successors are:\n` +
    `${succList}\n\n` +
    `For each successor, provide a short migrationNote (2-3 sentences) explaining how to migrate ` +
    `from "${deprecatedObject}" to that successor.\n` +
    `Focus on the GENERIC, domain-agnostic migration path — do not assume any specific business context ` +
    `(e.g. do not tailor the advice to Sales Orders, Finance, or any specific module unless the object ` +
    `itself is domain-specific).\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have:\n` +
    `- replacementName (string)\n` +
    `- type            (string: the successor type as listed above)\n` +
    `- migrationNote   (string: 2-3 sentences on how to migrate, generic context)\n` +
    `- source          (string: "official-json+ai-note")` + langNote
  );
}

// ── Tab 3: Replacement — full AI recommendation (object not in JSON) ───────
function buildRecommendPrompt(deprecatedObject, lang = 'zh') {
  const langNote = lang === 'en'
    ? `\n\nThe "migrationNote" field must be written in English.`
    : `\n\nThe "migrationNote" field must be written in Chinese (简体中文).`;
  return (
    `For the deprecated or non-compliant SAP object "${deprecatedObject}", provide replacement ` +
    `recommendations.\n\n` +
    `IMPORTANT rules:\n` +
    `- Recommend GENERIC, universally applicable replacements — do NOT suggest business-domain-specific APIs ` +
    `(e.g. do not recommend a Sales Order API as a replacement for a general text-reading function module).\n` +
    `- Focus on the core technical purpose of "${deprecatedObject}" and suggest the standard Clean Core ` +
    `alternative that serves the same purpose across all business contexts.\n` +
    `- Prefer: Released ABAP APIs, standard CDS Views, RAP BOs, or BTP side-by-side extensions that are ` +
    `domain-agnostic.\n` +
    `- Return 3 to 5 replacement options where available, covering different migration approaches ` +
    `(e.g. OData API, RAP BO, Released FM, CDS View, BTP side-by-side). More options are better.\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have:\n` +
    `- replacementName (string)\n` +
    `- type            (string: one of OData API, RAP BO, CDS View, Released FM, Released BAdI, Key User Extension, Side-by-Side BTP)\n` +
    `- migrationNote   (string: 1-2 concise sentences on how to migrate, generic context)\n` +
    `- source          (string: always "ai-inference" for objects recommended by this prompt)` + langNote
  );
}

// ── Tab 4: SAP Note Search — translate user query to English ─────────────────
// AI translates Chinese/other-language queries to English SAP technical terms.
// Returns plain English string (no JSON), used as the search keyword.
function buildTranslateQueryPrompt(query) {
  return (
    `Translate the following SAP-related search query into concise English technical terms ` +
    `suitable for searching SAP documentation and Notes. ` +
    `If the query is already in English, return it as-is (you may improve phrasing). ` +
    `Return ONLY the translated search terms, no explanations, no quotes.\n\n` +
    `Query: ${query}`
  );
}

// ── Tab 4: SAP Note Search — AI re-ranking of Help Portal results ─────────────
// Given the user's original query and a list of candidate results from SAP Help Portal,
// ask AI to select and re-rank the most relevant ones.
function buildRerankPrompt(originalQuery, candidates) {
  const list = candidates.map((c, i) =>
    `${i}: ${c.title} [${c.product}]`
  ).join('\n');
  return (
    `The user searched for: "${originalQuery}"\n\n` +
    `The following documents were returned by SAP Help Portal (index: title [product]):\n` +
    `${list}\n\n` +
    `Select the indices of the most relevant documents to this query, ordered from most to least relevant. ` +
    `Only include documents that are genuinely relevant — exclude unrelated ones. ` +
    `Return ONLY a JSON array of indices (numbers), e.g. [3, 0, 7]. No explanation, no markdown.`
  );
}


// Used when DestinationClient successfully fetched the Note page text.
function buildNoteSummaryFromContentPrompt(noteNumber, rawContent) {
  return (
    `The following is the extracted text content from SAP Note ${noteNumber}:\n\n` +
    `---\n${rawContent}\n---\n\n` +
    `Based on this actual Note content, provide a JSON object with:\n` +
    `- title        (string: the Note title)\n` +
    `- summary      (string: 3-5 sentences summarizing what this Note covers, the problem it addresses, and how it helps)\n` +
    `- releaseDate  (string: release or validity date if mentioned, otherwise "")\n\n` +
    `Return ONLY a JSON object with no markdown fences.`
  );
}

// ── Agent chat: intent detection ──────────────────────────────────────────
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
function buildRewriteCodePrompt(code, violations) {
  const violationList = violations
    .map(v => {
      const repl = v.replacement
        ? `→ ${v.replacementType ? v.replacementType + ' ' : ''}${v.replacement}`
        : `(Tier ${v.tier || '?'} — choose the best Clean Core alternative)`;
      return `- ${v.objectName} ${repl}`;
    })
    .join('\n');

  return (
    `Rewrite the following ABAP code to be SAP Clean Core compliant.\n\n` +
    `Required replacements:\n${violationList}\n\n` +
    `Rules:\n` +
    `1. Preserve all business logic exactly — only replace non-compliant API calls\n` +
    `2. Replace each listed object with its Clean Core alternative. ` +
    `If no replacement is specified above, use your knowledge to choose the best released API, CDS View, or RAP BO.\n` +
    `3. CRITICAL: Keep the output in standard ABAP syntax. Do NOT use RAP EML statements ` +
    `(READ ENTITIES OF, MODIFY ENTITIES OF, etc.) unless the original code is already EML. ` +
    `Use released ABAP APIs (CALL FUNCTION, CALL METHOD, etc.) in standard ABAP style.\n` +
    `4. Add a comment "* Clean Core: replaced X with Y" on the line of each change\n` +
    `5. If a replacement requires additional DATA declarations, add them near the top\n` +
    `6. Keep all other code unchanged\n\n` +
    `Return ONLY a valid JSON object with no markdown fences and no explanation text before or after it. ` +
    `Your entire response must start with { and end with }. ` +
    `IMPORTANT: The "rewritten" value must be a valid JSON string — ` +
    `escape all newlines as \\n, all double-quotes as \\", all backslashes as \\\\.\n` +
    `{ "rewritten": "<rewritten code with \\n for newlines>" }\n\n` +
    `Original ABAP code:\n\`\`\`abap\n${code}\n\`\`\``
  );
}

function buildExtractObjectsPrompt(message) {
  return (
    `From the following user message, extract all SAP object names (function modules, BAPIs, ` +
    `database tables, transaction codes, classes, etc.) that the user wants to look up.\n\n` +
    `Rules:\n` +
    `- SAP object names are typically UPPERCASE, often contain underscores\n` +
    `- Ignore Chinese/English words that are not object names (e.g. "的分级", "API替代", "查询")\n` +
    `- Return an empty array if no object names are found\n\n` +
    `User message:\n"""\n${message}\n"""\n\n` +
    `Return ONLY a JSON array of strings, no markdown fences. Example: ["READ_TEXT", "BAPI_CONTRACT_CREATEFROMDATA"]`
  );
}

// ── Tab 4 BTP: BTP Knowledge Q&A ─────────────────────────────────────────────
function buildBtpAnswerPrompt(query, searchResults, lang = 'zh') {
  const BTP_SOURCES = [
    'https://help.sap.com/docs/btp',
    'https://help.sap.com/docs/btp/sap-business-technology-platform/sap-business-technology-platform',
    'https://help.sap.com/docs/btp/sap-btp-neo-environment/sap-btp-neo-environment',
    'https://help.sap.com/docs/btp/sap-btp-cloud-foundry-environment/cloud-foundry-environment',
    'https://help.sap.com/docs/btp/sap-btp-kyma-runtime/kyma-environment',
    'https://discovery-center.cloud.sap/serviceCatalog',
    'https://api.sap.com',
  ];

  if (lang === 'en') {
    const snippetsEn = searchResults
      .slice(0, 8)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    Summary: ${r.summary || '(no summary)'}`)
      .join('\n\n');
    return (
      `You are an SAP BTP development expert. Answer the user's question based on the reference material below.\n\n` +
      `## Authoritative documentation sources\n${BTP_SOURCES.map(u => '- ' + u).join('\n')}\n\n` +
      `## Relevant snippets found\n${snippetsEn || '(no relevant snippets found)'}\n\n` +
      `## User question\n${query}\n\n` +
      `## Answer requirements\n` +
      `- Answer in English, well-structured, suitable for BTP developers\n` +
      `- Base the answer on the reference material above combined with your BTP knowledge\n` +
      `- If you cite a snippet, mark the source number in brackets at the end of the sentence (e.g. Cloud Foundry supports multiple runtimes [2])\n` +
      `- Keep the answer within 600 words; use lists for steps\n` +
      `- Do not repeat the question, answer directly`
    );
  }

  const snippets = searchResults
    .slice(0, 8)
    .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    摘要: ${r.summary || '（无摘要）'}`)
    .join('\n\n');

  return (
    `你是 SAP BTP 开发专家，请根据以下参考资料回答用户问题。\n\n` +
    `## 权威文档来源\n${BTP_SOURCES.map(u => '- ' + u).join('\n')}\n\n` +
    `## 搜索到的相关片段\n${snippets || '（未找到相关片段）'}\n\n` +
    `## 用户问题\n${query}\n\n` +
    `## 回答要求\n` +
    `- 用简体中文回答，条理清晰，适合 BTP 开发者阅读\n` +
    `- 回答基于上方参考资料和你的 BTP 知识综合给出\n` +
    `- 如引用了某个片段，在句末用 [数字] 标注来源编号（如：Cloud Foundry 支持多语言运行时 [2]）\n` +
    `- 回答控制在 600 字以内，如有步骤请用列表格式\n` +
    `- 不要重复问题，直接给出答案`
  );
}

// ── Tab 4 BTP: BTP Development Guide ─────────────────────────────────────────
function buildBtpGuidePrompt(domain, scenario, apiResults, groundingContext = '', lang = 'zh') {
  if (lang === 'en') {
    const domainLabelEn = {
      procurement: 'Procurement',
      sales:       'Sales',
      finance:     'Finance',
      hr:          'HR',
      inventory:   'Inventory',
    }[domain] || domain;

    const apiListEn = apiResults.length > 0
      ? apiResults.map((a, i) =>
          `${i + 1}. **${a.name}** (${a.protocol})${a.deprecated ? ' ⚠️ **[DEPRECATED]**' : ''}\n` +
          `   - Description: ${a.description}\n` +
          (a.deprecated ? `   - ⛔ This API is deprecated, use instead: ${a.successor || 'see official docs for the replacement'}\n` : '') +
          `   - Endpoint: \`${a.endpoint || ''}\`\n` +
          `   - Key entities: ${(a.keyEntities || []).join(', ')}\n` +
          `   - Docs: ${a.url}`
        ).join('\n\n')
      : '(please search relevant APIs at https://api.sap.com)';

    return (
      `You are an experienced SAP BTP development consultant. You need to produce a complete development ` +
      `guide about the "${domainLabelEn}" business scenario for a developer with **no prior BTP experience**.\n\n` +
      `## The user's business scenario\n${scenario || 'Build a ' + domainLabelEn + '-related application on SAP BTP'}\n\n` +
      `## Available relevant APIs\n${apiListEn}\n\n` +
      `## Generate the complete guide with the following structure (in English, Markdown format):\n\n` +
      `### 1. Prerequisites\n` +
      `List the BTP services to provision (service name + purpose + suggested plan) as a table.\n` +
      `Then give the concrete steps to configure the BTP account (with descriptive text for screenshots).\n` +
      `Finally list local dev environment requirements: Node.js version, npm packages to install, VS Code plugins.\n\n` +
      `### 2. Architecture recommendation\n` +
      `Recommend a runtime (Cloud Foundry or Kyma) and explain why.\n` +
      `Describe the app architecture in text: frontend (SAP Fiori/UI5) → backend (CAP/Node.js) → S/4HANA API → S/4HANA system.\n\n` +
      `### 3. Step-by-step development workflow\n` +
      `**Must include at least 7 steps**, each formatted as:\n` +
      `**Step N: [step name]**\n` +
      `Goal: xxx\n` +
      `Actions: concrete commands or instructions\n` +
      `Code example (if any):\n` +
      `\`\`\`javascript\n// code\n\`\`\`\n\n` +
      `Step order: create BTP project → configure Destination → build CAP backend → integrate S/4HANA API → develop frontend UI → local testing → deploy to CF/Kyma\n\n` +
      `### 4. Detailed usage of the core APIs\n` +
      `**For every API listed above, include the following:**\n\n` +
      `#### API name\n` +
      `**Purpose**: what business problem this API solves\n\n` +
      `**Authentication**: how to obtain the OAuth token, via BTP Destination Service or direct call\n\n` +
      `**Key operation examples**:\n` +
      `- Read data (GET):\n` +
      `\`\`\`javascript\n// complete runnable Node.js/axios example, including URL, headers, params\n\`\`\`\n` +
      `- Create data (POST):\n` +
      `\`\`\`javascript\n// complete runnable example, including request body structure\n\`\`\`\n\n` +
      `**Sample response structure** (JSON snippet)\n\n` +
      `**Caveats**: permissions, CSRF token, pagination, etc.\n\n` +
      `### 5. Common issues and solutions\n` +
      `List the 5 most common beginner problems, each with concrete resolution steps.\n\n` +
      `Requirement: all code examples must be complete and runnable, use the axios library, include error handling.` +
      (groundingContext
        ? `\n\n## The following relevant content was retrieved from official docs, please prioritize it:\n\n${groundingContext}`
        : '')
    );
  }

  const domainLabel = {
    procurement: '采购（Procurement）',
    sales:       '销售（Sales）',
    finance:     '财务（Finance）',
    hr:          '人力资源（HR）',
    inventory:   '库存（Inventory）',
  }[domain] || domain;

  const apiList = apiResults.length > 0
    ? apiResults.map((a, i) =>
        `${i + 1}. **${a.name}**（${a.protocol}）${a.deprecated ? ' ⚠️ **[DEPRECATED - 已废弃]**' : ''}\n` +
        `   - 说明：${a.description}\n` +
        (a.deprecated ? `   - ⛔ 此 API 已废弃，请使用：${a.successor || '请查看官方文档获取替代方案'}\n` : '') +
        `   - Endpoint：\`${a.endpoint || ''}\`\n` +
        `   - 主要实体：${(a.keyEntities || []).join('、')}\n` +
        `   - 文档：${a.url}`
      ).join('\n\n')
    : '（请参考 https://api.sap.com 搜索相关 API）';

  return (
    `你是一位经验丰富的 SAP BTP 开发顾问，需要为一位**完全没有 BTP 开发经验**的开发者，\n` +
    `提供一份关于"${domainLabel}"业务场景的完整开发指南。\n\n` +
    `## 用户的业务场景\n${scenario || '开发一个基于 SAP BTP 的' + domainLabel + '相关应用'}\n\n` +
    `## 可用的相关 API\n${apiList}\n\n` +
    `## 请按照以下结构生成完整指南（用中文，Markdown 格式）：\n\n` +
    `### 一、准备工作\n` +
    `列出需要开通的 BTP 服务（服务名 + 用途 + 建议套餐），以表格形式展示。\n` +
    `然后给出 BTP 账号配置的具体步骤（含截图说明文字）。\n` +
    `最后列出本地开发环境要求：Node.js 版本、需要安装的 npm 包、VS Code 插件。\n\n` +
    `### 二、技术架构建议\n` +
    `推荐运行时（Cloud Foundry 或 Kyma）并说明原因。\n` +
    `用文字描述应用架构：前端（SAP Fiori/UI5）→ 后端（CAP/Node.js）→ S/4HANA API → S/4HANA 系统。\n\n` +
    `### 三、分步骤开发流程\n` +
    `**必须包含至少 7 个步骤**，每步格式：\n` +
    `**步骤 N：[步骤名称]**\n` +
    `目标：xxx\n` +
    `操作：具体命令或操作说明\n` +
    `代码示例（如有）：\n` +
    `\`\`\`javascript\n// 代码\n\`\`\`\n\n` +
    `步骤顺序：创建 BTP 项目 → 配置 Destination → 搭建 CAP 后端 → 集成 S/4HANA API → 开发前端 UI → 本地测试 → 部署到 CF/Kyma\n\n` +
    `### 四、核心 API 详细使用说明\n` +
    `**对上方列出的每一个 API，都必须包含以下内容：**\n\n` +
    `#### API 名称\n` +
    `**用途**：这个 API 解决什么业务问题\n\n` +
    `**认证方式**：如何获取 OAuth token，用 BTP Destination Service 还是直接调用\n\n` +
    `**关键操作示例**：\n` +
    `- 读取数据（GET）：\n` +
    `\`\`\`javascript\n// 完整可运行的 Node.js/axios 代码示例，包含 URL、headers、参数\n\`\`\`\n` +
    `- 创建数据（POST）：\n` +
    `\`\`\`javascript\n// 完整可运行的代码示例，包含请求体结构\n\`\`\`\n\n` +
    `**返回数据结构示例**（JSON 片段）\n\n` +
    `**注意事项**：权限要求、CSRF token、分页处理等\n\n` +
    `### 五、常见问题与解决方法\n` +
    `列出新手最常遇到的 5 个问题，每个给出具体解决步骤。\n\n` +
    `要求：所有代码示例必须完整可运行，使用 axios 库，包含错误处理。` +
    (groundingContext
      ? `\n\n## 以下是从官方文档中检索到的相关参考内容，请优先参考：\n\n${groundingContext}`
      : '')
  );
}

// ── Tab 4 BTP: Intent Detection ────────────────────────────────────────────────
function buildBtpIntentPrompt(query) {
  return (
    `Analyze the following user query and classify it into one of three intents:\n\n` +
    `intent = "service" — user asks about BTP services/products: listing services, pricing, billing, ` +
    `license models, roadmap, service details, how to activate/subscribe/use a specific service, ` +
    `comparing services. Keywords: 有哪些服务、服务列表、服务目录、定价、收费、价格、费用、license、` +
    `路线图、roadmap、怎么开通、服务详情、怎么订阅、怎么用、如何使用、怎么配置、怎么设置、怎么启用、` +
    `SAP Build、AI Core、Integration Suite、HANA Cloud、Credential Store、Kyma、Cloud Foundry、` +
    `BTP services、service catalog、pricing、how much does it cost、what services、how to use、how to configure。\n\n` +
    `IMPORTANT: If the query mentions a specific SAP service name (like "SAP Credential Store", "SAP AI Core", ` +
    `"SAP HANA Cloud", "Kyma", etc.) and asks how to use/configure/set up that service — classify as "service".\n\n` +
    `intent = "guide" — user wants to BUILD/DEVELOP/CREATE a BTP application or integrate systems step by step. ` +
    `Keywords: 如何开发、怎么开发、开发一个、创建应用、从零开始、搭建、集成、如何实现、怎么做、开发流程、` +
    `怎么集成、如何接入、how to develop、how to build、create app、step by step。\n\n` +
    `intent = "general" — BTP concepts, architecture, API questions, troubleshooting, explanations ` +
    `(everything else).\n\n` +
    `Also extract:\n` +
    `- domain: if intent is "guide", the business domain: "procurement"|"sales"|"finance"|"hr"|"inventory"|"custom" (default "procurement")\n` +
    `- scenario: if intent is "guide", a concise scenario description (max 50 chars)\n` +
    `- serviceQuery: if intent is "service", the cleaned English search term for Discovery Center (max 30 chars)\n\n` +
    `User query: "${query}"\n\n` +
    `Return ONLY a JSON object, no markdown:\n` +
    `{"intent":"service|guide|general","domain":"procurement|sales|finance|hr|inventory|custom","scenario":"...","serviceQuery":"..."}`
  );
}

// ── Tab 4 BTP: Service Answer ──────────────────────────────────────────────────
function buildBtpServicePrompt(query, services, detailsMap, lang = 'zh') {
  const isBroadListing = services.length > 5;
  const isEn = lang === 'en';
  const otherCat = isEn ? 'Other' : '其他';

  let serviceContent;
  if (isBroadListing) {
    const grouped = {};
    for (const s of services) {
      const cat = s.category || otherCat;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(s);
    }
    serviceContent = Object.entries(grouped).map(([cat, list]) =>
      `### ${cat}\n` + list.map(s => isEn
        ? `- **${s.name}**: ${s.description || ''}`
        : `- **${s.name}**：${s.description || ''}`).join('\n')
    ).join('\n\n');
  } else {
    serviceContent = services.map((s, i) => {
      const detail = detailsMap[s.id];
      let entry = isEn
        ? `${i + 1}. **${s.name}** (${s.category || ''})\n   ${s.description || ''}`
        : `${i + 1}. **${s.name}**（${s.category || ''}）\n   ${s.description || ''}`;
      if (detail) {
        if (detail.pricing && detail.pricing.length > 0) {
          const plans = detail.pricing.slice(0, 3).map(p =>
            `${p.planName}${p.commercialModels && p.commercialModels[0] ? (isEn ? ': ' : '：') + p.commercialModels[0].pricePerUnit + ' ' + p.commercialModels[0].metric : ''}`
          ).join(isEn ? '; ' : '；');
          entry += isEn ? `\n   Pricing plans: ${plans}` : `\n   定价方案：${plans}`;
        }
        const docUrl = detail.resources && detail.resources.documentation && detail.resources.documentation[0]
          ? detail.resources.documentation[0].url : null;
        const dcUrl = detail.links && detail.links.discoveryCenter ? detail.links.discoveryCenter : null;
        if (docUrl) entry += isEn ? `\n   Official docs: ${docUrl}` : `\n   官方文档：${docUrl}`;
        if (dcUrl) entry += `\n   Discovery Center：${dcUrl}`;
        if (detail.roadmap && detail.roadmap.length > 0) {
          const nextItem = detail.roadmap[0];
          entry += isEn
            ? `\n   Roadmap: ${nextItem.quarter || ''} — ${(nextItem.deliverables || []).slice(0, 2).join('; ')}`
            : `\n   路线图：${nextItem.quarter || ''} — ${(nextItem.deliverables || []).slice(0, 2).join('；')}`;
        }
      }
      return entry;
    }).join('\n\n');
  }

  if (isEn) {
    return (
      `You are an SAP BTP expert. Based on the following service information obtained from SAP Discovery Center, answer the user's question in English.\n\n` +
      `User question: ${query}\n\n` +
      `SAP BTP service information (${services.length} item(s), from Discovery Center):\n\n${serviceContent}\n\n` +
      (isBroadListing
        ? `List all ${services.length} services above one by one grouped by category, each service on its own line, format: service name + one-sentence description. Do not omit any service, do not replace the actual list with "X items total".`
        : `Answer the question directly, concise and clear, using Markdown formatting where appropriate. If pricing is involved, explain the pricing model. ` +
          `You MUST append the official links at the end of the answer, format:\n**Official docs**: [link text](URL)\n**Discovery Center**: [link text](URL)`)
    );
  }

  return (
    `你是一位 SAP BTP 专家，请根据以下从 SAP Discovery Center 获取的服务信息，用中文回答用户问题。\n\n` +
    `用户问题：${query}\n\n` +
    `SAP BTP 服务信息（共 ${services.length} 项，来自 Discovery Center）：\n\n${serviceContent}\n\n` +
    (isBroadListing
      ? `请将上述所有 ${services.length} 个服务按分类逐一列出，每个服务单独一行，格式：服务名 + 一句话描述。不要省略任何服务，不要用"共X项"代替实际列表。`
      : `请直接回答问题，语言简洁清晰，适当使用 Markdown 格式。如果涉及收费，请说明定价模型。` +
        `必须在答案末尾附上官方链接，格式：\n**官方文档**：[链接文字](URL)\n**Discovery Center**：[链接文字](URL)`)
  );
}

// ── Tab 4 BTP: MCP Docs Fallback Answer ───────────────────────────────────────
function buildBtpMcpAnswerPrompt(query, searchResults, lang = 'zh') {
  if (lang === 'en') {
    const docsEn = searchResults.slice(0, 5).map((r, i) =>
      `[${i + 1}] **${r.title}**\n${r.snippet || ''}\nLink: ${r.url || ''}`
    ).join('\n\n');
    return (
      `You are an SAP BTP expert. Based on the following content found in official SAP documentation, answer the user's question in English.\n\n` +
      `User question: ${query}\n\n` +
      `Document snippets found:\n\n${docsEn}\n\n` +
      `Answer based on the documents above, and list the cited links under "References:" at the end.`
    );
  }
  const docs = searchResults.slice(0, 5).map((r, i) =>
    `[${i + 1}] **${r.title}**\n${r.snippet || ''}\n链接：${r.url || ''}`
  ).join('\n\n');

  return (
    `你是一位 SAP BTP 专家，请根据以下从 SAP 官方文档搜索到的内容，用中文回答用户问题。\n\n` +
    `用户问题：${query}\n\n` +
    `搜索到的文档片段：\n\n${docs}\n\n` +
    `请基于以上文档内容回答，并在答案末尾用"参考文档："列出引用的链接。`
  );
}

// ── Feature 6: Migration Path Planning ────────────────────────────────────
function buildPlanPrompt(objectName, lang = 'zh') {
  if (lang === 'en') {
    return (
      `For the SAP object "${objectName}", generate a detailed Clean Core migration plan.\n\n` +
      `Return ONLY a valid JSON object with no markdown fences and no extra text. The object must have exactly these fields:\n` +
      `- objectName      (string: the input object name)\n` +
      `- replacement     (string: the recommended Clean Core replacement name)\n` +
      `- replacementType (string: one of OData API, RAP BO, CDS View, Released FM, Released BAdI, Key User Extension, Side-by-Side BTP)\n` +
      `- riskLevel       (string: "Low" | "Medium" | "High" — migration complexity risk)\n` +
      `- effortEstimate  (string: estimated effort, e.g. "2-3 days", "1 week")\n` +
      `- steps           (string: a JSON array string, each element has { "step": number, "description": string })\n` +
      `- codeExample     (string: ABAP code snippet. CRITICAL: escape ALL double-quotes as \\\\", escape ALL newlines as \\\\n, escape ALL backslashes as \\\\\\\\. The entire value must be a valid JSON string.)\n` +
      `- summary         (string: one sentence summarizing the migration in English)\n\n` +
      `Rules:\n` +
      `- steps must contain 3-5 concrete, actionable migration steps\n` +
      `- codeExample: use single-line format with \\\\n for line breaks, NO raw newlines inside the JSON string value\n` +
      `- All text fields (riskLevel, summary, step descriptions) must be in English\n` +
      `- The steps field value must itself be a valid JSON array serialized as a string\n` +
      `- Your entire response must start with { and end with } — no other text`
    );
  }
  return (
    `For the SAP object "${objectName}", generate a detailed Clean Core migration plan.\n\n` +
    `Return ONLY a valid JSON object with no markdown fences and no extra text. The object must have exactly these fields:\n` +
    `- objectName      (string: the input object name)\n` +
    `- replacement     (string: the recommended Clean Core replacement name)\n` +
    `- replacementType (string: one of OData API, RAP BO, CDS View, Released FM, Released BAdI, Key User Extension, Side-by-Side BTP)\n` +
    `- riskLevel       (string: "低" | "中" | "高" — migration complexity risk)\n` +
    `- effortEstimate  (string: estimated effort, e.g. "2-3 天", "1 周")\n` +
    `- steps           (string: a JSON array string, each element has { "step": number, "description": string })\n` +
    `- codeExample     (string: ABAP code snippet. CRITICAL: escape ALL double-quotes as \\\\", escape ALL newlines as \\\\n, escape ALL backslashes as \\\\\\\\. The entire value must be a valid JSON string.)\n` +
    `- summary         (string: one sentence summarizing the migration in Chinese)\n\n` +
    `Rules:\n` +
    `- steps must contain 3-5 concrete, actionable migration steps\n` +
    `- codeExample: use single-line format with \\\\n for line breaks, NO raw newlines inside the JSON string value\n` +
    `- All text fields (riskLevel, summary, step descriptions) must be in Chinese\n` +
    `- The steps field value must itself be a valid JSON array serialized as a string\n` +
    `- Your entire response must start with { and end with } — no other text`
  );
}

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
  buildExtractObjectsPrompt,
  buildPlanPrompt,
  buildBtpAnswerPrompt,
  buildBtpGuidePrompt,
  buildBtpIntentPrompt,
  buildBtpServicePrompt,
  buildBtpMcpAnswerPrompt,
};
