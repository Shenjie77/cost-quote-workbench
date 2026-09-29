import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  inspectServiceQuote,
  serviceQuoteLines,
  serviceQuoteGroups,
} from '../features/maintenance/import-service-quote.ts';
import {
  createMaintenanceVersion,
  selectMaintenanceVersion,
} from '../features/maintenance/versions.ts';
import { newMaintenanceLine } from '../features/maintenance/component-pricing.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';

/** Representative multi-year CT/SPMS hierarchy with different sub-item quantities and a customer discount. */
async function fixture(order = ['SPMS', 'CT']) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Quote');
  sheet.addRow([
    'node',
    'model',
    'node info',
    'quantity',
    'LPB Unit Price (SGD)',
    'total amount of LPB price (SGD)',
    'total amount of customer price (SGD)',
  ]);
  for (const service of order) {
    sheet.addRow([`sub-quotation ${service}`]);
    for (const year of [2027, 2028, 2029]) {
      sheet.addRow([year, '', 'phase']);
      sheet.addRow(['item name', '', 'Model: Router A']);
      sheet.addRow(['board-1', '', 'Board support', 4, 10, 40, 36]);
      sheet.addRow(['board-2', '', 'Power support', 2, 5, 10, 9]);
    }
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

test('hierarchical export groups sub-items, counts distinct years, reconciles LPB and uses confirmed customer prices', async () => {
  const preview = await inspectServiceQuote(await fixture(), 'Quote.xlsx');
  assert.deepEqual(preview.years, [2027, 2028, 2029]);
  assert.equal(preview.parts.length, 12);
  assert.ok(
    preview.parts.every((part) => part.model === 'Router A' && !part.issue),
  );
  const groups = serviceQuoteGroups(preview.parts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].ct, 135);
  assert.equal(groups[0].spms, 135);
  assert.throws(
    () =>
      serviceQuoteLines(preview, preview.parts, 3, { 'router a': 2 }, false),
    /折扣/,
  );
  assert.throws(
    () => serviceQuoteLines(preview, preview.parts, 3, {}, true),
    /Node/,
  );
  const lines = serviceQuoteLines(
    preview,
    preview.parts,
    3,
    { 'router a': 2 },
    true,
  );
  assert.equal(lines[0].ct, 22.5);
  assert.equal(lines[0].spms, 22.5);
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].durationYears, 3);
  assert.equal(
    serviceQuoteLines(preview, preview.parts, 5, { 'router a': 2 }, true)[0].ct,
    13.5,
  );
});
test('missing or mismatched LPB money cannot become zero-price imported rows', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await fixture());
  const sheet = book.worksheets[0];
  sheet.getCell('F5').value = 999;
  const mismatch = await inspectServiceQuote(
    new Uint8Array(await book.xlsx.writeBuffer()),
    'Bad.xlsx',
  );
  assert.match(mismatch.parts[0].issue, /不一致/);
  assert.throws(() =>
    serviceQuoteLines(mismatch, mismatch.parts, 3, { 'router a': 2 }, true),
  );
  sheet.getCell('F5').value = null;
  const missing = await inspectServiceQuote(
    new Uint8Array(await book.xlsx.writeBuffer()),
    'Missing.xlsx',
  );
  assert.equal(missing.parts[0].lpb, null);
  assert.match(missing.parts[0].issue, /缺少/);
});
test('maintenance versions retain independent drafts and persist without changing cost versions', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const workspace = createBlankWorkspace(
      projectRecord('MAINT-VERSIONS', 'Versions', 'Client'),
      'costing',
    );
    const first = {
      coverageMonths: 12,
      archives: [],
      boq: [{ ...newMaintenanceLine(), model: 'A', ct: 10 }],
    };
    const second = createMaintenanceVersion(first);
    second.boq[0].ct = 20;
    const back = selectMaintenanceVersion(second, 'MV1');
    assert.equal(back.boq[0].ct, 10);
    assert.equal(selectMaintenanceVersion(back, 'MV2').boq[0].ct, 20);
    const blank = createMaintenanceVersion(back, false);
    assert.equal(blank.versionCode, 'MV3');
    assert.equal(blank.boq.length, 0);
    workspace.maintenanceBoq = blank;
    const saved = repo.save(workspace.project.id, workspace, null);
    assert.equal(saved.workspace.maintenanceBoq.versions.length, 2);
    assert.equal(
      saved.workspace.costVersions.length,
      workspace.costVersions.length,
    );
  } finally {
    repo.close();
  }
});

