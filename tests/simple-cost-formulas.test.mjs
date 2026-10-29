import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCostSnapshot } from './helpers.mjs';
import { buildSimpleCostWorkbook } from '../features/cost/export-simple-workbook.ts';
import {
  getHQTravelSummary,
  getCostStatementValues,
  getY1Year,
} from '../features/cost/domain.ts';

const cached = (cell) => (cell.formula ? (cell.result ?? 0) : cell.value);
function assertReferences(workbook) {
  for (const sheet of workbook.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (!cell.formula) return;
        assert.ok(
          cell.formula.length <= 8192,
          `${sheet.name}!${cell.address} exceeds Excel formula length`,
        );
        for (const match of cell.formula.matchAll(/'([^']+)'!/g))
          assert.ok(
            workbook.getWorksheet(match[1]),
            `${sheet.name}!${cell.address} refers to missing ${match[1]}`,
          );
        assert.ok(
          Number.isFinite(Number(cell.result ?? 0)),
          `${sheet.name}!${cell.address} invalid cached result`,
        );
      }),
    );
}

test('category groups keep wildcard characters literal and live formulas use quantity, captured rates and HQ allocation', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].groupName = 'Delivery *';
  snapshot.costRows[0].category = 'A?~';
  snapshot.costRows[1].groupName = 'Delivery *';
  snapshot.costRows[1].category = 'AB~';
  snapshot.costRows[0].scope = 'Scope *?~';
  const workbook = await buildSimpleCostWorkbook(snapshot);
  const detail = workbook.getWorksheet('Cost Detail');
  assert.equal(detail.getCell('W6').value, 'A?~');
  assert.match(detail.getCell('I6').formula, /H6/);
  assert.match(detail.getCell('J6').formula, /Cost Calculations/);
  const calc = workbook.getWorksheet('Cost Calculations');
  assert.equal(calc.state, 'hidden');
  assert.match(calc.getCell('G5').formula, /D5\*F5/);
  assert.match(calc.getCell('D5').formula, /Cost Detail/);
  assert.match(calc.getCell('M5').formula, /\$F\$3/);
  const group = workbook.getWorksheet('Summary Group');
  assert.equal(group.getCell('A5').value, 'A?~');
  assert.equal(group.getCell('A6').value, 'AB~');
  assert.match(group.getCell('E5').formula, /AD5:AD\d+,1/);
  assert.match(group.getCell('E5').formula, /AE5:AE\d+,1/);
  assert.match(group.getCell('E6').formula, /AE5:AE\d+,2/);
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const total = getCostStatementValues(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  ).totalWithRisk;
  assert.equal(cached(group.getCell(group.rowCount, 11)), total);
  assertReferences(workbook);
});

test('summary criteria preserve case-sensitive labels and cannot collide through category delimiters', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].scope = 'S'.repeat(500) + '*?';
  snapshot.costRows[1].scope = 's'.repeat(500) + '*?';
  snapshot.costRows[0].category = 'Hardware';
  snapshot.costRows[1].category = 'hardware';
  snapshot.costRows[0].groupName = snapshot.costRows[1].groupName = 'Delivery';
  const workbook = await buildSimpleCostWorkbook(snapshot);
  const calc = workbook.getWorksheet('Cost Calculations');
  const groups = workbook.getWorksheet('Summary Group');
  assert.notEqual(groups.getCell('E5').formula, groups.getCell('E6').formula);
  const categoryKeys = new Map();
  const scopeKeys = new Map();
  for (let n = 5; n <= calc.rowCount; n++) {
    categoryKeys.set(calc.getCell(`X${n}`).value, calc.getCell(`AE${n}`).value);
    scopeKeys.set(calc.getCell(`B${n}`).value, calc.getCell(`AA${n}`).value);
  }
  assert.notEqual(categoryKeys.get('Hardware'), categoryKeys.get('hardware'));
  assert.notEqual(
    scopeKeys.get(snapshot.costRows[0].scope),
    scopeKeys.get(snapshot.costRows[1].scope),
  );
  for (const sheet of ['Summary Scope', 'Summary Group'])
    workbook.getWorksheet(sheet).eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.formula) assert.ok(!cell.formula.includes('S'.repeat(500)));
      }),
    );
  const { buildGroupCostSummary } =
    await import('../features/cost/group-cost-summary.ts');
  snapshot.costRows[0].category = 'A:group:B';
  snapshot.costRows[0].groupName = 'C';
  snapshot.costRows[1].category = 'A';
  snapshot.costRows[1].groupName = 'B:group:C';
  const items = buildGroupCostSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
    snapshot.manualCosts,
    snapshot.subcontractCost,
  );
  const keys = items
    .filter((item) => item.kind === 'Group')
    .map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
  assertReferences(workbook);
});

test('500 BOQ items retain bounded live formulas for subtotals, site rounding and repeated scope groups', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.subcontractCost = {
    mode: 'site-types',
    lines: [],
    siteTypes: [
      {
        id: 'site',
        name: 'Large site',
        sites: [2, 3, 0, 0, 0],
        lines: Array.from({ length: 501 }, (_, i) => ({
          id: `item-${i}`,
          code: `00${i}`,
          description: i % 2 ? 'Installation *' : 'Installation ?',
          bu: 'BU~',
          unit: 'pc',
          unitPrice: 0.013,
          currency: 'SGD',
          quantityPerSite: 1.2345,
          category: 'Phase 2',
        })),
      },
    ],
  };
  const workbook = await buildSimpleCostWorkbook(snapshot);
  const detail = workbook.getWorksheet('Subcon Detail');
  assert.equal(detail.getCell('T5').value, 'Phase 2');
  assert.match(detail.getCell('K5').formula, /U5\*/);
  assert.match(detail.getCell('U5').formula, /F5\*G5/);
  assert.equal(detail.getCell('U5').result, 0.02);
  assert.match(
    workbook.getWorksheet('Subcon Site Types').getCell('B5').formula,
    /U5:U505/,
  );
  assert.match(
    workbook.getWorksheet('Cost Statement').getCell('B16').formula,
    /I506/,
  );
  assert.match(
    workbook.getWorksheet('Summary Subcon').getCell('D5').formula,
    /SUMIF/,
  );
  assertReferences(workbook);
});

test('zero manual accounts remain linked and selective export never references omitted inputs', async () => {
  const snapshot = makeCostSnapshot();
  for (const selection of [
    undefined,
    ['Cost Statement', 'Summary Group', 'Summary Scope'],
    ['Summary Scope'],
    ['Cost Detail'],
  ]) {
    const workbook = await buildSimpleCostWorkbook(
      snapshot,
      undefined,
      selection,
    );
    assertReferences(workbook);
    const summary = workbook.getWorksheet('Summary Scope');
    if (summary && workbook.getWorksheet('Cost Statement')) {
      let risk;
      summary.eachRow((row) => {
        if (row.getCell(1).text.startsWith('15 ·')) risk = row;
      });
      assert.ok(risk);
      assert.match(risk.getCell(4).formula, /'Cost Statement'!B21/);
    }
    if (selection && !selection.includes('Cost Detail'))
      assert.equal(workbook.getWorksheet('Cost Calculations'), undefined);
  }
});
