import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  emptySsr,
  recordSubmission,
  recordReviewResult,
  closeCondition,
  followUpSubmission,
  openConditions,
  isStale,
  assertSsrTransition,
  assertQuoteDecision,
  ssrAttention,
  commercialBasisKey,
} from '../features/ssr/domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { openReminderService } from '../server/reminder-service.mjs';
const setup = () => {
  const w = createBlankWorkspace(
    projectRecord('SSR-TEST', 'SSR test', 'Client'),
    'costing',
  );
  const baseline = w.costVersions[0];
  baseline.state = 'Confirmed';
  const ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'P100',
    scopeBrief: '部署联调',
    commercialBasis: commercialBasisKey(w),
    requiredDomains: ['Legal'],
  };
  return { w, baseline, ssr };
};
const submit = (s, b, kind, domain = '') =>
  recordSubmission(s, b, {
    kind,
    domain,
    owner: 'PM',
    dueDate: '2026-09-07',
    applicationNumber: kind + '-001',
    evidence: 'Company record',
  });
const approve = (s) =>
  recordReviewResult(s, s.submissions.at(-1).id, {
    outcome: 'approved',
    evidence: 'Approved in company',
    conditions: [],
  });
test('SSR gates allow specialist parallel to budget but require closed conditions and current dependencies', () => {
  const { ssr, baseline: b } = setup();
  let s = ssr;
  assert.throws(() => submit(s, b, 'DRB'), /DTRB/);
  s = approve(submit(s, b, 'DTRB'));
  s = approve(submit(s, b, 'DRB'));
  s = submit(s, b, 'BUDGET');
  const budget = s.submissions.at(-1).id;
  s = approve(submit(s, b, 'SPECIALIST', 'Legal'));
  assert.throws(() => submit(s, b, 'QUOTE_DECISION'), /BUDGET/);
  s = recordReviewResult(s, budget, {
    outcome: 'conditional',
    conditions: ['法务条款'],
    evidence: 'Conditions',
  });
  assert.throws(() => submit(s, b, 'QUOTE_DECISION'), /conditions/);
  s = closeCondition(s, budget, '法务条款', 'Legal signed');
  s = approve(submit(s, b, 'QUOTE_DECISION'));
  assertQuoteDecision(s, b);
  assert.throws(
    () => assertQuoteDecision({ ...s, commercialBasis: 'changed T&C' }, b),
    /报价决策/,
  );
  const td = s.submissions[0].id;
  s = recordReviewResult(s, td, {
    outcome: 'withdrawn',
    evidence: 'Replaced',
    conditions: [],
  });
  assert.equal(isStale(s, s.submissions[1], b), true);
  assert.throws(() => assertQuoteDecision(s, b), /报价决策/);
});
test('identically named conditions in a new result require new closure evidence', () => {
  const { ssr, baseline: b } = setup();
  let s = ssr;
  s = submit(s, b, 'DTRB');
  const id = s.submissions[0].id;
  s = recordReviewResult(s, id, {
    outcome: 'conditional',
    conditions: ['A'],
    evidence: 'first',
  });
  s = closeCondition(s, id, 'A', 'closed');
  s = recordReviewResult(s, id, {
    outcome: 'conditional',
    conditions: ['A'],
    evidence: 'second',
  });
  assert.deepEqual(openConditions(s.submissions[0]), ['A']);
});
test('tender review requires every configured domain and submission order is append-only', () => {
  const { ssr, baseline: b } = setup();
  let s = ssr;
  s.mode = 'tender';
  assert.throws(() => submit(s, b, 'BID_REVIEW'), /标书/);
  s.bidResponses = [
    {
      id: 'b1',
      clause: '1',
      requirement: 'legal',
      domain: 'Other',
      response: 'yes',
      deviation: 'none',
      owner: 'Owner',
      dueDate: '',
    },
  ];
  assert.throws(() => submit(s, b, 'BID_REVIEW'), /标书/);
  s.bidResponses[0].domain = 'Legal';
  s = submit(s, b, 'BID_REVIEW');
  const prior = structuredClone(s);
  s = submit(s, b, 'DTRB');
  s.submissions.reverse();
  assert.throws(() => assertSsrTransition(prior, s, b), /order/);
});
test('historical SSR records stay read-only while project reminders survive restart and stop on quote completion', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ssr-reminders-')),
    db = path.join(dir, 'db.sqlite');
  let repo, reminders;
  try {
    repo = openWorkspaceRepository(db);
    const { w, baseline, ssr } = setup();
    w.ssr = submit(ssr, baseline, 'DTRB');
    let record = repo.save(w.project.id, w, null);
    reminders = openReminderService(db, repo);
    const first = reminders
      .scan('2026-09-07')
      .items.find((r) => r.item.action === 'project');
    assert.ok(first);
    reminders.acknowledge(first.id, first.fingerprint);
    assert.equal(
      reminders.scan('2026-09-07').items.find((r) => r.id === first.id)
        .acknowledged,
      true,
    );
    assert.equal(repo.get(w.project.id).revision, record.revision);
    reminders.close();
    reminders = openReminderService(db, repo);
    assert.equal(
      reminders.list().find((r) => r.id === first.id).acknowledged,
      true,
    );
    const bad = structuredClone(record.workspace);
    bad.ssr.submissions[0].owner = 'Other';
    assert.throws(
      () => repo.save(w.project.id, bad, record.revision),
      /read-only/,
    );
    const next = structuredClone(record.workspace);
    next.ssr = approve(next.ssr);
    assert.throws(
      () => repo.save(w.project.id, next, record.revision),
      /read-only/,
    );
    assert.deepEqual(
      repo.get(w.project.id).workspace.ssr,
      record.workspace.ssr,
    );
    for (const original of record.workspace.processSteps) {
      let current = repo.get(w.project.id);
      let step = current.workspace.processSteps.find(
        (value) => value.code === original.code,
      );
      if (['completed', 'skipped'].includes(step.state)) continue;
      if (step.state === 'not_started') {
        repo.applyWorkflowAction(
          w.project.id,
          { nodeCode: step.code, action: 'start' },
          current.revision,
        );
        current = repo.get(w.project.id);
        step = current.workspace.processSteps.find(
          (value) => value.code === original.code,
        );
      }
      repo.applyWorkflowAction(
        w.project.id,
        {
          nodeCode: step.code,
          action: 'complete',
          confirmed: true,
          fields: Object.fromEntries(
            (step.requiredFields || []).map((key) => [
              key,
              'Verified company fixture information',
            ]),
          ),
        },
        current.revision,
      );
    }
    record = repo.get(w.project.id);
    assert.equal(
      reminders.scan('2026-09-07').items.find((r) => r.id === first.id).active,
      false,
    );
    const older = structuredClone(record.workspace);
    delete older.ssr;
    assert.throws(
      () => repo.save(w.project.id, older, record.revision),
      /read-only/,
    );
    assert.deepEqual(repo.get(w.project.id), record);
  } finally {
    reminders?.close();
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('new follow-up dates reschedule ordinary reminders, rejected results remain actionable', () => {
  const { ssr, baseline: b } = setup();
  let s = ssr;
  s = submit(s, b, 'DTRB');
  s = followUpSubmission(
    s,
    s.submissions[0].id,
    'PM promises next month',
    '2026-10-01',
  );
  assert.equal(ssrAttention(s, b, '2026-09-07').length, 0);
  s = recordReviewResult(s, s.submissions[0].id, {
    outcome: 'rejected',
    conditions: [],
    evidence: 'Revise technical scope',
  });
  assert.equal(ssrAttention(s, b, '2026-09-07').length, 1);
});

test('quotation cannot skip unconfigured domains and project/customer changes invalidate its basis', () => {
  const { ssr, baseline } = setup();
  let s = approve(submit(ssr, baseline, 'DTRB'));
  s = approve(submit(s, baseline, 'DRB'));
  s = approve(submit(s, baseline, 'BUDGET'));
  assert.throws(
    () => submit({ ...s, requiredDomains: [] }, baseline, 'QUOTE_DECISION'),
    /领域/,
  );
  s = approve(submit(s, baseline, 'SPECIALIST', 'Legal'));
  s = approve(submit(s, baseline, 'QUOTE_DECISION'));
  assertQuoteDecision(s, baseline);
  const { w } = setup();
  w.project.client = 'Another customer';
  assert.throws(
    () =>
      assertQuoteDecision(
        { ...s, commercialBasis: commercialBasisKey(w) },
        baseline,
      ),
    /报价决策/,
  );
  const old = structuredClone(s);
  s = recordReviewResult(s, s.submissions[0].id, {
    outcome: 'approved',
    conditions: [],
    evidence: 'New approval result',
  });
  assert.equal(isStale(s, s.submissions[1], baseline), true);
  assert.notDeepEqual(s, old);
});