test('recognizes the supplied per-node service descriptions and combines different CT sub-items by model', async () => {
  const { inferredNodeCounts, modelFromNodeInfo } =
    await import('../features/maintenance/import-service-quote.ts');
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Service');
  sheet.addRow([
    'node',
    'model',
    'node info',
    'quantity',
    'LPB Unit Price (SGD)',
    'total amount of LPB price (SGD)',
    'total amount of customer price (SGD)',
  ]);
  for (const category of ['CT', 'SPMS']) {
    sheet.addRow([`subquotationname ${category}`]);
    for (const year of [2027, 2028, 2029]) {
      sheet.addRow([
        category === 'CT' ? `item name-${year}` : year,
        '',
        'phase',
      ]);
      for (const [service, price] of category === 'SPMS'
        ? [['Spare parts management service', 10]]
        : [
            ['software support service', 20],
            ['hardware support service', 30],
            ['basic service', 5],
          ])
        sheet.addRow([
          'part',
          '',
          '' + service + ', NE8000 X8, per node*year',
          4,
          price,
          price * 4,
          price * 4,
        ]);
    }
  }
  const preview = await inspectServiceQuote(
    new Uint8Array(await book.xlsx.writeBuffer()),
    'Actual-format.xlsx',
  );
  assert.ok(preview.parts.every((part) => part.model === 'NE8000 X8'));
  assert.equal(preview.parts.filter((part) => part.service === 'CT').length, 9);
  assert.deepEqual(inferredNodeCounts(preview.parts), { 'ne8000 x8': 4 });
  const rows = serviceQuoteLines(
    preview,
    preview.parts,
    3,
    inferredNodeCounts(preview.parts),
    false,
  );
  assert.equal(rows[0].spms, 10);
  assert.equal(rows[0].ct, 55);
  assert.equal(
    modelFromNodeInfo('software support service, Router-A, per node per year'),
    'Router-A',
  );
  const changed = structuredClone(preview.parts);
  changed[0].quantity = 2;
  assert.deepEqual(inferredNodeCounts(changed), {});
});

test('subquotation hierarchy works in either order and descriptions cannot override parent service or year', async () => {
  for (const order of [
    ['CT', 'SPMS'],
    ['SPMS', 'CT'],
  ]) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await fixture(order));
    const sheet = book.worksheets[0];
    sheet.getCell('C5').value =
      'Spare parts management service, Model 2035, per node per year';
    const preview = await inspectServiceQuote(
      new Uint8Array(await book.xlsx.writeBuffer()),
      'Order.xlsx',
    );
    assert.deepEqual(preview.years, [2027, 2028, 2029]);
    assert.equal(preview.parts[0].service, order[0]);
    assert.equal(preview.parts[0].year, 2027);
    assert.equal(preview.parts[0].model, 'Model 2035');
    assert.equal(preview.parts[6].service, order[1]);
  }
});

test('deleting a maintenance version switches draft, preserves history and never reuses its code', async () => {
  const { deleteMaintenanceVersion } =
    await import('../features/maintenance/versions.ts');
  const first = {
    coverageMonths: 12,
    archives: [],
    boq: [newMaintenanceLine()],
  };
  assert.throws(() => deleteMaintenanceVersion(first, 'MV1'), /保留/);
  const second = createMaintenanceVersion(first);
  const deleted = deleteMaintenanceVersion(second, 'MV2');
  assert.equal(deleted.versionCode, 'MV1');
  assert.deepEqual(deleted.deletedVersionCodes, ['MV2']);
  assert.equal(deleted.versions.length, 0);
  assert.equal(createMaintenanceVersion(deleted).versionCode, 'MV3');
  assert.deepEqual(deleted.archives, first.archives);
});
