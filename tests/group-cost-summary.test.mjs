import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateHQTravel,
  costRowsIncludingHQTravel,
  buildGroupCostSummary,
  buildGroupCostSections,
  buildGroupCostSheetLayout,
} from '../features/cost/group-cost-summary.ts';
import {
  getHQTravelSummary,
  getCostStatementValues,
  recalculateCostRows,
  roundMoney,
  totalRowCost,
} from '../features/cost/domain.ts';
import { buildSimpleCostWorkbook } from '../features/cost/export-simple-workbook.ts';
import { makeCostSnapshot } from './helpers.mjs';
import { buildCombinedQuoteWorkbook } from '../features/quote/export-combined-workbook.ts';
import { initialPricingSettings } from '../features/quote/domain.ts';

function fixture() {
  const s = makeCostSnapshot();
  const hq = s.resourceTypes.find((r) => r.pool === 'HQ');
  const local = s.resourceTypes.find((r) => r.pool === 'LOCAL');
  s.resourceTypes.push({
    ...hq,
    id: 'different-conversion',
    code: 'HQ-TEST',
    mandaysPerMonth: 10,
  });
  hq.mandaysPerMonth = 20;
  s.travelSettings = {
    enabled: true,
    monthlyAllowance: 100,
    airfarePerTrip: 90,
    trips: 1,
  };
  s.costRows = [
    ['a', 'First', hq.id, [10, 0, 0, 0, 0]],
    ['b', 'Second', 'different-conversion', [0, 10, 0, 0, 0]],
    ['c', '', local.id, [10, 0, 0, 0, 0]],
  ].map(([id, groupName, reTypeId, md]) => ({
    id,
    groupName,
    scope: 'Scope',
    bu: 'MBB',
    reTypeId,
    inputMode: 'mandays',
    mdPerSite: 0,
    years: md.map((mandays, index) => ({
      bucket: `Y${index + 1}`,
      mandays,
      sites: 0,
      cost: 0,
    })),
  }));
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  s.manualCosts = {
    ...s.manualCosts,
    otherServiceRate: 0.01,
    riskContingency: 100,
    carFee: 5,
    settlement: 4,
    nonInHouseLabour: 3,
    inlandLogistics: 2,
    localPurchasedEquipment: 1,
  };
  s.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 's',
        code: '001',
        description: 'Package',
        bu: 'MBB',
        unit: 'lot',
        currency: 'SGD',
        unitPrice: 25,
        quantities: [2, 0, 0, 0, 0],
      },
    ],
  };
  return s;
}

test('HQ monthly allowance follows resource conversion while airfare follows effort across groups and years', () => {
  const s = fixture(),
    original = structuredClone(s);
  const allocation = allocateHQTravel(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
  );
  assert.deepEqual(allocation.get('a'), [95, 0, 0, 0, 0]);
  assert.deepEqual(allocation.get('b'), [0, 145, 0, 0, 0]);
  assert.deepEqual(allocation.get('c'), [0, 0, 0, 0, 0]);
  const display = costRowsIncludingHQTravel(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
  );
  assert.equal(
    totalRowCost(display[0]),
    roundMoney(totalRowCost(s.costRows[0]) + 95),
  );
  assert.deepEqual(s, original);
});

test('penny allocation reconciles with tiny effort, stable row order, disabled and empty HQ cases', () => {
  const s = fixture();
  s.travelSettings.monthlyAllowance = 0.01;
  s.travelSettings.airfarePerTrip = 0.01;
  s.costRows = Array.from({ length: 37 }, (_, index) => ({
    ...structuredClone(s.costRows[index % 2]),
    id: String(index),
  }));
  const a = allocateHQTravel(s.costRows, s.resourceTypes, s.travelSettings);
  assert.equal(
    roundMoney([...a.values()].flat().reduce((x, y) => x + y, 0)),
    getHQTravelSummary(s.costRows, s.resourceTypes, s.travelSettings).totalCost,
  );
  const reordered = allocateHQTravel(
    [...s.costRows].reverse(),
    s.resourceTypes,
    s.travelSettings,
  );
  for (const [id, values] of a) assert.deepEqual(reordered.get(id), values);
  for (const settings of [{ ...s.travelSettings, enabled: false }])
    assert.equal(
      [...allocateHQTravel(s.costRows, s.resourceTypes, settings).values()]
        .flat()
        .reduce((x, y) => x + y, 0),
      0,
    );
  assert.equal(allocateHQTravel([], s.resourceTypes, s.travelSettings).size, 0);
});

