import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  applyWorkflowAction,
  migrateWorkflowEngine,
  normalizeWorkflowDefinition,
  validateWorkflowTemplate,
  workflowPhaseGroups,
  workflowUrgency,
  workflowDueAt,
  previewWorkflowSync,
  applyWorkflowTemplate,
  workflowComplete,
  resetWorkflowRoundSteps,
} from '../features/projects/workflow-engine.ts';
const now = '2026-09-07T01:00:00.000Z'; // Monday 09:00 Singapore
const node = (code, overrides = {}) =>
  normalizeWorkflowDefinition({
    code,
    no: '01',
    name: code,
    nameZh: code,
    owner: 'SSR',
    state: 'not_started',
    tone: 'gray',
    date: '',
    dateZh: '',
    detail: '',
    detailZh: '',
    input: '',
    inputZh: '',
    required: false,
    roundStart: false,
    requiresConfirmedCost: false,
    finishesWorkflow: false,
    autoSkip: true,
    ...overrides,
  });
const defs = () => [
  node('scope', {
    required: true,
    autoSkip: false,
    roundStart: true,
    requiredFields: ['实际范围'],
  }),
  node('optional'),
  node('review-a', {
    parallelGroup: '并行评审',
    required: true,
    autoSkip: false,
    requiresConfirmedCost: true,
  }),
  node('review-b', {
    parallelGroup: '并行评审',
    required: true,
    autoSkip: false,
    requiresConfirmedCost: true,
    slaDays: 1,
  }),
  node('finish', {
    required: true,
    autoSkip: false,
    finishesWorkflow: true,
    requiresConfirmedCost: true,
  }),
];
function fixture() {
  const w = createBlankWorkspace(
    projectRecord('ENGINE-TEST', 'Engine test', 'Client'),
    'input_preparation',
  );
  w.processSteps = defs();
  w.currentWorkflowStepCode = 'scope';
  w.workflowVersion = 'V1';
  w.versionWorkflows = {};
  w.legacyWorkflowArchive = {};
  return migrateWorkflowEngine(w, now);
}
const completeScope = (w) =>
  applyWorkflowAction(
    w,
    {
      nodeCode: 'scope',
      action: 'complete',
      confirmed: true,
      fields: { 实际范围: '用户确认的 Scope' },
    },
    now,
  );
const confirmed = (w) => ({
  ...w,
  costVersions: w.costVersions.map((v) => ({ ...v, state: 'Confirmed' })),
});

test('stable node IDs carry no hidden name semantics; user ordering and parallel phases are authoritative', () => {
  const steps = defs();
  validateWorkflowTemplate(steps);
  assert.equal(workflowPhaseGroups(steps)[2].steps.length, 2);
  steps[1].name = 'DRB renamed ordinary task';
  assert.equal(
    normalizeWorkflowDefinition(steps[1]).requiresConfirmedCost,
    false,
  );
  const reordered = [steps[1], steps[0], ...steps.slice(2)];
  assert.equal(workflowPhaseGroups(reordered)[0].steps[0].code, 'optional');
  assert.throws(
    () =>
      validateWorkflowTemplate([
        steps[0],
        steps[2],
        steps[1],
        steps[3],
        steps[4],
      ]),
    /consecutive/,
  );
  assert.throws(
    () =>
      validateWorkflowTemplate(
        steps.map((s) =>
          s.roundStart ? { ...s, requiresConfirmedCost: true } : s,
        ),
      ),
    /start node/,
  );
});

