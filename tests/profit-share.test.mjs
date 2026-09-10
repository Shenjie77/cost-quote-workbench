import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatePricing,
  validatePricingSettings,
} from '../features/quote/domain.ts';
import {
  allocateMoneyByWeights,
  calculateBuCostAllocation,
  normalizeBu,
  validateProfitShareRates,
} from '../features/quote/profit-share.ts';

const rate = (bu, ratePercent, active = true) => ({
  id: `share-${bu}`,
  bu,
  ratePercent,
  active,
});
const pricing = (rates, extra = {}) => ({
  targetGrossMargin: 30,
  discount: 0,
  gstPercent: 0,
  profitShareRates: rates,
  ...extra,
});
const resource = (id = 'local', pool = 'LOCAL', extra = {}) => ({
  id,
  code: id,
  name: id,
  category: 'internal',
  pool,
  level: 'L1',
  mandayRate: 99999,
  mandaysPerMonth: 20,
  hoursPerManday: 8,
  hqTravel: pool === 'HQ',
  active: true,
  effectiveFrom: '',
  effectiveTo: '',
  ...extra,
});
const row = (id, bu, cost, reTypeId = 'local', mandays = 1) => ({
  id,
  scope: id,
  bu,
  reTypeId,
  inputMode: 'mandays',
  mdPerSite: 0,
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket, i) => ({
    bucket,
    cost: i === 0 ? cost : 0,
    mandays: i === 0 ? mandays : 0,
    sites: 0,
  })),
});
const snapshot = (rows = [], overrides = {}) => ({
  costRows: rows,
  resourceTypes: [
    resource(),
    resource('hq', 'HQ'),
    resource('legacy-subcon', null, { category: 'subcontract' }),
  ],
  travelSettings: {
    enabled: false,
    monthlyAllowance: 0,
    airfarePerTrip: 0,
    trips: 0,
  },
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
});
const line = (id, bu, unitPrice, quantities) => ({
  id,
  bu,
  code: id,
  description: id,
  unit: 'pcs',
  currency: 'SGD',
  unitPrice,
  quantities,
});

test('user example: price 100, cost 50 and 20% share produce 30% sales GP and reverse target price 100', () => {
  const allocation = calculateBuCostAllocation(
    snapshot([row('a', 'Network', 50)]),
  );
  const result = calculatePricing(
    50,
    pricing([rate('Network', 20)]),
    allocation,
  );
  assert.equal(result.listPrice, 100);
  assert.equal(result.quoteBeforeTax, 100);
  assert.equal(result.profitShareAmount, 20);
  assert.equal(result.salesGrossProfit, 30);
  assert.equal(result.grossMarginPercent, 30);
  assert.equal(result.weightedProfitShareRate, 20);
  assert.equal(result.valid, true);
  assert.deepEqual(
    validatePricingSettings(pricing([rate('Network', 20)]), 50, allocation),
    [],
  );
});

test('weighted BU share uses final cost proportions, including all overhead assigned to largest BU', () => {
  const data = snapshot([row('a', 'Network', 30), row('b', 'Cloud', 20)]);
  data.manualCosts.riskContingency = 10;
  data.manualCosts.otherService = 10;
  const allocation = calculateBuCostAllocation(data);
  assert.deepEqual(allocation.entries, [
    { bu: 'Network', cost: 50, directCost: 30, unassignedCost: 20 },
    { bu: 'Cloud', cost: 20, directCost: 20, unassignedCost: 0 },
  ]);
  assert.equal(allocation.totalCost, 70);
  const result = calculatePricing(
    70,
    pricing([rate('Network', 20), rate('Cloud', 10)]),
    allocation,
  );
  assert.ok(Math.abs(result.weightedProfitShareRate - 120 / 7) < 1e-10);
  assert.equal(result.listPrice, 132.45);
  assert.equal(result.profitShareAmount, 22.71);
  assert.equal(result.salesGrossProfit, 39.74);
  assert.ok(result.grossMarginPercent >= 30);
  assert.ok(Math.abs(result.grossMarginPercent - 30) < 0.01);
});

