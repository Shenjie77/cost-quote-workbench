import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  createCostDraft,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { createProjectWorkflowSteps } from '../features/projects/workflow-domain.ts';
import {
  applyWorkflowTemplate,
  migrateWorkflowEngine,
  normalizeWorkflowDefinition,
  previewWorkflowSync,
} from '../features/projects/workflow-engine.ts';

const retiredCodes = [
  'RATE_CONTRACT_IMPORT',
  'DIMENSION_CHECK',
  'COST_BASELINE_APPROVAL',
  'PRICING',
  'QUOTE_PACKAGE',
  'COMMERCIAL_ARCHIVE',
];
const node = (code, patch = {}) =>
  normalizeWorkflowDefinition({
    ...createProjectWorkflowSteps()[0],
    code,
    name: code,
    nameZh: '',
    roundStart: false,
    requiresConfirmedCost: false,
    finishesWorkflow: false,
    ...patch,
  });
const configuredTemplate = () =>
  [
    node('SOLUTION_SCOPE', { name: 'Solution Proposal' }),
    node('TD_EFFORT_REVIEW', {
      name: 'TD ManDay Effort & Subcon',
      roundStart: true,
    }),
    node('DELIVERY_REVIEW', { name: 'DTRB' }),
    node('RATE_CONTRACT_IMPORT', { name: 'Cost Summary', slaDays: 5 }),
    node('COST_BUILD', {
      name: 'DRB',
      requiresConfirmedCost: true,
      requiredFields: ['Review result'],
    }),
    node('DIMENSION_CHECK', { name: 'Pricing', reminderEnabled: false }),
    node('COST_BASELINE_APPROVAL', { name: 'Functional Review' }),
    node('PRICING', { name: 'Pricing Decision', finishesWorkflow: true }),
  ].map((step, index) => ({
    ...step,
    no: String(index + 1).padStart(2, '0'),
  }));
const blank = () =>
  createBlankWorkspace(
    projectRecord('INITIALIZATION', 'Workflow initialization', 'Client'),
    'input_preparation',
  );

test('migration retains explicitly configured nodes even when their stable codes were retired by the legacy tool', () => {
  const w = blank();
  w.processSteps = [
    node('START', { roundStart: true }),
    ...retiredCodes.map((code, index) =>
      node(code, { finishesWorkflow: index === retiredCodes.length - 1 }),
    ),
  ];
  w.currentWorkflowStepCode = 'START';
  const original = structuredClone(w);
  const migrated = migrateWorkflowEngine(w, '2026-09-08T01:00:00.000Z');
  assert.deepEqual(
    migrated.processSteps.map((step) => step.code),
    ['START', ...retiredCodes],
  );
  for (const step of migrated.processSteps.slice(1)) {
    assert.equal(step.roundStart, false);
    assert.equal(step.requiresConfirmedCost, false);
    assert.equal(step.state, 'not_started');
  }
  assert.equal(migrated.processSteps.at(-1).finishesWorkflow, true);
  assert.deepEqual(w, original);
});

test('unconfigured legacy migration still removes pending tool nodes and retains current and completed evidence', () => {
  const w = blank();
  const legacy = (code, state = 'not_started') => ({
    ...createProjectWorkflowSteps()[0],
    code,
    name: code,
    state,
  });
  w.processSteps = [
    legacy('SOLUTION_SCOPE'),
    legacy('RATE_CONTRACT_IMPORT', 'completed'),
    legacy('DIMENSION_CHECK'),
    legacy('COST_BASELINE_APPROVAL'),
    legacy('PRICING'),
    legacy('QUOTE_PACKAGE'),
    legacy('COMMERCIAL_ARCHIVE'),
  ];
  w.currentWorkflowStepCode = 'PRICING';
  const migrated = migrateWorkflowEngine(w, '2026-09-08T01:00:00.000Z');
  assert.deepEqual(
    migrated.processSteps.map((step) => step.code),
    ['SOLUTION_SCOPE', 'RATE_CONTRACT_IMPORT', 'PRICING'],
  );
  assert.equal(migrated.processSteps[1].state, 'completed');
  assert.equal(migrated.currentWorkflowStepCode, 'PRICING');
});

