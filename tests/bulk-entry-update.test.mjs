import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import {
  entryWorkbook,
  readEntrySheet,
} from '../features/bulk-entry/workbook.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { initialRateSettings } from '../features/cost/demo-data.ts';
import {
  parsePersonnelBulkEntry,
  mergePersonnelBulkRows,
} from '../features/cost/personnel-bulk-entry.ts';
import { updateSubcontractBulkLines } from '../features/cost/subcontract-bulk-entry.ts';
import {
  bulkTabSpec,
  previewBulkImport,
} from '../features/master-data/bulk-import-model.ts';
import { newMaintenanceLine } from '../features/maintenance/component-pricing.ts';
import {
  parseMaintenanceBulk,
  maintenanceBulkText,
  mergeMaintenanceBulkRows,
} from '../features/maintenance/bulk-entry.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx') || url.includes('/node_modules/'))
      return nextLoad(url, context);
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      shortCircuit: true,
    };
  },
});
const { PersonnelBulkEntryPage } =
  await import('../features/bulk-entry/personnel-entry.tsx');
const { SubcontractBulkEntryPage } =
  await import('../features/bulk-entry/subcontract-entry.tsx');
hooks.deregister();
const resources = structuredClone(initialResourceTypes);
const rates = {
  ...initialRateSettings,
  tdStart: '2026-01-01',
  baseYear: 2026,
  annualUplifts: [0, 0, 0, 0, 0],
};
const costRow = () => ({
  ...parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\nInstall\tNetwork\tLOCAL-L1\t2',
    { resources, rates, defaultMode: 'mandays', defaultYear: 0 },
  ).rows[0],
  id: 'CI-existing',
  category: 'Network deployment',
  groupName: 'Site A',
});
const editCell = (document, spec, row, key, value) => {
  document.workbook.sheets[spec.id].cellData[row][
    spec.columns.findIndex((c) => c.key === key)
  ] = { v: value };
};
const personnel = (rows, onConfirm = () => true) =>
  PersonnelBulkEntryPage({
    projectId: 'p',
    versionCode: 'V1',
    resources,
    rates,
    rows,
    locked: false,
    onClose() {},
    onConfirm,
  }).props;

test('personnel Bulk Entry opens current rows, updates by ID, adds new rows, and does not duplicate on reopen', () => {
  const existing = costRow();
  const untouched = { ...costRow(), id: 'CI-other', scope: 'Support' };
  let current = [existing, untouched];
  const page = personnel(current, (edits) => {
    current = mergePersonnelBulkRows(current, edits);
    return true;
  });
  const sheet = page.sheets.find((s) => s.id === 'mandays');
  const document = entryWorkbook(page.sheets);
  assert.equal(readEntrySheet(document, sheet).rows[0].values.id, existing.id);
  editCell(document, sheet, 1, 'mandays:0', 7);
  editCell(document, sheet, 1, 'category', 'Integration');
  delete document.workbook.sheets.mandays.cellData[2];
  const review = page.onPreview(document, ['mandays']);
  assert.deepEqual(review.issues, []);
  assert.equal(page.onImport(review.payload), true);
  assert.equal(current.length, 2);
  assert.equal(current[0].years[0].mandays, 7);
  assert.equal(current[0].category, 'Integration');
  assert.deepEqual(current[1], untouched);
  const reopened = personnel(current, (edits) => {
    current = mergePersonnelBulkRows(current, edits);
    return true;
  });
  const again = reopened.onPreview(entryWorkbook(reopened.sheets), ['mandays']);
  assert.deepEqual(again.issues, []);
  reopened.onImport(again.payload);
  assert.equal(current.length, 2);
  const newDoc = entryWorkbook(reopened.sheets);
  newDoc.workbook.sheets.mandays.cellData[3] = structuredClone(
    newDoc.workbook.sheets.mandays.cellData[1],
  );
  editCell(newDoc, sheet, 3, 'id', '');
  editCell(newDoc, sheet, 3, 'scope', 'Additional service');
  const added = reopened.onPreview(newDoc, ['mandays']);
  assert.deepEqual(added.issues, []);
  reopened.onImport(added.payload);
  assert.equal(current.length, 3);
});

test('personnel rejects unknown and repeated IDs instead of updating or appending the wrong row', () => {
  const page = personnel([costRow()]);
  const document = entryWorkbook(page.sheets);
  const sheet = page.sheets.find((s) => s.id === 'mandays');
  document.workbook.sheets.mandays.cellData[2] = structuredClone(
    document.workbook.sheets.mandays.cellData[1],
  );
  assert.ok(
    page
      .onPreview(document, ['mandays'])
      .issues.some((i) => /duplicated/.test(i.message)),
  );
  delete document.workbook.sheets.mandays.cellData[2];
  editCell(document, sheet, 1, 'id', 'does-not-exist');
  assert.ok(
    page
      .onPreview(document, ['mandays'])
      .issues.some((i) => /no longer exists/.test(i.message)),
  );
});

