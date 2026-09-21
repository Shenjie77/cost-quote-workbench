/** Customer-facing item codes are version snapshots, distinct from descriptions and catalog record IDs. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { buildSimpleCostWorkbookBytes } from '../features/cost/export-simple-workbook.ts';

/** Same descriptions with different codes, and the same code on two sites, test safe aggregation. */
function fixture() {
  const snapshot = makeCostSnapshot();
  snapshot.costRows = [];
  snapshot.travelSettings.enabled = false;
  const line = (id, code, unitPrice, extra) => ({
    id,
    code,
    catalogItemId: `removed-global-item-${id}`,
    description: 'Installation',
    bu: 'Network',
    unit: 'piece',
    unitPrice,
    currency: 'SGD',
    ...extra,
  });
  snapshot.subcontractCost = {
    mode: 'site-types',
    lines: [
      line('project', '00007', 100, { quantities: [1, 2, 0, 0, 0] }),
      line('other', '00999', 12, {
        description: 'Other scope',
        quantities: [0, 0, 1, 0, 0],
      }),
    ],
    siteTypes: [
      {
        id: 'site-a',
        name: 'Type A',
        sites: [3, 0, 0, 0, 0],
        lines: [
          line('a1', '00123', 10, { quantityPerSite: 2 }),
          line('a2', '00456', 5, { quantityPerSite: 1 }),
        ],
      },
      {
        id: 'site-b',
        name: 'Type B',
        sites: [0, 1, 0, 0, 0],
        lines: [line('b1', '00123', 10, { quantityPerSite: 1 })],
      },
    ],
  };
  return snapshot;
}

test('simple and full Subcon Detail expose captured text codes beside descriptions without changing annual costs', async () => {
  for (const build of [buildSimpleCostWorkbookBytes, buildCostWorkbookBytes]) {
    const snapshot = fixture();
    const pending = build(snapshot);
    // Export captures its version before asynchronous workbook work; later catalog or local edits cannot rewrite codes.
    snapshot.subcontractCost.lines[0].code = 'CHANGED-AFTER-EXPORT';
    snapshot.subcontractCost.siteTypes[0].lines[0].code = 'CHANGED-SITE';
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await pending);
    const sheet = book.getWorksheet('Subcon Detail');
    assert.equal(sheet.getCell('B4').value, 'Code Number / 条目编码');
    assert.equal(sheet.getCell('C4').value, 'Description / 描述');
    assert.deepEqual(
      [5, 6, 7, 8, 9].map((row) => sheet.getCell(row, 2).value),
      ['00007', '00999', '00123', '00456', '00123'],
    );
    for (let row = 5; row <= 9; row += 1) {
      assert.equal(sheet.getCell(row, 2).type, ExcelJS.ValueType.String);
      assert.equal(sheet.getCell(row, 2).numFmt, '@');
    }
    assert.equal(sheet.getCell('C5').value, 'Installation');
    assert.equal(sheet.getCell('C6').value, 'Other scope');
    assert.deepEqual(
      [11, 13, 15, 17, 19].map(
        (column) => sheet.getCell(sheet.rowCount, column).value,
      ),
      [175, 210, 12, 0, 0],
    );
    assert.equal(sheet.getCell(sheet.rowCount, 9).value, 397);
    assert.equal(sheet.getCell('F5').value, 100);
    assert.match(sheet.getCell('F5').numFmt, /S\$/);
    assert.equal(sheet.getCell('J4').value, 'Y1 2027 Qty');
    assert.equal(sheet.getCell('K4').value, 'Y1 2027 Cost');
    assert.deepEqual(
      book.getWorksheet('Subcon Site Types').getRow(5).values.slice(1, 4),
      ['Type A', 25, 75],
    );
  }
});

test('Summary Subcon lists all captured codes for a description without splitting groups or double-counting repeated site codes', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildSimpleCostWorkbookBytes(fixture()));
  const sheet = book.getWorksheet('Summary Subcon');
  assert.equal(sheet.columnCount, 6);
  assert.equal(sheet.getCell('A4').value, 'Description / 描述');
  assert.equal(sheet.getCell('F4').value, 'BOQ Code Number(s) / 条目编码');
  assert.equal(sheet.getCell('A5').value, 'Installation');
  assert.equal(sheet.getCell('F5').value, '00007\n00123\n00456');
  assert.equal(sheet.getCell('F5').numFmt, '@');
  assert.equal(sheet.getCell('D5').value, 385);
  assert.equal(sheet.getCell('C5').value, 0);
  assert.equal(sheet.getCell('A6').value, 'Other scope');
  assert.equal(sheet.getCell('F6').value, '00999');
  assert.equal(sheet.getCell('D6').value, 12);
  assert.equal(sheet.getCell('D7').value, 397);
  assert.equal(sheet.getCell('E7').value, 1);
  assert.equal(sheet.getRow(5).getCell(6).alignment.wrapText, true);
});

test('large summary code lists stay within Excel cell limits while detail preserves every item code', async () => {
  const snapshot = fixture();
  snapshot.subcontractCost.mode = 'project';
  snapshot.subcontractCost.siteTypes = [];
  snapshot.subcontractCost.lines = Array.from({ length: 300 }, (_, index) => ({
    ...snapshot.subcontractCost.lines[0],
    id: `row-${index}`,
    code: `${String(index).padStart(5, '0')}-${'A'.repeat(120)}`,
    quantities: [1, 0, 0, 0, 0],
  }));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildSimpleCostWorkbookBytes(snapshot));
  const summary = book.getWorksheet('Summary Subcon');
  const codes = summary.getCell('F5').value;
  assert.ok(codes.length < 32_767);
  assert.match(codes, /\+\d+ more; see Subcon Detail$/);
  assert.equal(summary.getCell('D5').value, 30_000);
  const detail = book.getWorksheet('Subcon Detail');
  assert.equal(detail.rowCount, 305);
  assert.equal(
    detail.getCell('B304').value,
    snapshot.subcontractCost.lines[299].code,
  );
  assert.equal(detail.getCell('I305').value, 30_000);
});
