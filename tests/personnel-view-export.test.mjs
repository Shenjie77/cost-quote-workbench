import { costRowsIncludingHQTravel } from '../features/cost/group-cost-summary.ts';
const displayedRows = (s) =>
  costRowsIncludingHQTravel(s.costRows, s.resourceTypes, s.travelSettings);
import assert from 'node:assert/strict';
const cachedScalar = (value) => (value?.formula ? (value.result ?? 0) : value);
const cachedValue = (cell) => cachedScalar(cell.value);
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildSimpleCostWorkbookBytes } from '../features/cost/export-simple-workbook.ts';
import {
  recalculateCostRows,
  roundMoney,
  totalRowCost,
  totalRowMandays,
  yearRowMandays,
} from '../features/cost/domain.ts';
import { makeCostSnapshot } from './helpers.mjs';

const load = async (bytes) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return workbook;
};
const fixture = () => {
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].groupName = 'West';
  snapshot.costRows[1].groupName = 'East';
  snapshot.costRows[2].groupName = 'West';
  snapshot.costRows[3].groupName = '';
  return snapshot;
};
const values = (row, count) =>
  Array.from({ length: count }, (_, index) =>
    cachedValue(row.getCell(index + 1)),
  );
const sheetValues = (sheet) =>
  Array.from({ length: sheet.rowCount }, (_, index) =>
    values(sheet.getRow(index + 1), sheet.columnCount),
  );
const exported = async (snapshot, layout) =>
  load(await buildSimpleCostWorkbookBytes(snapshot, layout));

test('Personnel export follows custom groups, retains canonical order within each group, and separates legacy Subcon', async () => {
  const snapshot = fixture();
  const workbook = await exported(snapshot, {
    grouped: true,
    columns: [
      'scope',
      'groupName',
      'reType',
      'Y2:sites',
      'Y2:cost',
      'totalCost',
      'check',
      'action',
    ],
    yearIndex: 1,
  });
  const detail = workbook.getWorksheet('Cost Detail');
  assert.equal(detail.columnCount, 6);
  assert.match(detail.getCell('E8').formula, /Cost Calculations/);
  assert.match(detail.getCell('F13').formula, /SUM/);
  assert.deepEqual(values(detail.getRow(4), 3), ['Scope', 'Group', 'RE Type']);
  assert.match(cachedValue(detail.getCell('D4')), /^Y2 · /);
  assert.equal(cachedValue(detail.getCell('F4')), 'Total Cost');
  assert.deepEqual(
    [cachedValue(detail.getCell('D5')), cachedValue(detail.getCell('E5'))],
    ['Sites', 'Cost (SGD)'],
  );
  assert.equal(cachedValue(detail.getCell('A6')), 'West · 2 rows');
  assert.equal(cachedValue(detail.getCell('A7')), snapshot.costRows[0].scope);
  assert.equal(cachedValue(detail.getCell('A8')), snapshot.costRows[2].scope);
  assert.equal(cachedValue(detail.getCell('A9')), 'East · 1 row');
  assert.equal(cachedValue(detail.getCell('A10')), snapshot.costRows[1].scope);
  assert.equal(cachedValue(detail.getCell('A11')), 'Unassigned Group · 1 row');
  assert.equal(cachedValue(detail.getCell('A12')), snapshot.costRows[3].scope);
  assert.equal(
    cachedValue(detail.getCell('C7')),
    snapshot.resourceTypes.find(
      (resource) => resource.id === snapshot.costRows[0].reTypeId,
    ).name,
  );
  assert.equal(
    cachedValue(detail.getCell('E8')),
    displayedRows(snapshot)[2].years[1].cost,
  );
  assert.equal(
    cachedValue(detail.getCell('F7')),
    totalRowCost(displayedRows(snapshot)[0]),
  );
  assert.match(cachedValue(detail.getCell('A3')), /Grouped · Y2/);
  assert.match(
    cachedValue(detail.getCell('A3')),
    /summaries and Cost Statement cover all years/,
  );
  assert.match(cachedValue(detail.getCell('A13')), /Visible Total · 4 rows/);
  assert.equal(
    cachedValue(detail.getCell('E13')),
    roundMoney(
      displayedRows(snapshot)
        .slice(0, 4)
        .reduce((sum, row) => sum + row.years[1].cost, 0),
    ),
  );
  assert.equal(
    cachedValue(detail.getCell('F13')),
    roundMoney(
      displayedRows(snapshot)
        .slice(0, 4)
        .reduce((sum, row) => sum + totalRowCost(row), 0),
    ),
  );
  assert.equal(detail.views[0].ySplit, 5);
  assert.equal(detail.views[0].xSplit, 1);
  const legacy = workbook.getWorksheet('Legacy Subcon');
  assert.equal(cachedValue(legacy.getCell('A5')), snapshot.costRows[4].scope);
  assert.equal(
    cachedValue(legacy.getCell('D5')),
    totalRowCost(snapshot.costRows[4]),
  );
  assert.equal(
    cachedValue(legacy.getCell('D6')),
    totalRowCost(snapshot.costRows[4]),
  );
  assert.doesNotMatch(
    JSON.stringify(sheetValues(detail)),
    /Cutover Subcontract|rt-hq|Check|Action/,
  );
});

