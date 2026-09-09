/** Render actual cost controls without a browser or database access. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('../', import.meta.url));
// Node strips .ts natively, but TSX needs a test-only transform. Resolve only
// application modules; leave dependency resolution and production builds alone.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (
      (!url.endsWith('.tsx') && !url.endsWith('/workspace-client.ts')) ||
      url.includes('/node_modules/')
    )
      return nextLoad(url, context);
    const source = ts.transpileModule(
      readFileSync(fileURLToPath(url), 'utf8'),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    return { format: 'module', source, shortCircuit: true };
  },
});

const {
  WorkflowTemplateEditor,
  WorkflowNodeDefinitionFields,
  insertWorkflowTemplateStep,
  moveWorkflowTemplatePhase,
  moveWorkflowTemplateNode,
} = await import('../features/master-data/workflow-template-editor.tsx');
const { WorkflowPublishImpact } =
  await import('../features/master-data/workflow-publish-dialog.tsx');
const { previewWorkflowPublish, publishWorkflowTemplate } =
  await import('../features/master-data/workflow-publish-client.ts');
const {
  ProjectWorkflowExecution,
  WorkflowExecutionNode,
  WorkflowNodeActionForm,
} = await import('../features/projects/project-workflow-execution.tsx');
const { ProjectWorkflowHistory } =
  await import('../features/projects/project-workflow-dialog.tsx');
const { normalizeWorkflowDefinition, validateWorkflowTemplate } =
  await import('../features/projects/workflow-engine.ts');
hooks.deregister();
const noop = () => {};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const makeStep = (code, name, extra = {}) =>
  normalizeWorkflowDefinition({
    code,
    name,
    nameZh: '',
    no: '01',
    owner: 'PM',
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
    finishesWorkflow: false,
    requiresConfirmedCost: false,
    ...extra,
  });
const steps = () => [
  makeStep('hidden-scope-id', '范围确认', { roundStart: true }),
  makeStep('hidden-legal-id', '法务评审', { parallelGroup: '专业评审' }),
  makeStep('hidden-delivery-id', '交付评审', { parallelGroup: '专业评审' }),
  makeStep('hidden-finish-id', '完成报价', { finishesWorkflow: true }),
];

test('template node configuration edits business rules without changing identity or runtime state', () => {
  let value = makeStep('secret-stable-id', 'Technical review');
  const original = structuredClone(value);
  const change = (label, target) => {
    const nodes = walk(
      WorkflowNodeDefinitionFields({
        value,
        onChange: (next) => (value = next),
      }),
    );
    const field = nodes.find((node) => node.props['aria-label'] === label);
    assert.ok(field, label);
    field.props.onChange({ target });
  };
  change('SLA Days', { value: '5' });
  change('SLA Calendar', { value: 'calendar' });
  change('Parallel Group', { value: '专业审批' });
  change('Required Completion Fields', { value: '申请号\n评审结果' });
  change('Enable Reminders', { checked: false });
  change('New Cost Round Start', { checked: true });
  change('Require Confirmed Cost', { checked: true });
  change('Complete Workflow', { checked: true });
  assert.equal(value.code, original.code);
  assert.equal(value.state, original.state);
  assert.equal(value.slaDays, 5);
  assert.equal(value.slaCalendar, 'calendar');
  assert.equal(value.parallelGroup, '专业审批');
  assert.deepEqual(value.requiredFields, ['申请号', '评审结果']);
  assert.equal(value.reminderEnabled, false);
  assert.equal(
    value.roundStart && value.requiresConfirmedCost && value.finishesWorkflow,
    true,
  );
  const html = renderToStaticMarkup(
    React.createElement(WorkflowNodeDefinitionFields, {
      value,
      onChange: noop,
    }),
  );
  assert.doesNotMatch(html, /secret-stable-id|Code \/|内部编码/);
});

test('template preview groups adjacent parallel nodes and exposes named editing and ordering controls', () => {
  const definitions = steps();
  definitions[0].name = 'Scope Confirmation';
  definitions[0].nameZh = '范围确认';
  const original = structuredClone(definitions);
  const html = renderToStaticMarkup(
    React.createElement(WorkflowTemplateEditor, {
      steps: definitions,
      setSteps: noop,
      announce: noop,
    }),
  );
  assert.match(html, /专业评审 · Parallel/);
  assert.match(html, /aria-label="Move Up 法务评审"/);
  assert.match(html, /aria-label="Edit 交付评审"/);
  assert.match(html, /aria-label="Move Phase Up 专业评审"/);
  assert.match(html, /3 Business Days/);
  assert.match(html, /Scope Confirmation/);
  assert.doesNotMatch(html, /范围确认/);
  assert.deepEqual(definitions, original);
  assert.doesNotMatch(html, /hidden-(scope|legal|delivery|finish)-id/);
});

test('inserting a template node keeps the closing node last and every displayed position current', () => {
  const original = steps();
  const snapshot = structuredClone(original);
  const added = makeStep('new-service', '服务协调');
  const next = insertWorkflowTemplateStep(original, added);
  assert.deepEqual(
    next.map((step) => step.code),
    [
      'hidden-scope-id',
      'hidden-legal-id',
      'hidden-delivery-id',
      'new-service',
      'hidden-finish-id',
    ],
  );
  assert.deepEqual(
    next.map((step) => step.no),
    ['01', '02', '03', '04', '05'],
  );
  assert.deepEqual(original, snapshot);
  assert.doesNotThrow(() => validateWorkflowTemplate(next));
  assert.equal(insertWorkflowTemplateStep([], added)[0].no, '01');
});

test('workflow editor adds and renders fifteen nodes with enabled entry points at both ends', () => {
  const initial = steps();
  let definitions = initial;
  const original = structuredClone(initial);
  for (let index = 1; index <= 11; index++)
    definitions = insertWorkflowTemplateStep(
      definitions,
      makeStep(`extra-${index}`, `Additional Step ${index}`),
    );
  assert.equal(definitions.length, 15);
  assert.equal(definitions.at(-1).code, 'hidden-finish-id');
  assert.deepEqual(
    definitions.map((step) => step.no),
    Array.from({ length: 15 }, (_, index) =>
      String(index + 1).padStart(2, '0'),
    ),
  );
  assert.doesNotThrow(() => validateWorkflowTemplate(definitions));
  assert.deepEqual(initial, original);
  const render = (disabled = false, query = '') =>
    renderToStaticMarkup(
      React.createElement(WorkflowTemplateEditor, {
        steps: definitions,
        setSteps: noop,
        announce: noop,
        disabled,
        query,
      }),
    );
  const html = render();
  assert.match(html, /15 Steps · 14 Phases/);
  assert.equal((html.match(/aria-label="Edit /g) || []).length, 15);
  const addButtons = (markup) =>
    markup.match(
      /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Add Step<\/button>/g,
    ) || [];
  assert.equal(addButtons(html).length, 2);
  const isDisabled = (button) => /\sdisabled(?:=|[\s>])/.test(button);
  assert.ok(addButtons(html).every((button) => !isDisabled(button)));
  assert.ok(addButtons(render(true)).every(isDisabled));
  const filtered = render(false, 'Additional Step 11');
  assert.equal((filtered.match(/aria-label="Edit /g) || []).length, 1);
  assert.match(filtered, /15 Steps · 14 Phases/);
});

test('phase movement preserves parallel groups while node arrows remain inside their group', () => {
  const original = steps();
  const before = structuredClone(original);
  const codes = (value) => value.map((step) => step.code);
  const groupMoved = moveWorkflowTemplatePhase(original, 'hidden-legal-id', -1);
  assert.deepEqual(codes(groupMoved), [
    'hidden-legal-id',
    'hidden-delivery-id',
    'hidden-scope-id',
    'hidden-finish-id',
  ]);
  assert.doesNotThrow(() => validateWorkflowTemplate(groupMoved));
  assert.deepEqual(
    codes(moveWorkflowTemplateNode(original, 'hidden-scope-id', 1)),
    codes(groupMoved),
  );
  const peersMoved = moveWorkflowTemplateNode(original, 'hidden-legal-id', 1);
  assert.deepEqual(codes(peersMoved), [
    'hidden-scope-id',
    'hidden-delivery-id',
    'hidden-legal-id',
    'hidden-finish-id',
  ]);
  assert.doesNotThrow(() => validateWorkflowTemplate(peersMoved));
  assert.deepEqual(
    peersMoved.map((step) => step.no),
    ['01', '02', '03', '04'],
  );
  assert.equal(
    moveWorkflowTemplateNode(original, 'hidden-legal-id', -1),
    original,
  );
  assert.equal(
    moveWorkflowTemplateNode(original, 'hidden-delivery-id', 1),
    original,
  );
  assert.equal(
    moveWorkflowTemplatePhase(original, 'hidden-legal-id', 1),
    original,
  );
  assert.equal(
    moveWorkflowTemplatePhase(original, 'hidden-finish-id', -1),
    original,
  );
  assert.equal(
    moveWorkflowTemplateNode(original, 'hidden-scope-id', -1),
    original,
  );
  assert.deepEqual(original, before);
});

test('execution shows simultaneous active nodes, SLA urgency and business fields without editable stage dropdowns', () => {
  const flow = steps();
  flow[0].state = 'completed';
  for (const step of flow.slice(1, 3))
    Object.assign(step, {
      state: 'in_progress',
      startedAt: '2000-01-01T01:00:00Z',
      dueAt: '2000-01-03T10:00:00Z',
    });
  flow[1].fieldValues = { 申请号: 'LEGAL-2026-01' };
  const w = {
    workflowEngineVersion: 1,
    processSteps: flow,
    activeVersion: 'V1',
    costVersions: [{ code: 'V1', state: 'Confirmed' }],
  };
  const html = renderToStaticMarkup(
    React.createElement(ProjectWorkflowExecution, {
      workspace: w,
      onAction: async () => {},
    }),
  );
  assert.equal((html.match(/>Complete<\/button>/g) || []).length, 2);
  assert.equal((html.match(/Urgent Follow-up/g) || []).length, 2);
  assert.match(html, /LEGAL-2026-01/);
  assert.match(html, /专业评审 · Parallel/);
  assert.doesNotMatch(html, /<select|hidden-legal-id|hidden-delivery-id/);
  const finished = renderToStaticMarkup(
    React.createElement(WorkflowExecutionNode, {
      step: {
        ...flow[1],
        state: 'completed',
        fieldValues: { 申请号: 'KEPT-001' },
      },
      onAction: async () => {},
    }),
  );
  assert.match(finished, /KEPT-001/);
  assert.doesNotMatch(finished, />Complete<\/button>|>Skip<|>Update</);
});

test('publication preview keeps active SLA migration opt-in and completed projects immutable', () => {
  const project = (id, completed = false) => ({
    projectId: id,
    name: `Project ${id}`,
    revision: 3,
    completed,
    changed: !completed,
    changes: [],
    blockers: [],
    retained: ['已开始节点保留原时限'],
    steps: [],
  });
  const preview = {
    revision: 8,
    nextRevision: 9,
    projects: [project('active'), project('closed', true)],
  };
  let selected;
  const tree = WorkflowPublishImpact({
    preview,
    migratedIds: [],
    onMigrationChange: (ids) => (selected = ids),
  });
  const checkboxes = walk(tree).filter((node) => node.type === 'input');
  assert.equal(checkboxes.length, 1);
  assert.equal(checkboxes[0].props.checked, false);
  checkboxes[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(selected, ['active']);
  const html = renderToStaticMarkup(
    React.createElement(WorkflowPublishImpact, {
      preview,
      migratedIds: [],
      onMigrationChange: noop,
    }),
  );
  assert.match(html, /Project closed/);
  assert.match(
    html,
    /Leave unchecked to retain the original deadlines for active steps/,
  );
});

test('publication transport carries the preview revision and only explicit active migration selection', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(
      JSON.stringify({
        ok: true,
        data: { revision: 8, nextRevision: 9, projects: [] },
      }),
      { status: 200 },
    );
  });
  const draft = { steps: steps(), expectedRevision: 8 };
  await previewWorkflowPublish(draft);
  await publishWorkflowTemplate(
    { ...draft, migrateActiveProjectIds: ['active'] },
    { active: 12 },
  );
  assert.equal(calls[0].body.kind, 'WorkflowPublishPreviewRequest');
  assert.equal(calls[0].body.migrateActiveProjectIds, undefined);
  assert.equal(calls[1].body.kind, 'WorkflowPublishRequest');
  assert.equal(calls[1].body.expectedRevision, 8);
  assert.deepEqual(calls[1].body.projectRevisions, { active: 12 });
  assert.deepEqual(calls[1].body.migrateActiveProjectIds, ['active']);
  assert.match(calls[1].url, /\/workflow\/publish$/);
  assert.ok(calls.every((call) => call.options.method === 'POST'));
  assert.equal(draft.migrateActiveProjectIds, undefined);
});

test('workflow history retains the originally confirmed fields and SLA after a node is reopened', () => {
  const w = {
    processSteps: steps(),
    reviewGates: [],
    workflowUpdates: [
      {
        id: 'event-1',
        costVersion: 'V1',
        fromStepCode: 'hidden-legal-id',
        toStepCode: 'hidden-legal-id',
        owner: 'PM',
        followUpDate: '',
        note: '原确认',
        updatedAt: '2026-01-03T08:00:00Z',
        action: 'complete',
        fields: { 申请号: 'ORIGINAL-001' },
        startedAt: '2026-01-01T01:00:00Z',
        dueAt: '2026-01-04T10:00:00Z',
      },
    ],
  };
  w.processSteps[1].fieldValues = { 申请号: 'NEW-002' };
  const html = renderToStaticMarkup(
    React.createElement(ProjectWorkflowHistory, { workspace: w }),
  );
  assert.match(html, /ORIGINAL-001/);
  assert.match(html, /2026-01-04T10:00:00Z/);
  assert.match(html, /Confirm Completion/);
  assert.doesNotMatch(html, /NEW-002|hidden-legal-id|<input/);
});

test('historical node names follow each event and review cost version after later rounds rename the same nodes', () => {
  const cycle = (name) => ({
    processSteps: [
      makeStep('shared-node', name),
      makeStep('previous-node', `${name}前置`),
    ],
  });
  const workspace = {
    processSteps: cycle('V2新版名称').processSteps,
    versionWorkflows: { V1: cycle('V1原始名称') },
    legacyWorkflowArchive: { V0: cycle('迁移前名称') },
    deletedCostVersions: { V3: { workflow: cycle('删除版本名称') } },
    workflowUpdates: ['V1', 'V0', 'V3'].map((costVersion) => ({
      id: costVersion,
      costVersion,
      fromStepCode: 'previous-node',
      toStepCode: 'shared-node',
      owner: 'PM',
      updatedAt: '2026-01-03T08:00:00Z',
      note: '',
      followUpDate: '',
    })),
    reviewGates: [
      {
        id: 'old-review',
        costVersion: 'V1',
        workflowStepCode: 'shared-node',
        gate: 'Review',
        gateZh: '原评审',
        owner: 'PM',
        status: 'completed',
        lastUpdatedAt: '2026-01-03T08:00:00Z',
        followUps: [],
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(ProjectWorkflowHistory, { workspace }),
  );
  for (const name of ['V1原始名称', '迁移前名称', '删除版本名称']) {
    assert.match(html, new RegExp(name));
    assert.match(html, new RegExp(`From: ${name}前置`));
  }
  assert.match(html, /Workflow: V1原始名称/);
  assert.doesNotMatch(html, /V2新版名称|shared-node|previous-node/);

  const fallback = renderToStaticMarkup(
    React.createElement(ProjectWorkflowHistory, {
      workspace: {
        ...workspace,
        workflowUpdates: [
          { ...workspace.workflowUpdates[0], costVersion: 'V9' },
        ],
        reviewGates: [],
      },
    }),
  );
  assert.match(fallback, /V2新版名称/);
  assert.doesNotMatch(fallback, /V1原始名称|迁移前名称|删除版本名称/);
});

test('skipped node timestamps are presented as skipped rather than completed work', () => {
  const render = (state) =>
    renderToStaticMarkup(
      React.createElement(WorkflowExecutionNode, {
        step: makeStep('past-node', '历史节点', {
          state,
          completedAt: '2026-01-03T08:00:00Z',
        }),
        onAction: async () => {},
      }),
    );
  const skipped = render('skipped');
  assert.match(skipped, /Skipped/);
  assert.match(skipped, /Skipped at/);
  assert.doesNotMatch(skipped, /Completed at|Completion Record|Completed/);
  const completed = render('completed');
  assert.match(completed, /Completed at/);
  assert.doesNotMatch(completed, /Skipped at|Completion Record/);
});

test('actual required-node form emits completion only after information and explicit confirmation', () => {
  const step = makeStep('node-required', 'DRB', {
    state: 'in_progress',
    requiredFields: ['申请号'],
  });
  let value = {
    owner: 'PM',
    note: '公司平台核对完成',
    followUpDate: '',
    fields: { 旧模板字段: '只保留历史' },
    confirmed: false,
    reason: '',
  };
  const requests = [];
  const render = (busy = false) =>
    WorkflowNodeActionForm({
      step,
      action: 'complete',
      value,
      onChange: (next) => (value = next),
      onSubmit: (request) => requests.push(request),
      onCancel: noop,
      busy,
    });
  const control = (label) =>
    walk(render()).find((node) => node.props['aria-label'] === label);
  const submit = (busy = false) =>
    walk(render(busy)).find(
      (node) => node.props.children === 'Confirm Completion',
    );
  assert.equal(submit().props.disabled, true);
  submit().props.onClick();
  assert.deepEqual(requests, []);
  control('Step Information: 申请号').props.onChange({
    target: { value: 'DRB-REAL-001' },
  });
  assert.equal(submit().props.disabled, true);
  control('Confirm Required Step Completion').props.onChange({
    target: { checked: true },
  });
  assert.equal(submit().props.disabled, false);
  submit(true).props.onClick();
  assert.deepEqual(requests, []);
  submit().props.onClick();
  assert.deepEqual(requests, [
    {
      nodeCode: 'node-required',
      action: 'complete',
      owner: 'PM',
      note: '公司平台核对完成',
      followUpDate: '',
      fields: { 申请号: 'DRB-REAL-001' },
      confirmed: true,
    },
  ]);
});

test('actual pause form requires a reason and resumption date without claiming node completion', () => {
  const step = makeStep('node-pause', '专业评审', { state: 'in_progress' });
  let value = {
    owner: 'Legal',
    note: '',
    followUpDate: '',
    fields: {},
    confirmed: false,
    reason: '',
  };
  const requests = [];
  const render = () =>
    WorkflowNodeActionForm({
      step,
      action: 'pause',
      value,
      onChange: (next) => (value = next),
      onSubmit: (request) => requests.push(request),
      onCancel: noop,
    });
  const control = (label) =>
    walk(render()).find((node) => node.props['aria-label'] === label);
  const submit = () =>
    walk(render()).find((node) => node.props.children === 'Confirm Pause');
  control('Action Reason').props.onChange({
    target: { value: ' 等待客户确认Scope ' },
  });
  assert.equal(submit().props.disabled, true);
  submit().props.onClick();
  assert.deepEqual(requests, []);
  control('Step Follow-up Date').props.onChange({
    target: { value: '2099-01-01' },
  });
  assert.equal(submit().props.disabled, false);
  submit().props.onClick();
  assert.deepEqual(requests, [
    {
      nodeCode: 'node-pause',
      action: 'pause',
      owner: 'Legal',
      note: '',
      followUpDate: '2099-01-01',
      fields: {},
      reason: '等待客户确认Scope',
    },
  ]);
  assert.equal(requests[0].confirmed, undefined);
});
