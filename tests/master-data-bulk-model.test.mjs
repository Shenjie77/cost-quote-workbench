/** Bulk import regressions use synthetic rows and the same validators as saved catalogs. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bulkImportContextKey,
  bulkTabSpec,
  previewBulkImport,
} from '../features/master-data/bulk-import-model.ts';
import { GLOBAL_MASTER_DATA_TABS } from '../features/master-data/global-types.ts';
import { validateGlobalMasterDataRows } from '../server/global-master-data.mjs';
import { requiredQuoteExcelFields } from '../features/quote/excel-template-mapping.ts';

/** Minimal meaningful input for each independent catalog. */
const samples = {
  resources: {
    code: 'RE-001',
    name: 'Engineer',
    mandayRate: 500,
    effectiveFrom: '2026-01-01',
  },
  subcontract: { code: 'SC-001', item: 'Installation', bu: 'Delivery' },
  supplemental: {
    code: 'SUP-001',
    name: 'Transport',
    statementCode: '2.2.1.2',
    defaultAmount: 100,
  },
  maintenance: {
    client: 'Customer',
    service: 'Support',
    productModel: 'Model A',
    serviceLevel: '8x5',
    site: 'Singapore',
    coverageMonths: 12,
    quantity: 2,
    costAmount: 100,
    quotedAmount: 150,
    quoteDate: '2026-02-28',
    source: 'QT-001',
  },
  assumptions: { name: 'Scope', text: 'Changes need approval.' },
  'quote-templates': {
    name: 'Customer template',
    documentTitle: 'QUOTATION',
    paymentTerms: '30 days',
  },
  'profit-share': { bu: 'Delivery', ratePercent: 10 },
  workflow: { no: 1, name: 'Review', owner: 'Engineering' },
  status: { code: 'ACTIVE', name: 'Active' },
  'cpq-catalog': {
    code: 'CPQ-001',
    scope: 'Consulting',
    unit: 'day',
    unitCost: 100,
  },
};

/** Checks previews before using their rows as a baseline for update scenarios. */
function imported(tab, values = samples[tab], current = [], related = {}) {
  const preview = previewBulkImport(
    tab,
    [{ row: 2, values }],
    current,
    related,
  );
  assert.deepEqual(preview.issues, [], JSON.stringify(preview.issues));
  return preview;
}

test('all ten tab templates create rows accepted by the persisted catalog validators', () => {
  for (const tab of GLOBAL_MASTER_DATA_TABS) {
    const spec = bulkTabSpec(tab);
    assert.equal(spec.tab, tab);
    assert.equal(
      new Set(spec.columns.map((field) => field.key)).size,
      spec.columns.length,
    );
    assert.ok(spec.columns.every((field) => field.label && field.description));
    const result = imported(tab);
    assert.equal(result.added, 1, tab);
    assert.equal(result.changes[0].row, 2);
    validateGlobalMasterDataRows(tab, result.items);
    const fields = new Set(spec.columns.map((field) => field.key));
    const exported = Object.fromEntries(
      Object.entries(result.items[0]).filter(([key]) => fields.has(key)),
    );
    const identical = imported(tab, exported, result.items);
    assert.equal(identical.unchanged, 1, tab);
  }
});

test('specifications are detached and quote templates do not expose obsolete translation or workbook asset columns', () => {
  const first = bulkTabSpec('quote-templates');
  assert.ok(
    first.columns.every(
      (field) => !field.key.endsWith('Zh') && field.key !== 'excel',
    ),
  );
  first.columns[0].key = 'tampered';
  assert.equal(bulkTabSpec('quote-templates').columns[0].key, 'id');
});

test('coded catalogs preserve stable IDs and legacy metadata while retaining unmentioned records', () => {
  const a = imported('subcontract').items[0];
  a.supplier = 'Legacy supplier';
  a.pricingBasis = 'Old reference';
  a.unit = 'site';
  const b = imported('subcontract', { ...samples.subcontract, code: 'SC-002' })
    .items[0];
  const current = [a, b];
  const baseline = structuredClone(current);
  const result = imported(
    'subcontract',
    { code: 'SC-001', unitPrice: '1,234.50', unit: '', active: 'FALSE' },
    current,
  );
  assert.equal(result.updated, 1);
  assert.equal(result.items[0].id, a.id);
  assert.equal(result.items[0].unitPrice, 1234.5);
  assert.equal(result.items[0].unit, 'site');
  assert.equal(result.items[0].active, false);
  assert.equal(result.items[0].supplier, a.supplier);
  assert.equal(result.items[0].pricingBasis, a.pricingBasis);
  assert.deepEqual(result.items[1], b);
  assert.deepEqual(current, baseline);
});

test('ID and code collisions fail atomically instead of relabeling another catalog row', () => {
  const a = imported('resources').items[0];
  const b = imported('resources', { ...samples.resources, code: 'RE-002' })
    .items[0];
  const current = [a, b];
  for (const values of [
    { id: a.id, code: b.code },
    { id: 'wrong-id', code: a.code },
  ]) {
    const result = previewBulkImport(
      'resources',
      [{ row: 8, values }],
      current,
    );
    assert.deepEqual(result.items, current);
    assert.equal(result.updated, 0);
    assert.ok(result.issues.some((issue) => issue.row === 8));
  }
});

