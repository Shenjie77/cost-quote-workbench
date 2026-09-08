import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  deleteSuspendedCostVersion,
  costVersionDeletionReason,
  nextCostVersionCode,
} from '../features/cost/version-deletion.ts';
import {
  deleteCostVersion,
  createCostDraft,
  readResource,
  updateResource,
  syncVersion,
} from '../server/workspace-resources.mjs';
import {
  emptySsr,
  recordSubmission,
  recordReviewResult,
  commercialBasisKey,
} from '../features/ssr/domain.ts';
import {
  emptyCpq,
  confirmMapping,
  solveCpq,
  archiveCpq,
} from '../features/cpq/domain.ts';

const ID = 'DELETE-COST-FIXTURE';
function fixture({ third = false, state = 'Suspended' } = {}) {
  const w = createBlankWorkspace(
    projectRecord(ID, 'Cost deletion fixture', 'Client'),
    'costing',
  );
  w.costVersionLocks = {};
  w.rateSettings.tdStart = '2026-01-01';
  w.manualCosts.riskContingency = 120;
  w.costVersions = [createCostVersion('V1', 'Confirmed', null, w)];
  w.costVersions.push(
    createCostVersion('V2', state, 'V1', {
      ...w,
      manualCosts: { ...w.manualCosts, riskContingency: 250 },
    }),
  );
  if (third)
    w.costVersions.push(
      createCostVersion('V3', 'Draft', 'V2', {
        ...w,
        manualCosts: { ...w.manualCosts, riskContingency: 330 },
      }),
    );
  w.activeVersion = w.workflowVersion = third ? 'V3' : 'V2';
  w.currentWorkflowStepCode = 'TD_EFFORT_REVIEW';
  w.selectedStep = w.processSteps.findIndex(
    (s) => s.code === w.currentWorkflowStepCode,
  );
  w.versionWorkflows = Object.fromEntries(
    w.costVersions.map((v) => [
      v.code,
      {
        currentWorkflowStepCode: w.currentWorkflowStepCode,
        processSteps: structuredClone(w.processSteps),
        projectStatus: 'costing',
      },
    ]),
  );
  const approved = w.versionWorkflows.V1;
  approved.currentWorkflowStepCode = 'DELIVERY_REVIEW';
  approved.processSteps.find((s) => s.code === 'DELIVERY_REVIEW').state =
    'completed';
  syncVersion(w, w.activeVersion);
  let ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'P-FIXTURE',
    scopeBrief: 'Retained deployment scope',
    commercialBasis: commercialBasisKey(w),
  };
  ssr = recordSubmission(ssr, w.costVersions[1], {
    kind: 'DTRB',
    domain: '',
    owner: 'TD',
    dueDate: '2026-09-20',
    applicationNumber: 'DTRB-HISTORY',
    evidence: 'Historical technical review fixture',
  });
  ssr = recordReviewResult(ssr, ssr.submissions[0].id, {
    outcome: 'approved',
    evidence: 'Approved technical estimate',
    conditions: [],
  });
  w.ssr = ssr;
  let cpq = emptyCpq();
  cpq.catalog = [
    {
      code: 'SERVICE-1',
      scope: 'Deployment',
      unit: 'day',
      active: true,
      step: 1,
      minQty: 0,
      maxQty: 100,
      referenceQty: 0,
      tags: '',
      revision: '1',
      unitCost: 10,
      kind: 'service',
      adjustable: true,
    },
  ];
  cpq.draft = {
    ...cpq.draft,
    brief: 'Deployment',
    costVersion: 'V2',
    targetCost: 100,
    targetBasis: 'Fixture',
    selections: [
      {
        code: 'SERVICE-1',
        quantity: 0,
        locked: false,
        weight: 1,
        reason: 'Actual deployment',
      },
    ],
  };
  cpq = confirmMapping(cpq, 'SSR');
  cpq.draft.result = solveCpq(cpq, w.costVersions[1]);
  w.cpq = archiveCpq(cpq, w.costVersions[1]);
  w.quoteHistory = [
    {
      id: 'QUOTE-HISTORY',
      quoteNumber: 'QUOTE-FIXTURE',
      generatedAt: '2026-09-01T00:00:00.000Z',
      costVersion: 'V2',
      templateId: w.selectedQuoteTemplateId,
      status: 'Draft',
      costAmount: 250,
      quoteBeforeTax: 300,
      gstAmount: 27,
      quoteAfterTax: 327,
      grossMarginPercent: 16.67,
      note: 'Historical quotation output',
    },
  ];
  return w;
}
function setup(t, options, db = ':memory:') {
  const repo = openWorkspaceRepository(db);
  t.after(() => repo.close());
  repo.save(ID, fixture(options), null);
  return repo;
}

