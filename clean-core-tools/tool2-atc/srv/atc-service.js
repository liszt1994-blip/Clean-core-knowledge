const cds = require('@sap/cds');
const crypto = require('crypto');
const pLimit = require('p-limit');
const { parseAtcXml } = require('@clean-core/shared/atc-xml-parser');
const { runReActAgent } = require('./react-agent');
const { AdtClient } = require('./adt-client');
const { writeBack } = require('./write-back');
const { activateWithRetry } = require('./activation');
const { ClaudeClient } = require('@clean-core/shared/claude-client');
const { createJob, getJob, updateJob } = require('./job-store');

const ADT_CONFIG = {
  baseUrl: process.env.ADT_BASE_URL || '',
  username: process.env.ADT_USERNAME || '',
  password: process.env.ADT_PASSWORD || '',
};

// SSE clients registry: jobId → Set of response objects
const sseClients = new Map();

function broadcast(jobId, event) {
  const clients = sseClients.get(jobId);
  if (!clients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { /* client disconnected */ }
  }
}

module.exports = cds.service.impl(async function (srv) {

  srv.on('uploadAtc', async (req) => {
    const { xmlContent } = req.data;
    if (!xmlContent?.trim()) return req.error(400, 'xmlContent is required');

    const grouped = await parseAtcXml(xmlContent);
    const programs = Object.keys(grouped);
    if (programs.length === 0) return req.error(400, 'No violations found in XML');

    const jobId = crypto.randomUUID();
    createJob(jobId, { violations: grouped });

    // Start analysis asynchronously
    setImmediate(() => runAnalysis(jobId, grouped));

    return { jobId };
  });

  srv.on('confirmFixes', async (req) => {
    const { jobId, transportRequest, confirmedPrograms } = req.data;
    const job = getJob(jobId);
    if (!job) return req.error(404, `Job ${jobId} not found`);
    if (job.status !== 'awaiting_confirmation') {
      return req.error(409, `Job is in status ${job.status}, not awaiting_confirmation`);
    }

    const confirmations = {};
    for (const p of confirmedPrograms) {
      confirmations[p] = { confirmed: true, transportRequest };
    }
    updateJob(jobId, { confirmations, status: 'writing' });

    setImmediate(() => runWriteBack(jobId, confirmations));

    return { status: 'writing_started' };
  });
});

// SSE endpoint — registered in server.js bootstrap

async function runAnalysis(jobId, grouped) {
  const programs = Object.keys(grouped);
  const limit = pLimit(8);
  updateJob(jobId, { status: 'analyzing' });
  broadcast(jobId, { type: 'analysis_started', programs });

  const agentResults = {};
  await Promise.all(programs.map(program =>
    limit(async () => {
      broadcast(jobId, { type: 'agent_started', program });
      const result = await runReActAgent({
        program,
        violations: grouped[program],
        adtConfig: ADT_CONFIG,
        onStep: (step) => broadcast(jobId, { type: 'agent_step', program, step }),
      });
      agentResults[program] = result;
      broadcast(jobId, { type: 'agent_done', program, result });
    })
  ));

  updateJob(jobId, { agentResults, status: 'awaiting_confirmation' });
  broadcast(jobId, { type: 'analysis_complete', agentResults });
}

async function runWriteBack(jobId, confirmations) {
  const job = getJob(jobId);
  const adt = new AdtClient(ADT_CONFIG);
  const writeResults = {};

  for (const [program, conf] of Object.entries(confirmations)) {
    if (!conf.confirmed) continue;
    const agentResult = job.agentResults[program];
    if (!agentResult?.replacementCode) continue;

    broadcast(jobId, { type: 'write_started', program });
    const result = await writeBack({
      adt,
      program,
      objectType: job.violations[program][0].objectType,
      newSource: agentResult.replacementCode,
      transportRequest: conf.transportRequest,
    });
    writeResults[program] = result;
    broadcast(jobId, { type: 'write_done', program, result });
  }

  updateJob(jobId, { writeResults, status: 'activating' });

  // Phase 4: activate
  const claude = new ClaudeClient();
  const activationResults = {};
  for (const [program, writeResult] of Object.entries(writeResults)) {
    if (writeResult.status !== 'SUCCESS') continue;
    broadcast(jobId, { type: 'activation_started', program });
    const result = await activateWithRetry({
      adt,
      claude,
      program,
      objectType: job.violations[program][0].objectType,
      currentSource: job.agentResults[program].replacementCode,
      transportRequest: job.confirmations[program].transportRequest,
      onAttempt: (attempt) => broadcast(jobId, { type: 'activation_attempt', program, attempt }),
    });
    activationResults[program] = result;
    broadcast(jobId, { type: 'activation_done', program, result });
  }

  updateJob(jobId, { activationResults, status: 'done' });
  broadcast(jobId, { type: 'pipeline_complete', activationResults });
}

// Export broadcast and sseClients for use in server.js
module.exports.sseClients = sseClients;
module.exports.getJob = getJob;
