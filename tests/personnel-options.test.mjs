import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';
import {
  YEAR_BUCKETS,
  recalculateCostRows,
  getAllowanceResourceTypeIds,
  isPersonnelAllowanceApplied,
  validatePersonnelAllowanceSelection,
  getHQTravelSummary,
  getCostStatementValues,
  isHQTravelEnabled,
} from '../features/cost/domain.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { buildCostExportSnapshot } from '../features/cost/build-export-snapshot.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { buildSimpleCostWorkbookBytes } from '../features/cost/export-simple-workbook.ts';
import { previewCostImport } from '../features/cost/import-workbook.ts';

const fixture = () => {
  const snapshot = makeCostSnapshot();
  snapshot.rateSettings = {
    ...snapshot.rateSettings,
    tdStart: '2026-01-01',
    baseYear: 2026,
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
  };
  snapshot.resourceTypes = ['LOCAL', 'ARP', 'HQ', 'OTHER'].map(
    (pool, index) => ({
      id: `person-${pool}`,
      code: `RE-${pool}`,
      name: `${pool} Engineer`,
      category: 'internal',
      pool,
      level: 'L2',
      mandayRate: (index + 1) * 100.01,
      mandaysPerMonth: 10,
      hoursPerManday: 8,
      hqTravel: pool === 'HQ',
      effectiveFrom: '2025-01-01',
      effectiveTo: '',
      active: true,
    }),
  );
  snapshot.costRows = snapshot.resourceTypes.map((resource) => ({
    id: `cost-${resource.pool}`,
    scope: `${resource.pool} support`,
    bu: 'Services',
    reTypeId: resource.id,
    inputMode: 'mandays',
    mdPerSite: 0,
    years: YEAR_BUCKETS.map((bucket, index) => ({
      bucket,
      sites: 0,
      mandays: index + 1,
      cost: 0,
    })),
  }));
  snapshot.costRows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  snapshot.travelSettings = {
    enabled: false,
    monthlyAllowance: 100,
    airfarePerTrip: 500,
    trips: 2,
  };
  snapshot.manualCosts = Object.fromEntries(
    Object.keys(snapshot.manualCosts).map((key) => [key, 0]),
  );
  return snapshot;
};
const travel = (s) =>
  getHQTravelSummary(s.costRows, s.resourceTypes, s.travelSettings);
const load = async (bytes) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
};
const column = (sheet, name) => {
  for (let c = 1; c <= sheet.columnCount; c++)
    if (sheet.getCell(4, c).value === name) return c;
  throw new Error(`Missing ${name}`);
};
const rowOf = (sheet, col, value) => {
  for (let r = 5; r <= sheet.rowCount; r++)
    if (sheet.getCell(r, col).value === value) return r;
  throw new Error(`Missing ${value}`);
};
const value = (cell) =>
  typeof cell.value === 'object' && cell.value !== null
    ? (cell.value.result ?? 0)
    : cell.value;

test('explicit RE Type selection applies 3% to HQ and OTHER across all years and leaves unselected LOCAL/ARP unchanged', () => {
  const s = fixture();
  const before = structuredClone(s.costRows);
  s.rateSettings.localArpAllowanceEnabled = true;
  s.rateSettings.allowanceResourceTypeIds = ['person-HQ', 'person-OTHER'];
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  assert.deepEqual(s.costRows.slice(0, 2), before.slice(0, 2));
  assert.deepEqual(
    s.costRows[2].years.map((year) => year.cost),
    [309.04, 618.07, 927.1, 1236.13, 1545.16],
  );
  assert.deepEqual(
    s.costRows[3].years.map((year) => year.cost),
    [412.05, 824.09, 1236.13, 1648.17, 2060.21],
  );
  assert.deepEqual(
    getAllowanceResourceTypeIds(s.rateSettings, s.resourceTypes),
    ['person-HQ', 'person-OTHER'],
  );
  assert.deepEqual(
    recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings),
    s.costRows,
  );
  assert.equal(
    isPersonnelAllowanceApplied(
      { ...s.resourceTypes[2], category: 'subcontract' },
      s.rateSettings,
    ),
    false,
  );
  assert.deepEqual(
    validateCostExportSnapshot(s).filter((issue) => issue.severity === 'error'),
    [],
  );
});

