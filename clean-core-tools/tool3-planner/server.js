const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  const { getSession } = require('./srv/planner-service');

  // Export endpoints — return binary file downloads
  app.get('/export/excel/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    if (!session || !session.plan) {
      return res.status(404).json({ error: 'Session not found or plan not generated' });
    }
    try {
      const { exportExcel } = require('./srv/exporters');
      const buffer = await exportExcel(session.plan);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="sprint-plan.xlsx"');
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/export/pdf/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    if (!session || !session.plan) {
      return res.status(404).json({ error: 'Session not found or plan not generated' });
    }
    try {
      const { exportPdf } = require('./srv/exporters');
      const buffer = await exportPdf(session.plan);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="sprint-plan.pdf"');
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

module.exports = cds.server;
