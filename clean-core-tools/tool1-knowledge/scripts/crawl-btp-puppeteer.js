// scripts/crawl-btp-puppeteer.js
// Uses Puppeteer (headless Chrome) to crawl help.sap.com/docs/btp
// and extract rendered content for S3 upload.
// Usage: npm run crawl-btp-puppeteer

const fs   = require('fs');
const path = require('path');

// Find puppeteer in parent or local node_modules
let puppeteer;
try {
  puppeteer = require('../node_modules/puppeteer');
} catch (e) {
  puppeteer = require('puppeteer');
}

const OUT_DIR       = path.join(__dirname, '..', 'output', 'btp-docs');
const PROGRESS_FILE = path.join(OUT_DIR, '_progress.json');
const START_URL     = 'https://help.sap.com/docs/btp';
const ALLOWED_HOST  = 'help.sap.com';
const ALLOWED_PATH  = '/docs/btp';
const MAX_PAGES     = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function urlToFilename(url) {
  return url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 150) + '.txt';
}

function isAllowed(url) {
  try {
    const u = new URL(url);
    return u.hostname === ALLOWED_HOST && u.pathname.startsWith(ALLOWED_PATH);
  } catch (e) { return false; }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `https://${u.hostname}${u.pathname}`;
  } catch (e) { return null; }
}

async function main() {
  console.log('=== BTP Docs Puppeteer Crawler ===\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load progress
  const progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
    : { visited: [], queue: [START_URL] };

  const visited = new Set(progress.visited);
  const queue   = progress.queue.filter(u => !visited.has(u));

  console.log(`Already visited: ${visited.size} | Queued: ${queue.length}\n`);

  // Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let newDone = 0;

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;

    process.stdout.write(`\r  Visited: ${visited.size} | Queue: ${queue.length} | New: ${newDone} | ${url.slice(0, 70).padEnd(70)}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for content to load — try specific content selectors
      try {
        await page.waitForSelector(
          '.help-content, .topic-content, article, main, [role="main"]',
          { timeout: 5000 }
        );
      } catch (e) { /* proceed anyway */ }

      await sleep(1500); // extra wait for dynamic content

      // Extract text content
      const result = await page.evaluate(() => {
        const title = document.title || '';

        // Try to get the main content area specifically
        const contentSelectors = [
          '.help-content',
          '.topic-content',
          '.documentation-content',
          'article',
          'main',
          '[role="main"]',
          '.content-container',
          '#content',
          '.page-content',
        ];

        let contentEl = null;
        for (const sel of contentSelectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.length > 200) {
            contentEl = el;
            break;
          }
        }

        // Remove nav/header/footer/breadcrumb/sidebar from content
        if (contentEl) {
          ['nav', 'header', 'footer', '.breadcrumb', '.sidebar', '.navigation',
           '.toc', '.table-of-contents', 'script', 'style'].forEach(sel => {
            contentEl.querySelectorAll(sel).forEach(el => el.remove());
          });
        }

        const rawText = contentEl
          ? contentEl.innerText
          : document.body ? document.body.innerText : '';

        const text = rawText.replace(/\s{3,}/g, '\n\n').trim();

        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => h && h.startsWith('http'));

        return { title, text, links };
      });

      // Save content if substantial
      if (result.text && result.text.length > 300) {
        const content = `URL: ${url}\nTitle: ${result.title}\n\n${result.text}`;
        fs.writeFileSync(path.join(OUT_DIR, urlToFilename(url)), content, 'utf-8');
        newDone++;
      }

      // Queue new links
      for (const link of result.links) {
        const normalized = normalizeUrl(link);
        if (normalized && isAllowed(normalized) && !visited.has(normalized) && !queue.includes(normalized)) {
          queue.push(normalized);
        }
      }

    } catch (err) {
      // skip failed pages
    }

    visited.add(url);

    // Save progress every 10 pages
    if (visited.size % 10 === 0) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
        visited: [...visited],
        queue: queue.slice(0, 1000), // keep queue manageable
      }, null, 2));
    }

    await sleep(500);
  }

  await browser.close();

  // Final save
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ visited: [...visited], queue }, null, 2));

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.txt'));
  const totalSize = files.reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0);

  console.log(`\n\n✓ Done!`);
  console.log(`  Pages crawled: ${visited.size}`);
  console.log(`  Files saved:   ${files.length}`);
  console.log(`  Total size:    ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log('\nNext: upload to S3');
  console.log('  aws s3 sync output/btp-docs/ s3://hcp-4e6f08ff-6e15-4b21-9bf7-a40444310e6c/btp-docs/ --region eu-central-1 --exclude "_progress.json"');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
