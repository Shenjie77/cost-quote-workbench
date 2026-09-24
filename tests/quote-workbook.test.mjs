/** Verifies the client quotation workbook carries governed template content. */

import assert from 'node:assert/strict';
import test from 'node:test';

import ExcelJS from 'exceljs';

import { calculatePricing } from '../features/quote/domain.ts';
import { buildQuoteWorkbookBuffer } from '../features/quote/export-quote-workbook.ts';
import {
  initialQuoteAssumptions,
  initialQuoteTemplates,
} from '../features/quote/types.ts';

test('client T&C and long multilingual assumptions survive XLSX serialization without fixed-page shrink', async () => {
  const tc = 'Client A only\n' + '中文条款'.repeat(600);
  const input = {
    project: { id: 'P1', name: 'Test', client: 'Client A', currency: 'SGD' },
    quoteNumber: 'QT-TEST',
    costVersion: 'V1',
    template: {
      ...initialQuoteTemplates[0],
      clientPattern: 'Client A',
      termsAndConditions: tc,
    },
    assumptions: [
      { id: 'a1', text: 'Included clause', textZh: '', included: true },
      { id: 'a2', text: 'Excluded clause', textZh: '', included: false },
    ],
    pricing: calculatePricing(100, {
      targetGrossMargin: 20,
      discount: 0,
      gstPercent: 0,
    }),
  };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildQuoteWorkbookBuffer(input));
  const sheet = workbook.worksheets[0];
  const text = [];
  sheet.eachRow((row) => {
    text.push(row.getCell(2).text);
    assert.ok((row.height ?? 15) < 409.5);
  });
  assert.match(text.join(''), /Client A only/);
  assert.ok(text.join('').includes('中文条款'.repeat(600)));
  assert.ok(text.includes('Included clause'));
  assert.equal(text.includes('Excluded clause'), false);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  await assert.rejects(
    () =>
      buildQuoteWorkbookBuffer({
        ...input,
        project: { ...input.project, client: 'Client B' },
      }),
    /does not match/,
  );
  await assert.rejects(
    () =>
      buildQuoteWorkbookBuffer({
        ...input,
        template: { ...input.template, active: false },
      }),
    /inactive/,
  );
});

test('quotation workbook contains pricing, template terms, and assumptions', async () => {
  const bytes = await buildQuoteWorkbookBuffer({
    project: {
      id: 'PRJ-001',
      name: 'Test Service',
      client: 'Test Client',
      currency: 'SGD',
    },
    quoteNumber: 'QT-001-V1',
    costVersion: 'V1',
    template: initialQuoteTemplates[0],
    assumptions: initialQuoteAssumptions,
    pricing: calculatePricing(1000, {
      targetGrossMargin: 20,
      discount: 0,
      gstPercent: 9,
    }),
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ['Quotation'],
  );
  const sheet = workbook.getWorksheet('Quotation');
  assert.equal(sheet.getCell('C5').value, 'QT-001-V1');
  assert.equal(sheet.getCell('C6').value, 'Test Client');
  assert.equal(sheet.getCell('D14').value, 1250);
  assert.equal(sheet.getCell('B14').value, 'Quote Total');
  assert.equal(sheet.getCell('D16').value, null);
  assert.match(sheet.getCell('B18').text, /Validity/);
  assert.doesNotMatch(
    JSON.stringify(sheet.getSheetValues()),
    /GST|Before Tax|After Tax|gstAmount|targetGrossMargin|allocationWeight|priceFixed/,
  );
  assert.doesNotMatch(
    JSON.stringify(sheet.getSheetValues()),
    /\p{Script=Han}/u,
  );
});

test('new quotation output ignores legacy translations and retains long English primary clauses', async () => {
  const terms =
    'Every delivery milestone requires the agreed customer acceptance. '.repeat(
      240,
    );
  const input = {
    project: {
      id: 'P-EN',
      name: 'Service project',
      client: 'Customer',
      currency: 'SGD',
    },
    quoteNumber: 'Q-EN',
    costVersion: 'V1',
    template: {
      ...initialQuoteTemplates[0],
      nameZh: '历史模板名',
      documentTitleZh: '历史中文标题',
      paymentTermsZh: '历史中文付款条款',
      termsAndConditions: terms,
    },
    assumptions: [
      {
        id: 'legacy-clause',
        text: 'Delivery scope retained.',
        textZh: '历史中文假设',
        included: true,
      },
    ],
    pricing: calculatePricing(100, {
      targetGrossMargin: 20,
      discount: 0,
      gstPercent: 9,
    }),
  };
  const before = structuredClone(input);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildQuoteWorkbookBuffer(input));
  const sheet = workbook.getWorksheet('Quotation');
  const paragraphs = [];
  sheet.eachRow((row) => {
    paragraphs.push(row.getCell(2).text);
    assert.ok((row.height ?? 15) < 409.5);
  });
  const text = JSON.stringify(sheet.getSheetValues());
  assert.doesNotMatch(
    text,
    /\p{Script=Han}|documentTitleZh|paymentTermsZh|textZh/u,
  );
  assert.ok(paragraphs.join('').includes(terms));
  assert.match(text, /Delivery scope retained/);
  assert.deepEqual(input, before, 'export must preserve saved legacy fields');
});

/** New pricing controls remain internal even when callers pass richer line objects. */
test('customer workbooks expose one quote total and never export line costs, weights, GP or legacy tax', async () => {
  const input = {
    project: {
      id: 'PUBLIC-QUOTE',
      name: 'Delivery',
      client: 'Customer',
      currency: 'SGD',
    },
    quoteNumber: 'PUBLIC-001',
    costVersion: 'V1',
    template: initialQuoteTemplates[0],
    assumptions: [
      {
        id: 'assumption-tax',
        text: 'SYSTEM TAX CLAUSE MUST NOT APPEAR',
        textZh: '',
        included: true,
      },
      {
        id: 'custom',
        text: 'Customer statement remains.',
        textZh: '',
        included: true,
      },
    ],
    pricing: calculatePricing(100, {
      targetGrossMargin: 50,
      discount: 10,
      gstPercent: 9,
    }),
    lineMode: 'manual',
    lines: [
      {
        id: 'service',
        description: 'Delivery service',
        quantity: 1,
        unit: 'lot',
        unitPrice: 200,
        amount: 200,
        cost: 100,
        allocationWeight: 100,
        targetGrossMargin: 50,
        priceFixed: false,
      },
    ],
  };
  const before = structuredClone(input);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildQuoteWorkbookBuffer(input));
  const quote = book.getWorksheet('Quotation');
  assert.equal(quote.getCell('B14').value, 'Quote Total');
  assert.equal(quote.getCell('D14').value, 190);
  assert.match(
    JSON.stringify(quote.getSheetValues()),
    /Customer statement remains/,
  );
  const details = book.getWorksheet('Quotation Details');
  assert.deepEqual(details.getRow(1).values.slice(1), [
    'No.',
    'Description',
    'Quantity',
    'Unit',
    'Unit Price',
    'Amount',
  ]);
  assert.equal(details.getCell('F2').value, 200);
  assert.doesNotMatch(
    JSON.stringify(book.worksheets.map((sheet) => sheet.getSheetValues())),
    /GST|Tax|gstAmount|allocationWeight|targetGrossMargin|priceFixed|Internal Cost/,
  );
  assert.deepEqual(input, before);
});
