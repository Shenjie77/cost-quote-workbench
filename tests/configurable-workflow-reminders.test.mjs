/** Configured parallel-task reminders share engine timing and durable acknowledgement. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildDailyDigest,
  groupDigestItemsByProject,
} from '../features/agent/digest-domain.ts';
import { openReminderService } from '../server/reminder-service.mjs';
import { applyWorkflowAction } from '../features/projects/workflow-engine.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';

const now = '2026-09-08T04:00:00.000Z';
const node = (code, extra = {}) => ({
  code,
  no: '01',
  name: `${code} review`,
  nameZh: `${code} 评审`,
  owner: 'PM',
  state: 'in_progress',
  tone: 'blue',
  date: '',
  dateZh: '',
  detail: '',
  detailZh: '',
  input: '',
  inputZh: '',
  required: false,
  reminderEnabled: true,
  slaDays: 3,
  slaCalendar: 'calendar',
  slaHolidays: [],
  startedAt: '2026-09-07T04:00:00.000Z',
  dueAt: '2026-09-09T15:59:59.999Z',
  ...extra,
});
const project = (steps, extra = {}) => ({
  projectId: 'P-PARALLEL',
  name: 'Deployment',
  client: 'Customer',
  workflowMode: 'project',
  workflowEngineVersion: 1,
  workflowVersion: 'V2',
  activeVersion: 'V1',
  currentWorkflowStepCode: steps[0]?.code || '',
  workflowSteps: steps,
  versionState: 'Draft',
  totalCost: 100,
  incompleteCostRows: 2,
  ssrAttention: [
    {
      id: 'old-ssr',
      title: 'Historical DRB',
      detail: 'Old pending result',
      severity: 'red',
      fingerprint: 'old',
    },
  ],
  ...extra,
});
const digest = (p, at = now) => buildDailyDigest([p], [], undefined, at);

test('parallel active nodes each get one scoped reminder while Today groups one project by highest urgency', () => {
  const p = project([
    node('TD'),
    node('Legal', {
      state: 'awaiting_review',
      dueAt: '2026-09-08T15:59:59.999Z',
    }),
    node('PM', { state: 'blocked', dueAt: '2026-09-07T15:59:59.999Z' }),
  ]);
  const result = digest(p);
  assert.deepEqual(
    result.items.map((item) => item.urgency),
    ['urgent', 'immediate', 'normal'],
  );
  assert.deepEqual(
    result.items.map((item) => item.workflowNodeId),
    ['PM', 'Legal', 'TD'],
  );
  assert.equal(new Set(result.items.map((item) => item.id)).size, 3);
  assert.ok(
    result.items.every(
      (item) => item.action === 'project' && item.workflowVersion === 'V2',
    ),
  );
  assert.ok(result.items.every((item) => item.id.includes(':V2:')));
  assert.equal(result.counts.cost_attention, 0);
  assert.equal(result.counts.data_quality, 0);
  const [group] = groupDigestItemsByProject(result.items);
  assert.equal(group.projectId, p.projectId);
  assert.equal(group.severity, 'red');
  assert.equal(group.items.length, 3);
  assert.match(group.items[0].detailZh, /2026-09-07 23:59/);
  assert.match(group.items[0].detailZh, /PM/);
});

test('SLA ordinary / final day / exceeded use Singapore dates and the exact due timestamp', () => {
  const p = project([node('CHECK')]);
  assert.equal(digest(p).items[0].urgency, 'normal');
  assert.equal(
    digest(p, '2026-09-08T16:00:00.000Z').items[0].urgency,
    'immediate',
  );
  assert.equal(
    digest(p, '2026-09-09T15:59:59.999Z').items[0].urgency,
    'immediate',
  );
  assert.equal(
    digest(p, '2026-09-09T16:00:00.000Z').items[0].urgency,
    'urgent',
  );
  assert.equal(
    buildDailyDigest([p], [], '2026-09-08').items[0].urgency,
    'normal',
  );
});

test('pending nodes stay quiet while active or paused work exists, and paused work waits for its resume check', () => {
  const p = project([
    node('PENDING', {
      state: 'not_started',
      startedAt: undefined,
      dueAt: undefined,
    }),
    node('DONE', { state: 'completed' }),
    node('SKIP', { state: 'skipped' }),
    node('DISABLED', { reminderEnabled: false, dueAt: '2026-09-01T00:00:00Z' }),
    node('PAUSED', {
      state: 'paused',
      pausedAt: '2026-09-07T04:00:00Z',
      followUpDate: '2026-09-10',
    }),
  ]);
  assert.equal(digest(p).items.length, 0);
  const paused = digest(p, '2026-09-10T04:00:00Z').items;
  assert.equal(paused.length, 1);
  assert.equal(paused[0].workflowNodeId, 'PAUSED');
  assert.equal(paused[0].urgency, 'immediate');
  assert.match(paused[0].detailZh, /安排恢复/);
  p.workflowSteps[4].reminderEnabled = false;
  assert.equal(digest(p, '2026-09-10T04:00:00Z').items.length, 0);
});

test('completing the only active node preserves the next cost-gated task as untimed ready work through scan and restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ready-reminders-'));
  const file = path.join(dir, 'reminders.sqlite');
  let workspace = {
    ...createBlankWorkspace(projectRecord('READY', 'Ready handoff', 'Client')),
    workflowEngineVersion: 1,
    workflowVersion: 'V1',
    currentWorkflowStepCode: 'SCOPE',
    processSteps: [
      node('SCOPE', { roundStart: true }),
      node('DRB', {
        state: 'not_started',
        requiresConfirmedCost: true,
        startedAt: undefined,
        dueAt: undefined,
      }),
      node('FINISH', {
        state: 'not_started',
        finishesWorkflow: true,
        required: true,
        startedAt: undefined,
        dueAt: undefined,
      }),
    ],
  };
  const repository = {
    list: () => [project(workspace.processSteps, { workflowVersion: 'V1' })],
  };
  let service;
  try {
    service = openReminderService(file, repository);
    const before = service.scan('2026-09-08', now).items;
    assert.deepEqual(
      before
        .filter((item) => item.active)
        .map((item) => item.item.workflowNodeId),
      ['SCOPE'],
    );
    workspace = applyWorkflowAction(
      workspace,
      { nodeCode: 'SCOPE', action: 'complete' },
      now,
    );
    const pending = structuredClone(workspace.processSteps[1]);
    assert.equal(pending.state, 'not_started');
    assert.throws(
      () =>
        applyWorkflowAction(
          workspace,
          { nodeCode: 'DRB', action: 'start' },
          now,
        ),
      /Confirmed|定稿|确认/,
    );
    const items = service.scan('2026-09-08', now).items;
    const [ready] = items.filter((item) => item.active);
    assert.equal(items.filter((item) => item.active).length, 1);
    assert.equal(ready.item.workflowNodeId, 'DRB');
    assert.equal(ready.item.urgency, 'normal');
    assert.equal(ready.item.severity, 'blue');
    assert.match(ready.item.detailZh, /待启动\/待登记.*尚未开始计时/);
    assert.doesNotMatch(ready.item.detailZh, /处理期限|超过期限/);
    assert.equal(
      items.find((item) => item.item.workflowNodeId === 'SCOPE').active,
      false,
    );
    service.acknowledge(ready.id, ready.fingerprint);
    service.close();
    service = openReminderService(file, repository);
    const [later] = service
      .scan('2026-09-20', '2026-09-20T04:00:00Z')
      .items.filter((item) => item.active);
    assert.equal(later.acknowledged, true);
    assert.equal(later.fingerprint, ready.fingerprint);
    assert.equal(later.item.urgency, 'normal');
    assert.deepEqual(workspace.processSteps[1], pending);
    assert.equal(pending.startedAt, undefined);
    assert.equal(pending.dueAt, undefined);
    workspace.costVersions = workspace.costVersions.map((version) => ({
      ...version,
      state: 'Confirmed',
    }));
    workspace = applyWorkflowAction(
      workspace,
      { nodeCode: 'DRB', action: 'start' },
      '2026-09-20T04:00:00Z',
    );
    const [started] = service
      .scan('2026-09-20', '2026-09-20T04:00:00Z')
      .items.filter((item) => item.active);
    assert.equal(started.id, ready.id);
    assert.equal(started.acknowledged, false);
    assert.notEqual(started.fingerprint, ready.fingerprint);
    assert.match(started.item.detailZh, /处理期限/);
    assert.doesNotMatch(started.item.detailZh, /待启动/);
  } finally {
    service?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ready reminders include only the first pending phase, respect muted nodes, and ignore stale SLA dates', () => {
  const p = project([
    node('DONE', { state: 'completed' }),
    node('SKIP', { state: 'skipped' }),
    node('LEGAL', {
      state: 'not_started',
      parallelGroup: 'Reviews',
      dueAt: '2026-09-01T00:00:00Z',
    }),
    node('TD', { state: 'not_started', parallelGroup: 'Reviews' }),
    node('MUTED', {
      state: 'not_started',
      parallelGroup: 'Reviews',
      reminderEnabled: false,
    }),
    node('FUTURE', { state: 'not_started' }),
  ]);
  const items = digest(p).items;
  assert.deepEqual(
    items.map((item) => item.workflowNodeId).sort((a, b) => a.localeCompare(b)),
    ['LEGAL', 'TD'],
  );
  assert.ok(items.every((item) => item.urgency === 'normal'));
  assert.ok(items.every((item) => !/处理期限|超过期限/.test(item.detailZh)));
  p.workflowSteps[2].reminderEnabled = false;
  p.workflowSteps[3].reminderEnabled = false;
  assert.equal(digest(p).items.length, 0);
  p.workflowSteps[2].reminderEnabled = true;
  assert.equal(digest(p).items.length, 1);
  p.workflowSteps.push(
    node('FINISH', { state: 'completed', finishesWorkflow: true }),
  );
  assert.equal(digest(p).items.length, 0);
});

test('muted active work and paused work without a recovery date do not expose future pending phases', () => {
  for (const ongoing of [
    node('ACTIVE', { reminderEnabled: false }),
    node('PAUSED', { state: 'paused', followUpDate: undefined }),
  ]) {
    const p = project([ongoing, node('FUTURE', { state: 'not_started' })]);
    assert.equal(digest(p).items.length, 0);
  }
});

test('an earlier manual follow-up prompts action without describing an unexpired SLA as overdue', () => {
  const p = project([node('EARLY', { followUpDate: '2026-09-08' })]);
  const [item] = digest(p).items;
  assert.equal(item.urgency, 'immediate');
  assert.match(item.detailZh, /跟进日期：2026-09-08/);
  assert.doesNotMatch(item.detailZh, /已超过期限/);
});

test('a completed configured finish node stops all reminders independent of its code or selected display node', () => {
  const p = project([
    node('LEGAL', { dueAt: '2026-09-01T00:00:00Z' }),
    node('SEND_TO_CUSTOMER', { state: 'completed', finishesWorkflow: true }),
  ]);
  assert.equal(digest(p).items.length, 0);
  p.workflowSteps[1].state = 'not_started';
  p.workflowSteps[1].startedAt = undefined;
  p.workflowSteps[1].dueAt = undefined;
  p.workflowVersion = 'V3';
  p.projectStatus = 'completed';
  assert.equal(digest(p).items.length, 1);
  assert.equal(digest(p).items[0].workflowVersion, 'V3');
});

test('task reminders preserve acknowledgements across minute scans and restart, then resolve disabled/completed work and reappear only for new work', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'configured-reminders-'));
  const file = path.join(dir, 'reminders.sqlite');
  let current = project([node('TD'), node('PM')]);
  const repository = { list: () => [structuredClone(current)] };
  let service;
  try {
    service = openReminderService(file, repository);
    const initial = service
      .scan('2026-09-08', now)
      .items.filter((item) => item.active);
    assert.equal(initial.length, 2);
    const td = initial.find((item) => item.item.workflowNodeId === 'TD');
    service.acknowledge(td.id, td.fingerprint);
    let repeated = service
      .scan('2026-09-08', '2026-09-08T04:01:00Z')
      .items.find((item) => item.id === td.id);
    assert.equal(repeated.acknowledged, true);
    assert.equal(repeated.fingerprint, td.fingerprint);
    current.activeVersion = 'V0';
    repeated = service
      .scan('2026-09-08', now)
      .items.find((item) => item.id === td.id);
    assert.equal(repeated.acknowledged, true);
    service.close();
    service = openReminderService(file, repository);
    assert.equal(
      service.list().find((item) => item.id === td.id).acknowledged,
      true,
    );
    current.workflowSteps[1].reminderEnabled = false;
    assert.equal(
      service.scan('2026-09-08', now).items.filter((item) => item.active)
        .length,
      1,
    );
    assert.equal(
      service.list().find((item) => item.item.workflowNodeId === 'PM').active,
      false,
    );
    current.workflowSteps[0].note = 'PM provided updated context';
    repeated = service
      .scan('2026-09-08', now)
      .items.find((item) => item.id === td.id);
    assert.equal(repeated.acknowledged, false);
    service.acknowledge(repeated.id, repeated.fingerprint);
    assert.equal(
      service
        .scan('2026-09-09', '2026-09-09T04:00:00Z')
        .items.find((item) => item.id === td.id).acknowledged,
      false,
    );
    current.workflowSteps.push(
      node('DONE', { state: 'completed', finishesWorkflow: true }),
    );
    assert.equal(
      service
        .scan('2026-09-09', '2026-09-09T04:00:00Z')
        .items.filter((item) => item.active).length,
      0,
    );
    service.close();
    service = openReminderService(file, repository);
    assert.equal(
      service
        .scan('2026-09-09', '2026-09-09T04:00:00Z')
        .items.filter((item) => item.active).length,
      0,
    );
    current = project(
      [
        node('TD', {
          startedAt: '2026-09-10T04:00:00Z',
          dueAt: '2026-09-12T15:59:59.999Z',
        }),
      ],
      { workflowVersion: 'V3' },
    );
    const reopened = service
      .scan('2026-09-10', '2026-09-10T04:00:00Z')
      .items.filter((item) => item.active);
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0].acknowledged, false);
    assert.notEqual(reopened[0].id, td.id);
  } finally {
    service?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