test('group and project rows reconcile to statement including EHS, risk, all manual leaves and legacy subcontract exactly once', () => {
  const s = fixture();
  const legacy = s.resourceTypes.find((r) => r.category === 'subcontract');
  s.costRows.push({
    ...structuredClone(s.costRows[0]),
    id: 'legacy',
    reTypeId: legacy.id,
  });
  const items = buildGroupCostSummary(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
    s.manualCosts,
    s.subcontractCost,
    2026,
  );
  const statement = getCostStatementValues(
    s.costRows,
    s.resourceTypes,
    240,
    s.manualCosts,
    s.subcontractCost,
    2026,
  );
  assert.equal(
    roundMoney(items.reduce((sum, item) => sum + item.total, 0)),
    statement.totalWithRisk,
  );
  assert.equal(
    items.find((item) => item.label === 'Unassigned Group').travel,
    0,
  );
  assert.equal(
    items.find((item) => item.label === 'Subcontract').total,
    statement.subcontract,
  );
  assert.equal(
    items.find((item) => item.label === 'Risk Contingency').total,
    100,
  );
  assert.equal(
    items.find((item) => item.label === 'EHS').total,
    roundMoney((statement.labour + statement.subcontract + 4) * 0.01) + 5,
  );
  assert.equal(
    items.some((item) => item.label === 'Car Fee'),
    false,
  );
  assert.equal(
    roundMoney(items.reduce((sum, item) => sum + item.travel, 0)),
    240,
  );
});

test('grouped export writes annual subtotal formulas and reconciled Group sheet with travel included once', async () => {
  const s = fixture();
  const layout = {
    grouped: true,
    yearIndex: 'all',
    columns: ['scope', 'Y1:cost', 'Y2:cost', 'totalCost', 'action'],
  };
  const w = await buildSimpleCostWorkbook(s, layout);
  const detail = w.getWorksheet('Cost Detail');
  assert.equal(detail.getCell('B6').formula, 'SUM(B7:B7)');
  assert.equal(
    detail.getCell('B6').result,
    roundMoney(s.costRows[0].years[0].cost + 95),
  );
  assert.equal(
    detail.getCell('C9').result,
    roundMoney(s.costRows[1].years[1].cost + 145),
  );
  const summary = w.getWorksheet('Summary Group');
  const expected = getCostStatementValues(
    s.costRows,
    s.resourceTypes,
    240,
    s.manualCosts,
    s.subcontractCost,
    2026,
  ).totalWithRisk;
  assert.equal(summary.getCell(summary.rowCount, 11).result, expected);
  const single = await buildSimpleCostWorkbook(s, layout, ['Summary Group']);
  assert.deepEqual(
    single.worksheets.map((sheet) => sheet.name),
    ['Summary Group', 'Category Calculations'],
  );
});

function categoryFixture() {
  const s = fixture();
  s.costRows.forEach((row, index) => {
    row.category = ['Services', 'Equipment', undefined][index];
    row.groupName = 'Delivery';
  });
  const legacy = s.resourceTypes.find(
    (resource) => resource.category === 'subcontract',
  );
  s.costRows.push({
    ...structuredClone(s.costRows[0]),
    id: 'legacy',
    reTypeId: legacy.id,
  });
  s.subcontractCost.lines[0].category = 'Services';
  s.subcontractCost.lines.push(
    {
      ...s.subcontractCost.lines[0],
      id: 'equipment',
      category: 'Equipment',
      unitPrice: 12,
      quantities: [3, 0, 0, 0, 0],
    },
    {
      ...s.subcontractCost.lines[0],
      id: 'unclassified',
      category: undefined,
      unitPrice: 5,
      quantities: [2, 0, 0, 0, 0],
    },
  );
  s.subcontractCost.mode = 'site-types';
  s.subcontractCost.siteTypes = [
    {
      id: 'site',
      name: 'Branch',
      sites: [2, 0, 0, 0, 0],
      lines: [
        {
          id: 'civil',
          code: 'CIV',
          description: 'Civil works',
          category: 'Construction',
          bu: 'MBB',
          unit: 'm',
          currency: 'SGD',
          unitPrice: 1.005,
          quantityPerSite: 1.3,
        },
      ],
    },
  ];
  return s;
}

function summarize(s) {
  return buildGroupCostSummary(
    s.costRows,
    s.resourceTypes,
    s.travelSettings,
    s.manualCosts,
    s.subcontractCost,
    2026,
    true,
  );
}

