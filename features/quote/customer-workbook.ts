import { quoteFieldValues } from './document-fields.ts';
import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import { structuredBodyRows, defaultBodyTitles } from './structured-body.ts';

/** Book2-style customer schedule. Internal cost/GP/CPQ fields never enter this workbook. */
export async function buildCustomerWorkbook(input: QuoteWorkbookInput) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const values = quoteFieldValues({ ...input, layout: 'customer' });
  workbook.creator = 'Cost & Quote Workbench';
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('Quotation', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.columns = [
    { width: 3 },
    { width: 7 },
    { width: 64 },
    { width: 13 },
    { width: 16 },
    { width: 10 },
    { width: 19 },
  ];
  const money = '#,##0.00;[Red]-#,##0.00';
  const text = (row: number, value: string, bold = false) => {
    sheet.mergeCells(row, 3, row, 7);
    sheet.getCell(row, 3).value = value;
    sheet.getCell(row, 3).font = { name: 'Arial', size: 10, bold };
    sheet.getCell(row, 3).alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(row).height = Math.max(
      20,
      Math.ceil(value.length / 110) * 15 + 6,
    );
  };
  text(2, input.template.documentTitle || 'QUOTATION', true);
  if (input.documentStatus === 'Draft')
    text(3, 'DRAFT — For review only; not a final quotation', true);
  text(5, `To: ${input.project.client}`, true);
  text(7, `Quotation for ${values.project}`, true);
  text(8, `Quotation No.: ${input.quoteNumber}`);
  text(
    9,
    `Date: ${(input.issuedAt ?? new Date().toISOString()).slice(0, 10)}    Revision: ${input.costVersion}`,
  );
  const header = sheet.getRow(11);
  [
    '#',
    'Description',
    'UOM',
    'Unit Price',
    'Qty',
    `Total Price (${input.project.currency})`,
  ].forEach((value, index) => {
    const cell = header.getCell(index + 2);
    cell.value = value;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF173A52' },
    };
    cell.font = {
      name: 'Arial',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  header.height = 30;
  let row = 12;
  const plan = structuredBodyRows(
    input,
    {
      categorySpacing: input.template.excel?.body?.categorySpacing,
      sectionNames: input.template.excel?.body?.sectionNames,
      spacing: input.template.excel?.body?.spacing,
      showSubtotals: input.template.excel?.body?.showSubtotals,
      startRow: 12,
      endRow: 12,
      styles: {
        chapter: 12,
        category: 12,
        detail: 12,
        subtotal: 12,
        total: 12,
      },
      numbering: input.template.excel?.body?.numbering ?? 'hierarchical',
      categoryOrder: input.template.excel?.body?.categoryOrder ?? [],
      titles: input.template.excel?.body?.titles ?? defaultBodyTitles,
    },
    values,
  );
  for (const entry of plan) {
    if (entry.role === 'blank') {
      sheet.getRow(row++).height = 12;
      continue;
    }
    if (entry.role === 'chapter' || entry.role === 'category') {
      text(row, `${entry.number} ${entry.description}`, true);
    } else if (entry.line) {
      const line = entry.line;
      [
        entry.number,
        line.description,
        line.unit,
        line.unitPrice,
        line.quantity,
      ].forEach((value, column) => {
        sheet.getCell(row, column + 2).value = value;
      });
      sheet.getCell(row, 3).alignment = { wrapText: true, vertical: 'top' };
      sheet.getRow(row).height = Math.max(
        26,
        Math.ceil(line.description.length / 55) * 15 + 8,
      );
      sheet.getCell(row, 5).numFmt = Number.isInteger(line.unitPrice * 100)
        ? '#,##0.00'
        : '#,##0.0000';
      sheet.getCell(row, 6).numFmt = Number.isInteger(line.quantity)
        ? '#,##0'
        : '#,##0.####';
      sheet.getCell(row, 7).value = {
        formula: `ROUND(E${row}*F${row},2)`,
        result: line.amount,
      };
    } else {
      sheet.getCell(row, 3).value = entry.description;
      sheet.getRow(row).font = {
        name: 'Arial',
        size: entry.role === 'total' || entry.role === 'grandTotal' ? 11 : 10,
        bold: true,
      };
      sheet.getCell(row, 7).value = entry.sum
        ? {
            formula: `ROUND(SUM(${entry.sum.map((index) => `G${12 + index}`).join(',') || '0'})${entry.subtract === undefined ? '' : `-G${12 + entry.subtract}`},2)`,
            result: entry.amount,
          }
        : entry.amount;
    }
    sheet.getCell(row, 7).numFmt = money;
    row++;
  }
  row++;
  const paragraphs = (title: string, values: string[]) => {
    text(row++, title, true);
    for (const value of values)
      for (const paragraph of value.split('\n')) {
        const chars = Array.from(paragraph);
        for (let offset = 0; offset < Math.max(1, chars.length); offset += 180)
          text(row++, chars.slice(offset, offset + 180).join(''));
      }
    row++;
  };
  paragraphs(
    'Assumptions',
    input.assumptions.filter((a) => a.included).map((a) => a.text),
  );
  paragraphs(
    'Terms & Conditions',
    [
      `Validity: ${input.template.validityDays} days`,
      `Payment terms: ${input.template.paymentTerms}`,
      String(values.termsAndConditions ?? ''),
    ].filter(Boolean),
  );
  sheet.eachRow((r) =>
    r.eachCell((c) => {
      c.font = { name: 'Arial', size: 10, ...c.font };
      c.alignment = { vertical: 'top', ...c.alignment };
    }),
  );
  sheet.pageSetup.printArea = `B2:G${row - 1}`;
  sheet.headerFooter.oddFooter = 'Page &P of &N';
  return workbook.xlsx.writeBuffer();
}
