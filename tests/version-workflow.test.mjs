import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  emptySsr,
  recordSubmission,
  recordReviewResult,
  closeCondition,
} from '../features/ssr/domain.ts';
import {
  migrateVersionWorkflows,
  reconcileVersionWorkflows,
  assertVersionWorkflowTransition,
  isDtrbStep,
  isDrbStep,
} from '../features/cost/version-workflow.ts';

const clone = (v) => structuredClone(v);
const snapshot = (w) => ({
  currentWorkflowStepCode: w.currentWorkflowStepCode,
  processSteps: clone(w.processSteps),
  projectStatus: w.projectStatus,
});
const fixture = (state = 'Draft') => {
  const w = createBlankWorkspace(
    projectRecord('WF-TEST', 'Workflow fixture', 'Client'),
    'costing',
  );
  delete w.workflowVersion;
  delete w.versionWorkflows;
  delete w.legacyWorkflowArchive;
  w.costVersions[0].state = state;
  const dtrb = w.processSteps.find(isDtrbStep),
    drb = w.processSteps.find(isDrbStep);
  dtrb.state = 'completed';
  drb.state = 'completed';
  drb.input = 'Original reviewed evidence';
  w.currentWorkflowStepCode = drb.code;
  w.projectStatus = 'delivery_review';
  w.selectedStep = w.processSteps.indexOf(drb);
  w.reviewGates = [
    {
      id: 'OLD-DRB',
      gate: 'DRB',
      workflowStepCode: drb.code,
      status: 'completed',
    },
  ];
  return w;
};
const addDraft = (w, code) => {
  w.costVersions.push(
    createCostVersion(code, 'Draft', w.costVersions[0].code, w.costVersions[0]),
  );
};
const assertDtrb = (w) => {
  assert.ok(
    isDtrbStep(
      w.processSteps.find((s) => s.code === w.currentWorkflowStepCode),
    ),
  );
  const start = w.processSteps.findIndex(isDtrbStep);
  assert.ok(
    w.processSteps.slice(start).every((s) => s.state === 'not_started'),
  );
};
const approve = (s) =>
  recordReviewResult(s, s.submissions.at(-1).id, {
    outcome: 'approved',
    evidence: 'Company approved fixture',
    conditions: [],
  });
const submit = (s, b, kind) =>
  recordSubmission(s, b, {
    kind,
    domain: '',
    owner: 'PM',
    dueDate: '2026-09-10',
    applicationNumber: kind + '-' + b.code,
    evidence: 'Company submitted fixture',
  });

test('exact workflow aliases distinguish DTRB, DRB and ordinary descriptive labels', () => {
  for (const code of ['TD_EFFORT_REVIEW', 'DTRB'])
    assert.equal(isDtrbStep({ code }), true);
  for (const code of ['DELIVERY_REVIEW', 'COST_BASELINE_APPROVAL', 'DRB'])
    assert.equal(isDrbStep({ code }), true);
  assert.equal(isDrbStep({ code: 'DTRB', name: 'DTRB review' }), false);
  assert.equal(
    isDtrbStep({ code: 'CUSTOM', name: 'TD costing preparation' }),
    false,
  );
  assert.equal(
    isDrbStep({ code: 'CUSTOM', name: 'Delivery cost preparation' }),
    false,
  );
});

test('legacy highest Draft resets to DTRB without losing original workflow or review facts', () => {
  const w = fixture(),
    original = clone(w),
    old = snapshot(w);
  const migrated = migrateVersionWorkflows(w);
  assertDtrb(migrated);
  assert.equal(migrated.workflowVersion, 'V1');
  assert.deepEqual(migrated.legacyWorkflowArchive.V1, old);
  assert.deepEqual(migrated.versionWorkflows.V1, snapshot(migrated));
  assert.equal(migrated.reviewGates[0].costVersion, 'V1');
  assert.equal(migrated.reviewGates[0].status, 'completed');
  assert.deepEqual(migrated.costVersions, original.costVersions);
  assert.deepEqual(w, original);
  assert.deepEqual(migrateVersionWorkflows(migrated), migrated);
});

