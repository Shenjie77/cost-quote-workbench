import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { calculatePricing } from '../features/quote/domain.ts';
import { buildQuoteWorkbookBuffer } from '../features/quote/export-quote-workbook.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';
import { emptyMaintenance } from '../features/maintenance/domain.ts';

const input = () => ({
  project: {
    id: 'P1',
    name: 'Network Upgrade',
    client: 'Customer',
    currency: 'SGD',
  },
  quoteNumber: 'QT-001',
  costVersion: 'V1',
  layout: 'customer',
  documentStatus: 'Draft',
  issuedAt: '2026-09-30T00:00:00Z',
  template: {
    ...initialQuoteTemplates[0],
    termsAndConditions: 'Agreed commercial terms',
  },
  assumptions: [
    { id: 'a', text: 'Site access is provided', textZh: '', included: true },
  ],
  pricing: calculatePricing(160, {
    targetGrossMargin: 20,
    discount: 10,
    gstPercent: 0,
  }),
  lines: [
    {
      id: 'service1',
      description: 'Design',
      quantity: 2,
      unit: 'per lot',
      unitPrice: 100,
      amount: 200,
    },
  ],
  maintenance: {
    ...emptyMaintenance(),
    startYear: 2027,
    boq: [
      {
        id: 'm1',
        model: 'Router',
        quantity: 3,
        ct: 20,
        spms: 5,
        durationYears: 2,
        serviceLevel: 'Business hours',
        site: '',
        referenceId: '',
        unitAnnualQuote: 0,
        basis: '',
        source: 'manual',
      },
    ],
  },
});
const load = async (value) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildQuoteWorkbookBuffer(value));
  return book;
};
test('customer schedule includes service, annual maintenance, exact totals and a visible draft marker', async () => {
  const value = input(),
    before = structuredClone(value),
    book = await load(value),
    sheet = book.getWorksheet('Quotation');
  assert.equal(book.worksheets.length, 1);
  const text = JSON.stringify(sheet.getSheetValues());
  for (const label of [
    'DRAFT',
    'QT-001',
    '2026-09-30',
    'Professional Service',
    'Maintenance',
    'Site access is provided',
    'Agreed commercial terms',
  ])
    assert.ok(text.includes(label));
  const rows = [];
  sheet.eachRow((row) => rows.push(row));
  const service = rows.find((row) => row.getCell(3).text === 'Design');
  assert.deepEqual(service.getCell(7).value, {
    formula: `ROUND(E${service.number}*F${service.number},2)`,
    result: 200,
  });
  const maintenance = rows.find((row) =>
    row.getCell(3).text.startsWith('Router'),
  );
  assert.equal(maintenance.getCell(5).value, 75);
  assert.equal(maintenance.getCell(6).value, 2);
  assert.equal(maintenance.getCell(7).result, 150);
  const total = rows.find(
    (row) => row.getCell(3).text === 'Grand Total',
  );
  assert.equal(total.getCell(7).result, 340);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.doesNotMatch(
    text,
    /targetGrossMargin|costWeight|profitShare|Cost with Risk|Optional item/,
  );
  assert.deepEqual(value, before);
});
test('final output omits draft marking and empty maintenance while long terms remain readable', async () => {
  const value = input();
  value.documentStatus = 'Final';
  value.maintenance = emptyMaintenance();
  value.template.termsAndConditions = 'Long condition '.repeat(200);
  const sheet = (await load(value)).worksheets[0],
    text = JSON.stringify(sheet.getSheetValues());
  assert.doesNotMatch(text, /DRAFT|Maintenance Service/);
  let joined = '';
  sheet.eachRow((row) => {
    joined += row.getCell(3).text;
    assert.ok((row.height ?? 15) < 409.5);
  });
  assert.ok(joined.includes(value.template.termsAndConditions));
});
test('invalid maintenance and invalid service pricing cannot produce customer output', async () => {
  const value = input();
  value.maintenance.boq[0].durationYears = -1;
  await assert.rejects(() => load(value), /Duration/);
  value.maintenance = emptyMaintenance();
  value.pricing.valid = false;
  value.pricing.errors = ['Unresolved price'];
  await assert.rejects(() => load(value), /Unresolved price/);
});

test('standard workbook groups custom category titles under Mandatory and Optional', async () => {
  const source = input();
  source.pricing.lineGroups = Object.fromEntries(
    source.lines.map((line, index) => [
      line.id,
      {
        category: index ? 'Training' : 'Implementation',
        inclusion: index ? 'optional' : 'mandatory',
      },
    ]),
  );
  const { customerDocument } =
    await import('../features/quote/customer-document.ts');
  source.pricing.lineGroups['maintenance:' + source.maintenance.boq[0].id] = {
    category: 'Training',
    inclusion: 'optional',
  };
  const document = customerDocument(source);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildQuoteWorkbookBuffer(source));
  const sheet = book.getWorksheet('Quotation'),
    rows = [];
  sheet.eachRow((row) => rows.push(row));
  const values = JSON.stringify(sheet.getSheetValues());
  assert.ok(values.includes('Implementation'));
  assert.ok(values.includes('Training'));
  assert.ok(values.includes('Optional items (excluded from mandatory total)'));
  assert.equal(
    rows
      .find((row) => row.getCell(3).value === 'Grand Total')
      .getCell(7).value.result,
    document.total,
  );
  assert.equal(
    rows
      .find((row) => row.getCell(3).value === 'Total price for Optional items')
      .getCell(7).value.result,
    document.optionalAmount,
  );
});
