import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import ExcelJS from 'exceljs';
import {
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  getCostStatementValues,
  getHQTravelSummary,
  getOtherServiceCost,
  overrideOtherServiceCost,
  recalculateCostRows,
  roundMoney,
} from '../features/cost/domain.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { createCostVersion } from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  createProject,
} from '../server/workspace-resources.mjs';
import { makeCostSnapshot } from './helpers.mjs';

const fixture = () => {
  const snapshot = makeCostSnapshot();
  snapshot.resourceTypes = [
    {
      ...snapshot.resourceTypes.find((r) => r.code === 'LOCAL-L1'),
      mandayRate: 100,
    },
    {
      ...snapshot.resourceTypes.find((r) => r.code === 'HQ-L1'),
      mandayRate: 200,
      mandaysPerMonth: 20,
    },
    snapshot.resourceTypes.find((r) => r.code === 'SUBCON'),
  ];
  snapshot.rateSettings = {
    ...snapshot.rateSettings,
    baseYear: 2026,
    tdStart: '2026-01-01',
    tdEnd: '2026-12-31',
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
  };
  snapshot.costRows = snapshot.resourceTypes.map((resource, index) => ({
    id: `COST-${index}`,
    scope: 'Delivery Services',
    bu: 'Services BU',
    reTypeId: resource.id,
    mdPerSite: [10, 5, 1][index],
    years: Array.from({ length: 5 }, (_, i) => ({
      bucket: `Y${i + 1}`,
      sites: i === 0 ? 1 : 0,
      cost: index === 2 && i === 0 ? 500 : 0,
    })),
  }));
  snapshot.costRows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  snapshot.travelSettings = {
    monthlyAllowance: 400,
    airfarePerTrip: 50,
    trips: 2,
  };
  snapshot.manualCosts = {
    localPurchasedEquipment: 11,
    inlandLogistics: 7,
    countryWarehousing: 8,
    nonInHouseLabour: 300,
    settlement: 10,
    carFee: 40,
    otherService: 999,
    otherServiceRate: 0.01,
    riskContingency: 15,
  };
  return snapshot;
};
const amounts = (snapshot) => {
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const statement = getCostStatementValues(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
  );
  return { travel, statement };
};

test('default 1% uses 2.3.1 labour including internal, non-in-house and HQ travel, excluding subcontract', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  const { travel, statement } = amounts(snapshot);
  assert.equal(travel.totalCost, 200);
  assert.equal(statement.inHouseLabour, 2000);
  assert.equal(statement.labour, 2500);
  assert.equal(statement.subcontract, 500);
  assert.equal(getOtherServiceCost(statement.labour, snapshot.manualCosts), 25);
  assert.equal(statement.otherService, 65); // Car 40 + 1% labour 25.
  assert.equal(statement.sales, 3101);
  assert.equal(statement.totalWithRisk, 3116);
  const rows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
  );
  assert.equal(rows.find((row) => row.code === '2.3.4.2').amount, 25);
  assert.equal(rows.find((row) => row.code === '2.3.1').amount, 2500);
  assert.deepEqual(snapshot, before);
  snapshot.costRows[2].years[0].cost = 1500;
  assert.equal(
    getOtherServiceCost(
      amounts(snapshot).statement.labour,
      snapshot.manualCosts,
    ),
    25,
  );
  snapshot.manualCosts.nonInHouseLabour = 400;
  assert.equal(
    getOtherServiceCost(
      amounts(snapshot).statement.labour,
      snapshot.manualCosts,
    ),
    26,
  );
  snapshot.travelSettings.trips = 4;
  assert.equal(
    getOtherServiceCost(
      amounts(snapshot).statement.labour,
      snapshot.manualCosts,
    ),
    27,
  );
});

test('manual override disables the rate until an explicit restore and uses shared money rounding', () => {
  const original = fixture().manualCosts;
  const copy = structuredClone(original);
  const manual = overrideOtherServiceCost(original, 78.231);
  assert.equal(Object.hasOwn(manual, 'otherServiceRate'), false);
  assert.equal(getOtherServiceCost(2500, manual), 78.24);
  assert.equal(getOtherServiceCost(10000, manual), 78.24);
  assert.deepEqual(original, copy);
  const restored = { ...manual, otherServiceRate: 0.01 };
  assert.equal(getOtherServiceCost(2500, restored), 25);
  assert.equal(getOtherServiceCost(2500.01, restored), 25.01);
  assert.equal(
    getOtherServiceCost(2500, { ...manual, otherServiceRate: 0 }),
    0,
  );
  assert.equal(
    getOtherServiceCost(2500, { ...manual, otherServiceRate: 1 }),
    2500,
  );
});

