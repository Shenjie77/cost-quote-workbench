/** Verify internal formula exports independently of real project state or browser downloads. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';
import {
  buildCombinedQuoteWorkbook,
  buildCombinedQuoteWorkbookBytes,
} from '../features/quote/export-combined-workbook.ts';
import { buildSimpleCostWorkbook } from '../features/cost/export-simple-workbook.ts';
import { calculateBuCostAllocation } from '../features/quote/profit-share.ts';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';
import { lineCostAmounts } from '../features/quote/line-pricing.ts';

/** Mixed GP and saved-price rows exercise formula intent without converting commercial overrides. */
export const combinedFixture = () => ({
  costSnapshot: makeCostSnapshot(),
  pricing: {
    ...initialPricingSettings,
    discount: 12.34,
    lineMode: 'manual',
    manualPricingBasis: 'line-gp',
    lineSourceMode: 'manual',
    manualLines: [
      {
        id: 'gp',
        description: 'Engineering',
        quantity: 0.7,
        unit: 'lot',
        unitPrice: 0,
        costWeight: 2,
        targetGrossMargin: 50,
      },
      {
        id: 'fixed',
        description: 'Service',
        quantity: 2,
        unit: 'lot',
        unitPrice: 10000.1234,
        costWeight: 1,
        priceFixed: true,
      },
    ],
  },
});

test('combined export includes the complete Simple Cost workbook and linked quote formulas with exact cached amounts', async () => {
  const input = combinedFixture();
  const before = structuredClone(input);
  const allocation = calculateBuCostAllocation(input.costSnapshot);
  const expected = calculatePricing(
    allocation.totalCost,
    input.pricing,
    allocation,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCombinedQuoteWorkbookBytes(input));
  assert.deepEqual(input, before);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, 'Quotation Details');
  const simple = await buildSimpleCostWorkbook(input.costSnapshot);
  for (const original of simple.worksheets)
    assert.ok(workbook.getWorksheet(original.name));
  assert.equal(sheet.getCell('C5').result, expected.cost);
  assert.match(sheet.getCell('C5').formula, /^'Cost Statement'!B/);
  assert.equal(sheet.getCell('I5').result, expected.quoteBeforeTax);
  assert.equal(sheet.getCell('K5').result, expected.grossMarginPercent / 100);
  const costs = lineCostAmounts(expected.allocatedManualLines, expected.cost);
  for (const [index, line] of expected.allocatedManualLines.entries()) {
    const row = index + 9;
    assert.equal(sheet.getCell(`E${row}`).result, costs[index]);
    assert.equal(sheet.getCell(`I${row}`).result, line.unitPrice);
    assert.ok(sheet.getCell(`J${row}`).formula.includes(`C${row}*I${row}`));
    assert.ok(
      sheet.getCell(`I${row}`).formula.includes('Pricing Calculations'),
    );
  }
  assert.equal(sheet.getCell('L9').value, 'Target GP');
  assert.equal(sheet.getCell('L10').value, 'Saved price');
  assert.equal(sheet.getCell('M10').value, 10000.1234);
  assert.equal(workbook.getWorksheet('Pricing Calculations').state, 'hidden');
  assert.match(
    workbook.getWorksheet('Cost Detail').getCell('G6').formula,
    /J6,M6,P6,S6,V6/,
  );
  assert.ok(workbook.getWorksheet('Cost Statement').getCell('B22').formula);
  assert.equal(sheet.getCell('E5').numFmt, '0.00%');
});

test('combined export freezes inputs before async work and rejects invalid pricing or costs', async () => {
  const input = combinedFixture();
  const pending = buildCombinedQuoteWorkbook(input);
  input.pricing.manualLines[0].description = 'Changed after click';
  input.costSnapshot.project.name = 'Changed after click';
  const workbook = await pending;
  assert.equal(
    workbook.getWorksheet('Quotation Details').getCell('B9').value,
    'Engineering',
  );
  assert.ok(
    !workbook
      .getWorksheet('Quotation Details')
      .getCell('A2')
      .value.includes('Changed'),
  );
  const invalid = combinedFixture();
  invalid.pricing.manualLines[0].targetGrossMargin = 100;
  await assert.rejects(buildCombinedQuoteWorkbook(invalid), /GP/);
  invalid.pricing.manualLines[0].targetGrossMargin = 50;
  invalid.costSnapshot.costRows[0].years[0].cost = -1;
  await assert.rejects(buildCombinedQuoteWorkbook(invalid), /validation|cost/i);
});