test('duplicate rows and one bad row roll back the whole preview with original Excel locations', () => {
  const current = imported('subcontract').items;
  const result = previewBulkImport(
    'subcontract',
    [
      { row: 4, values: { code: 'SC-001', unitPrice: 50 } },
      { row: 9, values: { code: 'SC-001', unitPrice: 75 } },
      {
        row: 11,
        values: {
          code: 'SC-NEW',
          item: 'Work',
          bu: 'Delivery',
          unitPrice: '12,34',
        },
      },
    ],
    current,
  );
  assert.deepEqual(result.items, current);
  assert.equal(result.added + result.updated + result.unchanged, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.row === 9 && /Duplicate/.test(issue.message),
    ),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.row === 11 && issue.column === 'unitPrice',
    ),
  );
});

test('BU matching uses normalized names while company codes remain optional duplicate text metadata', () => {
  const current = imported('profit-share', {
    bu: 'Shared Services',
    ratePercent: 5,
    buCode: '001',
  }).items;
  const result = imported(
    'profit-share',
    { bu: ' shared   services ', ratePercent: 0, buCode: '002' },
    current,
  );
  assert.equal(result.updated, 1);
  assert.equal(result.items[0].id, current[0].id);
  assert.equal(result.items[0].ratePercent, 0);
  assert.equal(result.items[0].buCode, '002');
  const another = imported(
    'profit-share',
    { bu: 'Other BU', ratePercent: 20, buCode: '002' },
    result.items,
  );
  assert.equal(another.added, 1);
  assert.equal(another.items.length, 2);
});

test('quotes retain local Excel mappings and legacy text while validating saved assumption references', () => {
  const current = imported('quote-templates').items;
  current[0].nameZh = 'Legacy translation';
  current[0].excel = {
    assetId: 'a'.repeat(64),
    fileName: 'Customer.xlsx',
    sheetName: 'Quote',
    detailRow: 20,
    columns: { description: 'A', amount: 'F' },
    cells: Object.fromEntries(
      requiredQuoteExcelFields.map((key, index) => [key, `B${index + 1}`]),
    ),
  };
  const assumptions = [{ id: 'scope' }, { id: 'currency' }];
  const result = imported(
    'quote-templates',
    {
      id: current[0].id,
      paymentTerms: '45 days',
      defaultAssumptionIds: 'scope;currency',
    },
    current,
    { assumptions },
  );
  assert.equal(result.items[0].nameZh, current[0].nameZh);
  assert.deepEqual(result.items[0].excel, current[0].excel);
  assert.deepEqual(result.items[0].defaultAssumptionIds, ['scope', 'currency']);
  const invalid = previewBulkImport(
    'quote-templates',
    [
      {
        row: 7,
        values: { id: current[0].id, defaultAssumptionIds: 'missing' },
      },
    ],
    current,
    { assumptions },
  );
  assert.ok(
    invalid.issues.some(
      (issue) => issue.row === 7 && issue.column === 'defaultAssumptionIds',
    ),
  );
  const cleared = imported(
    'quote-templates',
    { id: current[0].id, defaultAssumptionIds: '[]' },
    result.items,
    { assumptions },
  );
  assert.deepEqual(cleared.items[0].defaultAssumptionIds, []);
});

test('saved quote template mappings require one total and accept either legacy total address without tax cells', () => {
  const template = imported('quote-templates').items[0];
  const cells = Object.fromEntries(
    requiredQuoteExcelFields.map((key, index) => [key, `B${index + 1}`]),
  );
  const excel = {
    assetId: 'b'.repeat(64),
    fileName: 'Customer.xlsx',
    sheetName: 'Quote',
    detailRow: 20,
    columns: { description: 'A', amount: 'F' },
    cells,
  };
  const { quoteBeforeTax, ...commonCells } = cells;
  for (const mappedCells of [
    cells,
    { ...commonCells, quoteAfterTax: quoteBeforeTax },
    { ...cells, quoteAfterTax: 'B7', gstPercent: 'B8', gstAmount: 'B9' },
  ]) {
    const saved = [{ ...template, excel: { ...excel, cells: mappedCells } }];
    assert.doesNotThrow(() =>
      validateGlobalMasterDataRows('quote-templates', saved),
    );
    const updated = imported(
      'quote-templates',
      { id: template.id, paymentTerms: '45 days' },
      saved,
    );
    assert.deepEqual(updated.items[0].excel.cells, mappedCells);
  }
  assert.throws(
    () =>
      validateGlobalMasterDataRows('quote-templates', [
        { ...template, excel: { ...excel, cells: commonCells } },
      ]),
    /quoteBeforeTax|quoteAfterTax/,
  );
});

