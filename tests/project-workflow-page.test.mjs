/** Exercise the real focused task page and its submission controls. */
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
    if (!url.endsWith('.tsx') || url.includes('/node_modules/'))
      return nextLoad(url, context);
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      shortCircuit: true,
    };
  },
});
const {
  ProjectWorkflowPage,
  WorkflowTaskFields,
  WorkflowTaskSelect,
  workflowTaskDraft,
  workflowTaskIsDirty,
  workflowActionDraftConflicts,
  workflowTaskCanAdvance,
  selectWorkflowTask,
} = await import('../features/projects/project-workflow-page.tsx');
hooks.deregister();
const noop = () => {};
const asyncNoop = async () => {};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : React.isValidElement(node)
      ? textOf(node.props.children)
      : typeof node === 'string'
        ? node
        : '';
const step = (code, extra = {}) => ({
  code,
  name: code === 'LEGAL' ? 'Legal Review' : code,
  nameZh: '节点中文',
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
  slaDays: 3,
  slaCalendar: 'business',
  requiredFields: [],
  requiresConfirmedCost: false,
  finishesWorkflow: false,
  ...extra,
});
const workspace = () => ({
  projectId: 'PRJ-FOCUS',
  workflowEngineVersion: 1,
  workflowVersion: 'V2',
  activeVersion: 'V1',
  currentWorkflowStepCode: 'LEGAL',
  costVersions: [
    { code: 'V1', state: 'Confirmed' },
    { code: 'V2', state: 'Draft' },
  ],
  processSteps: [
    step('SCOPE', { state: 'completed' }),
    step('LEGAL', {
      state: 'in_progress',
      parallelGroup: 'Domain Review',
      requiredFields: ['Review Reference'],
    }),
    step('DELIVERY', { state: 'in_progress', parallelGroup: 'Domain Review' }),
    step('DRB', { requiresConfirmedCost: true }),
    step('QUOTE', { finishesWorkflow: true }),
  ],
  reviewGates: [],
  workflowUpdates: [],
  ssr: {
    proposalNumber: 'P-001',
    scopeBrief: 'Scope',
    companyUrl: '',
    technicalBasis: '',
    submissions: [],
  },
});
const renderPage = (w, extra = {}) =>
  renderToStaticMarkup(
    React.createElement(ProjectWorkflowPage, {
      project: { id: w.projectId, name: 'Service Project' },
      workspace: w,
      onAction: asyncNoop,
      onSaveReferences: asyncNoop,
      onBack: noop,
      onRefresh: asyncNoop,
      onOpenCost: noop,
      ...extra,
    }),
  );

test('full page puts compact references above one directly editable task with parallel navigation and history', () => {
  const w = workspace();
  const before = structuredClone(w);
  const html = renderPage(w);
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(html, /Project Workflow Page/);
  assert.match(text, /Round V2/);
  assert.doesNotMatch(text, /Round V1/);
  assert.match(html, /Domain Review · Parallel/);
  assert.equal((html.match(/aria-label="Task Owner"/g) || []).length, 1);
  assert.equal(
    (html.match(/aria-label="Task Progress Note"/g) || []).length,
    1,
  );
  assert.match(html, /Complete Step/);
  assert.match(html, /Save Update/);
  assert.match(html, /Project Workflow Info/);
  assert.match(html, /Edit Info/);
  assert.ok(
    html.indexOf('Project Workflow Info') < html.indexOf('Workflow Steps'),
  );
  assert.doesNotMatch(html, /Project References/);
  assert.match(html, /Workflow History \(Read Only\)/);
  assert.doesNotMatch(html, /role="dialog"|节点中文/);
  assert.deepEqual(w, before);
});

test('deep link picks its exact task; default and post-completion selection prefer an active parallel peer', () => {
  const w = workspace();
  assert.equal(selectWorkflowTask(w), 'LEGAL');
  assert.equal(selectWorkflowTask(w, 'DELIVERY'), 'DELIVERY');
  assert.equal(selectWorkflowTask(w, 'unknown'), 'LEGAL');
  w.processSteps[1].state = 'completed';
  assert.equal(selectWorkflowTask(w), 'DELIVERY');
  const html = renderPage(w, { focusNodeCode: 'DRB' });
  assert.match(html, /<h2[^>]*>DRB<\/h2>/);
  assert.match(html, /Confirm cost V2 first/);
  assert.match(html, /Start Step/);
  assert.doesNotMatch(html, /Complete Step/);
});

test('explicit task navigation exposes the requested editor before its documents without advancing progress', () => {
  const w = workspace();
  const before = structuredClone(w);
  const actions = [];
  const html = renderPage(w, {
    focusNodeCode: 'DELIVERY',
    navigationRequest: 1,
    onAction: async (action) => actions.push(action),
  });
  assert.match(
    html,
    /tabindex="-1" aria-label="Current workflow task: DELIVERY"/,
  );
  const editorStart = html.indexOf('Current workflow task: DELIVERY');
  const documentsStart = html.indexOf('Workflow Step Documents');
  assert.ok(editorStart >= 0 && editorStart < documentsStart);
  assert.ok(html.indexOf('Complete Step', editorStart) < documentsStart);
  assert.match(html, /<h2[^>]*>DELIVERY<\/h2>/);
  assert.deepEqual(actions, []);
  assert.deepEqual(w, before);
});