test('combined statement links structured Subcon and the complete EHS base without losing text codes', async () => {
  const input = combinedFixture();
  input.costSnapshot.manualCosts.otherServiceRate = 0.01;
  input.costSnapshot.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'subcon-1',
        code: '00017',
        description: 'Installation',
        bu: 'Network',
        unit: 'piece',
        unitPrice: 12.34,
        currency: 'SGD',
        quantities: [1, 2, 0, 0, 0],
      },
    ],
  };
  const workbook = await buildCombinedQuoteWorkbook(input);
  const statement = workbook.getWorksheet('Cost Statement');
  const subcon = workbook.getWorksheet('Subcon Detail');
  assert.equal(subcon.getCell('B5').value, '00017');
  assert.equal(subcon.getCell('I5').formula, 'SUM(K5,M5,O5,Q5,S5)');
  assert.equal(subcon.getCell('I6').formula, 'SUM(I5:I5)');
  assert.equal(subcon.getCell('K6').formula, 'SUM(K5:K5)');
  assert.ok(statement.getCell('B16').formula.includes("'Subcon Detail'!I6"));
  assert.ok(statement.getCell('B20').formula.includes('SUM(B12,B16,B17)*$E$4'));
  assert.equal(statement.getCell('E4').value, 0.01);
});

test('generated and legacy quotation modes preserve captured prices and complete cost allocation', async () => {
  for (const mode of ['single', 'scope', 'item', 'manual']) {
    const input = combinedFixture();
    input.pricing.lineMode = mode;
    delete input.pricing.manualPricingBasis;
    const allocation = calculateBuCostAllocation(input.costSnapshot);
    const result = calculatePricing(
      allocation.totalCost,
      input.pricing,
      allocation,
    );
    const workbook = await buildCombinedQuoteWorkbook(input);
    const sheet = workbook.getWorksheet('Quotation Details');
    assert.equal(sheet.getCell('I5').result, result.quoteBeforeTax);
    assert.equal(sheet.getCell(`E${sheet.rowCount}`).result, result.cost);
    assert.equal(sheet.getCell(`J${sheet.rowCount}`).result, result.listPrice);
  }
});

/** Every emitted formula must refer only to worksheets actually included in the file. */
function assertSheetReferences(workbook) {
  const names = new Set(workbook.worksheets.map((sheet) => sheet.name));
  for (const sheet of workbook.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        for (const match of (cell.formula || '').matchAll(/'([^']+)'!/g))
          assert.ok(
            names.has(match[1]),
            `${sheet.name}!${cell.address} refers to omitted ${match[1]}`,
          );
      }),
    );
}

test('combined export supports summary-only and mixed selections with mandatory statement and no missing-sheet formulas', async () => {
  const input = combinedFixture();
  input.costSnapshot.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'selected-subcon',
        code: '00017',
        description: 'Installation',
        bu: 'Network',
        unit: 'lot',
        unitPrice: 12.34,
        currency: 'SGD',
        quantities: [1, 2, 0, 0, 0],
      },
    ],
  };
  const expected = calculateBuCostAllocation(input.costSnapshot).totalCost;
  for (const selectedSheets of [
    [],
    ['Summary Scope'],
    ['Cost Detail'],
    ['Subcon Detail'],
    ['Cost Detail', 'Subcon Detail'],
  ]) {
    const workbook = await buildCombinedQuoteWorkbook({
      ...input,
      selectedSheets,
    });
    assert.deepEqual(
      new Set(workbook.worksheets.map((sheet) => sheet.name)),
      new Set([
        'Quotation Details',
        'Cost Statement',
        'Pricing Calculations',
        ...selectedSheets,
      ]),
    );
    assert.equal(
      workbook.getWorksheet('Quotation Details').getCell('C5').result,
      expected,
    );
    assertSheetReferences(workbook);
    const statement = workbook.getWorksheet('Cost Statement');
    assert.equal(
      Boolean(statement.getCell('B13').formula),
      selectedSheets.includes('Cost Detail'),
    );
  }
});

test('combined export captures sheet choices at click time and rejects unknown names', async () => {
  const input = { ...combinedFixture(), selectedSheets: ['Summary Scope'] };
  const pending = buildCombinedQuoteWorkbook(input);
  input.selectedSheets.push('Summary BU');
  const workbook = await pending;
  assert.ok(workbook.getWorksheet('Summary Scope'));
  assert.equal(workbook.getWorksheet('Summary BU'), undefined);
  await assert.rejects(
    buildCombinedQuoteWorkbook({
      ...combinedFixture(),
      selectedSheets: ['Unknown sheet'],
    }),
  );
});
