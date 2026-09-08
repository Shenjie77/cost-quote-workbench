import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('/features/workbench/open-project-tabs.tsx'))
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
const { OpenProjectTabs } =
  await import('../features/workbench/open-project-tabs.tsx');
hooks.deregister();

const projects = [
  { id: 'PRJ-FIRST', name: 'Service Project' },
  { id: 'PRJ-SECOND', name: 'test2' },
  { id: 'PRJ-CLOSED', name: 'Unopened Project' },
];
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const props = (extra = {}) => ({
  projects,
  openProjectIds: ['PRJ-SECOND', 'PRJ-MISSING', 'PRJ-FIRST'],
  activeProjectId: 'PRJ-SECOND',
  onSelect: () => {},
  onClose: () => {},
  ...extra,
});

test('project navigation preserves open-tab order and identifies the active project by ID', () => {
  const html = renderToStaticMarkup(
    React.createElement(OpenProjectTabs, props()),
  );
  assert.match(html, /aria-label="Open Projects"/);
  assert.match(html, /title="PRJ-SECOND · test2"/);
  assert.match(html, /title="PRJ-FIRST · Service Project"/);
  assert.doesNotMatch(html, /PRJ-MISSING|Unopened Project/);
  assert.ok(html.indexOf('PRJ-SECOND') < html.indexOf('PRJ-FIRST'));
  const active = walk(OpenProjectTabs(props())).filter(
    (node) => node.props['aria-current'] === 'page',
  );
  assert.equal(active.length, 1);
  assert.equal(active[0].props.title, 'PRJ-SECOND · test2');
});

test('select and close are independent controls and retain exact project identity', () => {
  const selected = [];
  const closed = [];
  const controls = walk(
    OpenProjectTabs(
      props({
        onSelect: (project) => selected.push(project),
        onClose: (projectId) => closed.push(projectId),
      }),
    ),
  );
  const select = controls.find(
    (node) => node.props.title === 'PRJ-FIRST · Service Project',
  );
  const close = controls.find(
    (node) => node.props['aria-label'] === 'Close test2 tab',
  );
  select.props.onClick();
  assert.equal(selected[0], projects[0]);
  assert.deepEqual(closed, []);
  close.props.onClick();
  assert.deepEqual(closed, ['PRJ-SECOND']);
  assert.equal(selected.length, 1);
  assert.equal(projects.length, 3);
  assert.equal(close.props.title, 'Close tab only / 仅关闭标签');
});

test('loading disables both project selection and tab closing', () => {
  const calls = [];
  const input = props({
    disabled: true,
    onSelect: () => calls.push('select'),
    onClose: () => calls.push('close'),
  });
  const buttons = walk(OpenProjectTabs(input)).filter(
    (node) => node.type === 'button',
  );
  assert.equal(buttons.length, 4);
  for (const button of buttons) {
    assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  assert.deepEqual(calls, []);
  const html = renderToStaticMarkup(
    React.createElement(OpenProjectTabs, input),
  );
  assert.equal((html.match(/disabled=""/g) || []).length, 4);
});
