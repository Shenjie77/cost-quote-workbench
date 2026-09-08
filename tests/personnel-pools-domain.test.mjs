import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';
import {
  YEAR_BUCKETS,
  getAllowancePools,
  getAllowanceResourceTypeIds,
  isPersonnelAllowanceApplied,
  validatePersonnelAllowanceSelection,
  recalculateCostRows,
  getHQTravelSummary,
} from '../features/cost/domain.ts';
import { buildCostExportSnapshot } from '../features/cost/build-export-snapshot.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { previewCostImport } from '../features/cost/import-workbook.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';

const fixture = () => {
  const s = makeCostSnapshot();
  const resource = s.resourceTypes.find(
    (entry) => entry.category === 'internal',
  );
  s.resourceTypes = ['LOCAL', 'ARP', 'HQ', 'HQ', 'OTHER'].map(
    (pool, index) => ({
      ...resource,
      id: `re-${index}`,
      code: `${pool}-${index}`,
      name: `${pool} engineer ${index}`,
      pool,
      level: index === 3 ? 'L3' : 'L2',
      hqTravel: pool === 'HQ',
      mandayRate: index === 3 ? 200 : 100,
    }),
  );
  s.rateSettings = {
    ...s.rateSettings,
    tdStart: '2026-01-01',
    baseYear: 2026,
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
  };
  s.travelSettings = {
    enabled: true,
    monthlyAllowance: 100,
    airfarePerTrip: 100,
    trips: 1,
  };
  s.costRows = s.resourceTypes.map((entry) => ({
    id: `cost-${entry.id}`,
    scope: entry.name,
    bu: 'Services',
    reTypeId: entry.id,
    inputMode: 'mandays',
    mdPerSite: 0,
    years: YEAR_BUCKETS.map((bucket) => ({
      bucket,
      sites: 0,
      mandays: 1,
      cost: 0,
    })),
  }));
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  return s;
};

test('pool selection covers every personnel level in selected pools and does not change other cost layers', () => {
  const s = fixture();
  const before = structuredClone(s.costRows);
  const travel = getHQTravelSummary(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
  );
  s.rateSettings.allowancePools = ['HQ', 'OTHER'];
  s.rateSettings.allowanceResourceTypeIds = ['re-0'];
  s.rateSettings.localArpAllowanceEnabled = true;
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  assert.deepEqual(
    s.costRows.map((row) => row.years.map((year) => year.cost)),
    [
      Array(5).fill(100),
      Array(5).fill(100),
      Array(5).fill(103),
      Array(5).fill(206),
      Array(5).fill(103),
    ],
  );
  assert.deepEqual(s.costRows.slice(0, 2), before.slice(0, 2));
  assert.deepEqual(
    getAllowanceResourceTypeIds(s.rateSettings, s.resourceTypes),
    ['re-2', 're-3', 're-4'],
  );
  assert.equal(
    getHQTravelSummary(s.costRows, s.resourceTypes, s.travelSettings).totalCost,
    travel.totalCost,
  );
  assert.equal(
    isPersonnelAllowanceApplied(
      { ...s.resourceTypes[2], category: 'subcontract' },
      s.rateSettings,
    ),
    false,
  );
  assert.equal(
    isPersonnelAllowanceApplied(
      { ...s.resourceTypes[2], pool: null },
      s.rateSettings,
    ),
    false,
  );
  assert.deepEqual(
    recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings),
    s.costRows,
  );
});

