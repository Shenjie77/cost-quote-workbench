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

const { OverviewView, WorkflowDistributionNodes } =
  await import('../features/overview/overview-view.tsx');
const { AgentView } = await import('../features/agent/agent-view.tsx');
const { projects } = await import('../features/projects/demo-data.ts');
hooks.deregister();
const noop = () => {};
// Scope distribution assertions to the widget now that it precedes the portfolio.
const distributionMarkup = (html) => {
  const start = html.indexOf('aria-label="Project Workflow Distribution"');
  assert.ok(start >= 0);
  return html.slice(start, html.indexOf('</section>', start));
};
const step = (code, extra = {}) => ({
  code,
  no: '01',
  name: code,
  nameZh: `${code} 项`,
  owner: 'PM',
  state: 'in_progress',
  tone: 'blue',
  date: '',
  dateZh: '',
  detail: '',
  detailZh: '',
  input: '',
  inputZh: '',
  required: false,
  reminderEnabled: true,
  startedAt: '2000-01-01T00:00:00Z',
  dueAt: '2100-01-01T00:00:00Z',
  ...extra,
});
const p = () => ({
  ...projects[0],
  id: 'PARALLEL-UI',
  name: 'Parallel Delivery',
  workflowMode: 'project',
  workflowEngineVersion: 1,
  workflowVersion: 'V2',
  currentWorkflowStepCode: 'NORMAL',
  workflowSteps: [
    step('NORMAL'),
    step('URGENT', { dueAt: '2000-01-02T00:00:00Z' }),
    step('MUTED', { reminderEnabled: false }),
  ],
});
const props = (project) => ({
  projects: [project],
  reviews: [],
  setView: noop,
  setPanel: noop,
  onSelectProject: noop,
  onOpenCost: noop,
  onOpenQuote: noop,
  onTrackWorkflow: noop,
});

test('Today counts parallel tasks as one project and expands its highest urgency group', () => {
  const html = renderToStaticMarkup(
    React.createElement(OverviewView, props(p())),
  );
  assert.equal(
    (html.match(/data-workflow-project-group="PARALLEL-UI"/g) || []).length,
    1,
  );
  assert.match(html, /data-workflow-project-group="PARALLEL-UI"[^>]*open/);
  assert.match(html, /2 个待办节点/);
  assert.match(html, /更新流程节点 Parallel Delivery · URGENT 项/);
  assert.match(html, /更新流程节点 Parallel Delivery · NORMAL 项/);
  assert.doesNotMatch(html, /更新流程节点 Parallel Delivery · MUTED 项/);
});

test('Agent displays normal, immediate and urgent groups without resurrecting old cost exceptions', () => {
  const html = renderToStaticMarkup(React.createElement(AgentView, props(p())));
  for (const text of [
    '紧急处理',
    '马上处理',
    '普通跟进',
    'NORMAL 项',
    'URGENT 项',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /MUTED 项|Cost Attention|Data Quality|未来三天/);
  const done = p();
  done.workflowSteps.push(
    step('DONE_CUSTOM', { finishesWorkflow: true, state: 'completed' }),
  );
  const completed = renderToStaticMarkup(
    React.createElement(OverviewView, props(done)),
  );
  assert.doesNotMatch(completed, /data-workflow-project-group=/);
  assert.match(completed, /当前没有需要跟进的项目/);
});

test('Today keeps an untimed next phase visible and does not expose future pending tasks', () => {
  const ready = p();
  ready.workflowSteps = [
    step('DONE', { state: 'completed' }),
    step('READY', { state: 'not_started', requiresConfirmedCost: true }),
    step('FUTURE', { state: 'not_started' }),
  ];
  const html = renderToStaticMarkup(
    React.createElement(OverviewView, props(ready)),
  );
  assert.match(html, /data-workflow-project-group="PARALLEL-UI"/);
  assert.match(html, /更新流程节点 Parallel Delivery · READY 项/);
  assert.match(html, /待启动\/待登记，尚未开始计时/);
  assert.doesNotMatch(html, /更新流程节点 Parallel Delivery · FUTURE 项/);
  const distribution = distributionMarkup(html);
  assert.match(distribution, />1<\/span><span[^>]*>READY<\/span>/);
  assert.match(distribution, />0<\/span><span[^>]*>FUTURE<\/span>/);
});

test('Today distribution renders published node names/order and count filters use the same stable IDs', () => {
  const project = p();
  project.workflowSteps = [
    step('OLD_ID', { name: 'Old project label' }),
    step('REMOVED', { state: 'not_started' }),
  ];
  const definitions = [
    step('NEW_ID', { name: 'New published node', state: 'not_started' }),
    step('OLD_ID', {
      name: 'Renamed published node',
      parallelGroup: 'Professional checks',
    }),
  ];
  const html = renderToStaticMarkup(
    React.createElement(OverviewView, {
      ...props(project),
      workflowDefinitions: definitions,
      workflowDefinitionRevision: 9,
    }),
  );
  const section = distributionMarkup(html);
  assert.ok(
    section.indexOf('New published node') <
      section.indexOf('Renamed published node'),
  );
  assert.doesNotMatch(section, /Old project label|REMOVED/);
  assert.match(section, /Published workflow · Revision 9/);
  assert.match(section, /Parallel · Professional checks/);
  let selected;
  const tree = WorkflowDistributionNodes({
    entries: [
      {
        step: definitions[1],
        count: 1,
        pendingCount: 1,
        legacy: false,
        projectIds: [project.id],
        pendingProjectIds: [project.id],
      },
    ],
    onSelect: (code) => {
      selected = code;
    },
  });
  tree.props.children[0].props.onClick();
  assert.equal(selected, 'OLD_ID');
});

test('Today leads with pending tasks without counting completed or held projects as pending', () => {
  const active = {
    ...p(),
    id: 'active',
    name: 'Active project',
    workflowSteps: [step('WORK')],
  };
  const held = {
    ...active,
    id: 'held',
    name: 'Held project',
    workflowHold: { startedAt: '2026-09-01T00:00:00Z', reason: 'Waiting' },
  };
  const completed = {
    ...active,
    id: 'completed',
    name: 'Finished project',
    workflowSteps: [
      step('WORK', { state: 'completed' }),
      step('DONE', { state: 'completed', finishesWorkflow: true }),
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(OverviewView, {
      ...props(active),
      projects: [active, held, completed],
      workflowDefinitions: [step('WORK'), step('DONE')],
    }),
  );
  const distribution = distributionMarkup(html);
  assert.match(distribution, /WORK: 1 pending tasks/);
  assert.match(distribution, /DONE: 0 pending tasks/);
  assert.match(distribution, /1 Pending/);
  assert.ok(
    html.indexOf('Project Workflow Distribution') <
      html.indexOf('Active Projects'),
  );
  for (const name of ['Active project', 'Held project', 'Finished project'])
    assert.ok(html.includes(name));
  assert.match(html, /Showing 3 of 3 local projects/);
});
