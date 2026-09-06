import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  archiveMaintenance,
  calculateMaintenance,
  assertMaintenanceWorkspace,
  importBoq,
  buildMaintenanceWorkbook,
} from '../features/maintenance/domain.ts';
import {
  unitAnnualMaintenanceQuote,
  unitAnnualMaintenanceCost,
  initialMaintenancePriceRecords,
} from '../features/master-data/domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
test('maintenance normalizes device/year, preserves BOQ qty and snapshots client references', async () => {
  const ref = structuredClone(initialMaintenancePriceRecords[1]);
  assert.equal(unitAnnualMaintenanceQuote(ref), 3300);
  assert.equal(unitAnnualMaintenanceCost(ref), 2400);
  assert.equal(unitAnnualMaintenanceQuote({ ...ref, quantity: 0 }), null);
  const data = {
    coverageMonths: 24,
    boq: [
      {
        id: 'b1',
        model: ref.productModel,
        quantity: 10,
        serviceLevel: ref.serviceLevel,
        site: 'DC',
        referenceId: ref.id,
        unitAnnualQuote: 3500,
        basis: 'Different customer; 24-month reference adjusted',
        source: 'BOQ.xlsx sheet1 row2',
      },
    ],
    archives: [],
  };
  const calc = calculateMaintenance(data, [ref]);
  assert.equal(calc.lines[0].boq.quantity, 10);
  assert.equal(calc.quote, 70000);
  assert.equal(calc.cost, 48000);
  const saved = archiveMaintenance(data, [ref], 'New customer');
  ref.quotedAmount = 1;
  assertMaintenanceWorkspace(saved);
  assert.equal(saved.archives[0].lines[0].reference.quotedAmount, 39600);
  const bytes = await buildMaintenanceWorkbook(saved.archives[0]),
    ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  assert.equal(book.worksheets.length, 1);
  assert.equal(book.getWorksheet(1).getCell('B6').value, 10);
  assert.equal(book.getWorksheet(1).getCell('G6').value.result, 70000);
  assert.equal(
    JSON.stringify(book.getWorksheet(1).getSheetValues()).includes('48000'),
    false,
  );
  const changed = structuredClone(saved);
  changed.archives[0].lines[0].boq.quantity = 9;
  assert.throws(() => assertMaintenanceWorkspace(changed));
});
test('BOQ import is atomic and maintenance archive cannot be rewritten through workspace save', async () => {
  const ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('BOQ');
  sheet.addRow(['Model', 'Qty']);
  sheet.addRow(['CoreSwitch 8800', 10]);
  sheet.addRow(['Total', 10]);
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  const map = { sheet: 'BOQ', headerRow: 1, modelColumn: 1, quantityColumn: 2 };
  await assert.rejects(importBoq(bytes, 'BOQ.xlsx', map), /合计/);
  const rows = await importBoq(bytes, 'BOQ.xlsx', { ...map, excludeRows: [3] });
  assert.equal(rows.length, 1);
  assert.match(rows[0].source, /SHA256/);
  const w = createBlankWorkspace(
      projectRecord('MAINT-TEST', 'Maintenance', 'Client'),
      'costing',
    ),
    ref = initialMaintenancePriceRecords[1];
  w.maintenancePriceRecords = [ref];
  w.maintenanceBoq = archiveMaintenance(
    {
      coverageMonths: 12,
      boq: [
        {
          ...rows[0],
          referenceId: ref.id,
          unitAnnualQuote: 3300,
          serviceLevel: ref.serviceLevel,
          basis: 'Reviewed history',
        },
      ],
      archives: [],
    },
    [ref],
    w.project.client,
  );
  const repo = openWorkspaceRepository(':memory:');
  try {
    const first = repo.save(w.project.id, w, null);
    const bad = structuredClone(first.workspace);
    bad.maintenanceBoq.archives = [];
    assert.throws(
      () => repo.save(w.project.id, bad, first.revision),
      /cannot be changed/,
    );
  } finally {
    repo.close();
  }
});

test('new maintenance archives cover every BOQ row and unit price uses cents', () => {
  const ref = initialMaintenancePriceRecords[1],
    row = {
      id: 'b1',
      model: ref.productModel,
      quantity: 1,
      serviceLevel: ref.serviceLevel,
      site: 'DC',
      referenceId: ref.id,
      unitAnnualQuote: 3300,
      basis: 'Reviewed reference',
      source: 'BOQ row2',
    };
  assert.throws(
    () =>
      calculateMaintenance(
        {
          coverageMonths: 12,
          boq: [{ ...row, unitAnnualQuote: 1.001 }],
          archives: [],
        },
        [ref],
      ),
    /单台年价/,
  );
  const partial = archiveMaintenance(
    { coverageMonths: 12, boq: [row], archives: [] },
    [ref],
    'Client',
  );
  partial.boq.push({ ...row, id: 'b2', quantity: 99, source: 'BOQ row3' });
  const w = createBlankWorkspace(
    projectRecord('MAINT-PARTIAL', 'Maintenance', 'Client'),
    'costing',
  );
  w.maintenancePriceRecords = [ref];
  w.maintenanceBoq = partial;
  const repo = openWorkspaceRepository(':memory:');
  try {
    assert.throws(() => repo.save(w.project.id, w, null), /all current BOQ/);
  } finally {
    repo.close();
  }
});
