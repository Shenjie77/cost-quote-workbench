import assert from 'node:assert/strict';
import test from 'node:test';
import {
  YEAR_BUCKETS,
  buildCostDimensionSummary,
  buildReconciledCostDimensionSummary,
  calculatedYearCost,
  getAllowancePools,
  getAllowanceResourceTypeIds,
  getCostStatementValues,
  isPersonnelAllowanceApplied,
  roundMoney,
  validatePersonnelAllowanceSelection,
} from '../features/cost/domain.ts';
import { makeCostSnapshot } from './helpers.mjs';

/** Creates a row with fractional effort/cost so rounding boundaries are observable. */
function makeRow(id, reTypeId, scope, mdPerSite, annualValues) {
  return {
    id,
    reTypeId,
    scope,
    bu: 'Operations',
    mdPerSite,
    years: YEAR_BUCKETS.map((bucket, index) => ({
      bucket,
      sites: annualValues[index]?.sites ?? 0,
      cost: annualValues[index]?.cost ?? 0,
    })),
  };
}

/** Creates mixed personnel, preserved legacy packages, an unmapped row and a BOQ leaf. */
function mixedCostFixture() {
  const snapshot = makeCostSnapshot();
  const internal = snapshot.resourceTypes.find(
    (resource) => resource.category === 'internal',
  );
  const subcontract = snapshot.resourceTypes.find(
    (resource) => resource.category === 'subcontract',
  );
  snapshot.resourceTypes = [internal, subcontract];
  snapshot.costRows = [
    makeRow('internal', internal.id, ' Shared ', 0.33335, [
      { sites: 1, cost: 0.001 },
      { sites: 1, cost: 0.001 },
    ]),
    makeRow('package', subcontract.id, 'Shared', 2, [
      { sites: 2, cost: 0.011 },
    ]),
    makeRow('unmapped', 'missing-resource', ' ', 1, [
      { sites: 3, cost: 0.009 },
    ]),
  ];
  snapshot.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'boq',
        code: 'BOQ',
        description: 'Shared',
        bu: 'Operations',
        unit: 'pcs',
        currency: 'SGD',
        unitPrice: 0.011,
        quantities: [2, 0, 0, 0, 0],
      },
    ],
  };
  return snapshot;
}

test('allowance validation preserves issue order and gives invalid repeated values precedence over duplicates', () => {
  const snapshot = makeCostSnapshot();
  const internal = snapshot.resourceTypes.find(
    (resource) => resource.category === 'internal',
  );
  const settings = {
    ...snapshot.rateSettings,
    allowancePools: ['UNKNOWN', 'UNKNOWN', 'HQ', 'HQ', null],
    allowanceResourceTypeIds: ['missing'],
  };
  const original = structuredClone(settings);
  assert.deepEqual(
    validatePersonnelAllowanceSelection(settings, snapshot.resourceTypes).map(
      ({ code, path }) => [code, path],
    ),
    [
      ['INVALID_ALLOWANCE_POOL', '/rateSettings/allowancePools/0'],
      ['INVALID_ALLOWANCE_POOL', '/rateSettings/allowancePools/1'],
      ['DUPLICATE_ALLOWANCE_POOL', '/rateSettings/allowancePools/3'],
      ['INVALID_ALLOWANCE_POOL', '/rateSettings/allowancePools/4'],
    ],
  );
  assert.deepEqual(settings, original);

  // Removing the authoritative pools activates the historical ID validation path.
  delete settings.allowancePools;
  settings.allowanceResourceTypeIds = [
    'missing',
    'missing',
    internal.id,
    internal.id,
    null,
  ];
  assert.deepEqual(
    validatePersonnelAllowanceSelection(settings, snapshot.resourceTypes).map(
      ({ code, path }) => [code, path],
    ),
    [
      [
        'INVALID_ALLOWANCE_RESOURCE',
        '/rateSettings/allowanceResourceTypeIds/0',
      ],
      [
        'INVALID_ALLOWANCE_RESOURCE',
        '/rateSettings/allowanceResourceTypeIds/1',
      ],
      [
        'DUPLICATE_ALLOWANCE_RESOURCE',
        '/rateSettings/allowanceResourceTypeIds/3',
      ],
      [
        'INVALID_ALLOWANCE_RESOURCE',
        '/rateSettings/allowanceResourceTypeIds/4',
      ],
    ],
  );
});

test('explicit malformed or empty pool selections never fall back to legacy settings', () => {
  const snapshot = makeCostSnapshot();
  const internal = snapshot.resourceTypes.find(
    (resource) => resource.category === 'internal',
  );
  for (const allowancePools of [[], null, 'HQ']) {
    const settings = {
      ...snapshot.rateSettings,
      allowancePools,
      allowanceResourceTypeIds: [internal.id],
      localArpAllowanceEnabled: true,
    };
    assert.deepEqual(getAllowancePools(settings, snapshot.resourceTypes), []);
    assert.deepEqual(
      getAllowanceResourceTypeIds(settings, snapshot.resourceTypes),
      [],
    );
    assert.equal(isPersonnelAllowanceApplied(internal, settings), false);
    assert.equal(
      validatePersonnelAllowanceSelection(settings, snapshot.resourceTypes)
        .length,
      Array.isArray(allowancePools) ? 0 : 1,
    );
  }
});

