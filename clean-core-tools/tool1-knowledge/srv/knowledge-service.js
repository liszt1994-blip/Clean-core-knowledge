// tool1-knowledge/srv/knowledge-service.js
const cds = require('@sap/cds');
const { AICoreClient, CLEAN_CORE_SYSTEM_PROMPT } = require('../src/aicore-client');
const { ClassificationClient } = require('../src/classification-client');
const { DestinationClient } = require('../src/destination-client');
const { searchHelpPortal } = require('../src/sap-help-search');
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

module.exports = cds.service.impl(async function (srv) {
  // Lazy-init singletons: constructed on first request so env vars are loaded
  let ai;
  let clf;
  let dest;

  function getAI() {
    if (!ai) ai = new AICoreClient();
    return ai;
  }

  function getClassifier() {
    if (!clf) clf = new ClassificationClient();
    return clf;
  }

  function getDestination() {
    if (!dest) {
      try {
        dest = new DestinationClient();
      } catch (e) {
        return null; // Destination service not configured — graceful degradation
      }
    }
    return dest;
  }

  // ── Tab 1: Concept Explanation ─────────────────────────────────────────
  srv.on('explain', async (req) => {
    const { term } = req.data;
    if (!term || !term.trim()) {
      return req.error(400, 'term is required');
    }
    const result = await getAI().complete(CLEAN_CORE_SYSTEM_PROMPT, buildExplainPrompt(term));
    return result;
  });

  // ── Tab 2: Object Classification ────────────────────────────────────────
  // Strategy: local JSON first → AI Core fallback per object
  srv.on('classify', async (req) => {
    const { objects } = req.data;
    if (!objects || objects.length === 0) {
      return req.error(400, 'objects array is required');
    }

    const results = [];

    for (const objectName of objects) {
      const name = objectName.trim().toUpperCase();
      const info = getClassifier().lookup(name);

      if (info) {
        // ── Hit: build response from authoritative JSON data ──────────
        results.push({
          objectName:     name,
          tier:           info.tier,
          state:          info.state || info.clsState,
          explanation:    info.tierDescription,
          recommendation: _buildRecommendationText(info),
          replacement:    info.replacement,
          replacementType: info.replacementType,
          allSuccessors:  info.allSuccessors,
          note:           info.note,
          objectType:     info.objectType,
          softwareComponent: info.softwareComponent,
          appComponent:   info.appComponent,
          source:         'official-json',
        });
      } else {
        // ── Miss: ask AI Core to infer the tier ───────────────────────
        try {
          const raw = await getAI().complete(
            CLEAN_CORE_SYSTEM_PROMPT,
            buildSingleClassifyPrompt(name),
          );
          let parsed;
          try {
            parsed = JSON.parse(raw.trim());
          } catch {
            parsed = null;
          }
          if (Array.isArray(parsed) && parsed.length > 0) {
            results.push({ ...parsed[0], objectName: name });
          } else {
            results.push({
              objectName: name,
              tier: 'unknown',
              state: 'unknown',
              explanation: 'Object not found in SAP release data; AI inference also failed.',
              recommendation: 'Verify the object name and check the SAP API Business Hub.',
              source: 'ai-inference-failed',
            });
          }
        } catch (err) {
          results.push({
            objectName: name,
            tier: 'unknown',
            state: 'unknown',
            explanation: `AI inference error: ${err.message}`,
            recommendation: 'Check VCAP_SERVICES configuration and AI Core connectivity.',
            source: 'error',
          });
        }
      }
    }

    return results;
  });

  // ── Tab 3: Replacement API Recommendation ──────────────────────────────
  // Strategy: official successors from JSON + AI-generated migrationNote;
  //           fully unknown objects → full AI recommendation
  srv.on('recommend', async (req) => {
    const { deprecatedObject } = req.data;
    if (!deprecatedObject || !deprecatedObject.trim()) {
      return req.error(400, 'deprecatedObject is required');
    }

    const name = deprecatedObject.trim().toUpperCase();
    const info = getClassifier().lookup(name);

    if (info && info.allSuccessors.length > 0) {
      // We have official successors — ask AI only for migration notes
      const raw = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildMigrationNotePrompt(name, info.allSuccessors),
      );
      let parsed;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        parsed = null;
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      // AI note generation failed — fall back to plain successor list
      return info.allSuccessors.map(s => ({
        replacementName: s.name,
        type: s.type,
        migrationNote: info.note || 'Refer to SAP API Business Hub for migration details.',
        source: 'official-json',
      }));
    }

    // No JSON data — full AI recommendation
    const raw = await getAI().complete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildRecommendPrompt(name),
    );
    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return req.error(502, 'AI Core returned invalid JSON for recommendations');
    }
    return parsed;
  });

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
          objectName:      name,
          tier:            info.tier,
          state:           info.state || info.clsState,
          line:            ref.line || 0,
          callType:        ref.callType || '',
          replacement:     info.replacement || '',
          replacementType: info.replacementType || '',
          note:            info.note || '',
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
              objectName:      name,
              tier:            parsed[0].tier || 'unknown',
              state:           parsed[0].state || 'unknown',
              line:            ref.line || 0,
              callType:        ref.callType || '',
              replacement:     '',
              replacementType: '',
              note:            '',
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

    // Step 2: classify each object via local JSON first, fall back to unknown
    const results = [];
    for (const finding of findings) {
      const name = (finding.objectName || '').trim().toUpperCase();
      if (!name) continue;
      const info = getClassifier().lookup(name);
      if (info) {
        results.push({
          objectName:      name,
          tier:            info.tier,
          state:           info.state || info.clsState,
          line:            finding.line || 0,
          errorCode:       finding.errorCode || '',
          replacement:     info.replacement || '',
          replacementType: info.replacementType || '',
          note:            info.note || '',
        });
      } else {
        results.push({
          objectName:      name,
          tier:            'unknown',
          state:           'unknown',
          line:            finding.line || 0,
          errorCode:       finding.errorCode || '',
          replacement:     '',
          replacementType: '',
          note:            finding.message || '',
        });
      }
    }
    return results;
  });

  // ── Tab 4: SAP Note Search ─────────────────────────────────────────────────
  // Step 1: Translate query to English (if needed) via AI
  // Step 2: Call SAP Help Portal real search API (no login required)
  // Step 3: Return real results + a direct Support Portal search link
  srv.on('searchNote', async (req) => {
    const { query } = req.data;
    if (!query || !query.trim()) {
      return req.error(400, 'query is required');
    }

    // Step 1: Translate to English only if query contains non-ASCII (e.g. Chinese)
    const needsTranslation = /[^\x00-\x7F]/.test(query);
    let englishQuery = query.trim();
    if (needsTranslation) {
      try {
        const translated = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildTranslateQueryPrompt(query),
          128,
        );
        const t = translated.trim();
        if (t && t.length > 0 && t.length < 300) englishQuery = t;
      } catch {
        // translation failed — use original query
      }
    }

    // Step 2: Call SAP Help Portal search API — fetch more candidates for re-ranking
    let helpResults = [];
    try {
      helpResults = await searchHelpPortal(englishQuery, 30);
    } catch (err) {
      // Help Portal unavailable
    }

    if (helpResults.length === 0) {
      return [];
    }

    // Step 3: AI re-ranks candidates by relevance to original query
    let reranked = helpResults;
    try {
      const raw = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildRerankPrompt(query, helpResults),
        256,
      );
      const text = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      const indices = JSON.parse(text);
      if (Array.isArray(indices) && indices.length > 0) {
        // Keep only AI-selected results in AI-specified order, cap at 8
        reranked = indices
          .filter(i => Number.isInteger(i) && i >= 0 && i < helpResults.length)
          .slice(0, 8)
          .map(i => helpResults[i]);
      }
    } catch {
      // Re-ranking failed — fall back to original score-sorted order, take top 8
      reranked = helpResults.slice(0, 8);
    }

    return reranked.map(item => ({
      noteNumber:       extractNoteNumber(item.url),
      title:            item.title,
      summary:          item.summary || '',
      releaseDate:      item.date ? item.date.slice(0, 7) : '',
      url:              item.url,
      requiresLogin:    false,
      contentSource:    'help-portal',
      confidence:       'high',
      confidenceReason: item.product || 'SAP Help Portal',
      englishQuery:     englishQuery,
    }));
  });
});


// ── Helpers ─────────────────────────────────────────────────────────────────

function _buildRecommendationText(info) {
  if (info.replacement) {
    return `Replace with ${info.replacementType ? info.replacementType + ' ' : ''}${info.replacement}` +
      (info.note ? `. ${info.note}` : '');
  }
  if (info.tier === 'A') return 'This is a released API — safe to use as-is.';
  return 'No official successor found. Consider side-by-side extension on BTP.';
}

// Extract a SAP Note number from a help.sap.com URL, e.g.:
//   https://help.sap.com/docs/SAP_S4HANA/abc/123456  → ''  (not a note)
//   https://me.sap.com/notes/2220005                 → '2220005'
function extractNoteNumber(url) {
  if (!url) return '';
  const m = url.match(/\/notes\/(\d+)/);
  return m ? m[1] : '';
}
