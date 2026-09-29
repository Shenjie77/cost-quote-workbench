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

test('manual platform merge preserves CT/SPMS money and evidence while requiring a new quantity', async () => {
  const { mergeServiceQuoteItems } =
    await import('../features/maintenance/import-service-quote.ts');
  const preview = await inspectServiceQuote(await fixture(), 'Platform.xlsx');
  const original = structuredClone(preview.parts);
  const ct = original
    .filter((part) => part.service === 'CT')
    .map((part) => part.row);
  assert.throws(
    () => mergeServiceQuoteItems(original, ct, 'Platform A', 0),
    /数量/,
  );
  assert.throws(() => mergeServiceQuoteItems(original, ct, '', 2), /名称/);
  const merged = mergeServiceQuoteItems(original, ct, 'Platform A', 3);
  assert.deepEqual(original, preview.parts);
  assert.ok(
    merged.parts
      .filter((part) => part.service === 'SPMS')
      .every((part) => part.model === 'Router A'),
  );
  const spms = original
    .filter((part) => part.service === 'SPMS')
    .map((part) => part.row);
  const combined = mergeServiceQuoteItems(merged.parts, spms, 'Platform A', 2);
  const rows = serviceQuoteLines(
    preview,
    combined.parts,
    3,
    { [combined.key]: combined.quantity },
    true,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ct, 22.5);
  assert.equal(rows[0].spms, 22.5);
  assert.equal(rows[0].quantity, 2);
  assert.deepEqual(
    combined.parts.map(
      ({ model: _model, originalModel: _originalModel, ...part }) => part,
    ),
    original.map(
      ({ model: _model, originalModel: _originalModel, ...part }) => part,
    ),
  );
});

test('total rows with quantities are ignored and variable comma-delimited descriptions identify models', async () => {
  const { modelFromNodeInfo, mergeServiceQuoteItems } =
    await import('../features/maintenance/import-service-quote.ts');
  assert.equal(
    modelFromNodeInfo('aaa, Platform Device A, bbbb'),
    'Platform Device A',
  );
  assert.equal(
    modelFromNodeInfo('Customized support，设备 B，annual subscription'),
    '设备 B',
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await fixture());
  const sheet = book.worksheets[0];
  sheet.getCell('C5').value = 'Any CT description, Device A, any billing terms';
  sheet.getCell('C6').value = 'Different service, Device B, different unit';
  for (const label of [
    'total row',
    'Grand Total:',
    'Sub-total',
    'TOTAL AMOUNT',
    '总计',
  ])
    sheet.addRow([label, '', '', 99, null, 999, 999]);
  sheet.addRow(['', '', 'Total', 99, null, 999, 999]);
  const preview = await inspectServiceQuote(
    new Uint8Array(await book.xlsx.writeBuffer()),
    'Totals.xlsx',
  );
  assert.equal(preview.parts.length, 12);
  assert.ok(preview.parts.every((part) => !part.issue));
  assert.equal(preview.parts[0].model, 'Device A');
  assert.equal(preview.parts[1].model, 'Device B');
  const merged = mergeServiceQuoteItems(
    preview.parts,
    preview.parts.map((part) => part.row),
    'Platform',
    2,
  );
  const rows = serviceQuoteLines(
    preview,
    merged.parts,
    3,
    { platform: 2 },
    true,
  );
  assert.match(rows[0].description, /SPMS: Device A/);
  assert.match(rows[0].description, /SPMS: Device B/);
  assert.match(rows[0].description, /CT: Router A/);
  assert.equal(rows[0].ct, 22.5);
  assert.equal(rows[0].spms, 22.5);
});

test('subquotation type is inherited from concatenated and adjacent heading values; rounded unit prices tolerate bounded differences', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await fixture());
  const sheet = book.worksheets[0];
  sheet.getCell('A2').value = 'SubQuotationNameSPMS';
  sheet.getCell('A15').value = 'Sub Quotation Name';
  sheet.getCell('B15').value = 'CT';
  sheet.getCell('D5').value = 9;
  sheet.getCell('E5').value = 70.34;
  sheet.getCell('F5').value = 633.04;
  sheet.getCell('G5').value = 633.04;
  const inspect = async () =>
    inspectServiceQuote(
      new Uint8Array(await book.xlsx.writeBuffer()),
      'Rounded.xlsx',
    );
  const preview = await inspect();
  assert.equal(preview.parts[0].service, 'SPMS');
  assert.equal(preview.parts[6].service, 'CT');
  assert.equal(preview.parts[0].issue, undefined);
  sheet.getCell('F5').value = 632;
  assert.match((await inspect()).parts[0].issue, /舍入范围/);
});

test('real Excel outline parents classify named CT and full-name SPMS in either order without leaking into sibling groups', async () => {
  for (const order of [
    ['CT', 'SPMS'],
    ['SPMS', 'CT'],
  ]) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Actual');
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
      const parent = sheet.addRow([
        service === 'CT'
          ? 'CT XXXXXXX-2027'
          : 'xxx spare parts management service xxx',
      ]);
      parent.outlineLevel = 0;
      const phase = sheet.addRow(['Phase-2027', '', '', 2, null, 100, 100]);
      phase.outlineLevel = 1;
      for (const code of ['0000000000', '0000000001']) {
        const row = sheet.addRow([
          code,
          '',
          'any service, Platform Device, any terms',
          2,
          25,
          50,
          50,
        ]);
        row.outlineLevel = 2;
        row.hidden = true;
      }
    }
    sheet.addRow(['Unclassified sibling']);
    const unknown = sheet.addRow([
      '0000000002',
      '',
      'other, Unknown, terms',
      1,
      10,
      10,
      10,
    ]);
    unknown.outlineLevel = 1;
    const preview = await inspectServiceQuote(
      new Uint8Array(await book.xlsx.writeBuffer()),
      'Real.xlsx',
    );
    assert.equal(preview.parts.length, 5);
    assert.deepEqual(
      preview.parts.slice(0, 4).map((part) => part.service),
      [order[0], order[0], order[1], order[1]],
    );
    assert.ok(
      preview.parts
        .slice(0, 4)
        .every((part) => part.year === 2027 && !part.issue),
    );
    assert.equal(preview.parts[4].service, null);
    assert.equal(preview.parts[4].year, undefined);
  }
});
