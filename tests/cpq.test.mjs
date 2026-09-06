import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyCpq,
  confirmMapping,
  solveCpq,
  archiveCpq,
  assertCpq,
  costBaselineKey,
  matchCatalog,
} from '../features/cpq/domain.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { buildCpqWorkbook } from '../features/cpq/export-workbook.ts';
const setup = () => {
  const workspace = createBlankWorkspace(
    projectRecord('CPQ-TEST', 'CPQ test', 'Client'),
    'costing',
  );
  const baseline = workspace.costVersions[0];
  let data = emptyCpq();
  const base = {
    unit: 'unit',
    active: true,
    step: 1,
    minQty: 1,
    maxQty: 100,
    referenceQty: 0,
    tags: '',
    revision: '1',
  };
  data.catalog = [
    {
      ...base,
      code: 'D01',
      scope: '设备部署',
      unitCost: 100,
      kind: 'equipment',
      adjustable: false,
    },
    {
      ...base,
      code: 'S01',
      scope: '实施联调服务',
      unitCost: 500,
      kind: 'service',
      adjustable: true,
    },
  ];
  data.draft = {
    ...data.draft,
    brief: '设备部署和实施联调',
    costVersion: 'V1',
    targetCost: 6000,
    targetBasis: 'Test total',
    selections: [
      {
        code: 'D01',
        quantity: 10,
        locked: true,
        weight: 1,
        reason: '10 actual devices',
      },
      {
        code: 'S01',
        quantity: 0,
        locked: false,
        weight: 1,
        reason: 'Deployment',
      },
    ],
  };
  data = confirmMapping(data, 'SSR');
  return { workspace, baseline, data };
};
test('CPQ requires selected-item confirmation and never adjusts equipment quantities', () => {
  const { data, baseline } = setup();
  const result = solveCpq(data, baseline);
  assert.equal(result.difference, 0);
  assert.deepEqual(
    result.lines.map((l) => l.quantity),
    [10, 10],
  );
  assert.equal(result.acceptable, true);
  data.draft.selections[0].quantity = 11;
  assert.throws(() => solveCpq(data, baseline), /Confirm/);
});
test('CPQ retains minimum service quantities and reports complete/search-limit differences honestly', () => {
  const { data, baseline } = setup();
  data.draft.targetCost = 1100;
  const result = solveCpq(data, baseline);
  assert.equal(result.difference, 400);
  assert.equal(result.acceptable, false);
  assert.equal(result.lines[0].quantity, 10);
  assert.equal(result.lines[1].quantity, 1);
  data.draft.targetCost = 6250;
  const limited = solveCpq(data, baseline, 1);
  assert.equal(limited.searchComplete, false);
  assert.equal(limited.acceptable, false);
});
test('CPQ archive survives catalog changes and rejects stale cost or tampered totals', () => {
  const { data, baseline } = setup();
  data.draft.result = solveCpq(data, baseline);
  const saved = archiveCpq(data, baseline);
  assertCpq(saved);
  saved.catalog[0].unitCost = 200;
  assertCpq(saved);
  assert.equal(saved.archives[0].result.totalCost, 6000);
  saved.archives[0].result.lines[0].quantity = 11;
  assert.throws(() => assertCpq(saved), /fixed quantity/);
  const changed = structuredClone(baseline);
  changed.manualCosts.riskContingency = 1;
  assert.notEqual(costBaselineKey(changed), costBaselineKey(baseline));
  assert.throws(() => archiveCpq(data, changed), /recalculate/);
});
test('CPQ repository protects archive content and retains extension for older clients', () => {
  const { data, baseline, workspace } = setup();
  data.draft.result = solveCpq(data, baseline);
  workspace.cpq = archiveCpq(data, baseline);
  const repo = openWorkspaceRepository(':memory:');
  try {
    const first = repo.save(workspace.project.id, workspace, null);
    const old = structuredClone(first.workspace);
    delete old.cpq;
    const retained = repo.save(workspace.project.id, old, first.revision);
    assert.equal(retained.workspace.cpq.archives.length, 1);
    const bad = structuredClone(retained.workspace);
    bad.cpq.archives = [];
    assert.throws(
      () => repo.save(workspace.project.id, bad, retained.revision),
      /cannot be edited or deleted/,
    );
    assert.equal(repo.get(workspace.project.id).revision, retained.revision);
  } finally {
    repo.close();
  }
});
test('CPQ search returns catalog evidence and XLSX preserves archive rows', async () => {
  const { data, baseline } = setup();
  assert.equal(matchCatalog(data.catalog, '联调')[0].item.code, 'S01');
  assert.deepEqual(matchCatalog(data.catalog, 'nothing-related'), []);
  data.draft.result = solveCpq(data, baseline);
  const archived = archiveCpq(data, baseline).archives[0];
  const bytes = await buildCpqWorkbook(archived);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.deepEqual(
    wb.worksheets.map((s) => s.name),
    ['CPQ Configuration', 'Cost Baseline', 'Rates and Assumptions'],
  );
  assert.equal(wb.getWorksheet(1).getCell('E7').value, 10);
});

test('forged fresh result cannot be saved and extreme catalog bounds fail before search', () => {
  const { data, baseline, workspace } = setup();
  data.draft.result = solveCpq(data, baseline);
  data.draft.result.lines[0].quantity = 1;
  data.draft.result.lines[0].amount = 100;
  workspace.cpq = data;
  const repo = openWorkspaceRepository(':memory:');
  try {
    assert.throws(
      () => repo.save(workspace.project.id, workspace, null),
      /fixed quantity/,
    );
    assert.equal(repo.get(workspace.project.id), null);
  } finally {
    repo.close();
  }
  const valid = setup();
  valid.data.catalog[1].unitCost = 1e8;
  valid.data.catalog[1].maxQty = 1e6;
  assert.throws(() => solveCpq(valid.data, valid.baseline), /maxQty/);
});
