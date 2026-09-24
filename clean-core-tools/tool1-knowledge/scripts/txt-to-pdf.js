// scripts/txt-to-pdf.js
// Converts merged BTP doc txt files to PDF for S3 upload.
// Usage: npm run txt-to-pdf

const fs   = require('fs');
const path = require('path');

let PDFDocument;
try {
  PDFDocument = require('../node_modules/pdfkit');
} catch (e) {
  PDFDocument = require('pdfkit');
}

const IN_DIR  = path.join(__dirname, '..', 'output', 'btp-docs-merged');
const OUT_DIR = path.join(__dirname, '..', 'output', 'btp-docs-pdf');

function txtToPdf(inputFile, outputFile, title) {
  return new Promise((resolve, reject) => {
    const text = fs.readFileSync(inputFile, 'utf-8');
    const doc  = new PDFDocument({ margin: 50, size: 'A4' });
    const out  = fs.createWriteStream(outputFile);

    doc.pipe(out);

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown();

    // Content — split into chunks to avoid memory issues
    const lines = text.split('\n');
    let currentSize = 10;

    for (const line of lines) {
      if (line.startsWith('=== ')) {
        // Section header
        doc.fontSize(12).font('Helvetica-Bold').text(line.replace(/===/g, '').trim());
        doc.fontSize(10).font('Helvetica');
      } else if (line.startsWith('URL: ') || line.startsWith('Title: ')) {
        doc.fontSize(9).font('Helvetica-Oblique').text(line, { lineGap: 1 });
        doc.font('Helvetica').fontSize(10);
      } else if (line === '---') {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);
      } else {
        doc.fontSize(10).font('Helvetica').text(line, { lineGap: 2 });
      }
    }

    doc.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

async function main() {
  console.log('=== TXT to PDF Converter ===\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(IN_DIR).filter(f => f.endsWith('.txt'));
  console.log(`Found ${files.length} txt files\n`);

  for (const file of files) {
    const inFile  = path.join(IN_DIR, file);
    const outFile = path.join(OUT_DIR, file.replace('.txt', '.pdf'));
    const title   = 'SAP BTP Documentation - ' + file.replace('.txt', '').replace(/-/g, ' ').toUpperCase();

    process.stdout.write(`Converting: ${file.padEnd(35)} → `);
    try {
      await txtToPdf(inFile, outFile, title);
      const size = (fs.statSync(outFile).size / 1024).toFixed(0);
      console.log(`${size} KB ✓`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  const pdfs = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.pdf'));
  const totalSize = pdfs.reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0);

  console.log(`\n✓ Done! ${pdfs.length} PDF files, ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log('\nNext: upload to S3');
  console.log('  aws s3 sync output/btp-docs-pdf/ s3://hcp-4e6f08ff-6e15-4b21-9bf7-a40444310e6c/btp-docs-pdf/ --region eu-central-1');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
