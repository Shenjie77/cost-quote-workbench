/** Synthetic customer workbooks verify local template export without company documents. */

import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  fillQuoteExcelTemplate,
  inspectQuoteExcelWorkbook,
} from '../features/quote/fill-excel-template.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';

/** Builds a customer-style workbook with a logo, formulas, merged cells and footer. */
async function fixture(configure = () => {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customer Quote');
  sheet.columns = [10, 30, 15, 12, 15, 18, 12, 24].map((width) => ({ width }));
  sheet.getCell('B1').value = 7;
  sheet.getCell('A2').value = 'Quote No.';
  sheet.getCell('B2').value = 'Original number';
  sheet.getCell('A4').value = 'No.';
  sheet.getCell('B4').value = 'Description';
  sheet.getCell('F4').value = 'Amount';
  sheet.mergeCells('B5:C5');
  sheet.getCell('B5').value = 'Original detail';
  sheet.getCell('B5').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getCell('B5').font = { name: 'Arial', size: 11 };
  sheet.getCell('B5').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0F0FF' },
  };
  sheet.getRow(5).height = 38;
  sheet.getCell('F5').numFmt = '#,##0.00';
  sheet.getCell('F5').border = {
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
  };
  sheet.getCell('H5').value = { formula: 'D5*E5+$B$1+Other!C2+SUM(D5:E5)' };
  sheet.getCell('H5').note = 'Row calculation';
  sheet.getCell('E6').value = 'Subtotal';
  sheet.getCell('F6').value = { formula: 'SUM($F$5:F5)' };
  sheet.getCell('H6').value = { formula: 'IF(F6>0,"F6 is text",0)' };
  sheet.getCell('F7').value = 0;
  sheet.getCell('F7').numFmt = '0.00%';
  sheet.mergeCells('A8:F9');
  sheet.getCell('A8').value = 'Original footer';
  sheet.getCell('A8').font = { italic: true };
  sheet.pageSetup = {
    printArea: 'A1:H9',
    printTitlesRow: '1:4',
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  sheet.getRow(9).addPageBreak();
  sheet.getCell('D5').dataValidation = {
    type: 'decimal',
    operator: 'between',
    formulae: [0, 999],
  };
  sheet.addConditionalFormatting({
    ref: 'F5:F5',
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: ['F5>0'],
        style: { font: { bold: true } },
      },
    ],
  });
  const other = workbook.addWorksheet('Other');
  other.getCell('A1').value = {
    formula: "'Customer Quote'!$F$6+'Customer Quote'!F5",
  };
  other.getCell('C2').value = 2;
  other.getCell('C3').value = 3;
  other.getCell('C4').value = 4;
  workbook.definedNames.add("'Customer Quote'!$F$5:$F$5", 'DetailAmounts');
  const image = workbook.addImage({
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGhoAAAAASUVORK5CYII=',
    extension: 'png',
  });
  sheet.addImage(image, {
    tl: { col: 0, row: 0 },
    ext: { width: 16, height: 16 },
  });
  configure(workbook, sheet);
  return workbook.xlsx.writeBuffer();
}

/** Uses exact commercial totals independently of the original template's placeholder cells. */
function input(
  lines = [
    {
      id: 'a',
      description: 'Installation',
      quantity: 1,
      unit: 'lot',
      unitPrice: 1000,
      amount: 1000,
    },
  ],
) {
  return {
    project: {
      id: 'P1',
      name: 'Customer project',
      client: 'Customer',
      currency: 'SGD',
    },
    quoteNumber: 'QT-123',
    costVersion: 'V2',
    template: {
      ...initialQuoteTemplates[0],
      excel: {
        assetId: 'a'.repeat(64),
        fileName: 'customer.xlsx',
        sheetName: 'Customer Quote',
        detailRow: 5,
        columns: {
          number: 'A',
          description: 'B',
          quantity: 'D',
          unitPrice: 'E',
          amount: 'F',
          unit: 'G',
        },
        cells: {
          quoteNumber: 'B2',
          client: 'C2',
          project: 'D2',
          quoteBeforeTax: 'E2',
          gstAmount: 'F2',
          quoteAfterTax: 'G2',
          validityDays: 'H2',
          gstPercent: 'F7',
          paymentTerms: 'A8',
          termsAndConditions: 'H3',
        },
      },
    },
    assumptions: [],
    pricing: calculatePricing(750, {
      targetGrossMargin: 25,
      discount: 0,
      gstPercent: 9,
    }),
    lines,
  };
}

