const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  // Lazy require to avoid circular deps at module load time
  const { sseClients, getJob } = require('./srv/atc-service');

  app.get('/stream/atc/:jobId', (req, res) => {
    const { jobId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(jobId)) sseClients.set(jobId, new Set());
    sseClients.get(jobId).add(res);

    req.on('close', () => {
      sseClients.get(jobId)?.delete(res);
    });

    // Send current job state immediately on connect
    const job = getJob(jobId);
    if (job) res.write(`data: ${JSON.stringify({ type: 'state', job })}\n\n`);
  });
});

module.exports = cds.server;
