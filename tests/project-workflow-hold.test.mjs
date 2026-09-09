import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  applyWorkflowAction,
  applyWorkflowTemplate,
  normalizeWorkflowDefinition,
  previewWorkflowSync,
  resetWorkflowRoundSteps,
  restoreProjectHoldDeadlines,
  workflowActionBlockers,
} from '../features/projects/workflow-engine.ts';
import { preflightWorkflowAction } from '../features/projects/workflow-action-preflight.ts';
import { reconcileVersionWorkflows } from '../features/cost/version-workflow.ts';
import {
  deleteSuspendedCostVersion,
  assertCostVersionDeletionTransition,
} from '../features/cost/version-deletion.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { buildDailyDigest } from '../features/agent/digest-domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  createCostDraft,
  readResource,
} from '../server/workspace-resources.mjs';
import { openReminderService } from '../server/reminder-service.mjs';

const friday = '2026-09-11T01:00:00.000Z'; // Friday 09:00 SGT
const heldAt = '2026-09-11T05:00:00.000Z';
const resumedAt = '2026-09-15T05:00:00.000Z';
const node = (code, index, patch = {}) =>
  normalizeWorkflowDefinition({
    code,
    no: String(index + 1).padStart(2, '0'),
    name: code,
    nameZh: '',
    owner: 'PM',
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
    slaDays: 2,
    slaCalendar: 'calendar',
    parallelGroup: 'REVIEWS',
    ...patch,
  });
const definitions = () => [
  node('Calendar', 0, { roundStart: true }),
  node('Business', 1, { slaCalendar: 'business', slaHolidays: ['2026-09-14'] }),
  node('Already Paused', 2),
  node('Finish', 3, {
    parallelGroup: '',
    required: true,
    autoSkip: false,
    finishesWorkflow: true,
  }),
];
const fixture = () =>
  applyWorkflowAction(
    {
      ...createBlankWorkspace(
        projectRecord('HOLD', 'Hold test', 'Customer'),
        'solution_review',
      ),
      workflowEngineVersion: 1,
      workflowMode: 'project',
      workflowVersion: 'V1',
      versionWorkflows: {},
      processSteps: definitions(),
      currentWorkflowStepCode: 'Calendar',
    },
    { nodeCode: 'Calendar', action: 'start' },
    friday,
  );
const get = (w, code) => w.processSteps.find((step) => step.code === code);
const digestProject = (w) => ({
  projectId: w.project.id,
  name: w.project.name,
  client: w.project.client,
  workflowEngineVersion: w.workflowEngineVersion,
  workflowMode: w.workflowMode,
  workflowVersion: w.workflowVersion,
  workflowSteps: w.processSteps,
  workflowHold: w.workflowHold,
});

