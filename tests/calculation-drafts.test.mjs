import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCalculationDraftStore } from '../server/calculation-drafts.mjs';
import { initialScratchpad } from '../features/calculation/workbook.ts';
import {
  readSubcontractWorkbook,
  subcontractWorkbook,
} from '../features/cost/subcontract-spreadsheet.ts';

const factors = [1, 1.02, 1.04, 1.06, 1.08];
const lines = [
  {
    id: 'line-1',
    code: '001',
    description: 'Install router',
    unit: 'pcs',
    bu: 'Network',
    currency: 'SGD',
    unitPrice: 12.345,
    quantityPerSite: 2,
  },
];

test('draft persistence retains formulas, rejects stale writers and survives reopening', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'calculation-drafts-'));
  const file = path.join(dir, 'workbench.sqlite');
  let store = openCalculationDraftStore(file);
  try {
    assert.equal(store.get('scratchpad'), null);
    const draft = initialScratchpad();
    const first = store.save('scratchpad', draft, null);
    assert.equal(first.revision, 1);
    assert.throws(
      () => store.save('scratchpad', draft, null),
      /changed in another window/,
    );
    const changed = structuredClone(draft);
    changed.workbook.sheets.calculation.cellData[1] = {
      0: { f: '=SUMPRODUCT(B2:B5,C2:C5)' },
    };
    store.save('scratchpad', changed, 1);
    assert.throws(
      () => store.save('scratchpad', draft, 1),
      /changed in another window/,
    );
    assert.throws(
      () =>
        store.save(
          'broken',
          { workbook: { sheetOrder: ['missing'], sheets: {} } },
          null,
        ),
      /valid worksheets/,
    );
    store.close();
    store = openCalculationDraftStore(file);
    assert.equal(store.get('scratchpad').revision, 2);
    assert.deepEqual(store.get('scratchpad').document, changed);
    assert.equal(store.get('broken'), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('site adapter applies numeric formula results without repricing precision or changing metadata', () => {
  const doc = subcontractWorkbook(lines, false, factors, 'Site A');
  doc.workbook.sheets.calculation.cellData[1][5] = {
    f: '=SUM(2,3)',
    v: 5,
    t: 2,
  };
  const applied = readSubcontractWorkbook(doc, lines, false, factors);
  assert.equal(applied[0].quantityPerSite, 5);
  assert.equal(applied[0].unitPrice, 12.345);
  assert.equal(applied[0].code, '001');
  assert.equal(lines[0].quantityPerSite, 2);
  assert.throws(
    () =>
      readSubcontractWorkbook(
        doc,
        [{ ...lines[0], unitPrice: 99 }],
        false,
        factors,
      ),
    /changed/,
  );
  assert.throws(
    () => readSubcontractWorkbook(doc, lines, false, [1, 1, 1, 1, 1]),
    /changed/,
  );
});

test('invalid paste, damaged row identities and formula errors cannot partially apply', () => {
  for (const value of [-1, Infinity, '5', '#REF!', 2.5]) {
    const doc = subcontractWorkbook(lines, false, factors, 'Site A');
    doc.workbook.sheets.calculation.cellData[1][5] = { v: value };
    assert.throws(() => readSubcontractWorkbook(doc, lines, false, factors));
  }
  const doc = subcontractWorkbook(lines, false, factors, 'Site A');
  doc.workbook.sheets.calculation.cellData[1][5] = {
    f: '=1/0',
    v: '#DIV/0!',
    t: 4,
  };
  assert.throws(
    () => readSubcontractWorkbook(doc, lines, false, factors),
    /valid number/,
  );
  doc.workbook.sheets.calculation.cellData[1][0].v = 'different-id';
  assert.throws(
    () => readSubcontractWorkbook(doc, lines, false, factors),
    /rows/,
  );
});

test('shared quantities stay annual, explicit zero and unpriced null remain distinct', () => {
  const project = [
    {
      ...lines[0],
      quantityPerSite: undefined,
      unitPrice: null,
      quantities: [1, 2, 3, 4, 5],
    },
  ];
  const doc = subcontractWorkbook(project, true, factors, 'Shared costs');
  assert.equal(
    readSubcontractWorkbook(doc, project, true, factors)[0].unitPrice,
    null,
  );
  doc.workbook.sheets.calculation.cellData[1][4] = { v: 0, t: 2 };
  const result = readSubcontractWorkbook(doc, project, true, factors)[0];
  assert.equal(result.unitPrice, 0);
  assert.deepEqual(result.quantities, [1, 2, 3, 4, 5]);
  doc.workbook.sheets.calculation.cellData[3] = { 4: { v: 100 } };
  assert.throws(
    () => readSubcontractWorkbook(doc, project, true, factors),
    /Extra cost rows/,
  );
});
