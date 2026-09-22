/** Percent-lock allocation is local and always reconciles through the customer quotation validators. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateQuotePercentages } from '../features/quote/percentage-allocation.ts';
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
const values = (result) =>
  calculateManualQuoteLines(result.lines).lines.map((entry) => entry.amount);
const valid = (result, target) => {
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, target);
  assert.equal(result.difference, 0);
  const calculated = calculateManualQuoteLines(result.lines);
  assert.deepEqual(calculated.errors, []);
  assert.deepEqual(validateQuoteLines(calculated.lines, target), []);
};
const unchanged = (input, target, message) => {
  const before = structuredClone(input);
  const result = allocateQuotePercentages(input, target);
  assert.equal(result.lines, input);
  assert.deepEqual(input, before);
  assert.ok(result.errors.length);
  if (message) assert.match(result.errors.join(' '), message);
  return result;
};

test('unlocked percentages divide the full target equally instead of preserving previous amounts or relative weights', () => {
  const input = [
    line('a', { unitPrice: 10, allocationWeight: 1 }),
    line('b', { unitPrice: 90, allocationWeight: 99 }),
  ];
  const before = structuredClone(input);
  const result = allocateQuotePercentages(input, 100);
  valid(result, 100);
  assert.deepEqual(values(result), [50, 50]);
  assert.deepEqual(
    result.lines.map((entry) => entry.allocationWeight),
    [50, 50],
  );
  assert.deepEqual(input, before);
});

test('a user-set percentage remains locked and all other rows share the remainder evenly', () => {
  const result = allocateQuotePercentages(
    [
      line('a', { allocationWeight: 40, allocationFixed: true }),
      line('b'),
      line('c'),
    ],
    250,
  );
  valid(result, 250);
  assert.deepEqual(values(result), [100, 75, 75]);
  assert.deepEqual(
    result.lines.map((entry) => entry.allocationWeight),
    [40, 30, 30],
  );
  assert.equal(result.lines[0].allocationFixed, true);
});

test('fixed unit prices reserve their rounded amount and expose their actual percentage of the current target', () => {
  const fixed = line('fixed', {
    quantity: 0.3333,
    unitPrice: 10.0001,
    priceFixed: true,
  });
  const result = allocateQuotePercentages(
    [
      fixed,
      line('percent', { allocationWeight: 40, allocationFixed: true }),
      line('free'),
    ],
    100,
  );
  valid(result, 100);
  assert.deepEqual(values(result), [3.34, 40, 56.66]);
  assert.equal(result.lines[0].unitPrice, fixed.unitPrice);
  assert.equal(result.lines[0].quantity, fixed.quantity);
  assert.equal(result.lines[0].allocationWeight, 3.34);
  assert.equal(result.lines[1].allocationWeight, 40);
  assert.ok(Math.abs(result.lines[2].allocationWeight - 56.66) < 1e-12);
});

test('changing the target recomputes all unlocked prices while retaining percentage and price locks', () => {
  const input = [
    line('price', { unitPrice: 20, priceFixed: true }),
    line('percent', { allocationWeight: 25, allocationFixed: true }),
    line('free'),
  ];
  const first = allocateQuotePercentages(input, 100);
  valid(first, 100);
  assert.deepEqual(values(first), [20, 25, 55]);
  const second = allocateQuotePercentages(first.lines, 200);
  valid(second, 200);
  assert.deepEqual(values(second), [20, 50, 130]);
  assert.deepEqual(
    second.lines.map((entry) => entry.allocationWeight),
    [10, 25, 65],
  );
  assert.equal(second.lines[0].unitPrice, 20);
});

test('locked percentages preserve entered precision rather than being replaced with rounded amount percentages', () => {
  const input = [
    line('locked', { allocationWeight: 33.3333, allocationFixed: true }),
    line('b'),
    line('c'),
  ];
  const result = allocateQuotePercentages(input, 1);
  valid(result, 1);
  assert.equal(result.lines[0].allocationWeight, 33.3333);
  assert.notEqual(result.lines[0].allocationWeight, values(result)[0] * 100);
  assert.deepEqual(
    result.lines.slice(1).map((entry) => entry.allocationWeight),
    [(100 - 33.3333) / 2, (100 - 33.3333) / 2],
  );
  assert.deepEqual(
    allocateQuotePercentages(result.lines, 1).lines,
    result.lines,
  );
});

test('cent allocation is deterministic and an exact target survives repeated allocation', () => {
  const input = [line('a'), line('b'), line('c')];
  const first = allocateQuotePercentages(input, 0.01);
  valid(first, 0.01);
  assert.deepEqual(values(first), [0.01, 0, 0]);
  assert.deepEqual(
    first.lines.map((entry) => entry.allocationWeight),
    [100 / 3, 100 / 3, 100 / 3],
  );
  const next = allocateQuotePercentages(first.lines, 0.01);
  assert.deepEqual(next.lines, first.lines);
});

test('price precision may reconcile between unlocked rows but never changes a locked-percentage cent amount', () => {
  const fixed = line('locked', { allocationWeight: 50, allocationFixed: true });
  const result = allocateQuotePercentages(
    [fixed, line('coarse', { quantity: 1000 }), line('fine')],
    0.22,
  );
  valid(result, 0.22);
  assert.deepEqual(values(result), [0.11, 0, 0.11]);
  assert.equal(result.lines[0].allocationWeight, 50);
  unchanged(
    [
      line('locked-coarse', {
        quantity: 1000,
        allocationWeight: 50,
        allocationFixed: true,
      }),
      line('fine'),
    ],
    0.01,
    /fixed percentage cannot be represented/,
  );
});

test('percentages above 100, fixed costs beyond target and combined over-allocation fail atomically', () => {
  unchanged(
    [
      line('a', { allocationWeight: 60, allocationFixed: true }),
      line('b', { allocationWeight: 41, allocationFixed: true }),
    ],
    100,
    /exceed 100/,
  );
  unchanged(
    [line('a', { unitPrice: 101, priceFixed: true }), line('b')],
    100,
    /exceed the target/,
  );
  unchanged(
    [
      line('a', { unitPrice: 60, priceFixed: true }),
      line('b', { allocationWeight: 50, allocationFixed: true }),
      line('c'),
    ],
    100,
    /exceed 100/,
  );
  unchanged(
    [line('a', { allocationWeight: 100.0001, allocationFixed: true })],
    100,
    /between 0 and 100/,
  );
  unchanged([line('a', { allocationWeight: 101 })], 100, /between 0 and 100/);
});

test('remaining target without an unlocked row produces an actionable error', () => {
  unchanged(
    [
      line('a', { allocationWeight: 40, allocationFixed: true }),
      line('b', { allocationWeight: 50, allocationFixed: true }),
    ],
    100,
    /remaining target value/,
  );
  unchanged(
    [line('a', { unitPrice: 20, priceFixed: true })],
    100,
    /remaining target value/,
  );
  valid(
    allocateQuotePercentages(
      [
        line('a', { allocationWeight: 40, allocationFixed: true }),
        line('b', { allocationWeight: 60, allocationFixed: true }),
      ],
      100,
    ),
    100,
  );
  valid(
    allocateQuotePercentages(
      [line('a', { unitPrice: 100, priceFixed: true })],
      100,
    ),
    100,
  );
});

test('zero and full percentages retain their meaning, including a zero total', () => {
  const result = allocateQuotePercentages(
    [
      line('a', { allocationWeight: 100, allocationFixed: true }),
      line('b', { unitPrice: 100 }),
      line('c'),
    ],
    100,
  );
  valid(result, 100);
  assert.deepEqual(values(result), [100, 0, 0]);
  assert.deepEqual(
    result.lines.map((entry) => entry.allocationWeight),
    [100, 0, 0],
  );
  valid(
    allocateQuotePercentages(
      [line('a', { allocationWeight: 0, allocationFixed: true }), line('b')],
      0,
    ),
    0,
  );
  const free = allocateQuotePercentages([line('a'), line('b')], 0);
  valid(free, 0);
  assert.deepEqual(
    free.lines.map((entry) => entry.allocationWeight),
    [50, 50],
  );
  const fixed = allocateQuotePercentages(
    [line('a', { unitPrice: 0, priceFixed: true })],
    0,
  );
  valid(fixed, 0);
  assert.equal(fixed.lines[0].allocationWeight, 0);
});

test('locks are mutually exclusive and percentage metadata remains internal to customer rows', () => {
  for (const extra of [
    { allocationFixed: true, priceFixed: true, allocationWeight: 50 },
    { allocationFixed: true },
    { allocationFixed: 'true', allocationWeight: 50 },
    { allocationFixed: null },
  ])
    assert.ok(validateManualQuoteLines([line('a', extra)]).length);
  unchanged(
    [
      line('a', {
        allocationFixed: true,
        priceFixed: true,
        allocationWeight: 50,
      }),
    ],
    100,
    /not both/,
  );
  const result = allocateQuotePercentages(
    [line('a', { allocationWeight: 40, allocationFixed: true }), line('b')],
    100,
  );
  valid(result, 100);
  assert.deepEqual(
    Object.keys(calculateManualQuoteLines(result.lines).lines[0]).sort(),
    ['amount', 'description', 'id', 'quantity', 'unit', 'unitPrice'],
  );
  // Old relative-weight metadata still validates outside the explicitly selected percentage allocation mode.
  assert.deepEqual(
    validateManualQuoteLines([line('legacy', { allocationWeight: 1000 })]),
    [],
  );
});

test('fractional quantities, maximum supported target and varied free-row counts remain exact', () => {
  for (const target of [0.01, 123.45, 1e12]) {
    const result = allocateQuotePercentages(
      [
        line('locked', {
          quantity: 1,
          allocationWeight: 25,
          allocationFixed: true,
        }),
        line('a', { quantity: 2.5 }),
        line('b', { quantity: 99.9999 }),
      ],
      target,
    );
    valid(result, target);
    assert.deepEqual(
      result.lines.map((entry) => entry.quantity),
      [1, 2.5, 99.9999],
    );
  }
  for (let count = 1; count <= 25; count++) {
    const input = [
      line('fixed', { allocationWeight: 17.125, allocationFixed: true }),
      ...Array.from({ length: count }, (_, index) =>
        line(`free-${index}`, { quantity: 0.5 + index }),
      ),
    ];
    const result = allocateQuotePercentages(input, 1234.56);
    valid(result, 1234.56);
    assert.ok(
      result.lines
        .slice(1)
        .every((entry) => entry.allocationWeight === (100 - 17.125) / count),
    );
  }
});

test('invalid targets and invalid line values do not throw or mutate the draft', () => {
  for (const target of [-1, NaN, Infinity, 1.001, 1e12 + 1])
    unchanged([line('a')], target);
  for (const extra of [
    { allocationWeight: NaN },
    { allocationWeight: -1 },
    { quantity: 0 },
    { quantity: 0.12345 },
    { unitPrice: Infinity },
  ])
    unchanged([line('a', extra)], 100);
  unchanged([], 100);
  unchanged([null], 100);
});

test('new quantities reprice unlocked cached amounts above the amount limit without changing the requested quantity', () => {
  const original = [line('a', { quantity: 1_000_000, unitPrice: 10_000_000 })];
  const before = structuredClone(original);
  const result = allocateQuotePercentages(original, 10_000_000);
  valid(result, 10_000_000);
  assert.equal(result.lines[0].quantity, 1_000_000);
  assert.equal(result.lines[0].unitPrice, 10);
  assert.deepEqual(original, before);
  const percentLocked = [
    line('a', {
      quantity: 1_000_000,
      unitPrice: 10_000_000,
      allocationFixed: true,
      allocationWeight: 50,
    }),
    line('b'),
  ];
  const shared = allocateQuotePercentages(percentLocked, 10_000_000);
  valid(shared, 10_000_000);
  assert.deepEqual(values(shared), [5_000_000, 5_000_000]);
  assert.equal(shared.lines[0].unitPrice, 5);
  assert.equal(shared.lines[0].allocationWeight, 50);
});

test('cached-price normalization never bypasses basic price validity, fixed-price amounts or atomic failure', () => {
  for (const unitPrice of [-1, NaN, Infinity, 1e12 + 1, 0.12345]) {
    unchanged(
      [line('a', { quantity: 1_000_000, unitPrice })],
      10_000_000,
      /unit price/,
    );
  }
  unchanged(
    [
      line('a', {
        quantity: 1_000_000,
        unitPrice: 10_000_000,
        priceFixed: true,
      }),
    ],
    10_000_000,
    /amount exceeds/,
  );
  const impossible = [
    line('a', { quantity: 1_000_000, unitPrice: 10_000_000 }),
  ];
  unchanged(impossible, 0.01, /cannot be split/);
});