test('required completion emits only the selected action after populated evidence and explicit confirmation', async () => {
  const task = workspace().processSteps[1];
  let value = workflowTaskDraft(task);
  const requests = [];
  const controls = () =>
    walk(
      WorkflowTaskFields({
        step: task,
        value,
        onChange: (next) => {
          value = next;
        },
        onAction: async (request) => {
          requests.push(request);
        },
        onReset: noop,
      }),
    );
  const button = (label) =>
    controls().find(
      (node) =>
        textOf(node.props.children).trim() === label &&
        typeof node.props.onClick === 'function',
    );
  const field = (label) =>
    controls().find((node) => node.props['aria-label'] === label);
  assert.equal(button('Complete Step').props.disabled, true);
  button('Complete Step').props.onClick();
  assert.equal(requests.length, 0);
  field('Task Information: Review Reference').props.onChange({
    target: { value: 'DR-2026-01' },
  });
  assert.equal(button('Complete Step').props.disabled, true);
  field('Confirm Task Completion').props.onChange({
    target: { checked: true },
  });
  field('Task Progress Note').props.onChange({
    target: { value: 'Reviewed on company platform.' },
  });
  assert.equal(button('Complete Step').props.disabled, false);
  button('Complete Step').props.onClick();
  assert.deepEqual(requests, [
    {
      nodeCode: 'LEGAL',
      action: 'complete',
      owner: 'PM',
      note: 'Reviewed on company platform.',
      followUpDate: '',
      fields: { 'Review Reference': 'DR-2026-01' },
      confirmed: true,
    },
  ]);
  assert.equal(task.state, 'in_progress');
  assert.equal(task.fieldValues, undefined);
});

test('saving an incomplete progress note does not require confirmation or advance the workflow', () => {
  const task = workspace().processSteps[1];
  const value = {
    ...workflowTaskDraft(task),
    note: 'Awaiting legal response.',
  };
  let sent;
  const controls = walk(
    WorkflowTaskFields({
      step: task,
      value,
      onChange: noop,
      onAction: async (action) => {
        sent = action;
      },
      onReset: noop,
    }),
  );
  const save = controls.find(
    (node) =>
      textOf(node.props.children) === 'Save Update' && node.props.onClick,
  );
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  assert.equal(sent.action, 'update');
  assert.equal(sent.note, value.note);
  assert.equal(sent.confirmed, undefined);
  assert.equal(sent.nodeCode, 'LEGAL');
});

test('draft comparison includes unsaved evidence and confirmation, without mutating saved data', () => {
  const task = workspace().processSteps[1];
  const draft = workflowTaskDraft(task);
  assert.equal(workflowTaskIsDirty(task, draft), false);
  draft.fields['Review Reference'] = 'New evidence';
  assert.equal(workflowTaskIsDirty(task, draft), true);
  assert.equal(task.fieldValues, undefined);
  assert.equal(
    workflowTaskIsDirty(task, { ...workflowTaskDraft(task), confirmed: true }),
    true,
  );
  assert.equal(
    workflowTaskIsDirty(task, {
      ...workflowTaskDraft(task),
      reason: 'Waiting for customer',
    }),
    true,
  );
  assert.equal(workflowTaskIsDirty(task, workflowTaskDraft(task)), false);
});

test('completed task is read only and a completed round removes every action', () => {
  const w = workspace();
  w.processSteps[1] = {
    ...w.processSteps[1],
    state: 'completed',
    fieldValues: { 'Review Reference': 'FINAL-01' },
    note: 'Approved.',
  };
  let html = renderPage(w, { focusNodeCode: 'LEGAL' });
  assert.match(html, /This record is read only/);
  assert.match(html, /FINAL-01/);
  assert.match(html, /Reopen Step/);
  assert.doesNotMatch(
    html,
    /aria-label="Task Owner"|Complete Step|Save Update/,
  );
  w.processSteps.at(-1).state = 'completed';
  html = renderPage(w, { focusNodeCode: 'LEGAL' });
  assert.match(html, /Workflow complete. Reminders have stopped/);
  assert.doesNotMatch(html, /Reopen Step|More Actions/);
});

test('pending parallel start and paused resume submit current inline inputs; busy blocks each path', () => {
  for (const [state, label, action] of [
    ['not_started', 'Start Parallel Group', 'start'],
    ['paused', 'Resume Step', 'resume'],
  ]) {
    const task = step('PARALLEL', { state });
    const value = {
      ...workflowTaskDraft(task),
      owner: 'Delivery Lead',
      note: 'Latest note',
    };
    let sent;
    const props = {
      step: task,
      value,
      onChange: noop,
      onAction: async (request) => {
        sent = request;
      },
      onReset: noop,
      parallel: true,
    };
    const button = (busy) =>
      walk(WorkflowTaskFields({ ...props, busy })).find(
        (node) =>
          textOf(node.props.children).trim() === label && node.props.onClick,
      );
    button(true).props.onClick();
    assert.equal(sent, undefined);
    button(false).props.onClick();
    assert.equal(sent.action, action);
    assert.equal(sent.owner, 'Delivery Lead');
    assert.equal(sent.note, 'Latest note');
  }
});

