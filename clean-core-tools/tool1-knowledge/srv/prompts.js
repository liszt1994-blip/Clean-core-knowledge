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
};
