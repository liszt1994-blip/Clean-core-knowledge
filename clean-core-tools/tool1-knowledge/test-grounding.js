// Quick smoke test for Document Grounding
// Run: node test-grounding.js

const fs = require('fs');
const path = require('path');

// Load .env manually
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

const { AICoreClient, CLEAN_CORE_SYSTEM_PROMPT } = require('./src/aicore-client');

async function main() {
  const collectionId = process.env.GROUNDING_COLLECTION_ID;
  console.log('Collection ID:', collectionId);

  const ai = new AICoreClient();

  console.log('\nTesting completeWithGrounding...');
  try {
    const result = await ai.completeWithGrounding(
      CLEAN_CORE_SYSTEM_PROMPT,
      'What is Clean Core in SAP S/4HANA?',
      collectionId,
    );
    console.log('\n✅ Grounding response:\n', result);
  } catch (err) {
    console.error('\n❌ Error:', err.response?.data || err.message);
  }
}

main();