/** Loads output so assertions exercise the serialized XLSX rather than in-memory implementation. */
async function read(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

test('single customer line preserves layout, logo, formatting, metadata and source input', async () => {
  const bytes = await fixture();
  const originalBytes = Buffer.from(bytes);
  const source = input();
  const originalInput = structuredClone(source);
  const workbook = await read(await fillQuoteExcelTemplate(bytes, source));
  const sheet = workbook.getWorksheet('Customer Quote');
  assert.equal(sheet.getCell('B2').value, 'QT-123');
  assert.equal(sheet.getCell('B5').value, 'Installation');
  assert.equal(sheet.getCell('F5').value, 1000);
  assert.equal(sheet.getCell('F6').formula, 'SUM($F$5:F5)');
  assert.equal(sheet.getCell('F7').value, 0.09);
  assert.equal(sheet.getCell('E2').value, 1000);
  assert.equal(sheet.getCell('F2').value, 90);
  assert.equal(sheet.getCell('G2').value, 1090);
  assert.equal(sheet.getCell('A8').value, source.template.paymentTerms);
  assert.equal(sheet.rowCount, 9);
  assert.deepEqual([...sheet.model.merges].sort(), ['A8:F9', 'B5:C5']);
  assert.equal(sheet.getRow(5).height, 38);
  assert.equal(sheet.getCell('B5').font.name, 'Arial');
  assert.equal(sheet.getCell('B5').alignment.wrapText, true);
  assert.equal(sheet.pageSetup.printArea, 'A1:H9');
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.getImages().length, 1);
  assert.deepEqual(
    workbook.worksheets.map((item) => item.name),
    ['Customer Quote', 'Other'],
  );
  assert.deepEqual(source, originalInput);
  assert.deepEqual(Buffer.from(bytes), originalBytes);
});

test('multiple detail rows copy horizontal merges and formulas while shifting footer dependencies', async () => {
  const lines = [
    {
      id: 'a',
      description: 'Survey',
      quantity: 2,
      unit: 'day',
      unitPrice: 100,
      amount: 200,
    },
    {
      id: 'b',
      description: 'Installation',
      quantity: 1,
      unit: 'lot',
      unitPrice: 500,
      amount: 500,
    },
    {
      id: 'c',
      description: 'Testing',
      quantity: 3,
      unit: 'day',
      unitPrice: 100,
      amount: 300,
    },
  ];
  const bytes = await fillQuoteExcelTemplate(await fixture(), input(lines));
  const workbook = await read(bytes);
  const sheet = workbook.getWorksheet('Customer Quote');
  assert.deepEqual(
    [5, 6, 7].map((row) => sheet.getCell(`B${row}`).value),
    lines.map((line) => line.description),
  );
  assert.deepEqual(
    [5, 6, 7].map((row) => sheet.getCell(`F${row}`).value),
    [200, 500, 300],
  );
  assert.deepEqual(
    [5, 6, 7].map((row) => sheet.getCell(`A${row}`).value),
    [1, 2, 3],
  );
  assert.deepEqual(
    [5, 6, 7].map((row) => sheet.getRow(row).height),
    [38, 38, 38],
  );
  assert.equal(sheet.getCell('H7').formula, 'D7*E7+$B$1+Other!C4+SUM(D7:E7)');
  assert.equal(sheet.getCell('F8').formula, 'SUM($F$5:F7)');
  assert.equal(sheet.getCell('H8').formula, 'IF(F8>0,"F6 is text",0)');
  assert.equal(sheet.getCell('H7').note, 'Row calculation');
  assert.equal(sheet.getCell('F9').value, 0.09);
  assert.equal(sheet.getCell('A10').value, input().template.paymentTerms);
  assert.deepEqual([...sheet.model.merges].sort(), [
    'A10:F11',
    'B5:C5',
    'B6:C6',
    'B7:C7',
  ]);
  assert.equal(sheet.getCell('F7').numFmt, '#,##0.00');
  assert.equal(sheet.getCell('F7').border.bottom.style, 'thin');
  assert.equal(sheet.pageSetup.printArea, 'A1:H11');
  assert.equal(sheet.pageSetup.printTitlesRow, '1:4');
  const outputZip = await JSZip.loadAsync(bytes);
  assert.match(
    await outputZip.file('xl/worksheets/sheet1.xml').async('string'),
    /<brk id="11"/,
  );
  assert.equal(sheet.conditionalFormattings[0].ref, 'F5:F7');
  assert.deepEqual(sheet.getCell('D7').dataValidation.formulae, [0, 999]);
  assert.deepEqual(workbook.definedNames.getRanges('DetailAmounts').ranges, [
    "'Customer Quote'!$F$5:$F$7",
  ]);
  assert.equal(
    workbook.getWorksheet('Other').getCell('A1').formula,
    "'Customer Quote'!$F$8+'Customer Quote'!F5",
  );
  assert.equal(sheet.rowCount, 11);
});

