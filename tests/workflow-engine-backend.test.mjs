import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  createCostDraft,
} from '../server/workspace-resources.mjs';
import { createProjectWorkflowSteps } from '../features/projects/workflow-domain.ts';
import { normalizeWorkflowDefinition } from '../features/projects/workflow-engine.ts';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { recalculateCostRows } from '../features/cost/domain.ts';

function definitions() {
  const base = createProjectWorkflowSteps()[0];
  return [
    {
      code: 'START',
      name: 'Start',
      required: true,
      roundStart: true,
      requiredFields: ['application'],
    },
    { code: 'OPTION', name: 'Optional check', required: false, autoSkip: true },
    {
      code: 'LEGAL',
      name: 'Legal',
      required: true,
      parallelGroup: 'REVIEWS',
      requiredFields: ['result'],
    },
    {
      code: 'FINANCE',
      name: 'Finance',
      required: true,
      parallelGroup: 'REVIEWS',
    },
    {
      code: 'DONE',
      name: 'Quote complete',
      required: true,
      finishesWorkflow: true,
    },
  ].map((patch, index) =>
    normalizeWorkflowDefinition({
      ...base,
      roundStart: false,
      finishesWorkflow: false,
      requiresConfirmedCost: false,
      requiredFields: [],
      parallelGroup: '',
      autoSkip: false,
      reminderEnabled: true,
      slaDays: 3,
      slaCalendar: 'calendar',
      slaHolidays: [],
      ...patch,
      no: String(index + 1).padStart(2, '0'),
      nameZh: patch.name,
    }),
  );
}
function initialize(repo, ids = ['A']) {
  const master = repo.globalMasterData.get('workflow');
  repo.publishWorkflow(definitions(), master.revision, {});
  for (const id of ids)
    createProject(repo, { id, name: `Project ${id}`, client: 'Client' });
}
function act(repo, id, action) {
  return repo.applyWorkflowAction(id, action, repo.get(id).revision);
}
function complete(repo, id, code, fields = {}) {
  if (
    payload(repo, id).processSteps.find((s) => s.code === code).state ===
    'not_started'
  )
    act(repo, id, { nodeCode: code, action: 'start' });
  return act(repo, id, {
    nodeCode: code,
    action: 'complete',
    confirmed: true,
    fields,
  });
}
const payload = (repo, id = 'A') => repo.get(id).workspace;
const revisionMap = (plan) =>
  Object.fromEntries(
    plan.projects
      .filter((p) => !p.completed)
      .map((p) => [p.projectId, p.revision]),
  );

