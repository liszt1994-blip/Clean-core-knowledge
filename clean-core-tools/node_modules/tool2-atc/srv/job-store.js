// In-memory job store. Each job tracks the full pipeline state.
const jobs = new Map();

function createJob(jobId, data) {
  jobs.set(jobId, {
    jobId,
    status: 'pending',   // pending | analyzing | awaiting_confirmation | writing | activating | done
    violations: data.violations,
    agentResults: {},
    confirmations: {},
    writeResults: {},
    activationResults: {},
    createdAt: Date.now(),
  });
  return jobs.get(jobId);
}

function getJob(jobId) {
  return jobs.get(jobId);
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  Object.assign(job, patch);
  return job;
}

module.exports = { createJob, getJob, updateJob };
