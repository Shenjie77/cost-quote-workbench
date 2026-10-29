import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateHQTravel,
  costRowsIncludingHQTravel,
  buildGroupCostSummary,
} from '../features/cost/group-cost-summary.ts';
import {
  getHQTravelSummary,
  getCostStatementValues,
  recalculateCostRows,
  roundMoney,
  totalRowCost,
} from '../features/cost/domain.ts';
import { buildSimpleCostWorkbook } from '../features/cost/export-simple-workbook.ts';
import { makeCostSnapshot } from './helpers.mjs';

function fixture() {
  const s = makeCostSnapshot();
  const hq = s.resourceTypes.find((r) => r.pool === 'HQ');
  const local = s.resourceTypes.find((r) => r.pool === 'LOCAL');
  s.resourceTypes.push({
    ...hq,
    id: 'different-conversion',
    code: 'HQ-TEST',
    mandaysPerMonth: 10,
  });
  hq.mandaysPerMonth = 20;
  s.travelSettings = {
    enabled: true,
    monthlyAllowance: 100,
    airfarePerTrip: 90,
    trips: 1,
  };
  s.costRows = [
    ['a', 'First', hq.id, [10, 0, 0, 0, 0]],
    ['b', 'Second', 'different-conversion', [0, 10, 0, 0, 0]],
    ['c', '', local.id, [10, 0, 0, 0, 0]],
  ].map(([id, groupName, reTypeId, md]) => ({
    id,
    groupName,
    scope: 'Scope',
    bu: 'MBB',
    reTypeId,
    inputMode: 'mandays',
    mdPerSite: 0,
    years: md.map((mandays, index) => ({
      bucket: `Y${index + 1}`,
      mandays,
      sites: 0,
      cost: 0,
    })),
  }));
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  s.manualCosts = {
    ...s.manualCosts,
    otherServiceRate: 0.01,
    riskContingency: 100,
    carFee: 5,
    settlement: 4,
    nonInHouseLabour: 3,
    inlandLogistics: 2,
    localPurchasedEquipment: 1,
  };
  s.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 's',
        code: '001',
        description: 'Package',
        bu: 'MBB',
        unit: 'lot',
        currency: 'SGD',
        unitPrice: 25,
        quantities: [2, 0, 0, 0, 0],
      },
    ],
  };
  return s;
}

test('HQ monthly allowance follows resource conversion while airfare follows effort across groups and years', () => {
  const s = fixture(),
    original = structuredClone(s);
  const allocation = allocateHQTravel(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
  );
  assert.deepEqual(allocation.get('a'), [95, 0, 0, 0, 0]);
  assert.deepEqual(allocation.get('b'), [0, 145, 0, 0, 0]);
  assert.deepEqual(allocation.get('c'), [0, 0, 0, 0, 0]);
  const display = costRowsIncludingHQTravel(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
  );
  assert.equal(
    totalRowCost(display[0]),
    roundMoney(totalRowCost(s.costRows[0]) + 95),
  );
  assert.deepEqual(s, original);
});

test('penny allocation reconciles with tiny effort, stable row order, disabled and empty HQ cases', () => {
  const s = fixture();
  s.travelSettings.monthlyAllowance = 0.01;
  s.travelSettings.airfarePerTrip = 0.01;
  s.costRows = Array.from({ length: 37 }, (_, index) => ({
    ...structuredClone(s.costRows[index % 2]),
    id: String(index),
  }));
  const a = allocateHQTravel(s.costRows, s.resourceTypes, s.travelSettings);
  assert.equal(
    roundMoney([...a.values()].flat().reduce((x, y) => x + y, 0)),
    getHQTravelSummary(s.costRows, s.resourceTypes, s.travelSettings).totalCost,
  );
  const reordered = allocateHQTravel(
    [...s.costRows].reverse(),
    s.resourceTypes,
    s.travelSettings,
  );
  for (const [id, values] of a) assert.deepEqual(reordered.get(id), values);
  for (const settings of [{ ...s.travelSettings, enabled: false }])
    assert.equal(
      [...allocateHQTravel(s.costRows, s.resourceTypes, settings).values()]
        .flat()
        .reduce((x, y) => x + y, 0),
      0,
    );
  assert.equal(allocateHQTravel([], s.resourceTypes, s.travelSettings).size, 0);
});

test('group and project rows reconcile to statement including EHS, risk, all manual leaves and legacy subcontract exactly once', () => {
  const s = fixture();
  const legacy = s.resourceTypes.find((r) => r.category === 'subcontract');
  s.costRows.push({
    ...structuredClone(s.costRows[0]),
    id: 'legacy',
    reTypeId: legacy.id,
  });
  const items = buildGroupCostSummary(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
    s.manualCosts,
    s.subcontractCost,
    2026,
  );
  const statement = getCostStatementValues(
    s.costRows,
    s.resourceTypes,
    240,
    s.manualCosts,
    s.subcontractCost,
    2026,
  );
  assert.equal(
    roundMoney(items.reduce((sum, item) => sum + item.total, 0)),
    statement.totalWithRisk,
  );
  assert.equal(
    items.find((item) => item.label === 'Unassigned Group').travel,
    0,
  );
  assert.equal(
    items.find((item) => item.label === 'Subcontract').total,
    statement.subcontract,
  );
  assert.equal(
    items.find((item) => item.label === 'Risk Contingency').total,
    100,
  );
  assert.equal(
    items.find((item) => item.label === 'EHS').total,
    roundMoney((statement.labour + statement.subcontract + 4) * 0.01),
  );
  assert.equal(
    roundMoney(items.reduce((sum, item) => sum + item.travel, 0)),
    240,
  );
});

test('grouped export writes annual subtotal formulas and reconciled Group sheet with travel included once', async () => {
  const s = fixture();
  const layout = {
    grouped: true,
    yearIndex: 'all',
    columns: ['scope', 'Y1:cost', 'Y2:cost', 'totalCost', 'action'],
  };
  const w = await buildSimpleCostWorkbook(s, layout);
  const detail = w.getWorksheet('Cost Detail');
  assert.equal(detail.getCell('B6').formula, 'SUM(B7:B7)');
  assert.equal(
    detail.getCell('B6').result,
    roundMoney(s.costRows[0].years[0].cost + 95),
  );
  assert.equal(
    detail.getCell('C9').result,
    roundMoney(s.costRows[1].years[1].cost + 145),
  );
  const summary = w.getWorksheet('Summary Group');
  const expected = getCostStatementValues(
    s.costRows,
    s.resourceTypes,
    240,
    s.manualCosts,
    s.subcontractCost,
    2026,
  ).totalWithRisk;
  assert.equal(summary.getCell(summary.rowCount, 11).result, expected);
  const single = await buildSimpleCostWorkbook(s, layout, ['Summary Group']);
  assert.deepEqual(
    single.worksheets.map((sheet) => sheet.name),
    ['Summary Group'],
  );
});