test('migration preserves old Confirmed cycle while highest Draft owns current DTRB round', () => {
  const w = fixture('Confirmed'),
    old = snapshot(w);
  addDraft(w, 'V2');
  const migrated = migrateVersionWorkflows(w);
  assert.equal(migrated.activeVersion, 'V1');
  assert.equal(migrated.workflowVersion, 'V2');
  assertDtrb(migrated);
  assert.deepEqual(migrated.versionWorkflows.V1, old);
  assert.equal(migrated.reviewGates[0].costVersion, 'V1');
  assert.deepEqual(migrated.legacyWorkflowArchive, {});
});

test('missing DTRB gets a canonical node instead of choosing a vaguely named step', () => {
  const w = fixture();
  w.processSteps = w.processSteps.filter((s) => !isDtrbStep(s));
  w.processSteps[0].name = 'TD estimate preparation';
  const migrated = migrateVersionWorkflows(w);
  assert.equal(migrated.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
  assertDtrb(migrated);
  assert.ok(
    migrated.processSteps.some((s) => s.name === 'TD estimate preparation'),
  );
});

test('new highest Draft owns a fresh cycle but browsing old costs never switches workflow rounds', () => {
  const previous = migrateVersionWorkflows(fixture('Confirmed'));
  const next = clone(previous);
  addDraft(next, 'V2');
  next.activeVersion = 'V2';
  const created = reconcileVersionWorkflows(previous, next);
  assert.equal(created.workflowVersion, 'V2');
  assertDtrb(created);
  assert.deepEqual(created.versionWorkflows.V1, previous.versionWorkflows.V1);
  const browsed = clone(created);
  browsed.activeVersion = 'V1';
  browsed.workflowVersion = 'V1';
  browsed.versionWorkflows = {};
  browsed.legacyWorkflowArchive = {};
  const kept = reconcileVersionWorkflows(created, browsed);
  assert.equal(kept.activeVersion, 'V1');
  assert.equal(kept.workflowVersion, 'V2');
  assert.deepEqual(kept.versionWorkflows, created.versionWorkflows);
  assert.deepEqual(kept.reviewGates, created.reviewGates);
  assertDtrb(kept);
});

test('server retains immutable historical maps and gate bindings while saving current-round edits', () => {
  const previous = migrateVersionWorkflows(fixture());
  const changed = clone(previous);
  changed.legacyWorkflowArchive.V1.currentWorkflowStepCode = 'FORGED';
  changed.processSteps.find(isDtrbStep).state = 'in_progress';
  changed.reviewGates[0].costVersion = 'V99';
  changed.reviewGates.push({
    id: 'NEW-REVIEW',
    gate: 'Other',
    workflowStepCode: 'CUSTOM',
    status: 'not_started',
  });
  const after = reconcileVersionWorkflows(previous, changed);
  assert.deepEqual(after.legacyWorkflowArchive, previous.legacyWorkflowArchive);
  assert.equal(
    after.versionWorkflows.V1.processSteps.find(isDtrbStep).state,
    'in_progress',
  );
  assert.equal(after.reviewGates[0].costVersion, 'V1');
  assert.equal(after.reviewGates[1].costVersion, 'V1');
});

for (const action of [
  'in_progress',
  'awaiting_review',
  'completed',
  'pointer',
  'gate',
]) {
  test(`Draft rejects new DRB ${action} until the workflow version is Confirmed`, () => {
    const previous = migrateVersionWorkflows(fixture());
    const next = clone(previous),
      drb = next.processSteps.find(isDrbStep);
    if (action === 'pointer') next.currentWorkflowStepCode = drb.code;
    else if (action === 'gate')
      next.reviewGates.push({
        id: 'NEW-DRB',
        gate: 'DRB',
        workflowStepCode: drb.code,
        status: 'in_review',
      });
    else drb.state = action;
    assert.throws(
      () => assertVersionWorkflowTransition(previous, next),
      /请先确认成本 V1 \(Confirmed\)/,
    );
    next.costVersions[0].state = 'Confirmed';
    assert.doesNotThrow(() => assertVersionWorkflowTransition(previous, next));
  });
}

test('Draft cannot jump beyond DTRB, but ordinary editing and historical actions remain separate', () => {
  const w = fixture('Confirmed');
  addDraft(w, 'V2');
  const previous = migrateVersionWorkflows(w);
  const next = clone(previous);
  next.activeVersion = 'V1';
  next.currentWorkflowStepCode = next.processSteps.at(-1).code;
  assert.throws(() => assertVersionWorkflowTransition(previous, next), /V2/);
  const viewing = clone(previous);
  viewing.activeVersion = 'V1';
  viewing.costRows = [];
  assert.doesNotThrow(() => assertVersionWorkflowTransition(previous, viewing));
  const history = clone(previous);
  history.reviewGates[0].status = 'in_review';
  assert.doesNotThrow(() => assertVersionWorkflowTransition(previous, history));
  assert.doesNotThrow(() => assertVersionWorkflowTransition(null, fixture()));
});

test('new current DTRB evidence updates only the active workflow cycle and stays at DTRB after approval', () => {
  const previous = migrateVersionWorkflows(fixture());
  previous.ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'P',
    scopeBrief: 'Scope',
  };
  let next = clone(previous);
  next.ssr = submit(next.ssr, next.costVersions[0], 'DTRB');
  let after = reconcileVersionWorkflows(previous, next);
  assert.equal(after.processSteps.find(isDtrbStep).state, 'awaiting_review');
  const awaiting = after;
  next = clone(after);
  next.ssr = approve(next.ssr);
  after = reconcileVersionWorkflows(awaiting, next);
  assert.equal(after.processSteps.find(isDtrbStep).state, 'completed');
  assert.ok(
    isDtrbStep(
      after.processSteps.find((s) => s.code === after.currentWorkflowStepCode),
    ),
  );
  assert.equal(after.costVersions[0].state, 'Draft');
});

