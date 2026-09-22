/** Target allocation operates on temporary quote lines and never persists business data. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateQuoteTarget } from '../features/quote/target-allocation.ts';
import {
  calculateManualQuoteLines,
  validateManualQuoteLines,
  validateQuoteLines,
} from '../features/quote/quote-lines.ts';

const line = (id, extra = {}) => ({
  id,
  description: `Service ${id}`,
  quantity: 1,
  unit: 'lot',
  unitPrice: 0,
  ...extra,
});
const amounts = (lines) =>
  calculateManualQuoteLines(lines).lines.map((item) => item.amount);

/** Every accepted candidate must validate through the same customer-export boundary. */
function expectValid(result, target) {
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, target);
  assert.equal(result.difference, 0);
  const output = calculateManualQuoteLines(result.lines);
  assert.deepEqual(output.errors, []);
  assert.deepEqual(validateQuoteLines(output.lines, target), []);
}

test('implicit amounts preserve proportions and largest-remainder cents reconcile an exact target', () => {
  const input = [
    line('a', { unitPrice: 20 }),
    line('b', { unitPrice: 30 }),
    line('c', { unitPrice: 50 }),
  ];
  const before = structuredClone(input);
  const result = allocateQuoteTarget(input, 123.45);
  expectValid(result, 123.45);
  assert.deepEqual(amounts(result.lines), [24.69, 37.04, 61.72]);
  assert.deepEqual(input, before);
  assert.notEqual(result.lines, input);
  for (const [index, output] of result.lines.entries()) {
    assert.equal(output.id, input[index].id);
    assert.equal(output.description, input[index].description);
    assert.equal(output.quantity, input[index].quantity);
    assert.equal(output.unit, input[index].unit);
  }
});

test('relative weights override only their own line amount and a zero weight remains free', () => {
  const input = [
    line('a', { unitPrice: 900, allocationWeight: 25 }),
    line('b', { unitPrice: 50 }),
    line('c', { unitPrice: 900, allocationWeight: 0 }),
  ];
  const result = allocateQuoteTarget(input, 90);
  expectValid(result, 90);
  assert.deepEqual(amounts(result.lines), [30, 60, 0]);
  assert.equal(result.lines[0].allocationWeight, 25);
  assert.equal(result.lines[2].allocationWeight, 0);
});

test('fixed unit prices and rounded amounts are preserved while remaining revenue uses unlocked weights', () => {
  const fixed = line('fixed', {
    quantity: 0.3333,
    unitPrice: 10.0001,
    priceFixed: true,
    allocationWeight: 999,
  });
  const input = [
    fixed,
    line('a', { allocationWeight: 1 }),
    line('b', { allocationWeight: 2 }),
  ];
  const result = allocateQuoteTarget(input, 100);
  expectValid(result, 100);
  assert.deepEqual(result.lines[0], fixed);
  assert.deepEqual(amounts(result.lines), [3.34, 32.22, 64.44]);
});

test('all implicit zero amounts use equal shares, but explicit all-zero weights require correction', () => {
  const input = [line('a'), line('b'), line('c')];
  const result = allocateQuoteTarget(input, 100);
  expectValid(result, 100);
  assert.deepEqual(amounts(result.lines), [33.34, 33.33, 33.33]);
  for (const explicit of [
    [line('a', { allocationWeight: 0 })],
    [line('a', { allocationWeight: 0 }), line('b')],
  ]) {
    const result = allocateQuoteTarget(explicit, 100);
    assert.equal(result.lines, explicit);
    assert.match(result.errors.join(' '), /positive allocation weight/);
  }
});

test('fractional quantities retain four-decimal unit prices and exact cents without changing quantities', () => {
  for (const target of [0, 0.01, 1, 100, 1234.56]) {
    const input = [
      line('a', { quantity: 0.3333, allocationWeight: 1 }),
      line('b', { quantity: 2.5, allocationWeight: 1 }),
      line('c', { quantity: 99.9999, allocationWeight: 1 }),
    ];
    const result = allocateQuoteTarget(input, target);
    expectValid(result, target);
    assert.deepEqual(
      result.lines.map((entry) => entry.quantity),
      [0.3333, 2.5, 99.9999],
    );
  }
});

test('an unlocked fine quantity absorbs rounding residue while zero-weight and fixed rows stay unchanged', () => {
  const input = [
    line('coarse', { quantity: 1000, allocationWeight: 1 }),
    line('fine', { allocationWeight: 1 }),
    line('zero', { allocationWeight: 0 }),
    line('fixed', { unitPrice: 1.01, priceFixed: true }),
  ];
  const result = allocateQuoteTarget(input, 1.12);
  expectValid(result, 1.12);
  assert.deepEqual(amounts(result.lines), [0, 0.11, 0, 1.01]);
  assert.deepEqual(result.lines[3], input[3]);
});

test('coarse price increments can exchange a small amount to reach an exact total', () => {
  const input = [
    line('six', { quantity: 600, allocationWeight: 1 }),
    line('ten', { quantity: 1000, allocationWeight: 1 }),
  ];
  const result = allocateQuoteTarget(input, 0.2);
  expectValid(result, 0.2);
  assert.deepEqual(amounts(result.lines), [0, 0.2]);
});

