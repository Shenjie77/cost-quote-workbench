import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../public/design-review/sample-data.js';
import {
  reviewData,
  reviewPricing,
  engine,
} from '../public/design-review/business/adapter.js';
import {
  buildCostStatementRows,
  getHQTravelSummary,
  roundMoney,
} from '../features/cost/domain.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { calculateBuCostAllocation } from '../features/quote/profit-share.ts';
const fixture = () => structuredClone(seed);
const total = (rows, key) => roundMoney(rows.reduce((s, r) => s + r[key], 0));
test('review report preserves all 18 template accounts and uses canonical cost calculations', () => {
  const state = fixture(),
    data = reviewData(state),
    s = data.snapshot;
  assert.deepEqual(
    data.statement,
    buildCostStatementRows(
      s.costRows,
      s.resourceTypes,
      getHQTravelSummary(s.costRows, s.resourceTypes, s.travelSettings)
        .totalCost,
      s.manualCosts,
      s.subcontractCost,
      2027,
    ),
  );
  assert.equal(data.statement.length, 18);
  assert.deepEqual(
    data.statement.filter((r) => r.code.startsWith('2.3.4')).map((r) => r.code),
    ['2.3.4', '2.3.4.1', '2.3.4.2'],
  );
  for (const row of data.statement)
    assert.equal(
      roundMoney(data.sections.reduce((s, c) => s + c.amounts[row.code], 0)),
      row.amount,
      row.code,
    );
  for (const [rows, key] of [
    [data.categories, 'total'],
    [data.groupRows, 'total'],
    [data.bu, 'cost'],
    [data.resource, 'cost'],
  ])
    assert.equal(total(rows, key), data.total);
});
test('manual project accounts, uncategorized lines and EHS remain reconciled in every view', () => {
  const s = fixture();
  s.groups[0].category = '';
  Object.assign(s.manual, {
    localPurchasedEquipment: 123.45,
    inlandLogistics: 20.11,
    countryWarehousing: 10.02,
    nonInHouseLabour: 50.01,
    settlement: 33.33,
    carFee: 70.07,
  });
  const d = reviewData(s),
    a = Object.fromEntries(d.statement.map((r) => [r.code, r.amount]));
  assert.equal(
    a['2.3.4.2'],
    roundMoney((a['2.3.1'] + a['2.3.2'] + a['2.3.3']) * 0.01),
  );
  assert.equal(a['2.3.4'], roundMoney(a['2.3.4.2'] + 70.07));
  assert.ok(d.sections.some((c) => c.category === ''));
  assert.ok(!d.groupRows.some((r) => r.label === 'Car Fee'));
  for (const row of d.statement)
    assert.equal(
      roundMoney(d.sections.reduce((sum, c) => sum + c.amounts[row.code], 0)),
      row.amount,
      row.code,
    );
  for (const rows of [d.bu, d.resource])
    assert.equal(total(rows, 'cost'), d.total);
});
test('risk edit changes the total and reset retains it using pre-risk weights', () => {
  const s = fixture(),
    before = reviewData(s);
  s.manual = engine.overrideCategoryRiskAmount(
    s.manual,
    before.categories.map((c) => ({ category: c.category, amount: c.risk })),
    'Mandatory',
    3000.01,
  );
  const edited = reviewData(s),
    risk = s.manual.riskContingency;
  s.manual.categoryRiskWeights = [];
  const reset = reviewData(s);
  assert.equal(total(reset.categories, 'risk'), risk);
  assert.equal(reset.total, edited.total);
  for (const c of reset.categories)
    assert.ok(
      Math.abs(c.risk - (risk * c.amounts['2']) / reset.statement[0].amount) <
        0.02,
    );
});
test('EHS override is explicit and restoring 1% preserves Car Fee', () => {
  const s = fixture();
  s.manual.carFee = 77;
  s.manual = engine.overrideOtherServiceCost(s.manual, 100);
  assert.equal(
    reviewData(s).statement.find((r) => r.code === '2.3.4').amount,
    177,
  );
  s.manual.otherServiceRate = 0.01;
  assert.equal(s.manual.carFee, 77);
  assert.notEqual(
    reviewData(s).statement.find((r) => r.code === '2.3.4').amount,
    177,
  );
});
test('review pricing matches production GP, BU weighting, rounding, discounts and zero GST', () => {
  const s = fixture(),
    d = reviewData(s),
    p = reviewPricing(s, d);
  const expected = calculatePricing(
    d.total,
    {
      targetGrossMargin: s.gp,
      discount: s.discount,
      gstPercent: 9,
      profitShareRates: s.profitShareRates,
    },
    calculateBuCostAllocation(d.snapshot),
  );
  for (const key of [
    'listPrice',
    'quoteAfterTax',
    'profitShareAmount',
    'grossMarginPercent',
    'weightedProfitShareRate',
    'gstAmount',
  ])
    assert.equal(p[key], expected[key], key);
  assert.equal(total(p.rows, 'net'), p.quoteAfterTax);
  assert.equal(total(p.rows, 'discount'), s.discount);
  assert.equal(p.valid, true);
  assert.ok(!p.rows.some((r) => r.label === 'Professional Service'));
});
test('manual and independent line GP modes preserve user prices and validate output', () => {
  const s = fixture();
  s.quoteMode = 'manual';
  s.prices = { Mandatory: 100000, Phase2: 25000, Optional: 45000 };
  assert.equal(reviewPricing(s).listPrice, 170000);
  s.gp = 80;
  assert.equal(reviewPricing(s).listPrice, 170000);
  s.quoteMode = 'line-gp';
  s.lineGp = { Mandatory: 40, Phase2: 30, Optional: 20 };
  assert.equal(reviewPricing(s).valid, true);
  s.discount = 1e10;
  assert.equal(reviewPricing(s).valid, false);
});
test('category discount descriptions stay independent of Section and resettable shares', () => {
  const s = fixture();
  s.descriptions.Phase2 = 'Second phase';
  s.sections.Phase2 = 'optional';
  s.discountShares = { Phase2: 50 };
  const p = reviewPricing(s);
  assert.equal(p.valid, true);
  const row = p.rows.find((r) => r.category === 'Phase2');
  assert.equal(row.description, 'Second phase');
  assert.equal(row.inclusion, 'optional');
  assert.equal(row.discount, 1000);
  s.discountShares = {};
  assert.notEqual(
    reviewPricing(s).rows.find((r) => r.category === 'Phase2').discount,
    1000,
  );
});
test('annual uplift, selected allowance and HQ travel use production rules without mutating inputs', () => {
  const s = fixture(),
    original = structuredClone(s),
    before = reviewData(s);
  assert.deepEqual(s, original);
  s.rateSettings.allowancePools = ['HQ'];
  assert.ok(reviewData(s).total > before.total);
  s.travelSettings.enabled = false;
  assert.equal(reviewData(s).travel.totalCost, 0);
  s.rateSettings.annualUplifts = [0, 0, 0, 0, 0];
  assert.ok(reviewData(s).total < before.total);
});