test('whole-project hold freezes parallel business/calendar deadlines and preserves separately paused nodes', () => {
  let w = applyWorkflowAction(
    fixture(),
    {
      nodeCode: 'Already Paused',
      action: 'pause',
      reason: 'Waiting for site access',
      followUpDate: '2026-09-12',
    },
    '2026-09-11T03:00:00.000Z',
  );
  w = applyWorkflowAction(
    w,
    { nodeCode: 'Calendar', action: 'update', followUpDate: '2026-09-12' },
    heldAt,
  );
  const before = structuredClone(w);
  assert.equal(
    preflightWorkflowAction(w, { action: 'hold_project' }, heldAt)
      .needsCostConfirmation,
    false,
  );
  w = applyWorkflowAction(
    w,
    { action: 'hold_project', reason: 'Customer postponed' },
    heldAt,
  );
  assert.deepEqual(w.workflowHold, {
    startedAt: heldAt,
    reason: 'Customer postponed',
  });
  assert.deepEqual(w.processSteps, before.processSteps);
  assert.equal(w.workflowUpdates.at(-1).action, 'hold_project');
  assert.equal(
    buildDailyDigest([digestProject(w)], [], undefined, resumedAt).items.length,
    0,
  );
  assert.match(workflowActionBlockers(w, 'Finish')[0], /Resume project/);
  for (const action of [
    'start',
    'complete',
    'skip',
    'update',
    'pause',
    'resume',
    'reopen',
  ])
    assert.throws(
      () => applyWorkflowAction(w, { nodeCode: 'Calendar', action }, resumedAt),
      /Resume project/,
    );
  assert.throws(
    () => applyWorkflowAction(w, { action: 'hold_project' }, resumedAt),
    /already on hold/,
  );
  assert.throws(
    () => applyWorkflowAction(w, { action: 'resume_project' }, friday),
    /cannot precede/,
  );
  assert.equal(
    preflightWorkflowAction(w, { action: 'resume_project' }, resumedAt)
      .needsCostConfirmation,
    false,
  );
  const resumed = applyWorkflowAction(
    w,
    { action: 'resume_project' },
    resumedAt,
  );
  assert.equal(resumed.workflowHold, undefined);
  assert.equal(get(resumed, 'Calendar').dueAt, '2026-09-17T01:00:00.000Z');
  assert.equal(get(resumed, 'Business').dueAt, '2026-09-16T10:00:00.000Z'); // Monday holiday excluded
  assert.equal(get(resumed, 'Calendar').startedAt, friday);
  assert.equal(get(resumed, 'Calendar').followUpDate, '2026-09-16');
  assert.equal(get(resumed, 'Already Paused').state, 'paused');
  assert.equal(
    get(resumed, 'Already Paused').dueAt,
    get(before, 'Already Paused').dueAt,
  );
  assert.equal(
    get(resumed, 'Already Paused').pausedAt,
    '2026-09-11T03:00:00.000Z',
  );
  const nodeResumed = applyWorkflowAction(
    resumed,
    { nodeCode: 'Already Paused', action: 'resume' },
    '2026-09-15T06:00:00.000Z',
  );
  assert.equal(
    get(nodeResumed, 'Already Paused').dueAt,
    '2026-09-17T04:00:00.000Z',
  );
  assert.deepEqual(resumed.costVersions, before.costVersions);
  assert.deepEqual(
    resumed.workflowUpdates.slice(0, before.workflowUpdates.length),
    before.workflowUpdates,
  );
  assert.equal(resumed.workflowUpdates.at(-1).action, 'resume_project');
  assert.equal(get(w, 'Calendar').dueAt, get(before, 'Calendar').dueAt);
});

test('new rounds during hold resume from their own start and template sync retains hold without rewriting frozen SLA', () => {
  const held = applyWorkflowAction(
    fixture(),
    { action: 'hold_project' },
    heldAt,
  );
  const changed = definitions();
  changed[0].name = 'Calendar renamed';
  changed[0].slaDays = 4;
  const synced = applyWorkflowTemplate(held, changed, 2, {}, resumedAt);
  assert.deepEqual(synced.workflowHold, held.workflowHold);
  assert.equal(get(synced, 'Calendar').dueAt, get(held, 'Calendar').dueAt);
  assert.ok(
    previewWorkflowSync(held, changed, { migrateActive: true }).blockers.some(
      (text) => /Resume project/.test(text),
    ),
  );
  const createdAt = '2026-09-14T05:00:00.000Z';
  const newRound = {
    ...held,
    workflowVersion: 'V2',
    processSteps: resetWorkflowRoundSteps(definitions(), createdAt),
  };
  const resumed = applyWorkflowAction(
    newRound,
    { action: 'resume_project' },
    resumedAt,
  );
  assert.equal(get(resumed, 'Calendar').dueAt, '2026-09-17T05:00:00.000Z');
  assert.equal(get(resumed, 'Calendar').startedAt, createdAt);
});

