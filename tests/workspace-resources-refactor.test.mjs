import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactValue,
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { emptySsr } from '../features/ssr/domain.ts';

/** Expose the resource layer's reference semantics independently of repository cloning. */
function resourceFixture() {
  const workspace = createBlankWorkspace(
    projectRecord('RESOURCE-TEST', 'Resource fixture', 'Customer'),
    'input_preparation',
  );
  const record = {
    projectId: 'RESOURCE-TEST',
    revision: 7,
    updatedAt: '2026-09-10T00:00:00.000Z',
    workspace,
  };
  const writes = [];
  const repository = {
    /** Return the same record so tests can observe deliberate in-process mutations. */
    get() {
      return record;
    },
    /** Record the exact save arguments without adding repository normalization. */
    save(id, nextWorkspace, revision) {
      writes.push({ type: 'save', id, workspace: nextWorkspace, revision });
      return { ...record, workspace: nextWorkspace, revision: revision + 1 };
    },
    /** Capture workflow commands separately from ordinary resource saves. */
    applyWorkflowAction(id, action, revision) {
      writes.push({ type: 'workflow', id, action, revision });
      return { ...record, revision: revision + 1 };
    },
  };
  return { repository, record, workspace, writes };
}

/** Update through the public entry point while retaining a distinct lookup alias. */
function patch(fixture, module, section, changes, revision = 7) {
  return updateResource(
    fixture.repository,
    'LOOKUP-ALIAS',
    module,
    { section },
    changes,
    revision,
  );
}

test('compact responses detach nested data while retaining baseline version labels', () => {
  const source = {
    price: 12,
    costBaseline: { code: 'V4', costRows: [{ id: 'PRIVATE' }] },
    costVersion: 'V1',
    nested: [{ key: 'private', inputKey: 'private', quantity: 3 }],
    commercialBasis: 'private',
  };
  const before = structuredClone(source);
  assert.deepEqual(compactValue(source), {
    price: 12,
    costVersion: 'V4',
    nested: [{ quantity: 3 }],
  });
  assert.deepEqual(source, before);
});

test('collection reads retain normalized string matching, stable order, and numeric pagination', () => {
  const fixture = resourceFixture();
  fixture.workspace.quoteAssumptions = [
    { id: 'A', text: 'Ａlpha', amount: 123, nested: { text: 'hidden' } },
    { id: 'B', text: 'ALPHA beta', amount: 234 },
    { id: 'C', text: 'Gamma', amount: 345 },
  ];
  const before = structuredClone(fixture.workspace.quoteAssumptions);
  const read = (options) =>
    readResource(fixture.repository, 'LOOKUP-ALIAS', 'quote', {
      section: 'assumptions',
      ...options,
    });

  const page = read({ query: 'alpha', offset: '1', limit: '1' });
  assert.equal(page.total, 2);
  assert.equal(page.offset, 1);
  assert.equal(page.limit, 1);
  assert.equal(page.nextOffset, null);
  assert.deepEqual(page.items, [before[1]]);
  assert.equal(read({ query: 'ＡＬＰＨＡ', limit: 1 }).nextOffset, 1);
  assert.deepEqual(read({ id: 'A', query: 'alpha' }).items, [before[0]]);
  assert.equal(read({ query: 'hidden' }).total, 0);
  assert.equal(read({ query: '123' }).total, 0);
  assert.deepEqual(read({ offset: 20 }).items, []);
  assert.deepEqual(read({ id: '', query: '' }).items, before);
  assert.deepEqual(fixture.workspace.quoteAssumptions, before);
  assert.deepEqual(fixture.writes, []);
});

test('pagination boundaries and object-filter rejection keep their public error messages', () => {
  const fixture = resourceFixture();
  for (const options of [
    { offset: -1 },
    { offset: 0.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 },
    { limit: 201 },
    { limit: 'invalid' },
  ])
    assert.throws(
      () => readResource(fixture.repository, 'RESOURCE-TEST', 'cost', options),
      { message: 'offset must be >= 0; limit must be 1–200.' },
    );
  for (const filter of ['id', 'query', 'offset', 'limit'])
    assert.throws(
      () =>
        readResource(fixture.repository, 'RESOURCE-TEST', 'project', {
          [filter]: '',
        }),
      { message: 'Filters and pagination require a collection section.' },
    );
});