test('twelve and fifteen workflow nodes publish, save and sync without losing later critical gates', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    initialize(repo, ['A', 'B']);
    complete(repo, 'B', 'START', { application: 'P-B' });
    complete(repo, 'B', 'LEGAL', { result: 'Approved' });
    complete(repo, 'B', 'FINANCE');
    complete(repo, 'B', 'DONE');
    const completedProject = repo.get('B');
    const costsBefore = structuredClone(payload(repo).costVersions);
    const initialSteps = definitions();
    const additions = Array.from({ length: 10 }, (_, index) => ({
      ...initialSteps[1],
      code: `EXTRA-${index + 1}`,
      no: String(index + 5).padStart(2, '0'),
      name:
        index === 6
          ? 'Late mandatory review'
          : `Additional review ${index + 1}`,
      nameZh: '',
      required: index === 6,
      autoSkip: index !== 6,
      requiresConfirmedCost: index === 6,
      requiredFields: index === 6 ? ['approval'] : [],
    }));
    const twelve = [
      ...initialSteps.slice(0, -1),
      ...additions.slice(0, 7),
      { ...initialSteps.at(-1), no: '12' },
    ];
    let master = repo.globalMasterData.get('workflow');
    const preview = repo.previewWorkflowPublication(twelve, master.revision);
    assert.equal(
      preview.projects.find((item) => item.projectId === 'A').steps.length,
      12,
    );
    assert.equal(
      preview.projects.find((item) => item.projectId === 'A').blockers.length,
      0,
    );
    assert.equal(
      preview.projects.find((item) => item.projectId === 'B').completed,
      true,
    );
    repo.publishWorkflow(twelve, master.revision, revisionMap(preview));
    assert.equal(payload(repo).processSteps.length, 12);
    assert.deepEqual(repo.get('B'), completedProject);

    // The compatibility/CLI save path must support the same expanded template.
    master = repo.globalMasterData.get('workflow');
    const saved = repo.globalMasterData.update(
      'workflow',
      { upsert: [...additions.slice(7), { code: 'DONE', no: '15' }] },
      master.revision,
    );
    const expectedCodes = [
      ...initialSteps.slice(0, -1).map((step) => step.code),
      ...additions.map((step) => step.code),
      'DONE',
    ];
    assert.equal(saved.items.length, 15);
    assert.deepEqual(
      saved.items.map((step) => step.code),
      expectedCodes,
    );
    assert.deepEqual(
      payload(repo).processSteps.map((step) => step.code),
      expectedCodes,
    );
    assert.deepEqual(payload(repo).costVersions, costsBefore);
    assert.deepEqual(repo.get('B'), completedProject);
    createProject(repo, { id: 'C', name: 'After expansion', client: 'Client' });
    assert.deepEqual(
      payload(repo, 'C').processSteps.map((step) => step.code),
      expectedCodes,
    );
    assert.equal(repo.workflowPlan('C').steps.length, 15);
    assert.equal(repo.workflowPlan('C').templateRevision, saved.revision);

    complete(repo, 'A', 'START', { application: 'P-A' });
    complete(repo, 'A', 'LEGAL', { result: 'Approved' });
    complete(repo, 'A', 'FINANCE');
    assert.throws(() => complete(repo, 'A', 'DONE'), /Late mandatory review/);
    assert.throws(
      () => act(repo, 'A', { nodeCode: 'EXTRA-7', action: 'start' }),
      /Confirm cost V1 first/,
    );
    const beforeConfirmation = repo.get('A');
    beforeConfirmation.workspace.costVersions[0].state = 'Confirmed';
    repo.save('A', beforeConfirmation.workspace, beforeConfirmation.revision);
    assert.throws(() => complete(repo, 'A', 'EXTRA-7'), /approval/);
    complete(repo, 'A', 'EXTRA-7', { approval: 'Verified' });
    complete(repo, 'A', 'DONE');
    assert.equal(repo.workflowPlan('A').completed, true);
    assert.equal(payload(repo).selectedStep, 14);
    assert.equal(payload(repo).versionWorkflows.V1.processSteps.length, 15);
    assert.equal(
      payload(repo).processSteps.find((step) => step.code === 'EXTRA-10').state,
      'skipped',
    );
    assert.equal(
      payload(repo).workflowUpdates.find(
        (update) =>
          update.nodeCode === 'EXTRA-7' && update.action === 'complete',
      ).fields.approval,
      'Verified',
    );
  } finally {
    repo.close();
  }
});

