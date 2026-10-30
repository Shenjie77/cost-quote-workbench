/**
 * Workbook-contract regression tests. The XLSX is serialized and reloaded so
 * formulas, cached results, and worksheet order are verified after ZIP/XML.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import ExcelJS from 'exceljs';

import {
  roundMoney,
  recalculateCostRows,
  getHQTravelSummary,
} from '../features/cost/domain.ts';
import {
  buildCostWorkbook,
  buildCostWorkbookBytes,
} from '../features/cost/export-workbook.ts';
import { makeCostSnapshot } from './helpers.mjs';

const EXPECTED_SHEETS = [
  '00_Readme',
  '01_Cost_Detail',
  '02_Summary_Scope',
  '03_Summary_BU',
  '04_Summary_RE_Type',
  '05_Summary_RE_Level',
  '06_Cost_Statement',
  '07_Reconciliation',
  '08_Assumptions',
];

const loadFixture = async () => makeCostSnapshot();

const serializedWorkbook = async () => {
  const bytes = await buildCostWorkbookBytes(await loadFixture());
  assert.ok(bytes.byteLength > 0);
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  await workbook.xlsx.load(arrayBuffer);
  return workbook;
};

const headerColumn = (sheet, header) => {
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (sheet.getCell(4, column).value === header) return column;
  }
  throw new Error(`${sheet.name} is missing header: ${header}`);
};

const findRow = (sheet, column, expected) => {
  for (let row = 5; row <= sheet.rowCount; row += 1) {
    if (sheet.getCell(row, column).value === expected) return row;
  }
  throw new Error(`${sheet.name} is missing row value: ${expected}`);
};

const formulaResult = (cell) => {
  assert.equal(typeof cell.value, 'object');
  assert.ok(cell.value && 'formula' in cell.value);
  return cell.value.result ?? 0;
};

test('shared money rounding is upward at two decimals', () => {
  assert.equal(roundMoney(18848.282), 18848.29);
  assert.equal(roundMoney(100.00000000001), 100);
});

test('v2 workbook has nine stable sheets and reconciles after serialization', async () => {
  const workbook = await serializedWorkbook();
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    EXPECTED_SHEETS,
  );

  const detail = workbook.getWorksheet('01_Cost_Detail');
  assert.ok(detail);
  const detailHeaders = Array.from(
    { length: detail.columnCount },
    (_, index) => detail.getCell(4, index + 1).value,
  );
  assert.deepEqual(detailHeaders.slice(6, 13), [
    'RE Type ID',
    'RE Code',
    'RE Type Name',
    'RE Category',
    'RE Level ID',
    'RE Level Code',
    'RE Level Name',
  ]);
  assert.equal(
    detailHeaders.some(
      (header) => typeof header === 'string' && header.includes('Y0'),
    ),
    false,
  );
  assert.deepEqual(
    detailHeaders.filter(
      (header) => typeof header === 'string' && /^Y[1-5] Sites$/.test(header),
    ),
    ['Y1 Sites', 'Y2 Sites', 'Y3 Sites', 'Y4 Sites', 'Y5 Sites'],
  );

  const sourceKindColumn = headerColumn(detail, 'Source Kind');
  const directCostColumn = headerColumn(detail, 'Direct Cost');
  const statementCodeColumn = headerColumn(detail, 'Statement Code');
  const generatedCodes = [];
  for (let row = 5; row <= detail.rowCount; row += 1) {
    if (detail.getCell(row, sourceKindColumn).value !== 'COST_INPUT') {
      const direct = detail.getCell(row, directCostColumn);
      assert.ok(
        Number(direct.formula ? formulaResult(direct) : direct.value) > 0,
      );
      const statementCode = detail.getCell(row, statementCodeColumn).value;
      assert.equal(typeof statementCode, 'string');
      generatedCodes.push(statementCode);
    }
  }
  assert.equal(generatedCodes.includes('2.3.1.2'), false);
  assert.equal(generatedCodes.includes('2.3.4.1'), false);

  const totalCostColumn = headerColumn(detail, 'Total Cost');
  assert.match(String(detail.getCell(5, totalCostColumn).value.formula), /SUM/);
  assert.equal(formulaResult(detail.getCell(5, totalCostColumn)), 218400);
  assert.match(detail.getColumn(totalCostColumn).numFmt, /S\$/);

  const statement = workbook.getWorksheet('06_Cost_Statement');
  assert.ok(statement);
  const statementCode = headerColumn(statement, 'Code');
  const statementAmount = headerColumn(statement, 'Cost (SGD)');
  const salesRow = findRow(statement, statementCode, '2');
  const inHouseRow = findRow(statement, statementCode, '2.3.1.1');
  const salesCost = formulaResult(statement.getCell(salesRow, statementAmount));
  const inHouseCost = formulaResult(
    statement.getCell(inHouseRow, statementAmount),
  );
  assert.ok(salesCost > inHouseCost);
  assert.equal(inHouseCost, 1_065_082.81);

  for (const sheetName of [
    '02_Summary_Scope',
    '03_Summary_BU',
    '04_Summary_RE_Type',
  ]) {
    const sheet = workbook.getWorksheet(sheetName);
    const totalRow = findRow(sheet, 1, 'TOTAL');
    assert.equal(
      formulaResult(sheet.getCell(totalRow, headerColumn(sheet, 'Sales Cost'))),
      salesCost,
    );
  }

  const grade = workbook.getWorksheet('05_Summary_RE_Level');
  assert.ok(grade);
  const gradeIdColumn = headerColumn(grade, 'RE Type ID');
  const gradeCodeColumn = headerColumn(grade, 'RE Type Code');
  const gradeCostColumn = headerColumn(grade, 'In-house Labour Cost');
  const gradeTotalRow = findRow(grade, gradeIdColumn, 'TOTAL');
  assert.equal(
    formulaResult(grade.getCell(gradeTotalRow, gradeCostColumn)),
    inHouseCost,
  );
  const gradeCodes = [];
  for (let row = 5; row < gradeTotalRow; row += 1) {
    gradeCodes.push(grade.getCell(row, gradeCodeColumn).value);
  }
  assert.deepEqual(gradeCodes, ['HQ-L2', 'HQ-L3', 'LOCAL-L2']);

  const reconciliation = workbook.getWorksheet('07_Reconciliation');
  assert.ok(reconciliation);
  const checkIdColumn = headerColumn(reconciliation, 'Check ID');
  const statusColumn = headerColumn(reconciliation, 'Status');
  for (let row = 5; row <= reconciliation.rowCount; row += 1) {
    const checkId = reconciliation.getCell(row, checkIdColumn).value;
    if (
      (typeof checkId === 'string' && checkId.startsWith('R')) ||
      checkId === 'OVERALL'
    ) {
      assert.equal(
        formulaResult(reconciliation.getCell(row, statusColumn)),
        'PASS',
      );
    }
  }

  const assumptions = workbook.getWorksheet('08_Assumptions');
  assert.ok(assumptions);
  assert.equal(assumptions.getColumn(2).values.includes('Y0'), false);
  for (const bucket of ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']) {
    assert.ok(assumptions.getColumn(2).values.includes(bucket));
  }
});

test('full export links editable effort, captured rates and HQ travel into existing summary formulas', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].category = 'Phase 1';
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCostWorkbookBytes(snapshot));
  const detail = workbook.getWorksheet('01_Cost_Detail');
  const assumptions = workbook.getWorksheet('08_Assumptions');
  const sourceRow = snapshot.costRows[0];
  const row = findRow(detail, headerColumn(detail, 'Line ID'), sourceRow.id);
  const cost = detail.getCell(row, headerColumn(detail, 'Y1 Cost'));
  assert.ok(cost.formula.includes("'08_Assumptions'!$G$"));
  assert.equal(formulaResult(cost), sourceRow.years[0].cost);
  assert.equal(
    detail.getCell(row, headerColumn(detail, 'Category')).value,
    'Phase 1',
  );
  const travelRow = findRow(
    detail,
    headerColumn(detail, 'Source Kind'),
    'HQ_TRAVEL',
  );
  assert.ok(
    detail
      .getCell(travelRow, headerColumn(detail, 'Direct Cost'))
      .formula.includes("'08_Assumptions'!$C$"),
  );
  const months = findRow(assumptions, 2, 'Months');
  assert.match(assumptions.getCell(months, 3).formula, /SUM\(\$M\$/);
  assert.ok(assumptions.getCell(row, 13).formula.includes("'01_Cost_Detail'!"));
  const travel = findRow(assumptions, 2, 'Total travel');
  assert.match(assumptions.getCell(travel, 3).formula, /IF\(AND/);
  assert.equal(
    formulaResult(assumptions.getCell(travel, 3)),
    formulaResult(
      detail.getCell(travelRow, headerColumn(detail, 'Direct Cost')),
    ),
  );
});

test('full summaries use exact hidden numeric keys for wildcard, case and long labels', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows = snapshot.costRows.slice(0, 2);
  const labels = [
    'Deployment *?~' + 'A'.repeat(300),
    'deployment *?~' + 'a'.repeat(300),
  ];
  snapshot.costRows.forEach((row, index) => {
    row.scope = labels[index];
    row.bu = labels[index];
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCostWorkbookBytes(snapshot));
  const detail = workbook.getWorksheet('01_Cost_Detail');
  for (const [dimension, sheetName] of [
    ['scope', '02_Summary_Scope'],
    ['bu', '03_Summary_BU'],
  ]) {
    const column = headerColumn(detail, `${dimension} exact key`);
    assert.equal(detail.getColumn(column).hidden, true);
    const keys = snapshot.costRows.map((source) =>
      Number(
        detail.getCell(
          findRow(detail, headerColumn(detail, 'Line ID'), source.id),
          column,
        ).value,
      ),
    );
    assert.ok(keys.every(Number.isInteger));
    assert.notEqual(keys[0], keys[1]);
    const summary = workbook.getWorksheet(sheetName);
    labels.forEach((label, index) => {
      const row = findRow(summary, 1, label);
      const cell = summary.getCell(row, headerColumn(summary, 'Sales Cost'));
      const keyColumn = detail.getColumn(column).letter;
      assert.ok(
        cell.formula.includes(
          `'01_Cost_Detail'!$${keyColumn}$5:$${keyColumn}$${detail.rowCount},${keys[index]})`,
        ),
      );
      assert.ok(
        !cell.formula.includes(`$A${row}`),
        'label text must never be used as a SUMIFS criterion',
      );
      assert.equal(
        formulaResult(cell),
        roundMoney(
          snapshot.costRows[index].years.reduce(
            (sum, year) => sum + year.cost,
            0,
          ),
        ),
      );
    });
  }
});

test('full HQ travel formulas stay bounded for 500 rows and cache every calculation correctly', async () => {
  const snapshot = makeCostSnapshot();
  const source = snapshot.costRows.find(
    (row) =>
      snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
        ?.pool === 'HQ',
  );
  snapshot.costRows = Array.from({ length: 500 }, (_, index) => ({
    ...structuredClone(source),
    id: `hq-${index}`,
  }));
  const workbook = await buildCostWorkbook(snapshot);
  const assumptions = workbook.getWorksheet('08_Assumptions');
  const expected = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  for (const [label, amount] of [
    ['HQ mandays', expected.hqMandays],
    ['Months', expected.months],
    ['Total travel', expected.totalCost],
  ])
    assert.equal(
      formulaResult(assumptions.getCell(findRow(assumptions, 2, label), 3)),
      amount,
    );
  assert.equal(
    formulaResult(assumptions.getCell('P5')),
    expected.allowanceCost,
  );
  assert.equal(formulaResult(assumptions.getCell('Q5')), expected.airfareCost);
  for (let column = 12; column <= 17; column++)
    assert.equal(assumptions.getColumn(column).hidden, true);
  for (const sheet of workbook.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.formula)
          assert.ok(
            cell.formula.length <= 8192,
            `${sheet.name}!${cell.address} exceeds Excel's formula limit: ${cell.formula.length}`,
          );
      }),
    );
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    EXPECTED_SHEETS,
  );
});

test('full formulas keep zero travel and rate-driven EHS connected for later quantity edits', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.travelSettings.enabled = true;
  snapshot.manualCosts.otherServiceRate = 0.05;
  snapshot.manualCosts.settlement = 100;
  snapshot.costRows = snapshot.costRows.filter(
    (row) =>
      snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
        ?.pool === 'HQ',
  );
  assert.ok(snapshot.costRows.length);
  snapshot.costRows.forEach((row) => {
    row.years.forEach((year) => {
      year.sites = 0;
      year.mandays = 0;
    });
  });
  snapshot.costRows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCostWorkbookBytes(snapshot));
  const detail = workbook.getWorksheet('01_Cost_Detail');
  const travel = findRow(
    detail,
    headerColumn(detail, 'Source Kind'),
    'HQ_TRAVEL',
  );
  const travelCost = detail.getCell(
    travel,
    headerColumn(detail, 'Direct Cost'),
  );
  assert.equal(formulaResult(travelCost), 0);
  assert.match(travelCost.formula, /08_Assumptions/);
  const ehs = findRow(
    detail,
    headerColumn(detail, 'Statement Code'),
    '2.3.4.2',
  );
  const formula = detail.getCell(
    ehs,
    headerColumn(detail, 'Direct Cost'),
  ).formula;
  assert.match(formula, /\*0\.05/);
  assert.ok(
    !formula.includes('06_Cost_Statement'),
    'EHS must not create a circular statement dependency',
  );
});