const catalog = [
  {
    id: 'catalog-1',
    code: 'SC-001',
    item: 'Install',
    bu: 'Network',
    unit: 'lot',
    unitPrice: 200,
    currency: 'SGD',
    active: true,
  },
];
const line = {
  id: 'line-1',
  catalogItemId: 'catalog-1',
  code: 'SC-001',
  description: 'Install',
  bu: 'Network',
  unit: 'lot',
  unitPrice: 125,
  currency: 'SGD',
  quantities: [1, 0, 0, 0, 0],
  category: 'Integration',
};

test('subcontract updates current quantities and category without changing frozen prices or unrelated BOQs', () => {
  let value = {
    mode: 'site-types',
    lines: [line],
    siteTypes: [
      {
        id: 'site-1',
        name: 'Site A',
        sites: [1, 0, 0, 0, 0],
        lines: [{ ...line, id: 'site-line', quantityPerSite: 2 }],
      },
    ],
  };
  // Site lines have quantities per site only.
  delete value.siteTypes[0].lines[0].quantities;
  const page = SubcontractBulkEntryPage({
    workspaceKey: 'p:V1',
    value,
    catalog,
    actualYears: [2026, 2027, 2028, 2029, 2030],
    target: { kind: 'project' },
    locked: false,
    onClose() {},
    onConfirm(batch) {
      for (const entry of batch)
        value = updateSubcontractBulkLines(value, entry.lines, entry.target);
      return true;
    },
  }).props;
  const doc = entryWorkbook(page.sheets),
    sheet = page.sheets[0];
  editCell(doc, sheet, 1, 'quantity:0', 4);
  editCell(doc, sheet, 1, 'category', 'Deployment');
  const review = page.onPreview(doc, ['project']);
  assert.deepEqual(review.issues, []);
  assert.equal(page.onImport(review.payload), true);
  assert.equal(value.lines.length, 1);
  assert.equal(value.lines[0].id, line.id);
  assert.equal(value.lines[0].unitPrice, 125);
  assert.equal(value.lines[0].quantities[0], 4);
  assert.equal(value.lines[0].category, 'Deployment');
  assert.equal(value.siteTypes[0].lines[0].quantityPerSite, 2);
  assert.deepEqual(
    updateSubcontractBulkLines(value, review.payload[0].lines, {
      kind: 'project',
    }),
    value,
  );
});

test('Master Data current-row edits retain IDs, clear optional text and preserve unlisted records', () => {
  const current = [
    { id: 'tag-1', name: 'Tender', active: true },
    { id: 'tag-2', name: 'Other', active: true },
  ];
  const columns = bulkTabSpec('project-tags').columns.map((c) => ({
    ...c,
    required: false,
  }));
  const sheet = { id: 'tags', name: 'Tags', columns, rows: current };
  const doc = entryWorkbook([sheet]);
  editCell(doc, sheet, 1, 'name', 'Updated Tender');
  delete doc.workbook.sheets.tags.cellData[2];
  const read = readEntrySheet(doc, sheet);
  assert.deepEqual(read.issues, []);
  const preview = previewBulkImport(
    'project-tags',
    read.rows,
    current,
    {},
    { editCurrentRows: true },
  );
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.updated, 1);
  assert.equal(preview.added, 0);
  assert.equal(preview.items.length, 2);
  assert.equal(preview.items[1].name, 'Other');
  const service = {
    id: 'history-1',
    client: 'Client',
    project: 'Project',
    service: 'Install',
    quantity: 1,
    unit: 'lot',
    unitPrice: 200,
    costAmount: 100,
    quotedAmount: 200,
    quotedYear: 2026,
    source: 'Old reference',
    currency: 'SGD',
  };
  const changed = previewBulkImport(
    'service-history',
    [{ row: 2, values: { id: service.id, source: '' } }],
    [service],
    {},
    { editCurrentRows: true },
  );
  assert.deepEqual(changed.issues, []);
  assert.equal(changed.items[0].source, '');
});

test('maintenance opens current IDs and updates repeatedly without losing source metadata or untouched rows', () => {
  const existing = {
    ...newMaintenanceLine(3),
    model: 'Router',
    ct: 100,
    spms: 20,
    quantity: 2,
    remark: 'Keep\nmultiline',
    referenceId: 'ref-1',
  };
  const other = { ...newMaintenanceLine(1), model: 'Switch' };
  const seeded = parseMaintenanceBulk(maintenanceBulkText([existing]), [
    existing,
    other,
  ]);
  assert.deepEqual(seeded.errors, []);
  assert.deepEqual(seeded.rows[0], existing);
  const pasted = parseMaintenanceBulk(
    'Model\tCT\tSPMS\tQTY\tDuration\tRemark\tDescription\nRouter\t110\t30\t4\t3\tUpdated\tCore router',
    [existing, other],
  );
  assert.deepEqual(pasted.errors, []);
  const updated = mergeMaintenanceBulkRows([existing, other], pasted.rows);
  assert.equal(updated.length, 2);
  assert.equal(updated[0].quantity, 4);
  assert.equal(updated[0].source, existing.source);
  assert.equal(updated[0].referenceId, 'ref-1');
  assert.deepEqual(mergeMaintenanceBulkRows(updated, pasted.rows), updated);
  const bad = parseMaintenanceBulk(maintenanceBulkText([existing, existing]), [
    existing,
  ]);
  assert.ok(bad.errors.some((message) => /more than once/.test(message)));
});
