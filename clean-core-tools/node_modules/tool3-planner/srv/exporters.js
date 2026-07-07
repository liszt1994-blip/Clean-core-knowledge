const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * Export sprint plan to Excel buffer.
 * plan: { sprints: Sprint[], summary: { totalPrograms, totalSprints, estimatedWeeks } }
 */
async function exportExcel(plan) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clean Core Planner';
  workbook.created = new Date();

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];
  summarySheet.addRow({ metric: 'Total Programs', value: plan.summary.totalPrograms });
  summarySheet.addRow({ metric: 'Total Sprints', value: plan.summary.totalSprints });
  summarySheet.addRow({ metric: 'Estimated Weeks', value: plan.summary.estimatedWeeks });

  // Style header
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF1D6FA4' }
  };
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Sprint plan sheet
  const planSheet = workbook.addWorksheet('Sprint Plan');
  planSheet.columns = [
    { header: 'Sprint', key: 'sprint', width: 10 },
    { header: 'Program', key: 'program', width: 30 },
    { header: 'Assignee', key: 'assignee', width: 15 },
    { header: 'Story Points', key: 'storyPoints', width: 14 },
    { header: 'Violations', key: 'violationCount', width: 12 },
    { header: 'Dependencies', key: 'dependencies', width: 30 },
    { header: 'Notes', key: 'explanation', width: 50 }
  ];

  // Style header row
  planSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  planSheet.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF1D6FA4' }
  };

  // Sprint colors (alternating)
  const sprintColors = ['FFEAF4FB', 'FFFEF9E7', 'FFE9F7EF', 'FFFDF2F8', 'FFF0F3F4'];

  plan.sprints.forEach(sprint => {
    const color = sprintColors[(sprint.sprintNumber - 1) % sprintColors.length];
    sprint.items.forEach(item => {
      const row = planSheet.addRow({
        sprint: 'Sprint ' + sprint.sprintNumber,
        program: item.program,
        assignee: item.assignee,
        storyPoints: item.storyPoints,
        violationCount: item.violationCount,
        dependencies: (item.dependencies || []).join(', '),
        explanation: item.explanation || ''
      });
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    });
  });

  planSheet.autoFilter = { from: 'A1', to: 'G1' };

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Export sprint plan to PDF buffer.
 */
function exportPdf(plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(18).font('Helvetica-Bold')
      .text('Clean Core Remediation Sprint Plan', { align: 'center' });
    doc.moveDown(0.5);

    // Summary
    doc.fontSize(12).font('Helvetica-Bold').text('Summary');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Total Programs: ${plan.summary.totalPrograms}`);
    doc.text(`Total Sprints: ${plan.summary.totalSprints}`);
    doc.text(`Estimated Duration: ${plan.summary.estimatedWeeks} weeks`);
    doc.moveDown(1);

    // Sprint details
    plan.sprints.forEach(sprint => {
      // Sprint header
      doc.fontSize(12).font('Helvetica-Bold')
        .fillColor('#1D6FA4')
        .text(`Sprint ${sprint.sprintNumber}`);
      doc.fillColor('#000000');

      // Table header
      const tableTop = doc.y + 4;
      const col = { sprint: 40, program: 90, assignee: 230, sp: 310, viols: 350, notes: 390 };

      doc.fontSize(9).font('Helvetica-Bold');
      doc.rect(40, tableTop, 520, 14).fill('#1D6FA4');
      doc.fillColor('#FFFFFF');
      doc.text('Program', col.program, tableTop + 2, { width: 130 });
      doc.text('Assignee', col.assignee, tableTop + 2, { width: 70 });
      doc.text('SP', col.sp, tableTop + 2, { width: 35 });
      doc.text('Violations', col.viols, tableTop + 2, { width: 40 });
      doc.text('Notes', col.notes, tableTop + 2, { width: 165 });
      doc.fillColor('#000000').font('Helvetica').fontSize(8);

      let rowY = tableTop + 14;
      sprint.items.forEach((item, i) => {
        const bg = i % 2 === 0 ? '#EAF4FB' : '#FFFFFF';
        const rowH = 14;
        doc.rect(40, rowY, 520, rowH).fill(bg);
        doc.fillColor('#000000');
        doc.text(item.program, col.program, rowY + 3, { width: 130 });
        doc.text(item.assignee, col.assignee, rowY + 3, { width: 70 });
        doc.text(String(item.storyPoints), col.sp, rowY + 3, { width: 35 });
        doc.text(String(item.violationCount || 0), col.viols, rowY + 3, { width: 40 });
        const noteText = (item.explanation || '').substring(0, 60);
        doc.text(noteText, col.notes, rowY + 3, { width: 165 });
        rowY += rowH;

        // Page break if needed
        if (rowY > doc.page.height - 80) {
          doc.addPage();
          rowY = 40;
        }
      });

      doc.y = rowY + 8;
      doc.moveDown(0.5);
    });

    doc.end();
  });
}

module.exports = { exportExcel, exportPdf };