test('Year filtering and reordered columns preserve split annual header segments and a single header without annual data', async () => {
  const snapshot = fixture();
  const order = [
    'Y2:cost',
    'scope',
    'Y1:sites',
    'Y1:mandays',
    'totalMd',
    'Y1:cost',
    'Y2:sites',
    'action',
  ];
  const all = (
    await exported(snapshot, {
      grouped: false,
      columns: order,
      yearIndex: 'all',
    })
  ).getWorksheet('Cost Detail');
  assert.equal(all.columnCount, 7);
  assert.match(cachedValue(all.getCell('A4')), /^Y2 · /);
  assert.equal(cachedValue(all.getCell('B4')), 'Scope');
  assert.match(cachedValue(all.getCell('C4')), /^Y1 · /);
  assert.equal(all.getCell('D4').master.address, 'D4');
  assert.deepEqual(all.model.merges, []);
  assert.equal(cachedValue(all.getCell('E4')), 'Total MD');
  assert.match(cachedValue(all.getCell('F4')), /^Y1 · /);
  assert.match(cachedValue(all.getCell('G4')), /^Y2 · /);
  assert.equal(
    cachedValue(all.getCell('A6')),
    displayedRows(snapshot)[0].years[1].cost,
  );
  assert.equal(
    cachedValue(all.getCell('F6')),
    displayedRows(snapshot)[0].years[0].cost,
  );
  const focused = (
    await exported(snapshot, { grouped: false, columns: order, yearIndex: 0 })
  ).getWorksheet('Cost Detail');
  assert.equal(focused.columnCount, 5);
  assert.deepEqual(
    [cachedValue(focused.getCell('A4')), cachedValue(focused.getCell('D4'))],
    ['Scope', 'Total MD'],
  );
  assert.match(cachedValue(focused.getCell('B4')), /^Y1 · /);
  assert.match(cachedValue(focused.getCell('E4')), /^Y1 · /);
  assert.doesNotMatch(JSON.stringify(values(focused.getRow(4), 5)), /Y2/);
  const noAnnual = (
    await exported(snapshot, {
      grouped: false,
      columns: ['reType', 'totalCost', 'scope', 'check', 'action'],
      yearIndex: 3,
    })
  ).getWorksheet('Cost Detail');
  assert.deepEqual(values(noAnnual.getRow(4), 3), [
    'RE Type',
    'Total Cost',
    'Scope',
  ]);
  assert.equal(cachedValue(noAnnual.getCell('C5')), snapshot.costRows[0].scope);
  assert.equal(noAnnual.views[0].ySplit, 4);
  assert.equal(noAnnual.pageSetup.printTitlesRow, '1:4');
  assert.equal(
    cachedValue(noAnnual.getCell('B5')),
    totalRowCost(displayedRows(snapshot)[0]),
  );
});

test('Direct MD uses page dashes and numeric totals remain aligned even when only numeric columns are shown', async () => {
  const snapshot = fixture();
  const row = snapshot.costRows[0];
  row.inputMode = 'mandays';
  row.mdPerSite = 0;
  row.years = row.years.map((year, index) => ({
    ...year,
    sites: 0,
    mandays: index === 1 ? 2.5 : 0,
  }));
  snapshot.costRows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  const detail = (
    await exported(snapshot, {
      grouped: false,
      columns: [
        'scope',
        'Y2:cost',
        'Y2:sites',
        'mdPerSite',
        'Y2:mandays',
        'totalSites',
        'totalMd',
        'totalCost',
      ],
      yearIndex: 1,
    })
  ).getWorksheet('Cost Detail');
  assert.equal(cachedValue(detail.getCell('C6')), '—');
  assert.equal(cachedValue(detail.getCell('D6')), '—');
  assert.equal(cachedValue(detail.getCell('E6')), 2.5);
  assert.equal(cachedValue(detail.getCell('F6')), 0);
  assert.equal(cachedValue(detail.getCell('G6')), 2.5);
  assert.equal(
    cachedValue(detail.getCell('B6')),
    displayedRows(snapshot)[0].years[1].cost,
  );
  assert.match(detail.getCell('B6').numFmt, /S\$/);
  assert.equal(
    cachedValue(detail.getCell(detail.rowCount, 7)),
    snapshot.costRows
      .slice(0, 4)
      .reduce((sum, input) => sum + totalRowMandays(input), 0),
  );
  const numeric = (
    await exported(snapshot, {
      grouped: false,
      columns: ['Y2:cost', 'totalMd', 'Y2:mandays'],
      yearIndex: 1,
    })
  ).getWorksheet('Cost Detail');
  assert.equal(
    cachedValue(numeric.getCell(numeric.rowCount, 1)),
    roundMoney(
      displayedRows(snapshot)
        .slice(0, 4)
        .reduce((sum, input) => sum + input.years[1].cost, 0),
    ),
  );
  assert.equal(
    cachedValue(numeric.getCell(numeric.rowCount, 2)),
    snapshot.costRows
      .slice(0, 4)
      .reduce((sum, input) => sum + totalRowMandays(input), 0),
  );
  assert.equal(
    cachedValue(numeric.getCell(numeric.rowCount, 3)),
    snapshot.costRows
      .slice(0, 4)
      .reduce((sum, input) => sum + yearRowMandays(input, 1), 0),
  );
});

