import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import {
  allocateQuotationDiscount,
  discountGroupKey,
} from '../features/quote/discount-allocation.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { customerDocument } from '../features/quote/customer-document.ts';
import {
  structuredBodyRows,
  defaultBodyTitles,
} from '../features/quote/structured-body.ts';
import { buildCustomerWorkbook } from '../features/quote/customer-workbook.ts';
import { buildQuotePreviewWorkbook } from '../features/quote/preview-workbook.ts';
import { quoteFieldValues } from '../features/quote/document-fields.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';

const line = (id, amount, category = 'Service', inclusion = 'mandatory') => ({
  id,
  amount,
  category,
  inclusion,
  description: id,
  quantity: 1,
  unit: 'lot',
  unitPrice: amount,
});
const lines = [
  line('a', 600),
  line('b', 300, 'Maintenance'),
  line('c', 100, 'Service', 'optional'),
];
const layout = {
  startRow: 1,
  endRow: 1,
  styles: { chapter: 1, category: 1, detail: 1, subtotal: 1, total: 1 },
  numbering: 'hierarchical',
  categoryOrder: [],
  titles: defaultBodyTitles,
};
const input = (mode) => ({
  project: { id: 'p', name: 'Test', client: 'Client', currency: 'SGD' },
  quoteNumber: 'q',
  costVersion: 'v',
  template: initialQuoteTemplates[0],
  assumptions: [],
  lines,
  pricing: calculatePricing(500, {
    targetGrossMargin: 50,
    discount: 100,
    gstPercent: 0,
    discountAllocation: { mode },
  }),
});

