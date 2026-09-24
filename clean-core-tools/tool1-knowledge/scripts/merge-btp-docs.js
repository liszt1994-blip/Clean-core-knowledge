// scripts/merge-btp-docs.js
// Merges individual BTP doc txt files into category-based files for S3 upload.
// Usage: node scripts/merge-btp-docs.js

const fs   = require('fs');
const path = require('path');

const IN_DIR  = path.join(__dirname, '..', 'output', 'btp-docs');
const OUT_DIR = path.join(__dirname, '..', 'output', 'btp-docs-merged');

const CATEGORY_RULES = [
  { keywords: ['security', 'authentication', 'authorization', 'identity', 'trust', 'oauth', 'xsuaa', 'role', 'permission'], file: 'security-identity' },
  { keywords: ['cloud-foundry', 'cf-', 'cloudfoundry'], file: 'cloud-foundry' },
  { keywords: ['kyma', 'kubernetes', 'k8s'], file: 'kyma' },
  { keywords: ['abap', 'abap-environment'], file: 'abap-environment' },
  { keywords: ['connectivity', 'destination', 'cloud-connector'], file: 'connectivity' },
  { keywords: ['integration', 'api-management', 'event-mesh', 'messaging'], file: 'integration' },
  { keywords: ['developer', 'develop', 'cap', 'application-programming'], file: 'development' },
  { keywords: ['hana', 'database', 'data-intelligence'], file: 'hana-data' },
  { keywords: ['account', 'subaccount', 'entitlement', 'subscription', 'cockpit'], file: 'account-management' },
  { keywords: ['extension', 'extensibility', 'side-by-side'], file: 'extensibility' },
];

function getCategory(filename, content) {
  const text = (filename + ' ' + content.slice(0, 500)).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(k => text.includes(k))) return rule.file;
  }
  return 'general';
}

async function main() {
  console.log('=== Merging BTP Docs ===\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(IN_DIR).filter(f => f.endsWith('.txt') && f !== '_progress.json');
  console.log(`Input files: ${files.length}`);

  // Open write streams per category
  const streams = {};
  function getStream(category) {
    if (!streams[category]) {
      const p = path.join(OUT_DIR, category + '.txt');
      streams[category] = fs.createWriteStream(p, { flags: 'w' });
      streams[category].write(`=== BTP Documentation: ${category} ===\n\n`);
    }
    return streams[category];
  }

  const stats = {};
  for (const file of files) {
    const content = fs.readFileSync(path.join(IN_DIR, file), 'utf-8');
    if (content.trim().length < 100) continue;

    const category = getCategory(file, content);
    getStream(category).write(content + '\n\n---\n\n');
    stats[category] = (stats[category] || 0) + 1;
  }

  // Close all streams and wait for them to finish
  await Promise.all(Object.entries(streams).map(([cat, s]) => {
    return new Promise(resolve => s.end(resolve));
  }));

  console.log('\nMerged into:');
  Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    const size = (fs.statSync(path.join(OUT_DIR, cat + '.txt')).size / 1024).toFixed(0);
    console.log(`  ${cat.padEnd(25)} ${String(count).padStart(4)} files  ${size} KB`);
  });

  const totalFiles = Object.keys(streams).length;
  const totalSize = Object.keys(streams).reduce((s, cat) => {
    return s + fs.statSync(path.join(OUT_DIR, cat + '.txt')).size;
  }, 0);

  console.log(`\nTotal: ${totalFiles} merged files, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log('\nNext: upload to S3');
  console.log('  aws s3 sync output/btp-docs-merged/ s3://hcp-4e6f08ff-6e15-4b21-9bf7-a40444310e6c/btp-docs/ --region eu-central-1');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
