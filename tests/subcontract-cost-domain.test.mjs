import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  calculateSubcontractCost,
  emptySubcontractCost,
  subcontractCostDetails,
  validateSubcontractCost,
} from '../features/cost/subcontract-domain.ts';
import {
  getCostStatementValues,
  buildReconciledCostDimensionSummary,
  totalRowMandays,
  buildCostStatementRows,
  roundMoney,
} from '../features/cost/domain.ts';
import { buildCostExportSnapshot } from '../features/cost/build-export-snapshot.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { buildSimpleCostWorkbookBytes } from '../features/cost/export-simple-workbook.ts';
import { makeCostSnapshot } from './helpers.mjs';

const line = (id, price = 200, extra = {}) => ({
  id,
  catalogItemId: `cat-${id}`,
  code: id.toUpperCase(),
  description:
    id === 'router'
      ? 'Installation Cisco2u router'
      : 'Supply & install fiber patch cord',
  bu: 'Network',
  unit: 'pcs',
  unitPrice: price,
  currency: 'SGD',
  ...extra,
});
const boq = () => ({
  mode: 'site-types',
  lines: [line('project', 50, { quantities: [1, 0, 0, 0, 0] })],
  siteTypes: [
    {
      id: 'a',
      name: 'Type A',
      sites: [100, 200, 0, 0, 0],
      lines: [
        line('router', 200, { quantityPerSite: 1 }),
        line('fiber', 80, { quantityPerSite: 2 }),
      ],
    },
    {
      id: 'b',
      name: 'Type B',
      sites: [50, 100, 0, 0, 0],
      lines: [
        line('router', 200, { quantityPerSite: 2 }),
        line('fiber', 80, { quantityPerSite: 4 }),
      ],
    },
  ],
});
const onlySubcontract = () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows = [];
  snapshot.resourceTypes = [];
  snapshot.manualCosts = Object.fromEntries(
    Object.keys(snapshot.manualCosts).map((key) => [key, 0]),
  );
  snapshot.subcontractCost = boq();
  return snapshot;
};
const statement = (snapshot) =>
  getCostStatementValues(
    snapshot.costRows,
    snapshot.resourceTypes,
    0,
    snapshot.manualCosts,
    snapshot.subcontractCost,
  );

test('project quantity and site BOQ × annual deployments produce one annual 2.3.2 total', () => {
  assert.deepEqual(
    calculateSubcontractCost(emptySubcontractCost()).years,
    [0, 0, 0, 0, 0],
  );
  const result = calculateSubcontractCost(boq());
  assert.deepEqual(
    result.siteTypes.map((site) => site.unitCost),
    [360, 720],
  );
  assert.deepEqual(result.years, [72050, 144000, 0, 0, 0]);
  assert.equal(result.total, 216050);
  const snapshot = onlySubcontract();
  snapshot.rateSettings.localArpAllowanceEnabled = true;
  snapshot.rateSettings.annualUplifts = [200, 300, 400, 500, 600];
  snapshot.manualCosts.otherServiceRate = 0.01;
  assert.equal(statement(snapshot).subcontract, 216050);
  assert.equal(statement(snapshot).labour, 0);
  assert.equal(statement(snapshot).otherService, 0);
  assert.equal(statement(snapshot).totalWithRisk, 216050);
  assert.equal(
    buildCostStatementRows(
      [],
      [],
      0,
      snapshot.manualCosts,
      snapshot.subcontractCost,
    ).find((row) => row.code === '2.3.2').amount,
    216050,
  );
});

test('rounding uses each priced site item then each annual allocation; mixed units retain quantities', () => {
  const data = {
    mode: 'site-types',
    lines: [],
    siteTypes: [
      {
        id: 'a',
        name: 'A',
        sites: [3, 2, 0, 0, 0],
        lines: [line('fiber', 0.011, { unit: 'm', quantityPerSite: 1.25 })],
      },
    ],
  };
  assert.equal(calculateSubcontractCost(data).siteTypes[0].unitCost, 0.02);
  assert.deepEqual(calculateSubcontractCost(data).years, [0.06, 0.04, 0, 0, 0]);
  assert.deepEqual(
    subcontractCostDetails(data)[0].quantities,
    [3.75, 2.5, 0, 0, 0],
  );
  assert.equal(validateSubcontractCost(data).length, 0);
});

