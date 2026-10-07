import { quoteHistoryRecord } from '../features/quote/history-record.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync, backup } from 'node:sqlite';
import ExcelJS from 'exceljs';
import {
  openQuoteTemplateStore,
  routeQuoteTemplateAssets,
} from '../server/quote-template-assets.mjs';
import { book2StructuredMapping } from '../features/quote/book2-example-mapping.ts';
import {
  reusableLayout,
  applySavedLayout,
} from '../features/quote/layout-presets.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { buildQuoteWorkbookBuffer } from '../features/quote/export-quote-workbook.ts';
import { quoteFieldValues } from '../features/quote/document-fields.ts';
import { customerDocument } from '../features/quote/customer-document.ts';
import { structuredBodyRows } from '../features/quote/structured-body.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';

const mapping = () =>
  book2StructuredMapping({
    assetId: 'a'.repeat(64),
    fileName: 'original.xlsx',
    sheetName: 'Quote',
    detailRow: 17,
    columns: { description: 'C', amount: 'G' },
    cells: {},
  });
const fixture = () => ({
  project: {
    id: 'P1',
    name: 'Internal short code - owner notes',
    client: 'Customer',
    currency: 'SGD',
  },
  quoteNumber: 'Q1',
  costVersion: 'V1',
  issuedAt: '2026-10-02',
  lineMode: 'single',
  template: {
    ...initialQuoteTemplates[0],
    excel: mapping(),
    termsAndConditions:
      'For {project}, {client}. Valid for {validityDays} days from {date}. Total {currency} {quoteBeforeTax}.',
  },
  assumptions: [],
  pricing: calculatePricing(80, {
    targetGrossMargin: 20,
    discount: 10,
    gstPercent: 0,
    quotationProjectName: '  Customer Campus Upgrade  ',
  }),
  lines: [
    {
      id: 'service:project',
      description: 'Internal short code - owner notes',
      quantity: 1,
      unit: 'lot',
      unitPrice: 100,
      amount: 100,
    },
  ],
});
async function workbook() {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Quote');
  for (const row of [15, 16, 17, 25, 31]) {
    sheet.getCell(`C${row}`).value = 'OLD';
    sheet.getCell(`G${row}`).value = 0;
  }
  sheet.getCell('C41').value = 'Footer';
  return book.xlsx.writeBuffer();
}
async function call(store, method, input, query = '') {
  const req = Readable.from([
    Buffer.from(
      typeof input === 'string' ? input : input ? JSON.stringify(input) : '',
    ),
  ]);
  req.method = method;
  req.headers = {};
  let result;
  await routeQuoteTemplateAssets({
    request: req,
    url: new URL(
      '/api/local/quote-template-assets/layouts' + query,
      'http://localhost',
    ),
    store,
    response: {},
    respond: (status, body) => {
      result = { status, body };
    },
  });
  return result;
}
test('saved layouts survive reopen and SQLite backup, retaining configuration without workbook identity', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'saved-quote-layout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'test.sqlite');
  let store = openQuoteTemplateStore(dbPath);
  const original = mapping();
  original.variables = { companyName: 'Supplier' };
  original.body.showSubtotals = false;
  original.body.spacing = { section: 1 };
  original.body.sectionSpacing = [{ section: 'Implementation', rows: 2 }];
  original.body.titles.section = '{section}';
  original.body.titles.sectionTotal = '{section} Total';
  const saved = (
    await call(store, 'POST', {
      name: 'Corporate layout',
      mapping: reusableLayout(original),
    })
  ).body.data;
  assert.equal(saved.revision, 1);
  assert.equal(saved.mapping.assetId, undefined);
  assert.equal(saved.mapping.fileName, undefined);
  store.close();
  store = openQuoteTemplateStore(dbPath);
  const loaded = (await call(store, 'GET')).body.data;
  assert.deepEqual(loaded, [saved]);
  const db = new DatabaseSync(dbPath);
  await backup(db, path.join(dir, 'backup.sqlite'));
  db.close();
  store.close();
  const restored = openQuoteTemplateStore(path.join(dir, 'backup.sqlite'));
  t.after(() => restored.close());
  assert.deepEqual(restored.layouts.list(), [saved]);
  const applied = applySavedLayout(saved.mapping, {
    assetId: 'b'.repeat(64),
    fileName: 'new-logo.xlsx',
    sheets: [{ name: 'New sheet', rowCount: 41, columnCount: 7 }],
  });
  assert.equal(applied.assetId, 'b'.repeat(64));
  assert.equal(applied.sheetName, 'New sheet');
  assert.deepEqual(applied.body, original.body);
  assert.deepEqual(applied.textCells, original.textCells);
  assert.deepEqual(applied.variables, original.variables);
  applied.body.startRow = 99;
  assert.equal(saved.mapping.body.startRow, 15);
});
test('layout updates enforce revision and name conflicts; invalid or oversized requests cannot write', async (t) => {
  const store = openQuoteTemplateStore(':memory:');
  t.after(() => store.close());
  const body = { name: 'Corporate', mapping: reusableLayout(mapping()) };
  const first = store.layouts.save(body);
  assert.throws(
    () => store.layouts.save({ ...body, name: ' CORPORATE ' }),
    /name already exists/,
  );
  const next = store.layouts.save({
    ...body,
    id: first.id,
    expectedRevision: 1,
    mapping: {
      ...body.mapping,
      body: { ...body.mapping.body, showSubtotals: false },
    },
  });
  assert.equal(next.revision, 2);
  assert.throws(
    () => store.layouts.save({ ...body, id: first.id, expectedRevision: 1 }),
    /layout changed/,
  );
  for (const invalid of [
    { ...body, mapping: { ...body.mapping, assetId: 'a'.repeat(64) } },
    {
      ...body,
      mapping: {
        ...body.mapping,
        body: { ...body.mapping.body, showSubtotals: 'false' },
      },
    },
    {
      ...body,
      mapping: { ...body.mapping, columns: { description: 'G', amount: 'G' } },
    },
  ])
    assert.throws(() => store.layouts.save(invalid));
  await assert.rejects(call(store, 'DELETE'), /Invalid layout/);
  await assert.rejects(
    call(store, 'POST', 'x'.repeat(128 * 1024 + 1)),
    /smaller/,
  );
  await assert.rejects(
    call(store, 'GET', null, '?unknown=1'),
    /query parameter/,
  );
  assert.deepEqual(store.layouts.list(), [next]);
});
test('customer title and T&C fields render in structured, standard and legacy exports without changing internal project data', async () => {
  const source = fixture(),
    before = structuredClone(source),
    bytes = await workbook();
  assert.equal(
    customerDocument(source).service[0].description,
    'Customer Campus Upgrade',
  );
  for (const mode of ['structured', 'standard', 'legacy']) {
    const data = structuredClone(source);
    if (mode === 'standard') data.layout = 'customer';
    if (mode === 'legacy') delete data.template.excel;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildQuoteWorkbookBuffer(data, bytes));
    const content = JSON.stringify(
      book.worksheets.map((sheet) => sheet.getSheetValues()),
    );
    assert.match(content, /Customer Campus Upgrade/);
    assert.doesNotMatch(
      content,
      /Internal short code|owner notes|\{project\}|\{date\}/,
    );
    assert.match(content, /Valid for 30 days from 02-Oct-2026\. Total SGD 90/);
  }
  assert.deepEqual(source, before);
  source.pricing.quotationProjectName = '  ';
  assert.equal(quoteFieldValues(source).project, source.project.name);
  source.template.termsAndConditions = 'Unknown {internalCost}';
  assert.throws(() => quoteFieldValues(source), /Unknown placeholder/);
  source.template.termsAndConditions = '{termsAndConditions}';
  assert.throws(() => quoteFieldValues(source), /Unknown placeholder/);
});
test('disabling category Subtotals removes those rows but keeps discounted and Optional chapter totals correct', async () => {
  const source = fixture();
  source.lineMode = 'manual';
  source.lines.push({
    id: 'option',
    description: 'Optional support',
    quantity: 1,
    unit: 'lot',
    unitPrice: 25,
    amount: 25,
  });
  source.pricing = calculatePricing(100, {
    targetGrossMargin: 20,
    discount: 10,
    gstPercent: 0,
    lineGroups: { option: { category: 'Support', inclusion: 'optional' } },
  });
  const body = source.template.excel.body;
  for (const enabled of [true, false]) {
    body.showSubtotals = enabled;
    const plan = structuredBodyRows(source, body, quoteFieldValues(source));
    assert.equal(
      plan.filter((row) => row.role === 'subtotal' && row.sum).length,
      enabled ? 2 : 0,
    );
    assert.deepEqual(
      plan
        .filter((row) => row.role === 'total' || row.role === 'grandTotal')
        .map((row) => row.amount),
      [100, 25, 115],
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(
      await buildQuoteWorkbookBuffer(source, await workbook()),
    );
    const sheet = book.worksheets[0];
    if (enabled)
      assert.match(
        JSON.stringify(sheet.getSheetValues()),
        /Professional Service Subtotal/,
      );
    else
      assert.doesNotMatch(
        JSON.stringify(sheet.getSheetValues()),
        /Subtotal|subtotal/,
      );
    for (const [i, row] of plan.entries())
      if (row.role === 'total') {
        assert.equal(sheet.getCell(`G${15 + i}`).result, row.amount);
        assert.equal(
          sheet.getCell(`G${15 + i}`).formula,
          `ROUND(SUM(${row.sum.map((n) => `G${15 + n}`).join(',')})${row.subtract === undefined ? '' : `-G${15 + row.subtract}`},2)`,
        );
      }
  }
});
test('quotation title persists with pricing and output history while the internal project name remains unchanged', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const workspace = createBlankWorkspace(
      projectRecord('P-NAME', 'Internal owner notes', 'Customer'),
    );
    workspace.pricing.quotationProjectName = 'Public project title';
    const input = fixture();
    input.pricing.quotationProjectName = 'Public project title';
    workspace.quoteHistory = [
      quoteHistoryRecord(input, { path: 'quote.xlsx', sha256: 'a'.repeat(64) }),
    ];
    repo.save(workspace.project.id, workspace, null);
    const read = repo.get(workspace.project.id);
    assert.equal(
      read.workspace.pricing.quotationProjectName,
      'Public project title',
    );
    assert.equal(read.workspace.project.name, 'Internal owner notes');
    assert.equal(
      read.workspace.quoteHistory[0].quotationProjectName,
      'Public project title',
    );
    assert.match(
      read.workspace.quoteHistory[0].templateSnapshot.termsAndConditions,
      /For Public project title, Customer/,
    );
    assert.equal(
      read.workspace.quoteHistory[0].lineSnapshots[0].description,
      'Public project title',
    );
  } finally {
    repo.close();
  }
});
