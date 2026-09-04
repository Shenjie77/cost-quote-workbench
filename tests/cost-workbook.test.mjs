/**
 * Workbook-contract regression tests. The XLSX is serialized and reloaded so
 * formulas, cached results, and worksheet order are verified after ZIP/XML.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import ExcelJS from 'exceljs';

import { roundMoney } from '../features/cost/domain.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
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
      assert.ok(Number(detail.getCell(row, directCostColumn).value) > 0);
      const statementCode = detail.getCell(row, statementCodeColumn).value;
      assert.equal(typeof statementCode, 'string');
      generatedCodes.push(statementCode);
    }
  }
  assert.equal(generatedCodes.includes('2.3.1.2'), false);
  assert.equal(generatedCodes.includes('2.3.4.1'), false);

  const totalCostColumn = headerColumn(detail, 'Total Cost');
  assert.match(String(detail.getCell(5, totalCostColumn).value.formula), /SUM/);
  assert.equal(formulaResult(detail.getCell(5, totalCostColumn)), 184000);
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
  assert.equal(inHouseCost, 1_474_000);

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
