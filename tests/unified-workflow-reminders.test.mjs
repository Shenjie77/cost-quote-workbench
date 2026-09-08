/** Project Workflow is the sole reminder source; completed quotes stay quiet. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDailyDigest } from '../features/agent/digest-domain.ts';
import { openReminderService } from '../server/reminder-service.mjs';

const asOf = '2026-09-08';
const legacyReview = {
  id: 'old-review',
  projectId: 'P-WORKFLOW',
  gate: 'DRB',
  gateZh: '交付评审',
  owner: 'PM',
  status: 'blocked',
  dueDate: '2026-09-01',
  note: '',
  noteZh: '',
  workflowStepCode: 'delivery-review',
  lastUpdatedAt: '2026-09-01T00:00:00.000Z',
  followUps: [],
};
const legacyProject = {
  projectId: 'P-WORKFLOW',
  name: 'Remote Support',
  client: 'Client',
  activeVersion: 'V1',
  versionState: 'Draft',
  totalCost: 1000,
  incompleteCostRows: 2,
  ssrAttention: [
    {
      id: 'old-ssr',
      title: 'DRB blocked',
      detail: 'Historical approval follow-up',
      severity: 'red',
      fingerprint: 'old-ssr-fingerprint',
    },
  ],
  reviewGates: [legacyReview],
};
const project = (followUpDate = '', extra = {}) => ({
  ...legacyProject,
  workflowMode: 'project',
  workflowVersion: 'V1',
  currentWorkflowStepCode: 'DRB',
  workflowSteps: [
    {
      code: 'DRB',
      name: 'DRB',
      nameZh: 'DRB 交付评审',
      owner: 'PM',
      followUpDate,
      note: '请在公司系统核对评审结果',
    },
  ],
  ...extra,
});
const digest = (value) => buildDailyDigest([value], [legacyReview], asOf);

test('unified workflow yields at most one reminder and ignores legacy review, SSR, draft, and quality exceptions', () => {
  const result = digest(project('2026-09-07'));
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.id, 'project-workflow:P-WORKFLOW');
  assert.equal(item.action, 'project');
  assert.equal(item.category, 'immediate_follow_up');
  assert.equal(item.severity, 'red');
  assert.equal(item.reviewId, '');
  assert.match(item.titleZh, /DRB 交付评审/);
  assert.match(item.detailZh, /PM/);
  assert.match(item.detailZh, /2026-09-07/);
  assert.equal(result.counts.cost_attention, 0);
  assert.equal(result.counts.data_quality, 0);
});

test('QUOTE_COMPLETED excludes every reminder even with stale legacy statuses and draft costs', () => {
  const result = digest(
    project('2026-09-01', {
      currentWorkflowStepCode: 'QUOTE_COMPLETED',
      projectStatus: 'costing',
    }),
  );
  assert.equal(result.items.length, 0);
});

test('legacy completed projects also suppress old review and cost reminders', () => {
  assert.equal(
    digest({ ...legacyProject, projectStatus: 'completed' }).items.length,
    0,
  );
});

test('missing follow-up date requests an owner follow-up date instead of inventing a deadline', () => {
  const [item] = digest(project()).items;
  assert.equal(item.category, 'immediate_follow_up');
  assert.equal(item.severity, 'amber');
  assert.match(item.detailZh, /补充跟进日期/);
  assert.match(item.detailZh, /下次跟进：未设置/);
  assert.match(item.detailZh, /负责人：PM/);
});

test('only due dates within three days become upcoming reminders; today is immediate', () => {
  assert.equal(
    digest(project('2026-09-08')).items[0].category,
    'immediate_follow_up',
  );
  for (const date of ['2026-09-09', '2026-09-10', '2026-09-11']) {
    const [item] = digest(project(date)).items;
    assert.equal(item.category, 'decisions_due');
    assert.equal(item.severity, 'amber');
  }
  assert.equal(digest(project('2026-09-12')).items.length, 0);
  assert.equal(digest(project('2027-01-01')).items.length, 0);
});

test('a reopened workflow round resumes follow-up even if an old project status remains completed', () => {
  const reopened = project('', {
    projectStatus: 'completed',
    activeVersion: 'V2',
    currentWorkflowStepCode: 'DTRB',
    workflowSteps: [
      { code: 'DTRB', name: 'DTRB', owner: 'TD', followUpDate: '' },
    ],
  });
  const [item] = digest(reopened).items;
  assert.equal(item.action, 'project');
  assert.match(item.title, /DTRB/);
  assert.match(item.detail, /TD/);
});

test('refresh retires legacy reminders, completed projects stay resolved after restart, and reopening reactivates follow-up', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'unified-workflow-reminders-'));
  const filename = path.join(dir, 'reminders.sqlite');
  let current = legacyProject;
  const repository = { list: () => [current] };
  let service;
  try {
    service = openReminderService(filename, repository);
    const old = service.scan(asOf).items.filter((item) => item.active);
    assert.equal(old.length, 4);

    current = project('2026-09-08');
    const migrated = service.scan(asOf).items;
    assert.equal(migrated.filter((item) => item.active).length, 1);
    assert.ok(
      old.every(
        (previous) => !migrated.find((item) => item.id === previous.id).active,
      ),
    );
    const first = migrated.find((item) => item.active);
    service.acknowledge(first.id, first.fingerprint);
    assert.equal(
      service.scan(asOf).items.find((item) => item.active).acknowledged,
      true,
    );
    current = { ...current, activeVersion: 'V0' };
    assert.equal(
      service.scan(asOf).items.find((item) => item.active).acknowledged,
      true,
      'Viewing a different cost version does not reopen the workflow reminder',
    );

    current = project('2026-09-08', {
      currentWorkflowStepCode: 'QUOTE_COMPLETED',
    });
    assert.equal(
      service.scan(asOf).items.filter((item) => item.active).length,
      0,
    );
    service.close();
    service = openReminderService(filename, repository);
    assert.equal(service.list().filter((item) => item.active).length, 0);
    assert.equal(
      service.scan(asOf).items.filter((item) => item.active).length,
      0,
    );

    current = project('2026-09-08', {
      activeVersion: 'V2',
      workflowVersion: 'V2',
      projectStatus: 'completed',
    });
    const reopened = service.scan(asOf).items.filter((item) => item.active);
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0].acknowledged, false);
    assert.notEqual(reopened[0].fingerprint, first.fingerprint);

    current = project('2026-10-01', { activeVersion: 'V2' });
    assert.equal(
      service.scan(asOf).items.filter((item) => item.active).length,
      0,
    );
  } finally {
    service?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