test('DRB submission and condition closure update the confirmed historical cycle without advancing the new Draft', () => {
  const w = fixture('Confirmed');
  w.ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'P',
    scopeBrief: 'Scope',
  };
  w.ssr = approve(submit(w.ssr, w.costVersions[0], 'DTRB'));
  addDraft(w, 'V2');
  const previous = migrateVersionWorkflows(w),
    next = clone(previous);
  next.ssr = submit(next.ssr, next.costVersions[0], 'DRB');
  const awaiting = reconcileVersionWorkflows(previous, next);
  assert.equal(
    awaiting.versionWorkflows.V1.processSteps.find(isDrbStep).state,
    'awaiting_review',
  );
  assert.equal(awaiting.workflowVersion, 'V2');
  assertDtrb(awaiting);
  const conditional = clone(awaiting),
    id = conditional.ssr.submissions.at(-1).id;
  conditional.ssr = recordReviewResult(conditional.ssr, id, {
    outcome: 'conditional',
    evidence: 'Company conditions',
    conditions: ['Signed Scope'],
  });
  const open = reconcileVersionWorkflows(awaiting, conditional);
  assert.equal(
    open.versionWorkflows.V1.processSteps.find(isDrbStep).state,
    'awaiting_review',
  );
  const closed = clone(open);
  closed.ssr = closeCondition(
    closed.ssr,
    id,
    'Signed Scope',
    'Actual closure evidence',
  );
  const completed = reconcileVersionWorkflows(open, closed);
  assert.equal(
    completed.versionWorkflows.V1.processSteps.find(isDrbStep).state,
    'completed',
  );
  assert.equal(completed.workflowVersion, 'V2');
  assertDtrb(completed);
  assert.equal(completed.ssr.submissions.length, 2);
});