test('workflow-only actions and publication preserve stored historical amounts even when current formulas differ', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-frozen-cost-'));
  const file = path.join(dir, 'db.sqlite');
  let repo;
  try {
    repo = openWorkspaceRepository(file);
    initialize(repo);
    const initial = repo.get('A');
    initial.workspace.costRows = structuredClone(
      initialCostRows.filter((row) => row.reTypeId !== 'rt-subcon'),
    );
    initial.workspace.subcontractCost = {
      mode: 'project',
      lines: [
        {
          id: 'SUB-ROUTER',
          code: 'SUB-ROUTER',
          description: 'Router installation',
          bu: 'Infrastructure',
          unit: 'pcs',
          currency: 'SGD',
          unitPrice: 200,
          quantities: [10, 0, 0, 0, 0],
        },
      ],
      siteTypes: [],
    };
    initial.workspace.costVersions[0].state = 'Confirmed';
    const saved = repo.save('A', initial.workspace, initial.revision);
    repo.close();
    repo = undefined;
    const frozen = structuredClone(saved.workspace);
    frozen.costRows[0].years[0].cost += 12345;
    frozen.costVersions[0].costRows = structuredClone(frozen.costRows);
    assert.notDeepEqual(
      frozen.costRows,
      recalculateCostRows(
        frozen.costRows,
        frozen.costVersions[0].resourceTypes,
        frozen.rateSettings,
      ),
    );
    const db = new DatabaseSync(file);
    const raw = JSON.stringify(frozen);
    db.prepare(
      'UPDATE workspace_snapshots SET payload_json=?,payload_sha256=? WHERE project_id=?',
    ).run(raw, createHash('sha256').update(raw).digest('hex'), 'A');
    db.close();
    repo = openWorkspaceRepository(file);
    const before = repo.get('A');
    act(repo, 'A', {
      nodeCode: 'START',
      action: 'update',
      note: 'Follow-up only',
    });
    const master = repo.globalMasterData.get('workflow');
    const steps = structuredClone(master.items);
    steps[1].name = 'Future definition change';
    const plan = repo.previewWorkflowPublication(steps, master.revision);
    repo.publishWorkflow(steps, master.revision, revisionMap(plan));
    const after = repo.get('A');
    for (const field of [
      'costVersions',
      'costRows',
      'subcontractCost',
      'resourceTypes',
      'rateSettings',
      'travelSettings',
      'travelRows',
      'manualCosts',
      'pricing',
      'quoteHistory',
      'ssr',
      'cpq',
      'costVersionLocks',
    ])
      assert.deepEqual(after.workspace[field], before.workspace[field], field);
    const invalid = structuredClone(after.workspace);
    invalid.pricing.targetGrossMargin += 1;
    assert.throws(
      () => repo.save('A', invalid, after.revision, { workflowMutation: true }),
      /cannot change/,
    );
    assert.equal(repo.get('A').revision, after.revision);
  } finally {
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backend actions enforce mandatory data and parallel joins; optional steps skip with retained evidence', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    initialize(repo);
    const before = structuredClone(payload(repo).costVersions);
    assert.throws(
      () => act(repo, 'A', { nodeCode: 'LEGAL', action: 'start' }),
      /mandatory node/,
    );
    assert.throws(() => complete(repo, 'A', 'START'), /application/);
    assert.throws(
      () =>
        act(repo, 'A', {
          nodeCode: 'START',
          action: 'complete',
          fields: { application: 'DRB-1' },
        }),
      /Explicitly confirm/,
    );
    complete(repo, 'A', 'START', { application: 'P-1' });
    act(repo, 'A', { nodeCode: 'LEGAL', action: 'start' });
    assert.equal(
      payload(repo).processSteps.filter(
        (s) => s.state === 'in_progress' && s.parallelGroup === 'REVIEWS',
      ).length,
      2,
    );
    complete(repo, 'A', 'LEGAL', { result: 'Approved' });
    assert.throws(() => complete(repo, 'A', 'DONE'), /Finance/);
    complete(repo, 'A', 'FINANCE');
    complete(repo, 'A', 'DONE');
    assert.equal(repo.workflowPlan('A').completed, true);
    assert.equal(
      payload(repo).processSteps.find((s) => s.code === 'OPTION').state,
      'skipped',
    );
    assert.deepEqual(payload(repo).costVersions, before);
    assert.equal(
      payload(repo).workflowUpdates.find(
        (e) => e.nodeCode === 'START' && e.action === 'complete',
      ).fields.application,
      'P-1',
    );
  } finally {
    repo.close();
  }
});

test('full workspace cannot forge node state, mandatory skip markers, history or template revision', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    initialize(repo);
    const record = repo.get('A');
    for (const mutation of [
      (w) => (w.processSteps[0].state = 'completed'),
      (w) => (w.processSteps[0].skippedBy = 'legacy-registration'),
      (w) => (w.processSteps[0].required = false),
      (w) => (w.workflowTemplateRevision = 999),
      (w) => w.workflowUpdates.push({ fake: true }),
    ]) {
      const w = structuredClone(record.workspace);
      mutation(w);
      assert.throws(() => repo.save('A', w, record.revision));
    }
    assert.deepEqual(repo.get('A'), record);
    const saved = act(repo, 'A', {
      nodeCode: 'START',
      action: 'update',
      note: 'Allowed server action',
    });
    assert.throws(
      () =>
        repo.applyWorkflowAction(
          'A',
          { nodeCode: 'START', action: 'update', note: 'Stale' },
          record.revision,
        ),
      /changed/,
    );
    assert.equal(repo.get('A').revision, saved.revision);
  } finally {
    repo.close();
  }
});

