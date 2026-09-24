// scripts/generate-cleancore-pdf.js
// Generates a Clean Core ABCD Classification PDF (English only, no CJK font needed)

const fs   = require('fs');
const path = require('path');

let PDFDocument;
try {
  PDFDocument = require('../node_modules/pdfkit');
} catch (e) {
  PDFDocument = require('pdfkit');
}

const OUT_FILE = path.join(__dirname, '..', 'output', 'CleanCore_Classification_Rules.pdf');
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const doc = new PDFDocument({ margin: 50, size: 'A4' });
const stream = fs.createWriteStream(OUT_FILE);
doc.pipe(stream);

const COLOR_BLUE  = '#0a6ed1';
const COLOR_DARK  = '#1a1a2e';
const COLOR_GRAY  = '#666666';
const COLOR_A     = '#1a7f3c';
const COLOR_B     = '#e67e00';
const COLOR_C     = '#d4aa00';
const COLOR_D     = '#c0392b';
const PAGE_W      = doc.page.width - 100;

// ── Title bar ─────────────────────────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, 90).fill(COLOR_BLUE);
doc.fill('#ffffff').fontSize(20).font('Helvetica-Bold')
   .text('SAP Clean Core Extension Classification Rules', 50, 22, { width: PAGE_W });
doc.fontSize(11).font('Helvetica')
   .text('A / B / C / D Level Overview  |  Based on SAP Clean Core Extensibility White Paper', 50, 52, { width: PAGE_W });
doc.fill(COLOR_DARK);

// ── Intro ─────────────────────────────────────────────────────────────────────
doc.fontSize(9).font('Helvetica').fill(COLOR_GRAY)
   .text('Extensions are classified by the type of SAP objects they use. The overall level of an extension is determined by its lowest-ranked component.', 50, 105, { width: PAGE_W });

let y = 128;

// ── Helper: draw level card ───────────────────────────────────────────────────
function drawCard(level, title, subtitle, color, coreRule, bullets, atc, risk, examples, yStart) {
  const cardH = 175;
  doc.roundedRect(50, yStart, PAGE_W, cardH, 6).fill('#fafafa').stroke('#e0e0e0');
  doc.roundedRect(50, yStart, 58, cardH, 6).fill(color);
  doc.fill('#ffffff').fontSize(30).font('Helvetica-Bold')
     .text(level, 50, yStart + 60, { width: 58, align: 'center' });

  doc.fill(color).fontSize(12).font('Helvetica-Bold')
     .text(title, 120, yStart + 10, { width: PAGE_W - 70 });
  doc.fill(COLOR_GRAY).fontSize(9).font('Helvetica-BoldOblique')
     .text(subtitle, 120, yStart + 25, { width: PAGE_W - 70 });

  doc.fill(COLOR_DARK).fontSize(8.5).font('Helvetica-Bold')
     .text('Core Rule: ', 120, yStart + 38);
  doc.fill(COLOR_GRAY).font('Helvetica')
     .text(coreRule, 120, yStart + 49, { width: PAGE_W - 78 });

  let by = yStart + 63;
  for (const b of bullets) {
    doc.fill(COLOR_DARK).fontSize(8).font('Helvetica')
       .text('• ' + b, 120, by, { width: PAGE_W - 78 });
    by += 13;
  }

  const botY = yStart + cardH - 32;
  doc.rect(120, botY, PAGE_W - 70, 26).fill('#eeeeee');
  doc.fill(COLOR_GRAY).fontSize(7.5).font('Helvetica-Bold').text('ATC:', 125, botY + 4);
  doc.font('Helvetica').fill(COLOR_DARK).text(atc, 125, botY + 13, { width: 120 });
  doc.fill(COLOR_GRAY).font('Helvetica-Bold').text('Risk:', 262, botY + 4);
  doc.font('Helvetica').fill(color).text(risk, 262, botY + 13, { width: 80 });
  doc.fill(COLOR_GRAY).font('Helvetica-Bold').text('Examples:', 360, botY + 4);
  doc.fill(COLOR_DARK).font('Helvetica').text(examples, 360, botY + 13, { width: PAGE_W - 310 });

  return yStart + cardH + 12;
}

y = drawCard(
  'A',
  'Level A  —  Fully Clean',
  'Cloud development using only Released APIs with formal Stability Contract',
  COLOR_A,
  'Only released SAP interfaces may be used. All objects are governed by a Stability Contract.',
  [
    'On-stack: ABAP Cloud development model, using released local APIs (CDS Views, BO interfaces, extension points)',
    'Side-by-side: ABAP Cloud, CAP or low-code tools (SAP Build) on SAP BTP, released remote APIs only',
    'Discovery: All released interfaces are listed on SAP Business Accelerator Hub',
  ],
  'No finding',
  'Lowest',
  'CDS View, BTP OData API, SAP Build App',
  y
);

y = drawCard(
  'B',
  'Level B  —  Conditionally Clean (Classic APIs)',
  'Classic APIs nominated by SAP experts — upgrade-stable but no formal contract',
  COLOR_B,
  'Uses SAP "classic APIs": well-established, documented interfaces without formal stability contracts.',
  [
    'Uses BAPIs, User Exits, BAdIs, SAP GUI, ABAP List Viewer (e.g. CL_GUI_ALV_GRID)',
    'Developed with ABAP standard language version, no restricted objects referenced',
    'Identified via Cloudification Repository (state = Classic API)',
  ],
  'Priority 3 (Info)',
  'Low',
  'BAPI_PO_CREATE1, CL_GUI_ALV_GRID, User Exit',
  y
);