test('critical information, confirmed cost and all critical parallel tasks guard downstream transitions', () => {
  let w = fixture();
  const unchanged = structuredClone(w);
  assert.throws(
    () =>
      applyWorkflowAction(w, { nodeCode: 'review-a', action: 'start' }, now),
    /mandatory node/,
  );
  assert.throws(
    () =>
      applyWorkflowAction(w, { nodeCode: 'scope', action: 'complete' }, now),
    /Explicitly confirm/,
  );
  assert.throws(
    () =>
      applyWorkflowAction(
        w,
        { nodeCode: 'scope', action: 'complete', confirmed: true },
        now,
      ),
    /required fields/,
  );
  assert.deepEqual(w, unchanged);
  w = completeScope(w);
  assert.throws(
    () =>
      applyWorkflowAction(w, { nodeCode: 'review-a', action: 'start' }, now),
    /Confirmed/,
  );
  w = applyWorkflowAction(
    confirmed(w),
    { nodeCode: 'review-a', action: 'start' },
    now,
  );
  assert.equal(w.processSteps[2].state, 'in_progress');
  assert.equal(w.processSteps[3].state, 'in_progress');
  assert.notEqual(w.processSteps[2].dueAt, w.processSteps[3].dueAt);
  w = applyWorkflowAction(
    w,
    { nodeCode: 'review-a', action: 'complete', confirmed: true },
    now,
  );
  assert.throws(
    () => applyWorkflowAction(w, { nodeCode: 'finish', action: 'start' }, now),
    /review-b/,
  );
  w = applyWorkflowAction(
    w,
    { nodeCode: 'review-b', action: 'complete', confirmed: true },
    now,
  );
  assert.equal(
    w.processSteps.find((s) => s.code === 'optional').state,
    'skipped',
  );
  assert.equal(
    w.workflowUpdates.find((e) => e.action === 'auto_skip').nodeCode,
    'optional',
  );
  w = applyWorkflowAction(w, { nodeCode: 'finish', action: 'start' }, now);
  w = applyWorkflowAction(
    w,
    { nodeCode: 'finish', action: 'complete', confirmed: true },
    now,
  );
  assert.equal(workflowComplete(w), true);
  assert.equal(
    w.workflowUpdates.find(
      (e) => e.nodeCode === 'scope' && e.action === 'complete',
    ).fields['实际范围'],
    '用户确认的 Scope',
  );
  assert.throws(
    () =>
      applyWorkflowAction(
        w,
        { nodeCode: 'scope', action: 'reopen', reason: 'new request' },
        now,
      ),
    /new cost version/,
  );
});

test('SLA uses business hours, holidays and exact due instants; note edits do not reset the clock', () => {
  const step = node('timed', { slaDays: 1 });
  const friday = '2026-09-11T09:00:00.000Z'; // Friday 17:00
  assert.equal(workflowDueAt(step, friday), '2026-09-14T09:00:00.000Z');
  assert.equal(
    workflowDueAt({ ...step, slaHolidays: ['2026-09-14'] }, friday),
    '2026-09-15T09:00:00.000Z',
  );
  assert.equal(
    workflowDueAt({ ...step, slaCalendar: 'calendar' }, friday),
    '2026-09-12T09:00:00.000Z',
  );
  let w = fixture();
  const due = w.processSteps[0].dueAt;
  w = applyWorkflowAction(
    w,
    { nodeCode: 'scope', action: 'update', owner: 'TD', note: 'updated' },
    '2026-09-08T01:00:00.000Z',
  );
  assert.equal(w.processSteps[0].dueAt, due);
  assert.equal(w.processSteps[0].startedAt, now);
  assert.equal(workflowUrgency(w.processSteps[0], due), 'immediate');
  assert.equal(
    workflowUrgency(
      w.processSteps[0],
      new Date(Date.parse(due) + 1).toISOString(),
    ),
    'urgent',
  );
  assert.equal(workflowUrgency(w.processSteps[0], now), 'normal');
});

test('pause requires recovery follow-up, freezes reminders until then, and resume extends the captured deadline', () => {
  let w = fixture();
  const due = w.processSteps[0].dueAt;
  assert.throws(
    () =>
      applyWorkflowAction(
        w,
        { nodeCode: 'scope', action: 'pause', reason: 'customer pause' },
        now,
      ),
    /resume/,
  );
  w = applyWorkflowAction(
    w,
    {
      nodeCode: 'scope',
      action: 'pause',
      reason: 'customer pause',
      followUpDate: '2026-09-08',
    },
    now,
  );
  assert.equal(workflowUrgency(w.processSteps[0], now), 'none');
  assert.equal(
    workflowUrgency(w.processSteps[0], '2026-09-08T01:00:00Z'),
    'immediate',
  );
  w = applyWorkflowAction(
    w,
    { nodeCode: 'scope', action: 'resume' },
    '2026-09-08T01:00:00Z',
  );
  assert.equal(
    Date.parse(w.processSteps[0].dueAt) - Date.parse(due),
    24 * 3600 * 1000,
  );
  assert.equal(w.processSteps[0].state, 'in_progress');
});

test('template publication changes future work, retains active SLA unless explicitly migrated and never changes cost snapshots', () => {
  const w = fixture();
  const cost = structuredClone(w.costVersions);
  const next = defs();
  next[0].name = '新版节点名';
  next[0].slaDays = 1;
  next[1].slaDays = 9;
  const safe = applyWorkflowTemplate(w, next, 12, {}, now);
  assert.equal(safe.processSteps[0].name, '新版节点名');
  assert.equal(safe.processSteps[0].dueAt, w.processSteps[0].dueAt);
  assert.equal(safe.processSteps[0].slaDays, 3);
  assert.equal(safe.processSteps[1].slaDays, 9);
  const explicit = applyWorkflowTemplate(
    w,
    next,
    12,
    { migrateActive: true },
    now,
  );
  assert.notEqual(explicit.processSteps[0].dueAt, w.processSteps[0].dueAt);
  assert.deepEqual(safe.costVersions, cost);
  assert.deepEqual(explicit.costVersions, cost);
  const insertion = [
    node('required-before', { required: true, autoSkip: false }),
    ...next,
  ];
  assert.match(
    previewWorkflowSync(w, insertion).blockers.join(' '),
    /before recorded progress/,
  );
  const removed = [node('new-start', { roundStart: true }), ...next.slice(1)];
  assert.match(
    previewWorkflowSync(w, removed).blockers.join(' '),
    /Cannot delete/,
  );
});