test('global publishing syncs future definitions, preserves active SLA by default, and explicit active migration recalculates', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    initialize(repo, ['A', 'B']);
    const before = payload(repo);
    const cost = structuredClone(before.costVersions),
      due = before.processSteps[0].dueAt,
      dueB = payload(repo, 'B').processSteps[0].dueAt;
    let master = repo.globalMasterData.get('workflow');
    let steps = structuredClone(master.items);
    steps[0].slaDays = 8;
    steps[0].name = 'Start renamed';
    steps[2].slaDays = 10;
    let plan = repo.previewWorkflowPublication(steps, master.revision);
    assert.equal(plan.projects[0].blockers.length, 0);
    repo.publishWorkflow(steps, master.revision, revisionMap(plan));
    assert.equal(payload(repo).processSteps[0].dueAt, due);
    assert.equal(payload(repo).processSteps[0].slaDays, 3);
    assert.equal(payload(repo).processSteps[0].name, 'Start renamed');
    assert.equal(
      payload(repo).processSteps.find((s) => s.code === 'LEGAL').slaDays,
      10,
    );
    assert.deepEqual(payload(repo).costVersions, cost);
    master = repo.globalMasterData.get('workflow');
    steps = structuredClone(master.items);
    plan = repo.previewWorkflowPublication(steps, master.revision, {
      migrateActiveProjectIds: ['A'],
    });
    repo.publishWorkflow(steps, master.revision, revisionMap(plan), {
      migrateActiveProjectIds: ['A'],
    });
    assert.equal(payload(repo).processSteps[0].slaDays, 8);
    assert.notEqual(payload(repo).processSteps[0].dueAt, due);
    assert.equal(payload(repo, 'B').processSteps[0].dueAt, dueB);
    master = repo.globalMasterData.get('workflow');
    const rev = repo.get('A').revision;
    repo.globalMasterData.update(
      'workflow',
      {
        upsert: [{ code: 'OPTION', name: 'Saved through compatibility path' }],
      },
      master.revision,
    );
    assert.equal(
      payload(repo).processSteps.find((s) => s.code === 'OPTION').name,
      'Saved through compatibility path',
    );
    assert.equal(repo.get('A').revision, rev + 1);
  } finally {
    repo.close();
  }
});

test('publication rejects stale project revisions and rolls back global and all projects on failure', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    initialize(repo, ['A', 'B']);
    const master = repo.globalMasterData.get('workflow');
    const steps = structuredClone(master.items);
    steps[1].name = 'Changed optional';
    let plan = repo.previewWorkflowPublication(steps, master.revision);
    act(repo, 'A', {
      nodeCode: 'START',
      action: 'update',
      note: 'Concurrent edit',
    });
    assert.throws(
      () => repo.publishWorkflow(steps, master.revision, revisionMap(plan)),
      /changed/,
    );
    assert.equal(
      repo.globalMasterData.get('workflow').revision,
      master.revision,
    );
    plan = repo.previewWorkflowPublication(steps, master.revision);
    createProject(repo, {
      id: 'C',
      name: 'Concurrent project',
      client: 'Client',
    });
    assert.throws(
      () => repo.publishWorkflow(steps, master.revision, revisionMap(plan)),
      /Project set changed/,
    );
    plan = repo.previewWorkflowPublication(steps, master.revision);
    const oldA = repo.get('A'),
      oldB = repo.get('B'),
      oldC = repo.get('C'),
      original = repo.save.bind(repo);
    let calls = 0;
    repo.save = function (...args) {
      if (++calls === 2) throw new Error('Injected later project failure');
      return original(...args);
    };
    assert.throws(
      () => repo.publishWorkflow(steps, master.revision, revisionMap(plan)),
      /Injected/,
    );
    repo.save = original;
    assert.deepEqual(repo.get('A'), oldA);
    assert.deepEqual(repo.get('B'), oldB);
    assert.deepEqual(repo.get('C'), oldC);
    assert.equal(
      repo.globalMasterData.get('workflow').revision,
      master.revision,
    );
  } finally {
    repo.close();
  }
});

