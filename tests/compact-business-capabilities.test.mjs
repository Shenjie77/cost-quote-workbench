import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  compactBulkSheets,
  previewCompactBulk,
} from '../features/design-review/bulk-adapter.ts';
import { entryWorkbook } from '../features/bulk-entry/workbook.ts';
import {
  liveSnapshot,
  projectState,
  workspaceFromState,
} from '../public/design-review/business/live-model.js';
import {
  createMaintenanceVersion,
  selectMaintenanceVersion,
} from '../features/maintenance/versions.ts';
import {
  costOutput,
  quoteOutput,
} from '../public/design-review/generated/output.js';
import ExcelJS from 'exceljs';
import { recalculateCostRows } from '../features/cost/domain.ts';
const fixture = () => {
  const w = createBlankWorkspace(
    projectRecord('ACCEPT', 'Acceptance', 'Client'),
    'input_preparation',
  );
  w.costRows = [
    {
      id: 'kept',
      groupName: 'Delivery',
      category: 'Mandatory',
      scope: 'Install',
      bu: 'FBB',
      reTypeId: w.resourceTypes.find(
        (r) => r.active && r.category === 'internal',
      ).id,
      inputMode: 'mandays',
      mdPerSite: 0,
      years: Array.from({ length: 5 }, (_, i) => ({
        bucket: `Y${i + 1}`,
        sites: 0,
        mandays: 2,
        cost: 0,
      })),
      source: { origin: 'preserve' },
    },
  ];
  return w;
};
test('compact bulk uses fixed headers, stable IDs and all five years', () => {
  const w = fixture(),
    sheets = compactBulkSheets(w, 'personnel'),
    doc = entryWorkbook(sheets),
    sheet = sheets.find((s) => s.id === 'mandays');
  const column = sheet.columns.findIndex((c) => c.key === 'mandays:1');
  doc.workbook.sheets.mandays.cellData[1][column].v = 8;
  const result = previewCompactBulk(doc, sheets, ['mandays'], w, 'personnel');
  assert.deepEqual(result.issues, []);
  assert.equal(result.workspace.costRows[0].id, 'kept');
  assert.equal(result.workspace.costRows[0].years[1].mandays, 8);
  assert.deepEqual(result.workspace.costRows[0].source, w.costRows[0].source);
});
test('bulk rejects formula cells and nonexistent IDs before applying any sheet', () => {
  const w = fixture(),
    sheets = compactBulkSheets(w, 'personnel'),
    doc = entryWorkbook(sheets);
  const sheet = sheets[0],
    id = sheet.columns.findIndex((c) => c.key === 'id');
  doc.workbook.sheets.mandays.cellData[1][id].v = 'unknown';
  doc.workbook.sheets.mandays.cellData[1][5] = { f: '=4+4', v: 8 };
  const result = previewCompactBulk(doc, sheets, ['mandays'], w, 'personnel');
  assert.ok(result.issues.some((i) => i.message.includes('Row ID')));
  assert.ok(result.issues.some((i) => i.message.includes('formulas')));
  assert.equal(w.costRows[0].years[0].mandays, 2);
});
test('legacy maintenance duration is preserved when another field is edited', () => {
  const w = fixture();
  w.maintenanceBoq = {
    coverageMonths: 36,
    boq: [
      {
        id: 'm1',
        model: 'Router',
        quantity: 2,
        unitAnnualQuote: 120,
        serviceLevel: '24x7',
        site: 'A',
        referenceId: 'ref',
        basis: 'historic',
        source: 'BOQ',
      },
    ],
    archives: [],
  };
  const s = projectState(w);
  assert.equal(s.maintenance[0].years, 3);
  s.maintenance[0].remark = 'new';
  const next = workspaceFromState(s);
  assert.equal(next.maintenanceBoq.boq[0].durationYears, 3);
  assert.equal(next.maintenanceBoq.boq[0].referenceId, 'ref');
});
test('maintenance versions keep independent values and immutable archive data', () => {
  const w = fixture();
  const original = {
    coverageMonths: 12,
    boq: [{ id: 'm1', model: 'Router', quantity: 2 }],
    archives: [{ id: 'archive' }],
  };
  const next = createMaintenanceVersion(original);
  next.boq[0].quantity = 8;
  const restored = selectMaintenanceVersion(next, 'MV1');
  assert.equal(restored.boq[0].quantity, 2);
  assert.equal(
    restored.versions.find((v) => v.code === 'MV2').boq[0].quantity,
    8,
  );
  assert.deepEqual(restored.archives, original.archives);
  assert.equal(w.project.id, 'ACCEPT');
});
test('Final output cannot bypass confirmed cost, while Draft uses the original exporter', async () => {
  const w = fixture();
  delete w.costRows[0].source;
  w.costRows = recalculateCostRows(w.costRows, w.resourceTypes, w.rateSettings);
  w.manualCosts.localPurchasedEquipment = 100;
  const snapshot = liveSnapshot(projectState(w));
  await assert.rejects(
    quoteOutput(w, snapshot, { status: 'Final', layout: 'customer' }),
    /Confirm cost/,
  );
  const result = await quoteOutput(w, snapshot, {
    status: 'Draft',
    layout: 'customer',
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(result.bytes);
  assert.ok(book.worksheets.length);
  assert.equal(result.history.status, 'Draft');
  assert.ok(result.history.profitShareSnapshot);
});
test('Simple selected sheets and Full audit remain distinct output contracts', async () => {
  const w = fixture();
  delete w.costRows[0].source;
  w.costRows = recalculateCostRows(w.costRows, w.resourceTypes, w.rateSettings);
  const snapshot = liveSnapshot(projectState(w));
  const simple = await costOutput(snapshot, { sheets: ['Cost Statement'] });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(simple.bytes);
  assert.deepEqual(
    book.worksheets.filter((s) => s.state === 'visible').map((s) => s.name),
    ['Cost Statement'],
  );
  const full = await costOutput(snapshot, { full: true });
  const audit = new ExcelJS.Workbook();
  await audit.xlsx.load(full.bytes);
  assert.ok(audit.worksheets.length > 1);
});

test('customer preview and archived export agree with maintenance and category discounts', async () => {
  const { livePricing } =
    await import('../public/design-review/business/live-model.js');
  const { calculateBuCostAllocation } =
    await import('../features/quote/profit-share.ts');
  const w = fixture();
  delete w.costRows[0].source;
  w.costRows = recalculateCostRows(w.costRows, w.resourceTypes, w.rateSettings);
  w.maintenanceBoq = {
    coverageMonths: 36,
    pricingMode: 'components',
    boq: [
      {
        id: 'm',
        model: 'Router',
        description: 'Maintenance',
        quantity: 2,
        unitAnnualQuote: 120,
        ct: 100,
        spms: 20,
        durationYears: 3,
        serviceLevel: '24x7',
        site: 'SG',
        basis: '',
        source: '',
      },
    ],
    archives: [],
  };
  w.pricing.discount = 100;
  w.pricing.discountAllocation = { mode: 'category', shares: [] };
  const s = projectState(w),
    snapshot = liveSnapshot(s);
  const { buildCostStatementRows, getHQTravelSummary, getY1Year } =
    await import('../features/cost/domain.ts');
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const total = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  ).at(-1).amount;
  const p = livePricing(s, {
    snapshot,
    total,
    buAllocation: calculateBuCostAllocation(snapshot),
  });
  const output = await quoteOutput(w, snapshot);
  assert.equal(p.customerTotal, output.history.customerQuoteAmount);
  assert.equal(p.customer.maintenanceAmount, 720);
  assert.ok(p.discounts.rows.some((r) => r.category === 'Maintenance'));
  assert.deepEqual(p.discounts, output.history.discountAllocationSnapshot);
});
test('workflow required fields roundtrip from stored fieldValues', () => {
  const w = fixture();
  w.processSteps[0].fieldValues = { approval: 'kept' };
  const s = projectState(w);
  assert.deepEqual(s.tasks[0].fields, { approval: 'kept' });
  assert.deepEqual(workspaceFromState(s).processSteps[0].fieldValues, {
    approval: 'kept',
  });
});
test('bulk validation fingerprint survives workbook style normalization but detects edits', async () => {
  const { entryContent } =
    await import('../public/design-review/business/entry-content.js');
  const d = entryWorkbook(compactBulkSheets(fixture(), 'personnel'));
  const original = entryContent(d, ['mandays']),
    normalized = structuredClone(d);
  normalized.workbook.sheets.mandays.cellData[1][0].s = 'normalized';
  normalized.workbook.sheets.mandays.scrollTop = 50;
  assert.equal(entryContent(normalized, ['mandays']), original);
  normalized.workbook.sheets.mandays.cellData[1][0].v = 'Changed';
  assert.notEqual(entryContent(normalized, ['mandays']), original);
});
test('grid preferences isolate projects and versions without hiding every editable column', async () => {
  const { readGrid, writeGrid, orderedColumns } =
    await import('../public/design-review/cost-grid-preferences.js');
  const map = new Map(),
    storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
  const state = projectState(fixture());
  writeGrid(state, { year: '3', hidden: ['bu'] }, storage);
  assert.equal(readGrid(state, storage).year, '3');
  state._source.activeVersion = 'V2';
  assert.deepEqual(readGrid(state, storage), {});
  assert.deepEqual(
    orderedColumns(['index', 'scope', 'action'], { hidden: ['scope'] }),
    ['index', 'scope', 'action'],
  );
});

test('active version captured rates drive cost without overwriting the project catalog', () => {
  const w = fixture();
  const rate = w.resourceTypes.find((r) => r.id === w.costRows[0].reTypeId);
  const captured = structuredClone(w.resourceTypes);
  captured.find((r) => r.id === rate.id).mandayRate = rate.mandayRate * 2;
  w.costVersions[0].resourceTypes = captured;
  w.costRows = recalculateCostRows(w.costRows, captured, w.rateSettings);
  const s = projectState(w);
  assert.equal(s.rows[0].rate, rate.mandayRate * 2);
  assert.deepEqual(workspaceFromState(s), w);
  s.rows[0].years[0] = 4;
  const updated = workspaceFromState(s);
  assert.deepEqual(updated.resourceTypes, w.resourceTypes);
  assert.deepEqual(updated.costVersions[0].resourceTypes, captured);
  assert.equal(
    updated.costRows[0].years[0].cost,
    w.costRows[0].years[0].cost * 2,
  );
});

test('compact CPQ solve and archive retain the full cost version and pass persistence validation', async () => {
  const { workspaceCostBaseline } =
    await import('../public/design-review/business/cpq-baseline.js');
  const { emptyCpq, confirmMapping, solveCpq, archiveCpq } =
    await import('../features/cpq/domain.ts');
  const { openWorkspaceRepository } =
    await import('../server/workspace-repository.mjs');
  const w = fixture();
  delete w.costRows[0].source;
  w.costRows = recalculateCostRows(w.costRows, w.resourceTypes, w.rateSettings);
  w.cpq = emptyCpq();
  w.cpq.catalog = [
    {
      code: 'S1',
      scope: 'Service',
      kind: 'service',
      unit: 'unit',
      unitCost: 100,
      active: true,
      adjustable: true,
      step: 1,
      minQty: 0,
      maxQty: 10,
      referenceQty: 1,
      tags: '',
      revision: '1',
    },
  ];
  w.cpq.draft = {
    ...w.cpq.draft,
    costVersion: w.activeVersion,
    brief: 'Service',
    targetCost: 100,
    targetBasis: 'Acceptance',
    selections: [
      { code: 'S1', quantity: 1, locked: false, weight: 1, reason: 'Service' },
    ],
  };
  w.cpq = confirmMapping(w.cpq, 'Verifier');
  const state = projectState(w);
  state.rows[0].years[0] = 6;
  const baseline = workspaceCostBaseline(workspaceFromState(state));
  state.cpqWorkspace.draft.result = solveCpq(state.cpqWorkspace, baseline);
  const saved = workspaceFromState(state);
  assert.deepEqual(workspaceCostBaseline(saved), baseline);
  saved.cpq = archiveCpq(saved.cpq, workspaceCostBaseline(saved));
  const repo = openWorkspaceRepository(':memory:');
  try {
    const result = repo.save(saved.project.id, saved, null);
    const archived = result.workspace.cpq.archives[0];
    assert.equal(archived.result.totalCost, 100);
    assert.equal(archived.costBaseline.state, 'Draft');
    assert.equal(archived.costBaseline.costRows[0].years[0].mandays, 6);
    assert.deepEqual(archived.costBaseline.travelRows, w.travelRows);
  } finally {
    repo.close();
  }
});

test('clipboard menu aliases retain canonical permission checks, parameters and cleanup', async () => {
  const { registerClipboardMenuAliases } =
    await import('../features/calculation/clipboard-compat.ts');
  const registered = new Map(),
    requests = [];
  const service = {
    hasCommand: (id) => id === 'sheet.command.copy' || registered.has(id),
    registerCommand: (command) => {
      registered.set(command.id, command);
      return { dispose: () => registered.delete(command.id) };
    },
    executeCommand: async (id, params) => {
      requests.push({ id, params });
      if (params.protected) throw new Error('Protected range');
      return true;
    },
  };
  const handle = registerClipboardMenuAliases(service);
  const paste = registered.get('sheet.command.paste');
  const params = {
    target: { unitId: 'workbook', subUnitId: 'sheet' },
    value: 'paste-value',
  };
  await paste.handler(null, params);
  assert.deepEqual(requests[0], { id: 'univer.command.paste', params });
  await assert.rejects(
    paste.handler(null, { protected: true }),
    /Protected range/,
  );
  assert.equal(registered.has('sheet.command.copy'), false);
  handle.dispose();
  assert.equal(registered.size, 0);
});

test('catalog adoption creates valid version-owned subcontract lines and retains catalog identity', async () => {
  const { copySubcontractCatalogLine } =
    await import('../features/cost/subcontract-domain.ts');
  const { openWorkspaceRepository } =
    await import('../server/workspace-repository.mjs');
  const w = fixture();
  delete w.costRows[0].source;
  const item = {
    id: 'catalog1',
    code: 'S1',
    item: 'Service',
    bu: 'FBB',
    supplier: 'Vendor',
    pricingBasis: 'Fixed',
    unit: 'lot',
    unitPrice: 50,
    currency: 'SGD',
    active: true,
  };
  w.subcontractItems = [item];
  const state = projectState(w),
    base = copySubcontractCatalogLine(item);
  globalThis.localStorage ||= { getItem: () => null };
  const { subcontractView } =
    await import('../public/design-review/subcontract-view.js');
  const { reviewData } =
    await import('../public/design-review/business/adapter.js');
  assert.match(
    subcontractView(state, reviewData(state), 'shared', true),
    /Service/,
  );

  state.subcon.push({
    ...base,
    price: base.unitPrice,
    quantities: [2, 0, 0, 0, 0],
  });
  const repo = openWorkspaceRepository(':memory:');
  try {
    const saved = repo.save(
      w.project.id,
      workspaceFromState(state),
      null,
    ).workspace;
    assert.equal(saved.subcontractCost.lines[0].catalogItemId, item.id);
    assert.equal(saved.subcontractCost.lines[0].unitPrice, 50);
    assert.equal(saved.subcontractCost.lines[0].supplier, undefined);
    assert.deepEqual(saved.subcontractItems[0], item);
  } finally {
    repo.close();
  }
});
