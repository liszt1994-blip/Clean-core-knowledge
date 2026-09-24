// scripts/test-crawl-single.js
// Test crawling a single BTP page to verify content extraction quality

const path = require('path');
let puppeteer;
try {
  puppeteer = require('../node_modules/puppeteer');
} catch (e) {
  puppeteer = require('puppeteer');
}

const TEST_URL = 'https://help.sap.com/docs/btp/sap-business-technology-platform/sap-business-technology-platform';

async function main() {
  console.log('Testing URL:', TEST_URL, '\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for content
  try {
    await page.waitForSelector('.help-content, .topic-content, article, main, [role="main"]', { timeout: 5000 });
  } catch (e) {}

  await new Promise(r => setTimeout(r, 2000));

  const result = await page.evaluate(() => {
    const title = document.title;

    // Try content selectors
    const selectors = [
      '.help-content', '.topic-content', '.documentation-content',
      'article', 'main', '[role="main"]', '.content-container',
      '#content', '.page-content',
    ];

    let contentEl = null;
    let usedSelector = '';
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 200) {
        contentEl = el;
        usedSelector = sel;
        break;
      }
    }

    // Remove noise elements
    if (contentEl) {
      ['nav', 'header', 'footer', '.breadcrumb', '.sidebar', '.navigation',
       '.toc', 'script', 'style'].forEach(sel => {
        contentEl.querySelectorAll(sel).forEach(el => el.remove());
      });
    }

    const text = contentEl
      ? contentEl.innerText.replace(/\s{3,}/g, '\n\n').trim()
      : '';

    // Also show all available selectors with their text lengths
    const available = {};
    ['.help-content', '.topic-content', 'article', 'main', '[role="main"]',
     '#content', '.page-content', 'body'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) available[sel] = el.innerText.length;
    });

    return { title, usedSelector, textLength: text.length, textPreview: text.slice(0, 1000), available };
  });

  console.log('Title:', result.title);
  console.log('Used selector:', result.usedSelector || '(none)');
  console.log('Text length:', result.textLength, 'chars');
  console.log('\nAvailable selectors:');
  Object.entries(result.available).forEach(([sel, len]) => {
    console.log(`  ${sel.padEnd(20)} ${len} chars`);
  });
  console.log('\n--- Content Preview (first 1000 chars) ---\n');
  console.log(result.textPreview || '(empty)');

  await browser.close();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