for (const route of ['narrow', 'full-save'])
  test(`new Draft via ${route} adopts the latest workflow while completed history and cost snapshots stay fixed`, () => {
    const repo = openWorkspaceRepository(':memory:');
    try {
      initialize(repo);
      complete(repo, 'A', 'START', { application: 'P' });
      complete(repo, 'A', 'LEGAL', { result: 'Approved' });
      complete(repo, 'A', 'FINANCE');
      complete(repo, 'A', 'DONE');
      const completed = repo.get('A');
      const master = repo.globalMasterData.get('workflow');
      const steps = structuredClone(master.items);
      steps[0].roundStart = false;
      steps[1].name = 'Reassessment kickoff';
      steps[1].roundStart = true;
      steps[1].slaDays = 7;
      steps.splice(2, 0, {
        ...steps[0],
        code: 'NEW_CHECK',
        name: 'New mandatory check',
        requiredFields: ['assessment'],
      });
      steps.forEach((step, index) => {
        step.no = String(index + 1).padStart(2, '0');
      });
      const plan = repo.previewWorkflowPublication(steps, master.revision);
      const published = repo.publishWorkflow(
        steps,
        master.revision,
        revisionMap(plan),
      );
      assert.equal(published.updatedProjects.length, 0);
      assert.deepEqual(repo.get('A'), completed);
      if (route === 'narrow')
        createCostDraft(
          repo,
          'A',
          { mode: 'clone', sourceVersion: 'V1' },
          completed.revision,
        );
      else {
        const next = structuredClone(completed.workspace);
        next.costVersions.push({
          ...structuredClone(next.costVersions[0]),
          code: 'V2',
          state: 'Draft',
        });
        next.activeVersion = 'V2';
        repo.save('A', next, completed.revision);
      }
      const current = payload(repo);
      assert.equal(repo.workflowPlan('A').completed, false);
      assert.equal(current.workflowVersion, 'V2');
      assert.equal(current.workflowTemplateRevision, published.record.revision);
      assert.equal(current.currentWorkflowStepCode, 'OPTION');
      assert.equal(
        current.processSteps.find((step) => step.roundStart).state,
        'in_progress',
      );
      assert.equal(
        current.processSteps.find((step) => step.roundStart).slaDays,
        7,
      );
      assert.equal(
        current.processSteps.find((step) => step.code === 'NEW_CHECK').state,
        'not_started',
      );
      assert.deepEqual(
        current.versionWorkflows.V1,
        completed.workspace.versionWorkflows.V1,
      );
      assert.deepEqual(
        current.costVersions[0],
        completed.workspace.costVersions[0],
      );
      for (const field of [
        'resourceTypes',
        'costRows',
        'rateSettings',
        'travelSettings',
        'travelRows',
        'manualCosts',
        'masterDataRevision',
      ])
        assert.deepEqual(
          current.costVersions[1][field],
          completed.workspace.costVersions[0][field],
        );
      assert.deepEqual(
        current.workflowUpdates.slice(0, -1),
        completed.workspace.workflowUpdates,
      );
    } finally {
      repo.close();
    }
  });