y = drawCard(
  'C',
  'Level C  —  Conditionally Clean (Internal Objects)',
  'Uses SAP-internal objects — not released, not recommended, no stability guarantee',
  COLOR_C,
  'Accesses SAP internal objects that are neither released nor classic. No documentation or long-term stability guaranteed.',
  [
    'Direct use of internal function modules, classes, or read-only access to SAP standard tables',
    'SAP technically allows access but provides no support or compatibility guarantee',
    'Mitigation: Use "Changelog for SAP Objects" to detect breaking changes before upgrades',
  ],
  'Priority 2 (Warning)',
  'Medium',
  'Unreleased function modules, read SAP tables',
  y
);

y = drawCard(
  'D',
  'Level D  —  Not Clean Core',
  'Uses "not recommended" objects or techniques — highest upgrade risk and technical debt',
  COLOR_D,
  'Uses objects or patterns explicitly classified by SAP as "not recommended" (noAPI, modifications, etc.).',
  [
    'Objects marked noAPI in Cloudification Repository (filter: state = noAPI)',
    'Modifications to SAP standard code / direct write access to SAP standard tables',
    'Implicit enhancements or other explicitly forbidden extension techniques',
  ],
  'Priority 1 (Error)',
  'HIGHEST',
  'Modified SAP code, write to SAP tables',
  y
);

// ── Page 2: Quick Reference Table ────────────────────────────────────────────
doc.addPage();

doc.rect(0, 0, doc.page.width, 50).fill(COLOR_BLUE);
doc.fill('#ffffff').fontSize(16).font('Helvetica-Bold')
   .text('Quick Reference Table', 50, 17, { width: PAGE_W });
doc.fill(COLOR_DARK);

const tableY  = 65;
const cols    = [38, 185, 70, 175, 82];
const headers = ['Level', 'Keywords', 'Risk', 'Examples', 'ATC Priority'];
const rows = [
  ['A', 'Released API, ABAP Cloud, SAP Build, Stability Contract, Business Accelerator Hub', 'Lowest', 'CDS View, BTP OData API, CAP, SAP Build', 'No finding'],
  ['B', 'Classic API, BAPI, User Exit, BAdI, SAP GUI, Cloudification Repository', 'Low',    'BAPI_PO_CREATE1, CL_GUI_ALV_GRID',         'Priority 3'],
  ['C', 'Internal Object, unreleased FM, internal class, SAP table read access',             'Medium', 'Unreleased function modules, read SAP tables', 'Priority 2'],
  ['D', 'noAPI, Modification, Implicit Enhancement, write SAP table, not recommended',       'HIGHEST','Direct SAP code modification, write standard tables', 'Priority 1'],
];
const levelColors = [COLOR_A, COLOR_B, COLOR_C, COLOR_D];

// Header
let tx = 50;
doc.rect(50, tableY, PAGE_W, 18).fill(COLOR_BLUE);
for (let i = 0; i < headers.length; i++) {
  doc.fill('#ffffff').fontSize(8.5).font('Helvetica-Bold')
     .text(headers[i], tx + 4, tableY + 5, { width: cols[i] - 4 });
  tx += cols[i];
}

// Rows
rows.forEach((row, ri) => {
  const ry = tableY + 18 + ri * 30;
  doc.rect(50, ry, PAGE_W, 30).fill(ri % 2 === 0 ? '#f5f5f5' : '#ffffff').stroke('#e0e0e0');
  let rx = 50;
  row.forEach((cell, ci) => {
    const fcolor = ci === 0 ? levelColors[ri] : (ci === 2 ? levelColors[ri] : COLOR_DARK);
    doc.fill(fcolor).fontSize(8).font(ci === 0 ? 'Helvetica-Bold' : 'Helvetica')
       .text(cell, rx + 4, ry + 10, { width: cols[ci] - 6 });
    rx += cols[ci];
  });
});

// ── Golden Rule box ───────────────────────────────────────────────────────────
const ruleY = tableY + 18 + rows.length * 30 + 18;
doc.roundedRect(50, ruleY, PAGE_W, 55, 6).fill('#e8f4ff').stroke(COLOR_BLUE);
doc.fill(COLOR_BLUE).fontSize(10).font('Helvetica-Bold')
   .text('Golden Rule', 62, ruleY + 8);
doc.fill(COLOR_DARK).font('Helvetica').fontSize(9)
   .text('The overall level of an extension is determined by its LOWEST-ranked component.', 62, ruleY + 22, { width: PAGE_W - 24 });
doc.text('Example: an extension using both Level A and Level C objects is classified as Level C overall.', 62, ruleY + 34, { width: PAGE_W - 24 });
doc.fill(COLOR_GRAY).fontSize(8)
   .text('Recommendation: Always aim for Level A (BTP-first strategy). Prioritize immediate remediation of Level D objects.', 62, ruleY + 46, { width: PAGE_W - 24 });

// ── Level D Priority box ──────────────────────────────────────────────────────
const warnY = ruleY + 72;
doc.roundedRect(50, warnY, PAGE_W, 40, 6).fill('#fdf0f0').stroke(COLOR_D);
doc.fill(COLOR_D).fontSize(10).font('Helvetica-Bold')
   .text('Level D: Immediate Action Required', 62, warnY + 8);
doc.fill(COLOR_DARK).font('Helvetica').fontSize(9)
   .text('Level D extensions represent the highest risk. They should be identified, prioritized, and removed or refactored without delay.', 62, warnY + 22, { width: PAGE_W - 24 });

// ── Footer ────────────────────────────────────────────────────────────────────
doc.fill(COLOR_GRAY).fontSize(7).font('Helvetica')
   .text('Source: SAP Clean Core Extensibility White Paper  |  Generated by tool1-knowledge', 50, 780, { width: PAGE_W, align: 'center' });

doc.end();
stream.on('finish', () => console.log('Done: ' + OUT_FILE));
stream.on('error',  e  => console.error('Error:', e.message));
