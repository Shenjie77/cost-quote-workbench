import assert from 'node:assert/strict';
import test from 'node:test';
import {
  refreshCostQuoteLines,
  refreshScopeRiskShares,
} from '../features/quote/refresh-cost-lines.ts';
import { allocateScopeRisk } from '../features/quote/scope-allocation.ts';
import {
  allocateLinePricing,
  lineCostAmounts,
} from '../features/quote/line-pricing.ts';

const old = (id, description, category, extra = {}) => ({
  id,
  description,
  category,
  quantity: 1,
  unit: 'lot',
  unitPrice: 100,
  costWeight: 50,
  targetGrossMargin: 50,
  ...extra,
});
const fresh = (id, description, category, amount) => ({
  id,
  description,
  category,
  quantity: 1,
  unit: 'lot',
  unitPrice: amount,
  amount,
});

test('explicit refresh retires vanished Risk keys and normalizes remaining reservations after a merge', () => {
  const shares = [
    { key: 'scope:a', percentage: 40 },
    { key: 'scope:b', percentage: 60 },
  ];
  const scopes = [{ key: 'scope:a', amount: 100 }];
  assert.notEqual(allocateScopeRisk(scopes, 20, shares).errors.length, 0);
  const refreshed = refreshScopeRiskShares(shares, scopes);
  assert.deepEqual(refreshed, [{ key: 'scope:a', percentage: 100 }]);
  assert.deepEqual(allocateScopeRisk(scopes, 20, refreshed).errors, []);
  assert.deepEqual(shares, [
    { key: 'scope:a', percentage: 40 },
    { key: 'scope:b', percentage: 60 },
  ]);
  const added = [...scopes, { key: 'scope:new', amount: 100 }];
  const retained = refreshScopeRiskShares(shares, added);
  assert.deepEqual(retained, [{ key: 'scope:a', percentage: 40 }]);
  assert.deepEqual(
    allocateScopeRisk(added, 20, retained).scopes.map(
      (scope) => scope.riskAmount,
    ),
    [8, 12],
  );
  assert.deepEqual(
    refreshScopeRiskShares([{ key: 'scope:a', percentage: 0 }], scopes),
    [],
  );
  assert.equal(refreshScopeRiskShares(undefined, scopes), undefined);
});

test('refresh matches category plus description before fallback, preserving pricing, remarks and overrides under reordered IDs', () => {
  const previous = [
    old('a', 'Install', 'Equipment', { targetGrossMargin: 60 }),
    old('b', 'Install', 'Service', {
      quantity: 2,
      unit: 'job',
      unitPrice: 75,
      priceFixed: true,
    }),
  ];
  const pricing = {
    lineRemarks: {
      a: 'GP rationale',
      b: 'Locked customer price',
      unrelated: 'Keep',
    },
    lineGroups: {
      a: { category: 'Customer supplied', inclusion: 'optional' },
      unrelated: { category: 'Maintenance', inclusion: 'mandatory' },
    },
  };
  const before = structuredClone({ previous, pricing });
  const result = refreshCostQuoteLines(
    previous,
    [
      fresh('new-b', 'Install', 'Service', 40),
      fresh('new-a', 'Install', 'Equipment', 60),
    ],
    pricing,
  );
  assert.equal(result.matched, 2);
  assert.equal(result.lines[0].priceFixed, true);
  assert.equal(result.lines[0].unitPrice, 75);
  assert.equal(result.lines[0].quantity, 2);
  assert.equal(result.lines[1].targetGrossMargin, 60);
  assert.deepEqual(lineCostAmounts(result.lines, 100), [40, 60]);
  assert.equal(result.lineRemarks['new-a'], 'GP rationale');
  assert.equal(result.lineRemarks.a, undefined);
  assert.equal(result.lineRemarks.unrelated, 'Keep');
  assert.equal(result.lineGroups['new-a'].category, 'Customer supplied');
  assert.ok(result.lineGroups.unrelated);
  const calculated = allocateLinePricing(result.lines, 100, 0);
  assert.deepEqual(calculated.errors, []);
  assert.equal(calculated.total, 300);
  assert.deepEqual({ previous, pricing }, before);
});

test('one-to-one category changes retain commercial settings, while split and merged sources use GP45 without guessing metadata', () => {
  const before = [old('old', 'Design', undefined, { targetGrossMargin: 65 })];
  const pricing = { lineRemarks: { old: 'Original' } };
  const renamed = refreshCostQuoteLines(
    before,
    [fresh('new', 'Design', 'Engineering', 100)],
    pricing,
  );
  assert.equal(renamed.lines[0].category, 'Engineering');
  assert.equal(renamed.lines[0].targetGrossMargin, 65);
  assert.equal(renamed.lineRemarks.new, 'Original');
  const split = refreshCostQuoteLines(
    before,
    [
      fresh('a', 'Design', 'Equipment', 50),
      fresh('b', 'Design', 'Service', 50),
    ],
    pricing,
  );
  assert.equal(split.matched, 0);
  assert.equal(split.newCount, 2);
  assert.equal(split.removedCount, 1);
  assert.deepEqual(
    split.lines.map((line) => line.targetGrossMargin),
    [45, 45],
  );
  assert.deepEqual(split.lineRemarks, {});
  const merged = refreshCostQuoteLines(
    [old('a', 'Design', 'Equipment'), old('b', 'Design', 'Service')],
    [fresh('new', 'Design', 'All', 100)],
    {},
  );
  assert.equal(merged.matched, 0);
  assert.equal(merged.lines[0].targetGrossMargin, 45);
  const stale = refreshCostQuoteLines(
    before,
    [fresh('new', 'Another scope', 'New', 100)],
    {
      lineRemarks: { new: 'Old deleted quote remark' },
      lineGroups: { new: { category: 'Stale', inclusion: 'mandatory' } },
    },
  );
  assert.deepEqual(stale.lineRemarks, {});
  assert.deepEqual(stale.lineGroups, {});
});
