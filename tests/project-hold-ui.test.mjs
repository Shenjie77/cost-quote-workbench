/** Project hold remains distinct from pausing one task, with one canonical marker. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';

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
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
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
const { ProjectWorkflowHoldControl } =
  await import('../features/projects/project-workflow-header.tsx');
const { ProjectWorkflowPage } =
  await import('../features/projects/project-workflow-page.tsx');
const { ProjectTable } = await import('../features/projects/project-table.tsx');
const { AgentView } = await import('../features/agent/agent-view.tsx');
hooks.deregister();
const noop = () => {};
const asyncNoop = async () => {};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
const fixture = (held = false) => {
  const project = projectRecord('HOLD-UI', 'Held service project', 'Customer');
  const workspace = createBlankWorkspace(project, 'input_preparation');
  workspace.workflowEngineVersion = 1;
  workspace.workflowVersion = 'V1';
  workspace.processSteps[0] = {
    ...workspace.processSteps[0],
    state: 'awaiting_review',
    startedAt: '2026-01-01T01:00:00Z',
    dueAt: '2026-01-02T10:00:00Z',
    note: 'Waiting for TD plan',
    required: false,
  };
  if (held) workspace.workflowHold = { startedAt: '2026-01-02T01:00:00Z' };
  return {
    project: {
      ...project,
      workflowEngineVersion: 1,
      workflowSteps: workspace.processSteps,
      workflowHold: workspace.workflowHold,
    },
    workspace,
  };
};
const page = (values, extra = {}) =>
  render(ProjectWorkflowPage, {
    ...values,
    onAction: asyncNoop,
    onSetHold: asyncNoop,
    onSaveReferences: asyncNoop,
    onBack: noop,
    onRefresh: asyncNoop,
    onOpenCost: noop,
    ...extra,
  });

test('project hold switch sends only controlled changes and suppresses disabled or repeated actions', () => {
  const calls = [];
  for (const [held, disabled, next, expected] of [
    [false, false, true, true],
    [true, false, false, false],
    [true, true, false, undefined],
    [true, false, true, undefined],
  ]) {
    const count = calls.length;
    const control = walk(
      ProjectWorkflowHoldControl({
        onHold: held,
        disabled,
        onSetHold: async (value) => calls.push(value),
      }),
    ).find((node) => node.props['aria-label'] === 'Project On Hold');
    assert.equal(control.props.checked, held);
    control.props.onCheckedChange(next);
    assert.equal(calls.length, count + (expected === undefined ? 0 : 1));
    if (expected !== undefined) assert.equal(calls.at(-1), expected);
  }
});

test('held workflow is visibly paused and read-only while existing progress and navigation remain available', () => {
  const values = fixture(true);
  const before = structuredClone(values);
  const html = page(values);
  assert.match(html, /aria-label="Project On Hold"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /Workflow monitoring and reminders are paused/);
  assert.match(html, /SLA Due · Timing Paused/);
  assert.match(html, /Monitoring Paused/);
  assert.match(html, /Awaiting Review/);
  assert.match(html, /Waiting for TD plan/);
  const owner = [...html.matchAll(/<input\b[^>]*>/g)].find(([tag]) =>
    tag.includes('aria-label="Task Owner"'),
  )?.[0];
  assert.match(owner || '', /disabled=""/);
  const select = [...html.matchAll(/<select\b[^>]*>/g)].find(([tag]) =>
    tag.includes('aria-label="Select Workflow Step"'),
  )?.[0];
  assert.doesNotMatch(select || '', /disabled/);
  const openCost = [...html.matchAll(/<button\b[^>]*>.*?<\/button>/g)].find(
    ([button]) => button.includes('Open Cost'),
  )?.[0];
  assert.ok(openCost);
  assert.doesNotMatch(openCost, /\s(?:disabled|aria-disabled)=/);
  assert.deepEqual(values, before);
  const resumed = fixture(false);
  const resumedHtml = page(resumed);
  assert.doesNotMatch(
    resumedHtml,
    /Workflow monitoring and reminders are paused/,
  );
  assert.match(resumedHtml, /aria-checked="false"/);
  assert.deepEqual(
    resumed.workspace.processSteps,
    values.workspace.processSteps,
  );
});

test('Project List exposes the canonical On Hold marker without changing cost access or pretending workflow is complete', () => {
  const values = fixture(true);
  const props = {
    projects: [values.project],
    onProject: noop,
    onCost: noop,
    onQuote: noop,
    onTrackWorkflow: noop,
  };
  const before = structuredClone(values.project);
  const html = render(ProjectTable, props);
  assert.match(html, /On Hold \/ 已挂起/);
  assert.match(html, /On Hold · Workflow monitoring paused/);
  assert.match(html, /HOLD-UI/);
  assert.match(html, /Open Cost Workspace/);
  assert.doesNotMatch(html, /报价完成 · 停止提醒/);
  assert.deepEqual(values.project, before);
  const legacyStatusOnly = {
    ...before,
    workflowHold: undefined,
    projectStatus: 'on_hold',
  };
  assert.doesNotMatch(
    render(ProjectTable, { ...props, projects: [legacyStatusOnly] }),
    /On Hold \/ 已挂起/,
  );
});

test('Agent page forwards project hold to digest generation and restores the existing follow-up after resume', () => {
  const values = fixture(false);
  const props = {
    projects: [values.project],
    reviews: [],
    setView: noop,
    setPanel: noop,
    onSelectProject: noop,
  };
  const active = render(AgentView, props);
  assert.match(active, /Held service project/);
  const held = {
    ...values.project,
    workflowHold: { startedAt: '2026-01-02T01:00:00Z' },
  };
  const paused = render(AgentView, { ...props, projects: [held] });
  assert.doesNotMatch(paused, /Held service project/);
  assert.match(paused, /All project monitoring paused/);
  assert.equal(render(AgentView, props).includes('Held service project'), true);
});