test('all statement leaves and structured site BOQs reconcile without adding unmapped or experimental rows', () => {
  const data = snapshot([
    row('local-a', 'A', 30),
    row('blank', '', 2),
    row('legacy', 'B', 5, 'legacy-subcon'),
    row('orphan', 'Bogus', 999, 'missing'),
  ]);
  data.manualCosts = {
    localPurchasedEquipment: 1,
    inlandLogistics: 2,
    countryWarehousing: 3,
    nonInHouseLabour: 4,
    settlement: 5,
    carFee: 6,
    otherService: 7,
    riskContingency: 8,
  };
  data.subcontractCost = {
    mode: 'site-types',
    lines: [line('project', 'B', 10, [1, 0, 0, 0, 0])],
    siteTypes: [
      {
        id: 'site',
        name: 'Large',
        sites: [1, 2, 0, 0, 0],
        lines: [{ ...line('site-line', 'B', 10, []), quantityPerSite: 2 }],
      },
    ],
  };
  data.travelRows = [
    {
      bu: 'Bogus',
      baseUnitRate: 1000,
      quantities: [100, 0, 0, 0, 0],
      treatment: 'included',
    },
  ];
  const result = calculateBuCostAllocation(data);
  assert.equal(result.totalCost, 143);
  assert.equal(result.largestBu, 'B');
  assert.equal(result.unassignedCost, 38);
  assert.deepEqual(result.entries, [
    { bu: 'B', cost: 113, directCost: 75, unassignedCost: 38 },
    { bu: 'A', cost: 30, directCost: 30, unassignedCost: 0 },
  ]);
  assert.equal(
    result.entries.reduce((sum, entry) => sum + entry.cost, 0),
    result.totalCost,
  );
});

test('HQ travel follows actual HQ BU effort and controls; EHS percentage derives from final labour total', () => {
  const data = snapshot([
    row('a', 'A', 100, 'hq', 20),
    row('b', 'B', 100, 'hq', 60),
  ]);
  data.travelSettings = {
    enabled: true,
    monthlyAllowance: 10,
    airfarePerTrip: 20,
    trips: 1,
  };
  data.manualCosts.otherServiceRate = 0.01;
  const result = calculateBuCostAllocation(data);
  assert.equal(result.totalCost, 262.6);
  assert.deepEqual(result.entries, [
    { bu: 'B', cost: 147.6, directCost: 145, unassignedCost: 2.6 },
    { bu: 'A', cost: 115, directCost: 115, unassignedCost: 0 },
  ]);
  data.travelSettings.enabled = false;
  assert.equal(calculateBuCostAllocation(data).totalCost, 202);
});

