/** Fixed-format XLSX import remains all-or-nothing and never reads the guide as data. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { GLOBAL_MASTER_DATA_TABS } from '../features/master-data/global-types.ts';
import { bulkTabSpec } from '../features/master-data/bulk-import-model.ts';
import {
  createBulkImportWorkbook,
  readBulkImportWorkbook,
} from '../features/master-data/bulk-import-workbook.ts';

/** Opens a generated fixture for a narrowly scoped mutation before testing import validation. */
async function editWorkbook(tab, edit, items = []) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createBulkImportWorkbook(tab, items));
  edit(workbook, workbook.getWorksheet('Data'));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Modifies the raw XML to exercise parser limits before ExcelJS can allocate oversized rows. */
async function editXml(bytes, edit) {
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, edit(await zip.file(path).async('string')));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Uses zero, false and text with leading zeros so truthiness mistakes cannot pass round-trip checks. */
function valueFor(column) {
  if (column.kind === 'number' || column.kind === 'integer') return 0;
  if (column.kind === 'boolean') return false;
  if (column.kind === 'date') return '2026-09-21';
  if (column.kind === 'list') return ['Alpha', 'Beta'];
  return column.options?.[0] ?? '000123';
}

test('every Master Data tab produces an empty, styled template with a complete field guide', async () => {
  for (const tab of GLOBAL_MASTER_DATA_TABS) {
    const bytes = await createBulkImportWorkbook(tab);
    assert.deepEqual(await readBulkImportWorkbook(tab, bytes), [], tab);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const data = workbook.getWorksheet('Data');
    const guide = workbook.getWorksheet('Guide');
    const spec = bulkTabSpec(tab);
    assert.equal(
      data.rowCount,
      1,
      `${tab}: no sample is mistaken for business data`,
    );
    assert.equal(data.views[0].ySplit, 1);
    assert.ok(data.autoFilter);
    assert.equal(workbook.getWorksheet('_MasterData').state, 'veryHidden');
    assert.deepEqual(
      data.getRow(1).values.slice(1),
      spec.columns.map((column) => column.key),
    );
    assert.deepEqual(
      guide.getColumn(1).values.slice(2, spec.columns.length + 2),
      spec.columns.map((column) => column.key),
    );
    const choiceIndex = spec.columns.findIndex(
      (column) => column.kind === 'boolean' || column.options?.length,
    );
    if (choiceIndex >= 0)
      assert.equal(
        data.getCell(2, choiceIndex + 1).dataValidation.type,
        'list',
      );
  }
});

test('all tabs round-trip their flattened fields, preserving zero, false, IDs, dates and lists', async () => {
  for (const tab of GLOBAL_MASTER_DATA_TABS) {
    const item = Object.fromEntries(
      bulkTabSpec(tab).columns.map((column) => [column.key, valueFor(column)]),
    );
    const bytes = await createBulkImportWorkbook(tab, [item, item]);
    assert.deepEqual(
      await readBulkImportWorkbook(tab, bytes),
      [
        { row: 2, values: item },
        { row: 3, values: item },
      ],
      tab,
    );
  }
});

test('reordered columns are mapped by field key and guide rows never become imported data', async () => {
  const columns = bulkTabSpec('resources').columns;
  const item = Object.fromEntries(
    columns.map((column) => [column.key, valueFor(column)]),
  );
  const bytes = await editWorkbook(
    'resources',
    (workbook, data) => {
      data.getRow(1).values = columns.map((column) => column.key).reverse();
      data.getRow(2).values = columns
        .map((column) => item[column.key])
        .map((value) => (Array.isArray(value) ? value.join('\n') : value))
        .reverse();
      workbook.getWorksheet('Guide').addRow(['THIS IS NOT AN IMPORTED RECORD']);
      data.addRow([]);
    },
    [item],
  );
  assert.deepEqual(await readBulkImportWorkbook('resources', bytes), [
    { row: 2, values: item },
  ]);
});