test('explicit empty selection disables the legacy switch while absent selection keeps legacy LOCAL/ARP behavior', () => {
  const s = fixture();
  const before = structuredClone(s.costRows);
  s.rateSettings.localArpAllowanceEnabled = true;
  s.rateSettings.allowanceResourceTypeIds = [];
  assert.deepEqual(
    recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings),
    before,
  );
  delete s.rateSettings.allowanceResourceTypeIds;
  assert.deepEqual(
    getAllowanceResourceTypeIds(s.rateSettings, s.resourceTypes),
    ['person-LOCAL', 'person-ARP'],
  );
  const legacy = recalculateCostRows(
    s.costRows,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.equal(legacy[0].years[0].cost, 103.02);
  assert.equal(legacy[1].years[0].cost, 206.03);
  assert.deepEqual(legacy.slice(2), before.slice(2));
});

test('HQ travel requires explicit opt-in for new settings and never applies the personnel 3% to travel', () => {
  const s = fixture();
  s.resourceTypes[2].hqTravel = false;
  s.resourceTypes[3].hqTravel = true;
  const off = travel(s);
  assert.equal(off.enabled, false);
  assert.equal(off.required, false);
  assert.equal(off.hqMandays, 15);
  assert.equal(off.months, 1.5);
  assert.deepEqual(off.yearMandays, [1, 2, 3, 4, 5]);
  assert.deepEqual(
    [off.allowanceCost, off.airfareCost, off.totalCost],
    [0, 0, 0],
  );
  s.travelSettings.enabled = true;
  const on = travel(s);
  assert.deepEqual(
    on.hqRows.map((row) => row.reTypeId),
    ['person-HQ'],
  );
  assert.deepEqual(
    [on.allowanceCost, on.airfareCost, on.totalCost],
    [150, 1000, 1150],
  );
  s.rateSettings.allowanceResourceTypeIds = ['person-HQ'];
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  assert.equal(travel(s).totalCost, 1150);
  assert.deepEqual(
    validateCostExportSnapshot(s).filter((issue) => issue.severity === 'error'),
    [],
  );
  s.costRows = s.costRows.filter((row) => row.reTypeId !== 'person-HQ');
  assert.equal(travel(s).totalCost, 0);
  assert.equal(travel(s).airfareCost, 0);
});

test('absent travel switch preserves historical HQ resource flags and saved fixture amounts', () => {
  const s = fixture();
  delete s.travelSettings.enabled;
  s.resourceTypes[2].hqTravel = false;
  s.resourceTypes[3].hqTravel = true;
  assert.deepEqual(
    travel(s).hqRows.map((row) => row.reTypeId),
    ['person-OTHER'],
  );
  assert.equal(isHQTravelEnabled(s.travelSettings), true);
  const historical = makeCostSnapshot();
  const result = travel(historical);
  assert.equal(result.hqMandays, 205);
  assert.equal(result.months, 9.4253);
  assert.equal(result.allowanceCost, 39586.26);
  assert.equal(result.airfareCost, 3400);
  assert.equal(result.totalCost, 42986.26);
  assert.equal(Object.hasOwn(historical.travelSettings, 'enabled'), false);
});

test('allowance validation rejects unknown, subcontract, duplicate and malformed IDs but accepts inactive captured personnel', () => {
  const s = fixture();
  s.resourceTypes.push({
    ...s.resourceTypes[0],
    id: 'package',
    code: 'PACKAGE',
    category: 'subcontract',
    pool: null,
    level: null,
    hqTravel: false,
  });
  for (const ids of [
    ['unknown'],
    ['package'],
    ['person-HQ', 'person-HQ'],
    [null],
    'person-HQ',
    null,
  ]) {
    s.rateSettings.allowanceResourceTypeIds = ids;
    assert.ok(
      validatePersonnelAllowanceSelection(s.rateSettings, s.resourceTypes)
        .length > 0,
    );
    assert.ok(
      validateCostExportSnapshot(s).some((issue) =>
        /ALLOWANCE_(RESOURCE|SELECTION)/.test(issue.code),
      ),
    );
  }
  s.rateSettings.allowanceResourceTypeIds = ['person-HQ'];
  s.resourceTypes[2].active = false;
  assert.deepEqual(
    validatePersonnelAllowanceSelection(s.rateSettings, s.resourceTypes),
    [],
  );
  s.travelSettings.enabled = 'false';
  assert.ok(
    validateCostExportSnapshot(s).some(
      (issue) => issue.code === 'INVALID_HQ_TRAVEL_SETTING',
    ),
  );
});