test('strict scalar parsing rejects invalid calendars, malformed decimals, non-finite values and false-like typos', () => {
  for (const [field, value] of [
    ['quoteDate', '2026-02-30'],
    ['quoteDate', 46000],
    ['coverageMonths', 1.5],
    ['costAmount', '1e3'],
    ['quantity', Infinity],
    ['quotedAmount', true],
  ]) {
    const result = previewBulkImport(
      'maintenance',
      [{ row: 12, values: { ...samples.maintenance, [field]: value } }],
      [],
    );
    assert.ok(
      result.issues.some((issue) => issue.row === 12 && issue.column === field),
      `${field}: ${value}`,
    );
    assert.deepEqual(result.items, []);
  }
  const bool = previewBulkImport(
    'profit-share',
    [{ row: 3, values: { ...samples['profit-share'], active: 'FALSEE' } }],
    [],
  );
  assert.ok(bool.issues.some((issue) => issue.column === 'active'));
  const rate = previewBulkImport(
    'profit-share',
    [{ row: 3, values: { ...samples['profit-share'], ratePercent: 101 } }],
    [],
  );
  assert.ok(rate.issues.some((issue) => issue.column === 'ratePercent'));
});

test('resource classification and CPQ quantity constraints reuse domain rules without silently correcting input', () => {
  const hq = previewBulkImport(
    'resources',
    [
      {
        row: 6,
        values: { ...samples.resources, pool: 'LOCAL', hqTravel: true },
      },
    ],
    [],
  );
  assert.ok(hq.issues.some((issue) => issue.column === 'hqTravel'));
  const subcontract = imported('resources', {
    ...samples.resources,
    category: 'subcontract',
  }).items[0];
  assert.equal(subcontract.pool, null);
  assert.equal(subcontract.level, null);
  assert.equal(subcontract.hqTravel, false);
  for (const change of [
    { minQty: 10, maxQty: 1 },
    { unitCost: 1.001 },
    { kind: 'equipment', adjustable: true },
    { step: 0 },
  ]) {
    const result = previewBulkImport(
      'cpq-catalog',
      [{ row: 6, values: { ...samples['cpq-catalog'], ...change } }],
      [],
    );
    assert.ok(result.issues.length, JSON.stringify(change));
    assert.ok(result.issues.every((issue) => issue.row === 6));
  }
});

test('workflow rows contain definitions only, default to folders, and merge in numeric order', () => {
  const current = imported('workflow', {
    code: 'LAST',
    no: 10,
    name: 'Finish',
    owner: 'Owner',
    required: true,
    finishesWorkflow: true,
  }).items;
  const result = imported(
    'workflow',
    {
      no: 2,
      name: 'Review',
      owner: 'Owner',
      requiredFields: 'Cost owner\nScope',
      slaHolidays: '2026-12-25',
    },
    current,
  );
  assert.equal(result.items[0].no, '02');
  assert.equal(result.items[0].createFolder, true);
  assert.equal(result.items[0].state, 'not_started');
  assert.ok(result.items[0].code.startsWith('CUSTOM-STAGE-'));
  assert.deepEqual(result.items[0].requiredFields, ['Cost owner', 'Scope']);
  assert.equal(result.items[1].code, 'LAST');
  const disallowed = previewBulkImport(
    'workflow',
    [{ row: 4, values: { code: 'LAST', state: 'completed' } }],
    current,
  );
  assert.ok(disallowed.issues.some((issue) => issue.column === 'state'));
  assert.deepEqual(disallowed.items, current);
  const dates = previewBulkImport(
    'workflow',
    [{ row: 5, values: { code: 'LAST', slaHolidays: '2026-02-30' } }],
    current,
  );
  assert.ok(dates.issues.some((issue) => issue.column === 'slaHolidays'));
});

test('context keys detect any pending catalog or dependency change without depending on property order', () => {
  const first = [{ id: 'a', active: true }];
  assert.equal(
    bulkImportContextKey(first),
    bulkImportContextKey([{ active: true, id: 'a' }]),
  );
  assert.notEqual(
    bulkImportContextKey(first),
    bulkImportContextKey([{ id: 'a', active: false }]),
  );
  assert.notEqual(
    bulkImportContextKey(first, { assumptions: [{ id: 'a' }] }),
    bulkImportContextKey(first, { assumptions: [{ id: 'b' }] }),
  );
});

test('free-form customer wording and small numeric Excel cells retain their original values', () => {
  const terms = '\n  Customer terms\n  Second clause  \n';
  const current = imported('quote-templates', {
    ...samples['quote-templates'],
    termsAndConditions: terms,
  }).items;
  const unchanged = imported('quote-templates', current[0], current);
  assert.equal(unchanged.unchanged, 1);
  assert.equal(unchanged.items[0].termsAndConditions, terms);
  const small = imported('subcontract', {
    ...samples.subcontract,
    unitPrice: 1e-7,
  });
  assert.equal(small.items[0].unitPrice, 1e-7);
});

test('an invalid unmentioned draft row prevents applying a partially valid merged catalog', () => {
  const current = imported('profit-share').items;
  current[0].ratePercent = 101;
  const result = previewBulkImport(
    'profit-share',
    [{ row: 2, values: { bu: 'Other BU', ratePercent: 10 } }],
    current,
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.row === 0 && issue.column === 'ratePercent',
    ),
  );
  assert.equal(result.added, 0);
  assert.deepEqual(result.items, current);
});