test('legacy ID selections project to pool controls without expanding their actual historical scope', () => {
  const s = fixture();
  s.rateSettings.allowanceResourceTypeIds = ['re-2'];
  const original = structuredClone(s.rateSettings);
  assert.deepEqual(getAllowancePools(s.rateSettings, s.resourceTypes), ['HQ']);
  assert.deepEqual(s.rateSettings, original);
  const legacy = recalculateCostRows(
    s.costRows,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.equal(legacy[2].years[0].cost, 103);
  assert.equal(legacy[3].years[0].cost, 200);
  s.rateSettings.allowancePools = getAllowancePools(
    s.rateSettings,
    s.resourceTypes,
  );
  const edited = recalculateCostRows(
    s.costRows,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.equal(edited[2].years[0].cost, 103);
  assert.equal(edited[3].years[0].cost, 206);
  s.rateSettings.allowancePools = [];
  assert.deepEqual(getAllowancePools(s.rateSettings, s.resourceTypes), []);
  assert.equal(
    recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings)[2].years[0]
      .cost,
    100,
  );
  assert.deepEqual(
    getAllowancePools(
      {
        ...original,
        allowanceResourceTypeIds: undefined,
        localArpAllowanceEnabled: true,
      },
      [],
    ),
    ['LOCAL', 'ARP'],
  );
});

test('pool validation rejects malformed, duplicate and unknown categories and ignores superseded ID references', () => {
  const s = fixture();
  for (const pools of [
    null,
    'HQ',
    ['HQ', 'HQ'],
    ['hq'],
    ['SUBCONTRACT'],
    [null],
    [123],
  ]) {
    s.rateSettings.allowancePools = pools;
    assert.ok(
      validatePersonnelAllowanceSelection(s.rateSettings, s.resourceTypes).some(
        (issue) => /ALLOWANCE_POOL/.test(issue.code),
      ),
    );
    assert.ok(
      validateCostExportSnapshot(s).some((issue) =>
        /ALLOWANCE_POOL/.test(issue.code),
      ),
    );
  }
  s.rateSettings.allowancePools = ['LOCAL', 'ARP', 'HQ', 'OTHER'];
  s.rateSettings.allowanceResourceTypeIds = ['removed-old-id'];
  assert.deepEqual(
    validatePersonnelAllowanceSelection(s.rateSettings, s.resourceTypes),
    [],
  );
  delete s.rateSettings.allowancePools;
  assert.ok(
    validatePersonnelAllowanceSelection(s.rateSettings, s.resourceTypes).some(
      (issue) => issue.code === 'INVALID_ALLOWANCE_RESOURCE',
    ),
  );
});

test('TD import applies pool-level allowance to every selected level and names the pool in a mismatch', async () => {
  const s = fixture();
  s.rateSettings.allowancePools = ['HQ'];
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet('TD');
  sheet.addRow(['Scope', 'MD', 'Cost']);
  sheet.addRow(['HQ engineer', 1, 200]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const mapping = {
    sheet: 'TD',
    headerRow: 1,
    role: 'TD',
    mode: 'mandays',
    year: 'Y1',
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
    defaultResource: 're-3',
  };
  const mismatch = await previewCostImport(
    bytes,
    'TD.xlsx',
    mapping,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.match(mismatch.issues.join('\n'), /HQ 3%/);
  const imported = await previewCostImport(
    bytes,
    'TD.xlsx',
    { ...mapping, columns: { ...mapping.columns, cost: 0 } },
    s.resourceTypes,
    s.rateSettings,
  );
  assert.deepEqual(imported.issues, []);
  assert.equal(imported.rows.length, 1);
  assert.equal(imported.rows[0].years[0].cost, 206);
});

test('export snapshot detaches pool choices and workbook records pool scope without expanding legacy selections', async () => {
  const s = fixture();
  s.rateSettings.allowancePools = ['HQ', 'OTHER'];
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  const captured = buildCostExportSnapshot({
    ...s,
    rows: s.costRows,
    activeVersion: 'V1',
    versionStatus: 'Draft',
  });
  s.rateSettings.allowancePools.push('LOCAL');
  assert.deepEqual(captured.rateSettings.allowancePools, ['HQ', 'OTHER']);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCostWorkbookBytes(captured));
  const assumptions = workbook.getWorksheet('08_Assumptions');
  let row;
  assumptions.eachRow((entry) => {
    if (entry.getCell(2).value === 'Personnel pool allowance 3%') row = entry;
  });
  assert.ok(row);
  assert.equal(row.getCell(3).value, 'Enabled');
  assert.match(row.getCell(4).value, /Selected pools: HQ, OTHER/);
  assert.doesNotMatch(row.getCell(4).value, /Selected RE Types/);
  delete s.rateSettings.allowancePools;
  s.rateSettings.allowanceResourceTypeIds = ['re-2'];
  const historical = buildCostExportSnapshot({
    ...s,
    rows: s.costRows,
    activeVersion: 'V1',
    versionStatus: 'Draft',
  });
  assert.equal(Object.hasOwn(historical.rateSettings, 'allowancePools'), false);
});
