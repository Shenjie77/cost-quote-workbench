/** Quote row generation reconciles sale prices while preserving historical pricing. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePricing } from '../features/quote/domain.ts';
import {
  buildQuoteLines,
  calculateManualQuoteLines,
  validateManualQuoteLines,
  validateQuoteLines,
} from '../features/quote/quote-lines.ts';
import { calculateBuCostAllocation } from '../features/quote/profit-share.ts';
import { quoteHistoryRecord } from '../features/quote/history-record.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';

/** Minimal immutable cost inputs keep line tests independent from saved project data. */
function snapshot(overrides = {}) {
  return {
    schemaVersion: '2.0.0',
    exportedAt: '2026-09-11T00:00:00Z',
    project: {
      id: 'TEST',
      name: 'Customer project',
      client: 'Customer',
      currency: 'SGD',
    },
    costVersion: { code: 'V1', status: 'Confirmed' },
    rateSettings: {
      quoteAsOf: '2026-09-11',
      tdStart: '2026-09-11',
      tdEnd: '2026-12-31',
      baseYear: 2026,
      defaultUplift: 0,
      annualUplifts: [0, 0, 0, 0, 0],
    },
    travelSettings: {
      enabled: false,
      monthlyAllowance: 0,
      airfarePerTrip: 0,
      trips: 0,
    },
    resourceTypes: [
      {
        id: 'r',
        code: 'R',
        name: 'Resource',
        category: 'internal',
        pool: 'LOCAL',
        level: 'L1',
        mandayRate: 10,
        mandaysPerMonth: 20,
        hoursPerManday: 8,
        hqTravel: false,
        active: true,
        effectiveFrom: '',
        effectiveTo: '',
      },
    ],
    costRows: [],
    manualCosts: {
      localPurchasedEquipment: 0,
      inlandLogistics: 0,
      countryWarehousing: 0,
      nonInHouseLabour: 0,
      settlement: 0,
      carFee: 0,
      otherService: 0,
      riskContingency: 0,
    },
    ...overrides,
  };
}

/** Captures distinct internal rows without exposing their IDs or rates in descriptions. */
function row(id, scope, cost, mandays = 1) {
  return {
    id,
    scope,
    bu: 'A',
    reTypeId: 'r',
    inputMode: 'mandays',
    mdPerSite: 0,
    years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket, i) => ({
      bucket,
      sites: 0,
      cost: i ? 0 : cost,
      mandays: i ? 0 : mandays,
    })),
  };
}
const terms = { targetGrossMargin: 25, discount: 0, gstPercent: 9 };
const manualLine = (extra = {}) => ({
  id: 'manual',
  description: 'Customer service',
  quantity: 1,
  unit: 'lot',
  unitPrice: 100,
  ...extra,
});

test('legacy single output and explicit single mode preserve all pricing results', () => {
  const base = calculatePricing(750, terms);
  for (const mode of ['single', 'scope', 'item'])
    assert.deepEqual(calculatePricing(750, { ...terms, lineMode: mode }), base);
  const input = snapshot({ costRows: [row('r1', 'Survey', 750)] });
  assert.deepEqual(
    buildQuoteLines(input, undefined, 1000),
    buildQuoteLines(input, 'single', 1000),
  );
  assert.equal(buildQuoteLines(input, 'single', 1000).length, 1);
});

test('Scope groups trim whitespace and casing; individual rows stay distinct and cents reconcile', () => {
  const input = snapshot({
    costRows: [
      row('a', ' Site survey ', 1),
      row('b', 'site   survey', 1),
      row('c', 'Installation', 1),
    ],
  });
  const before = structuredClone(input);
  const scope = buildQuoteLines(input, 'scope', 100);
  assert.deepEqual(
    scope.map(({ description, amount }) => ({ description, amount })),
    [
      { description: 'Site survey', amount: 66.67 },
      { description: 'Installation', amount: 33.33 },
    ],
  );
  const items = buildQuoteLines(input, 'item', 100);
  assert.deepEqual(
    items.map((line) => line.amount),
    [33.34, 33.33, 33.33],
  );
  assert.deepEqual(validateQuoteLines(items, 100), []);
  assert.deepEqual(input, before);
  for (const line of items)
    assert.deepEqual(Object.keys(line).sort(), [
      'amount',
      'description',
      'id',
      'quantity',
      'unit',
      'unitPrice',
    ]);
});

