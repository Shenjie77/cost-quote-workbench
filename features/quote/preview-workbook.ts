import type { BodyRow } from './structured-body.ts';
import { roundMoney } from '../cost/domain.ts';
import type { QuoteLine } from './excel-template-types.ts';

/** Only customer-visible preview values; downloading never archives or issues a quotation. */
export type QuotePreviewWorkbookInput = {
  bodyRows?: BodyRow[];
  sectionNames?: { mandatory: string; optional: string };
  title: string;
  projectName: string;
  client: string;
  currency: string;
  quoteNumber: string;
  costVersion: string;
  sections: { name: string; lines: QuoteLine[] }[];
  servicePrice: number;
  maintenanceAmount: number;
  discount: number;
  optionalAmount: number;
  validityDays: number;
  paymentTerms: string;
  terms: string;
  assumptions: string[];
};
export async function buildQuotePreviewWorkbook(
  source: QuotePreviewWorkbookInput,
) {
  const input = structuredClone(source);
  const total =
    input.bodyRows?.at(-1)?.amount ??
    roundMoney(input.servicePrice + input.maintenanceAmount - input.discount);
  if (
    [
      input.servicePrice,
      input.maintenanceAmount,
      input.discount,
      input.optionalAmount,
      total,
    ].some((n) => !Number.isFinite(n) || n < 0 || n > 1e12)
  )
    throw new Error('Resolve pricing errors before exporting the preview.');
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost & Quote Workbench';
  const sheet = workbook.addWorksheet('Preview', {
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
    { width: 6 },
    { width: 60 },
    { width: 11 },
    { width: 13 },
    { width: 18 },
    { width: 20 },
  ];
  let n = 1;
  const paragraph = (text: string, bold = false) => {
    const row = sheet.getRow(n++);
    sheet.mergeCells(row.number, 1, row.number, 6);
    row.getCell(1).value = text;
    row.font = {
      name: 'Arial',
      size: bold ? 11 : 10,
      bold,
      color: { argb: 'FF173A52' },
    };
    row.alignment = { wrapText: true, vertical: 'top' };
    row.height = Math.max(
      22,
      text
        .split('\n')
        .reduce(
          (count, line) => count + Math.max(1, Math.ceil(line.length / 95)),
          0,
        ) *
        15 +
        6,
    );
  };
  paragraph(input.title, true);
  paragraph('PREVIEW — Internal review only; not a final quotation', true);
  paragraph(
    `Quotation: ${input.quoteNumber}    Date: ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore' }).format(new Date())}`,
  );
  paragraph(`Prepared for: ${input.client}`, true);
  paragraph(input.projectName);
  n++;
  const heading = sheet.getRow(n++);
  heading.values = [
    '#',
    'Description',
    'Quantity',
    'Unit',
    `Unit price (${input.currency})`,
    `Amount (${input.currency})`,
  ];
  heading.height = 30;
  heading.eachCell((cell) => {
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
  if (input.bodyRows) {
    for (const entry of input.bodyRows) {
      const row = sheet.getRow(n++);
      if (entry.role === 'blank') {
        row.height = 12;
        continue;
      }
      row.values = [
        entry.number ?? '',
        entry.description,
        entry.line?.quantity ?? '',
        entry.line?.unit ?? '',
        entry.line?.unitPrice ?? '',
        entry.amount ?? '',
      ];
      if (!entry.line) sheet.mergeCells(row.number, 2, row.number, 5);
      row.font = { name: 'Arial', size: 10, bold: entry.role !== 'detail' };
      row.alignment = { wrapText: true, vertical: 'top' };
      row.height = Math.max(
        24,
        Math.ceil(entry.description.length / 52) * 15 + 8,
      );
      if (entry.line) row.getCell(5).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
      if (entry.role === 'total' || entry.role === 'grandTotal')
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8F3F1' },
          };
        });
    }
  } else {
    for (const section of input.sections) {
      paragraph(section.name, true);
      for (const [index, line] of section.lines.entries()) {
        const row = sheet.getRow(n++);
        row.values = [
          index + 1,
          line.description,
          line.quantity,
          line.unit,
          line.unitPrice,
          line.amount,
        ];
        row.height = Math.max(
          28,
          line.description
            .split('\n')
            .reduce(
              (sum, text) => sum + Math.max(1, Math.ceil(text.length / 52)),
              0,
            ) *
            15 +
            8,
        );
        row.eachCell((cell) => {
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { wrapText: true, vertical: 'top' };
          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFDDE4EA' } },
          };
        });
        row.getCell(3).numFmt = '#,##0.####';
        row.getCell(5).numFmt = '#,##0.00';
        row.getCell(6).numFmt = '#,##0.00';
      }
    }
    n++;
    const amounts: [string, number][] = [['Service price', input.servicePrice]];
    if (
      input.maintenanceAmount ||
      input.sections.some((s) =>
        s.lines.some((l) => l.id.startsWith('maintenance:')),
      )
    )
      amounts.push(['Maintenance', input.maintenanceAmount]);
    const mandatoryLabel = 'Grand Total';
    amounts.push(['Discount', input.discount], [mandatoryLabel, total]);
    if (input.optionalAmount > 0)
      amounts.push([
        `${input.sectionNames?.optional || 'Optional'} total (included)`,
        input.optionalAmount,
      ]);
    for (const [label, amount] of amounts) {
      const row = sheet.getRow(n++);
      sheet.mergeCells(row.number, 1, row.number, 5);
      row.getCell(1).value = label;
      row.getCell(6).value = amount;
      row.getCell(6).numFmt = '#,##0.00';
      row.font = {
        name: 'Arial',
        size: 10,
        bold: label === mandatoryLabel,
      };
      row.height = 22;
    }
  }
  n++;
  paragraph(`Validity: ${input.validityDays} days`);
  paragraph(`Payment: ${input.paymentTerms || 'Not set'}`);
  paragraph(`Cost baseline: ${input.costVersion}`);
  if (input.terms) {
    paragraph('Terms & Conditions', true);
    paragraph(input.terms);
  }
  for (const text of input.assumptions) paragraph(`• ${text}`);
  sheet.pageSetup.printArea = `A1:F${n - 1}`;
  sheet.headerFooter.oddFooter = 'PREVIEW · Page &P of &N';
  return workbook.xlsx.writeBuffer();
}
