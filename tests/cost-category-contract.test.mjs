import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { validateSubcontractCost } from '../features/cost/subcontract-domain.ts';

const line = (extra = {}) => ({
  id: 'sub-a',
  code: 'SC',
  description: 'Installation',
  bu: 'Network',
  unit: 'lot',
  unitPrice: 100,
  currency: 'SGD',
  category: 'Subcontract',
  ...extra,
});
const subcontract = () => ({
  mode: 'site-types',
  lines: [line({ quantities: [1, 0, 0, 0, 0] })],
  siteTypes: [
    {
      id: 'branch',
      name: 'Branch',
      sites: [2, 0, 0, 0, 0],
      lines: [line({ quantityPerSite: 2 })],
    },
  ],
});

test('cost category schema and domain checks agree for personnel, project Subcon and site Subcon', () => {
  const schema = JSON.parse(
    readFileSync(
      new URL('../schemas/cost-export.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const snapshot = makeCostSnapshot();
  snapshot.costRows[0].category = 'Engineering';
  snapshot.subcontractCost = subcontract();
  assert.equal(validate(snapshot), true, JSON.stringify(validate.errors));
  for (const value of [null, 12, 'x'.repeat(121)]) {
    const bad = structuredClone(snapshot);
    bad.costRows[0].category = value;
    assert.equal(validate(bad), false);
    assert.ok(
      validateCostExportSnapshot(bad).some(
        (issue) => issue.code === 'INVALID_COST_CATEGORY',
      ),
    );
    for (const mode of ['project', 'site']) {
      const sub = subcontract();
      const entry =
        mode === 'project' ? sub.lines[0] : sub.siteTypes[0].lines[0];
      entry.category = value;
      assert.ok(
        validateSubcontractCost(sub).some(
          (issue) => issue.code === 'INVALID_SUBCONTRACT_CATEGORY',
        ),
      );
      assert.equal(validate({ ...snapshot, subcontractCost: sub }), false);
    }
  }
  snapshot.costRows[0].category = '';
  snapshot.subcontractCost.lines[0].category = '';
  assert.equal(validate(snapshot), true);
  assert.deepEqual(validateSubcontractCost(snapshot.subcontractCost), []);
});

test('full Excel retains personnel and Subcon Category values and category-only edits leave all cost formulas unchanged', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.subcontractCost = subcontract();
  delete snapshot.subcontractCost.lines[0].category;
  delete snapshot.subcontractCost.siteTypes[0].lines[0].category;
  const updated = structuredClone(snapshot);
  updated.costRows[0].category = 'Engineering';
  updated.subcontractCost.lines[0].category = 'Project Subcontract';
  updated.subcontractCost.siteTypes[0].lines[0].category = 'Site Subcontract';
  const books = await Promise.all(
    [snapshot, updated].map(async (value) => {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await buildCostWorkbookBytes(value));
      return book;
    }),
  );
  const original = books[0].getWorksheet('01_Cost_Detail');
  const detail = books[1].getWorksheet('01_Cost_Detail');
  const categoryColumn = detail.getRow(4).values.indexOf('Category');
  const totalColumn = detail.getRow(4).values.indexOf('Total Cost');
  assert.ok(categoryColumn > 0);
  assert.ok(totalColumn > 0);
  const categories = [];
  for (let index = 5; index <= detail.rowCount; index++) {
    categories.push(detail.getCell(index, categoryColumn).value);
    assert.deepEqual(
      detail.getCell(index, totalColumn).value,
      original.getCell(index, totalColumn).value,
    );
  }
  assert.ok(categories.includes('Engineering'));
  assert.ok(categories.includes('Project Subcontract'));
  assert.ok(categories.includes('Site Subcontract'));
  assert.equal(snapshot.costRows[0].category, undefined);
});
