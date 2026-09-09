import assert from 'node:assert/strict';
import test from 'node:test';
import { recalculateCostRows } from '../features/cost/domain.ts';

test('labour recalculates when annual uplift changes while subcontract input remains intact', () => {
  const snapshot = makeCostSnapshot();
  snapshot.rateSettings.annualUplifts[0] = 10;
  const rows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  assert.equal(rows[0].years[0].cost, 228800);
  assert.equal(rows.at(-1).years[0].cost, 165000);
  assert.equal(snapshot.costRows[0].years[0].cost, 218400);
});

test('export validation rejects stale labour values and impossible timestamp dates', () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].years[0].cost = 1;
  snapshot.exportedAt = '2026-02-31T01:00:00.000Z';
  const errors = validateCostExportSnapshot(snapshot);
  assert.ok(
    errors.some(
      (issue) =>
        issue.code === 'LABOUR_COST_MISMATCH' &&
        issue.path === '/costRows/0/years/0/cost',
    ),
  );
  assert.ok(errors.some((issue) => issue.code === 'INVALID_EXPORTED_AT'));
});

import {
  buildReconciledCostDimensionSummary,
  calculatedYearCost,
  getCostStatementValues,
  getResourceRateConversions,
  roundMoney,
  YEAR_BUCKETS,
} from '../features/cost/domain.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { makeCostSnapshot } from './helpers.mjs';

test('money always rounds upward to two decimals', () => {
  assert.equal(roundMoney(18_848.282), 18_848.29);
  assert.equal(roundMoney(18_848.28), 18_848.28);
  assert.equal(roundMoney(0.001), 0.01);
});

test('delivery contract exposes Y1 through Y5 only', () => {
  assert.deepEqual(YEAR_BUCKETS, ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']);
});

test('RE Type provides MD-MM and MD-hour conversions', () => {
  const resource = makeCostSnapshot().resourceTypes.find(
    (item) => item.code === 'HQ-L1',
  );
  assert.deepEqual(getResourceRateConversions(resource), {
    perManday: 1800,
    perMonth: 39150,
    perHour: 225,
  });
});

test('internal annual cost uses sites × MD/site × RE rate × uplift', () => {
  const snapshot = makeCostSnapshot();
  const row = snapshot.costRows.find((item) => item.reTypeId === 'rt-hq-l3');
  assert.equal(
    calculatedYearCost(row, 0, snapshot.resourceTypes, snapshot.rateSettings),
    218400,
  );
});

test('RE Type summary and named statement costs reconcile', () => {
  const snapshot = makeCostSnapshot();
  snapshot.manualCosts.inlandLogistics = 5.001;
  const statement = getCostStatementValues(
    snapshot.costRows,
    snapshot.resourceTypes,
    2.001,
    snapshot.manualCosts,
  );
  const summary = buildReconciledCostDimensionSummary(
    snapshot.costRows,
    'resourceType',
    snapshot.resourceTypes,
    2.001,
    snapshot.manualCosts,
  );
  assert.equal(
    roundMoney(summary.reduce((sum, item) => sum + item.cost, 0)),
    statement.sales,
  );
  assert.equal(
    summary.some((item) => item.key === '__STATEMENT__:2.2.1'),
    true,
  );
});

test('runtime validation enforces RE Type structure and year order', () => {
  const invalidRate = makeCostSnapshot();
  invalidRate.resourceTypes[0].hoursPerManday = 0;
  assert.equal(
    validateCostExportSnapshot(invalidRate).some(
      (issue) => issue.code === 'INVALID_HOURS_PER_MANDAY',
    ),
    true,
  );

  const invalidBucket = makeCostSnapshot();
  invalidBucket.costRows[0].years[0].bucket = 'Y2';
  assert.equal(
    validateCostExportSnapshot(invalidBucket).some(
      (issue) => issue.code === 'INVALID_YEAR_BUCKET_ORDER',
    ),
    true,
  );
});
