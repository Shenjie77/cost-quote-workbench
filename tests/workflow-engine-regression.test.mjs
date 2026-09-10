import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyWorkflowAction,
  normalizeWorkflowDefinition,
  restoreProjectHoldDeadlines,
  workflowDueAt,
  workflowLocalDate,
} from '../features/projects/workflow-engine.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';

const MONDAY_START = '2026-09-07T01:00:00.000Z';

/** Build an ordinary configured node without legacy code-based defaults. */
function node(code, overrides = {}) {
  return normalizeWorkflowDefinition({
    code,
    no: '01',
    name: code,
    nameZh: '',
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
    finishesWorkflow: false,
    requiresConfirmedCost: false,
    autoSkip: true,
    slaDays: 1,
    ...overrides,
  });
}

/** Provide a current-engine workspace so tests isolate node transitions from migration. */
function fixture(steps) {
  return {
    ...createBlankWorkspace(
      projectRecord('WORKFLOW-REGRESSION', 'Workflow regression', 'Client'),
      'solution_review',
    ),
    workflowEngineVersion: 1,
    workflowVersion: 'V1',
    processSteps: steps,
    currentWorkflowStepCode: steps[0].code,
    workflowUpdates: [],
    versionWorkflows: {},
  };
}

test('business SLA preserves exact opening/closing boundaries and Singapore date rollover', () => {
  const timed = node('timed');
  const cases = [
    ['2026-09-07T00:59:59.999Z', '2026-09-07T10:00:00.000Z'],
    [MONDAY_START, '2026-09-07T10:00:00.000Z'],
    ['2026-09-07T09:59:59.999Z', '2026-09-08T09:59:59.999Z'],
    ['2026-09-07T10:00:00.000Z', '2026-09-08T10:00:00.000Z'],
    ['2026-09-11T10:00:00.000Z', '2026-09-14T10:00:00.000Z'],
    ['2026-09-12T01:00:00.000Z', '2026-09-14T10:00:00.000Z'],
  ];
  for (const [start, due] of cases)
    assert.equal(workflowDueAt(timed, start), due);
  assert.equal(workflowLocalDate('2026-09-07T15:59:59.999Z'), '2026-09-07');
  assert.equal(workflowLocalDate('2026-09-07T16:00:00.000Z'), '2026-09-08');
  assert.equal(
    workflowDueAt({ ...timed, slaHolidays: ['2026-09-14'] }, cases[4][0]),
    '2026-09-15T10:00:00.000Z',
  );
});

test('a weekend-only pause retains a manual off-hours deadline and explicit resume follow-up', () => {
  const originalDue = '2026-09-13T04:00:00.000Z';
  const paused = fixture([
    node('paused', {
      state: 'paused',
      startedAt: MONDAY_START,
      pausedAt: '2026-09-11T10:00:00.000Z',
      dueAt: originalDue,
      followUpDate: '2026-09-14',
    }),
  ]);
  const resumed = applyWorkflowAction(
    paused,
    { nodeCode: 'paused', action: 'resume', followUpDate: '2026-09-16' },
    '2026-09-14T01:00:00.000Z',
  );
  assert.equal(resumed.processSteps[0].dueAt, originalDue);
  assert.equal(resumed.processSteps[0].followUpDate, '2026-09-16');
  assert.equal(resumed.processSteps[0].pausedAt, '');
  assert.equal(paused.processSteps[0].state, 'paused');
  assert.equal(
    applyWorkflowAction(
      paused,
      { nodeCode: 'paused', action: 'resume' },
      '2026-09-14T01:00:00.000Z',
    ).processSteps[0].followUpDate,
    '',
  );
});

test('parallel start preserves peer timestamps and audits peers before the explicitly started node', () => {
  const oldStart = '2026-09-06T01:00:00.000Z';
  const oldDue = '2026-09-10T01:00:00.000Z';
  const workspace = fixture([
    node('first', {
      parallelGroup: 'review',
      startedAt: oldStart,
      dueAt: oldDue,
    }),
    node('requested', { parallelGroup: 'review' }),
    node('third', { parallelGroup: 'review', slaDays: 2 }),
  ]);
  const before = structuredClone(workspace);
  const result = applyWorkflowAction(
    workspace,
    {
      nodeCode: 'requested',
      action: 'start',
      owner: '  TD  ',
      startedAt: MONDAY_START,
      dueAt: '2026-09-09T01:00:00.000Z',
      reason: ' approved deadline ',
    },
    MONDAY_START,
  );
  assert.deepEqual(
    result.workflowUpdates.map(({ nodeCode }) => nodeCode),
    ['first', 'third', 'requested'],
  );
  assert.ok(
    result.workflowUpdates.every((event) => event.fromStepCode === 'first'),
  );
  assert.equal(result.workflowUpdates.at(-1).note, 'approved deadline');
  assert.equal(result.processSteps[0].startedAt, oldStart);
  assert.equal(result.processSteps[0].dueAt, oldDue);
  assert.equal(result.processSteps[1].owner, 'TD');
  assert.equal(result.processSteps[1].dueAt, '2026-09-09T01:00:00.000Z');
  assert.equal(result.processSteps[2].dueAt, '2026-09-08T10:00:00.000Z');
  assert.deepEqual(
    result.versionWorkflows.V1.processSteps,
    result.processSteps,
  );
  assert.notEqual(result.versionWorkflows.V1.processSteps, result.processSteps);
  assert.deepEqual(workspace, before);
});

