import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  emptySsr,
  recordSubmission,
  recordReviewResult,
  submissionDependencies,
  isStale,
  assertSsrTransition,
  ssrAttention,
} from '../features/ssr/domain.ts';
const fixture = () => {
  const w = createBlankWorkspace(
    projectRecord('DRB-COST', 'Confirmation', 'Client'),
    'costing',
  );
  const v1 = w.costVersions[0];
  const v2 = createCostVersion('V2', 'Draft', 'V1', v1);
  const ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'PROP-1',
    scopeBrief: 'Service deployment',
  };
  return { w, v1, v2, ssr };
};
const submit = (s, b, kind) =>
  recordSubmission(s, b, {
    kind,
    domain: '',
    owner: 'PM',
    dueDate: '2026-09-10',
    applicationNumber: `${kind}-${b.code}`,
    evidence: 'Company reference',
  });
const approve = (s) =>
  recordReviewResult(s, s.submissions.at(-1).id, {
    outcome: 'approved',
    evidence: 'Company decision',
    conditions: [],
  });
test('DRB requires explicitly confirmed costs and does not mutate a Draft or infer approval', () => {
  const { v1, ssr } = fixture();
  const td = approve(submit(ssr, v1, 'DTRB'));
  assert.throws(() => submit(td, v1, 'DRB'), /先确认成本.*V1/);
  assert.equal(v1.state, 'Draft');
  const confirmed = { ...v1, state: 'Confirmed' };
  const drb = submit(td, confirmed, 'DRB');
  assert.equal(drb.submissions.at(-1).costBaseline.state, 'Confirmed');
  assert.deepEqual(drb.submissions.at(-1).results, []);
});
test('each version needs its own DTRB and DRB even when the scope and costs are identical', () => {
  const { v1, v2, ssr } = fixture();
  v1.state = v2.state = 'Confirmed';
  let s = approve(submit(ssr, v1, 'DTRB'));
  s = approve(submit(s, v1, 'DRB'));
  const v1Drb = s.submissions.at(-1);
  assert.throws(() => submissionDependencies(s, 'DRB', '', v2), /DTRB/);
  s = approve(submit(s, v2, 'DTRB'));
  assert.equal(isStale(s, v1Drb, v1), false);
  assert.equal(isStale(s, s.submissions.at(-1), v1), true);
  assert.throws(() => submissionDependencies(s, 'BUDGET', '', v2), /DRB/);
  s = approve(submit(s, v2, 'DRB'));
  assert.equal(isStale(s, v1Drb, v1), false);
  assert.equal(submissionDependencies(s, 'BUDGET', '', v1)[0], v1Drb.id);
  assert.equal(
    submissionDependencies(s, 'BUDGET', '', v2)[0],
    s.submissions.at(-1).id,
  );
  assert.ok(ssrAttention(s, v2, '2026-09-12').every((r) => r.id !== v1Drb.id));
});
test('repository SSR boundary rejects forged Draft submission and validates the actual target version', () => {
  const { v1, v2, ssr } = fixture();
  v2.state = 'Confirmed';
  let s = approve(submit(ssr, v2, 'DTRB'));
  s = submit(s, v2, 'DRB');
  assert.doesNotThrow(() => assertSsrTransition(ssr, s, [v1, v2]));
  const forged = structuredClone(s);
  for (const submission of forged.submissions)
    submission.costBaseline.state = 'Draft';
  assert.throws(
    () => assertSsrTransition(ssr, forged, [v1, { ...v2, state: 'Draft' }]),
    /先确认成本/,
  );
});
test('a legacy pending Draft DRB can record approval only after confirmation of exactly its submitted inputs', () => {
  const { v1, ssr } = fixture();
  const confirmed = { ...v1, state: 'Confirmed' };
  let pending = approve(submit(ssr, v1, 'DTRB'));
  pending = submit(pending, confirmed, 'DRB');
  pending.submissions.at(-1).costBaseline.state = 'Draft';
  const approved = approve(pending);
  assert.throws(
    () => assertSsrTransition(pending, approved, [v1]),
    /先确认成本/,
  );
  assert.doesNotThrow(() =>
    assertSsrTransition(pending, approved, [confirmed]),
  );
  const changed = structuredClone(confirmed);
  changed.manualCosts.riskContingency += 1;
  assert.throws(
    () => assertSsrTransition(pending, approved, [changed]),
    /过期/,
  );
});

test('CLI retires SSR writes and tracks the current workflow round while a historical cost is open', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { openWorkspaceRepository } =
    await import('../server/workspace-repository.mjs');
  const folder = mkdtempSync(path.join(tmpdir(), 'drb-confirm-cli-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'test.sqlite');
  const { w, v1, v2, ssr } = fixture();
  v1.state = 'Confirmed';
  w.costVersions = [v1, v2];
  w.ssr = ssr;
  const repo = openWorkspaceRepository(file);
  repo.save(w.project.id, w, null);
  repo.close();
  const run = (operation, fields, version, expected = 0) => {
    const current = openWorkspaceRepository(file),
      revision = current.get(w.project.id).revision;
    current.close();
    const [module, command] = operation.split('.');
    const child = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        module,
        command,
        '--project-id',
        w.project.id,
        '--input',
        '-',
        '--expected-revision',
        String(revision),
        ...(operation.startsWith('ssr.') ? ['--compact'] : []),
        ...(operation === 'project.update'
          ? ['--section', 'workflow-tracking']
          : []),
        '--db',
        file,
        ...(version ? ['--version', version] : []),
      ],
      {
        encoding: 'utf8',
        cwd: path.resolve(import.meta.dirname, '..'),
        input: JSON.stringify({
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'drb-version-test',
          data: { schemaVersion: '1.0.0', operation, ...fields },
        }),
      },
    );
    assert.equal(child.status, expected, child.stdout + child.stderr);
    return JSON.parse(child.stdout);
  };
  const request = {
    kind: 'DTRB',
    domain: '',
    owner: 'TD',
    dueDate: '2026-09-10',
    applicationNumber: 'TD-1',
    evidence: 'Company reference',
  };
  const retired = run('ssr.submit', request, 'V1', 6);
  assert.match(retired.error.message, /read-only/);
  const current = run('project.update', {
    changes: {
      set: {
        currentWorkflowStepCode: 'TD_EFFORT_REVIEW',
        owner: 'TD',
        followUpDate: '2026-09-10',
        note: 'Checked the current company workflow',
      },
    },
  });
  const check = openWorkspaceRepository(file);
  const record = check.get(w.project.id);
  assert.equal(record.workspace.activeVersion, 'V1');
  assert.equal(record.workspace.workflowVersion, 'V2');
  assert.deepEqual(
    record.workspace.ssr.submissions.map((s) => s.costBaseline.code),
    [],
  );
  assert.equal(current.data.workflowVersion, 'V2');
  const revision = record.revision;
  check.close();
  const blocked = run(
    'ssr.submit',
    { ...request, kind: 'DRB', applicationNumber: 'DRB-2' },
    'V2',
    6,
  );
  assert.match(blocked.error.message, /read-only/);
  const blockedWorkflow = run(
    'project.update',
    { changes: { set: { currentWorkflowStepCode: 'DELIVERY_REVIEW' } } },
    undefined,
    6,
  );
  assert.match(blockedWorkflow.error.message, /Confirm cost V2/);
  const unchanged = openWorkspaceRepository(file);
  assert.equal(unchanged.get(w.project.id).revision, revision);
  unchanged.close();
});
