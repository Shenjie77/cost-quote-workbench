import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignQuoteScopes,
  savedScopeAllocations,
  resolveQuoteScopeCosts,
  assignQuoteScopePercentages,
} from '../features/quote/scope-allocation.ts';
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
    lines.map((line) =>
      savedScopeAllocations(line)
        .filter((item) => item.percentage > 0)
        .map((item) => item.key),
    ),
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
  assert.deepEqual(savedScopeAllocations(lines[0]), [
    { key: 'a', percentage: 100 },
  ]);
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

test('saved Scope percentages follow changing source costs even when project total stays unchanged', () => {
  const lines = [
    {
      ...row('one'),
      costScopeAllocations: [{ key: 'a', percentage: 50 }],
      riskAllocationPercent: 25,
    },
    {
      ...row('two'),
      costScopeAllocations: [
        { key: 'a', percentage: 50 },
        { key: 'b', percentage: 100 },
      ],
      riskAllocationPercent: 75,
    },
  ];
  const before = structuredClone(lines);
  const first = resolveQuoteScopeCosts(
    lines,
    [
      { key: 'a', amount: 60 },
      { key: 'b', amount: 40 },
    ],
    120,
    20,
  );
  assert.deepEqual(first.errors, []);
  assert.deepEqual(
    first.lines.map((line) => line.costWeight),
    [35, 85],
  );
  const updated = resolveQuoteScopeCosts(
    first.lines,
    [
      { key: 'a', amount: 80 },
      { key: 'b', amount: 20 },
    ],
    120,
    20,
  );
  assert.deepEqual(updated.errors, []);
  assert.deepEqual(
    updated.lines.map((line) => line.costWeight),
    [45, 75],
  );
  assert.deepEqual(lines, before);
});

test('risk-only changes preserve unbound base weights and repeated recalculations never drift', () => {
  const selected = assignQuoteScopePercentages(
    [row('one', 60), row('two', 40)],
    'one',
    undefined,
    0,
  );
  let result = resolveQuoteScopeCosts(selected, scopes, 120, 20);
  assert.deepEqual(
    result.lines.map((line) => line.costWeight),
    [60, 60],
  );
  for (let i = 0; i < 10; i++)
    result = resolveQuoteScopeCosts(result.lines, scopes, 120, 20);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.lines.map((line) => line.costWeight),
    [60, 60],
  );
});

test('shared Scope edits shrink only overcommitted reservations and retain exact cent totals', () => {
  const original = [
    { ...row('one'), costScopeAllocations: [{ key: 'a', percentage: 100 }] },
    row('two'),
  ];
  const lines = assignQuoteScopePercentages(
    original,
    'two',
    [{ key: 'a', percentage: 30 }],
    40,
  );
  assert.equal(lines[0].costScopeAllocations[0].percentage, 70);
  const result = resolveQuoteScopeCosts(
    lines,
    [{ key: 'a', amount: 0.03 }],
    0.05,
    0.02,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(
    Math.round(
      result.lines.reduce((sum, line) => sum + line.costWeight, 0) * 100,
    ),
    5,
  );
});

test('missing sources and fully reserved risk leave unassigned costs in a durable fallback row', () => {
  const lines = [
    {
      ...row('one'),
      costScopeAllocations: [{ key: 'deleted', percentage: 100 }],
      riskAllocationPercent: 0,
    },
  ];
  let result = resolveQuoteScopeCosts(
    lines,
    [{ key: 'new', amount: 80 }],
    100,
    20,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.lines.map((line) => line.costWeight),
    [0, 100],
  );
  result = resolveQuoteScopeCosts(
    result.lines,
    [{ key: 'new', amount: 100 }],
    140,
    40,
  );
  assert.deepEqual(
    result.lines.map((line) => line.costWeight),
    [0, 140],
  );
});

test('invalid duplicate or overcommitted source shares cannot be priced', () => {
  for (const allocations of [
    [{ key: 'a', percentage: 101 }],
    [
      { key: 'a', percentage: 50 },
      { key: 'a', percentage: 50 },
    ],
  ]) {
    assert.ok(
      resolveQuoteScopeCosts(
        [{ ...row('one'), costScopeAllocations: allocations }],
        scopes,
        100,
        0,
      ).errors.length,
    );
  }
});