test('dimension groups round each leaf, keep first-contribution metadata and exclude BOQ quantities from effort', () => {
  const snapshot = mixedCostFixture();
  const before = structuredClone(snapshot);
  const groups = buildCostDimensionSummary(
    snapshot.costRows,
    'scope',
    snapshot.resourceTypes,
    snapshot.subcontractCost,
  );
  assert.deepEqual(groups, [
    {
      key: 'Shared',
      label: 'Shared',
      sites: 4,
      mandays: 4.6668,
      cost: 0.07,
      allocationStatus: 'ALLOCATED',
      resourceCategory: 'internal',
      shareRatio: 0.8750000000000001,
    },
    {
      key: 'UNSPECIFIED',
      label: 'UNSPECIFIED',
      sites: 3,
      mandays: 3,
      cost: 0.01,
      allocationStatus: 'ALLOCATED',
      resourceCategory: 'unmapped',
      shareRatio: 0.125,
    },
  ]);
  const resources = buildCostDimensionSummary(
    snapshot.costRows,
    'resourceType',
    snapshot.resourceTypes,
    snapshot.subcontractCost,
  );
  assert.deepEqual(
    resources.map((group) => [group.key, group.cost]),
    [
      ['__SUBCONTRACT__', 0.05],
      [snapshot.resourceTypes[0].id, 0.02],
      ['UNMAPPED', 0.01],
    ],
  );
  assert.deepEqual(snapshot, before);
});

test('duplicate captured resource IDs keep first-match semantics in costs and statement classification', () => {
  const snapshot = makeCostSnapshot();
  const row = snapshot.costRows[0];
  const original = snapshot.resourceTypes.find(
    (candidate) => candidate.id === row.reTypeId,
  );
  const duplicate = { ...original, category: 'subcontract', mandayRate: 0 };
  const resources = [original, duplicate];
  const expected = calculatedYearCost(
    row,
    0,
    [original],
    snapshot.rateSettings,
  );
  assert.equal(
    calculatedYearCost(row, 0, resources, snapshot.rateSettings),
    expected,
  );
  const baseline = getCostStatementValues(
    [row],
    [original],
    0,
    snapshot.manualCosts,
  );
  assert.deepEqual(
    getCostStatementValues([row], resources, 0, snapshot.manualCosts),
    baseline,
  );
  assert.equal(
    buildCostDimensionSummary([row], 'resourceType', resources)[0].key,
    original.id,
  );
});

test('summary sorting uses label ties and zero totals retain zero shares', () => {
  const rows = [
    makeRow('b', 'unknown', 'Beta', 0, []),
    makeRow('a', 'unknown', 'Alpha', 0, []),
  ];
  const groups = buildCostDimensionSummary(rows, 'scope', []);
  assert.deepEqual(
    groups.map(({ key, cost, shareRatio }) => ({ key, cost, shareRatio })),
    [
      { key: 'Alpha', cost: 0, shareRatio: 0 },
      { key: 'Beta', cost: 0, shareRatio: 0 },
    ],
  );
});

test('named statement summary omits nonpositive accounts and only adds positive risk on request', () => {
  const snapshot = makeCostSnapshot();
  const manualCosts = Object.fromEntries(
    Object.keys(snapshot.manualCosts).map((key) => [key, 0]),
  );
  manualCosts.inlandLogistics = -1;
  manualCosts.riskContingency = 0.001;
  const summarize = (includeRisk) =>
    buildReconciledCostDimensionSummary(
      [],
      'scope',
      [],
      0,
      manualCosts,
      undefined,
      { includeRisk },
    );
  assert.deepEqual(summarize(false), []);
  assert.deepEqual(summarize(true), [
    {
      key: '__STATEMENT__:15',
      label: '15 · Risk Contingency',
      sites: 0,
      mandays: 0,
      cost: 0.01,
      allocationStatus: 'UNALLOCATED',
      resourceCategory: 'unmapped',
      shareRatio: 1,
    },
  ]);
});

test('money normalization retains near-cent tolerance, negative rounding and nonfinite behavior', () => {
  assert.equal(roundMoney(100.00000000001), 100);
  assert.equal(roundMoney(100.00001), 100.01);
  assert.equal(roundMoney(-1.001), -1);
  assert.equal(Object.is(roundMoney(-0.001), -0), false);
  assert.equal(roundMoney(Infinity), Infinity);
  assert.ok(Number.isNaN(roundMoney(NaN)));
});
