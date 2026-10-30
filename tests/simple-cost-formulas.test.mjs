import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCostSnapshot } from './helpers.mjs';
import { buildSimpleCostWorkbook } from '../features/cost/export-simple-workbook.ts';
import {
  getHQTravelSummary,
  getCostStatementValues,
  getY1Year,
} from '../features/cost/domain.ts';

const groupRow = (sheet, category, kind = 'Group') => {
  let match;
  sheet.eachRow((row) => {
    if (
      row.getCell(1).value === category &&
      (kind === 'Subcontract'
        ? row.getCell(2).value === 'Subcontract' &&
          row.getCell(3).value === 'Project'
        : row.getCell(3).value === kind)
    )
      match = row;
  });
  assert.ok(match, `Missing ${kind} row for ${category}`);
  return match;
};

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
  const firstGroup = groupRow(group, 'A?~');
  const secondGroup = groupRow(group, 'AB~');
  assert.match(firstGroup.getCell(5).formula, /AD5:AD\d+,1/);
  assert.match(firstGroup.getCell(5).formula, /AE5:AE\d+,1/);
  assert.match(secondGroup.getCell(5).formula, /AE5:AE\d+,2/);
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
  assert.notEqual(
    groupRow(groups, 'Hardware').getCell(5).formula,
    groupRow(groups, 'hardware').getCell(5).formula,
  );
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

test('category subtotals link classified subcontract sources and grand total counts each section once', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows = snapshot.costRows.filter(
    (row) =>
      snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
        ?.category !== 'subcontract',
  );
  snapshot.costRows[0].category = 'Hardware';
  const legacy = structuredClone(snapshot.costRows[0]);
  legacy.id = 'classified-legacy';
  legacy.reTypeId = snapshot.resourceTypes.find(
    (resource) => resource.category === 'subcontract',
  ).id;
  legacy.category = 'hardware';
  legacy.years = legacy.years.map((year, index) => ({
    ...year,
    cost: index ? 0 : 100,
  }));
  snapshot.costRows.push(legacy);
  snapshot.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'a',
        category: 'Hardware',
        code: 'a',
        description: 'One',
        bu: 'BU',
        unit: 'lot',
        currency: 'SGD',
        unitPrice: 10,
        quantities: [2, 0, 0, 0, 0],
      },
      {
        id: 'b',
        category: 'hardware',
        code: 'b',
        description: 'Two',
        bu: 'BU',
        unit: 'lot',
        currency: 'SGD',
        unitPrice: 20,
        quantities: [3, 0, 0, 0, 0],
      },
      {
        id: 'c',
        code: 'c',
        description: 'Three',
        bu: 'BU',
        unit: 'lot',
        currency: 'SGD',
        unitPrice: 30,
        quantities: [4, 0, 0, 0, 0],
      },
    ],
  };
  for (const selection of [
    undefined,
    ['Summary Group', 'Cost Statement'],
    ['Summary Group'],
  ]) {
    const workbook = await buildSimpleCostWorkbook(
      snapshot,
      undefined,
      selection,
    );
    const group = workbook.getWorksheet('Summary Group');
    const upper = groupRow(group, 'Hardware', 'Subcontract');
    const lower = groupRow(group, 'hardware', 'Subcontract');
    assert.equal(cached(upper.getCell(7)), 20);
    assert.equal(cached(lower.getCell(7)), 160);
    let project,
      subtotalCount = 0;
    group.eachRow((row) => {
      if (
        row.getCell(1).value === 'Uncategorized' &&
        row.getCell(2).value === 'Subcontract'
      )
        project = row;
      if (row.getCell(3).value === 'Subtotal') {
        subtotalCount++;
        assert.equal(
          row.getCell(11).formula,
          `SUM(E${row.number}:J${row.number})`,
        );
      }
    });
    assert.ok(subtotalCount >= 3);
    assert.equal(cached(project.getCell(7)), 120);
    assert.match(project.getCell(7).formula, /Category Calculations/);
    assert.match(group.getCell(group.rowCount, 11).formula, /"Subtotal"/);
    if (!selection) {
      const helpers = workbook.getWorksheet('Category Calculations');
      assert.match(helpers.getCell('D5').formula, /'Subcon Detail'!X5:X7/);
      assert.match(
        helpers.getCell('D6').formula,
        /'Cost Calculations'!AE5:AE\d+/,
      );
    }
    assertReferences(workbook);
  }
});

test('subcontract-only categories remain live without any personnel calculation sheet', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows = [];
  snapshot.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'a',
        category: 'Subcon only',
        code: '001',
        description: 'Package',
        bu: 'BU',
        unit: 'lot',
        currency: 'SGD',
        unitPrice: 15,
        quantities: [2, 0, 0, 0, 0],
      },
    ],
  };
  const workbook = await buildSimpleCostWorkbook(snapshot);
  const group = workbook.getWorksheet('Summary Group');
  const item = groupRow(group, 'Subcon only', 'Subcontract');
  assert.equal(cached(item.getCell(7)), 30);
  assert.match(
    workbook.getWorksheet('Category Calculations').getCell('D5').formula,
    /SUMIF\('Subcon Detail'/,
  );
  assert.equal(workbook.getWorksheet('Cost Calculations'), undefined);
  assertReferences(workbook);
});

test('saved personnel layouts preserve zero formula caches in serialized Excel cells', async () => {
  const { default: JSZip } = await import('jszip');
  const { buildCombinedQuoteWorkbook } =
    await import('../features/quote/export-combined-workbook.ts');
  const { initialPricingSettings } =
    await import('../features/quote/domain.ts');
  const snapshot = makeCostSnapshot();
  snapshot.costRows.forEach((row) => {
    row.groupName = 'Delivery';
    row.years[4] = { ...row.years[4], sites: 0, mandays: 0, cost: 0 };
  });
  for (const grouped of [true, false]) {
    const layout = {
      grouped,
      yearIndex: 'all',
      columns: [
        'scope',
        'reType',
        'totalSites',
        'totalMd',
        'totalCost',
        'Y5:sites',
        'Y5:mandays',
        'Y5:cost',
      ],
    };
    for (const combined of [false, true]) {
      const book = combined
        ? await buildCombinedQuoteWorkbook({
            costSnapshot: snapshot,
            pricing: initialPricingSettings,
            personnelLayout: layout,
          })
        : await buildSimpleCostWorkbook(snapshot, layout);
      assertReferences(book);
      const detail = book.getWorksheet('Cost Detail');
      for (const column of [6, 7, 8])
        assert.equal(detail.getCell(detail.rowCount, column).result ?? 0, 0);
      const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
      for (const [name, entry] of Object.entries(zip.files)) {
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
        const xml = await entry.async('string');
        assert.doesNotMatch(xml, /<v>(?:NaN|[-+]?Infinity)<\/v>/, name);
      }
    }
  }
});