for (const mode of ['total', 'section', 'category'])
  test(`${mode}: proportional discount conserves cents and includes Optional in Grand Total`, async () => {
    const data = input(mode),
      before = structuredClone(data),
      doc = customerDocument(data);
    assert.equal(
      doc.allocation.rows.reduce((s, r) => s + r.discount, 0),
      100,
    );
    assert.equal(doc.total, 900);
    assert.equal(doc.optionalAmount, mode === 'total' ? 100 : 90);
    assert.equal(
      doc.mandatoryTotal + doc.optionalAmount - (mode === 'total' ? 100 : 0),
      900,
    );
    const rows = structuredBodyRows(data, layout, { project: 'Test' });
    assert.equal(rows.at(-1).description, 'Grand Total');
    assert.equal(rows.at(-1).amount, doc.total);
    // Independently evaluate every generated SUM/subtract row to detect double deduction.
    rows.forEach((row) => {
      if (row.sum)
        assert.equal(
          Math.round(
            (row.sum.reduce((s, i) => s + rows[i].amount, 0) -
              (row.subtract === undefined ? 0 : rows[row.subtract].amount)) *
              100,
          ) / 100,
          row.amount,
        );
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildCustomerWorkbook(data));
    const finalRow = book.worksheets[0].getRow(12 + rows.length - 1);
    assert.equal(finalRow.getCell(3).text, 'Grand Total');
    assert.equal(finalRow.getCell(7).result, doc.total);
    assert.deepEqual(data, before);
  });
test('manual shares pin only edited groups and automatically distribute the remainder', () => {
  const result = allocateQuotationDiscount(lines, 100, {
    mode: 'category',
    shares: [{ key: discountGroupKey('mandatory', 'Service'), percentage: 50 }],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.rows.map((r) => r.discount),
    [50, 37.5, 12.5],
  );
  assert.equal(result.mandatoryNet, 812.5);
  assert.equal(result.optionalNet, 87.5);
  const section = allocateQuotationDiscount(lines, 100, {
    mode: 'section',
    shares: [{ key: discountGroupKey('optional'), percentage: 0 }],
  });
  assert.deepEqual(
    section.rows.map((r) => r.discount),
    [100, 0],
  );
});
test('rounding distributes exactly one cent without changing the configured amount', () => {
  const result = allocateQuotationDiscount(
    [line('a', 1, 'A'), line('b', 1, 'B'), line('c', 1, 'C')],
    0.01,
    { mode: 'category' },
  );
  assert.deepEqual(
    result.rows.map((r) => r.discount),
    [0.01, 0, 0],
  );
  assert.equal(result.mandatoryNet, 2.99);
});
test('invalid totals, duplicate/stale keys, and over-discounted groups block output', () => {
  for (const shares of [
    [{ key: discountGroupKey('mandatory'), percentage: 101 }],
    [{ key: discountGroupKey('mandatory'), percentage: -1 }],
    [
      { key: discountGroupKey('mandatory'), percentage: 30 },
      { key: discountGroupKey('mandatory'), percentage: 30 },
    ],
    [{ key: 'removed', percentage: 10 }],
    [
      { key: discountGroupKey('mandatory'), percentage: 20 },
      { key: discountGroupKey('optional'), percentage: 20 },
    ],
  ]) {
    const data = input('section');
    data.pricing.discountAllocation.shares = shares;
    assert.throws(
      () => customerDocument(data),
      /shares|allocation|groups|percentages/i,
    );
  }
  const data = input('category');
  data.pricing.discount = 200;
  data.pricing.discountAllocation.shares = [
    { key: discountGroupKey('optional', 'Service'), percentage: 100 },
  ];
  assert.throws(() => customerDocument(data), /exceeds/);
});
test('hidden category subtotals still show a net category amount when discounted; custom titles and spacing preserve final arithmetic', () => {
  const data = input('category');
  const body = {
    ...layout,
    showSubtotals: false,
    sectionNames: { mandatory: 'Base', optional: 'Extras' },
    spacing: { category: 2, mandatory: 1 },
    titles: {
      ...defaultBodyTitles,
      discount: '{section} / {category} Discount',
      grandTotal: '{project} Final Total',
    },
  };
  data.pricing.sectionNames = { mandatory: 'Base', optional: 'Extras' };
  const rows = structuredBodyRows(data, body, { project: 'Test' });
  assert.equal(rows.at(-1).description, 'Test Final Total');
  assert.equal(rows.at(-1).amount, 900);
  assert.equal(rows.filter((r) => r.subtract !== undefined).length, 3);
  assert.ok(rows.some((r) => r.description === 'Base / Service Discount'));
});
test('Optional-only zero-price schedules retain the section reference in Grand Total', async () => {
  const data = input('total');
  data.lines = [line('only', 0, 'Service', 'optional')];
  data.pricing = calculatePricing(0, {
    targetGrossMargin: 0,
    discount: 0,
    gstPercent: 0,
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildCustomerWorkbook(data));
  let grand;
  book.worksheets[0].eachRow((r) => {
    if (r.getCell(3).text === 'Grand Total') grand = r;
  });
  assert.equal(grand.getCell(7).formula, 'ROUND(SUM(G16),2)');
  assert.equal(grand.getCell(7).result, 0);
});
test('pricing shares and immutable allocation snapshots satisfy durable schemas', () => {
  const schema = JSON.parse(
    readFileSync(
      new URL('../schemas/workspace-state.schema.json', import.meta.url),
    ),
  );
  const ajv = new Ajv({ strict: false });
  const validate = ajv.compile({
    $defs: schema.$defs,
    type: 'object',
    properties: { pricing: schema.properties.pricing },
  });
  const pricing = {
    targetGrossMargin: 50,
    discount: 100,
    gstPercent: 0,
    discountAllocation: {
      mode: 'section',
      shares: [{ key: discountGroupKey('mandatory'), percentage: 80 }],
    },
  };
  assert.equal(validate({ pricing }), true, JSON.stringify(validate.errors));
  const snapshot = ajv.compile({
    ...schema.$defs.quoteHistoryRecord.properties.discountAllocationSnapshot,
    $defs: schema.$defs,
  });
  const data = input('section');
  data.pricing = calculatePricing(500, pricing);
  assert.equal(
    snapshot(JSON.parse(JSON.stringify(customerDocument(data).allocation))),
    true,
    JSON.stringify(snapshot.errors),
  );
});
test('preview XLSX uses the same allocated schedule and net totals as customer output', async () => {
  const data = input('category');
  const rows = structuredBodyRows(data, layout, { project: 'Test' });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    await buildQuotePreviewWorkbook({
      title: 'Quote',
      projectName: 'Test',
      client: 'Client',
      currency: 'SGD',
      quoteNumber: 'q',
      costVersion: 'v',
      sections: [],
      bodyRows: rows,
      servicePrice: 1000,
      maintenanceAmount: 0,
      discount: 100,
      optionalAmount: 100,
      validityDays: 30,
      paymentTerms: '',
      terms: '',
      assumptions: [],
    }),
  );
  const amounts = [];
  book.worksheets[0].eachRow((r) => {
    if (r.getCell(2).text === 'Grand Total') amounts.push(r.getCell(6).value);
  });
  assert.deepEqual(amounts, [900]);
  assert.equal(quoteFieldValues(data).optionalPrice, 90);
});

test('same categories in distinct quote sections receive independent default and manual discount shares', () => {
  const custom = [
    { ...line('a', 600), section: 'Build' },
    { ...line('b', 300), section: 'Support' },
    { ...line('c', 100, 'Service', 'optional'), section: 'Extras' },
  ];
  for (const mode of ['section', 'category']) {
    const key = discountGroupKey(
      'mandatory',
      mode === 'category' ? 'Service' : undefined,
      'Support',
    );
    const result = allocateQuotationDiscount(custom, 100, {
      mode,
      shares: [{ key, percentage: 20 }],
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows.find((r) => r.section === 'Support').discount, 20);
    assert.equal(
      result.rows.reduce((s, r) => s + r.discount, 0),
      100,
    );
  }
});

test('legacy names and pinned shares migrate once into pricing and survive template changes without altering history', async () => {
  const { migrateQuoteSections } =
    await import('../features/quote/quote-section-settings.ts');
  const template = {
    ...initialQuoteTemplates[0],
    excel: {
      body: { sectionNames: { mandatory: 'Base', optional: 'Extras' } },
    },
  };
  const pricing = {
    targetGrossMargin: 50,
    discount: 10,
    gstPercent: 0,
    discountAllocation: {
      mode: 'section',
      shares: [{ key: discountGroupKey('mandatory'), percentage: 90 }],
    },
  };
  const before = structuredClone({ pricing, template });
  const migrated = migrateQuoteSections(pricing, template);
  assert.equal(migrated.sectionNames.mandatory, 'Base');
  assert.equal(
    migrated.discountAllocation.shares[0].key,
    discountGroupKey('mandatory', undefined, 'Base'),
  );
  const differentTemplate = {
    ...template,
    excel: {
      body: { sectionNames: { mandatory: 'Changed', optional: 'Changed too' } },
    },
  };
  assert.deepEqual(migrateQuoteSections(migrated, differentTemplate), migrated);
  assert.deepEqual({ pricing, template }, before);
  const schema = JSON.parse(
    readFileSync(
      new URL('../schemas/workspace-state.schema.json', import.meta.url),
    ),
  );
  const validate = new Ajv({ strict: false }).compile({
    ...schema.properties.pricing,
    $defs: schema.$defs,
  });
  assert.equal(validate(migrated), true, JSON.stringify(validate.errors));
});