test('deleting the active workflow Suspended version restores the highest remaining baseline and its actual workflow', (t) => {
  const repo = setup(t);
  const before = repo.get(ID);
  const input = structuredClone(before.workspace);
  const next = deleteSuspendedCostVersion(
    input,
    'V2',
    '2026-09-08T00:00:00.000Z',
  );
  assert.deepEqual(
    input,
    before.workspace,
    'pure helper does not mutate its caller',
  );
  const saved = repo.save(ID, next, before.revision);
  const w = saved.workspace;
  assert.equal(w.activeVersion, 'V1');
  assert.equal(w.workflowVersion, 'V1');
  assert.equal(w.currentWorkflowStepCode, 'DELIVERY_REVIEW');
  assert.equal(
    w.processSteps.find((s) => s.code === 'DELIVERY_REVIEW').state,
    'completed',
  );
  assert.deepEqual(w.costVersions, [before.workspace.costVersions[0]]);
  assert.deepEqual(w.manualCosts, before.workspace.costVersions[0].manualCosts);
  assert.deepEqual(
    w.deletedCostVersions.V2.version,
    before.workspace.costVersions[1],
  );
  assert.deepEqual(
    w.deletedCostVersions.V2.workflow,
    before.workspace.versionWorkflows.V2,
  );
  assert.deepEqual(w.ssr, before.workspace.ssr);
  assert.deepEqual(w.cpq, before.workspace.cpq);
  assert.deepEqual(w.quoteHistory, before.workspace.quoteHistory);
  assert.deepEqual(w.versionWorkflows.V2, before.workspace.versionWorkflows.V2);
  assert.equal(nextCostVersionCode(w), 'V3');
});

test('an inactive suspended source can be removed while derived versions and review evidence retain provenance', (t) => {
  const repo = setup(t, { third: true });
  const before = repo.get(ID);
  const receipt = deleteCostVersion(repo, ID, 'V2', before.revision);
  assert.equal(receipt.deleted, true);
  assert.equal(receipt.workflowVersion, 'V3');
  assert.equal(receipt.workspace, undefined);
  const after = repo.get(ID).workspace;
  assert.deepEqual(
    after.costVersions,
    before.workspace.costVersions.filter((v) => v.code !== 'V2'),
  );
  assert.equal(after.costVersions[1].sourceVersion, 'V2');
  assert.deepEqual(after.ssr, before.workspace.ssr);
  assert.deepEqual(after.costRows, before.workspace.costRows);
  assert.equal(after.activeVersion, 'V3');
  const archived = readResource(repo, ID, 'cost', {
    section: 'archive',
    version: 'V2',
  });
  assert.deepEqual(archived.value.version, before.workspace.costVersions[1]);
  assert.throws(
    () =>
      updateResource(
        repo,
        ID,
        'cost',
        { version: 'V2', section: 'settings' },
        { set: { state: 'Draft' } },
        receipt.revision,
      ),
    /not found/,
  );
});