test('resource routing preserves lazy initialization and workflow history ordering', () => {
  const fixture = resourceFixture();
  fixture.workspace.workflowUpdates = [{ id: 'OLD' }, { id: 'NEW' }];
  const history = readResource(fixture.repository, 'RESOURCE-TEST', 'project', {
    section: 'workflow-history',
  });
  assert.deepEqual(history.items, [{ id: 'NEW' }, { id: 'OLD' }]);
  assert.deepEqual(fixture.workspace.workflowUpdates, [
    { id: 'OLD' },
    { id: 'NEW' },
  ]);

  delete fixture.workspace.maintenanceBoq;
  readResource(fixture.repository, 'RESOURCE-TEST', 'boq', {
    section: 'references',
  });
  assert.equal(Object.hasOwn(fixture.workspace, 'maintenanceBoq'), false);
  assert.equal(
    readResource(fixture.repository, 'RESOURCE-TEST', 'boq').section,
    'rows',
  );
  assert.ok(fixture.workspace.maintenanceBoq);

  delete fixture.workspace.cpq;
  assert.throws(
    () =>
      readResource(fixture.repository, 'RESOURCE-TEST', 'cpq', {
        section: 'unknown',
      }),
    { message: 'CPQ sections: catalog, draft, selections, archives' },
  );
  assert.ok(fixture.workspace.cpq);
  assert.throws(
    () => readResource(fixture.repository, 'RESOURCE-TEST', 'constructor'),
    { message: 'Unknown resource: constructor' },
  );
});

test('nested settings merge one level, replace arrays, and preserve unrelated object references', () => {
  const fixture = resourceFixture();
  const originalPricing = fixture.workspace.pricing;
  const originalCosts = fixture.workspace.costVersions[0];
  const pricingPatch = { targetGrossMargin: 27, profitShareRates: { A: 12 } };
  const receipt = patch(fixture, 'quote', 'settings', {
    set: { pricing: pricingPatch },
  });
  assert.deepEqual(fixture.workspace.pricing, {
    ...originalPricing,
    ...pricingPatch,
  });
  assert.notEqual(fixture.workspace.pricing, originalPricing);
  assert.equal(
    fixture.workspace.pricing.profitShareRates,
    pricingPatch.profitShareRates,
  );
  assert.equal(fixture.workspace.costVersions[0], originalCosts);
  assert.deepEqual(receipt.changedFields, ['pricing']);
  assert.equal(fixture.writes[0].workspace, fixture.workspace);
  assert.equal(fixture.writes[0].id, 'LOOKUP-ALIAS');

  const annualUplifts = [1, 2, 3, 4, 5];
  const priorSettings = originalCosts.rateSettings;
  patch(fixture, 'cost', 'settings', {
    set: { rateSettings: { annualUplifts } },
  });
  assert.equal(originalCosts.rateSettings.annualUplifts, annualUplifts);
  assert.deepEqual(originalCosts.rateSettings, {
    ...priorSettings,
    annualUplifts,
  });
  assert.equal(fixture.workspace.rateSettings, originalCosts.rateSettings);
});

test('legacy cost patch selectors and manual amounts retain their precedence over saved defaults', () => {
  const fixture = resourceFixture();
  const version = fixture.workspace.costVersions[0];
  version.rateSettings.allowancePools = ['HQ'];
  patch(fixture, 'cost', 'settings', {
    set: { rateSettings: { localArpAllowanceEnabled: true } },
  });
  assert.deepEqual(version.rateSettings.allowancePools, ['LOCAL', 'ARP']);
  assert.deepEqual(
    version.rateSettings.allowanceResourceTypeIds,
    version.resourceTypes
      .filter(
        (resource) =>
          resource.category === 'internal' &&
          ['LOCAL', 'ARP'].includes(resource.pool),
      )
      .map((resource) => resource.id),
  );
  patch(fixture, 'cost', 'settings', {
    set: { rateSettings: { allowanceResourceTypeIds: [] } },
  });
  assert.equal(Object.hasOwn(version.rateSettings, 'allowancePools'), false);
  assert.deepEqual(version.rateSettings.allowanceResourceTypeIds, []);

  version.manualCosts.otherServiceRate = 0.01;
  patch(fixture, 'cost', 'settings', {
    set: { manualCosts: { otherService: 123 } },
  });
  assert.equal(version.manualCosts.otherService, 123);
  assert.equal(Object.hasOwn(version.manualCosts, 'otherServiceRate'), false);
  patch(fixture, 'cost', 'settings', {
    set: { manualCosts: { otherService: 321, otherServiceRate: 0.02 } },
  });
  assert.equal(version.manualCosts.otherServiceRate, 0.02);
});