test('narrow page uses a compact grouped selector while the long navigator is desktop-only', () => {
  const w = workspace();
  const html = renderPage(w);
  assert.match(html, /aria-label="Workflow Steps" class="hidden [^"]*lg:block/);
  assert.match(html, /lg:hidden[^>]*><label[^>]*>Workflow Step/);
  assert.match(html, /aria-label="Select Workflow Step"/);
  assert.match(html, /<optgroup label="Domain Review · Parallel">/);
  let selected;
  const before = structuredClone(w);
  const nodes = walk(
    WorkflowTaskSelect({
      steps: w.processSteps,
      selectedCode: 'LEGAL',
      dirtyCodes: ['DELIVERY'],
      onChange: (code) => {
        selected = code;
      },
    }),
  );
  const select = nodes.find((node) => node.type === 'select');
  select.props.onChange({ target: { value: 'DELIVERY' } });
  assert.equal(selected, 'DELIVERY');
  const delivery = nodes.find(
    (node) => node.type === 'option' && node.props.value === 'DELIVERY',
  );
  assert.match(textOf(delivery), /In Progress \*/);
  assert.deepEqual(w, before);
});

test('downstream completion protects an optional draft from automatic skipping, while parallel peer drafts remain usable', () => {
  const w = workspace();
  const optional = step('Optional Coordination', {
    required: false,
    autoSkip: true,
    state: 'in_progress',
  });
  w.processSteps.splice(1, 0, optional);
  const drafts = {
    [optional.code]: {
      ...workflowTaskDraft(optional),
      note: 'Unsaved customer update',
    },
    DELIVERY: {
      ...workflowTaskDraft(w.processSteps[3]),
      note: 'Unsaved peer update',
    },
  };
  assert.deepEqual(
    workflowActionDraftConflicts(
      w,
      { nodeCode: 'LEGAL', action: 'complete' },
      drafts,
    ),
    ['Optional Coordination'],
  );
  assert.deepEqual(
    workflowActionDraftConflicts(
      w,
      { nodeCode: 'LEGAL', action: 'start' },
      drafts,
    ),
    [],
  );
  drafts[optional.code] = workflowTaskDraft(optional);
  assert.deepEqual(
    workflowActionDraftConflicts(
      w,
      { nodeCode: 'LEGAL', action: 'complete' },
      drafts,
    ),
    [],
  );
  assert.equal(drafts.DELIVERY.note, 'Unsaved peer update');
});

test('mandatory predecessors disable Start and Complete while cost confirmation alone remains actionable', () => {
  const w = workspace();
  const original = structuredClone(w);
  assert.equal(workflowTaskCanAdvance(w, 'DRB'), false);
  let sent;
  const fieldsFor = (task) =>
    walk(
      WorkflowTaskFields({
        step: task,
        value: {
          ...workflowTaskDraft(task),
          note: 'Progress can still be saved',
          confirmed: true,
        },
        onChange: noop,
        onAction: async (action) => {
          sent = action;
        },
        onReset: noop,
        canAdvance: workflowTaskCanAdvance(w, task.code),
      }),
    );
  const findButton = (controls, label) =>
    controls.find(
      (node) =>
        textOf(node.props.children).trim() === label && node.props.onClick,
    );
  const pending = w.processSteps.find((task) => task.code === 'DRB');
  let controls = fieldsFor(pending);
  assert.equal(findButton(controls, 'Start Step').props.disabled, true);
  findButton(controls, 'Start Step').props.onClick();
  assert.equal(sent, undefined);
  assert.equal(findButton(controls, 'Save Update').props.disabled, false);
  findButton(controls, 'Save Update').props.onClick();
  assert.equal(sent.action, 'update');
  sent = undefined;
  controls = fieldsFor({ ...pending, state: 'in_progress' });
  assert.equal(findButton(controls, 'Complete Step').props.disabled, true);
  findButton(controls, 'Complete Step').props.onClick();
  assert.equal(sent, undefined);
  assert.deepEqual(w, original);
  w.processSteps[1].state = 'completed';
  w.processSteps[2].state = 'completed';
  assert.equal(w.costVersions[1].state, 'Draft');
  assert.equal(workflowTaskCanAdvance(w, 'DRB'), true);
  controls = fieldsFor(pending);
  assert.equal(findButton(controls, 'Start Step').props.disabled, false);
  findButton(controls, 'Start Step').props.onClick();
  assert.equal(sent.action, 'start');
  assert.equal(w.costVersions[1].state, 'Draft');
});
