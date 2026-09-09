import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  getCostStatementValues,
  getHQTravelSummary,
  recalculateCostRows,
  roundMoney,
  totalRowCost,
  totalRowMandays,
  totalRowSites,
  yearRowMandays,
} from '../features/cost/domain.ts';
import {
  buildSimpleCostWorkbookBytes,
  getSimpleCostWorkbookFileName,
} from '../features/cost/export-simple-workbook.ts';
import { makeCostSnapshot } from './helpers.mjs';

const load = async (bytes) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return workbook;
};
const exportFixture = async (snapshot = makeCostSnapshot()) => ({
  snapshot,
  workbook: await load(await buildSimpleCostWorkbookBytes(snapshot)),
});
const values = (row, columns) =>
  Array.from({ length: columns }, (_, index) => row.getCell(index + 1).value);

test('simple export serializes visible business tables and Cost Input columns', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].source = {
    fileName: 'PRIVATE-SOURCE-FILE.xlsx',
    sheet: 'PRIVATE-SOURCE-SHEET',
    row: 7,
    role: 'TD',
    sha256: 'PRIVATE-SHA256',
    importedAt: snapshot.exportedAt,
    mappingKey: 'PRIVATE-MAPPING-KEY',
  };
  snapshot.costRows[0].id = 'PRIVATE-INPUT-ID';
  const { workbook } = await exportFixture(snapshot);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    [
      'Cost Detail',
      'Summary Scope',
      'Summary BU',
      'Summary RE Type',
      'Summary Subcon',
      'Cost Statement',
    ],
  );
  const detail = workbook.getWorksheet('Cost Detail');
  assert.equal(detail.columnCount, 22);
  assert.deepEqual(values(detail.getRow(4), 7), [
    'Scope / 服务范围',
    'BU / 业务部',
    'RE Type / 资源类型',
    'MD / Site\n单站人天',
    'Total Sites\n总站点数',
    'Total MD\n总人天',
    'Total Cost\n总成本',
  ]);
  assert.match(detail.getCell('H4').value, /^Y1 · /);
  assert.match(detail.getCell('T4').value, /^Y5 · /);
  assert.deepEqual(
    [8, 9, 10].map((column) => detail.getCell(5, column).value),
    ['Sites / 站点数', 'Mandays / 人天', 'Cost / 成本'],
  );
  snapshot.costRows.forEach((row, index) => {
    const actual = detail.getRow(6 + index);
    assert.deepEqual(values(actual, 7), [
      row.scope,
      row.bu,
      snapshot.resourceTypes.find((item) => item.id === row.reTypeId).name,
      row.mdPerSite,
      totalRowSites(row),
      totalRowMandays(row),
      totalRowCost(row),
    ]);
    row.years.forEach((year, yearIndex) => {
      const firstColumn = 8 + yearIndex * 3;
      assert.equal(actual.getCell(firstColumn).value, year.sites);
      assert.equal(
        actual.getCell(firstColumn + 1).value,
        yearRowMandays(row, yearIndex),
      );
      assert.equal(
        actual.getCell(firstColumn + 2).value,
        roundMoney(year.cost),
      );
      assert.equal(
        actual.getCell(firstColumn + 2).type,
        ExcelJS.ValueType.Number,
      );
      assert.match(actual.getCell(firstColumn + 2).numFmt, /S\$.*0\.00/);
    });
  });
  assert.equal(detail.getCell('G6').value, 218400);
  assert.equal(
    detail.getCell(detail.rowCount, 7).value,
    roundMoney(
      snapshot.costRows.reduce((sum, row) => sum + totalRowCost(row), 0),
    ),
  );
  assert.equal(detail.views[0].xSplit, 3);
  assert.equal(detail.views[0].ySplit, 5);
  const serializedValues = [];
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => serializedValues.push(cell.value)),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(serializedValues),
    /PRIVATE-|Source Kind|RE Type ID|RE Code|Statement Code|Allocation Status|Source Note|来源|__NON_RESOURCE__|__UNALLOCATED__/,
  );
});

test('simple dimensional sheets match page sorting, percentages, mandays and Total Cost with Risk', async () => {
  const { workbook, snapshot } = await exportFixture();
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
  for (const [sheetName, dimension] of [
    ['Summary Scope', 'scope'],
    ['Summary BU', 'bu'],
    ['Summary RE Type', 'resourceType'],
  ]) {
    const sheet = workbook.getWorksheet(sheetName);
    const items = buildReconciledCostDimensionSummary(
      snapshot.costRows,
      dimension,
      snapshot.resourceTypes,
      travel.totalCost,
      snapshot.manualCosts,
      snapshot.subcontractCost,
      { includeRisk: true },
    );
    assert.equal(sheet.columnCount, 5);
    assert.deepEqual(values(sheet.getRow(4), 5), [
      'Dimension / 维度',
      'Cost Distribution / 成本分布',
      'Mandays / 人天',
      'Cost / 成本',
      'Share / 占比',
    ]);
    items.forEach((item, index) => {
      const row = sheet.getRow(5 + index);
      assert.ok(row.getCell(1).value.startsWith(item.label));
      assert.equal(row.getCell(2).value, item.cost);
      assert.equal(row.getCell(2).numFmt, ';;;');
      assert.equal(row.getCell(3).value, item.mandays);
      assert.equal(row.getCell(3).type, ExcelJS.ValueType.Number);
      assert.match(row.getCell(3).numFmt, /MD \([\d.]+%\)/);
      assert.equal(row.getCell(4).value, item.cost);
      assert.equal(row.getCell(5).value, item.shareRatio);
      assert.equal(row.getCell(5).numFmt, '0.0%');
    });
    assert.equal(
      sheet.getCell(sheet.rowCount, 4).value,
      statement.totalWithRisk,
    );
    assert.equal(sheet.getCell(sheet.rowCount, 5).value, 1);
    assert.equal(sheet.conditionalFormattings.length, items.length);
    assert.equal(sheet.conditionalFormattings[0].rules[0].type, 'dataBar');
    assert.equal(
      sheet.conditionalFormattings[0].rules[0].color.argb,
      'FF173A52',
    );
  }
});