test('project hold persistence is audited and revision-protected across sync, autosave and new cost versions', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    createProject(repo, { id: 'HOLD', name: 'Hold test', client: 'Customer' });
    const initial = repo.get('HOLD');
    const held = repo.applyWorkflowAction(
      'HOLD',
      { action: 'hold_project', reason: 'Awaiting customer' },
      initial.revision,
    );
    assert.deepEqual(
      held.workspace.costVersions,
      initial.workspace.costVersions,
    );
    assert.deepEqual(repo.list()[0].workflowHold, held.workspace.workflowHold);
    assert.deepEqual(
      repo.workflowPlan('HOLD').workflowHold,
      held.workspace.workflowHold,
    );
    assert.deepEqual(
      readResource(repo, 'HOLD', 'project', { section: 'workflow-tracking' })
        .value.workflowHold,
      held.workspace.workflowHold,
    );
    assert.throws(
      () =>
        repo.applyWorkflowAction(
          'HOLD',
          { action: 'resume_project' },
          initial.revision,
        ),
      /revision|changed/i,
    );
    for (const mutate of [
      (w) => delete w.workflowHold,
      (w) => {
        w.workflowHold.startedAt = friday;
      },
      (w) => {
        w.workflowUpdates.at(-1).reason = 'forged';
      },
    ]) {
      const forged = structuredClone(held.workspace);
      mutate(forged);
      assert.throws(() => repo.save('HOLD', forged, held.revision));
      assert.deepEqual(repo.get('HOLD'), held);
    }
    const master = repo.globalMasterData.get('workflow');
    const steps = structuredClone(master.items);
    steps[0].name = 'Updated scope';
    const preview = repo.previewWorkflowPublication(steps, master.revision);
    repo.publishWorkflow(steps, master.revision, {
      HOLD: preview.projects[0].revision,
    });
    assert.deepEqual(
      repo.get('HOLD').workspace.workflowHold,
      held.workspace.workflowHold,
    );
    const beforeDraft = repo.get('HOLD');
    createCostDraft(
      repo,
      'HOLD',
      { mode: 'clone', sourceVersion: 'V1' },
      beforeDraft.revision,
    );
    const draft = repo.get('HOLD');
    assert.equal(draft.workspace.workflowVersion, 'V2');
    assert.deepEqual(draft.workspace.workflowHold, held.workspace.workflowHold);
    assert.deepEqual(
      draft.workspace.costVersions[0],
      held.workspace.costVersions[0],
    );
    assert.deepEqual(
      draft.workspace.versionWorkflows.V1,
      beforeDraft.workspace.versionWorkflows.V1,
    );
    assert.equal(buildDailyDigest(repo.list(), []).items.length, 0);
    const resumed = repo.applyWorkflowAction(
      'HOLD',
      { action: 'resume_project' },
      draft.revision,
    );
    assert.equal(resumed.workspace.workflowHold, undefined);
    assert.equal(repo.list()[0].workflowHold, undefined);
    assert.equal(
      resumed.workspace.workflowUpdates.at(-1).action,
      'resume_project',
    );
    assert.deepEqual(
      resumed.workspace.costVersions,
      draft.workspace.costVersions,
    );
    assert.deepEqual(
      resumed.workspace.versionWorkflows.V1,
      draft.workspace.versionWorkflows.V1,
    );
  } finally {
    repo.close();
  }
});

test('restoring an older round compensates cross-version holds once without changing the removed or completed history', () => {
  let held = fixture();
  held = applyWorkflowAction(
    held,
    {
      nodeCode: 'Already Paused',
      action: 'pause',
      reason: 'Access',
      followUpDate: '2026-09-12',
    },
    '2026-09-11T03:00:00.000Z',
  );
  held = applyWorkflowAction(held, { action: 'hold_project' }, heldAt);
  const older = structuredClone(held.versionWorkflows.V1);
  const second = {
    ...structuredClone(held.costVersions[0]),
    code: 'V2',
    state: 'Draft',
  };
  let w = reconcileVersionWorkflows(held, {
    ...held,
    activeVersion: 'V2',
    costVersions: [...held.costVersions, second],
  });
  w.processSteps = resetWorkflowRoundSteps(
    definitions(),
    '2026-09-14T05:00:00.000Z',
  );
  w = applyWorkflowAction(w, { action: 'resume_project' }, resumedAt);
  assert.deepEqual(w.versionWorkflows.V1, older);
  w.costVersions[1].state = 'Suspended';
  const before = structuredClone(w);
  const removed = deleteSuspendedCostVersion(
    w,
    'V2',
    '2026-09-15T06:00:00.000Z',
  );
  assert.equal(removed.workflowVersion, 'V1');
  assert.equal(get(removed, 'Calendar').dueAt, '2026-09-17T01:00:00.000Z');
  assert.equal(get(removed, 'Business').dueAt, '2026-09-16T10:00:00.000Z');
  assert.equal(
    get(removed, 'Already Paused').dueAt,
    get(held, 'Already Paused').dueAt,
  );
  assert.equal(
    get(removed, 'Already Paused').pausedAt,
    get(held, 'Already Paused').pausedAt,
  );
  assert.deepEqual(
    removed.deletedCostVersions.V2.workflow,
    before.versionWorkflows.V2,
  );
  assert.deepEqual(removed.workflowUpdates, before.workflowUpdates);
  assert.deepEqual(removed.versionWorkflows.V2, before.versionWorkflows.V2);
  assert.deepEqual(restoreProjectHoldDeadlines(removed), removed.processSteps);
  assert.doesNotThrow(() =>
    assertCostVersionDeletionTransition(before, removed),
  );
  const persisted = reconcileVersionWorkflows(before, removed);
  assert.deepEqual(persisted.processSteps, removed.processSteps);
  assert.deepEqual(persisted.versionWorkflows.V1, removed.versionWorkflows.V1);
  assert.deepEqual(w, before);
});

