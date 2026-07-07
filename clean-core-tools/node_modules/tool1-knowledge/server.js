// Custom CAP server bootstrap — adds SSE route before CDS starts listening
//
// NOTE: SAP AI Core Orchestration API does not support true SSE streaming.
// The /stream/explain endpoint simulates streaming by splitting the full
// AI response into word-level chunks and writing them one by one over SSE.
// The client-side EventSource handler is fully compatible — it still
// receives incremental `data:` events ending with `data: [DONE]`.

// Load .env file manually (CDS 8.x does not auto-load .env)
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  // CDS 8.x automatically serves the entire ./app folder at /
  // So the UI5 app is at /knowledge/webapp/index.html
  // Redirect root → UI5 app
  app.get('/', (req, res) => res.redirect('/knowledge/webapp/index.html'));

  const { AICoreClient, CLEAN_CORE_SYSTEM_PROMPT } = require('./src/aicore-client');
  const { buildExplainPrompt } = require('./srv/prompts');
  const { DestinationClient } = require('./src/destination-client');

  app.get('/stream/explain', async (req, res) => {
    const term = req.query.term;
    if (!term) {
      res.status(400).json({ error: 'term query parameter is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const ai = new AICoreClient();
      const fullText = await ai.complete(
        CLEAN_CORE_SYSTEM_PROMPT,
        buildExplainPrompt(term),
      );

      // Simulate streaming: emit ~5 words at a time so the UI feels responsive
      const words = fullText.split(' ');
      const CHUNK_SIZE = 5;
      for (let i = 0; i < words.length; i += CHUNK_SIZE) {
        const chunk = words.slice(i, i + CHUNK_SIZE).join(' ') + (i + CHUNK_SIZE < words.length ? ' ' : '');
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  });

  // ── /api/note-content/:noteNumber ─────────────────────────────────────────
  // Fetches SAP Note page via BTP Destination Service and returns extracted text.
  // Requires a BTP Destination named "SAP_SUPPORT_PORTAL" (or DEST_SAP_SUPPORT env var)
  // pointing to https://me.sap.com with appropriate authentication.
  app.get('/api/note-content/:noteNumber', async (req, res) => {
    const { noteNumber } = req.params;
    if (!noteNumber || !/^\d+$/.test(noteNumber)) {
      return res.status(400).json({ error: 'Invalid note number' });
    }
    try {
      const dest = new DestinationClient();
      const content = await dest.fetchNoteContent(noteNumber);
      res.json({ noteNumber, content });
    } catch (err) {
      // Return error as JSON — caller decides whether to fall back to AI summary
      res.status(502).json({ error: err.message, noteNumber });
    }
  });
});

module.exports = cds.server;