test('legacy manual amounts and cloned versions retain the exact chosen mode', () => {
  const snapshot = fixture();
  delete snapshot.manualCosts.otherServiceRate;
  snapshot.manualCosts.otherService = 123.45;
  assert.equal(getOtherServiceCost(1000, snapshot.manualCosts), 123.45);
  assert.equal(getOtherServiceCost(9000, snapshot.manualCosts), 123.45);
  for (const rate of [undefined, 0.01, 0.02]) {
    const manualCosts = { ...snapshot.manualCosts };
    if (rate !== undefined) manualCosts.otherServiceRate = rate;
    const inputs = {
      ...snapshot,
      travelRows: [],
      travelUplift: 0,
      manualCosts,
    };
    const clone = createCostVersion('V2', 'Draft', 'V1', inputs);
    assert.deepEqual(clone.manualCosts, manualCosts);
    assert.notEqual(clone.manualCosts, manualCosts);
  }
});

test('new projects and blank drafts default to 1%; cloning a historical manual version preserves its amount', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    createProject(repository, {
      id: 'P-OTHER-RATE',
      name: 'Other Service Fixture',
      client: 'Fixture Client',
    });
    let record = repository.get('P-OTHER-RATE');
    assert.equal(
      record.workspace.costVersions[0].manualCosts.otherServiceRate,
      0.01,
    );
    assert.equal(record.workspace.manualCosts.otherServiceRate, 0.01);
    delete record.workspace.manualCosts.otherServiceRate;
    delete record.workspace.costVersions[0].manualCosts.otherServiceRate;
    record.workspace.manualCosts.otherService = 321;
    record.workspace.costVersions[0].manualCosts.otherService = 321;
    record = repository.save('P-OTHER-RATE', record.workspace, record.revision);
    const historical = structuredClone(record.workspace.costVersions[0]);
    createCostDraft(
      repository,
      'P-OTHER-RATE',
      { mode: 'clone', sourceVersion: 'V1' },
      record.revision,
    );
    record = repository.get('P-OTHER-RATE');
    assert.deepEqual(record.workspace.costVersions[0], historical);
    assert.equal(
      Object.hasOwn(
        record.workspace.costVersions[1].manualCosts,
        'otherServiceRate',
      ),
      false,
    );
    assert.equal(
      record.workspace.costVersions[1].manualCosts.otherService,
      321,
    );
    createCostDraft(
      repository,
      'P-OTHER-RATE',
      { mode: 'blank' },
      record.revision,
    );
    record = repository.get('P-OTHER-RATE');
    assert.equal(
      record.workspace.costVersions[2].manualCosts.otherServiceRate,
      0.01,
    );
    assert.deepEqual(record.workspace.costVersions[0], historical);
  } finally {
    repository.close();
  }
});

const header = (sheet, label) => {
  for (let col = 1; col <= sheet.columnCount; col++)
    if (sheet.getCell(4, col).value === label) return col;
  throw new Error(`Missing ${sheet.name} column ${label}`);
};
const rowAt = (sheet, column, value) => {
  for (let row = 5; row <= sheet.rowCount; row++)
    if (sheet.getCell(row, column).value === value) return row;
  throw new Error(`Missing ${sheet.name} row ${value}`);
};
const formulaResult = (cell) => {
  assert.equal(typeof cell.value?.formula, 'string');
  return cell.value.result ?? 0;
};

