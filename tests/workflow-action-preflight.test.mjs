import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  migrateWorkflowEngine,
  normalizeWorkflowDefinition,
  applyWorkflowAction,
} from '../features/projects/workflow-engine.ts';
import { preflightWorkflowAction } from '../features/projects/workflow-action-preflight.ts';
const now = '2026-09-07T01:00:00Z';
function fixture() {
  const w = createBlankWorkspace(
    projectRecord('PREFLIGHT', 'Preflight', 'Client'),
    'input_preparation',
  );
  w.processSteps = ['scope', 'DRB', 'done'].map((code, index) =>
    normalizeWorkflowDefinition({
      code,
      no: String(index + 1),
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
      required: true,
      roundStart: index === 0,
      finishesWorkflow: index === 2,
      requiresConfirmedCost: index > 0,
    }),
  );
  w.currentWorkflowStepCode = 'scope';
  return migrateWorkflowEngine(w, now);
}
test('invalid prerequisites fail before presenting a cost confirmation and never change the draft', () => {
  const w = fixture(),
    original = structuredClone(w);
  assert.throws(
    () => preflightWorkflowAction(w, { nodeCode: 'DRB', action: 'start' }, now),
    /mandatory node/,
  );
  assert.deepEqual(w, original);
  assert.equal(w.costVersions[0].state, 'Draft');
});
test('valid operation requests cost confirmation only for its actual workflow round', () => {
  let w = fixture();
  w = applyWorkflowAction(
    w,
    { nodeCode: 'scope', action: 'complete', confirmed: true },
    now,
  );
  const result = preflightWorkflowAction(
    w,
    { nodeCode: 'DRB', action: 'start' },
    now,
  );
  assert.equal(result.needsCostConfirmation, true);
  assert.equal(result.versionCode, w.workflowVersion || w.activeVersion);
  assert.equal(w.costVersions[0].state, 'Draft');
  assert.equal(w.processSteps[1].state, 'not_started');
  w.costVersions[0].state = 'Confirmed';
  assert.equal(
    preflightWorkflowAction(w, { nodeCode: 'DRB', action: 'start' }, now)
      .needsCostConfirmation,
    false,
  );
});
