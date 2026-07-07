const { parseAtcXml } = require('@clean-core/shared/atc-xml-parser');

/**
 * Parse ATC input — supports either raw XML string or tool2 JSON (agentResults).
 *
 * Tool2 JSON format (agentResults):
 * { "ZPROG_A": { replacementCode: "...", explanation: "..." }, ... }
 *
 * Returns: { programs, violations }
 *   programs: string[]  — list of program names
 *   violations: { [program]: violation[] }  — per-program violations (may be empty for tool2 JSON)
 *   agentResults: { [program]: { explanation, replacementCode } } | null
 */
async function parseInput(xmlContent, tool2Json) {
  if (tool2Json && tool2Json.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(tool2Json);
    } catch (e) {
      throw new Error('tool2Json 解析失败: ' + e.message);
    }
    // tool2 JSON is agentResults map: { programName: { replacementCode, explanation } }
    const programs = Object.keys(parsed);
    const violations = {};
    programs.forEach(p => { violations[p] = []; });
    return { programs, violations, agentResults: parsed };
  }

  if (xmlContent && xmlContent.trim()) {
    const violations = await parseAtcXml(xmlContent);
    const programs = Object.keys(violations);
    return { programs, violations, agentResults: null };
  }

  throw new Error('必须提供 xmlContent 或 tool2Json');
}

/**
 * Build a simple dependency graph from violations.
 * Uses Claude to infer program dependencies from object names and violation descriptions.
 *
 * Returns: { nodes: string[], edges: [string, string][] }
 * Each edge [A, B] means A must be fixed before B (A is a dependency of B).
 */
async function buildDependencyGraph(programs, violations, agentResults, claude) {
  if (programs.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Build a compact summary for Claude to analyze
  const summaries = programs.map(prog => {
    const viols = violations[prog] || [];
    const agent = agentResults ? agentResults[prog] : null;
    const violSummary = viols.slice(0, 3).map(v => v.description || v.checkId).join('; ');
    const explSummary = agent ? agent.explanation : '';
    return `${prog}: ${violSummary || explSummary || '(no details)'}`;
  });

  const prompt = `You are analyzing SAP ABAP programs that need Clean Core remediation.

Program list with violation summaries:
${summaries.join('\n')}

Task: Identify dependency relationships between these programs for remediation planning.
A dependency means: program A must be remediated BEFORE program B (because B calls A, or B depends on A's interfaces).

Rules:
- Only identify CLEAR dependencies based on naming conventions (e.g., a FUNCTION GROUP called from a REPORT)
- If no clear dependency exists, do not add an edge
- Prefer independent programs (fewer dependencies) for scheduling flexibility
- Return ONLY a JSON object in this exact format, no explanation:
{
  "edges": [
    ["DEPENDENCY_PROGRAM", "DEPENDENT_PROGRAM"],
    ...
  ]
}`;

  let edgesJson;
  try {
    const response = await claude.complete(prompt);
    // Extract JSON from response
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) { throw new Error('No JSON in response'); }
    edgesJson = JSON.parse(match[0]);
  } catch (e) {
    // If Claude fails, return no edges (all programs independent)
    edgesJson = { edges: [] };
  }

  const validEdges = (edgesJson.edges || []).filter(
    ([a, b]) => programs.includes(a) && programs.includes(b) && a !== b
  );

  return { nodes: programs, edges: validEdges };
}

module.exports = { parseInput, buildDependencyGraph };
