// Upload a PDF file to SAP AI Core Document Grounding collection
// Usage: node upload-pdf-to-grounding.js <path-to-pdf>
//
// Example:
//   node upload-pdf-to-grounding.js "C:/Users/I524685/Desktop/my-doc.pdf"

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

// ── Load .env ────────────────────────────────────────────────────────────────
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

// ── Config ───────────────────────────────────────────────────────────────────
const COLLECTION_ID   = process.env.GROUNDING_COLLECTION_ID || 'd1e9b646-a1ae-4ca6-8c27-26001c4b243d';
const RESOURCE_GROUP  = process.env.AICORE_RESOURCE_GROUP   || 'docgrp';
const CHUNK_SIZE      = 1000;  // characters per chunk
const CHUNK_OVERLAP   = 100;   // overlap between chunks

// ── Get AI Core token ────────────────────────────────────────────────────────
async function getToken() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES);
  const { url, clientid, clientsecret } = vcap.aicore[0].credentials;
  const resp = await axios.post(
    `${url}/oauth/token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: clientid, client_secret: clientsecret }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
  );
  return resp.data.access_token;
}

// ── Get AI Core base URL ─────────────────────────────────────────────────────
function getBaseUrl() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES);
  return vcap.aicore[0].credentials.serviceurls.AI_API_URL.replace(/\/$/, '');
}

// ── Split text into overlapping chunks ───────────────────────────────────────
function chunkText(text, size, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += size - overlap;
  }
  return chunks.filter(c => c.length > 20); // skip near-empty chunks
}

// ── Upload chunks to collection ───────────────────────────────────────────────
async function uploadChunks(token, baseUrl, docTitle, chunks) {
  const url = `${baseUrl}/v2/lm/document-grounding/vector/collections/${COLLECTION_ID}/documents`;

  const documents = [{
    metadata: [
      { key: 'title',  value: [docTitle] },
      { key: 'source', value: ['pdf-upload'] },
      { key: 'date',   value: [new Date().toISOString().slice(0, 10)] }
    ],
    chunks: chunks.map((text, i) => ({
      content: text,
      metadata: [{ key: 'chunk_index', value: [String(i)] }]
    }))
  }];

  const resp = await axios.post(url, { documents }, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'AI-Resource-Group': RESOURCE_GROUP,
    },
    timeout: 120000,
  });

  return resp.data;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: node upload-pdf-to-grounding.js <path-to-pdf>');
    process.exit(1);
  }

  const absPath = path.resolve(pdfPath);
  if (!fs.existsSync(absPath)) {
    console.error('File not found:', absPath);
    process.exit(1);
  }

  const docTitle = path.basename(absPath, '.pdf');
  console.log(`\nUploading: ${docTitle}`);
  console.log(`Collection: ${COLLECTION_ID}`);
  console.log(`Resource Group: ${RESOURCE_GROUP}\n`);

  // Parse PDF
  console.log('Step 1: Parsing PDF...');
  const text = await new Promise((resolve, reject) => {
    const PDFParser = require('pdf2json');
    const pdfParser = new PDFParser(null, 1); // rawTextContent=1
    pdfParser.on('pdfParser_dataError', err => reject(err.parserError));
    pdfParser.on('pdfParser_dataReady', () => {
      resolve(pdfParser.getRawTextContent());
    });
    pdfParser.loadPDF(absPath);
  });
  console.log(`  Characters: ${text.length}`);

  // Chunk
  console.log('Step 2: Chunking text...');
  const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log(`  Chunks: ${chunks.length}`);

  // Get token
  console.log('Step 3: Getting AI Core token...');
  const token = await getToken();
  console.log('  OK');

  // Upload
  console.log('Step 4: Uploading to collection...');
  const result = await uploadChunks(token, getBaseUrl(), docTitle, chunks);
  console.log('\n✅ Upload successful!');
  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('\n❌ Error:', err.response?.data || err.message);
  process.exit(1);
});
