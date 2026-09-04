/** Client quotation XLSX exporter used by the Pricing & Quote page. */

import type { CostExportSnapshot } from '../cost/contracts.ts';
import type { PricingResult } from './domain.ts';
import type { QuoteAssumption, QuoteTemplate } from './types.ts';

export type QuoteWorkbookInput = {
  project: CostExportSnapshot['project'];
  quoteNumber: string;
  costVersion: string;
  template: QuoteTemplate;
  assumptions: QuoteAssumption[];
  pricing: PricingResult;
};

const CURRENCY_FORMAT = '"S$" #,##0.00;[Red]-"S$" #,##0.00;-';

/** Builds a compact internal/client handoff workbook from one immutable input. */
export const buildQuoteWorkbookBuffer = async (input: QuoteWorkbookInput) => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost & Quote Workbench';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Quotation', {
    views: [{ showGridLines: false }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
  });
  sheet.columns = [{ width: 4 }, { width: 30 }, { width: 28 }, { width: 22 }];

  sheet.mergeCells('B2:D2');
  sheet.getCell('B2').value = input.template.documentTitle;
  sheet.getCell('B2').font = {
    bold: true,
    size: 18,
    color: { argb: 'FF173A52' },
  };
  sheet.mergeCells('B3:D3');
  sheet.getCell('B3').value = input.template.documentTitleZh;
  sheet.getCell('B3').font = { size: 10, color: { argb: 'FF667078' } };

  const metadata = [
    ['Quotation No. / 报价编号', input.quoteNumber],
    ['Client / 客户', input.project.client],
    ['Project / 项目', input.project.name],
    ['Cost Version / 成本版本', input.costVersion],
    ['Currency / 币种', input.project.currency],
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
    ['Service Price / 服务价格', input.pricing.listPrice],
    ['Discount / 折扣', input.pricing.discount],
    ['Quote Before Tax / 未税报价', input.pricing.quoteBeforeTax],
    [
      `GST ${input.pricing.gstPercent.toFixed(2)}% / 税费`,
      input.pricing.gstAmount,
    ],
    ['Total After Tax / 含税总价', input.pricing.quoteAfterTax],
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
  sheet.getCell(row, 2).value =
    'Commercial Terms & Assumptions / 商务条款与报价假设';
  sheet.getCell(row, 2).font = { bold: true, color: { argb: 'FF173A52' } };
  row += 1;
  const terms = [
    `Validity: ${input.template.validityDays} days / 有效期 ${input.template.validityDays} 天`,
    `Payment terms: ${input.template.paymentTerms} / ${input.template.paymentTermsZh}`,
    ...input.assumptions
      .filter((item) => item.included)
      .map((item) => `${item.text} / ${item.textZh}`),
  ];
  terms.forEach((term) => {
    sheet.mergeCells(row, 2, row, 4);
    sheet.getCell(row, 2).value = `• ${term}`;
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(row).height = 30;
    row += 1;
  });

  sheet.eachRow((sheetRow) => {
    sheetRow.eachCell((cell) => {
      cell.font = { name: 'Aptos', size: cell.font?.size || 10, ...cell.font };
      cell.alignment = { vertical: 'middle', ...cell.alignment };
    });
  });
  return workbook.xlsx.writeBuffer();
};

/** Creates a browser download and returns its auditable file metadata. */
export const downloadQuoteWorkbook = async (input: QuoteWorkbookInput) => {
  const buffer = await buildQuoteWorkbookBuffer(input);
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fileName = `${input.quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '_')}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { fileName, sizeBytes: blob.size };
};
