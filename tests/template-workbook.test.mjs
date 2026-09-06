import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  templateData,
  fillTemplateWorkbook,
} from '../features/excel/template-workbook.ts';
const ROOT = path.resolve(import.meta.dirname, '..');
function setup() {
  const snapshot = JSON.parse(
    readFileSync(
      path.join(ROOT, 'tests/fixtures/cost-request.valid.json'),
      'utf8',
    ),
  ).data;
  const w = createBlankWorkspace(
    projectRecord('TEMPLATE-TEST', 'Template project', 'Customer'),
    'costing',
  );
  Object.assign(w, {
    costRows: snapshot.costRows,
    rateSettings: snapshot.rateSettings,
    resourceTypes: snapshot.resourceTypes,
    travelSettings: snapshot.travelSettings,
    manualCosts: snapshot.manualCosts,
  });
  w.costVersions[0] = {
    ...w.costVersions[0],
    state: 'Confirmed',
    costRows: w.costRows,
    rateSettings: w.rateSettings,
    resourceTypes: w.resourceTypes,
    travelSettings: w.travelSettings,
    manualCosts: w.manualCosts,
  };
  w.quoteTemplates[0].termsAndConditions = 'Reviewed T&C';
  w.quoteAssumptions = [
    { id: 'a1', text: 'Reviewed scope condition', textZh: '', included: true },
  ];
  return w;
}
const map = {
  version: '1',
  purpose: 'quote',
  cells: [
    'number',
    'quoteBeforeTax',
    'gstAmount',
    'quoteAfterTax',
    'paymentTerms',
    'validityDays',
    'termsAndConditions',
  ].map((key, i) => ({
    sheet: 'Company',
    cell: `B${i + 1}`,
    field: `quote.${key}`,
  })),
  tables: [
    {
      sheet: 'Company',
      startRow: 12,
      capacity: 2,
      dataset: 'assumptions',
      columns: { text: 1 },
    },
  ],
};
async function original() {
  const ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Company');
  sheet.mergeCells('D1:E1');
  sheet.getCell('D1').value = 'Company layout';
  sheet.getCell('D1').font = { bold: true, color: { argb: 'FF336699' } };
  sheet.getCell('D3').value = { formula: 'B2+B3', result: 999 };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
test('mapped quotation preserves layout and writes reviewed terms without adding internal cost data', async () => {
  const w = setup(),
    filled = await fillTemplateWorkbook(await original(), map, w, 'Q-TEST'),
    ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook();
  await book.xlsx.load(filled.bytes);
  const sheet = book.getWorksheet('Company');
  assert.equal(sheet.getCell('B7').value, 'Reviewed T&C');
  assert.equal(sheet.getCell('A12').value, 'Reviewed scope condition');
  assert.equal(sheet.getCell('D1').font.bold, true);
  assert.equal(sheet.getCell('E1').master.address, 'D1');
  assert.equal(sheet.getCell('D3').value.formula, 'B2+B3');
  assert.equal(sheet.getCell('D3').value.result, undefined);
  const content = JSON.stringify(
    book.worksheets.map((s) => s.getSheetValues()),
  );
  for (const internal of [
    'Cost inputs JSON',
    'cost.total',
    'mandayRate',
    'grossMarginPercent',
  ])
    assert.equal(content.includes(internal), false);
  assert.equal(templateData(w, 'quote').scalars['cost.total'], undefined);
  await assert.rejects(
    fillTemplateWorkbook(
      await original(),
      {
        ...map,
        cells: [
          ...map.cells,
          { sheet: 'Company', cell: 'B9', field: 'cost.total' },
        ],
      },
      w,
    ),
    /Unknown scalar/,
  );
  await assert.rejects(
    fillTemplateWorkbook(
      await original(),
      {
        ...map,
        cells: map.cells.filter((c) => c.field !== 'quote.termsAndConditions'),
      },
      w,
    ),
    /termsAndConditions/,
  );
});
test('template filling rejects overlapping targets and insufficient preallocated rows', async () => {
  const w = setup(),
    bytes = await original();
  await assert.rejects(
    fillTemplateWorkbook(
      bytes,
      { ...map, cells: [...map.cells, map.cells[0]] },
      w,
    ),
    /Overlapping/,
  );
  w.quoteAssumptions.push({ ...w.quoteAssumptions[0], id: 'a2' });
  await assert.rejects(
    fillTemplateWorkbook(
      bytes,
      { ...map, tables: [{ ...map.tables[0], capacity: 1 }] },
      w,
    ),
    /Expand the original/,
  );
});
test('CLI standard and company-template quotations persist history and protect source aliases', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ssr-quote-cli-')),
    database = path.join(dir, 'db.sqlite');
  let repo;
  try {
    repo = openWorkspaceRepository(database);
    const w = setup();
    repo.save(w.project.id, w, null);
    repo.close();
    repo = null;
    const file = path.join(dir, 'Original.xlsx'),
      request = path.join(dir, 'map.json');
    writeFileSync(file, await original());
    writeFileSync(
      request,
      JSON.stringify({
        apiVersion: 'cost-workbench/v2',
        kind: 'OperationRequest',
        requestId: 'q-test',
        data: {
          schemaVersion: '1.0.0',
          operation: 'workbook.fill-template',
          ...map,
        },
      }),
    );
    const run = (args) => {
      const r = spawnSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          'cli/cost-cli.mjs',
          ...args,
          '--db',
          database,
        ],
        { cwd: ROOT, encoding: 'utf8' },
      );
      return { status: r.status, body: JSON.parse(r.stdout) };
    };
    const standard = run([
      'quote',
      'export',
      '--project-id',
      w.project.id,
      '--output',
      path.join(dir, 'Standard.xlsx'),
    ]);
    assert.equal(standard.status, 0, JSON.stringify(standard.body));
    const mapped = run([
      'workbook',
      'fill-template',
      '--project-id',
      w.project.id,
      '--file',
      file,
      '--input',
      request,
      '--output',
      path.join(dir, 'Mapped.xlsx'),
    ]);
    assert.equal(mapped.status, 0, JSON.stringify(mapped.body));
    const alias = path.join(dir, 'Alias.xlsx');
    symlinkSync(file, alias);
    const before = readFileSync(file);
    const rejected = run([
      'workbook',
      'fill-template',
      '--project-id',
      w.project.id,
      '--file',
      file,
      '--input',
      request,
      '--output',
      alias,
      '--overwrite',
    ]);
    assert.notEqual(rejected.status, 0);
    assert.deepEqual(readFileSync(file), before);
    repo = openWorkspaceRepository(database);
    assert.equal(repo.get(w.project.id).workspace.quoteHistory.length, 2);
  } finally {
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
