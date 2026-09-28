import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maintenanceGridDraft,
  calculateComponentMaintenance,
  newMaintenanceLine,
} from '../features/maintenance/component-pricing.ts';
import {
  archiveMaintenance,
  assertMaintenanceWorkspace,
  buildMaintenanceWorkbook,
} from '../features/maintenance/domain.ts';
import { parseMaintenanceBulk } from '../features/maintenance/bulk-entry.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';

const draft = () =>
  maintenanceGridDraft({ coverageMonths: 12, boq: [], archives: [] }, 2026);
test('annual components allow blank fields, reconcile years, and reject invalid numbers', () => {
  const data = draft();
  assert.equal(calculateComponentMaintenance(data).quote, 0);
  data.boq = [
    { ...newMaintenanceLine(3), ct: 100, spms: 50, quantity: 2 },
    { ...newMaintenanceLine(2), ct: 20, quantity: 1 },
    newMaintenanceLine(0),
  ];
  const result = calculateComponentMaintenance(data);
  assert.equal(result.quote, 940);
  assert.deepEqual(result.annual, [
    { year: 2026, total: 320 },
    { year: 2027, total: 320 },
    { year: 2028, total: 300 },
  ]);
  assert.equal(result.lines[0].reference, undefined);
  assertMaintenanceWorkspace(archiveMaintenance(data, [], 'Client'));
  data.boq[0].ct = -1;
  assert.throws(() => calculateComponentMaintenance(data));
});
test('legacy draft conversion preserves price, duration and immutable archives', () => {
  const source = {
    coverageMonths: 18,
    boq: [
      {
        ...newMaintenanceLine(),
        ct: undefined,
        spms: undefined,
        durationYears: undefined,
        unitAnnualQuote: 120,
        quantity: 2,
      },
    ],
    archives: [],
  };
  const before = structuredClone(source);
  const converted = maintenanceGridDraft(source, 2026);
  assert.equal(calculateComponentMaintenance(converted).quote, 360);
  assert.deepEqual(source, before);
  assert.equal(converted.boq[0].durationYears, 1.5);
});
test('bulk input accepts optional fields and rejects invalid batches atomically', () => {
  const parsed = parseMaintenanceBulk(
    'Model\tCT\tSPMS\tQTY\tDuration\tRemark\nRouter\t100\t50\t2\t3\tNote\nSwitch\t\t\t\t\t',
  );
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].ct, 0);
  assert.equal(parsed.rows[1].quantity, 0);
  const invalid = parseMaintenanceBulk(
    'Router\t100\t50\t2\t3\nBad\t-1\t0\t1\t1',
  );
  assert.equal(invalid.rows.length, 0);
  assert.ok(invalid.errors.length);
});
test('annual archives persist without historical references and export component formulas', async () => {
  const workspace = createBlankWorkspace(
    projectRecord('MAINT-ANNUAL', 'Annual', 'Client'),
    'costing',
  );
  workspace.maintenanceBoq = {
    ...draft(),
    boq: [{ ...newMaintenanceLine(3), ct: 100, spms: 50, quantity: 2 }],
  };
  const repo = openWorkspaceRepository(':memory:');
  try {
    const saved = repo.save(workspace.project.id, workspace, null);
    const next = structuredClone(saved.workspace);
    next.maintenanceBoq = archiveMaintenance(next.maintenanceBoq, [], 'Client');
    const archived = repo.save(workspace.project.id, next, saved.revision);
    const snapshot = archived.workspace.maintenanceBoq.archives[0];
    assert.equal(snapshot.quote, 900);
    const ExcelJS = (await import('exceljs')).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildMaintenanceWorkbook(snapshot));
    assert.equal(
      book.worksheets[0].getCell('D6').value.formula,
      'ROUNDUP(B6+C6,2)',
    );
    assert.equal(book.worksheets[0].getCell('G6').value.result, 900);
    assert.equal(book.worksheets[1].getCell('B2').value, 300);
    const tampered = structuredClone(archived.workspace);
    tampered.maintenanceBoq.archives[0].quote = 1;
    assert.throws(() =>
      repo.save(workspace.project.id, tampered, archived.revision),
    );
  } finally {
    repo.close();
  }
});