test('a held project has no reminders from any legacy source and persisted inbox tasks deactivate then resume', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'project-hold-reminders-'));
  let w = fixture();
  const repository = { list: () => [digestProject(w)] };
  let service;
  try {
    service = openReminderService(
      path.join(dir, 'reminders.sqlite'),
      repository,
    );
    assert.ok(
      service.scan(undefined, heldAt).items.some((item) => item.active),
    );
    w = applyWorkflowAction(w, { action: 'hold_project' }, heldAt);
    assert.ok(
      service.scan(undefined, resumedAt).items.every((item) => !item.active),
    );
    service.close();
    service = openReminderService(
      path.join(dir, 'reminders.sqlite'),
      repository,
    );
    assert.ok(service.list().every((item) => !item.active));
    const legacy = {
      ...digestProject(w),
      workflowEngineVersion: undefined,
      workflowMode: undefined,
      versionState: 'Draft',
      totalCost: 100,
      incompleteCostRows: 1,
      ssrAttention: [
        {
          id: 'SSR',
          title: 'Old approval',
          detail: 'Overdue',
          severity: 'red',
          fingerprint: 'old',
        },
      ],
    };
    const review = {
      projectId: 'HOLD',
      id: 'Review',
      status: 'blocked',
      followUps: [],
    };
    assert.equal(
      buildDailyDigest([legacy], [review], undefined, resumedAt).items.length,
      0,
    );
    w = applyWorkflowAction(w, { action: 'resume_project' }, resumedAt);
    assert.ok(
      service.scan(undefined, resumedAt).items.some((item) => item.active),
    );
  } finally {
    service?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exposes project hold actions without nodeCode and rejects invalid action payloads atomically', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'project-hold-cli-'));
  const file = path.join(dir, 'workspace.sqlite');
  let repo = openWorkspaceRepository(file);
  try {
    createProject(repo, { id: 'HOLD', name: 'CLI hold', client: 'Customer' });
    const revision = repo.get('HOLD').revision;
    repo.close();
    repo = undefined;
    const run = (args) => {
      const result = spawnSync(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', 'cli/cost-cli.mjs', ...args],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
      return { status: result.status, response: JSON.parse(result.stdout) };
    };
    for (const command of [['help'], ['system', 'capabilities']]) {
      const result = run(command);
      assert.equal(result.status, 0);
      assert.ok(result.response.data.workflowActions.includes('hold_project'));
      assert.ok(
        result.response.data.workflowActions.includes('resume_project'),
      );
    }
    const request = path.join(dir, 'action.json');
    const act = (action, expected) => {
      writeFileSync(
        request,
        JSON.stringify({
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'hold-fixture',
          data: {
            schemaVersion: '1.0.0',
            operation: 'project.workflow-action',
            action,
          },
        }),
      );
      return run([
        'project',
        'workflow-action',
        '--project-id',
        'HOLD',
        '--input',
        request,
        '--expected-revision',
        String(expected),
        '--db',
        file,
      ]);
    };
    for (const action of [
      { action: 'update', note: 'Missing node' },
      { action: 'hold_project', nodeCode: 'TD_EFFORT_REVIEW' },
      { action: 'hold_project', startedAt: friday },
      { action: 'hold_project', reason: 123 },
    ])
      assert.notEqual(act(action, revision).status, 0);
    const held = act(
      { action: 'hold_project', reason: 'Customer delay' },
      revision,
    );
    assert.equal(held.status, 0, JSON.stringify(held.response));
    assert.equal(held.response.data.revision, revision + 1);
    assert.equal(held.response.data.workflowHold.reason, 'Customer delay');
    const resumed = act(
      { action: 'resume_project' },
      held.response.data.revision,
    );
    assert.equal(resumed.status, 0, JSON.stringify(resumed.response));
    repo = openWorkspaceRepository(file);
    assert.equal(repo.get('HOLD').workspace.workflowHold, undefined);
    assert.deepEqual(
      repo
        .get('HOLD')
        .workspace.workflowUpdates.slice(-2)
        .map((update) => update.action),
      ['hold_project', 'resume_project'],
    );
  } finally {
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