test('new projects and later cost rounds capture every published node, rule and finish regardless of code', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const template = configuredTemplate();
    const published = repo.publishWorkflow(
      template,
      repo.globalMasterData.get('workflow').revision,
      {},
    ).record;
    createProject(repo, {
      id: 'NEW-PROJECT',
      name: 'New project',
      client: 'Client',
    });
    const initial = repo.get('NEW-PROJECT');
    const expected = template.map((step) => step.code);
    const verify = (w, version) => {
      assert.equal(w.workflowEngineVersion, 1);
      assert.equal(w.workflowTemplateRevision, published.revision);
      assert.equal(w.workflowVersion, version);
      assert.equal(w.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
      assert.deepEqual(
        w.processSteps.map((step) => step.code),
        expected,
      );
      assert.deepEqual(
        w.versionWorkflows[version].processSteps,
        w.processSteps,
      );
      for (const [index, step] of w.processSteps.entries())
        for (const field of [
          'name',
          'no',
          'roundStart',
          'requiresConfirmedCost',
          'finishesWorkflow',
          'requiredFields',
          'slaDays',
          'reminderEnabled',
        ])
          assert.deepEqual(step[field], published.items[index][field]);
      assert.equal(w.processSteps.at(-1).finishesWorkflow, true);
    };
    verify(initial.workspace, 'V1');
    createCostDraft(
      repo,
      'NEW-PROJECT',
      { mode: 'clone', sourceVersion: 'V1' },
      initial.revision,
    );
    const next = repo.get('NEW-PROJECT').workspace;
    verify(next, 'V2');
    assert.deepEqual(next.costVersions[0], initial.workspace.costVersions[0]);
    assert.deepEqual(
      next.versionWorkflows.V1,
      initial.workspace.versionWorkflows.V1,
    );
  } finally {
    repo.close();
  }
});

test('targeted template sync repairs missing pending nodes without changing active progress or any cost data', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const published = repo.publishWorkflow(
      configuredTemplate(),
      repo.globalMasterData.get('workflow').revision,
      {},
    ).record;
    createProject(repo, {
      id: 'TRUNCATED-PROJECT',
      name: 'Truncated project',
      client: 'Client',
      reviewOwner: 'Assigned SSR',
    });
    const created = repo.get('TRUNCATED-PROJECT');
    const truncated = structuredClone(created.workspace);
    truncated.processSteps = truncated.processSteps.filter(
      (step) => !retiredCodes.includes(step.code),
    );
    truncated.versionWorkflows.V1.processSteps = structuredClone(
      truncated.processSteps,
    );
    const before = repo.save('TRUNCATED-PROJECT', truncated, created.revision, {
      workflowMutation: true,
    });
    const captured = before.workspace.legacyWorkflowArchive.V1.processSteps;
    const plan = previewWorkflowSync(before.workspace, captured);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.steps.length, 8);
    const repaired = applyWorkflowTemplate(
      before.workspace,
      captured,
      published.revision,
    );
    const saved = repo.save('TRUNCATED-PROJECT', repaired, before.revision, {
      workflowMutation: true,
    });
    assert.equal(saved.workspace.processSteps.length, 8);
    for (const step of before.workspace.processSteps)
      assert.deepEqual(
        saved.workspace.processSteps.find((next) => next.code === step.code),
        step,
      );
    assert.ok(
      saved.workspace.processSteps.every(
        (step) => step.owner === 'Assigned SSR',
      ),
    );
    const allowed = new Set([
      'processSteps',
      'versionWorkflows',
      'workflowUpdates',
      'selectedStep',
    ]);
    for (const [field, value] of Object.entries(before.workspace))
      if (!allowed.has(field))
        assert.deepEqual(saved.workspace[field], value, field);
    assert.equal(
      saved.workspace.workflowUpdates.at(-1).action,
      'template_sync',
    );
    assert.equal(
      repo.globalMasterData.get('workflow').revision,
      published.revision,
    );
  } finally {
    repo.close();
  }
});