test('unrepresentable prices and maximum price limits fail atomically with original total and remaining difference', () => {
  for (const [input, target] of [
    [
      [line('coarse', { quantity: 1000, unitPrice: 1, allocationWeight: 1 })],
      0.01,
    ],
    [[line('tiny', { quantity: 0.0001, allocationWeight: 1 })], 1e12],
  ]) {
    const before = structuredClone(input);
    const result = allocateQuoteTarget(input, target);
    assert.equal(result.lines, input);
    assert.deepEqual(input, before);
    assert.ok(result.errors.length);
    assert.equal(result.total, calculateManualQuoteLines(input).total);
    assert.equal(
      result.difference,
      (Math.round(target * 100) - Math.round(result.total * 100)) / 100,
    );
  }
});

test('fixed sums above target and mismatched all-fixed totals fail without changing any line', () => {
  for (const input of [
    [line('a', { unitPrice: 100, priceFixed: true }), line('b')],
    [line('a', { unitPrice: 100, priceFixed: true })],
  ]) {
    const result = allocateQuoteTarget(input, 99);
    assert.equal(result.lines, input);
    assert.match(result.errors.join(' '), /exceed/);
  }
  const allFixed = [line('a', { unitPrice: 100, priceFixed: true })];
  assert.match(
    allocateQuoteTarget(allFixed, 101).errors.join(' '),
    /All line prices are fixed/,
  );
  expectValid(allocateQuoteTarget(allFixed, 100), 100);
});

test('invalid targets, lines and allocation metadata never produce a changed candidate', () => {
  for (const target of [-1, NaN, Infinity, 1e12 + 1, 1.001, '100']) {
    const input = [line('a')];
    const result = allocateQuoteTarget(input, target);
    assert.equal(result.lines, input);
    assert.ok(result.errors.length);
    assert.ok(Number.isFinite(result.total));
    assert.ok(Number.isFinite(result.difference));
  }
  for (const extra of [
    { allocationWeight: -1 },
    { allocationWeight: Infinity },
    { allocationWeight: NaN },
    { allocationWeight: 1e6 + 1 },
    { allocationWeight: null },
    { allocationWeight: '10' },
    { priceFixed: 'true' },
    { priceFixed: null },
    { quantity: 0 },
    { quantity: 0.12345 },
    { unitPrice: 0.12345 },
    { description: '' },
  ]) {
    const input = [line('a', extra)];
    const result = allocateQuoteTarget(input, 100);
    assert.equal(result.lines, input);
    assert.ok(result.errors.length, JSON.stringify(extra));
  }
  const duplicate = [line('a'), line('a')];
  assert.ok(allocateQuoteTarget(duplicate, 100).errors.length);
});

test('allocation metadata validates internally and never enters customer-facing quotation rows', () => {
  const input = [
    line('a', { unitPrice: 100, allocationWeight: 35.5, priceFixed: false }),
  ];
  assert.deepEqual(validateManualQuoteLines(input), []);
  const output = calculateManualQuoteLines(input);
  assert.deepEqual(Object.keys(output.lines[0]).sort(), [
    'amount',
    'description',
    'id',
    'quantity',
    'unit',
    'unitPrice',
  ]);
  assert.equal(output.total, 100);
  assert.equal(input[0].allocationWeight, 35.5);
});

test('maximum supported target and tiny quantities remain finite and reconcile where representable', () => {
  expectValid(allocateQuoteTarget([line('a')], 1e12), 1e12);
  expectValid(
    allocateQuoteTarget([line('a', { quantity: 0.0001 }), line('b')], 1e12),
    1e12,
  );
  expectValid(
    allocateQuoteTarget([line('a', { quantity: 0.0001 })], 100_000_000),
    100_000_000,
  );
});

test('deterministic combinations of fine quantities and weights satisfy export reconciliation and do not mutate input', () => {
  const quantities = [0.0001, 0.125, 0.3333, 1, 2.5, 25, 99.9999];
  for (let seed = 1; seed <= 80; seed++) {
    const input = Array.from({ length: 5 }, (_, index) =>
      line(`line-${index}`, {
        quantity: quantities[(seed + index) % quantities.length],
        allocationWeight: ((seed * (index + 1)) % 13) + 1,
      }),
    );
    const before = structuredClone(input);
    const target = ((seed * 13771) % 10_000_000) / 100;
    expectValid(allocateQuoteTarget(input, target), target);
    assert.deepEqual(input, before);
  }
});

test('an unchanged target preserves existing fractional prices within their rounded-cent interval', () => {
  const input = [
    line('a', { quantity: 0.3333, unitPrice: 10.0001 }),
    line('b', { quantity: 2.5, unitPrice: 0.0001 }),
  ];
  const target = calculateManualQuoteLines(input).total;
  const result = allocateQuoteTarget(input, target);
  expectValid(result, target);
  assert.deepEqual(result.lines, input);
  assert.deepEqual(
    allocateQuoteTarget(result.lines, target).lines,
    result.lines,
  );
});
