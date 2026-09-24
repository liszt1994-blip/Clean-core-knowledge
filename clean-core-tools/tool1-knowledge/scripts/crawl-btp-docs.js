// scripts/crawl-btp-docs.js
// Fetches SAP BTP documentation via the Help Portal search API,
// then fetches each doc page content directly.
// Usage: npm run crawl-btp

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const pdfParse = require('pdf-parse');

const OUT_DIR       = path.join(__dirname, '..', 'output', 'btp-docs');
const PROGRESS_FILE = path.join(OUT_DIR, '_progress.json');
const HOST          = 'help.sap.com';

// BTP-related search topics to cover
const SEARCH_TOPICS = [
  'SAP BTP overview platform',
  'BTP Cloud Foundry environment',
  'BTP Kyma environment',
  'BTP Neo environment',
  'BTP ABAP environment',
  'BTP security authentication authorization',
  'BTP connectivity destination service',
  'BTP integration suite',
  'BTP extension suite',
  'BTP CAP application programming model',
  'BTP subaccount entitlement',
  'BTP service marketplace',
  'BTP alert notification',
  'BTP SAP HANA cloud',
  'BTP API management',
  'BTP event mesh messaging',
  'BTP identity authentication',
  'BTP transport management',
  'BTP continuous integration delivery',
  'BTP workzone build',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── POST request helper ───────────────────────────────────────────────────────
function httpsPost(host, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: host,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent': 'Mozilla/5.0',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── GET request helper ────────────────────────────────────────────────────────
function httpsGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST,
      path: urlPath,
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, res => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const newPath = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
        return resolve(httpsGet(newPath));
      }
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.from(c)));
      res.on('end', () => resolve({
        status: res.statusCode,
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || '',
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── HTML → plain text ─────────────────────────────────────────────────────────
function htmlToText(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  return title ? 'Title: ' + title + '\n\n' + text : text;
}

function urlToFilename(url) {
  return url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 150) + '.txt';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BTP Docs Crawler ===\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
    : { fetched: [] };
  const fetched = new Set(progress.fetched);

  console.log('Already fetched: ' + fetched.size + ' pages\n');

  let totalNew = 0;

  for (let t = 0; t < SEARCH_TOPICS.length; t++) {
    const topic = SEARCH_TOPICS[t];
    console.log('[' + (t + 1) + '/' + SEARCH_TOPICS.length + '] Topic: ' + topic);

    // Step 1: search for docs
    let results = [];
    try {
      const resp = await httpsPost(HOST, '/api-gateway-direct/search/api/search', {
        query: topic,
        searchType: 'STANDARD',
        language: 'en-US',
        state: 'PRODUCTION',
        top: 20,
      });
      results = (resp.data && resp.data.results) ? resp.data.results : [];
    } catch (err) {
      console.log('  Search failed: ' + err.message);
      continue;
    }

    console.log('  Found ' + results.length + ' results');

    // Step 2: fetch each doc page
    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const rawUrl = item.url || '';
      const fullUrl = rawUrl.startsWith('http') ? rawUrl : 'https://' + HOST + rawUrl;

      if (fetched.has(fullUrl)) continue;

      process.stdout.write('  [' + (i + 1) + '/' + results.length + '] ' + fullUrl.slice(0, 80) + '\r');

      try {
        const urlPath = rawUrl.startsWith('http') ? new URL(rawUrl).pathname + new URL(rawUrl).search : rawUrl;
        const { status, buffer, contentType } = await httpsGet(urlPath);

        if (status === 200 && buffer && buffer.length > 300) {
          let text = '';

          if (contentType.includes('pdf') || rawUrl.toLowerCase().endsWith('.pdf')) {
            // Parse PDF to extract real text
            try {
              const pdfData = await pdfParse(buffer);
              text = pdfData.text || '';
            } catch (e) {
              // PDF parse failed, skip
            }
          } else {
            // HTML page
            text = htmlToText(buffer.toString('utf-8'));
          }

          if (text.length > 200) {
            const content = 'URL: ' + fullUrl + '\nTitle: ' + (item.title || '') + '\nSummary: ' + (item.snippet || '') + '\n\n' + text;
            fs.writeFileSync(path.join(OUT_DIR, urlToFilename(fullUrl)), content, 'utf-8');
            totalNew++;
          }
        }
      } catch (err) {
        // skip
      }

      fetched.add(fullUrl);
      await sleep(200);
    }

    // Save progress after each topic
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ fetched: [...fetched] }, null, 2));
    console.log('  Saved. Total new files: ' + totalNew);
    await sleep(500);
  }

  // Summary
  const files = fs.readdirSync(OUT_DIR).filter(function(f) { return f.endsWith('.txt'); });
  const totalSize = files.reduce(function(s, f) { return s + fs.statSync(path.join(OUT_DIR, f)).size; }, 0);

  console.log('\n✓ Done!');
  console.log('  New pages saved: ' + totalNew);
  console.log('  Total files: ' + files.length);
  console.log('  Total size: ' + (totalSize / 1024 / 1024).toFixed(1) + ' MB');
  console.log('\nNext: upload to S3');
  console.log('  aws s3 sync output/btp-docs/ s3://hcp-4e6f08ff-6e15-4b21-9bf7-a40444310e6c/btp-docs/ --region eu-central-1 --exclude "_progress.json"');
}

main().catch(function(err) {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
