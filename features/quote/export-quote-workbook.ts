/** Client quotation XLSX exporter used by the Pricing & Quote page. */

import type { CostExportSnapshot } from '../cost/contracts.ts';
import type { PricingResult } from './domain.ts';
import type { QuoteAssumption, QuoteTemplate } from './types.ts';
import { matchesClient } from './catalog-domain.ts';
import type { QuoteLine, QuoteLineMode } from './excel-template-types.ts';
import { validateQuoteLines } from './quote-lines.ts';

export type QuoteWorkbookInput = {
  project: CostExportSnapshot['project'];
  quoteNumber: string;
  costVersion: string;
  template: QuoteTemplate;
  assumptions: QuoteAssumption[];
  pricing: PricingResult;
  profitShareMasterDataRevision?: number;
  /** Customer-visible detail lines, already reconciled to the service price. */
  lines?: QuoteLine[];
  lineMode?: QuoteLineMode;
};

const CURRENCY_FORMAT = '"S$" #,##0.00;[Red]-"S$" #,##0.00;-';

/** Builds a compact internal/client handoff workbook from one immutable input. */
export const buildQuoteWorkbookBuffer = async (
  input: QuoteWorkbookInput,
  templateBytes?: Uint8Array | ArrayBuffer,
) => {
  // Freeze output content before loading either the workbook library or local assets.
  input = structuredClone(input);
  if (
    !input.template.active ||
    !matchesClient(input.template.clientPattern, input.project.client)
  ) {
    throw new Error(
      'Quotation template is inactive or does not match the customer.',
    );
  }
  if (input.lines) {
    const errors = validateQuoteLines(input.lines, input.pricing.listPrice);
    if (errors.length) throw new Error(errors.join(' '));
  }
  if (input.template.excel) {
    const { fillQuoteExcelTemplate } = await import('./fill-excel-template.ts');
    const source =
      templateBytes ??
      (await (
        await import('./excel-template-client.ts')
      ).loadQuoteExcelTemplate(input.template.excel.assetId));
    return fillQuoteExcelTemplate(source, input);
  }
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost & Quote Workbench';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Quotation', {
    views: [{ showGridLines: false }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  sheet.columns = [{ width: 4 }, { width: 30 }, { width: 28 }, { width: 22 }];

  sheet.mergeCells('B2:D2');
  sheet.getCell('B2').value = input.template.documentTitle;
  sheet.getCell('B2').font = {
    bold: true,
    size: 18,
    color: { argb: 'FF173A52' },
  };
  // Keep the established cell layout while omitting legacy translation fields.
  const metadata = [
    ['Quotation No.', input.quoteNumber],
    ['Client', input.project.client],
    ['Project', input.project.name],
    ['Cost Version', input.costVersion],
    ['Currency', input.project.currency],
  ];
  metadata.forEach(([label, value], index) => {
    const row = 5 + index;
    sheet.getCell(row, 2).value = label;
    sheet.getCell(row, 2).font = { bold: true, color: { argb: 'FF667078' } };
    sheet.mergeCells(row, 3, row, 4);
    sheet.getCell(row, 3).value = value;
  });

  const pricingStart = 12;
  const pricingRows: Array<[string, number]> = [
    ['Service Price', input.pricing.listPrice],
    ['Discount', input.pricing.discount],
    ['Quote Before Tax', input.pricing.quoteBeforeTax],
    [`GST ${input.pricing.gstPercent.toFixed(2)}%`, input.pricing.gstAmount],
    ['Total After Tax', input.pricing.quoteAfterTax],
  ];
  pricingRows.forEach(([label, amount], index) => {
    const row = pricingStart + index;
    sheet.mergeCells(row, 2, row, 3);
    sheet.getCell(row, 2).value = label;
    sheet.getCell(row, 4).value = amount;
    sheet.getCell(row, 4).numFmt = CURRENCY_FORMAT;
    if (index === pricingRows.length - 1) {
      for (let column = 2; column <= 4; column += 1) {
        sheet.getCell(row, column).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE3F0EF' },
        };
        sheet.getCell(row, column).font = {
          bold: true,
          color: { argb: 'FF173A52' },
        };
      }
    }
  });

  let row = pricingStart + pricingRows.length + 2;
  sheet.mergeCells(row, 2, row, 4);
  sheet.getCell(row, 2).value = 'Commercial Terms & Assumptions';
  sheet.getCell(row, 2).font = { bold: true, color: { argb: 'FF173A52' } };
  row += 1;
  // Use the editable primary content verbatim; legacy translations are never appended.
  const terms = [
    `Validity: ${input.template.validityDays} days`,
    `Payment terms: ${input.template.paymentTerms}`,
    ...(input.template.termsAndConditions
      ? ['Terms & Conditions', input.template.termsAndConditions]
      : []),
    'Quotation Assumptions',
    ...input.assumptions
      .filter((item) => item.included)
      .map((item) => item.text),
  ];
  // Split long paragraphs into bounded rows so Excel's row-height limit cannot
  // hide T&C. Fit width only: long client documents may print on multiple pages.
  terms.forEach((term) => {
    for (const paragraph of term.split('\n')) {
      const characters = Array.from(paragraph);
      for (
        let offset = 0;
        offset < Math.max(1, characters.length);
        offset += 180
      ) {
        const text = characters.slice(offset, offset + 180).join('');
        sheet.mergeCells(row, 2, row, 4);
        sheet.getCell(row, 2).value = text;
        sheet.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' };
        const displayWidth = Array.from(text).reduce(
          (width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1),
          0,
        );
        sheet.getRow(row).height = Math.max(
          18,
          Math.ceil(displayWidth / 64) * 15 + 8,
        );
        row += 1;
      }
    }
  });

  sheet.eachRow((sheetRow) => {
    sheetRow.eachCell((cell) => {
      cell.font = { name: 'Aptos', size: cell.font?.size || 10, ...cell.font };
      cell.alignment = { vertical: 'middle', ...cell.alignment };
    });
  });
  // Retain the established summary cells; detailed modes append an English-only
  // customer schedule in a second sheet, with no internal costs or resource rates.
  if (input.lines?.length && input.lineMode !== 'single') {
    const details = workbook.addWorksheet('Quotation Details', {
      views: [{ showGridLines: false }],
      pageSetup: {
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
      },
    });
    details.columns = [
      { header: 'No.', key: 'number', width: 7 },
      { header: 'Description', key: 'description', width: 60 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Unit', key: 'unit', width: 12 },
      { header: 'Unit Price', key: 'unitPrice', width: 18 },
      { header: 'Amount', key: 'amount', width: 18 },
    ];
    input.lines.forEach((line, index) =>
      details.addRow({ number: index + 1, ...line }),
    );
    details.addRow({
      description: 'Service Price (before discount and tax)',
      amount: input.pricing.listPrice,
    });
    details.getRow(1).font = { bold: true, name: 'Aptos', size: 10 };
    details.eachRow((detailRow, index) => {
      detailRow.alignment = { wrapText: true, vertical: 'top' };
      if (index > 1) {
        detailRow.getCell(5).numFmt = CURRENCY_FORMAT;
        detailRow.getCell(6).numFmt = CURRENCY_FORMAT;
      }
    });
  }
  return workbook.xlsx.writeBuffer();
};

/** Creates a browser download and returns its auditable file metadata. */
export const downloadQuoteWorkbook = async (input: QuoteWorkbookInput) => {
  input = structuredClone(input);
  const buffer = await buildQuoteWorkbookBuffer(input);
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fileName = `${input.quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '_')}.xlsx`;
  const { archiveProjectFile } = await import('../projects/project-files.ts');
  await archiveProjectFile(input.project.id, blob, {
    originalName: fileName,
    category: 'quote',
    versionCode: input.costVersion,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { fileName, sizeBytes: blob.size };
};
