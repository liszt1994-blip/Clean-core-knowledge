// tool1-knowledge/srv/prompts.js
const { CLEAN_CORE_SYSTEM_PROMPT } = require('../src/aicore-client');

// Re-export SYSTEM_PROMPT for backwards compatibility
const SYSTEM_PROMPT = CLEAN_CORE_SYSTEM_PROMPT;

// ── Tab 1: Concept Explanation ─────────────────────────────────────────────
function buildExplainPrompt(term) {
  return (
    `请用中文解释以下 SAP Clean Core 概念，面向刚接触 Clean Core 的 SAP 开发者，` +
    `语言简洁易懂，如有可能请给出实际示例，回答控制在 300 字以内："${term}"。`
  );
}

// ── Tab 2: Classification — AI fallback (object not found in local JSON) ───
// Used when ClassificationClient.lookup() returns null.
function buildClassifyPrompt(objects) {
  const list = objects.map((o, i) => `${i + 1}. ${o}`).join('\n');
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
    `Objects to classify:\n${list}`
  );
}

// ── Tab 2: Classification — AI fallback for a single object ───────────────
// Used when an individual object is not in the JSON; returns single-element array.
function buildSingleClassifyPrompt(objectName) {
  return buildClassifyPrompt([objectName]);
}

// ── Tab 3: Replacement — AI generates migrationNote for known successors ──
// Used when ClassificationClient.lookup() found successors but no note.
function buildMigrationNotePrompt(deprecatedObject, successors) {
  const succList = successors
    .map(s => `- ${s.name} (${s.type})`)
    .join('\n');
  return (
    `For the deprecated SAP object "${deprecatedObject}", the official successors are:\n` +
    `${succList}\n\n` +
    `For each successor, provide a short migrationNote (2-3 sentences) explaining how to migrate ` +
    `from "${deprecatedObject}" to that successor.\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have:\n` +
    `- replacementName (string)\n` +
    `- type            (string: the successor type as listed above)\n` +
    `- migrationNote   (string: 2-3 sentences on how to migrate)\n` +
    `- source          (string: "official-json+ai-note")`
  );
}

// ── Tab 3: Replacement — full AI recommendation (object not in JSON) ───────
function buildRecommendPrompt(deprecatedObject) {
  return (
    `For the deprecated or non-compliant SAP object "${deprecatedObject}", provide replacement ` +
    `recommendations.\n\n` +
    `Return ONLY a JSON array with no markdown fences. Each element must have:\n` +
    `- replacementName (string)\n` +
    `- type            (string: one of OData API, RAP BO, CDS View, Released BAdI, Key User Extension, Side-by-Side BTP)\n` +
    `- migrationNote   (string: 2-3 sentences describing how to migrate)\n` +
    `- source          (string: always "ai-inference" for objects recommended by this prompt)`
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
