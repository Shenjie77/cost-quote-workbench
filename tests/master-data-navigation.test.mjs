/** Maintenance destinations are shared by tab rendering and Quote deep links. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  masterDataTabs,
  isMasterDataTab,
} from '../features/master-data/navigation.ts';

test('one maintenance surface retains all nine independent global data tabs', () => {
  const keys = masterDataTabs.map((tab) => tab.value);
  assert.equal(keys.length, 9);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys].sort(), [
    'assumptions',
    'cpq-catalog',
    'maintenance',
    'quote-templates',
    'resources',
    'status',
    'subcontract',
    'supplemental',
    'workflow',
  ]);
  for (const tab of masterDataTabs) {
    assert.ok(tab.label.trim());
    assert.ok(tab.labelZh.trim());
    assert.equal(isMasterDataTab(tab.value), true);
  }
});

test('quote links resolve to maintenance tabs, while unsupported settings are rejected', () => {
  assert.equal(isMasterDataTab('quote-templates'), true);
  assert.equal(isMasterDataTab('assumptions'), true);
  for (const invalid of [
    'templates-settings',
    'settings',
    'quote',
    null,
    undefined,
    0,
    '',
  ]) {
    assert.equal(isMasterDataTab(invalid), false);
  }
});