test('Category subtotals include classified project/site/legacy subcontract exactly once and allocate project accounts inside each category', () => {
  const s = categoryFixture();
  const original = structuredClone(s);
  const items = summarize(s);
  const sections = buildGroupCostSections(items);
  assert.deepEqual(
    sections.map((section) => section.label),
    ['Services', 'Equipment', 'Uncategorized', 'Construction'],
  );
  assert.deepEqual(
    sections.slice(0, 3).map((section) => section.items[0].label),
    ['Delivery', 'Delivery', 'Delivery'],
  );
  const legacyCost = totalRowCost(s.costRows.at(-1));
  assert.equal(sections[0].totals.subcontract, roundMoney(50 + legacyCost));
  assert.equal(sections[1].totals.subcontract, 36);
  assert.equal(sections[3].totals.subcontract, 2.62);
  assert.ok(sections[3].items.some((item) => item.kind === 'Subcontract'));
  assert.equal(sections[2].totals.subcontract, 10);
  assert.ok(
    sections.every((section) =>
      section.items.some((item) => item.accountCode === '15'),
    ),
  );
  const expected = getCostStatementValues(
    s.costRows,
    s.resourceTypes,
    240,
    s.manualCosts,
    s.subcontractCost,
    2026,
  );
  assert.equal(
    roundMoney(
      sections.reduce((sum, section) => sum + section.totals.total, 0),
    ),
    expected.totalWithRisk,
  );
  assert.equal(
    roundMoney(items.reduce((sum, item) => sum + item.subcontract, 0)),
    expected.subcontract,
  );
  assert.ok(
    Math.abs(
      sections.reduce((sum, section) => sum + section.totals.share, 0) - 1,
    ) < 1e-12,
  );
  assert.deepEqual(s, original);
});

test('section layout separates headers, details, subtotals and total without duplicating leaves', () => {
  const items = summarize(categoryFixture());
  const original = structuredClone(items);
  const layout = buildGroupCostSheetLayout(items);
  let next = 5;
  for (const section of layout.sections) {
    assert.equal(section.headerRow, next++);
    for (const entry of section.entries) assert.equal(entry.rowNumber, next++);
    assert.equal(section.subtotalRow, next++);
  }
  assert.equal(layout.totalRow, next);
  assert.equal(
    layout.sections.flatMap((section) => section.entries).length,
    items.length,
  );
  assert.equal(
    layout.totals.total,
    roundMoney(items.reduce((sum, item) => sum + item.total, 0)),
  );
  assert.deepEqual(items, original);
  assert.equal(buildGroupCostSheetLayout([]).totalRow, 5);
  assert.equal(buildGroupCostSheetLayout([]).totals.share, 0);
});

test('Simple, selective and combined exports keep Category subtotal formulas and a single reconciled grand total', async () => {
  const s = categoryFixture();
  const layout = buildGroupCostSheetLayout(summarize(s));
  const books = [
    await buildSimpleCostWorkbook(s),
    await buildSimpleCostWorkbook(s, undefined, ['Summary Group']),
    await buildCombinedQuoteWorkbook({
      costSnapshot: s,
      pricing: initialPricingSettings,
    }),
  ];
  for (const book of books) {
    const sheet = book.getWorksheet('Summary Group');
    for (const section of layout.sections) {
      assert.equal(
        sheet.getCell(section.headerRow, 1).value,
        section.kind === 'Category'
          ? `Category: ${section.label}`
          : section.label,
      );
      assert.equal(sheet.getCell(section.subtotalRow, 3).value, 'Subtotal');
      assert.match(sheet.getCell(section.subtotalRow, 11).formula, /^SUM\(/);
      assert.equal(
        sheet.getCell(section.subtotalRow, 11).result,
        section.totals.total,
      );
      for (const entry of section.entries) {
        assert.equal(sheet.getCell(entry.rowNumber, 2).value, entry.item.label);
        assert.equal(
          sheet.getCell(entry.rowNumber, 11).result ?? 0,
          entry.item.total,
        );
      }
    }
    assert.equal(sheet.rowCount, layout.totalRow);
    assert.match(
      sheet.getCell(layout.totalRow, 11).formula,
      /SUMIF\(.*"Subtotal"/,
    );
    assert.equal(
      sheet.getCell(layout.totalRow, 11).result,
      layout.totals.total,
    );
    assert.equal(sheet.getCell(layout.totalRow, 12).result, 1);
  }
});