test('independent subcontract uplifts and five annual quantities reconcile with canonical statement', () => {
  const s = fixture();
  s.subcon[0].quantities = [1, 2, 3, 4, 5];
  s.subconRates = {
    baseYear: 2025,
    defaultUplift: 5,
    annualUplifts: [5, -2, 0, 3, 4],
  };
  const d = reviewData(s),
    factors = engine.getSubcontractRateFactors(s.subconRates, 2027);
  assert.ok(Math.abs(factors[0] - 1.1025) < 1e-10);
  const actual = engine.calculateSubcontractCost(
    d.snapshot.subcontractCost,
    2027,
  );
  assert.equal(
    d.statement.find((r) => r.code === '2.3.2').amount,
    actual.total,
  );
  s.rateSettings.annualUplifts = [99, 20, 30, 40, 50];
  const changed = reviewData(s);
  assert.equal(
    changed.statement.find((r) => r.code === '2.3.2').amount,
    actual.total,
  );
  for (const rows of [changed.bu, changed.resource])
    assert.equal(total(rows, 'cost'), changed.total);
});

test('site configuration adds annual costs once; zero-deployment copy adds none', () => {
  const s = fixture();
  const site = {
    id: 'site-a',
    name: 'A',
    sites: [2, 3, 0, 0, 0],
    lines: [
      {
        id: 'line-a',
        code: 'SC-A',
        description: 'Install',
        category: 'Phase2',
        bu: 'FBB',
        unit: 'pcs',
        currency: 'SGD',
        unitPrice: 200,
        quantityPerSite: 2,
      },
    ],
  };
  const baseline = reviewData(s).statement.find(
    (r) => r.code === '2.3.2',
  ).amount;
  s.siteTypes = [site];
  const result = reviewData(s);
  assert.equal(
    result.statement.find((r) => r.code === '2.3.2').amount,
    baseline + 2000,
  );
  s.siteTypes.push({
    ...structuredClone(site),
    id: 'site-b',
    sites: [0, 0, 0, 0, 0],
  });
  assert.equal(reviewData(s).total, result.total);
});

