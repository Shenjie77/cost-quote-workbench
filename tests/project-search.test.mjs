/** Search follows current workflow evidence and never mutates the supplied portfolio. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  searchProjects,
  projectWorkflowSearchInfo,
} from '../features/workbench/project-search-model.ts';

/** Synthetic workflow snapshots exercise current, future and historical phases without persisted data. */
const step = (code, name, overrides = {}) => ({
  code,
  name,
  nameZh: '',
  no: '01',
  owner: 'Reviewer',
  state: 'not_started',
  tone: 'gray',
  date: '',
  dateZh: '',
  detail: '',
  detailZh: '',
  input: '',
  inputZh: '',
  required: true,
  roundStart: false,
  ...overrides,
});
const project = (id, overrides = {}) => ({
  id,
  name: `Project ${id}`,
  nameZh: '',
  client: 'Client Alpha',
  clientZh: '客户甲',
  version: 'V3',
  workflowEngineVersion: 1,
  workflowSteps: [],
  ...overrides,
});
const ids = (projects, query) =>
  searchProjects(projects, query).map((item) => item.id);

test('proposal number, project names, clients, IDs and versions match case/full-width queries without changing order or records', () => {
  const projects = [
    project('first', {
      name: 'North Station',
      nameZh: '北站项目',
      proposalNumber: 'QT-2026-42',
    }),
    project('second', { proposalNumber: 'QT-2026-77' }),
  ];
  const before = structuredClone(projects);
  for (const query of [
    'qt-2026-42',
    'ＱＴ－２０２６－４２',
    'north station',
    '北站',
    'first',
  ])
    assert.deepEqual(ids(projects, query), ['first']);
  assert.deepEqual(ids(projects, 'Client Alpha V3'), ['first', 'second']);
  assert.deepEqual(ids(projects, '客户甲'), ['first', 'second']);
  assert.deepEqual(ids(projects, 'QT-2026-77 project'), ['second']);
  assert.deepEqual(ids(projects, '   '), ['first', 'second']);
  assert.notEqual(searchProjects(projects, ''), projects);
  assert.deepEqual(projects, before);
});

test('parallel active nodes expose names, codes and bilingual states, excluding completed history and later stages', () => {
  const projects = [
    project('parallel', {
      currentWorkflowStepCode: 'HISTORIC',
      workflowSteps: [
        step('HISTORIC', 'Original scope', {
          state: 'completed',
          nameZh: '历史范围',
        }),
        step('TD_CHECK', 'Technical assessment', {
          state: 'in_progress',
          nameZh: '技术分析',
          parallelGroup: 'Review',
        }),
        step('DRB', 'Delivery review', {
          state: 'awaiting_review',
          nameZh: '交付评审',
          parallelGroup: 'Review',
        }),
        step('QUOTE_END', 'Future quotation'),
      ],
    }),
  ];
  for (const query of [
    'TD_CHECK',
    'technical',
    '技术分析',
    'DRB',
    '交付评审',
    'in progress',
    'in_progress',
    'awaiting review',
    '待评审',
  ])
    assert.deepEqual(ids(projects, query), ['parallel']);
  for (const query of [
    'Original scope',
    'HISTORIC',
    '历史范围',
    'Future quotation',
    'QUOTE_END',
    '已完成',
  ])
    assert.deepEqual(ids(projects, query), []);
  const summary = projectWorkflowSearchInfo(projects[0]).summary;
  assert.match(summary, /Technical assessment \/ 技术分析/);
  assert.match(summary, /Delivery review \/ 交付评审/);
});

test('the next ready parallel phase is searchable before it starts, while later not-started phases remain excluded', () => {
  const projects = [
    project('ready', {
      currentWorkflowStepCode: 'DONE',
      workflowSteps: [
        step('DONE', 'Recorded history', { state: 'completed' }),
        step('SKIP', 'Optional history', { state: 'skipped' }),
        step('A', 'Security approval', { parallelGroup: 'Gate' }),
        step('B', 'Delivery approval', { parallelGroup: 'Gate' }),
        step('LATER', 'Commercial release'),
      ],
    }),
  ];
  assert.deepEqual(ids(projects, 'security'), ['ready']);
  assert.deepEqual(ids(projects, 'delivery'), ['ready']);
  assert.deepEqual(ids(projects, '未开始'), ['ready']);
  assert.deepEqual(ids(projects, 'Commercial release'), []);
  assert.deepEqual(ids(projects, 'Recorded history'), []);
});

test('project holds override node states while node-level pauses remain current searchable work', () => {
  const held = project('held', {
    workflowHold: { startedAt: '2026-09-11T01:00:00Z' },
    workflowSteps: [
      step('CHECK', 'Contract review', { state: 'awaiting_review' }),
    ],
  });
  const paused = project('paused', {
    workflowSteps: [step('CHECK', 'Cost review', { state: 'paused' })],
  });
  for (const query of ['paused', '已暂停'])
    assert.deepEqual(ids([held, paused], query), ['held', 'paused']);
  assert.deepEqual(ids([held, paused], 'on hold'), ['held']);
  assert.deepEqual(ids([held], 'Contract review'), ['held']);
  assert.deepEqual(ids([held], 'awaiting review'), []);
});

test('completion uses configured finish evidence and does not leak history or stale manual completed status into reopened projects', () => {
  const completed = project('finished', {
    workflowSteps: [
      step('OLD', 'Historic design', { state: 'completed' }),
      step('FINISH', 'Quotation issued', {
        state: 'completed',
        finishesWorkflow: true,
        nameZh: '报价结束',
      }),
    ],
  });
  const reopened = project('reopened', {
    projectStatus: 'completed',
    stage: 'Completed',
    stageZh: '已完成',
    workflowSteps: [step('NEW', 'New scope', { state: 'blocked' })],
  });
  assert.deepEqual(ids([completed, reopened], 'completed'), ['finished']);
  assert.deepEqual(ids([completed, reopened], '报价结束'), ['finished']);
  assert.deepEqual(ids([completed, reopened], 'Historic design'), []);
  assert.deepEqual(ids([completed, reopened], 'blocked'), ['reopened']);
  assert.deepEqual(ids([completed, reopened], '已阻塞'), ['reopened']);
});

test('legacy status-only records remain searchable without treating a selected historical completed node as current work', () => {
  const legacy = project('legacy', {
    workflowEngineVersion: undefined,
    projectStatus: 'costing',
    statusDefinitions: [
      { code: 'costing', name: 'Costing', nameZh: '成本编制', active: true },
    ],
  });
  const historical = project('historic', {
    workflowEngineVersion: undefined,
    currentWorkflowStepCode: 'PAST',
    workflowSteps: [step('PAST', 'Past assessment', { state: 'completed' })],
  });
  assert.deepEqual(ids([legacy], '成本编制'), ['legacy']);
  assert.deepEqual(ids([historical], 'Past assessment'), []);
  assert.match(
    projectWorkflowSearchInfo(historical).summary,
    /No current workflow/,
  );
  const legacyCompleted = { ...historical, projectStatus: 'completed' };
  assert.deepEqual(ids([legacyCompleted], '已完成'), ['historic']);
  assert.deepEqual(ids([legacyCompleted], 'Past assessment'), []);
  assert.deepEqual(ids([legacyCompleted], 'PAST'), []);
  assert.equal(
    projectWorkflowSearchInfo(legacyCompleted).summary,
    'Completed / 已完成',
  );
});