test('blank optional cells are omitted while a literal empty list remains an explicit clear', async () => {
  const tab = GLOBAL_MASTER_DATA_TABS.find((name) =>
    bulkTabSpec(name).columns.some((column) => column.kind === 'list'),
  );
  assert.ok(tab, 'at least one catalog has a list field');
  const columns = bulkTabSpec(tab).columns;
  const list = columns.find((column) => column.kind === 'list');
  const key = columns.find((column) => column.kind === 'text');
  const bytes = await createBulkImportWorkbook(tab, [
    { [key.key]: '000007', [list.key]: [] },
  ]);
  assert.deepEqual(await readBulkImportWorkbook(tab, bytes), [
    { row: 2, values: { [key.key]: '000007', [list.key]: [] } },
  ]);
  for (const values of [
    ['a;b', 'two\nlines'],
    ['A', 'B'],
    ['[literal bracket', 'Next'],
  ]) {
    const file = await createBulkImportWorkbook(tab, [{ [list.key]: values }]);
    assert.deepEqual(
      (await readBulkImportWorkbook(tab, file))[0].values[list.key],
      values,
    );
  }
});

test('workbooks reject the wrong tab, missing format markers, unsupported versions and missing Data', async () => {
  const bytes = await createBulkImportWorkbook('resources');
  await assert.rejects(
    readBulkImportWorkbook('subcontract', bytes),
    /different Master Data tab/,
  );
  for (const edit of [
    (book) => book.removeWorksheet('_MasterData'),
    (book) => {
      book.getWorksheet('_MasterData').getCell('B2').value = 999;
    },
    (book) => {
      book.getWorksheet('_MasterData').getCell('A1').value = 'unrelated';
    },
  ]) {
    await assert.rejects(
      readBulkImportWorkbook(
        'resources',
        await editWorkbook('resources', edit),
      ),
      /format\/version/,
    );
  }
  await assert.rejects(
    readBulkImportWorkbook(
      'resources',
      await editWorkbook('resources', (book) => book.removeWorksheet('Data')),
    ),
    /Data worksheet/,
  );
});

test('unknown, duplicate, missing and unnamed data headers fail with actionable locations', async () => {
  const first = bulkTabSpec('resources').columns[0].key;
  const cases = [
    [
      (data) => {
        data.getCell('A1').value = 'unexpected';
      },
      /Data!A1.*Unknown field/,
    ],
    [
      (data) => {
        data.getCell('B1').value = first;
      },
      /Data!B1.*Duplicate field/,
    ],
    [
      (data) => {
        data.getCell('A1').value = null;
      },
      /missing field keys/,
    ],
    [
      (data) => {
        data.getCell('A1').value = null;
        data.getCell('A2').value = 'value';
      },
      /Data!A1.*field key is required/,
    ],
  ];
  for (const [edit, pattern] of cases) {
    await assert.rejects(
      readBulkImportWorkbook(
        'resources',
        await editWorkbook('resources', (_, data) => edit(data)),
      ),
      pattern,
    );
  }
});

