// Custom CAP server bootstrap — loads .env and redirects root to the UI5 app.

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
});

module.exports = cds.server;