test('ordinary review-gate deletion stays effective while a new round cannot discard old gates', () => {
  const previous = migrateVersionWorkflows(fixture('Confirmed'));
  const deleted = clone(previous);
  deleted.reviewGates = [];
  assert.deepEqual(
    reconcileVersionWorkflows(previous, deleted).reviewGates,
    [],
  );
  const newRound = clone(previous);
  addDraft(newRound, 'V2');
  newRound.reviewGates = [];
  const opened = reconcileVersionWorkflows(previous, newRound);
  assert.deepEqual(opened.reviewGates, previous.reviewGates);
});

test('historical review gates cannot be rebound to a new version or its step code by newer-round edits', () => {
  const w = fixture('Confirmed');
  addDraft(w, 'V2');
  const previous = migrateVersionWorkflows(w);
  const next = clone(previous);
  next.reviewGates[0].costVersion = 'V2';
  next.reviewGates[0].workflowStepCode = 'NEW_VERSION_DRB';
  const after = reconcileVersionWorkflows(previous, next);
  assert.equal(after.reviewGates[0].costVersion, 'V1');
  assert.equal(
    after.reviewGates[0].workflowStepCode,
    previous.reviewGates[0].workflowStepCode,
  );
});

test('reconciling an already projected new Draft twice preserves the outgoing completed workflow', () => {
  const previous = migrateVersionWorkflows(fixture('Confirmed'));
  const next = clone(previous);
  addDraft(next, 'V2');
  next.activeVersion = 'V2';
  const once = reconcileVersionWorkflows(previous, next);
  assertDtrb(once);
  const twice = reconcileVersionWorkflows(previous, once);
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.versionWorkflows.V1, previous.versionWorkflows.V1);
  assert.equal(
    twice.versionWorkflows.V1.processSteps.find(isDrbStep).state,
    'completed',
  );
});

for (const kind of ['DTRB', 'DRB']) {
  test(`${kind} approval for stale materials blocks the version workflow without changing actual review evidence`, () => {
    const w = migrateVersionWorkflows(fixture('Confirmed'));
    w.ssr = {
      ...emptySsr(),
      enabled: true,
      proposalNumber: 'P',
      scopeBrief: 'Original Scope',
    };
    if (kind === 'DRB')
      w.ssr = approve(submit(w.ssr, w.costVersions[0], 'DTRB'));
    const submitted = clone(w);
    submitted.ssr = submit(w.ssr, w.costVersions[0], kind);
    const previous = reconcileVersionWorkflows(w, submitted);
    const before = clone(previous);
    const next = clone(previous);
    next.ssr.scopeBrief = 'Revised Scope';
    next.ssr = approve(next.ssr);
    const after = reconcileVersionWorkflows(previous, next);
    const match = kind === 'DTRB' ? isDtrbStep : isDrbStep;
    const step = after.processSteps.find(match);
    assert.equal(step.state, 'blocked');
    assert.equal(step.tone, 'red');
    assert.match(step.detailZh, /送审资料已变化.*本成本版本重新提交评审/);
    assert.equal(after.currentWorkflowStepCode, step.code);
    assert.deepEqual(after.ssr, next.ssr);
    assert.deepEqual(after.costVersions, next.costVersions);
    assert.deepEqual(previous, before);
    assert.equal(
      after.ssr.submissions.at(-1).results.at(-1).outcome,
      'approved',
    );

    // A real new submission for current materials clears only the generated
    // stale notice; prior actual evidence is retained in the SSR history.
    const retry = clone(after);
    if (kind === 'DRB')
      retry.ssr = approve(submit(retry.ssr, retry.costVersions[0], 'DTRB'));
    retry.ssr = submit(retry.ssr, retry.costVersions[0], kind);
    const current = reconcileVersionWorkflows(after, retry);
    assert.equal(current.processSteps.find(match).state, 'awaiting_review');
    assert.doesNotMatch(
      current.processSteps.find(match).detailZh,
      /送审资料已变化/,
    );
    assert.deepEqual(
      current.ssr.submissions.slice(0, after.ssr.submissions.length),
      after.ssr.submissions,
    );
  });
}
