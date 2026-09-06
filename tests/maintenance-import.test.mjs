/** Import checks must fail before merging any record into a saved workspace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMaintenanceImport,
  parseImportNumber,
} from '../features/master-data/maintenance-import.ts';
import { initialMaintenancePriceRecords } from '../features/master-data/domain.ts';

const fixture = () => ({
  schemaVersion: '1.0.0',
  records: structuredClone(initialMaintenancePriceRecords),
});

test('maintenance imports accept governed records and formatted numeric cells', () => {
  assert.doesNotThrow(() => assertMaintenanceImport(fixture()));
  assert.equal(parseImportNumber('1,000.00', 'cost'), 1000);
  for (const value of ['', '1,00', 'SGD 100', '-4', 'NaN'])
    assert.throws(() => parseImportNumber(value, 'cost'), /non-negative/);
});
test('maintenance imports reject malformed records and duplicate IDs atomically', () => {
  for (const mutation of [
    (row) => {
      row.quoteDate = '2026-02-31';
    },
    (row) => {
      row.costAmount = -1;
    },
    (row) => {
      row.costAmount = '100';
    },
    (row) => {
      row.currency = 'USD';
    },
    (row) => {
      row.extra = true;
    },
    (row) => {
      row.id = '../unsafe';
    },
    (row) => {
      row.source = ' ';
    },
  ]) {
    const data = fixture();
    mutation(data.records[1]);
    assert.throws(() => assertMaintenanceImport(data));
  }
  const data = fixture();
  data.records[1].id = data.records[0].id;
  assert.throws(() => assertMaintenanceImport(data), /duplicate/);
});