test('largest-BU ties use normalized BU order and stay stable after row reordering', () => {
  const data = snapshot([
    row('z', 'Zulu', 10),
    row('b', 'beta', 5),
    row('a', ' Beta ', 5),
  ]);
  data.manualCosts.riskContingency = 1;
  const first = calculateBuCostAllocation(data);
  const second = calculateBuCostAllocation({
    ...data,
    costRows: [...data.costRows].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.largestBu, 'Beta');
  assert.deepEqual(first.entries[0], {
    bu: 'Beta',
    cost: 11,
    directCost: 10,
    unassignedCost: 1,
  });
});

test('blank-BU rows and all-unassigned projects never select an arbitrary catalog BU', () => {
  const data = snapshot([row('a', 'unallocated', 20)]);
  data.manualCosts.riskContingency = 30;
  const allocation = calculateBuCostAllocation(data);
  assert.equal(allocation.largestBu, null);
  assert.deepEqual(allocation.entries, [
    { bu: 'Unassigned', cost: 50, directCost: 0, unassignedCost: 50 },
  ]);
  const result = calculatePricing(
    50,
    pricing([rate('Network', 20), rate('Unassigned', 99)]),
    allocation,
  );
  assert.equal(result.weightedProfitShareRate, 0);
  assert.equal(result.profitShareAmount, 0);
  assert.ok(
    result.warnings.some((warning) => /No cost has a BU/.test(warning)),
  );
  assert.equal(result.valid, true);
});

test('existing BU placeholder labels are overhead, never the largest real BU', () => {
  const data = snapshot([
    row('real', 'Network', 1),
    row('placeholder', 'Unassigned BU', 100),
    row('select', 'Select BU', 100),
    row('dash', '-', 100),
  ]);
  const allocation = calculateBuCostAllocation(data);
  assert.equal(allocation.largestBu, 'Network');
  assert.deepEqual(allocation.entries, [
    { bu: 'Network', cost: 301, directCost: 1, unassignedCost: 300 },
  ]);
});

test('BU rate matching ignores whitespace/case and inactive or missing entries show zero-rate assumptions', () => {
  assert.equal(normalizeBu(' Cloud  BU \n'), 'CLOUD BU');
  const allocation = calculateBuCostAllocation(
    snapshot([row('a', 'cloud BU', 30), row('b', 'Network', 20)]),
  );
  const result = calculatePricing(
    50,
    pricing([rate(' CLOUD   bu ', 20), rate('Network', 50, false)]),
    allocation,
  );
  assert.equal(result.weightedProfitShareRate, 12);
  assert.deepEqual(result.missingBUs, ['Network']);
  assert.ok(result.warnings.some((warning) => /Network.*0%/.test(warning)));
});

test('discount reduces pre-tax revenue and actual sales GP while tax stays outside share', () => {
  const allocation = calculateBuCostAllocation(snapshot([row('a', 'A', 50)]));
  const result = calculatePricing(
    50,
    pricing([rate('A', 20)], { discount: 10, gstPercent: 9 }),
    allocation,
  );
  assert.equal(result.listPrice, 100);
  assert.equal(result.quoteBeforeTax, 90);
  assert.equal(result.profitShareAmount, 18);
  assert.equal(result.salesGrossProfit, 22);
  assert.equal(result.grossMarginPercent.toFixed(2), '24.44');
  assert.equal(result.gstAmount, 8.1);
  assert.equal(result.quoteAfterTax, 98.1);
});

test('rounded allocation amounts sum to the quote and total share', () => {
  const allocation = calculateBuCostAllocation(
    snapshot([row('a', 'A', 0.01), row('b', 'B', 0.01), row('c', 'C', 0.01)]),
  );
  const result = calculatePricing(
    0.03,
    pricing([rate('A', 10), rate('B', 20), rate('C', 30)]),
    allocation,
  );
  assert.equal(result.listPrice, 0.08);
  assert.equal(result.profitShareAmount, 0.02);
  assert.equal(
    Math.round(
      result.profitShareBreakdown.reduce(
        (sum, entry) => sum + entry.allocatedRevenue,
        0,
      ) * 100,
    ),
    8,
  );
  assert.equal(
    Math.round(
      result.profitShareBreakdown.reduce(
        (sum, entry) => sum + entry.profitShareAmount,
        0,
      ) * 100,
    ),
    2,
  );
  assert.deepEqual(allocateMoneyByWeights(0.01, [1, 1, 1]), [0.01, 0, 0]);
});

test('reverse target price meets sales GP after the share amount rounds to cents', () => {
  const allocation = calculateBuCostAllocation(snapshot([row('a', 'A', 1)]));
  const settings = pricing([rate('A', 20)], { targetGrossMargin: 33 });
  const result = calculatePricing(1, settings, allocation);
  // Algebra alone rounds to 2.13, whose 0.43 share leaves only 32.86% GP.
  assert.equal(result.listPrice, 2.14);
  assert.equal(result.profitShareAmount, 0.43);
  assert.ok(result.grossMarginPercent >= 33);
  const discounted = calculatePricing(
    1,
    { ...settings, discount: 0.01 },
    allocation,
  );
  assert.equal(discounted.listPrice, 2.14);
  assert.equal(discounted.quoteBeforeTax, 2.13);
  assert.ok(discounted.grossMarginPercent < 33);
});

test(
  'near-100% target plus share uses a bounded correction and keeps finite results',
  { timeout: 1000 },
  () => {
    const allocation = calculateBuCostAllocation(
      snapshot([row('a', 'A', 0.01)]),
    );
    const settings = pricing([rate('A', 4.9999999)], { targetGrossMargin: 95 });
    const result = calculatePricing(0.01, settings, allocation);
    assert.equal(result.valid, true);
    assert.ok(result.grossMarginPercent + 1e-8 >= 95);
    assert.ok(Number.isFinite(result.listPrice));
    assert.ok(result.listPrice < 30_000_000);
    // Requests beyond the supported monetary range fail instead of looping.
    const beyond = calculatePricing(
      0.01,
      pricing([rate('A', 4.999999999999)], { targetGrossMargin: 95 }),
      allocation,
    );
    assert.equal(beyond.valid, false);
    assert.ok(beyond.errors.some((error) => /supported range/.test(error)));
    assert.ok(Number.isFinite(beyond.quoteBeforeTax));
  },
);

test('impossible sales-GP denominators block output with finite previews', () => {
  const allocation = calculateBuCostAllocation(snapshot([row('a', 'A', 50)]));
  for (const target of [80, 90]) {
    const settings = pricing([rate('A', 20)], { targetGrossMargin: target });
    const result = calculatePricing(50, settings, allocation);
    assert.equal(result.valid, false);
    assert.ok(
      validatePricingSettings(settings, 50, allocation).some((error) =>
        /less than 100%/.test(error),
      ),
    );
    for (const value of Object.values(result))
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
});

test('invalid rates, duplicate normalized BUs/IDs, and non-finite values cannot silently price a quote', () => {
  const allocation = calculateBuCostAllocation(snapshot([row('a', 'A', 50)]));
  const invalid = [
    null,
    {},
    [null],
    [rate('', 20)],
    [rate('A', -1)],
    [rate('A', 101)],
    [rate('A', NaN)],
    [rate('A', Infinity)],
    [{ ...rate('A', 20), ratePercent: '20' }],
    [rate('A', 20), rate(' a ', 30)],
    [rate('A', 20), { ...rate('B', 10), id: 'share-A' }],
    [{ ...rate('A', 20), active: 'yes' }],
  ];
  for (const rates of invalid) {
    assert.ok(validateProfitShareRates(rates).length > 0);
    const result = calculatePricing(50, pricing(rates), allocation);
    assert.equal(result.valid, false);
    assert.ok(Number.isFinite(result.listPrice));
    assert.ok(Number.isFinite(result.grossMarginPercent));
  }
  for (const cost of [NaN, Infinity, -1, 1e308]) {
    const result = calculatePricing(cost, pricing([]));
    assert.equal(result.valid, false);
    for (const value of Object.values(result))
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
});

test('mismatched BU allocation cannot use an unrelated cost baseline', () => {
  const allocation = calculateBuCostAllocation(snapshot([row('a', 'A', 50)]));
  const result = calculatePricing(100, pricing([rate('A', 20)]), allocation);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /allocation must match/.test(error)));
});

test('legacy no-share and explicit zero-share pricing preserve target/discount/tax arithmetic', () => {
  const allocation = calculateBuCostAllocation(snapshot([row('a', 'A', 750)]));
  const legacy = calculatePricing(750, {
    targetGrossMargin: 25,
    discount: 100,
    gstPercent: 9,
  });
  const current = calculatePricing(
    750,
    pricing([rate('A', 0)], {
      targetGrossMargin: 25,
      discount: 100,
      gstPercent: 9,
    }),
    allocation,
  );
  for (const key of [
    'cost',
    'listPrice',
    'quoteBeforeTax',
    'gstAmount',
    'quoteAfterTax',
    'grossMarginPercent',
  ])
    assert.equal(current[key], legacy[key]);
  assert.equal(current.profitShareAmount, 0);
  assert.equal(current.salesGrossProfit, 150);
});

test('cost snapshots remain unchanged; stored yearly values are never recalculated from master rates', () => {
  const data = snapshot([row('a', 'A', 50)]);
  const original = structuredClone(data);
  assert.equal(calculateBuCostAllocation(data).totalCost, 50);
  assert.deepEqual(data, original);
});
