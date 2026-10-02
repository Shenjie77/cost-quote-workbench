import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import type { QuoteLine } from './excel-template-types.ts';
import { customerDocument } from './customer-document.ts';

/** Book2-style customer schedule. Internal cost/GP/CPQ fields never enter this workbook. */
export async function buildCustomerWorkbook(input: QuoteWorkbookInput) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const document = customerDocument(input);
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
  text(7, `Quotation for ${input.project.name}`, true);
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
  text(row++, `1  Mandatory items for ${input.project.name}`, true);
  const group = (title: string, lines: QuoteLine[]) => {
    if (!lines.length) return { cell: null, amount: 0 };
    text(row++, title, true);
    const first = row;
    for (const [index, line] of lines.entries()) {
      const values = [
        String(index + 1),
        line.description,
        line.unit,
        line.unitPrice,
        line.quantity,
      ];
      values.forEach((value, column) => {
        sheet.getCell(row, column + 2).value = value;
      });
      sheet.getCell(row, 7).value = {
        formula: `ROUND(E${row}*F${row},2)`,
        result: line.amount,
      };
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
      sheet.getCell(row, 7).numFmt = money;
      row++;
    }
    const amount = lines.reduce((sum, line) => sum + line.amount, 0);
    sheet.getCell(row, 3).value =
      `${title.replace(/^\d+\.\d+\s+/, '')} subtotal`;
    sheet.getCell(row, 7).value = {
      formula: `ROUND(SUM(G${first}:G${row - 1}),2)`,
      result: amount,
    };
    sheet.getCell(row, 7).numFmt = money;
    sheet.getRow(row).font = { name: 'Arial', size: 10, bold: true };
    const cell = `G${row}`;
    row += 2;
    return { cell, amount };
  };
  const mandatory = document.sections
    .filter((s) => s.inclusion === 'mandatory')
    .map((section, index) =>
      group(`1.${index + 1} ${section.category}`, section.lines),
    );
  const discountRow = row++;
  sheet.getCell(discountRow, 3).value = 'Service discount';
  sheet.getCell(discountRow, 7).value = input.pricing.discount;
  sheet.getCell(discountRow, 7).numFmt = money;
  sheet.getCell(row, 3).value = 'Total price for mandatory items';
  sheet.getCell(row, 7).value = {
    formula: `ROUND(${
      mandatory
        .map((section) => section.cell)
        .filter(Boolean)
        .join('+') || '0'
    }-G${discountRow},2)`,
    result: document.total,
  };
  sheet.getCell(row, 7).numFmt = money;
  sheet.getRow(row).font = { name: 'Arial', size: 11, bold: true };
  row += 2;
  const optionalSections = document.sections.filter(
    (s) => s.inclusion === 'optional',
  );
  if (optionalSections.length) {
    text(row++, '2 Optional items (excluded from mandatory total)', true);
    const optional = optionalSections.map((section, index) =>
      group(`2.${index + 1} ${section.category}`, section.lines),
    );
    sheet.getCell(row, 3).value = 'Total price for optional items';
    sheet.getCell(row, 7).value = {
      formula: `SUM(${optional
        .map((s) => s.cell)
        .filter(Boolean)
        .join(',')})`,
      result: document.optionalAmount,
    };
    sheet.getCell(row, 7).numFmt = money;
    row += 2;
  }
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
      input.template.termsAndConditions,
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