test('Personnel layout never narrows business summaries, Cost Statement or structured subcontract sheets', async () => {
  const snapshot = fixture();
  snapshot.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'SUB-PRIVATE',
        code: 'PRIVATE-CODE',
        description: 'Install router',
        bu: 'Network',
        unit: 'pcs',
        currency: 'SGD',
        unitPrice: 200,
        quantities: [2, 0, 1, 0, 0],
      },
    ],
  };
  const original = structuredClone(snapshot);
  const baseline = await exported(snapshot);
  const focused = await exported(snapshot, {
    grouped: true,
    columns: ['groupName', 'scope', 'Y4:cost'],
    yearIndex: 3,
  });
  for (const name of [
    'Summary Scope',
    'Summary BU',
    'Summary RE Type',
    'Cost Statement',
    'Subcon Detail',
  ])
    assert.deepEqual(
      sheetValues(focused.getWorksheet(name)),
      sheetValues(baseline.getWorksheet(name)),
    );
  assert.deepEqual(snapshot, original);
  assert.equal(baseline.getWorksheet('Cost Detail').columnCount, 23);
  assert.ok(
    baseline
      .getWorksheet('Cost Detail')
      .getRow(4)
      .values.some(
        (label) => typeof label === 'string' && label.includes('Category'),
      ),
  );
  assert.equal(baseline.getWorksheet('Legacy Subcon'), undefined);
});

test('Explicit export clones layout and cost snapshot before awaiting and omits source identifiers', async () => {
  const snapshot = fixture();
  snapshot.costRows[0].id = 'PRIVATE-ROW';
  snapshot.costRows[0].source = {
    fileName: 'PRIVATE-FILE.xlsx',
    sheet: 'PRIVATE-SHEET',
    row: 5,
    role: 'TD',
    sha256: 'a'.repeat(64),
    importedAt: snapshot.exportedAt,
    mappingKey: 'PRIVATE-MAPPING',
  };
  const originalScope = snapshot.costRows[0].scope;
  const originalCost = totalRowCost(displayedRows(snapshot)[0]);
  const layout = {
    grouped: true,
    columns: ['scope', 'totalCost', 'reType', 'action'],
    yearIndex: 'all',
  };
  const pending = buildSimpleCostWorkbookBytes(snapshot, layout);
  layout.columns.splice(0, layout.columns.length, 'check', 'action');
  layout.grouped = false;
  snapshot.costRows[0].scope = 'Concurrent changed scope';
  snapshot.costRows[0].groupName = 'Concurrent changed group';
  snapshot.costRows[0].years[0].cost = 1;
  const workbook = await load(await pending);
  const detail = workbook.getWorksheet('Cost Detail');
  assert.equal(detail.columnCount, 3);
  assert.equal(cachedValue(detail.getCell('A5')), 'West · 2 rows');
  assert.equal(cachedValue(detail.getCell('A6')), originalScope);
  assert.equal(cachedValue(detail.getCell('B6')), originalCost);
  assert.doesNotMatch(
    JSON.stringify(workbook.worksheets.map(sheetValues)),
    /PRIVATE-|Concurrent changed/,
  );
});

test('Explicit personnel export rejects a view without business columns and retains cost validation', async () => {
  const snapshot = fixture();
  for (const columns of [[], ['check', 'action'], ['Y2:cost', 'action']])
    await assert.rejects(
      buildSimpleCostWorkbookBytes(snapshot, {
        grouped: false,
        columns,
        yearIndex: 0,
      }),
      /visible business column/,
    );
  snapshot.costRows[0].reTypeId = 'missing';
  await assert.rejects(
    buildSimpleCostWorkbookBytes(snapshot, {
      grouped: false,
      columns: ['scope'],
      yearIndex: 0,
    }),
    (error) =>
      error.issues?.some((issue) => issue.code === 'RESOURCE_TYPE_NOT_FOUND'),
  );
});