test('absent subcontract rate settings retain flat legacy prices independently of labour', () => {
  const s = fixture();
  delete s.subconRates;
  s.rateSettings.baseYear = 2020;
  s.rateSettings.annualUplifts = [10, 10, 10, 10, 10];
  assert.equal(
    reviewData(s).statement.find((r) => r.code === '2.3.2').amount,
    7800,
  );
});

test('CPQ uses confirmation and cost-basis invalidation rather than a quantity-times-price substitute', () => {
  const s = fixture(),
    ws = s.cpqWorkspace;
  ws.draft.selections = ws.catalog.slice(0, 3).map((item) => ({
    code: item.code,
    quantity: item.referenceQty,
    locked: true,
    weight: 1,
    reason: 'Sample',
  }));
  const baseline = { ...reviewData(s).snapshot, code: 'V1' };
  assert.throws(() => engine.solveCpq(ws, baseline), /Confirm/);
  const confirmed = engine.confirmMapping(ws, 'Reviewer');
  const result = engine.solveCpq(confirmed, baseline);
  assert.equal(result.totalCost, 7800);
  assert.equal(result.acceptable, true);
  confirmed.draft.result = result;
  baseline.manualCosts = { ...baseline.manualCosts, riskContingency: 9000 };
  assert.notEqual(result.inputKey, engine.calculationKey(confirmed, baseline));
  confirmed.draft.selections[0].quantity = 10;
  assert.throws(() => engine.solveCpq(confirmed, baseline), /Confirm/);
});

test('cost version copies isolate assumptions, site quantities and manual costs', async () => {
  const { captureCost, restoreCost } =
    await import('../public/design-review/business/review-versions.js');
  const s = fixture(),
    captured = captureCost(s),
    original = reviewData(s).total;
  s.rateSettings.annualUplifts[1] = 9;
  s.manual.riskContingency = 100;
  assert.equal(captured.rateSettings.annualUplifts[1], 5);
  restoreCost(s, captured);
  assert.equal(reviewData(s).total, original);
  s.rateSettings.annualUplifts[2] = 12;
  assert.equal(captured.rateSettings.annualUplifts[2], 5);
});

test('maintenance annual allocation uses original fractional-duration and integer-quantity validation', () => {
  const result = engine.calculateComponentMaintenance({
    startYear: 2027,
    coverageMonths: 12,
    archives: [],
    boq: [{ id: 'm', quantity: 2, ct: 100, spms: 20, durationYears: 1.5 }],
  });
  assert.equal(result.quote, 360);
  assert.deepEqual(result.annual, [
    { year: 2027, total: 240 },
    { year: 2028, total: 120 },
  ]);
  assert.throws(
    () =>
      engine.calculateComponentMaintenance({
        startYear: 2027,
        coverageMonths: 12,
        archives: [],
        boq: [{ id: 'm', quantity: 1.5, ct: 100, spms: 20, durationYears: 1 }],
      }),
    /whole number/,
  );
});

test('audit source references resolve and cover every original navigation area', async () => {
  const { parity } = await import('../public/design-review/parity.js');
  const { access } = await import('node:fs/promises');
  assert.equal(new Set(parity.map((r) => r[0])).size, parity.length);
  for (const row of parity)
    await access(new URL('../' + row[5], import.meta.url));
  for (const area of [
    'workspace',
    'rates',
    'subcon-rates',
    'quote-lines',
    'cpq',
    'maintenance',
    'workflow',
    'files',
    'drafts',
    'agent',
    'master',
    'delivery',
  ])
    assert.ok(parity.some((r) => r[0] === area));
});