test('simple Cost Statement keeps bilingual item and account together with page hierarchy styling', async () => {
  const { workbook, snapshot } = await exportFixture();
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const expected = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
  );
  const sheet = workbook.getWorksheet('Cost Statement');
  assert.equal(sheet.columnCount, 2);
  assert.deepEqual(values(sheet.getRow(4), 2), [
    'Report Item (SGD) / 报表项',
    'Cost (SGD) / 成本',
  ]);
  expected.forEach((item, index) => {
    const row = sheet.getRow(5 + index);
    assert.equal(
      row.getCell(1).value,
      `${item.code ? `${item.code}  ` : ''}${item.en} / ${item.zh}`,
    );
    assert.equal(row.getCell(1).alignment.indent || 0, item.level);
    assert.equal(row.getCell(2).value, item.amount);
    assert.equal(row.getCell(2).type, ExcelJS.ValueType.Number);
    assert.match(row.getCell(2).numFmt, /S\$.*0\.00/);
    const expectedFill =
      item.mode === 'grand-total'
        ? 'FF17437A'
        : item.mode === 'section'
          ? 'FFEFE0D1'
          : item.code === '15'
            ? 'FFF4E5D9'
            : item.mode === 'subtotal'
              ? 'FFE3F0EF'
              : 'FFFFFFFF';
    assert.equal(row.getCell(1).fill.fgColor.argb, expectedFill);
    assert.equal(row.getCell(2).fill.fgColor.argb, expectedFill);
    if (item.mode === 'grand-total')
      assert.equal(row.getCell(1).font.color.argb, 'FFFFFFFF');
  });
  assert.equal(sheet.getCell(sheet.rowCount, 2).value, expected.at(-1).amount);
});

test('simple statement and dimensions use shared automatic one-percent service-cost calculation', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.manualCosts.otherServiceRate = 0.01;
  snapshot.manualCosts.otherService = 999999;
  const { workbook } = await exportFixture(snapshot);
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
  const rows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
  );
  const sheet = workbook.getWorksheet('Cost Statement');
  const rowIndex = rows.findIndex((row) => row.code === '2.3.4.2');
  assert.equal(
    sheet.getCell(rowIndex + 5, 2).value,
    roundMoney(statement.labour * 0.01),
  );
  for (const name of ['Summary Scope', 'Summary BU', 'Summary RE Type']) {
    const summary = workbook.getWorksheet(name);
    assert.equal(
      summary.getCell(summary.rowCount, 4).value,
      statement.totalWithRisk,
    );
  }
});

test('simple export reads Confirmed and Suspended versions without mutation and detaches concurrent edits', async () => {
  for (const status of ['Confirmed', 'Suspended']) {
    const snapshot = makeCostSnapshot();
    snapshot.costVersion.status = status;
    const original = structuredClone(snapshot);
    const bytes = await buildSimpleCostWorkbookBytes(snapshot);
    assert.deepEqual(snapshot, original);
    const workbook = await load(bytes);
    assert.match(
      workbook.getWorksheet('Cost Detail').getCell('A2').value,
      new RegExp(status),
    );
  }
  const snapshot = makeCostSnapshot();
  const expectedName = snapshot.costRows[0].scope;
  const pending = buildSimpleCostWorkbookBytes(snapshot);
  snapshot.costRows[0].scope = 'Concurrent edit after export clicked';
  snapshot.costRows[0].years[0].cost = 1;
  const workbook = await load(await pending);
  assert.equal(
    workbook.getWorksheet('Cost Detail').getCell('A6').value,
    expectedName,
  );
  assert.equal(
    workbook.getWorksheet('Cost Detail').getCell('G6').value,
    218400,
  );
});

test('simple export handles direct mandays, applies shared validation and uses a safe distinct file name', async () => {
  const snapshot = makeCostSnapshot();
  const row = snapshot.costRows[0];
  row.inputMode = 'mandays';
  row.mdPerSite = 0;
  row.years = row.years.map((year, index) => ({
    ...year,
    sites: 0,
    mandays: index === 4 ? 1.2345 : 0,
  }));
  snapshot.costRows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  const { workbook } = await exportFixture(snapshot);
  const detail = workbook.getWorksheet('Cost Detail');
  assert.equal(detail.getCell('D6').value, 0);
  assert.equal(detail.getCell('E6').value, 0);
  assert.equal(detail.getCell('F6').value, 1.2345);
  assert.equal(detail.getCell('U6').value, 1.2345);
  snapshot.costRows[0].reTypeId = 'missing';
  await assert.rejects(buildSimpleCostWorkbookBytes(snapshot), (error) => {
    assert.match(error.message, /validation error/);
    assert.ok(
      error.issues.some((issue) => issue.code === 'RESOURCE_TYPE_NOT_FOUND'),
    );
    return true;
  });
  snapshot.project.id = '../Project / test';
  snapshot.costVersion.code = 'V/2';
  assert.equal(
    getSimpleCostWorkbookFileName(snapshot),
    'Cost_Simple____Project___test_V_2_2026-09-04.xlsx',
  );
});
