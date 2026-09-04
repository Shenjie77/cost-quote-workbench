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
