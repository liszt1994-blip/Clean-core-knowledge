// tool1-knowledge/srv/knowledge-service.js
const cds = require('@sap/cds');
const { AICoreClient, CLEAN_CORE_SYSTEM_PROMPT } = require('../src/aicore-client');
const { ClassificationClient } = require('../src/classification-client');
const { DestinationClient } = require('../src/destination-client');
const { searchHelpPortal } = require('../src/sap-help-search');
const { searchApis, listByModule } = require('../src/apihub-client');
const { buildGraphFromAdt } = require('../src/adt-client');
const { searchSapApis } = require('../src/sap-api-search');
const { searchDiscoveryCenter, getServiceDetails, searchSapDocs } = require('../src/mcp-client');
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
  buildBtpAnswerPrompt,
  buildBtpGuidePrompt,
  buildBtpIntentPrompt,
  buildBtpServicePrompt,
  buildBtpMcpAnswerPrompt,
} = require('./prompts');

module.exports = cds.service.impl(async function (srv) {
  // Lazy-init singletons: constructed on first request so env vars are loaded
  let ai;
  let clf;
  let dest;

  function getAI() {
    if (!ai) {
      const vcapRaw = process.env.VCAP_SERVICES;
      if (!vcapRaw || vcapRaw.includes('<YOUR_')) return null;
      ai = new AICoreClient();
    }
    return ai;
  }

  function getClassifier() {
    if (!clf) clf = new ClassificationClient();
    return clf;
  }

  // Classify a single SAP object: local JSON first, then Grounding, then plain AI fallback
  async function classifyWithGrounding(objectName) {
    // Step 1: local JSON lookup (highest accuracy, no AI cost)
    // Wait for remote JSON to finish loading (it was kicked off at startup)
    await getClassifier().ready();
    const localResult = getClassifier().lookup(objectName);
    if (localResult) {
      return {
        objectName,
        tier:           localResult.tier,
        state:          localResult.state || localResult.clsState,
        explanation:    localResult.tierDescription,
        recommendation: localResult.replacement
          ? `Use successor: ${localResult.replacement} (${localResult.replacementType})`
          : localResult.tierDescription,
        source: 'local-json',
      };
    }

    // Step 2: AI Grounding (knowledge base documents)
    const collectionId = process.env.AICORE_GROUNDING_COLLECTION_ID;
    if (collectionId && getAI()) {
      try {
        const answer = await getAI().completeWithGrounding(
          CLEAN_CORE_SYSTEM_PROMPT,
          `What is the SAP Clean Core classification level (A, B, C, or D) for the SAP object "${objectName}"? ` +
          `Reply ONLY with a JSON array containing one object with fields: ` +
          `objectName, tier (A/B/C/D), state (released/classicAPI/notToBeReleased/noAPI/unknown), ` +
          `explanation (1-2 sentences), recommendation (what developer should do). No markdown fences.`,
          collectionId,
          512,
        );
        const cleaned = answer.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { ...parsed[0], objectName, source: 'grounding' };
        }
      } catch (err) {
        console.warn('[classifyWithGrounding] grounding failed, falling back to AI:', err.message);
      }
    }

    // Step 3: plain AI inference (last resort)
    if (!getAI()) return null;
    const raw = await getAI().complete(CLEAN_CORE_SYSTEM_PROMPT, buildSingleClassifyPrompt(objectName));
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      return { ...parsed[0], objectName, source: 'ai-inference' };
    }
    return null;
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
    if (!getAI()) return 'AI Core 未配置，请在 .env 文件中填入真实的 VCAP_SERVICES 凭据。';
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
        // ── Miss: use Grounding first, fallback to plain AI ────────────
        try {
          const result = await classifyWithGrounding(name);
          if (result) {
            results.push(result);
          } else {
            results.push({
              objectName: name,
              tier: 'unknown',
              state: 'unknown',
              explanation: 'Object not found in SAP release data; Grounding and AI inference also failed.',
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
        // A and B tiers: do not show replacement suggestions
        const isCompliant = info.tier === 'A' || info.tier === 'B';
        results.push({
          objectName:      name,
          tier:            info.tier,
          state:           info.state || info.clsState,
          line:            ref.line || 0,
          callType:        ref.callType || '',
          replacement:     isCompliant ? '' : (info.replacement || ''),
          replacementType: isCompliant ? '' : (info.replacementType || ''),
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

    if (!getAI()) {
      return {
        replyType: 'general',
        text: 'AI Core 未配置，请在 .env 文件中填入真实的 VCAP_SERVICES 凭据后重启服务。\n\n本地可用功能：Tab 2（对象分级，直接查本地 JSON）和 Tab 3（SAP 搜索）。',
        violations: JSON.stringify([]),
        rewriteOriginal: '',
        rewriteRewritten: '',
        notes: JSON.stringify([]),
        sourceType: 'no-ai',
      };
    }

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
      const collectionId = process.env.AICORE_GROUNDING_COLLECTION_ID;
      let text;
      let sourceType = 'ai-core';
      if (collectionId && getAI()) {
        try {
          text = await getAI().completeWithGrounding(CLEAN_CORE_SYSTEM_PROMPT, message, collectionId);
          sourceType = 'grounding';
        } catch (err) {
          console.warn('[chat/explain] Grounding failed, falling back:', err.message);
        }
      }
      if (!text) {
        text = await getAI().complete(CLEAN_CORE_SYSTEM_PROMPT, buildExplainPrompt(message));
      }
      return {
        replyType: 'explain',
        text,
        violations: JSON.stringify([]),
        rewriteOriginal: '',
        rewriteRewritten: '',
        notes: JSON.stringify([]),
        sourceType,
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
          sourceType: 'ai-core',
        };
      }

      // Step 2: Look up each object; AI fallback for unknowns
      const violations = [];
      for (const name of objects) {
        const info = getClassifier().lookup(name);
        if (info) {
          // A and B tiers: do not suggest replacements
          const isCompliant = info.tier === 'A' || info.tier === 'B';
          let replacement = isCompliant ? '' : (info.replacement || '');
          let replacementType = isCompliant ? '' : (info.replacementType || '');
          let note = info.note || '';

          // If no replacement in JSON and tier is not A/B, ask AI for recommendation
          if (!replacement && !isCompliant) {
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
            source: info.source || 'local-json',
          });
        } else {
          // Not in local JSON — Grounding + AI fallback
          try {
            const result = await classifyWithGrounding(name);
            if (result) {
              violations.push({
                objectName: name,
                tier: result.tier || 'unknown',
                state: result.state || 'unknown',
                line: 0, callType: '',
                replacement: result.recommendation || '',
                replacementType: '',
                note: result.explanation || '',
                source: result.source || 'ai-inference',
              });
            } else {
              violations.push({
                objectName: name, tier: 'unknown', state: 'unknown',
                line: 0, callType: '', replacement: '', replacementType: '',
                note: '未在本地数据中找到，Grounding 和 AI 也无法推断，请手动核实。',
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

      const classifyCollectionId = process.env.AICORE_GROUNDING_COLLECTION_ID;
      return {
        replyType: 'violations',
        text: violations.length > 0
          ? `发现 ${violations.length} 个对象，分级结果如下：`
          : '在本地数据中未找到这些对象，建议手动核实。',
        violations: JSON.stringify(violations),
        rewriteOriginal: '', rewriteRewritten: '', notes: JSON.stringify([]),
        sourceType: classifyCollectionId ? 'grounding' : 'ai-core',
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
          // A and B tiers: do not suggest replacements
          const isCompliant = info.tier === 'A' || info.tier === 'B';
          let replacement = isCompliant ? '' : (info.replacement || '');
          let replacementType = isCompliant ? '' : (info.replacementType || '');
          let note = info.note || '';

          // If no replacement in JSON and tier is not A/B, ask AI for recommendation
          if (!replacement && !isCompliant) {
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
          sourceType: 'ai-core',
        };
      }

      // Generate rewrite — skip if all violations are A/B tier (no replacements to apply)
      const needsRewrite = violations.some(v => v.tier !== 'A' && v.tier !== 'B');
      // rewriteOriginal always comes from message directly (saves tokens, avoids truncation)
      let rewriteOriginal = message;
      let rewriteRewritten = '';
      if (needsRewrite) {
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
      }

      return {
        replyType: 'violations',
        text: `发现 ${violations.length} 个 Clean Core 违规对象：`,
        violations: JSON.stringify(violations),
        rewriteOriginal,
        rewriteRewritten,
        notes: JSON.stringify([]),
        sourceType: 'ai-core',
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
        sourceType: 'ai-core',
      };
    }

    // Fallback: general question → explain (with Grounding if available)
    const fallbackCollectionId = process.env.AICORE_GROUNDING_COLLECTION_ID;
    let fallbackText;
    let fallbackSourceType = 'ai-core';
    if (fallbackCollectionId && getAI()) {
      try {
        fallbackText = await getAI().completeWithGrounding(CLEAN_CORE_SYSTEM_PROMPT, message, fallbackCollectionId);
        fallbackSourceType = 'grounding';
      } catch (err) {
        console.warn('[chat/fallback] Grounding failed, falling back:', err.message);
      }
    }
    if (!fallbackText) {
      fallbackText = await getAI().complete(CLEAN_CORE_SYSTEM_PROMPT, buildExplainPrompt(message));
    }
    return {
      replyType: 'general',
      text: fallbackText,
      violations: JSON.stringify([]),
      rewriteOriginal: '',
      rewriteRewritten: '',
      notes: JSON.stringify([]),
      sourceType: fallbackSourceType,
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

  // ── Tab 4: BTP Unified (intent-routed) ────────────────────────────────────
  srv.on('btpUnified', async (req) => {
    const { query } = req.data;
    if (!query || !query.trim()) return req.error(400, 'query is required');

    if (!getAI()) {
      return {
        replyType:  'general',
        answer:     'AI Core 未配置，请在 .env 文件中填入真实的 VCAP_SERVICES 凭据后重启服务。',
        sources:    JSON.stringify([]),
        apis:       JSON.stringify([]),
        sourceType: 'no-ai',
      };
    }

    // Step 1: detect intent (fast, low token)
    let intent = 'general';
    let domain = 'procurement';
    let scenario = query.trim();
    let serviceQuery = query.trim();
    try {
      const raw = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildBtpIntentPrompt(query),
        96,
      );
      const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
      intent       = parsed.intent       || 'general';
      domain       = parsed.domain       || 'procurement';
      scenario     = parsed.scenario     || query.trim();
      serviceQuery = parsed.serviceQuery || query.trim();
      console.log(`[btpUnified] intent=${intent} serviceQuery="${serviceQuery}"`);
    } catch {
      intent = 'general';
    }

    // ── Service path: Discovery Center via MCP ──────────────────────────────
    if (intent === 'service') {
      try {
        const isBroadListing = /有哪些|有什么|列举|服务列表|服务目录|都有|哪些服务|什么服务|all services|list.*service|service.*list|service catalog|services overview/i.test(query);

        let services = [];
        if (isBroadListing) {
          const categories = [
            'AI',
            'Application Development and Automation',
            'Data and Analytics',
            'Developer Productivity',
            'Extension Suite - Development Efficiency',
            'Foundation / Cross Services ',
            'Integration',
            'Services',
            'Process Automation',
            'Data Privacy & Security',
          ];
          const seen = new Set();
          for (const cat of categories) {
            try {
              const catServices = await searchDiscoveryCenter(cat, 25, cat);
              for (const s of catServices) {
                if (!seen.has(s.id)) { seen.add(s.id); services.push(s); }
              }
            } catch (e) {
              console.warn(`[btpUnified/service] category "${cat}" failed:`, e.message);
            }
          }
          for (const kw of ['SAP', 'service', 'platform', 'cloud', 'data', 'integration', 'security', 'analytics', 'build', 'mobile', 'database', 'identity', 'frontend', 'workflow', 'notification']) {
            try {
              const r = await searchDiscoveryCenter(kw, 25);
              for (const s of r) {
                if (!seen.has(s.id)) { seen.add(s.id); services.push(s); }
              }
            } catch (e) { /* ignore */ }
          }
        } else {
          services = await searchDiscoveryCenter(serviceQuery, 25);
        }

        const detailsMap = {};
        if (!isBroadListing && services.length > 0) {
          try {
            detailsMap[services[0].id] = await getServiceDetails(services[0].id);
          } catch (e) {
            console.warn('[btpUnified/service] getServiceDetails failed:', e.message);
          }
        }

        if (isBroadListing) {
          const grouped = {};
          for (const s of services) {
            const cat = s.category || '其他';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(s);
          }

          const allDesc = services.map((s, i) => `${i}|${s.name}|${s.description || ''}`).join('\n');
          let translations = {};
          try {
            const raw = await getAI().complete(
              'You are a precise technical translator for SAP product documentation. ' +
              'Translate each service description from English to Chinese accurately (max 15 Chinese chars). ' +
              'The format is: index|serviceName|englishDescription. ' +
              'Return ONLY a JSON object mapping index to accurate Chinese translation. ' +
              'Do NOT guess — base the translation strictly on the English description provided. ' +
              'Example: {"0":"身份认证与SSO管理","1":"容器应用运行时"}. No markdown fences.',
              allDesc,
              2048,
            );
            translations = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
          } catch (e) {
            console.warn('[btpUnified/service] translation failed:', e.message);
          }

          const lines = [`# SAP BTP 服务完整列表（共 ${services.length} 项）\n`];
          let idx = 0;
          for (const [cat, list] of Object.entries(grouped)) {
            lines.push(`## ${cat}（${list.length} 项）\n`);
            for (const s of list) {
              const zhDesc = translations[String(idx)] || '';
              const enDesc = s.description || '';
              const desc = zhDesc ? `${zhDesc} / ${enDesc}` : enDesc;
              lines.push(`- **${s.name}**：${desc}`);
              idx++;
            }
            lines.push('');
          }
          return {
            replyType:  'general',
            answer:     lines.join('\n'),
            sources:    JSON.stringify([]),
            apis:       JSON.stringify([]),
            sourceType: 'mcp',
          };
        }

        // Specific service query — use AI to format the detailed answer
        const answer = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildBtpServicePrompt(query, services, detailsMap),
          2048,
        );
        return {
          replyType:  'general',
          answer,
          sources:    JSON.stringify([]),
          apis:       JSON.stringify([]),
          sourceType: 'mcp',
        };
      } catch (err) {
        console.warn('[btpUnified/service] MCP failed, falling back to general:', err.message);
        intent = 'general';
      }
    }

    // ── Guide path ──────────────────────────────────────────────────────────
    if (intent === 'guide') {
      let apiResults = [];
      try {
        apiResults = await searchSapApis(domain, scenario, 8);
      } catch (err) {
        console.warn('[btpUnified] API search failed:', err.message);
      }

      let groundingContext = '';
      const btpCollectionId = process.env.AICORE_GROUNDING_COLLECTION_ID;
      if (btpCollectionId && getAI()) {
        try {
          const { DocumentGroundingClient } = require('../src/document-grounding-client');
          const grounder = new DocumentGroundingClient();
          const chunks = await grounder.search(btpCollectionId, scenario, 5);
          if (chunks.length > 0) {
            groundingContext = chunks
              .map((c, i) => `[${i + 1}] ${c.content || c.text || JSON.stringify(c)}`)
              .join('\n\n');
          }
        } catch (err) {
          console.warn('[btpUnified/guide] Grounding failed:', err.message);
        }
      }

      const guide = await getAI().complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildBtpGuidePrompt(domain, scenario, apiResults, groundingContext),
        4096,
      );

      return {
        replyType:  'guide',
        answer:     guide,
        sources:    JSON.stringify([]),
        apis:       JSON.stringify(apiResults),
        sourceType: groundingContext ? 'grounding' : 'ai-core',
      };
    }

    // ── General Q&A path: S3 grounding first, MCP fallback ─────────────────
    const btpGeneralCollectionId = process.env.AICORE_GROUNDING_COLLECTION_ID;

    if (btpGeneralCollectionId && getAI()) {
      try {
        const { DocumentGroundingClient } = require('../src/document-grounding-client');
        const grounder = new DocumentGroundingClient();
        const chunks = await grounder.search(btpGeneralCollectionId, query, 5);

        if (chunks.length > 0) {
          const answer = await getAI().completeWithGrounding(CLEAN_CORE_SYSTEM_PROMPT, query, btpGeneralCollectionId);
          return {
            replyType:  'general',
            answer,
            sources:    JSON.stringify([]),
            apis:       JSON.stringify([]),
            sourceType: 'grounding',
          };
        }
        console.log('[btpUnified/general] S3 returned 0 chunks, falling back to MCP');
      } catch (err) {
        console.warn('[btpUnified/general] Grounding failed, falling back to MCP:', err.message);
      }
    }

    // MCP fallback for general questions
    try {
      const mcpResults = await searchSapDocs(query, 5);
      if (mcpResults.length > 0) {
        const answer = await getAI().complete(
          CLEAN_CORE_SYSTEM_PROMPT,
          buildBtpMcpAnswerPrompt(query, mcpResults),
          1024,
        );
        return {
          replyType:  'general',
          answer,
          sources:    JSON.stringify(mcpResults.map(r => ({ title: r.title, url: r.url, summary: r.snippet || '' }))),
          apis:       JSON.stringify([]),
          sourceType: 'mcp',
        };
      }
    } catch (err) {
      console.warn('[btpUnified/general] MCP search failed:', err.message);
    }

    // Final fallback: pure AI
    const btpAnswer = await getAI().complete(
      CLEAN_CORE_SYSTEM_PROMPT,
      buildBtpAnswerPrompt(query, []),
      1024,
    );

    return {
      replyType:  'general',
      answer:     btpAnswer,
      sources:    JSON.stringify([]),
      apis:       JSON.stringify([]),
      sourceType: 'ai-core',
    };
  });

  // ── Tab 5: API Hub 搜索 ──────────────────────────────────────────────────
  srv.on('searchApiHub', async (req) => {
    const { query, module, offset = 0 } = req.data;
    if (!query?.trim() && !module?.trim()) {
      return req.error(400, 'query 或 module 至少填写一个');
    }
    const opts = { offset, limit: 500 };
    if (module?.trim()) {
      return await listByModule(module.trim().toUpperCase(), opts);
    }
    return await searchApis(query.trim(), opts);
  });

  // ── Tab 6: CDS 关系图谱 ──────────────────────────────────────────────────
  srv.on('analyzeCds', async (req) => {
    const { viewName, parentViewName } = req.data;
    if (!viewName?.trim()) {
      return req.error(400, '请输入 CDS View 名称');
    }

    // depth to fetch: incremental mode = 1 level only, full mode = 2 levels
    const maxDepth = parentViewName ? 1 : 2;

    try {
      const graph = await buildGraphFromAdt(viewName.trim(), maxDepth);

      // Enrich nodes with Clean Core classification via AI (same logic as Tab 1)
      // A/B = clean core compliant; C/D = not compliant
      await Promise.all(graph.nodes.map(async (node) => {
        try {
          const result = await classifyWithGrounding(node.id);
          if (result) {
            const tier = (result.tier || '').toUpperCase();
            node.cleanCore      = tier === 'A' || tier === 'B';
            node.classification = tier === 'A' ? 'C1' : tier === 'B' ? 'C2' : 'Not Classified';
            node.releaseState   = tier === 'A' ? 'Released' : tier === 'B' ? 'Restricted' : 'Internal';
            node.classifySource = result.source || 'ai-inference';
          }
        } catch (_err) {
          // Classification failed for this node — keep ADT-parsed defaults
        }
      }));

      return graph;
    } catch (err) {
      return req.error(404, err.message);
    }
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
