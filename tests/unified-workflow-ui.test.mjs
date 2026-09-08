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

const { ProjectTable } = await import('../features/projects/project-table.tsx');
const { ProjectView } = await import('../features/projects/project-view.tsx');
const { OverviewView } = await import('../features/overview/overview-view.tsx');
const {
  ProjectWorkflowFields,
  ProjectWorkflowHistory,
  projectWorkflowFormValue,
} = await import('../features/projects/project-workflow-dialog.tsx');
const { createBlankWorkspace } =
  await import('../features/workbench/workspace-factories.ts');
const { projects } = await import('../features/projects/demo-data.ts');
const { normalizeProjectWorkflow, projectWorkflowSteps } =
  await import('../features/projects/workflow-domain.ts');
hooks.deregister();
const noop = () => {};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const workspace = () =>
  normalizeProjectWorkflow(
    createBlankWorkspace(projects[0], 'input_preparation'),
  );
const project = (code = 'DELIVERY_REVIEW') => {
  const w = workspace();
  const step = w.processSteps.find((item) => item.code === code);
  Object.assign(step, {
    owner: 'PM Chen',
    followUpDate: '2026-09-08',
    note: '等待公司平台 DRB 结果',
  });
  return {
    ...projects[0],
    workflowMode: 'project',
    currentWorkflowStepCode: code,
    workflowSteps: w.processSteps,
  };
};

test('project list exposes one workflow record without an independent status selector', () => {
  const p = project();
  const html = renderToStaticMarkup(
    React.createElement(ProjectView, {
      projects: [p],
      onOpenProject: noop,
      onOpenCost: noop,
      onOpenQuote: noop,
      onStatusChange: () => {
        throw new Error('legacy status must not be called');
      },
      onWorkflowChange: () => {
        throw new Error('legacy inline workflow must not be called');
      },
      onTrackWorkflow: noop,
      onCreateProject: noop,
      onDeleteProject: noop,
      onEditProject: noop,
    }),
  );
  assert.match(html, /Project Workflow/);
  assert.match(html, /PM Chen/);
  assert.match(html, /2026-09-08/);
  assert.match(html, /等待公司平台 DRB 结果/);
  assert.match(html, /更新流程/);
  assert.doesNotMatch(html, /Current Status|当前状态|role="combobox"/);
  let selected;
  const tree = ProjectTable({
    projects: [p],
    onProject: noop,
    onCost: noop,
    onQuote: noop,
    onTrackWorkflow: (value) => (selected = value),
  });
  const button = walk(tree).find(
    (node) => node.props['aria-label'] === `更新项目流程 ${p.name}`,
  );
  assert.ok(button);
  button.props.onClick();
  assert.equal(selected, p);
});

test('workflow controls stage, owner, date and note as one staged value without another state input', () => {
  const w = workspace();
  let value = projectWorkflowFormValue(w);
  const steps = projectWorkflowSteps(w);
  const view = () =>
    ProjectWorkflowFields({ value, steps, onChange: (next) => (value = next) });
  const field = (label) =>
    walk(view()).find((node) => node.props['aria-label'] === label);
  field('Current Workflow').props.onChange({
    target: { value: 'DELIVERY_REVIEW' },
  });
  assert.equal(value.currentWorkflowStepCode, 'DELIVERY_REVIEW');
  field('Workflow Owner').props.onChange({
    target: { value: 'PM Lee' },
  });
  field('Next Follow-up').props.onChange({
    target: { value: '2026-09-15' },
  });
  field('Workflow Note').props.onChange({
    target: { value: 'Company DRB submitted' },
  });
  assert.deepEqual(value, {
    currentWorkflowStepCode: 'DELIVERY_REVIEW',
    owner: 'PM Lee',
    followUpDate: '2026-09-15',
    note: 'Company DRB submitted',
  });
  const html = renderToStaticMarkup(
    React.createElement(ProjectWorkflowFields, {
      value,
      steps,
      onChange: noop,
    }),
  );
  assert.match(
    html,
    /Projects without a follow-up date are flagged for scheduling/,
  );
  assert.doesNotMatch(
    html,
    /Project Status|Current Status|审批结果|name="state"/,
  );
  assert.equal(
    w.processSteps.find((entry) => entry.code === 'DELIVERY_REVIEW').note || '',
    '',
  );
});

test('quote completion communicates reminder stop and disables date editing', () => {
  const w = workspace();
  const value = {
    ...projectWorkflowFormValue(w),
    currentWorkflowStepCode: 'QUOTE_COMPLETED',
  };
  const props = { value, steps: projectWorkflowSteps(w), onChange: noop };
  const tree = ProjectWorkflowFields(props);
  assert.equal(
    walk(tree).find((node) => node.props['aria-label'] === 'Next Follow-up')
      .props.disabled,
    true,
  );
  const html = renderToStaticMarkup(
    React.createElement(ProjectWorkflowFields, props),
  );
  assert.match(html, /Project reminders stop after the quotation is complete/);
  const table = renderToStaticMarkup(
    React.createElement(ProjectTable, {
      projects: [project('QUOTE_COMPLETED')],
      onProject: noop,
      onCost: noop,
      onQuote: noop,
      onTrackWorkflow: noop,
    }),
  );
  assert.match(table, /报价完成 · 停止提醒/);
  assert.doesNotMatch(table, /待填写跟进日期/);
});

test('saved workflow and legacy review evidence remain read-only with version and timestamp', () => {
  const w = workspace();
  w.workflowUpdates = [
    {
      id: 'flow-1',
      costVersion: 'V2',
      fromStepCode: 'TD_EFFORT_REVIEW',
      toStepCode: 'DELIVERY_REVIEW',
      owner: 'PM',
      followUpDate: '2026-09-15',
      note: 'Saved workflow evidence',
      updatedAt: '2026-09-08T08:00:00Z',
    },
  ];
  w.ssr = {
    ...w.ssr,
    submissions: [
      {
        id: 'old-drb',
        kind: 'DRB',
        domain: '',
        owner: 'PM',
        applicationNumber: 'DRB-001',
        createdAt: '2025-12-01T08:00:00Z',
        costBaseline: { code: 'V1' },
        evidence: 'Company approval reference',
        results: [
          {
            id: 'result-1',
            recordedAt: '2025-12-02T08:00:00Z',
            outcome: 'approved',
            evidence: 'Approval evidence',
            conditions: [],
          },
        ],
        closures: [],
        followUps: [],
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(ProjectWorkflowHistory, { workspace: w }),
  );
  for (const text of [
    'Read Only',
    'V2',
    'V1',
    '2026-09-08T08:00:00Z',
    '2025-12-01T08:00:00Z',
    'DRB-001',
    'Approval evidence',
    'Saved workflow evidence',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<input|<select|<textarea|<button/);
});

test('overview uses workflow filters and follow-ups instead of separate statuses and review queue', () => {
  const html = renderToStaticMarkup(
    React.createElement(OverviewView, {
      projects: [project('QUOTE_COMPLETED')],
      reviews: [],
      setView: noop,
      setPanel: noop,
      onSelectProject: noop,
      onOpenCost: noop,
      onOpenQuote: noop,
      onTrackWorkflow: noop,
    }),
  );
  assert.match(html, /Project Workflow Distribution/);
  assert.match(html, /项目跟进/);
  assert.match(html, /当前没有需要跟进的项目/);
  assert.doesNotMatch(
    html,
    /Project Status Distribution|Urgent Reviews|Open review queue|All statuses|Current Status/,
  );
});
