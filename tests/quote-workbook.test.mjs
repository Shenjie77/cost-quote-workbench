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
  assert.equal(sheet.getCell('D16').value, 1362.5);
  assert.match(sheet.getCell('B20').text, /Validity/);
});
