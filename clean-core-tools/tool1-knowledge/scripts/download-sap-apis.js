// scripts/download-sap-apis.js
// Downloads all SAP API Hub content and merges by category for S3 upload.
// Usage: npm run download-apis
// No authentication required — api.sap.com catalog is publicly accessible.

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const OUT_DIR   = path.join(__dirname, '..', 'output', 'sap-apis');
const BASE_HOST = 'api.sap.com';
const BASE_PATH = '/odata/1.0/catalog.svc';
const PAGE_SIZE = 100;

const CATEGORY_RULES = [
  { keywords: ['PURCHAS', 'PROCURE', 'SUPPLIER', 'VENDOR', 'INVOICE', 'SOURCING', 'CONTRACT', 'RFQ', 'REQUISITION'], file: 'procurement' },
  { keywords: ['SALES', 'CUSTOMER', 'BILLING', 'ORDER', 'QUOTATION', 'DELIVERY', 'DISTRIBUTION'], file: 'sales' },
  { keywords: ['FINANCE', 'FINANCIAL', 'JOURNAL', 'PAYMENT', 'ACCOUNTING', 'FISCAL', 'BUDGET', 'COST', 'PROFIT'], file: 'finance' },
  { keywords: ['EMPLOYEE', 'HR', 'HUMAN', 'PAYROLL', 'LEAVE', 'TIMESHEET', 'WORKFORCE', 'TALENT', 'RECRUIT'], file: 'hr' },
  { keywords: ['MATERIAL', 'INVENTORY', 'STOCK', 'WAREHOUSE', 'LOGISTICS', 'TRANSPORT', 'SHIPPING'], file: 'inventory-logistics' },
  { keywords: ['PLANT', 'MAINTENANCE', 'EQUIPMENT', 'ASSET', 'PROJECT', 'WORK_ORDER'], file: 'asset-project' },
  { keywords: ['BTP', 'CLOUD', 'DESTINATION', 'CONNECTIVITY', 'XSUAA', 'KYMA', 'HANA'], file: 'btp-platform' },
  { keywords: ['PRODUCT', 'CATALOG', 'PRICE', 'DISCOUNT', 'PROMOTION'], file: 'product-catalog' },
];

function getCategory(apiName, productTitle) {
  const upper = (apiName + ' ' + (productTitle || '')).toUpperCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(k => upper.includes(k))) return rule.file;
  }
  return 'other';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpsGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BASE_HOST,
      path: urlPath,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0',
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error('HTTP ' + res.statusCode)); return; }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function fetchPage(skip) {
  const p = BASE_PATH + '/APIContent.APIs?$select=Name,Title,ShortText,Description,Version,ProtocolType,Category,ProductTitle,LifecycleState,IsDeprecated,SunsetAt&$format=json&$top=' + PAGE_SIZE + '&$skip=' + skip;
  const data = await httpsGet(p);
  return data && data.d && data.d.results ? data.d.results : [];
}

async function fetchResources(apiName) {
  try {
    const p = BASE_PATH + '/APIContent.APIs(\'' + encodeURIComponent(apiName) + '\')/APIResources?$select=Method,Path,Summary,Description&$format=json&$top=30';
    const data = await httpsGet(p);
    return data && data.d && data.d.results ? data.d.results : [];
  } catch (e) { return []; }
}

function apiToText(api, resources) {
  const deprecated = api.IsDeprecated === 'true' || api.IsDeprecated === true;
  const lines = [
    '=== API: ' + api.Name + ' ===',
    'Title: ' + (api.Title || ''),
    'ShortText: ' + (api.ShortText || ''),
    'Description: ' + ((api.Description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)),
    'Protocol: ' + (api.ProtocolType || ''),
    'Version: ' + (api.Version || ''),
    'Product: ' + (api.ProductTitle || ''),
    'URL: https://api.sap.com/api/' + api.Name + '/overview',
    'State: ' + (api.LifecycleState || ''),
  ];
  if (deprecated) {
    lines.push('DEPRECATED: true');
    if (api.SunsetAt) lines.push('SunsetAt: ' + api.SunsetAt);
  }
  if (resources.length > 0) {
    lines.push('Endpoints:');
    resources.slice(0, 30).forEach(function(r) {
      lines.push('  ' + (r.Method || 'GET') + ' ' + (r.Path || '') + ' - ' + (r.Summary || r.Description || '').slice(0, 100));
    });
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  console.log('=== SAP API Hub Download ===\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const progressFile = path.join(OUT_DIR, '_progress.json');
  const progress = fs.existsSync(progressFile)
    ? JSON.parse(fs.readFileSync(progressFile, 'utf-8'))
    : { done: [], lastSkip: 0 };
  const doneSet = new Set(progress.done);

  console.log('Already done: ' + doneSet.size + ', starting from skip=' + progress.lastSkip + '\n');

  const streams = {};
  function getStream(category) {
    if (!streams[category]) {
      streams[category] = fs.createWriteStream(path.join(OUT_DIR, category + '.txt'), { flags: 'a' });
    }
    return streams[category];
  }

  let processed = doneSet.size;
  let newlyDone = 0;
  let skip = progress.lastSkip;

  while (true) {
    let apis;
    try {
      apis = await fetchPage(skip);
    } catch (err) {
      console.error('\nPage failed at skip=' + skip + ': ' + err.message);
      progress.lastSkip = skip;
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      console.log('Progress saved. Re-run to continue.');
      break;
    }

    if (!apis || apis.length === 0) {
      console.log('\nNo more results - download complete!');
      break;
    }

    for (let i = 0; i < apis.length; i++) {
      const api = apis[i];
      const name = api.Name;
      if (!name || doneSet.has(name)) { processed++; continue; }

      const resources = await fetchResources(name);
      await sleep(50);

      const category = getCategory(name, api.ProductTitle);
      getStream(category).write(apiToText(api, resources) + '\n');

      doneSet.add(name);
      progress.done.push(name);
      processed++;
      newlyDone++;

      process.stdout.write('\r  skip=' + skip + ' | processed=' + processed + ' | new=' + newlyDone + ' | ' + category);

      if (newlyDone % 50 === 0) {
        progress.lastSkip = skip;
        fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      }
    }

    skip += PAGE_SIZE;
    await sleep(150);
  }

  Object.values(streams).forEach(function(s) { s.end(); });
  progress.lastSkip = skip;
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));

  console.log('\n\nDone! ' + newlyDone + ' new APIs saved to: output/sap-apis/');
  var files = fs.readdirSync(OUT_DIR).filter(function(f) { return f.endsWith('.txt'); });
  files.forEach(function(f) {
    var size = (fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(1);
    console.log('  ' + f + '  ' + size + ' KB');
  });
  console.log('\nNext: upload to S3');
  console.log('  aws s3 sync output/sap-apis/ s3://hcp-4e6f08ff-6e15-4b21-9bf7-a40444310e6c/sap-apis/ --region eu-central-1');
}

main().catch(function(err) {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