test('subcontract BOQs, manual services and HQ travel retain distinct descriptions with risk absorbed into sale prices', () => {
  const input = snapshot({ costRows: [row('hq', 'Commissioning', 100, 20)] });
  input.resourceTypes[0].pool = 'HQ';
  input.resourceTypes[0].hqTravel = true;
  input.travelSettings = {
    enabled: true,
    monthlyAllowance: 20,
    airfarePerTrip: 30,
    trips: 1,
  };
  input.manualCosts.inlandLogistics = 10;
  input.manualCosts.otherServiceRate = 0.1;
  input.manualCosts.riskContingency = 500;
  input.subcontractCost = {
    mode: 'site-types',
    lines: [
      {
        id: 's1',
        code: 'S1',
        description: 'Installation',
        bu: 'A',
        unit: 'lot',
        unitPrice: 20,
        currency: 'SGD',
        quantities: [1, 0, 0, 0, 0],
      },
    ],
    siteTypes: [
      {
        id: 'site',
        name: 'Type A',
        sites: [2, 0, 0, 0, 0],
        lines: [
          {
            id: 's2',
            code: 'S2',
            description: 'Cabling',
            bu: 'A',
            unit: 'm',
            unitPrice: 5,
            currency: 'SGD',
            quantityPerSite: 3,
          },
        ],
      },
    ],
  };
  const lines = buildQuoteLines(input, 'item', 1234.56);
  assert.deepEqual(
    lines.map((line) => line.description),
    [
      'Commissioning',
      'Installation',
      'Cabling',
      'Inland logistics',
      'Other services',
      'Travel services',
    ],
  );
  assert.deepEqual(validateQuoteLines(lines, 1234.56), []);
  assert.doesNotMatch(JSON.stringify(lines), /risk|mandays|mandayRate|cost|HQ/);
});

test('empty, zero-cost and risk-only projects still produce a reconciled quote', () => {
  const empty = snapshot();
  empty.manualCosts.riskContingency = 100;
  assert.deepEqual(
    validateQuoteLines(buildQuoteLines(empty, 'scope', 133.34), 133.34),
    [],
  );
  const free = snapshot({ costRows: [row('a', 'A', 0), row('b', 'B', 0)] });
  assert.deepEqual(
    buildQuoteLines(free, 'item', 0.01).map((line) => line.amount),
    [0.01, 0],
  );
  assert.deepEqual(validateQuoteLines(buildQuoteLines(free, 'item', 0), 0), []);
});

test('manual line quantity and price set total before existing discount, GST and profit share', () => {
  const input = snapshot({ costRows: [row('a', 'Service', 50)] });
  const pricing = calculatePricing(
    50,
    {
      ...terms,
      targetGrossMargin: 95,
      discount: 10,
      lineMode: 'manual',
      manualLines: [manualLine({ quantity: 2.5, unitPrice: 40 })],
      profitShareRates: [{ id: 'a', bu: 'A', ratePercent: 20, active: true }],
    },
    calculateBuCostAllocation(input),
  );
  assert.equal(pricing.valid, true, pricing.errors.join('; '));
  assert.equal(pricing.listPrice, 100);
  assert.equal(pricing.quoteBeforeTax, 90);
  assert.equal(pricing.gstAmount, 8.1);
  assert.equal(pricing.profitShareAmount, 18);
  assert.equal(pricing.salesGrossProfit, 22);
  assert.equal(pricing.grossMarginPercent, (22 / 90) * 100);
  assert.equal(
    calculateManualQuoteLines([
      manualLine({ quantity: 0.3333, unitPrice: 10.0001 }),
    ]).total,
    3.34,
  );
});

test('invalid manual drafts block export with finite previews and precision/ID checks', () => {
  for (const lines of [
    undefined,
    [],
    [manualLine({ description: ' ' })],
    [manualLine({ unit: '' })],
    [manualLine({ quantity: 0 })],
    [manualLine({ quantity: -1 })],
    [manualLine({ quantity: 0.12345 })],
    [manualLine({ unitPrice: 0.12345 })],
    [manualLine({ unitPrice: Infinity })],
    [manualLine({ unitPrice: NaN })],
    [manualLine({ quantity: 1e6, unitPrice: 1e12 })],
    [manualLine(), manualLine()],
    [null],
  ]) {
    assert.ok(validateManualQuoteLines(lines).length);
    const result = calculatePricing(50, {
      ...terms,
      lineMode: 'manual',
      manualLines: lines,
    });
    assert.equal(result.valid, false);
    assert.ok(Number.isFinite(result.listPrice));
  }
  assert.ok(
    calculateManualQuoteLines([
      manualLine({ unitPrice: 1e12 }),
      manualLine({ id: 'b', unitPrice: 1 }),
    ]).errors.length,
  );
  assert.ok(validateQuoteLines([{ ...manualLine(), amount: 99 }], 100).length);
  assert.deepEqual(
    validateManualQuoteLines([manualLine({ unitPrice: 0 })]),
    [],
  );
});

test('quotation history snapshots retain exact line values after later edits', () => {
  const lines = buildQuoteLines(snapshot(), 'single', 100);
  const input = {
    project: snapshot().project,
    quoteNumber: 'Q1',
    costVersion: 'V1',
    template: initialQuoteTemplates[0],
    assumptions: [],
    pricing: calculatePricing(75, terms),
    lines,
    lineMode: 'manual',
  };
  const record = quoteHistoryRecord(input, {
    path: 'test.xlsx',
    sha256: 'test-hash',
  });
  lines[0].description = 'Changed';
  lines[0].amount = 9;
  assert.equal(record.lineSnapshots[0].description, 'Customer project');
  assert.equal(record.lineSnapshots[0].amount, 100);
  assert.equal(record.lineMode, 'manual');
});
