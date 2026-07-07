const cds = require('@sap/cds');
const crypto = require('crypto');
const { parseInput, buildDependencyGraph } = require('./dep-analyzer');
const { generateSprintPlan } = require('./plan-generator');
const { createSession, getSession, updateSession } = require('./session-store');
const { ClaudeClient } = require('@clean-core/shared/claude-client');

let claude;
function getClient() {
  if (!claude) claude = new ClaudeClient();
  return claude;
}

module.exports = cds.service.impl(async function (srv) {

  srv.on('importAtcData', async (req) => {
    const { xmlContent, tool2Json } = req.data;

    let parsed;
    try {
      parsed = await parseInput(xmlContent, tool2Json);
    } catch (err) {
      return req.error(400, err.message);
    }

    if (parsed.programs.length === 0) {
      return req.error(400, '未发现任何程序');
    }

    const sessionId = crypto.randomUUID();
    createSession(sessionId, {
      programs: parsed.programs,
      violations: parsed.violations,
      agentResults: parsed.agentResults,
      graph: null,
      plan: null
    });

    return { sessionId, programCount: parsed.programs.length };
  });

  srv.on('generatePlan', async (req) => {
    const { sessionId, teamConfig: teamConfigStr } = req.data;
    const session = getSession(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} not found`);

    let teamConfig;
    try {
      teamConfig = teamConfigStr ? JSON.parse(teamConfigStr) : {};
    } catch (e) {
      return req.error(400, 'teamConfig JSON 解析失败: ' + e.message);
    }

    const client = getClient();

    // Build dependency graph
    const graph = await buildDependencyGraph(
      session.programs,
      session.violations,
      session.agentResults,
      client
    );

    // Generate sprint plan
    const plan = await generateSprintPlan(
      graph,
      session.violations,
      session.agentResults,
      teamConfig,
      client
    );

    updateSession(sessionId, { graph, plan });

    return { planJson: JSON.stringify(plan) };
  });

  srv.on('updatePlan', async (req) => {
    const { sessionId, planJson } = req.data;
    const session = getSession(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} not found`);

    let plan;
    try {
      plan = JSON.parse(planJson);
    } catch (e) {
      return req.error(400, 'planJson 解析失败: ' + e.message);
    }

    updateSession(sessionId, { plan });
    return { status: 'updated' };
  });
});

// Export getSession for use in server.js
module.exports.getSession = getSession;
