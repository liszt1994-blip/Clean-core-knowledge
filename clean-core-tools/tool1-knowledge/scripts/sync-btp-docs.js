// scripts/sync-btp-docs.js
// Fetches SAP BTP documentation pages and uploads them to AI Core Document Grounding.
// Run once (or whenever docs need refreshing): npm run sync-docs
//
// Prerequisites: .env must have valid VCAP_SERVICES with aicore credentials.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ── Load .env manually (same logic as server.js) ─────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
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

const { DocumentGroundingClient } = require('../src/document-grounding-client');

const COLLECTION_NAME = 'btp-knowledge';

const BTP_PAGES = [
  { url: 'https://help.sap.com/docs/btp',                                                                                           title: 'SAP BTP Overview' },
  { url: 'https://help.sap.com/docs/btp/sap-business-technology-platform/sap-business-technology-platform',                         title: 'SAP BTP Platform Guide' },
  { url: 'https://help.sap.com/docs/btp/sap-btp-cloud-foundry-environment/cloud-foundry-environment',                               title: 'Cloud Foundry Environment' },
  { url: 'https://help.sap.com/docs/btp/sap-btp-kyma-runtime/kyma-environment',                                                     title: 'Kyma Environment' },
  { url: 'https://help.sap.com/docs/btp/sap-btp-neo-environment/sap-btp-neo-environment',                                           title: 'Neo Environment' },
];

// ── HTML → plain text ─────────────────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Split long text into chunks of ~800 chars, preserving sentence boundaries ─
function chunkText(text, maxLen = 800) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    // Try to break at sentence boundary
    const boundary = text.lastIndexOf('. ', end);
    if (boundary > start + 200) end = boundary + 1;
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(c => c.length > 50);
}

// ── Fetch a page and return chunks ────────────────────────────────────────────
async function fetchPage(page) {
  console.log(`  Fetching: ${page.url}`);
  try {
    const resp = await axios.get(page.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BTP-Doc-Sync/1.0)' },
      timeout: 20000,
    });
    const text = stripHtml(resp.data);
    const chunks = chunkText(text);
    console.log(`  → ${chunks.length} chunks extracted`);
    return chunks.map((content, i) => ({
      url: page.url + (i > 0 ? `#chunk-${i}` : ''),
      content,
      metadata: { source: page.url, title: page.title },
    }));
  } catch (err) {
    console.warn(`  ⚠ Failed to fetch ${page.url}: ${err.message}`);
    return [];
  }
}

// ── Append collectionId to .env ───────────────────────────────────────────────
function saveCollectionId(collectionId) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  if (content.includes('AICORE_GROUNDING_COLLECTION_ID=')) {
    content = content.replace(/AICORE_GROUNDING_COLLECTION_ID=.*/,
      `AICORE_GROUNDING_COLLECTION_ID=${collectionId}`);
  } else {
    content = content.trimEnd() + `\nAICORE_GROUNDING_COLLECTION_ID=${collectionId}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf-8');
  console.log(`\n.env updated: AICORE_GROUNDING_COLLECTION_ID=${collectionId}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BTP Doc Sync ===\n');

  const client = new DocumentGroundingClient();

  // 1. Find or create collection
  let collectionId = null;
  console.log('Checking existing collections...');
  try {
    const existing = await client.listCollections();
    const found = existing.find(c => c.title === COLLECTION_NAME);
    if (found) {
      collectionId = found.id;
      console.log(`Found existing collection: ${collectionId}`);
    }
  } catch (err) {
    console.warn(`Could not list collections: ${err.message}`);
  }

  if (!collectionId) {
    console.log(`Creating collection "${COLLECTION_NAME}"...`);
    collectionId = await client.createCollection(COLLECTION_NAME);
    console.log(`Collection created: ${collectionId}`);
  }

  // 2. Fetch and upload documents
  console.log('\nFetching documents...');
  for (const page of BTP_PAGES) {
    const docs = await fetchPage(page);
    if (docs.length === 0) continue;

    // Upload in batches of 20
    const BATCH = 20;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      try {
        await client.uploadDocuments(collectionId, batch);
        process.stdout.write(`  Uploaded ${Math.min(i + BATCH, docs.length)}/${docs.length} chunks\r`);
      } catch (err) {
        console.error(`\n  Upload error: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      }
    }
    console.log(`  ✓ ${page.title} uploaded`);
  }

  // 3. Save collectionId to .env
  saveCollectionId(collectionId);
  console.log('\n✓ Sync complete. Restart the server to activate grounding.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