test('unpriced differs from zero and invalid quantity, duplicate IDs and hidden configurations block finalization', () => {
  const data = {
    mode: 'project',
    lines: [line('router', null, { quantities: [1, 0, 0, 0, 0] })],
    siteTypes: [],
  };
  assert.equal(validateSubcontractCost(data, false).length, 0);
  assert.ok(
    validateSubcontractCost(data).some(
      (issue) => issue.code === 'SUBCONTRACT_PRICE_REQUIRED',
    ),
  );
  data.lines[0].unitPrice = 0;
  assert.equal(validateSubcontractCost(data).length, 0);
  for (const invalid of [NaN, Infinity, -1]) {
    data.lines[0].unitPrice = invalid;
    assert.ok(
      validateSubcontractCost(data).some(
        (issue) => issue.code === 'INVALID_SUBCONTRACT_PRICE',
      ),
    );
  }
  data.lines[0].unitPrice = 200;
  data.lines[0].quantities[0] = 1.5;
  assert.ok(
    validateSubcontractCost(data).some(
      (issue) => issue.code === 'INVALID_SUBCONTRACT_QUANTITY',
    ),
  );
  data.lines[0].quantities = [1, 0, 0, 0];
  assert.ok(
    validateSubcontractCost(data).some(
      (issue) => issue.code === 'INVALID_SUBCONTRACT_QUANTITY',
    ),
  );
  const hidden = boq();
  hidden.mode = 'project';
  assert.ok(
    validateSubcontractCost(hidden).some(
      (issue) => issue.code === 'INACTIVE_SUBCONTRACT_SITE_TYPES',
    ),
  );
  const duplicate = boq();
  duplicate.siteTypes[0].lines.push(
    structuredClone(duplicate.siteTypes[0].lines[0]),
  );
  assert.ok(
    validateSubcontractCost(duplicate).some(
      (issue) => issue.code === 'INVALID_SUBCONTRACT_ID',
    ),
  );
  const fractional = boq();
  fractional.siteTypes[0].sites[0] = 0.5;
  assert.ok(
    validateSubcontractCost(fractional).some(
      (issue) => issue.code === 'INVALID_SUBCONTRACT_QUANTITY',
    ),
  );
});

test('Draft permits temporarily cleared business text while finalization requires complete labels and prices', () => {
  const data = boq();
  data.lines[0].code = '';
  data.lines[0].description = '';
  data.lines[0].bu = '';
  data.lines[0].unit = '';
  data.lines[0].unitPrice = null;
  data.siteTypes[0].name = '';
  assert.deepEqual(validateSubcontractCost(data, false), []);
  assert.equal(
    validateSubcontractCost(data).filter(
      (issue) => issue.code === 'SUBCONTRACT_TEXT_REQUIRED',
    ).length,
    5,
  );
  assert.ok(
    validateSubcontractCost(data).some(
      (issue) => issue.code === 'SUBCONTRACT_PRICE_REQUIRED',
    ),
  );
  data.lines[0].description = 42;
  assert.ok(
    validateSubcontractCost(data, false).some(
      (issue) => issue.code === 'INVALID_SUBCONTRACT_TEXT',
    ),
  );
});