test('formulas and Excel errors fail rather than importing cached values or error strings', async () => {
  const cases = [
    [{ formula: '1+1', result: 2 }, /Data!A2.*Formulas/],
    [{ formula: '1+1' }, /Data!A2.*Formulas/],
    [{ error: '#DIV/0!' }, /Data!A2.*Excel error #DIV\/0!/],
    [
      { text: 'external', hyperlink: 'https://example.com' },
      /Data!A2.*plain text/,
    ],
  ];
  for (const [value, pattern] of cases) {
    const bytes = await editWorkbook('resources', (_, data) => {
      data.getCell('A2').value = value;
    });
    await assert.rejects(readBulkImportWorkbook('resources', bytes), pattern);
  }
});

test('typed parsing accepts native Excel dates, booleans and text lists and rejects invalid values', async () => {
  const kinds = new Set();
  for (const tab of GLOBAL_MASTER_DATA_TABS) {
    for (const [index, column] of bulkTabSpec(tab).columns.entries()) {
      if (
        kinds.has(column.kind) ||
        !['date', 'boolean', 'number', 'integer', 'list'].includes(column.kind)
      )
        continue;
      kinds.add(column.kind);
      const valid = {
        date: [new Date('2028-02-29T00:00:00Z'), '2028-02-29'],
        boolean: ['FALSE', false],
        number: ['1.25e2', 125],
        integer: ['0', 0],
        list: ['One; Two\nThree', ['One', 'Two', 'Three']],
      }[column.kind];
      const bytes = await editWorkbook(tab, (_, data) => {
        data.getCell(2, index + 1).value = valid[0];
      });
      assert.deepEqual(
        (await readBulkImportWorkbook(tab, bytes))[0].values[column.key],
        valid[1],
      );
      const invalid = {
        date: '2026-02-30',
        boolean: 'maybe',
        number: '1,200',
        integer: 1.5,
        list: '[1,2]',
      }[column.kind];
      const invalidBytes = await editWorkbook(tab, (_, data) => {
        data.getCell(2, index + 1).value = invalid;
      });
      await assert.rejects(
        readBulkImportWorkbook(tab, invalidBytes),
        /Data![A-Z]+2/,
      );
      if (column.kind === 'date') {
        const serial = await editWorkbook(tab, (_, data) => {
          data.getCell(2, index + 1).value = 45920;
          data.getCell(2, index + 1).numFmt = 'General';
        });
        await assert.rejects(
          readBulkImportWorkbook(tab, serial),
          /numeric date serials/,
        );
      }
    }
  }
  assert.ok(kinds.has('boolean') && kinds.has('number') && kinds.has('list'));
});

test('row, column, file and archive expansion limits reject input before creating large models', async () => {
  await assert.rejects(
    readBulkImportWorkbook('resources', new Uint8Array(20 * 1024 * 1024 + 1)),
    /20 MB/,
  );
  await assert.rejects(
    readBulkImportWorkbook(
      'resources',
      new TextEncoder().encode('not an XLSX file'),
    ),
    /not a readable/,
  );
  await assert.rejects(
    createBulkImportWorkbook(
      'resources',
      Array.from({ length: 10_001 }, () => ({})),
    ),
    /10000 records/,
  );
  const bytes = await createBulkImportWorkbook('resources');
  for (const dimension of ['A1:A10002', 'A1:XFD2']) {
    const invalid = await editXml(bytes, (xml) =>
      xml.replace(
        /<dimension ref="[^"]+"\/>/,
        `<dimension ref="${dimension}"/>`,
      ),
    );
    await assert.rejects(
      readBulkImportWorkbook('resources', invalid),
      /exceeds the limit/,
    );
  }
  const singleQuoted = await editXml(bytes, (xml) =>
    xml.replace(/<dimension ref="[^"]+"\/>/, "<dimension ref = 'A1:A10002'/>"),
  );
  await assert.rejects(
    readBulkImportWorkbook('resources', singleQuoted),
    /exceeds the limit/,
  );
  const hugeColumnStyle = await editXml(bytes, (xml) =>
    xml.replace(/<col\b[^>]*\bmax="\d+"/, (match) =>
      match.replace(/max="\d+"/, 'max="16384"'),
    ),
  );
  await assert.rejects(
    readBulkImportWorkbook('resources', hugeColumnStyle),
    /column styles exceed/,
  );
  const hugeMerge = await editXml(bytes, (xml) =>
    xml.replace(
      '</worksheet>',
      '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>',
    ),
  );
  await assert.rejects(
    readBulkImportWorkbook('resources', hugeMerge),
    /Merged cells/,
  );
  const hugeValidation = await editXml(bytes, (xml) =>
    xml.replace(/sqref="[^"]+"/, 'sqref="A1:XFD1048576"'),
  );
  await assert.rejects(
    readBulkImportWorkbook('resources', hugeValidation),
    /exceeds the limit/,
  );
  // Inflate only the advertised directory size. Rejection must occur before any attempt to decompress it.
  const oversized = new Uint8Array(bytes);
  const view = new DataView(oversized.buffer);
  let patched = false;
  for (let index = 0; index < oversized.length - 46; index += 1) {
    if (
      view.getUint32(index, true) === 0x02014b50 &&
      view.getUint32(index + 24, true) > 0
    ) {
      view.setUint32(index + 24, 51 * 1024 * 1024, true);
      patched = true;
      break;
    }
  }
  assert.equal(patched, true);
  await assert.rejects(
    readBulkImportWorkbook('resources', oversized),
    /expanded workbook/,
  );
});

test('an unmarked ordinary workbook and macro-enabled content cannot masquerade as a tab template', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Data').addRow(['id']);
  await assert.rejects(
    readBulkImportWorkbook(
      'resources',
      new Uint8Array(await workbook.xlsx.writeBuffer()),
    ),
    /format\/version/,
  );
  const zip = await JSZip.loadAsync(
    await createBulkImportWorkbook('resources'),
  );
  zip.file('xl/vbaProject.bin', 'not executable');
  await assert.rejects(
    readBulkImportWorkbook(
      'resources',
      await zip.generateAsync({ type: 'uint8array' }),
    ),
    /standard .xlsx/,
  );
});
