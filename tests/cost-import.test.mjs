import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  inspectCostWorkbook,
  previewCostImport,
  applyCostImport,
} from '../features/cost/import-workbook.ts';
import { totalRowMandays } from '../features/cost/domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
const setup = () => {
  const w = createBlankWorkspace(
    projectRecord('IMPORT-TEST', 'Import test', 'Client'),
    'costing',
  );
  w.rateSettings.tdStart = '2026-01-01';
  const resources = w.costVersions[0].resourceTypes;
  const mapping = {
    sheet: 'TD',
    headerRow: 1,
    role: 'TD',
    mode: 'mandays',
    year: 'Y1',
    columns: {
      scope: 1,
      bu: 0,
      resource: 0,
      mandays: 2,
      sites: 0,
      mdPerSite: 0,
      cost: 0,
    },
    defaultBu: 'Delivery',
    defaultResource: resources.find((r) => r.category === 'internal').id,
  };
  return { w, resources, mapping };
};
async function bytes(rows) {
  const ExcelJS = (await import('exceljs')).default,
    wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet('TD');
  rows.forEach((r) => sheet.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
test('Excel import preserves direct effort, source evidence and per-year imports with duplicate protection', async () => {
  const { w, resources, mapping } = setup(),
    file = await bytes([
      ['Scope', 'Y1', 'Y2'],
      ['Deployment', 10, 5],
    ]);
  const info = await inspectCostWorkbook(file);
  assert.equal(info.sheets[0].columns[1].header, 'Y1');
  const preview = await previewCostImport(
    file,
    'TD.xlsx',
    mapping,
    resources,
    w.rateSettings,
  );
  assert.deepEqual(preview.issues, []);
  let rows = applyCostImport([], preview, { resources, rates: w.rateSettings });
  assert.equal(totalRowMandays(rows[0]), 10);
  assert.equal(rows[0].mdPerSite, 0);
  assert.equal(rows[0].source.row, 2);
  assert.throws(() => applyCostImport(rows, preview), /already imported/);
  const y2 = await previewCostImport(
    file,
    'TD.xlsx',
    { ...mapping, year: 'Y2', columns: { ...mapping.columns, mandays: 3 } },
    resources,
    w.rateSettings,
  );
  rows = applyCostImport(rows, y2);
  assert.equal(
    rows.reduce((n, r) => n + totalRowMandays(r), 0),
    15,
  );
  const repo = openWorkspaceRepository(':memory:');
  try {
    w.costRows = rows;
    const saved = repo.save(w.project.id, w, null);
    assert.equal(saved.workspace.costRows.length, 2);
    assert.equal(repo.list()[0].incompleteCostRows, 0);
  } finally {
    repo.close();
  }
  const changed = { ...w.rateSettings, tdStart: '2027-01-01' };
  assert.throws(
    () => applyCostImport([], preview, { resources, rates: changed }),
    /changed/,
  );
});
test('Import detects totals, missing formula caches, invalid text and missing delivery year before mutation', async () => {
  const { w, resources, mapping } = setup();
  const f = await bytes([
    ['Scope', 'MD'],
    ['Deploy', 10],
    ['Total', 10],
  ]);
  const bad = await previewCostImport(
    f,
    'TD.xlsx',
    mapping,
    resources,
    w.rateSettings,
  );
  assert.match(bad.issues[0], /Summary/);
  assert.throws(() => applyCostImport([], bad));
  const good = await previewCostImport(
    f,
    'TD.xlsx',
    { ...mapping, excludeRows: [3] },
    resources,
    w.rateSettings,
  );
  assert.equal(good.rows.length, 1);
  assert.deepEqual(good.issues, []);
  const formula = await previewCostImport(
    await bytes([
      ['Scope', 'MD'],
      ['Deploy', { formula: '5+5' }],
    ]),
    'TD.xlsx',
    mapping,
    resources,
    w.rateSettings,
  );
  assert.match(formula.issues[0], /cached/);
  const long = await previewCostImport(
    await bytes([
      ['Scope', 'MD'],
      ['x'.repeat(501), 10],
    ]),
    'TD.xlsx',
    mapping,
    resources,
    w.rateSettings,
  );
  assert.match(long.issues[0], /500/);
  await assert.rejects(
    previewCostImport(f, 'PM.xlsx', { ...mapping, role: 'PM' }, resources, {
      ...w.rateSettings,
      tdStart: '',
    }),
    /TD/,
  );
});
