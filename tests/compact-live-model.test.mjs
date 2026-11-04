import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  projectState,
  workspaceFromState,
  liveSnapshot,
  livePricing,
  editLiveQuoteLine,
} from '../public/design-review/business/live-model.js';
import { reviewData } from '../public/design-review/business/adapter.js';
const fixture = () =>
  createBlankWorkspace(
    projectRecord('COMPACT-TEST', 'Compact test', 'Client'),
    'input_preparation',
  );
test('compact projection round-trips the complete original workspace without data migration', () => {
  const w = fixture();
  w.quoteHistory = [
    { id: 'retained', status: 'Draft', nested: { preserve: true } },
  ];
  w.travelRows = [{ id: 'legacy', preserve: 1 }];
  w.unknownFutureField = { x: 2 };
  assert.deepEqual(workspaceFromState(projectState(w)), w);
});
test('compact cost edits retain version provenance, resource identity, workflow and quote history', () => {
  const w = fixture();
  const r = w.resourceTypes[0];
  w.costRows = [
    {
      id: 'real-row',
      scope: 'Delivery',
      groupName: 'Work',
      category: 'Mandatory',
      bu: 'FBB',
      reTypeId: r.id,
      inputMode: 'mandays',
      mdPerSite: 1,
      years: Array.from({ length: 5 }, (_, i) => ({
        bucket: `Y${i + 1}`,
        mandays: 2,
        sites: 2,
        cost: 0,
      })),
      extension: 'keep',
    },
  ];
  const s = projectState(w);
  s.rows[0].years[1] = 6;
  const next = workspaceFromState(s);
  assert.equal(next.costRows[0].id, 'real-row');
  assert.equal(next.costRows[0].reTypeId, r.id);
  assert.equal(next.costRows[0].extension, 'keep');
  assert.equal(next.costRows[0].years[1].mandays, 6);
  assert.deepEqual(next.processSteps, w.processSteps);
  assert.deepEqual(next.quoteHistory, w.quoteHistory);
  assert.deepEqual(next.costVersions[0].costRows, next.costRows);
});
test('same group with different categories stays separate and read-only versions reject edits', () => {
  const w = fixture();
  w.costRows = ['Mandatory', 'Optional'].map((category, i) => ({
    id: `r${i}`,
    scope: 'Work',
    groupName: 'Same',
    category,
    bu: 'FBB',
    reTypeId: w.resourceTypes[0].id,
    inputMode: 'mandays',
    mdPerSite: 1,
    years: Array.from({ length: 5 }, (_, i) => ({
      bucket: `Y${i + 1}`,
      mandays: 1,
      sites: 1,
      cost: 1,
    })),
  }));
  const s = projectState(w);
  assert.equal(s.groups.length, 2);
  assert.deepEqual(workspaceFromState(s), w);
  s._source.costVersions[0].state = 'Confirmed';
  s.rows[0].years[0] = 5;
  assert.throws(() => workspaceFromState(s), /read-only/);
});
test('loading a saved manual quotation does not regenerate prices or discard unknown metadata', () => {
  const w = fixture();
  w.manualCosts.localPurchasedEquipment = 100;
  w.pricing = {
    targetGrossMargin: 45,
    discount: 0,
    gstPercent: 0,
    lineMode: 'manual',
    manualLines: [
      {
        id: 'saved-line',
        description: 'Custom line',
        unit: 'lot',
        quantity: 1,
        unitPrice: 200,
        costWeight: 100,
      },
    ],
    lineRemarks: { 'saved-line': 'private' },
  };
  const s = projectState(w),
    d = reviewData(s);
  assert.equal(livePricing(s, d).quoteAfterTax, 200);
  assert.deepEqual(workspaceFromState(s), w);
  editLiveQuoteLine(s, d, 'saved-line', {
    targetGrossMargin: 60,
    priceFixed: false,
  });
  const next = workspaceFromState(s);
  assert.equal(next.pricing.manualLines[0].id, 'saved-line');
  assert.equal(next.pricing.lineRemarks['saved-line'], 'private');
  assert.equal(liveSnapshot(s).costRows.length, w.costRows.length);
});