test('migration preserves actual cost/history and distinguishes inherited progress from completed evidence', () => {
  const w = createBlankWorkspace(
    projectRecord('LEGACY-FLOW', 'Legacy', 'Client'),
    'delivery_review',
  );
  w.processSteps = defs();
  w.currentWorkflowStepCode = 'review-a';
  w.workflowVersion = 'V1';
  w.versionWorkflows = {};
  const costs = structuredClone(w.costVersions);
  const migrated = migrateWorkflowEngine(w, now);
  assert.deepEqual(migrated.costVersions, costs);
  assert.equal(migrated.processSteps[0].state, 'skipped');
  assert.equal(migrated.processSteps[0].skippedBy, 'legacy-registration');
  assert.equal(migrated.processSteps[2].state, 'in_progress');
  assert.equal(migrated.workflowUpdates?.length || 0, 0);
  const reset = resetWorkflowRoundSteps(migrated.processSteps, now);
  assert.equal(reset[0].state, 'in_progress');
  assert.equal(reset[2].state, 'not_started');
  assert.deepEqual(reset[0].fieldValues, {});
});

test('publication detects moving existing pending critical work behind recorded progress and incompatible retained parallel groups', () => {
  let w = completeScope(fixture());
  w = applyWorkflowAction(
    confirmed(w),
    { nodeCode: 'review-a', action: 'start' },
    now,
  );
  // The two active peers cannot become split phases while one critical peer is unfinished.
  const next = defs();
  next[2].parallelGroup = '';
  next[3].parallelGroup = '';
  const split = previewWorkflowSync(w, next, { migrateActive: true });
  // Both already active is legitimate; once one pending task is moved before recorded activity, it blocks.
  assert.equal(split.blockers.length, 0);
  w.processSteps[3].state = 'not_started';
  const reordered = [next[0], next[3], next[1], next[2], next[4]];
  assert.match(
    previewWorkflowSync(w, reordered, { migrateActive: true }).blockers.join(
      ' ',
    ),
    /before recorded progress/,
  );
  // A retained active group plus a newly inserted standalone task cannot produce disjoint groups.
  w = applyWorkflowAction(
    confirmed(completeScope(fixture())),
    { nodeCode: 'review-a', action: 'start' },
    now,
  );
  const inserted = defs();
  inserted.splice(3, 0, node('interrupt'));
  inserted[2].parallelGroup = '';
  inserted[4].parallelGroup = '';
  assert.match(
    previewWorkflowSync(w, inserted).blockers.join(' '),
    /merged workflow is not executable/,
  );
});

test('finish requires explicitly resolving optional tasks with automatic skipping disabled', () => {
  let w = fixture();
  w.processSteps[1].autoSkip = false;
  w = applyWorkflowAction(
    confirmed(completeScope(w)),
    { nodeCode: 'review-a', action: 'start' },
    now,
  );
  w = applyWorkflowAction(
    w,
    { nodeCode: 'review-a', action: 'complete', confirmed: true },
    now,
  );
  w = applyWorkflowAction(
    w,
    { nodeCode: 'review-b', action: 'complete', confirmed: true },
    now,
  );
  w = applyWorkflowAction(w, { nodeCode: 'finish', action: 'start' }, now);
  assert.throws(
    () =>
      applyWorkflowAction(
        w,
        { nodeCode: 'finish', action: 'complete', confirmed: true },
        now,
      ),
    /explicitly skip/,
  );
  w = applyWorkflowAction(
    w,
    { nodeCode: 'optional', action: 'skip', reason: '本轮不适用' },
    now,
  );
  assert.equal(
    workflowComplete(
      applyWorkflowAction(
        w,
        { nodeCode: 'finish', action: 'complete', confirmed: true },
        now,
      ),
    ),
    true,
  );
});

test('a new Draft round cannot auto-start a cost-gated peer in its parallel start phase', () => {
  const next = defs();
  next[0].parallelGroup = 'first';
  next[1].parallelGroup = 'first';
  next[1].requiresConfirmedCost = true;
  assert.throws(() => validateWorkflowTemplate(next), /parallel peers/);
});