test('compound invalid actions preserve validation priority and never leak partial input edits', () => {
  const workspace = fixture([
    node('active', {
      state: 'in_progress',
      required: true,
      autoSkip: false,
      startedAt: MONDAY_START,
      dueAt: '2026-09-07T10:00:00.000Z',
      requiredFields: ['scope'],
      fieldValues: { scope: 'old scope' },
    }),
    node('later'),
  ]);
  const before = structuredClone(workspace);
  const cases = [
    [
      { nodeCode: 'missing', action: 'update', owner: 4 },
      'Node not found. Reload the workflow.',
    ],
    [
      { nodeCode: 'active', action: 'skip' },
      'Mandatory nodes cannot be skipped.',
    ],
    [
      { nodeCode: 'later', action: 'start', owner: ' ' },
      'A follow-up owner is required.',
    ],
    [
      { nodeCode: 'later', action: 'start', fields: { unknown: 'value' } },
      'Only fields configured for this node may be entered.',
    ],
    [
      {
        nodeCode: 'active',
        action: 'update',
        owner: 'TD',
        fields: { scope: 'new scope' },
        startedAt: 'invalid',
      },
      'A reason is required to correct the actual start time.',
    ],
    [
      {
        nodeCode: 'active',
        action: 'update',
        owner: 'TD',
        fields: { scope: 'new scope' },
        startedAt: MONDAY_START,
        dueAt: '2026-09-06T01:00:00.000Z',
        reason: 'correct',
      },
      'The due time cannot be earlier than the start time.',
    ],
    [
      { nodeCode: 'active', action: 'update', followUpDate: '2026-02-30' },
      'The follow-up date must use YYYY-MM-DD.',
    ],
  ];
  for (const [request, message] of cases) {
    assert.throws(() => applyWorkflowAction(workspace, request, MONDAY_START), {
      name: 'TypeError',
      message,
    });
    assert.deepEqual(workspace, before);
  }
});

test('completion snapshots submitted fields and orders automatic skips before the completion event', () => {
  const workspace = fixture([
    node('auto-a'),
    node('auto-b'),
    node('manual', { autoSkip: false }),
    node('review', {
      state: 'in_progress',
      required: true,
      autoSkip: false,
      startedAt: MONDAY_START,
      requiredFields: ['result'],
    }),
  ]);
  const request = {
    nodeCode: 'review',
    action: 'complete',
    confirmed: true,
    fields: { result: 'Approved' },
  };
  const result = applyWorkflowAction(workspace, request, MONDAY_START);
  assert.deepEqual(
    result.workflowUpdates.map(({ nodeCode, action }) => [nodeCode, action]),
    [
      ['auto-a', 'auto_skip'],
      ['auto-b', 'auto_skip'],
      ['review', 'complete'],
    ],
  );
  assert.equal(result.processSteps[2].state, 'not_started');
  assert.equal(result.processSteps[0].skippedBy, 'review');
  request.fields.result = 'Changed after submission';
  result.processSteps[3].fieldValues.result = 'Changed in editor';
  assert.equal(result.workflowUpdates.at(-1).fields.result, 'Approved');
  assert.equal(
    result.versionWorkflows.V1.processSteps[3].fieldValues.result,
    'Approved',
  );
});

test('reopening clears old completion fields while retaining the established SLA and accepting new evidence', () => {
  const due = '2026-09-08T10:00:00.000Z';
  const workspace = fixture([
    node('review', {
      state: 'completed',
      startedAt: MONDAY_START,
      dueAt: due,
      completedAt: MONDAY_START,
      skippedBy: 'old marker',
      requiredFields: ['old', 'new'],
      fieldValues: { old: 'prior evidence' },
    }),
    node('later'),
  ]);
  const result = applyWorkflowAction(
    workspace,
    {
      nodeCode: 'review',
      action: 'reopen',
      reason: 'Clarify scope',
      fields: { new: 'new evidence' },
    },
    '2026-09-09T01:00:00.000Z',
  );
  assert.equal(result.processSteps[0].state, 'in_progress');
  assert.equal(result.processSteps[0].startedAt, MONDAY_START);
  assert.equal(result.processSteps[0].dueAt, due);
  assert.equal(result.processSteps[0].completedAt, '');
  assert.equal(result.processSteps[0].skippedBy, '');
  assert.deepEqual(result.processSteps[0].fieldValues, { new: 'new evidence' });
  assert.equal(result.workflowUpdates.at(-1).action, 'reopen');
});

test('restoring holds shifts local follow-up dates once while preserving separately paused deadlines', () => {
  const due = '2026-09-12T01:00:00.000Z';
  const workspace = {
    processSteps: [
      node('active', {
        state: 'in_progress',
        slaCalendar: 'calendar',
        startedAt: MONDAY_START,
        updatedAt: MONDAY_START,
        dueAt: due,
        followUpDate: '2026-09-09',
      }),
      node('paused', {
        state: 'paused',
        startedAt: MONDAY_START,
        dueAt: due,
        pausedAt: MONDAY_START,
        followUpDate: '2026-09-09',
      }),
    ],
    workflowUpdates: [
      { action: 'resume_project', updatedAt: MONDAY_START },
      { action: 'hold_project', updatedAt: 'not a timestamp' },
      { action: 'hold_project', updatedAt: '2026-09-07T15:30:00.000Z' },
      { action: 'resume_project', updatedAt: '2026-09-07T16:30:00.000Z' },
    ],
  };
  const before = structuredClone(workspace);
  const steps = restoreProjectHoldDeadlines(workspace);
  assert.equal(steps[0].dueAt, '2026-09-12T02:00:00.000Z');
  assert.equal(steps[1].dueAt, due);
  assert.ok(steps.every((step) => step.followUpDate === '2026-09-10'));
  assert.deepEqual(
    restoreProjectHoldDeadlines({ ...workspace, processSteps: steps }),
    steps,
  );
  assert.deepEqual(workspace, before);
});
