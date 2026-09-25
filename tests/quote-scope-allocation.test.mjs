import assert from 'node:assert/strict';
import test from 'node:test';
import { assignQuoteScopes } from '../features/quote/scope-allocation.ts';
import { lineCostAmounts } from '../features/quote/line-pricing.ts';
import { quoteScopeCosts } from '../features/quote/quote-lines.ts';
import { makeCostSnapshot } from './helpers.mjs';
const scopes = [
  { key: 'a', amount: 30 },
  { key: 'b', amount: 20 },
  { key: 'c', amount: 50 },
];
const row = (id, costWeight = 0) => ({
  id,
  description: id,
  quantity: 1,
  unit: 'lot',
  unitPrice: 0,
  costWeight,
  targetGrossMargin: 50,
});
test('scope selection sums multiple scopes, moves duplicate assignments, and preserves total cost', () => {
  let lines = assignQuoteScopes(
    [row('one', 60), row('two', 40)],
    'one',
    ['a', 'b'],
    scopes,
    100,
    'rest',
  );
  assert.deepEqual(lineCostAmounts(lines, 100), [50, 50]);
  lines = assignQuoteScopes(lines, 'two', ['b', 'c'], scopes, 100, 'rest');
  assert.deepEqual(
    lines.map((line) => line.costScopeKeys),
    [['a'], ['b', 'c']],
  );
  assert.deepEqual(lineCostAmounts(lines, 100), [30, 70]);
  lines = assignQuoteScopes(lines, 'two', [], scopes, 100, 'rest');
  assert.deepEqual(lineCostAmounts(lines, 100), [30, 0, 70]);
  assert.equal(lines[2].description, 'Other scopes');
});
test('single custom row gains a remainder row when selecting only part of project cost', () => {
  const original = [row('one', 100)];
  const lines = assignQuoteScopes(
    original,
    'one',
    ['a', 'a', 'missing'],
    scopes,
    100,
    'rest',
  );
  assert.deepEqual(lineCostAmounts(lines, 100), [30, 70]);
  assert.deepEqual(lines[0].costScopeKeys, ['a']);
  assert.deepEqual(original, [row('one', 100)]);
});
test('scope costs reconcile risk-inclusive project total and retain stable keys after cost row reorder', () => {
  const snapshot = makeCostSnapshot();
  const first = quoteScopeCosts(snapshot, 1234.56);
  const second = quoteScopeCosts(
    { ...snapshot, costRows: [...snapshot.costRows].reverse() },
    1234.56,
  );
  assert.equal(
    Math.round(first.reduce((sum, row) => sum + row.amount, 0) * 100),
    123456,
  );
  assert.deepEqual(
    first.map((row) => row.key).sort(),
    second.map((row) => row.key).sort(),
  );
});
