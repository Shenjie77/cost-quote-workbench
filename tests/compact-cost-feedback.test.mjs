import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  projectState,
  workspaceFromState,
  liveSnapshot,
} from '../public/design-review/business/live-model.js';
import {
  editDirectMandays,
  repairCostRecovery,
  costInputSummary,
} from '../public/design-review/business/cost-input.js';
import { orderedColumns } from '../public/design-review/cost-grid-preferences.js';
import {
  costOutput,
  quoteOutput,
} from '../public/design-review/generated/output.js';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { recalculateCostRows } from '../features/cost/domain.ts';
const fixture = () => {
  const w = createBlankWorkspace(
    projectRecord('FEEDBACK', 'Feedback regression', 'Client'),
    'input_preparation',
  );
  const resource = w.resourceTypes.find(
    (r) => r.active && r.category === 'internal',
  );
  w.costRows = [
    {
      id: 'legacy-sites',
      groupName: 'Delivery',
      category: 'Mandatory',
      scope: 'Install',
      bu: 'FBB',
      reTypeId: resource.id,
      inputMode: 'sites',
      mdPerSite: 2,
      years: [1, 2, 0, 4, 0].map((sites, i) => ({
        bucket: `Y${i + 1}`,
        sites,
        cost: 0,
      })),
      extension: { keep: true },
    },
  ];
  return w;
};
test('legacy sites project displays all five finite mandays without modifying saved source data', () => {
  const w = fixture();
  const s = projectState(w);
  assert.deepEqual(s.rows[0].years, [2, 4, 0, 8, 0]);
  assert.deepEqual(workspaceFromState(s), w);
  assert.equal(
    s.rows[0].years.reduce((a, b) => a + b, 0),
    14,
  );
});
test('editing a direct manday converts only that row and exports the original five-year Excel template', async () => {
  const w = fixture();
  w.costRows.push({ ...structuredClone(w.costRows[0]), id: 'untouched' });
  const s = projectState(w);
  editDirectMandays(s.rows[0], 0, 3);
  const next = workspaceFromState(s),
    snapshot = liveSnapshot(s);
  assert.deepEqual(
    next.costRows[0].years.map((y) => y.mandays),
    [3, 4, 0, 8, 0],
  );
  assert.equal(next.costRows[0].mdPerSite, 0);
  assert.ok(next.costRows[0].years.every((y) => y.sites === 0));
  assert.equal(next.costRows[1].inputMode, 'sites');
  assert.equal(next.costRows[1].mdPerSite, 2);
  assert.deepEqual(next.costRows[0].extension, w.costRows[0].extension);
  assert.deepEqual(
    validateCostExportSnapshot(snapshot).filter((i) => i.severity === 'error'),
    [],
  );
  const out = await costOutput(snapshot, {
    sheets: ['Cost Detail', 'Cost Statement'],
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(out.bytes);
  assert.deepEqual(
    book.worksheets.filter((s) => s.state === 'visible').map((s) => s.name),
    ['Cost Detail', 'Cost Statement'],
  );
  assert.ok(book.getWorksheet('Cost Detail').rowCount > 5);
  next.workflowMode = 'project';
  const combined = await quoteOutput(next, snapshot, {
    layout: 'combined',
    sheets: ['Cost Detail', 'Cost Statement'],
  });
  await book.xlsx.load(combined.bytes);
  assert.ok(book.getWorksheet('Quotation Details'));
  assert.ok(book.getWorksheet('Cost Detail'));
  assert.ok(book.getWorksheet('Cost Statement'));
  assert.equal(book.getWorksheet('Summary BU'), undefined);
});
test('direct entry fills legacy missing years and discards leftover site fields', () => {
  const s = projectState(fixture());
  Object.assign(s.rows[0], {
    inputMode: 'mandays',
    years: [1, undefined, undefined, undefined, undefined],
  });
  editDirectMandays(s.rows[0], 1, 2);
  assert.deepEqual(s.rows[0].years, [1, 2, 0, 0, 0]);
  assert.deepEqual(
    validateCostExportSnapshot(liveSnapshot(s)).filter(
      (i) => i.severity === 'error',
    ),
    [],
  );
});
test('single-year saved column order expands to one chronological annual block with actions last', () => {
  const ids = [
    'index',
    'scope',
    'bu',
    'reType',
    'Y1:mandays',
    'Y2:mandays',
    'Y3:mandays',
    'Y4:mandays',
    'Y5:mandays',
    'rate',
    'totalCost',
    'action',
  ];
  const prefs = {
    order: [
      'index',
      'scope',
      'reType',
      'bu',
      'Y1:mandays',
      'rate',
      'totalCost',
      'action',
    ],
  };
  assert.deepEqual(orderedColumns(ids, prefs), [
    'index',
    'scope',
    'reType',
    'bu',
    'Y1:mandays',
    'Y2:mandays',
    'Y3:mandays',
    'Y4:mandays',
    'Y5:mandays',
    'rate',
    'totalCost',
    'action',
  ]);
  assert.deepEqual(
    orderedColumns(ids, { ...prefs, hidden: ['Y3:mandays', 'action'] }),
    [
      'index',
      'scope',
      'reType',
      'bu',
      'Y1:mandays',
      'Y2:mandays',
      'Y4:mandays',
      'Y5:mandays',
      'rate',
      'totalCost',
      'action',
    ],
  );
  const y2 = ids.filter((id) => !/^Y[1345]:/.test(id));
  assert.equal(orderedColumns(y2, prefs).indexOf('Y2:mandays'), 4);
});
test('input summary reconciles HR, selected 3% allowances and HQ travel without double counting', () => {
  const w = fixture();
  const resource = w.resourceTypes.find((r) => r.id === w.costRows[0].reTypeId);
  Object.assign(resource, { pool: 'HQ', mandayRate: 100, mandaysPerMonth: 10 });
  w.costVersions[0].resourceTypes = structuredClone(w.resourceTypes);
  w.rateSettings = {
    ...w.rateSettings,
    baseYear: 2027,
    tdStart: '2027-01-01',
    tdEnd: '2031-12-31',
    annualUplifts: [0, 0, 0, 0, 0],
    allowancePools: ['HQ'],
  };
  w.travelSettings = {
    enabled: true,
    monthlyAllowance: 1000,
    airfarePerTrip: 200,
    trips: 2,
  };
  w.costRows = recalculateCostRows(w.costRows, w.resourceTypes, w.rateSettings);
  const snapshot = liveSnapshot(projectState(w));
  assert.deepEqual(costInputSummary(snapshot), {
    hr: 1400,
    allowance: 42,
    travel: 1800,
    mandays: 14,
    total: 3242,
  });
  snapshot.travelSettings.enabled = false;
  assert.equal(costInputSummary(snapshot).total, 1442);
  snapshot.rateSettings.allowancePools = [];
  assert.equal(costInputSummary(snapshot).total, 1400);
});

test('explicit recovery repairs missing direct years while preserving entered efforts and history', () => {
  const w = fixture();
  w.costRows[0].inputMode = 'mandays';
  w.costRows[0].years[0].mandays = 1;
  w.costRows[0].years[1].mandays = 2;
  w.quoteHistory = [{ id: 'retained' }];
  const repaired = repairCostRecovery(w);
  assert.deepEqual(
    repaired.costRows[0].years.map((y) => y.mandays),
    [1, 2, 0, 0, 0],
  );
  assert.deepEqual(repaired.costVersions[0].costRows, repaired.costRows);
  assert.deepEqual(repaired.quoteHistory, w.quoteHistory);
  assert.equal(w.costRows[0].mdPerSite, 2);
  assert.deepEqual(
    validateCostExportSnapshot(liveSnapshot(projectState(repaired))).filter(
      (i) => i.severity === 'error',
    ),
    [],
  );
  w.costVersions[0].state = 'Confirmed';
  assert.deepEqual(repairCostRecovery(w), w);
});
test('legacy rows with no input-mode flag retain site-based quantities when assumptions change', () => {
  const w = fixture();
  delete w.costRows[0].inputMode;
  const s = projectState(w);
  assert.deepEqual(workspaceFromState(s), w);
  s.rateSettings.defaultUplift = 6;
  const snap = liveSnapshot(s);
  assert.equal(snap.costRows[0].inputMode, 'sites');
  assert.equal(snap.costRows[0].mdPerSite, 2);
  assert.deepEqual(
    snap.costRows[0].years.map((y) => y.sites),
    [1, 2, 0, 4, 0],
  );
  assert.deepEqual(
    validateCostExportSnapshot(snap).filter((i) => i.severity === 'error'),
    [],
  );
});