test('Draft, Confirmed, locked Suspended, and the last visible version cannot be removed', (t) => {
  const repo = setup(t, { state: 'Draft' });
  const before = repo.get(ID);
  assert.throws(
    () => deleteCostVersion(repo, ID, 'V2', before.revision),
    /Suspended/,
  );
  assert.throws(
    () => deleteCostVersion(repo, ID, 'V1', before.revision),
    /锁定/,
  );
  const locked = fixture();
  locked.costVersionLocks.V2 = {
    reason: '历史成本已锁定',
    lockedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.match(costVersionDeletionReason(locked, 'V2'), /锁定/);
  assert.throws(() => deleteSuspendedCostVersion(locked, 'V2'), /锁定/);
  const last = fixture();
  last.costVersions = [last.costVersions[1]];
  assert.throws(() => deleteSuspendedCostVersion(last, 'V2'), /至少/);
  assert.deepEqual(repo.get(ID), before);
});

test('workspace save cannot bypass deletion state, fabricate archives, mutate costs, or remove historical reviews', (t) => {
  const repo = setup(t, { third: true });
  const before = repo.get(ID);
  const valid = deleteSuspendedCostVersion(before.workspace, 'V2');
  const cases = [
    (w) => {
      delete w.deletedCostVersions;
    },
    (w) => {
      w.deletedCostVersions.V2.version.manualCosts.riskContingency++;
    },
    (w) => {
      w.costVersions[1].manualCosts.riskContingency++;
      w.manualCosts.riskContingency++;
    },
    (w) => {
      w.ssr.submissions = [];
    },
    (w) => {
      w.cpq.archives = [];
    },
    (w) => {
      w.quoteHistory = [];
    },
    (w) => {
      w.versionWorkflows.V2.processSteps[0].detail = 'Forged history';
    },
  ];
  for (const mutate of cases) {
    const forged = structuredClone(valid);
    mutate(forged);
    assert.throws(() => repo.save(ID, forged, before.revision));
    assert.deepEqual(repo.get(ID), before);
  }
  const unsuspended = fixture({ third: true, state: 'Draft' });
  const second = openWorkspaceRepository(':memory:');
  t.after(() => second.close());
  const start = second.save(ID, unsuspended, null);
  const forged = structuredClone(start.workspace);
  forged.costVersions.find((v) => v.code === 'V2').state = 'Suspended';
  assert.throws(
    () =>
      second.save(ID, deleteSuspendedCostVersion(forged, 'V2'), start.revision),
    /Suspended/,
  );
});

test('deletion is revision safe, immutable after saving, and highest deleted numbers are never reused', (t) => {
  const repo = setup(t);
  const first = repo.get(ID);
  assert.throws(
    () => deleteCostVersion(repo, ID, 'V2', first.revision - 1),
    /changed/,
  );
  assert.deepEqual(repo.get(ID), first);
  const receipt = deleteCostVersion(repo, ID, 'V2', first.revision);
  const deleted = repo.get(ID);
  assert.throws(
    () =>
      repo.save(
        ID,
        deleteSuspendedCostVersion(first.workspace, 'V2'),
        first.revision,
      ),
    /Expected revision/,
  );
  for (const mutate of [
    (w) => {
      delete w.deletedCostVersions;
    },
    (w) => {
      w.deletedCostVersions.V2.removedAt = '2026-01-01T00:00:00.000Z';
    },
    (w) => {
      w.costVersions.push({
        ...w.deletedCostVersions.V2.version,
        state: 'Draft',
      });
      delete w.deletedCostVersions;
    },
  ]) {
    const w = structuredClone(deleted.workspace);
    mutate(w);
    assert.throws(() => repo.save(ID, w, deleted.revision));
  }
  const created = createCostDraft(
    repo,
    ID,
    { mode: 'clone', sourceVersion: 'V1' },
    receipt.revision,
  );
  assert.equal(created.version, 'V3');
  assert.deepEqual(
    repo.get(ID).workspace.costVersions[0],
    first.workspace.costVersions[0],
  );
  assert.deepEqual(
    repo.get(ID).workspace.deletedCostVersions,
    deleted.workspace.deletedCostVersions,
  );
});

test('CLI cost delete returns only a receipt and preserves CAS failure without changing the database', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cost-delete-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'fixture.sqlite');
  const repo = openWorkspaceRepository(db);
  repo.save(ID, fixture(), null);
  repo.close();
  const run = (revision) =>
    spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        'cost',
        'delete',
        '--project-id',
        ID,
        '--version',
        'V2',
        '--expected-revision',
        String(revision),
        '--db',
        db,
      ],
      { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' },
    );
  const stale = run(99);
  assert.equal(stale.status, 5, stale.stdout + stale.stderr);
  const child = run(1);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.command, 'cost.delete');
  assert.equal(result.kind, 'MutationResult');
  assert.equal(result.data.deleted, true);
  assert.deepEqual(result.data.removedIds, ['V2']);
  assert.equal(result.data.revision, 2);
  assert.equal(result.data.workspace, undefined);
  assert.equal(result.data.workflowVersion, 'V1');
  const check = openWorkspaceRepository(db);
  t.after(() => check.close());
  assert.equal(
    check.get(ID).workspace.deletedCostVersions.V2.version.state,
    'Suspended',
  );
});

test('cost settings allow an explicit other-service amount to replace percentage mode and an explicit rate to restore it', (t) => {
  const repo = setup(t, { state: 'Draft' });
  const patch = (manualCosts) =>
    updateResource(
      repo,
      ID,
      'cost',
      { version: 'V2', section: 'settings' },
      { set: { manualCosts } },
      repo.get(ID).revision,
    );
  patch({ otherServiceRate: 0.01 });
  assert.equal(repo.get(ID).workspace.manualCosts.otherServiceRate, 0.01);
  patch({ otherService: 73 });
  assert.equal(repo.get(ID).workspace.manualCosts.otherService, 73);
  assert.equal(repo.get(ID).workspace.manualCosts.otherServiceRate, undefined);
  patch({ otherService: 90, otherServiceRate: 0.01 });
  assert.equal(repo.get(ID).workspace.manualCosts.otherServiceRate, 0.01);
  assert.equal(
    repo.get(ID).workspace.costVersions[1].manualCosts.otherServiceRate,
    0.01,
  );
});
