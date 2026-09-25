/** Independent GP pricing must reconcile allocated cost, customer prices and persisted API output. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { roundMoney } from '../features/cost/domain.ts';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';
import {
  allocateLinePricing,
  lineCostAmounts,
} from '../features/quote/line-pricing.ts';
import {
  buildQuoteLines,
  calculateManualQuoteLines,
} from '../features/quote/quote-lines.ts';
import { calculateBuCostAllocation } from '../features/quote/profit-share.ts';
import { makeCostSnapshot } from './helpers.mjs';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { buildQuoteWorkbookBuffer } from '../features/quote/export-quote-workbook.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  updateResource,
} from '../server/workspace-resources.mjs';

const line = (id, extra = {}) => ({
  id,
  description: `Service ${id}`,
  quantity: 1,
  unit: 'lot',
  unitPrice: 0,
  ...extra,
});
const amounts = (result) =>
  calculateManualQuoteLines(result.lines).lines.map((entry) => entry.amount);

test('single, Scope and item cost bases include all risk and overhead exactly once', () => {
  const snapshot = makeCostSnapshot();
  snapshot.manualCosts.riskContingency = 1234.56;
  const total = calculateBuCostAllocation(snapshot).totalCost;
  for (const mode of ['single', 'scope', 'item']) {
    const source = buildQuoteLines(snapshot, mode, total);
    const editable = source.map(({ amount, ...entry }) => ({
      ...entry,
      costWeight: amount,
      targetGrossMargin: 50,
    }));
    assert.equal(
      roundMoney(
        lineCostAmounts(editable, total).reduce((sum, value) => sum + value, 0),
      ),
      total,
    );
    const result = allocateLinePricing(editable, total, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(result.total, roundMoney(total * 2));
  }
});

test('cost weight and GP are independent of revenue percentages and reconcile all statement cents', () => {
  const input = [
    line('a', { costWeight: 1, targetGrossMargin: 50, allocationWeight: 90 }),
    line('b', { costWeight: 3, targetGrossMargin: 75, allocationWeight: 10 }),
  ];
  const before = structuredClone(input);
  const result = allocateLinePricing(input, 100, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(lineCostAmounts(input, 100), [25, 75]);
  assert.deepEqual(amounts(result), [50, 300]);
  assert.equal(result.total, 350);
  assert.deepEqual(lineCostAmounts(result.lines, 100), [25, 75]);
  assert.deepEqual(input, before);
  assert.deepEqual(
    lineCostAmounts([line('a'), line('b'), line('c')], 0.02),
    [0.01, 0.01, 0],
  );
});

test('missing cost bases capture original amounts once, while fixed and legacy loss prices remain unchanged', () => {
  const input = [
    line('a', { unitPrice: 10, targetGrossMargin: 50 }),
    line('b', { unitPrice: 30, priceFixed: true }),
  ];
  const first = allocateLinePricing(input, 100, 0);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(
    first.lines.map((entry) => entry.costWeight),
    [10, 30],
  );
  assert.deepEqual(amounts(first), [50, 30]);
  assert.deepEqual(allocateLinePricing(first.lines, 100, 0).lines, first.lines);
  assert.equal(
    allocateLinePricing([line('loss', { unitPrice: 5 })], 100, 0).total,
    5,
  );
  assert.deepEqual(
    amounts(
      allocateLinePricing(
        [
          line('source', { costWeight: 100, targetGrossMargin: 50 }),
          line('new', { costWeight: 0, targetGrossMargin: 50 }),
        ],
        100,
        0,
      ),
    ),
    [200, 0],
  );
});

test('GP accounts for profit share, preserves fractional quantities and rounds coarse quantities upward', () => {
  const fractional = allocateLinePricing(
    [
      line('fraction', {
        quantity: 0.3333,
        costWeight: 1,
        targetGrossMargin: 50,
      }),
    ],
    10,
    10,
  );
  assert.deepEqual(fractional.errors, []);
  assert.equal(fractional.lines[0].quantity, 0.3333);
  assert.equal(fractional.total, 25);
  const coarse = allocateLinePricing(
    [line('coarse', { quantity: 1000, costWeight: 1, targetGrossMargin: 50 })],
    1.01,
    0,
  );
  assert.deepEqual(coarse.errors, []);
  assert.equal(coarse.total, 2.1);
  assert.equal(coarse.lines[0].unitPrice, 0.0021);
  for (const cost of [0.01, 0.02, 1.01, 50.03])
    for (const share of [0, 1, 10, 49.9]) {
      const result = allocateLinePricing(
        [line('rounding', { costWeight: 1, targetGrossMargin: 50 })],
        cost,
        share,
      );
      assert.deepEqual(result.errors, []);
      const profit = roundMoney(
        result.total - cost - roundMoney((result.total * share) / 100),
      );
      assert.ok(profit + 1e-8 >= result.total * 0.5);
    }
});

test('invalid GP, cost, share, quantity, weights and overflowing prices fail atomically', () => {
  const cases = [
    [line('a', { targetGrossMargin: 50, costWeight: -1 })],
    [line('a', { targetGrossMargin: 96, costWeight: 1 })],
    [line('a', { targetGrossMargin: NaN, costWeight: 1 })],
    [line('a', { targetGrossMargin: 50, costWeight: 1, quantity: 0 })],
    [line('a', { targetGrossMargin: 50, costWeight: 1, unitPrice: Infinity })],
    [line('a', { targetGrossMargin: 50, costWeight: 1e13 })],
  ];
  for (const input of cases) {
    const result = allocateLinePricing(input, 100, 0);
    assert.equal(result.lines, input);
    assert.ok(result.errors.length);
  }
  const input = [line('a', { targetGrossMargin: 50, costWeight: 1 })];
  for (const [cost, share] of [
    [-1, 0],
    [Infinity, 0],
    [1, NaN],
    [1, 101],
    [1, 50],
    [1e12, 49],
  ]) {
    const result = allocateLinePricing(input, cost, share);
    assert.equal(result.lines, input);
    assert.ok(result.errors.length);
  }
  const overflow = allocateLinePricing(
    [line('a', { quantity: 0.0001, targetGrossMargin: 50, costWeight: 1 })],
    1e10,
    0,
  );
  assert.ok(overflow.errors.length);
});

test('domain sums independent lines and calculates whole-quote GP while retaining the old GP allocation contract', () => {
  const settings = {
    ...initialPricingSettings,
    lineMode: 'manual',
    lineSourceMode: 'scope',
    manualPricingBasis: 'line-gp',
    targetGrossMargin: 95,
    manualTargetPrice: 9999,
    discount: 10,
    manualLines: [
      line('a', {
        costWeight: 1,
        targetGrossMargin: 50,
        costScopeKeys: ['scope:equipment delivery'],
      }),
      line('b', { costWeight: 3, targetGrossMargin: 75 }),
    ],
  };
  const independent = calculatePricing(100, settings);
  assert.deepEqual(independent.errors, []);
  assert.equal(independent.listPrice, 350);
  assert.equal(independent.quoteBeforeTax, 340);
  assert.equal(independent.grossMarginPercent, (240 / 340) * 100);
  assert.deepEqual(
    independent.allocatedManualLines.map((entry) => entry.unitPrice),
    [50, 300],
  );
  const legacy = calculatePricing(100, {
    ...initialPricingSettings,
    lineMode: 'manual',
    manualPricingBasis: 'gp',
    manualLines: [line('a'), line('b')],
  });
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.listPrice, 200);
  assert.deepEqual(
    legacy.allocatedManualLines.map((entry) => entry.unitPrice),
    [100, 100],
  );
  assert.equal(
    calculatePricing(100, {
      ...settings,
      manualPricingBasis: undefined,
      manualTargetPrice: undefined,
    }).listPrice,
    0,
  );
});

test('API persistence and customer workbook use effective independent prices without exporting internal fields', async () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const id = 'LINE-GP-TEST';
    createProject(repository, {
      id,
      name: 'Independent quotation',
      client: 'Fixture Client',
    });
    const update = (module, section, changes) =>
      updateResource(
        repository,
        id,
        module,
        { section, ...(module === 'cost' ? { version: 'V1' } : {}) },
        changes,
        repository.get(id).revision,
      );
    update('cost', 'rows', {
      upsert: [
        {
          id: 'placeholder',
          scope: 'Equipment delivery',
          bu: 'Delivery',
          reTypeId: 'rt-local-l1',
          inputMode: 'mandays',
          mdPerSite: 0,
          years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket) => ({
            bucket,
            sites: 0,
            mandays: 0,
            cost: 0,
          })),
        },
      ],
    });
    update('cost', 'settings', {
      set: {
        rateSettings: {
          quoteAsOf: '2026-09-24',
          tdStart: '2026-10-01',
          tdEnd: '2026-12-31',
          baseYear: 2026,
        },
        manualCosts: { localPurchasedEquipment: 100, otherServiceRate: 0 },
        state: 'Confirmed',
      },
    });
    const pricing = {
      ...initialPricingSettings,
      lineMode: 'manual',
      lineSourceMode: 'item',
      manualPricingBasis: 'line-gp',
      manualLines: [
        line('a', { costWeight: 1, targetGrossMargin: 50 }),
        line('b', { costWeight: 3, targetGrossMargin: 75 }),
      ],
    };
    pricing.customLinesDraft = structuredClone(pricing.manualLines);
    update('quote', 'settings', { set: { pricing } });
    const saved = repository.get(id);
    assert.equal(saved.workspace.pricing.manualPricingBasis, 'line-gp');
    assert.equal(saved.workspace.pricing.lineSourceMode, 'item');
    assert.deepEqual(saved.workspace.pricing.manualLines, pricing.manualLines);
    assert.deepEqual(
      saved.workspace.pricing.customLinesDraft,
      pricing.customLinesDraft,
    );
    const input = validatedQuoteInput(saved.workspace, 'Q-INDEPENDENT');
    assert.equal(input.pricing.listPrice, 350);
    assert.deepEqual(
      input.lines.map((entry) => entry.amount),
      [50, 300],
    );
    for (const entry of input.lines)
      assert.deepEqual(Object.keys(entry).sort(), [
        'amount',
        'description',
        'id',
        'quantity',
        'unit',
        'unitPrice',
      ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildQuoteWorkbookBuffer(input));
    const text = JSON.stringify(workbook.model);
    assert.match(text, /Service a/);
    assert.doesNotMatch(
      text,
      /costWeight|costScopeKeys|customLinesDraft|targetGrossMargin|allocationWeight|priceFixed/,
    );
    assert.deepEqual(
      repository.get(id).workspace.pricing,
      saved.workspace.pricing,
    );
    assert.throws(
      () =>
        update('quote', 'settings', {
          set: {
            pricing: {
              ...pricing,
              manualLines: [line('bad', { costWeight: -1 })],
            },
          },
        }),
      /minimum|>=/,
    );
    assert.equal(repository.get(id).revision, saved.revision);
  } finally {
    repository.close();
  }
});
