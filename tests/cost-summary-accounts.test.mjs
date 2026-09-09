import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  buildSubcontractScopeSummary,
  getCostSummaryStatementCode,
  getHQTravelSummary,
  roundMoney,
  totalRowCost,
} from '../features/cost/domain.ts';
import { buildSimpleCostWorkbookBytes } from '../features/cost/export-simple-workbook.ts';
import { makeCostSnapshot } from './helpers.mjs';

const fixture = () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].scope = 'Router installation';
  snapshot.costRows[0].bu = 'Network';
  snapshot.manualCosts = {
    ...snapshot.manualCosts,
    localPurchasedEquipment: 123.45,
    inlandLogistics: 11.01,
    countryWarehousing: 9.02,
    nonInHouseLabour: 77.09,
    settlement: 42.03,
    carFee: 3.11,
    otherService: 999999,
    otherServiceRate: 0.01,
    riskContingency: 555.05,
  };
  const line = {
    id: 'install',
    code: 'SUB-INSTALL',
    description: 'Router installation',
    bu: 'Network',
    unit: 'pcs',
    currency: 'SGD',
    unitPrice: 200,
  };
  snapshot.subcontractCost = {
    mode: 'site-types',
    lines: [{ ...line, quantities: [1, 0, 0, 0, 0] }],
    siteTypes: [
      {
        id: 'branch',
        name: 'Branch',
        sites: [2, 0, 3, 0, 0],
        lines: [{ ...line, quantityPerSite: 2 }],
      },
    ],
  };
  return snapshot;
};
const statement = (snapshot, travel = 2.001) =>
  new Map(
    buildCostStatementRows(
      snapshot.costRows,
      snapshot.resourceTypes,
      travel,
      snapshot.manualCosts,
      snapshot.subcontractCost,
    ).map((row) => [row.code, row]),
  );

test('Named EHS, Logistics and Risk accounts reference statement subtotals once in every dimension', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  const accounts = statement(snapshot);
  const codes = [
    '2.1.2',
    '2.2.1',
    '2.3.1.2',
    '2.3.1.3',
    '2.3.3',
    '2.3.4',
    '15',
  ];
  assert.equal(accounts.get('2.2.1').amount, 20.03);
  assert.equal(
    accounts.get('2.3.4').amount,
    roundMoney(3.11 + accounts.get('2.3.4.2').amount),
  );
  for (const dimension of ['scope', 'bu', 'resourceType']) {
    const sales = buildReconciledCostDimensionSummary(
      snapshot.costRows,
      dimension,
      snapshot.resourceTypes,
      2.001,
      snapshot.manualCosts,
      snapshot.subcontractCost,
    );
    const total = buildReconciledCostDimensionSummary(
      snapshot.costRows,
      dimension,
      snapshot.resourceTypes,
      2.001,
      snapshot.manualCosts,
      snapshot.subcontractCost,
      { includeRisk: true },
    );
    assert.equal(
      roundMoney(sales.reduce((sum, row) => sum + row.cost, 0)),
      accounts.get('2').amount,
    );
    assert.equal(
      roundMoney(total.reduce((sum, row) => sum + row.cost, 0)),
      accounts.get('').amount,
    );
    assert.ok(
      Math.abs(total.reduce((sum, row) => sum + row.shareRatio, 0) - 1) < 1e-12,
    );
    assert.ok(
      !sales.some((row) => getCostSummaryStatementCode(row.key) === '15'),
    );
    for (const code of codes) {
      const rows = total.filter(
        (row) => getCostSummaryStatementCode(row.key) === code,
      );
      assert.equal(rows.length, 1, `${dimension}: ${code} occurs exactly once`);
      assert.equal(rows[0].cost, accounts.get(code).amount);
      assert.equal(rows[0].mandays, 0);
    }
    assert.ok(
      !total.some((row) =>
        ['2.2.1.2', '2.2.1.3', '2.3.4.1', '2.3.4.2'].includes(
          getCostSummaryStatementCode(row.key),
        ),
      ),
    );
    assert.ok(
      !total.some((row) =>
        ['__UNALLOCATED__', '__NON_RESOURCE__', '__NOT_APPLICABLE__'].includes(
          row.key,
        ),
      ),
    );
  }
  assert.deepEqual(snapshot, before);
});

test('Subcon preserves business Scope/BU and rolls legacy plus site/project BOQs into one RE account', () => {
  const snapshot = fixture();
  const accounts = statement(snapshot);
  const summarize = (dimension) =>
    buildReconciledCostDimensionSummary(
      snapshot.costRows,
      dimension,
      snapshot.resourceTypes,
      2.001,
      snapshot.manualCosts,
      snapshot.subcontractCost,
      { includeRisk: true },
    );
  const legacy = snapshot.costRows.filter(
    (row) =>
      snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
        .category === 'subcontract',
  );
  const legacyAmount = legacy.reduce((sum, row) => sum + totalRowCost(row), 0);
  assert.equal(accounts.get('2.3.2').amount, legacyAmount + 2200);
  const re = summarize('resourceType').filter(
    (row) => row.resourceCategory === 'subcontract',
  );
  assert.equal(re.length, 1);
  assert.equal(re[0].label, '2.3.2 · Subcontract Cost');
  assert.equal(re[0].cost, accounts.get('2.3.2').amount);
  for (const [dimension, key, field] of [
    ['scope', 'Router installation', 'scope'],
    ['bu', 'Network', 'bu'],
  ]) {
    const personnelAmount = snapshot.costRows
      .filter((row) => row[field] === key)
      .reduce((sum, row) => sum + totalRowCost(row), 0);
    assert.equal(
      summarize(dimension).find((row) => row.key === key).cost,
      personnelAmount + 2200,
    );
  }
  const subcon = buildSubcontractScopeSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.subcontractCost,
  );
  assert.equal(
    subcon.find((row) => row.key === 'Router installation').cost,
    2200,
  );
  assert.equal(
    roundMoney(subcon.reduce((sum, row) => sum + row.cost, 0)),
    accounts.get('2.3.2').amount,
  );
});

test('Simple Export uses named account totals including Risk and has a reconciled Subcon summary', async () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  ).totalCost;
  const accounts = statement(snapshot, travel);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildSimpleCostWorkbookBytes(snapshot));
  for (const name of ['Summary Scope', 'Summary BU', 'Summary RE Type']) {
    const sheet = workbook.getWorksheet(name);
    const data = [];
    for (let row = 5; row < sheet.rowCount; row++)
      data.push({
        label: sheet.getCell(row, 1).value,
        cost: sheet.getCell(row, 4).value,
      });
    assert.equal(
      sheet.getCell(sheet.rowCount, 4).value,
      accounts.get('').amount,
    );
    for (const code of ['2.2.1', '2.3.4', '15']) {
      const matches = data.filter((row) => row.label.startsWith(`${code} · `));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].cost, accounts.get(code).amount);
    }
    assert.ok(
      !data.some((row) => /UNALLOCATED|Non-resource|待分摊/.test(row.label)),
    );
  }
  const subcon = workbook.getWorksheet('Summary Subcon');
  assert.equal(
    subcon.getCell(subcon.rowCount, 4).value,
    accounts.get('2.3.2').amount,
  );
  assert.match(subcon.getCell('A3').value, /2\.3\.2/);
  const statementSheet = workbook.getWorksheet('Cost Statement');
  assert.equal(
    statementSheet.getCell(statementSheet.rowCount, 2).value,
    accounts.get('').amount,
  );
  assert.deepEqual(snapshot, before);
});
