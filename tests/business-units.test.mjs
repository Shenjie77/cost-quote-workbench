import assert from 'node:assert/strict';
import test from 'node:test';
import { getBusinessUnitOptions } from '../features/master-data/business-units.ts';

test('BU choices include only active named records and deduplicate names using established matching rules', () => {
  const records = [
    { bu: ' Networks  East ', buCode: ' NE-10 ', active: true },
    { bu: 'networks east', buCode: 'DUPLICATE', active: true },
    { bu: 'Retired', active: false },
    { bu: 'Missing active' },
    { bu: 'Invalid active', active: 'true' },
    { bu: 'Delivery', buCode: 'NE-10', active: true },
    { bu: 'Support', active: true },
    { bu: '   ', active: true },
    { bu: 123, active: true },
    null,
    [],
  ];
  const before = structuredClone(records);
  assert.deepEqual(getBusinessUnitOptions(records), [
    { value: 'Networks East', label: 'Networks East · NE-10' },
    { value: 'Delivery', label: 'Delivery · NE-10' },
    { value: 'Support', label: 'Support' },
  ]);
  assert.deepEqual(records, before);
});

test('changing or duplicating a company BU code never changes the selected cost BU name', () => {
  const first = getBusinessUnitOptions([
    { bu: 'Network', buCode: 'OLD', active: true },
  ]);
  const changed = getBusinessUnitOptions([
    { bu: 'Network', buCode: 'NEW', active: true },
  ]);
  assert.equal(first[0].value, changed[0].value);
  assert.notEqual(first[0].label, changed[0].label);
  assert.deepEqual(
    getBusinessUnitOptions([{ bu: 'Network', buCode: {}, active: true }]),
    [{ value: 'Network', label: 'Network' }],
  );
});

test('unavailable or malformed BU directories produce no invented catalog choices', () => {
  for (const value of [undefined, null, {}, 'Network', 12, false])
    assert.deepEqual(getBusinessUnitOptions(value), []);
});
