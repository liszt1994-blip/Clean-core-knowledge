// tool1-knowledge/srv/knowledge-service.js
const cds = require('@sap/cds');
const { AICoreClient, CLEAN_CORE_SYSTEM_PROMPT } = require('../src/aicore-client');
const { ClassificationClient } = require('../src/classification-client');
const { DestinationClient } = require('../src/destination-client');
const { searchHelpPortal } = require('../src/sap-help-search');
const { searchApis, listByModule } = require('../src/apihub-client');
const { buildGraph } = require('../src/cds-graph-data');
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
  buildExtractObjectsPrompt,
  buildPlanPrompt,
} = require('./prompts');

module.exports = cds.service.impl(async function (srv) {
  // Lazy-init singletons: constructed on first request so env vars are loaded
  let ai;
  let clf;
  let dest;

  const GROUNDING_COLLECTION_ID = process.env.GROUNDING_COLLECTION_ID || '';

  function getAI() {
    if (!ai) ai = new AICoreClient();
    return ai;
  }

  // Wrapper: use grounding when collection is configured, fall back to plain complete
  function aiComplete(systemPrompt, userContent, maxTokens = 2048) {
    if (GROUNDING_COLLECTION_ID) {
      return getAI().completeWithGrounding(systemPrompt, userContent, GROUNDING_COLLECTION_ID, maxTokens);
    }
    return getAI().complete(systemPrompt, userContent, maxTokens);
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
    const result = await aiComplete(CLEAN_CORE_SYSTEM_PROMPT, buildExplainPrompt(term));
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
      const raw = await aiComplete(
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
    const raw = await aiComplete(
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

  // ── rewriteCode: rewrite ABAP code to Clean Core compliant version ────────
  srv.on('rewriteCode', async (req) => {
    const { code, violations } = req.data;
    if (!code || !code.trim()) return req.error(400, 'code is required');
    if (!violations || violations.length === 0) {
      return { original: code, rewritten: code };
    }

    const raw = await aiComplete(
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

  // ── Feature 6: Migration Path Planning ────────────────────────────────────
  srv.on('plan', async (req) => {
    const { objectName } = req.data;
    if (!objectName || !objectName.trim()) {
      return req.error(400, 'objectName is required');
    }

    // plan must NOT use grounding — the strict JSON format gets broken by the grounding template
    const raw = await getAI().complete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildPlanPrompt(objectName.trim().toUpperCase()),
      4000
    );

    // AI sometimes emits real newlines inside the codeExample JSON string value, breaking JSON.parse.
    // Walk the string char-by-char to find the codeExample value boundaries and fix only real newlines,
    // leaving all existing escape sequences (\\n, \\", etc.) untouched.
    function fixRawPlanJson(str) {
      const keyIdx = str.indexOf('"codeExample"');
      if (keyIdx === -1) return str;

      let i = keyIdx + '"codeExample"'.length;
      while (i < str.length && str[i] !== '"') i++;
      if (i >= str.length) return str;

      const valueStart = i + 1;
      let j = valueStart;
      let hasRealNewline = false;
      while (j < str.length) {
        if (str[j] === '\\') { j += 2; continue; }
        if (str[j] === '\n' || str[j] === '\r') { hasRealNewline = true; j++; continue; }
        if (str[j] === '"') break;
        j++;
      }

      if (!hasRealNewline) return str; // already valid, nothing to fix

      let safeValue = '';
      let k = valueStart;
      while (k < j) {
        if (str[k] === '\\') { safeValue += str[k] + (str[k + 1] || ''); k += 2; continue; }
        if (str[k] === '\r' && str[k + 1] === '\n') { safeValue += '\\n'; k += 2; continue; }
        if (str[k] === '\r' || str[k] === '\n') { safeValue += '\\n'; k++; continue; }
        if (str[k] === '\t') { safeValue += '\\t'; k++; continue; }
        safeValue += str[k++];
      }
      return str.slice(0, valueStart) + safeValue + str.slice(j);
    }

    let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    cleaned = fixRawPlanJson(cleaned);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[plan] JSON.parse failed:', e.message);
      console.error('[plan] raw first 300:', raw.slice(0, 300));
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

    // Step 2: route to handler
    if (intent === 'explain') {
      const text = await aiComplete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildExplainPrompt(message),
      );
      return {
        replyType: 'explain',
        text,
        violations: JSON.stringify([]),
        rewriteOriginal: '',
        rewriteRewritten: '',
        notes: JSON.stringify([]),
      };
    }

    if (intent === 'classify') {
      // Step 1: Use AI to extract SAP object names from natural language
      let objects = [];
      try {
        const raw = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildExtractObjectsPrompt(message),
          256,
        );
        const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
        if (Array.isArray(parsed)) objects = parsed.map(s => String(s).trim().toUpperCase()).filter(Boolean);
      } catch {
        // Fallback: split on whitespace/comma, keep tokens that look like SAP object names
        objects = message.split(/[\n,\s]+/)
          .map(s => s.trim().toUpperCase())
          .filter(s => /^[A-Z][A-Z0-9_]{2,}$/.test(s));
      }

      if (objects.length === 0) {
        return {
          replyType: 'general',
          text: '无法从输入中识别 SAP 对象名，请直接输入对象名（如 READ_TEXT）。',
          violations: JSON.stringify([]),
          rewriteOriginal: '', rewriteRewritten: '', notes: JSON.stringify([]),
        };
      }

      // Step 2: Look up each object; AI fallback for unknowns
      const violations = [];
      for (const name of objects) {
        const info = getClassifier().lookup(name);
        if (info) {
          let replacement = info.replacement || '';
          let replacementType = info.replacementType || '';
          let note = info.note || '';

          // If no replacement in JSON, ask AI for recommendation
          if (!replacement && info.tier !== 'A') {
            try {
              const raw = await getAI().complete(
                CLEAN_CORE_SYSTEM_PROMPT,
                buildRecommendPrompt(name),
                1024,
              );
              const cleaned = raw.trim()
                .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
                .trim();
              const recs = JSON.parse(cleaned);
              if (Array.isArray(recs) && recs.length > 0) {
                replacement = recs.map(r => r.replacementName).filter(Boolean).join(', ');
                replacementType = recs[0].type || '';
                note = recs.map(r => r.migrationNote).filter(Boolean).join('\n');
              }
            } catch (e) {
              console.error(`[classify] AI replacement failed for ${name}:`, e.message);
            }
          }

          violations.push({
            objectName: name,
            tier: info.tier,
            state: info.state || info.clsState,
            line: 0, callType: '',
            replacement,
            replacementType,
            note,
          });
        } else {
          // Not in local JSON — full AI inference
          try {
            const raw = await getAI().complete(
              CLEAN_CORE_SYSTEM_PROMPT,
              buildSingleClassifyPrompt(name),
              512,
            );
            const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
            if (Array.isArray(parsed) && parsed.length > 0) {
              violations.push({
                objectName: name,
                tier: parsed[0].tier || 'unknown',
                state: parsed[0].state || 'unknown',
                line: 0, callType: '',
                replacement: parsed[0].recommendation || '',
                replacementType: '',
                note: parsed[0].explanation || '',
              });
            } else {
              violations.push({
                objectName: name, tier: 'unknown', state: 'unknown',
                line: 0, callType: '', replacement: '', replacementType: '',
                note: '未在本地数据中找到，AI 也无法推断，请手动核实。',
              });
            }
          } catch {
            violations.push({
              objectName: name, tier: 'unknown', state: 'unknown',
              line: 0, callType: '', replacement: '', replacementType: '',
              note: '查询失败，请手动核实。',
            });
          }
        }
      }

      return {
        replyType: 'violations',
        text: violations.length > 0
          ? `发现 ${violations.length} 个对象，分级结果如下：`
          : '在本地数据中未找到这些对象，建议手动核实。',
        violations: JSON.stringify(violations),
        rewriteOriginal: '', rewriteRewritten: '', notes: JSON.stringify([]),
      };
    }

    if (intent === 'code') {
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
          let replacement = info.replacement || '';
          let replacementType = info.replacementType || '';
          let note = info.note || '';

          // If no replacement in JSON, ask AI for recommendation
          if (!replacement) {
            try {
              const raw = await getAI().complete(
                CLEAN_CORE_SYSTEM_PROMPT,
                buildRecommendPrompt(name),
                1024,
              );
              const cleaned = raw.trim()
                .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
                .trim();
              const recs = JSON.parse(cleaned);
              if (Array.isArray(recs) && recs.length > 0) {
                replacement = recs.map(r => r.replacementName).filter(Boolean).join(', ');
                replacementType = recs[0].type || '';
                note = recs.map(r => r.migrationNote).filter(Boolean).join('\n');
              }
            } catch (e) {
              console.error(`[code] AI replacement failed for ${name}:`, e.message);
            }
          }

          violations.push({
            objectName:      name,
            tier:            info.tier,
            state:           info.state || info.clsState,
            line:            ref.line || 0,
            callType:        ref.callType || '',
            replacement,
            replacementType,
            note,
          });
        } else if (!info) {
          // Not in local JSON — AI fallback for tier + replacement
          try {
            const raw = await getAI().complete(
              CLEAN_CORE_SYSTEM_PROMPT,
              buildSingleClassifyPrompt(name),
              512,
            );
            const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].tier !== 'A') {
              violations.push({
                objectName:      name,
                tier:            parsed[0].tier || 'unknown',
                state:           parsed[0].state || 'unknown',
                line:            ref.line || 0,
                callType:        ref.callType || '',
                replacement:     parsed[0].recommendation || '',
                replacementType: '',
                note:            parsed[0].explanation || '',
              });
            }
          } catch {
            // skip objects where AI also fails
          }
        }
        // Tier A objects are compliant — skip them
      }

      if (violations.length === 0) {
        return {
          replyType: 'general',
          text: '代码中未发现 Clean Core 违规对象，可以安全使用。',
          violations: JSON.stringify([]),
          rewriteOriginal: '',
          rewriteRewritten: '',
          notes: JSON.stringify([]),
        };
      }

      // Generate rewrite
      // rewriteOriginal always comes from message directly (saves tokens, avoids truncation)
      let rewriteOriginal = message;
      let rewriteRewritten = '';
      try {
        const raw = await aiComplete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildRewriteCodePrompt(message, violations),
          8192,
        );
        console.log('[rewrite] raw length:', raw ? raw.length : 0);
        console.log('[rewrite] raw FULL:\n', raw);

        if (!raw || !raw.trim()) {
          console.error('[rewrite] AI returned empty response');
        } else {
          // Strip markdown fences
          let text = raw.trim()
            .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
            .trim();

          // Try JSON.parse first
          let rw = null;
          try {
            rw = JSON.parse(text);
          } catch (parseErr) {
            console.error('[rewrite] JSON.parse failed:', parseErr.message, '— trying regex extraction');
            // Regex fallback: extract "rewritten" field handling real newlines in value
            const m = text.match(/"rewritten"\s*:\s*"([\s\S]*?)(?<!\\)"(?=\s*[,}])/);
            if (m) {
              const rewrit = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              rw = { rewritten: rewrit };
              console.log('[rewrite] regex extraction succeeded, rewritten length:', rewrit.length);
            }
          }

          if (rw && rw.rewritten) {
            rewriteRewritten = rw.rewritten;
            console.log('[rewrite] success, rewritten length:', rewriteRewritten.length);
          } else {
            console.error('[rewrite] rewritten field empty or missing. text:\n', text.slice(0, 500));
          }
        }
      } catch (e) {
        console.error('[rewrite] outer catch:', e.message);
      }

      return {
        replyType: 'violations',
        text: `发现 ${violations.length} 个 Clean Core 违规对象：`,
        violations: JSON.stringify(violations),
        rewriteOriginal,
        rewriteRewritten,
        notes: JSON.stringify([]),
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
          objectName:      name,
          tier:            info ? info.tier : 'unknown',
          state:           info ? (info.state || info.clsState) : 'unknown',
          line:            f.line || 0,
          callType:        f.errorCode || '',
          replacement:     info ? (info.replacement || '') : '',
          replacementType: info ? (info.replacementType || '') : '',
          note:            f.message || (info ? info.note : '') || '',
        };
      });

      return {
        replyType: violations.length > 0 ? 'violations' : 'general',
        text: violations.length > 0
          ? `解析到 ${violations.length} 个 ATC 违规，分级结果如下：`
          : '未能从 ATC 输出中解析到违规对象，请确认输入格式。',
        violations: JSON.stringify(violations),
        rewriteOriginal: '',
        rewriteRewritten: '',
        notes: JSON.stringify([]),
      };
    }

    // Fallback: general question → explain
    const text = await aiComplete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildExplainPrompt(message),
    );
    return {
      replyType: 'general',
      text,
      violations: JSON.stringify([]),
      rewriteOriginal: '',
      rewriteRewritten: '',
      notes: JSON.stringify([]),
    };
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

  // ── Tab 4: API Hub 搜索 ──────────────────────────────────────────────────
  srv.on('searchApiHub', async (req) => {
    const { query, module } = req.data;
    if (!query?.trim() && !module?.trim()) {
      return req.error(400, 'query 或 module 至少填写一个');
    }
    if (module?.trim()) {
      return await listByModule(module.trim().toUpperCase());
    }
    return await searchApis(query.trim());
  });

  // ── Tab 5: CDS 关系图谱 ──────────────────────────────────────────────────
  srv.on('analyzeCds', async (req) => {
    const { viewName } = req.data;
    if (!viewName?.trim()) {
      return req.error(400, '请输入 CDS View 名称');
    }
    const graph = buildGraph(viewName.trim());
    if (!graph) {
      return req.error(404, `未找到 CDS View "${viewName.trim()}"。可用示例：I_SalesOrder、I_PurchaseOrder、I_JournalEntry、C_SalesOrderTP`);
    }
    return graph;
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

// Extract a SAP Note number only from authoritative me.sap.com/notes/<id> URLs.
// Do NOT extract from help.sap.com paths — those document IDs are not Note numbers.
function extractNoteNumber(url) {
  if (!url) return '';
  const m = url.match(/\/notes\/(\d+)/);
  return m ? m[1] : '';
}