test('collection patches preserve positions, retain untouched references, and detach incoming records', () => {
  const fixture = resourceFixture();
  const untouched = { id: 'A', text: 'Keep' };
  fixture.workspace.quoteAssumptions = [
    untouched,
    { id: 'B', text: 'Old', previous: true },
    { id: 'C', text: 'Remove' },
  ];
  const incoming = { id: 'B', nested: { text: 'Updated' } };
  const receipt = patch(fixture, 'quote', 'assumptions', {
    upsert: [incoming, { id: 'D', text: 'New' }],
    remove: ['C'],
  });
  assert.deepEqual(
    fixture.workspace.quoteAssumptions.map((item) => item.id),
    ['A', 'B', 'D'],
  );
  assert.equal(fixture.workspace.quoteAssumptions[0], untouched);
  assert.equal(fixture.workspace.quoteAssumptions[1].text, 'Old');
  assert.equal(fixture.workspace.quoteAssumptions[1].previous, true);
  assert.notEqual(
    fixture.workspace.quoteAssumptions[1].nested,
    incoming.nested,
  );
  assert.deepEqual(receipt.changedIds, ['B', 'D']);
  assert.deepEqual(receipt.removedIds, ['C']);
});

test('object resource writeback preserves the owning containers and subcontract replacement rules', () => {
  const fixture = resourceFixture();
  const project = fixture.workspace.project;
  patch(fixture, 'project', 'settings', { set: { name: 'Renamed' } });
  assert.equal(fixture.workspace.project, project);
  assert.equal(project.name, 'Renamed');

  fixture.workspace.ssr = { ...emptySsr(), proposalNumber: 'KEEP' };
  patch(fixture, 'project', 'metadata', {
    set: { scopeBrief: 'Delivery scope' },
  });
  assert.equal(fixture.workspace.ssr.proposalNumber, 'KEEP');
  assert.equal(fixture.workspace.ssr.scopeBrief, 'Delivery scope');
  const ssr = fixture.workspace.ssr;
  patch(fixture, 'ssr', 'settings', { set: { proposalNumber: 'NEXT' } });
  assert.equal(fixture.workspace.ssr, ssr);

  readResource(fixture.repository, 'RESOURCE-TEST', 'boq');
  const maintenance = fixture.workspace.maintenanceBoq;
  patch(fixture, 'boq', 'settings', { set: { coverageMonths: 24 } });
  assert.equal(fixture.workspace.maintenanceBoq, maintenance);
  assert.equal(maintenance.coverageMonths, 24);

  const version = fixture.workspace.costVersions[0];
  const previous = version.subcontractCost;
  patch(fixture, 'cost', 'subcontract', { set: { mode: 'site' } });
  assert.notEqual(version.subcontractCost, previous);
  assert.deepEqual(version.subcontractCost, { ...previous, mode: 'site' });
  assert.equal(fixture.workspace.subcontractCost, version.subcontractCost);
});

test('workflow tracking uses workflow actions with the original lookup ID and unchanged receipts', () => {
  const fixture = resourceFixture();
  fixture.workspace.workflowEngineVersion = 1;
  const receipt = patch(fixture, 'project', 'workflow-tracking', {
    set: { owner: 'PM', note: 'Follow up' },
  });
  assert.deepEqual(fixture.writes, [
    {
      type: 'workflow',
      id: 'LOOKUP-ALIAS',
      action: {
        nodeCode: fixture.workspace.currentWorkflowStepCode,
        action: 'update',
        owner: 'PM',
        note: 'Follow up',
      },
      revision: 7,
    },
  ]);
  assert.equal(receipt.revision, 8);
  assert.deepEqual(receipt.changedFields, ['owner', 'note']);
  assert.deepEqual(receipt.changedIds, []);
  assert.deepEqual(receipt.removedIds, []);
  patch(fixture, 'project', 'workflow-tracking', {
    set: { currentWorkflowStepCode: 'NEXT_NODE' },
  });
  assert.equal(fixture.writes[1].action.action, 'start');
});

test('resource update validation keeps revision, read-only, field, and patch errors in order', () => {
  const fixture = resourceFixture();
  assert.throws(
    () => patch(fixture, 'quote', 'templates', { unexpected: true }, 6),
    { message: 'Project changed. Read this resource again.' },
  );
  assert.throws(
    () => patch(fixture, 'quote', 'templates', { unexpected: true }),
    {
      message: 'This section is read-only; use the explicit workflow command.',
    },
  );
  assert.throws(
    () => patch(fixture, 'quote', 'settings', { unexpected: true }),
    {
      message:
        'Unsupported field: unexpected. Allowed: set, upsert, remove, order',
    },
  );
  assert.throws(() => patch(fixture, 'quote', 'settings', { set: {} }), {
    message: 'At least one change is required.',
  });
  assert.throws(
    () => patch(fixture, 'quote', 'settings', { upsert: [{ id: 'A' }] }),
    { message: 'Object updates require set.' },
  );
  assert.deepEqual(fixture.writes, []);
});
