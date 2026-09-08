import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkflowDistribution,
  currentProjectWorkflowNodeCodes,
} from '../features/overview/workflow-distribution.ts';
const step = (code, name = code, extra = {}) => ({
  code,
  name,
  nameZh: '',
  no: '01',
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
  ...extra,
});
const project = (id, steps, revision = 1) => ({
  id,
  workflowEngineVersion: 1,
  workflowTemplateRevision: revision,
  workflowSteps: steps,
  currentWorkflowStepCode: steps[0]?.code,
});

test('published labels and order override stale project copies without editing their history', () => {
  const active = project(
    'active',
    [
      step('A', 'Old A', { state: 'in_progress' }),
      step('B', 'Old B'),
      step('OBSOLETE', 'Unused old step'),
    ],
    1,
  );
  const completed = project(
    'completed',
    [
      step('A', 'Even older A', { state: 'completed' }),
      step('END', 'Historical end', {
        state: 'completed',
        finishesWorkflow: true,
      }),
    ],
    1,
  );
  const before = structuredClone([active, completed]);
  const definitions = [
    step('B', 'New B'),
    step('ADDED', 'New node'),
    step('A', 'New A'),
    step('END', 'Current end'),
  ];
  const result = buildWorkflowDistribution([active, completed], definitions);
  assert.deepEqual(
    result.nodes.map((entry) => [
      entry.step.code,
      entry.step.name,
      entry.count,
    ]),
    [
      ['B', 'New B', 0],
      ['ADDED', 'New node', 0],
      ['A', 'New A', 1],
      ['END', 'Current end', 1],
    ],
  );
  assert.deepEqual(result.retained, []);
  assert.deepEqual([active, completed], before);
});

test('published definitions render even with no projects; search never changes the node list', () => {
  const defs = [step('A'), step('B')];
  assert.deepEqual(
    buildWorkflowDistribution([], defs).nodes.map((e) => [
      e.step.code,
      e.count,
    ]),
    [
      ['A', 0],
      ['B', 0],
    ],
  );
});

test('parallel active, paused, next-stage and completed counts follow recorded execution using stable IDs', () => {
  const defs = [
    step('A', 'Published A', { parallelGroup: 'Review' }),
    step('B', 'Published B', { parallelGroup: 'Review' }),
    step('END'),
  ];
  const parallel = project('p1', [
    step('A', 'Old A', { state: 'in_progress' }),
    step('B', 'Old B', { state: 'paused' }),
  ]);
  const ready = project('p2', [
    step('A', 'A', { state: 'completed' }),
    step('B'),
    step('END'),
  ]);
  const finished = project('p3', [
    step('END', 'Old end', { state: 'completed', finishesWorkflow: true }),
  ]);
  const result = buildWorkflowDistribution([parallel, ready, finished], defs);
  assert.deepEqual(
    result.nodes.map((e) => e.count),
    [1, 2, 1],
  );
  assert.deepEqual(currentProjectWorkflowNodeCodes(ready), ['B']);
  assert.deepEqual(result.nodes[1].projectIds, ['p1', 'p2']);
});

test('removed nodes remain separate only when they still carry actual current or completed progress', () => {
  const p = project('old', [
    step('GONE', 'Recorded final', {
      state: 'completed',
      finishesWorkflow: true,
    }),
    step('UNUSED'),
  ]);
  const result = buildWorkflowDistribution([p], [step('NEW')]);
  assert.deepEqual(
    result.nodes.map((e) => e.step.code),
    ['NEW'],
  );
  assert.deepEqual(
    result.retained.map((e) => [e.step.code, e.count]),
    [['GONE', 1]],
  );
  assert.deepEqual(p.workflowSteps[0].name, 'Recorded final');
});
