import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_DATABASE_STATEMENTS } from '../db/schema.ts';
import {
  initializeGlobalMasterData,
  makeGlobalMasterDataStore,
  validateGlobalMasterDataRows,
} from '../server/global-master-data.mjs';
import {
  bulkTabSpec,
  previewBulkImport,
} from '../features/master-data/bulk-import-model.ts';
import {
  createBulkImportWorkbook,
  readBulkImportWorkbook,
} from '../features/master-data/bulk-import-workbook.ts';
import {
  historyFieldValue,
  maintenanceHistoryColumns,
  serviceHistoryColumns,
} from '../features/master-data/history-fields.ts';
import {
  entryWorkbook,
  readEntrySheet,
} from '../features/bulk-entry/workbook.ts';

const service = {
  client: 'Customer',
  project: 'Network upgrade',
  service: 'Deployment',
  quantity: 2.5,
  unit: 'day',
  unitPrice: 400,
  costAmount: 600,
  quotedYear: 2026,
  source: 'QT-001',
};
const preview = (tab, values, current = []) =>
  previewBulkImport(tab, [{ row: 2, values }], current);

test('history grids, paste sheets and XLSX use the same field order, with optional identity last', () => {
  for (const [tab, columns] of [
    ['maintenance', maintenanceHistoryColumns],
    ['service-history', serviceHistoryColumns],
  ]) {
    const spec = bulkTabSpec(tab);
    assert.deepEqual(spec.columns.slice(0, -1), columns);
    assert.equal(spec.columns.at(-1).key, 'id');
    assert.equal(Boolean(spec.columns.at(-1).required), false);
    const sheet = { id: tab, name: spec.label, columns: spec.columns };
    const workbook = entryWorkbook([sheet]);
    assert.deepEqual(readEntrySheet(workbook, sheet).issues, []);
    workbook.workbook.sheets[tab].cellData[0][0].v = 'Legacy field';
    assert.ok(
      readEntrySheet(workbook, sheet).issues.length,
      'stale draft cannot silently shift fields',
    );
  }
});

test('service history computes total and GP and persists only editable inputs plus validated total', async () => {
  const result = preview('service-history', service);
  assert.deepEqual(result.issues, []);
  const row = result.items[0];
  assert.equal(row.quotedAmount, 1000);
  assert.equal(historyFieldValue('service-history', 'grossMargin', row), 40);
  assert.equal(row.grossMargin, undefined);
  validateGlobalMasterDataRows('service-history', [row]);
  const file = await createBulkImportWorkbook('service-history', [row]);
  const imported = previewBulkImport(
    'service-history',
    await readBulkImportWorkbook('service-history', file),
    [row],
  );
  assert.deepEqual(imported.issues, []);
  assert.equal(imported.unchanged, 1);
  const changed = preview('service-history', { id: row.id, quantity: 3 }, [
    row,
  ]);
  assert.equal(changed.items[0].quotedAmount, 1200);
  assert.equal(changed.items[0].costAmount, 600);
  assert.equal(
    historyFieldValue('service-history', 'grossMargin', {
      ...row,
      costAmount: 1200,
    }),
    -20,
  );
  const zero = preview('service-history', { ...service, unitPrice: 0 });
  assert.deepEqual(zero.issues, []);
  assert.equal(
    historyFieldValue('service-history', 'grossMargin', zero.items[0]),
    undefined,
  );
});

test('invalid quantities, totals, GP and overflow reject the whole import before persistence', () => {
  for (const changes of [
    { quantity: 0 },
    { quantity: -1 },
    { unit: ' ' },
    { quotedYear: 2026.5 },
    { quantity: 1e9, unitPrice: 1e12 },
    { quotedAmount: 999 },
    { grossMargin: 50 },
  ]) {
    const result = preview('service-history', { ...service, ...changes });
    assert.ok(result.issues.length, JSON.stringify(changes));
    assert.deepEqual(result.items, []);
  }
  const row = preview('service-history', service).items[0];
  assert.throws(() =>
    validateGlobalMasterDataRows('service-history', [
      { ...row, quotedAmount: 999 },
    ]),
  );
});

test('maintenance entry requires only current grid fields and derives its annual price', () => {
  const result = preview('maintenance', {
    productModel: 'NE-X',
    client: 'Customer',
    ct: 100,
    spms: 25,
    quotedYear: 2026,
    project: 'Upgrade',
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.items[0].quotedAmount, 125);
  assert.equal(result.items[0].quoteDate, '2026-01-01');
  assert.equal(
    historyFieldValue('maintenance', 'unitAnnualQuote', result.items[0]),
    125,
  );
  validateGlobalMasterDataRows('maintenance', result.items);
});

test('legacy maintenance export/re-import preserves quantity, duration, date, cost and metadata', async () => {
  const legacy = {
    id: 'old',
    productModel: 'NE-X',
    client: 'Customer',
    service: 'Support',
    serviceLevel: '24x7',
    site: 'Singapore',
    coverageMonths: 24,
    quantity: 5,
    costAmount: 750,
    quotedAmount: 1000,
    quoteDate: '2025-09-28',
    outcome: 'Won',
    source: 'Old quote',
    currency: 'SGD',
  };
  const bytes = await createBulkImportWorkbook('maintenance', [legacy]);
  const result = previewBulkImport(
    'maintenance',
    await readBulkImportWorkbook('maintenance', bytes),
    [legacy],
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(result.items, [legacy]);
  const edited = preview('maintenance', { id: legacy.id, ct: 100, spms: 25 }, [
    legacy,
  ]);
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.items[0].ct, 100);
  assert.equal(edited.items[0].quotedAmount, 125);
  assert.equal(edited.items[0].quoteDate, legacy.quoteDate);
  assert.equal(edited.items[0].costAmount, legacy.costAmount);
});

test('existing databases gain an empty service catalog with independent revisions and retain other catalogs', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const sql of LOCAL_DATABASE_STATEMENTS) db.exec(sql);
  initializeGlobalMasterData(db);
  db.exec(
    "DELETE FROM master_data_tabs WHERE tab='service-history'; DELETE FROM master_data_revisions WHERE tab='service-history';",
  );
  const original = db
    .prepare('SELECT * FROM master_data_tabs ORDER BY tab')
    .all();
  const store = makeGlobalMasterDataStore(db);
  const initial = store.get('service-history');
  assert.equal(initial.revision, 1);
  assert.deepEqual(initial.items, []);
  const row = preview('service-history', service).items[0];
  store.update('service-history', { upsert: [row] }, 1);
  assert.equal(
    makeGlobalMasterDataStore(db).get('service-history').items[0].quotedAmount,
    1000,
  );
  assert.throws(() => store.update('service-history', { upsert: [row] }, 1));
  assert.deepEqual(
    db
      .prepare(
        "SELECT * FROM master_data_tabs WHERE tab!='service-history' ORDER BY tab",
      )
      .all(),
    original,
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM projects').get().n, 0);
});
