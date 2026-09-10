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

test('explicit item pricing reaches generic template rows while legacy single mapping retains its discounted amount', async () => {
  const workspace = setup();
  workspace.pricing.discount = 100;
  const legacy = templateData(workspace, 'quote');
  assert.equal(
    legacy.datasets.quoteLines[0].amount,
    legacy.quote.pricing.quoteBeforeTax,
  );
  workspace.pricing.lineMode = 'manual';
  workspace.pricing.manualLines = [
    {
      id: 'first',
      description: 'Customer service A',
      quantity: 2,
      unit: 'site',
      unitPrice: 20000,
    },
    {
      id: 'second',
      description: 'Customer service B',
      quantity: 1.5,
      unit: 'lot',
      unitPrice: 40000,
    },
  ];
  const source = templateData(workspace, 'quote');
  assert.equal(source.datasets.quoteLines.length, 2);
  assert.equal(source.datasets.quoteLines[0].scope, 'Customer service A');
  assert.equal(source.datasets.quoteLines[1].quantity, 1.5);
  assert.equal(source.quote.pricing.listPrice, 100000);
  assert.equal(source.quote.pricing.quoteBeforeTax, 99900);
  await assert.rejects(
    fillTemplateWorkbook(await original(), map, workspace),
    /Map quotation line descriptions/,
  );
  const detailMapping = {
    ...map,
    tables: [
      ...map.tables,
      {
        sheet: 'Company',
        startRow: 16,
        capacity: 2,
        dataset: 'quoteLines',
        columns: {
          description: 1,
          quantity: 2,
          unit: 3,
          unitPrice: 4,
          amount: 5,
        },
      },
    ],
  };
  const filled = await fillTemplateWorkbook(
    await original(),
    detailMapping,
    workspace,
    'Q-LINES',
  );
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(filled.bytes);
  assert.equal(
    book.getWorksheet('Company').getCell('A16').value,
    'Customer service A',
  );
  assert.equal(book.getWorksheet('Company').getCell('B17').value, 1.5);
  assert.equal(book.getWorksheet('Company').getCell('E17').value, 60000);
});

test('company quotation mappings expose only primary fields and preserve the supplied text', async () => {
  const workspace = setup();
  workspace.project.name = '客户项目';
  workspace.quoteTemplates[0].documentTitleZh = '历史标题';
  workspace.quoteTemplates[0].paymentTermsZh = '历史付款条款';
  workspace.quoteTemplates[0].termsAndConditions =
    'Original customer terms. '.repeat(500);
  workspace.quoteAssumptions[0].text = '客户原文 scope condition';
  workspace.quoteAssumptions[0].textZh = '隐藏的历史译文';
  const source = templateData(workspace, 'quote');
  assert.equal(source.scalars['quote.documentTitleZh'], undefined);
  assert.equal(source.scalars['quote.paymentTermsZh'], undefined);
  assert.equal(source.datasets.assumptions[0].textZh, undefined);
  assert.equal(source.scalars['project.name'], '客户项目');
  const bytes = await original();
  const output = await fillTemplateWorkbook(bytes, map, workspace, 'Q-EN');
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(output.bytes);
  assert.equal(
    book.getWorksheet('Company').getCell('B7').value,
    workspace.quoteTemplates[0].termsAndConditions,
  );
  assert.equal(
    book.getWorksheet('Company').getCell('A12').value,
    workspace.quoteAssumptions[0].text,
  );
  const text = JSON.stringify(
    book.worksheets.map((sheet) => sheet.getSheetValues()),
  );
  assert.doesNotMatch(text, /历史标题|历史付款条款|隐藏的历史译文/);
  for (const field of ['quote.documentTitleZh', 'quote.paymentTermsZh']) {
    await assert.rejects(
      fillTemplateWorkbook(
        bytes,
        {
          ...map,
          cells: [...map.cells, { sheet: 'Company', cell: 'B9', field }],
        },
        workspace,
      ),
      /Unknown scalar field/,
    );
  }
  await assert.rejects(
    fillTemplateWorkbook(
      bytes,
      {
        ...map,
        tables: [{ ...map.tables[0], columns: { text: 1, textZh: 2 } }],
      },
      workspace,
    ),
    /Unknown assumptions field: textZh/,
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
    const saved = repo.get(w.project.id);
    assert.equal(saved.workspace.quoteHistory.length, 2);
    assert.equal(saved.workspace.quoteHistory[0].lineSnapshots.length, 1);
    assert.equal(
      saved.workspace.quoteHistory[1].lineSnapshots,
      undefined,
      'Legacy external mapping must not claim standard detail rows.',
    );
    saved.workspace.pricing.lineMode = 'manual';
    saved.workspace.pricing.manualLines = [
      {
        id: 'first',
        description: 'Customer line one',
        quantity: 2,
        unit: 'site',
        unitPrice: 20000,
      },
      {
        id: 'second',
        description: 'Customer line two',
        quantity: 1,
        unit: 'lot',
        unitPrice: 60000,
      },
    ];
    repo.save(w.project.id, saved.workspace, saved.revision);
    repo.close();
    repo = null;
    writeFileSync(
      request,
      JSON.stringify({
        apiVersion: 'cost-workbench/v2',
        kind: 'OperationRequest',
        requestId: 'q-detail-test',
        data: {
          schemaVersion: '1.0.0',
          operation: 'workbook.fill-template',
          ...map,
          tables: [
            ...map.tables,
            {
              sheet: 'Company',
              startRow: 16,
              capacity: 2,
              dataset: 'quoteLines',
              columns: {
                scope: 1,
                quantity: 2,
                unit: 3,
                unitPrice: 4,
                amount: 5,
              },
            },
          ],
        },
      }),
    );
    const detailed = run([
      'workbook',
      'fill-template',
      '--project-id',
      w.project.id,
      '--file',
      file,
      '--input',
      request,
      '--output',
      path.join(dir, 'Details.xlsx'),
    ]);
    assert.equal(detailed.status, 0, JSON.stringify(detailed.body));
    repo = openWorkspaceRepository(database);
    const detailHistory = repo.get(w.project.id).workspace.quoteHistory[2];
    assert.equal(detailHistory.lineMode, 'manual');
    assert.deepEqual(
      detailHistory.lineSnapshots.map((line) => [
        line.description,
        line.amount,
      ]),
      [
        ['Customer line one', 40000],
        ['Customer line two', 60000],
      ],
    );
  } finally {
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