test('snapshot is captured before asynchronous load and the source bytes remain reusable', async () => {
  const bytes = await fixture();
  const source = input();
  const pending = fillQuoteExcelTemplate(bytes, source);
  source.lines[0].description = 'Changed later';
  source.template.excel.cells.quoteNumber = 'H2';
  const sheet = (await read(await pending)).getWorksheet('Customer Quote');
  assert.equal(sheet.getCell('B5').value, 'Installation');
  assert.equal(sheet.getCell('B2').value, 'QT-123');
});

test('shared row formulas, single-cell subtotals, sparse footers and image anchors survive expansion', async () => {
  const bytes = await fixture((workbook, sheet) => {
    sheet.getCell('F6').value = { formula: 'SUM(F5)' };
    sheet.getCell('H4').value = {
      formula: 'SUM(D4:E4)',
      shareType: 'shared',
      ref: 'H4:H5',
    };
    sheet.getCell('H5').value = { sharedFormula: 'H4' };
    sheet.getRow(15).height = 27;
    sheet.getCell('B20').value = 'Footer far below';
    sheet.getCell('B20').note = 'Keep this note once';
    sheet.getCell('B20').font = { bold: true };
    sheet.addImage(
      workbook.getWorksheet('Customer Quote').getImages()[0].imageId,
      { tl: { col: 0, row: 19 }, ext: { width: 16, height: 16 } },
    );
  });
  const lines = [
    {
      id: 'a',
      description: 'First',
      quantity: 1,
      unit: 'lot',
      unitPrice: 600,
      amount: 600,
    },
    {
      id: 'b',
      description: 'Second',
      quantity: 1,
      unit: 'lot',
      unitPrice: 400,
      amount: 400,
    },
  ];
  const sheet = (
    await read(await fillQuoteExcelTemplate(bytes, input(lines)))
  ).getWorksheet('Customer Quote');
  assert.equal(sheet.getCell('F7').formula, 'SUM(F5:F6)');
  assert.equal(sheet.getCell('H6').formula, 'SUM(D6:E6)');
  assert.equal(sheet.getRow(16).height, 27);
  assert.equal(sheet.getCell('B20').value, null);
  assert.equal(sheet.getCell('B20').note, undefined);
  assert.equal(sheet.getCell('B21').value, 'Footer far below');
  assert.equal(sheet.getCell('B21').note, 'Keep this note once');
  assert.equal(sheet.getCell('B21').font.bold, true);
  assert.equal(sheet.getImages()[1].range.tl.nativeRow, 20);
});