test('legacy subcontract amounts remain unchanged and structured costs reconcile across all dimensions once', () => {
  const legacy = makeCostSnapshot();
  const previous = statement(legacy);
  legacy.subcontractCost = boq();
  const updated = statement(legacy);
  assert.equal(updated.subcontract, previous.subcontract + 216050);
  assert.equal(updated.sales, previous.sales + 216050);
  for (const dimension of ['scope', 'bu', 'resourceType']) {
    const groups = buildReconciledCostDimensionSummary(
      legacy.costRows,
      dimension,
      legacy.resourceTypes,
      0,
      legacy.manualCosts,
      legacy.subcontractCost,
    );
    assert.equal(
      roundMoney(groups.reduce((sum, item) => sum + item.cost, 0)),
      updated.sales,
    );
    if (dimension === 'resourceType') {
      assert.equal(
        groups.find((row) => row.key === '__SUBCONTRACT__').cost,
        updated.subcontract,
      );
      assert.equal(
        groups.find((row) => row.key === '__SUBCONTRACT__').mandays,
        legacy.costRows
          .filter((row) =>
            legacy.resourceTypes.some(
              (resource) =>
                resource.id === row.reTypeId &&
                resource.category === 'subcontract',
            ),
          )
          .reduce((sum, row) => sum + totalRowMandays(row), 0),
      );
    }
  }
});

test('export snapshot captures nested BOQ values and preserves legacy absence', () => {
  const source = onlySubcontract();
  const options = {
    ...source,
    rows: source.costRows,
    activeVersion: 'V1',
    versionStatus: 'Draft',
  };
  const captured = buildCostExportSnapshot(options);
  source.subcontractCost.siteTypes[0].lines[0].unitPrice = 999;
  source.subcontractCost.siteTypes[0].sites[0] = 999;
  assert.equal(
    calculateSubcontractCost(captured.subcontractCost).total,
    216050,
  );
  delete options.subcontractCost;
  assert.equal(
    Object.hasOwn(buildCostExportSnapshot(options), 'subcontractCost'),
    false,
  );
});

test('subcontract export captures configuration before asynchronous workbook creation', async () => {
  for (const build of [buildCostWorkbookBytes, buildSimpleCostWorkbookBytes]) {
    const snapshot = onlySubcontract();
    const pending = build(snapshot);
    snapshot.subcontractCost.siteTypes[0].lines[0].unitPrice = 999;
    snapshot.subcontractCost.siteTypes[0].sites[0] = 999;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await pending);
    const detail = workbook.getWorksheet('Subcon Detail');
    assert.equal(detail.getCell(detail.rowCount, 8).value, 216050);
  }
});

test('subcontract-only costs validate and both exported workbooks contain BOQ and matching 2.3.2', async () => {
  const snapshot = onlySubcontract();
  assert.deepEqual(
    validateCostExportSnapshot(snapshot).filter(
      (issue) => issue.severity === 'error',
    ),
    [],
  );
  for (const [build, full] of [
    [buildCostWorkbookBytes, true],
    [buildSimpleCostWorkbookBytes, false],
  ]) {
    const workbook = new ExcelJS.Workbook();
    const bytes = await build(snapshot);
    await workbook.xlsx.load(bytes);
    const boqSheet = workbook.getWorksheet('Subcon Detail');
    assert.ok(boqSheet);
    assert.equal(boqSheet.getCell(boqSheet.rowCount, 8).value, 216050);
    assert.ok(workbook.getWorksheet('Subcon Site Types'));
    const sheet = workbook.getWorksheet(
      full ? '06_Cost_Statement' : 'Cost Statement',
    );
    let matching;
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (
          cell.value === '2.3.2' ||
          (typeof cell.value === 'string' && cell.value.startsWith('2.3.2 '))
        )
          matching = row;
      }),
    );
    assert.ok(matching, `${sheet.name} includes 2.3.2`);
    const values = matching.values;
    assert.ok(
      values.some((value) => value === 216050 || value?.result === 216050),
      '2.3.2 exactly equals structured annual sum',
    );
    if (full) {
      const reconciliation = workbook.getWorksheet('07_Reconciliation');
      const statuses = [];
      reconciliation.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.value?.formula?.startsWith('IF('))
            statuses.push(cell.value.result);
        }),
      );
      assert.ok(statuses.length > 0);
      assert.ok(statuses.every((value) => value === 'PASS'));
    }
  }
  snapshot.subcontractCost.lines[0].unitPrice = null;
  await assert.rejects(buildSimpleCostWorkbookBytes(snapshot), /blocked/);
  await assert.rejects(buildCostWorkbookBytes(snapshot), /blocked/);
});