test('all shared dimensions and serialized nine-sheet formula caches include the calculated 1% once', async () => {
  const snapshot = fixture();
  assert.deepEqual(
    validateCostExportSnapshot(snapshot).filter(
      (issue) => issue.severity === 'error',
    ),
    [],
  );
  const { travel, statement } = amounts(snapshot);
  for (const dimension of ['scope', 'bu', 'resourceType']) {
    const summary = buildReconciledCostDimensionSummary(
      snapshot.costRows,
      dimension,
      snapshot.resourceTypes,
      travel.totalCost,
      snapshot.manualCosts,
    );
    assert.equal(
      roundMoney(summary.reduce((sum, item) => sum + item.cost, 0)),
      statement.sales,
    );
  }
  const bytes = await buildCostWorkbookBytes(snapshot);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(workbook.worksheets.length, 9);
  const sheet = workbook.getWorksheet('06_Cost_Statement');
  const code = header(sheet, 'Code'),
    cost = header(sheet, 'Cost (SGD)');
  for (const [key, expected] of [
    ['2.3.1', 2500],
    ['2.3.4.2', 25],
    ['2', statement.sales],
  ]) {
    assert.equal(
      formulaResult(sheet.getCell(rowAt(sheet, code, key), cost)),
      expected,
    );
  }
  const detail = workbook.getWorksheet('01_Cost_Detail');
  const generatedRow = rowAt(
    detail,
    header(detail, 'Statement Code'),
    '2.3.4.2',
  );
  assert.equal(
    detail.getCell(generatedRow, header(detail, 'Direct Cost')).value,
    25,
  );
  assert.equal(
    formulaResult(detail.getCell(generatedRow, header(detail, 'Total Cost'))),
    25,
  );
  for (const name of [
    '02_Summary_Scope',
    '03_Summary_BU',
    '04_Summary_RE_Type',
  ]) {
    const summary = workbook.getWorksheet(name);
    assert.equal(
      formulaResult(
        summary.getCell(
          rowAt(summary, 1, 'TOTAL'),
          header(summary, 'Sales Cost'),
        ),
      ),
      statement.sales,
    );
  }
  const level = workbook.getWorksheet('05_Summary_RE_Level');
  assert.equal(
    formulaResult(
      level.getCell(
        rowAt(level, header(level, 'RE Type ID'), 'TOTAL'),
        header(level, 'In-house Labour Cost'),
      ),
    ),
    2000,
  );
  const reconciliation = workbook.getWorksheet('07_Reconciliation');
  const checkId = header(reconciliation, 'Check ID'),
    status = header(reconciliation, 'Status');
  for (let row = 5; row <= reconciliation.rowCount; row++) {
    const check = reconciliation.getCell(row, checkId).value;
    if (
      check === 'OVERALL' ||
      (typeof check === 'string' && check.startsWith('R'))
    )
      assert.equal(formulaResult(reconciliation.getCell(row, status)), 'PASS');
  }
});

test('schema and runtime both enforce a finite numeric fraction from 0 through 1', () => {
  const schema = JSON.parse(
    readFileSync(
      new URL('../schemas/cost-export.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(schema);
  for (const rate of [0, 0.01, 1]) {
    const snapshot = fixture();
    snapshot.manualCosts.otherServiceRate = rate;
    assert.equal(validate(snapshot), true, ajv.errorsText(validate.errors));
    assert.deepEqual(
      validateCostExportSnapshot(snapshot).filter(
        (issue) => issue.severity === 'error',
      ),
      [],
    );
  }
  for (const rate of [-0.001, 1.001, NaN, Infinity, '0.01', null]) {
    const snapshot = fixture();
    snapshot.manualCosts.otherServiceRate = rate;
    assert.equal(validate(snapshot), false, String(rate));
    assert.ok(
      validateCostExportSnapshot(snapshot).some(
        (issue) =>
          issue.severity === 'error' &&
          issue.path === '/manualCosts/otherServiceRate',
      ),
      String(rate),
    );
  }
});

test('automatically calculated other service cost is flagged as unallocated even when its stored manual amount is zero', () => {
  const snapshot = fixture();
  snapshot.costRows = [snapshot.costRows[0]];
  snapshot.travelSettings = {
    monthlyAllowance: 0,
    airfarePerTrip: 0,
    trips: 0,
  };
  for (const key of Object.keys(snapshot.manualCosts))
    if (key !== 'otherServiceRate') snapshot.manualCosts[key] = 0;
  assert.equal(amounts(snapshot).statement.otherService, 10);
  assert.ok(
    validateCostExportSnapshot(snapshot).some(
      (issue) => issue.code === 'UNALLOCATED_PROJECT_COST',
    ),
  );
});

test('custom internal RE code remains valid when pool and level are edited independently', async () => {
  const snapshot = fixture();
  snapshot.resourceTypes[0] = {
    ...snapshot.resourceTypes[0],
    code: 'CUSTOM-ENGINEER',
    pool: 'ARP',
    level: 'L4',
  };
  const errors = validateCostExportSnapshot(snapshot).filter(
    (issue) => issue.severity === 'error',
  );
  assert.deepEqual(errors, []);
  const bytes = await buildCostWorkbookBytes(snapshot);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const detail = workbook.getWorksheet('01_Cost_Detail');
  const resourceRow = rowAt(
    detail,
    header(detail, 'RE Code'),
    'CUSTOM-ENGINEER',
  );
  assert.equal(
    detail.getCell(resourceRow, header(detail, 'RE Category')).value,
    'internal',
  );
  assert.equal(
    formulaResult(detail.getCell(resourceRow, header(detail, 'Total Cost'))),
    1000,
  );
});
