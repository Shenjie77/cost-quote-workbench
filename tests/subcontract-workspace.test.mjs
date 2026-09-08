import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { costBaselineKey } from '../features/cpq/domain.ts';
import { templateData } from '../features/excel/template-workbook.ts';
import { updatePersonnelCostRows } from '../features/cost/personnel-cost-rows.ts';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';

function workspace() {
  const w = createBlankWorkspace(
    projectRecord('SUB-WORKSPACE', 'Subcontract cost', 'Customer'),
    'input_preparation',
  );
  const v = w.costVersions[0];
  v.rateSettings.tdStart = '2026-01-01';
  v.rateSettings.tdEnd = '2030-12-31';
  v.rateSettings.baseYear = 2026;
  v.subcontractCost = {
    mode: 'project',
    siteTypes: [],
    lines: [
      {
        id: 'router',
        code: 'ROUTER',
        description: 'Router installation',
        bu: 'Network',
        unit: 'pcs',
        currency: 'SGD',
        unitPrice: 200,
        quantities: [10, 5, 0, 0, 0],
      },
    ],
  };
  w.subcontractCost = structuredClone(v.subcontractCost);
  w.rateSettings = structuredClone(v.rateSettings);
  return w;
}

test('cost version copies isolate subcontract BOQs and fingerprints cover configuration changes', () => {
  const w = workspace(),
    original = w.costVersions[0];
  const key = costBaselineKey(original);
  const copy = createCostVersion('V2', 'Draft', 'V1', original);
  assert.deepEqual(copy.subcontractCost, original.subcontractCost);
  assert.notEqual(
    copy.subcontractCost.lines[0],
    original.subcontractCost.lines[0],
  );
  copy.subcontractCost.lines[0].unitPrice = 250;
  copy.subcontractCost.lines[0].quantities[1] = 99;
  assert.equal(original.subcontractCost.lines[0].unitPrice, 200);
  assert.equal(original.subcontractCost.lines[0].quantities[1], 5);
  assert.equal(costBaselineKey(original), key);
  original.subcontractCost.lines[0].description = 'Updated scope, same price';
  assert.notEqual(costBaselineKey(original), key);
  const legacy = { ...original };
  delete legacy.subcontractCost;
  assert.equal(
    Object.hasOwn(
      createCostVersion('V3', 'Draft', 'V1', legacy),
      'subcontractCost',
    ),
    false,
  );
});

test('personnel editing preserves legacy package amounts and cannot create or overwrite a package', () => {
  const resources = [
    { id: 'local', category: 'internal' },
    { id: 'old-sub', category: 'subcontract' },
  ];
  const personnel = { id: 'labour', reTypeId: 'local', scope: 'Old manpower' };
  const legacy = {
    id: 'old-package',
    reTypeId: 'old-sub',
    scope: 'Historical package',
    years: [{ cost: 500 }],
  };
  const current = [personnel, legacy];
  const result = updatePersonnelCostRows(current, resources, (rows) =>
    rows.map((row) => ({ ...row, scope: 'Updated manpower' })),
  );
  assert.equal(result[0].scope, 'Updated manpower');
  assert.equal(result[1], legacy);
  assert.deepEqual(updatePersonnelCostRows(current, resources, []), [legacy]);
  assert.throws(
    () =>
      updatePersonnelCostRows(current, resources, [
        { id: 'new-sub', reTypeId: 'old-sub' },
      ]),
    /Subcon/,
  );
  assert.throws(
    () =>
      updatePersonnelCostRows(current, resources, [
        { id: legacy.id, reTypeId: 'local' },
      ]),
    /cannot replace/,
  );
});

test('company cost templates and customer pricing include structured subcontract exactly once', () => {
  const w = workspace();
  const data = templateData(w, 'cost');
  assert.equal(data.scalars['cost.subcontract'], 3000);
  assert.equal(data.scalars['cost.total'], 3000);
  assert.equal(data.datasets.costRows.length, 1);
  assert.equal(data.datasets.costRows[0].cost, 3000);
  assert.equal(data.datasets.costRows[0]['Y1.quantity'], 10);
  assert.equal(data.datasets.costRows[0]['Y1.cost'], 2000);
  assert.equal(data.datasets.costRows[0].mandays, 0);
  w.costVersions[0].state = 'Confirmed';
  w.workflowMode = 'project';
  w.quoteTemplates[0].clientPattern = '*';
  const quote = validatedQuoteInput(w, 'Q-SUBCON');
  assert.ok(quote.pricing.quoteBeforeTax >= 3000);
  const before = quote.pricing.quoteBeforeTax;
  w.costVersions[0].subcontractCost.lines[0].unitPrice = 400;
  assert.ok(validatedQuoteInput(w, 'Q-SUBCON').pricing.quoteBeforeTax > before);
});