test('mapped cell geometry, invalid prices, and incompatible row patterns fail with useful errors', async () => {
  const bytes = await fixture();
  for (const [modify, expected] of [
    [
      (source) => {
        source.template.excel.sheetName = 'Missing';
      },
      /sheet/i,
    ],
    [
      (source) => {
        source.template.excel.columns.description = 'C';
      },
      /top-left cell B5/,
    ],
    [
      (source) => {
        source.template.excel.columns.amount = 'B';
      },
      /column/i,
    ],
    [
      (source) => {
        source.template.excel.cells.client = 'B2';
      },
      /cell/i,
    ],
    [
      (source) => {
        source.template.excel.cells.client = 'A5';
      },
      /detail row/i,
    ],
    [
      (source) => {
        source.lines[0].amount = 999;
      },
      /amount/,
    ],
    [
      (source) => {
        source.lines[0].unitPrice = 999;
        source.lines[0].amount = 999;
      },
      /equal the service price/,
    ],
  ]) {
    const source = input();
    modify(source);
    await assert.rejects(() => fillQuoteExcelTemplate(bytes, source), expected);
  }
  const vertical = await fixture((_, sheet) => {
    sheet.unMergeCells('B5:C5');
    sheet.mergeCells('B5:B6');
  });
  await assert.rejects(
    () => fillQuoteExcelTemplate(vertical, input()),
    /vertical merged/,
  );
});

test('upload inventory rejects unreadable archives, unsupported formulas and lossy workbook objects', async () => {
  const bytes = await fixture();
  assert.deepEqual(await inspectQuoteExcelWorkbook(bytes), [
    { name: 'Customer Quote', rowCount: 9, columnCount: 8 },
    { name: 'Other', rowCount: 4, columnCount: 3 },
  ]);
  await assert.rejects(
    () => inspectQuoteExcelWorkbook(new Uint8Array([1, 2, 3])),
    /not a readable/,
  );
  await assert.rejects(
    () => inspectQuoteExcelWorkbook(new Uint8Array(10 * 1024 * 1024 + 1)),
    /10 MiB/,
  );
  const indirect = await fixture((_, sheet) => {
    sheet.getCell('H3').value = { formula: 'INDIRECT("F6")' };
  });
  await assert.rejects(() => inspectQuoteExcelWorkbook(indirect), /INDIRECT/);
  const zip = await JSZip.loadAsync(bytes);
  zip.file('xl/charts/chart1.xml', '<chart/>');
  const chartBytes = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(() => inspectQuoteExcelWorkbook(chartBytes), /charts/);
});

test('customer export cannot silently omit identities, totals, discounts or active terms', async () => {
  const bytes = await fixture();
  const emptyMapping = input();
  emptyMapping.template.excel.cells = {};
  await assert.rejects(
    () => fillQuoteExcelTemplate(bytes, emptyMapping),
    /quoteNumber|Quotation number|Quote number/i,
  );
  for (const [field, configure] of [
    [
      'discount',
      (source) => {
        source.pricing.discount = 5;
      },
    ],
    [
      'termsAndConditions',
      (source) => {
        source.template.termsAndConditions = 'Customer terms';
        delete source.template.excel.cells.termsAndConditions;
      },
    ],
    [
      'assumptions',
      (source) => {
        source.assumptions = [
          { id: 'a', text: 'Customer must provide access', included: true },
        ];
      },
    ],
  ]) {
    const source = input();
    configure(source);
    await assert.rejects(
      () => fillQuoteExcelTemplate(bytes, source),
      new RegExp(field),
    );
  }
});

test('extreme mapped rows and expanding worksheet ranges fail before materializing empty cells', async () => {
  const bytes = await fixture();
  const source = input();
  source.template.excel.cells.quoteNumber = 'B1048576';
  await assert.rejects(() => fillQuoteExcelTemplate(bytes, source), /20,?000/);
  const zip = await JSZip.loadAsync(bytes);
  const original = await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file(
    'xl/worksheets/sheet1.xml',
    original.replace('sqref="D5"', 'sqref="A1:XFD20000"'),
  );
  const oversizedValidation = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(
    () => inspectQuoteExcelWorkbook(oversizedValidation),
    /too many cells/,
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    original.replace('ref="A1:H9"', 'ref="A1:H1048576"'),
  );
  const oversizedRows = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(
    () => inspectQuoteExcelWorkbook(oversizedRows),
    /20,000/,
  );
});