test('TD import uses selected HQ allowance and explains a base-cost mismatch without adding a second cost row', async () => {
  const s = fixture();
  s.rateSettings.allowanceResourceTypeIds = ['person-HQ'];
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet('TD');
  sheet.addRow(['Scope', 'MD', 'Cost']);
  sheet.addRow(['HQ design', 2, 600.06]);
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const mapping = {
    sheet: 'TD',
    headerRow: 1,
    role: 'TD',
    mode: 'mandays',
    year: 'Y2',
    columns: {
      scope: 1,
      mandays: 2,
      cost: 3,
      bu: 0,
      resource: 0,
      sites: 0,
      mdPerSite: 0,
    },
    defaultBu: 'Services',
    defaultResource: 'person-HQ',
  };
  const mismatch = await previewCostImport(
    bytes,
    'TD.xlsx',
    mapping,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.match(mismatch.issues.join('\n'), /RE-HQ 3%/);
  const preview = await previewCostImport(
    bytes,
    'TD.xlsx',
    { ...mapping, columns: { ...mapping.columns, cost: 0 } },
    s.resourceTypes,
    s.rateSettings,
  );
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.rows.length, 1);
  assert.deepEqual(
    preview.rows[0].years.map((year) => year.cost),
    [0, 618.07, 0, 0, 0],
  );
  assert.match(preview.rows[0].source.importedValues, /618.07/);
  s.rateSettings.allowanceResourceTypeIds = [];
  const noAllowance = await previewCostImport(
    bytes,
    'TD.xlsx',
    mapping,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.deepEqual(noAllowance.issues, []);
  assert.equal(noAllowance.rows[0].years[1].cost, 600.06);
});

test('exports show selected personnel assumptions, omit disabled travel cost, and never create allowance statement lines', async () => {
  const s = fixture();
  s.rateSettings.allowanceResourceTypeIds = ['person-HQ', 'person-OTHER'];
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  const expected = getCostStatementValues(
    s.costRows,
    s.resourceTypes,
    0,
    s.manualCosts,
  ).sales;
  const wb = await load(await buildCostWorkbookBytes(s));
  const detail = wb.getWorksheet('01_Cost_Detail');
  assert.equal(detail.rowCount - 4, 4);
  for (let r = 5; r <= detail.rowCount; r++) {
    assert.equal(
      detail.getCell(r, column(detail, 'Source Kind')).value,
      'COST_INPUT',
    );
    assert.equal(detail.getCell(r, column(detail, 'HQ Travel')).value, 'No');
  }
  const assumptions = wb.getWorksheet('08_Assumptions');
  const allowanceRow = rowOf(assumptions, 2, 'Personnel allowance 3%');
  assert.equal(assumptions.getCell(allowanceRow, 3).value, 'Enabled');
  assert.match(assumptions.getCell(allowanceRow, 4).value, /RE-HQ, RE-OTHER/);
  assert.equal(
    assumptions.getCell(rowOf(assumptions, 2, 'HQ travel enabled'), 3).value,
    'Disabled',
  );
  const statement = wb.getWorksheet('06_Cost_Statement');
  assert.equal(
    value(
      statement.getCell(
        rowOf(statement, column(statement, 'Code'), '2.3.1.3'),
        column(statement, 'Cost (SGD)'),
      ),
    ),
    0,
  );
  assert.equal(
    value(
      statement.getCell(
        rowOf(statement, column(statement, 'Code'), '2'),
        column(statement, 'Cost (SGD)'),
      ),
    ),
    expected,
  );
  const simple = await load(await buildSimpleCostWorkbookBytes(s));
  const summary = simple.getWorksheet('Summary Scope');
  assert.equal(summary.getCell(summary.rowCount, 4).value, expected);
  s.travelSettings.enabled = true;
  const enabled = await load(await buildCostWorkbookBytes(s));
  const enabledStatement = enabled.getWorksheet('06_Cost_Statement');
  assert.equal(
    value(
      enabledStatement.getCell(
        rowOf(enabledStatement, column(enabledStatement, 'Code'), '2.3.1.3'),
        column(enabledStatement, 'Cost (SGD)'),
      ),
    ),
    1150,
  );
});

test('cost export snapshot detaches selected resource IDs while preserving absent legacy fields', () => {
  const s = fixture();
  s.rateSettings.allowanceResourceTypeIds = ['person-HQ'];
  const options = {
    ...s,
    rows: s.costRows,
    activeVersion: 'V1',
    versionStatus: 'Draft',
  };
  const captured = buildCostExportSnapshot(options);
  s.rateSettings.allowanceResourceTypeIds.push('person-OTHER');
  s.travelSettings.enabled = true;
  assert.deepEqual(captured.rateSettings.allowanceResourceTypeIds, [
    'person-HQ',
  ]);
  assert.equal(captured.travelSettings.enabled, false);
  delete options.rateSettings.allowanceResourceTypeIds;
  delete options.travelSettings.enabled;
  const legacy = buildCostExportSnapshot(options);
  assert.equal(
    Object.hasOwn(legacy.rateSettings, 'allowanceResourceTypeIds'),
    false,
  );
  assert.equal(Object.hasOwn(legacy.travelSettings, 'enabled'), false);
});