test('CLI exposes narrow action, execution plan and publication contracts with business failures', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-cli-v8-')),
    db = path.join(dir, 'test.sqlite');
  try {
    const repo = openWorkspaceRepository(db);
    initialize(repo);
    let revision = repo.get('A').revision;
    const master = repo.globalMasterData.get('workflow');
    repo.close();
    const file = path.join(dir, 'request.json');
    const request = (data) =>
      writeFileSync(
        file,
        JSON.stringify({
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'workflow-fixture',
          data: { schemaVersion: '1.0.0', ...data },
        }),
      );
    const cli = (...args) => {
      const r = spawnSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          'cli/cost-cli.mjs',
          ...args,
          '--db',
          db,
        ],
        { encoding: 'utf8' },
      );
      return { status: r.status, body: JSON.parse(r.stdout), err: r.stderr };
    };
    request({
      operation: 'project.workflow-action',
      action: { nodeCode: 'START', action: 'complete', confirmed: true },
    });
    let r = cli(
      'project',
      'workflow-action',
      '--project-id',
      'A',
      '--input',
      file,
      '--expected-revision',
      String(revision),
    );
    assert.equal(r.status, 6, JSON.stringify(r));
    request({
      operation: 'project.workflow-action',
      action: { nodeCode: 'START', action: 'update', note: 'CLI note' },
    });
    r = cli(
      'project',
      'workflow-action',
      '--project-id',
      'A',
      '--input',
      file,
      '--expected-revision',
      String(revision),
    );
    assert.equal(r.status, 0, JSON.stringify(r));
    revision = r.body.data.revision;
    assert.equal(r.body.data.workspace, undefined);
    r = cli(
      'project',
      'get',
      '--project-id',
      'A',
      '--section',
      'workflow-plan',
    );
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(r.body.data.value.steps[0].note, 'CLI note');
    assert.equal(r.body.data.value.costRows, undefined);
    request({ operation: 'workflow.preview', steps: master.items });
    r = cli(
      'workflow',
      'preview',
      '--input',
      file,
      '--expected-revision',
      String(master.revision),
    );
    assert.equal(r.status, 0, JSON.stringify(r));
    const map = revisionMap(r.body.data);
    request({
      operation: 'workflow.publish',
      steps: master.items,
      projectRevisions: map,
    });
    r = cli(
      'workflow',
      'publish',
      '--input',
      file,
      '--expected-revision',
      String(master.revision),
    );
    assert.equal(r.status, 0, JSON.stringify(r));
    assert.equal(r.body.data.updatedProjects[0].revision, revision + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema 8 migration archives exact pre-engine records and leaves all cost and quotation evidence untouched', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-v8-migrate-')),
    file = path.join(dir, 'db.sqlite');
  try {
    let repo = openWorkspaceRepository(file);
    initialize(repo);
    const record = repo.get('A');
    repo.close();
    const legacy = structuredClone(record.workspace);
    delete legacy.workflowEngineVersion;
    for (const step of legacy.processSteps) {
      for (const key of [
        'parallelGroup',
        'slaDays',
        'slaCalendar',
        'slaHolidays',
        'reminderEnabled',
        'requiredFields',
        'roundStart',
        'requiresConfirmedCost',
        'finishesWorkflow',
        'autoSkip',
        'startedAt',
        'dueAt',
        'completedAt',
        'pausedAt',
        'fieldValues',
        'skippedBy',
      ])
        delete step[key];
    }
    legacy.processSteps = createProjectWorkflowSteps();
    legacy.currentWorkflowStepCode = 'TD_EFFORT_REVIEW';
    legacy.selectedStep = 1;
    legacy.versionWorkflows.V1.processSteps = structuredClone(
      legacy.processSteps,
    );
    legacy.versionWorkflows.V1.currentWorkflowStepCode = 'TD_EFFORT_REVIEW';
    const raw = JSON.stringify(legacy);
    let sql = new DatabaseSync(file);
    sql
      .prepare(
        'UPDATE workspace_snapshots SET payload_json=?,payload_sha256=? WHERE project_id=?',
      )
      .run(raw, createHash('sha256').update(raw).digest('hex'), 'A');
    sql.prepare('DELETE FROM schema_migrations WHERE version=8').run();
    sql.close();
    repo = openWorkspaceRepository(file);
    const result = repo.get('A');
    assert.equal(result.revision, record.revision + 1);
    assert.equal(result.workspace.workflowEngineVersion, 1);
    for (const key of [
      'costVersions',
      'costRows',
      'resourceTypes',
      'manualCosts',
      'costVersionLocks',
      'quoteHistory',
      'ssr',
      'cpq',
    ])
      assert.deepEqual(result.workspace[key], legacy[key]);
    repo.close();
    sql = new DatabaseSync(file);
    assert.equal(
      sql
        .prepare(
          'SELECT payload_json FROM workspace_migration_archive WHERE project_id=? AND revision=?',
        )
        .get('A', record.revision).payload_json,
      raw,
    );
    sql.close();
    repo = openWorkspaceRepository(file);
    assert.equal(repo.get('A').revision, result.revision);
    repo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
