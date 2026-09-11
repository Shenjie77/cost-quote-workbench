/** Drive the actual header search without a browser, project writes or navigation side effects. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const key = Symbol.for('project-search-test-hooks');
const adapter = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('project-search-test-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useEffect = (...args) => hooks().useEffect(...args);
  export const useId = (...args) => hooks().useId(...args);
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      context.parentURL?.endsWith('/project-search.tsx')
    )
      return { url: adapter, shortCircuit: true };
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      // Prefer the UI entry as Vite does; model imports use their distinct explicit .ts filename.
      for (const extension of ['.tsx', '.ts'])
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
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
});
const { ProjectSearch } =
  await import('../features/workbench/project-search.tsx');
hooks.deregister();

/** Minimal synthetic projects expose both identity and current-workflow result labels. */
const projects = ['A', 'B', 'C', 'D'].map((id, index) => ({
  id,
  name: `Station ${id}`,
  nameZh: '',
  client: 'Client',
  clientZh: '',
  proposalNumber: `QUOTE-${id}`,
  version: 'V1',
  workflowEngineVersion: 1,
  workflowSteps: [
    {
      code: 'CHECK',
      name: 'Technical review',
      nameZh: '技术评审',
      state: index === 1 ? 'blocked' : 'in_progress',
      no: '01',
      required: true,
      owner: 'Reviewer',
      roundStart: true,
    },
  ],
}));
const elements = (node) =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : React.isValidElement(node)
      ? [node, ...elements(node.props.children)]
      : [];
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : React.isValidElement(node)
      ? textOf(node.props.children)
      : typeof node === 'string'
        ? node
        : '';
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Stateful hook slots make keyboard, focus and asynchronous controller transitions observable. */
function harness(props) {
  const slots = [],
    effects = [];
  let cursor = 0;
  const backend = {
    useState(initial) {
      const index = cursor++;
      slots[index] ||= {
        value: typeof initial === 'function' ? initial() : initial,
      };
      return [
        slots[index].value,
        (value) => {
          slots[index].value =
            typeof value === 'function' ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      slots[index] ||= { current: value };
      return slots[index];
    },
    useId() {
      const index = cursor++;
      slots[index] ||= { id: `search-test-${index}` };
      return slots[index].id;
    },
    useEffect(effect, dependencies) {
      const index = cursor++,
        previous = slots[index];
      if (
        !previous ||
        dependencies.some(
          (value, i) => !Object.is(value, previous.dependencies[i]),
        )
      ) {
        slots[index] = { dependencies, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  return {
    render() {
      cursor = 0;
      globalThis[key] = backend;
      let rendered;
      try {
        rendered = ProjectSearch(props);
      } finally {
        delete globalThis[key];
      }
      for (const effect of effects.splice(0)) effect();
      return rendered;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
    input() {
      return elements(this.render()).find(
        (item) => item.props.role === 'combobox',
      );
    },
    options() {
      return elements(this.render()).filter(
        (item) => item.props.role === 'option',
      );
    },
    focus() {
      this.input().props.onFocus();
    },
    change(value) {
      this.input().props.onChange({ target: { value } });
    },
    key(name, nativeEvent = {}) {
      const event = {
        key: name,
        nativeEvent,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      this.input().props.onKeyDown(event);
      return event;
    },
  };
}

test('header renders a named combobox and keeps the result popup closed until focus', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProjectSearch, {
      projects,
      activeProjectId: 'A',
      onSelect: async () => true,
    }),
  );
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /Search projects by proposal number, name, or workflow/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /role="option"/);
});

test('local queries show proposal numbers and current workflow labels without selecting or filtering another page', (t) => {
  const selected = [];
  const ui = harness({
    projects,
    activeProjectId: 'A',
    onSelect: async (project) => {
      selected.push(project);
      return true;
    },
  });
  t.after(() => ui.unmount());
  ui.focus();
  ui.change('QUOTE-B');
  assert.equal(ui.options().length, 1);
  assert.match(textOf(ui.options()[0]), /Station B/);
  assert.match(textOf(ui.options()[0]), /QUOTE-B/);
  assert.match(textOf(ui.options()[0]), /技术评审/);
  assert.match(textOf(ui.options()[0]), /Blocked/);
  assert.equal(selected.length, 0);
  ui.change('missing');
  assert.equal(ui.options().length, 0);
  assert.match(textOf(ui.render()), /No matching projects/);
  assert.equal(ui.key('Enter').prevented, false);
});

test('Arrow keys, Enter and Escape select the highlighted project while retaining query on close', async (t) => {
  const selected = [];
  const ui = harness({
    projects,
    activeProjectId: 'A',
    onSelect: async (project) => {
      selected.push(project.id);
      return true;
    },
  });
  t.after(() => ui.unmount());
  ui.focus();
  ui.change('Station');
  assert.equal(ui.key('ArrowDown').prevented, true);
  assert.equal(ui.options()[1].props['aria-selected'], true);
  assert.equal(
    ui.input().props['aria-activedescendant'],
    ui.options()[1].props.id,
  );
  ui.key('ArrowUp');
  assert.equal(ui.options()[0].props['aria-selected'], true);
  ui.key('Escape');
  assert.equal(ui.input().props['aria-expanded'], false);
  assert.equal(ui.input().props.value, 'Station');
  ui.key('ArrowUp');
  assert.equal(ui.options().at(-1).props['aria-selected'], true);
  ui.key('Enter');
  await settle();
  assert.deepEqual(selected, ['D']);
  assert.equal(ui.input().props.value, '');
  assert.equal(ui.input().props['aria-expanded'], false);
});

test('Chinese IME confirmation and legacy composition Enter do not switch projects', async (t) => {
  const selected = [];
  const ui = harness({
    projects,
    activeProjectId: 'A',
    onSelect: async (project) => {
      selected.push(project.id);
      return true;
    },
  });
  t.after(() => ui.unmount());
  ui.focus();
  ui.change('技术评审');
  ui.input().props.onCompositionStart();
  assert.equal(ui.key('Enter').prevented, false);
  ui.input().props.onCompositionEnd();
  assert.equal(ui.key('Enter', { isComposing: true }).prevented, false);
  assert.equal(ui.key('Enter', { keyCode: 229 }).prevented, false);
  assert.deepEqual(selected, []);
  ui.key('Enter');
  await settle();
  assert.deepEqual(selected, ['A']);
});

test('mouse selection is serialized with keyboard clicks; failure preserves query for retry and success clears it', async (t) => {
  const calls = [],
    pending = [];
  const ui = harness({
    projects,
    activeProjectId: 'A',
    onSelect: (project) => {
      calls.push(project.id);
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  t.after(() => ui.unmount());
  ui.focus();
  ui.change('Station');
  let focusPrevented = false;
  ui.options()[1].props.onMouseDown({
    preventDefault() {
      focusPrevented = true;
    },
  });
  assert.equal(focusPrevented, true);
  const click = ui.options()[1].props.onClick;
  click();
  click();
  ui.key('Enter');
  assert.deepEqual(calls, ['B']);
  assert.equal(ui.input().props.readOnly, true);
  ui.change('Cannot change during switch');
  assert.equal(ui.input().props.value, 'Station');
  pending[0](false);
  await settle();
  assert.equal(ui.input().props.value, 'Station');
  assert.equal(ui.input().props.readOnly, false);
  assert.match(textOf(ui.render()), /search is retained/);
  ui.options()[1].props.onClick();
  pending[1](true);
  await settle();
  assert.deepEqual(calls, ['B', 'B']);
  assert.equal(ui.input().props.value, '');
  assert.equal(ui.options().length, 0);
});

test('external blur closes the popup, internal focus preserves it, and disabled search cannot issue a switch', (t) => {
  const props = {
    projects,
    activeProjectId: 'A',
    onSelect: async () => {
      throw new Error('disabled search selected a project');
    },
    disabled: false,
  };
  const ui = harness(props);
  t.after(() => ui.unmount());
  ui.focus();
  ui.change('Station');
  ui.render().props.onBlur({
    currentTarget: { contains: () => true },
    relatedTarget: {},
  });
  assert.equal(ui.input().props['aria-expanded'], true);
  ui.render().props.onBlur({
    currentTarget: { contains: () => false },
    relatedTarget: null,
  });
  assert.equal(ui.input().props['aria-expanded'], false);
  assert.equal(ui.input().props.value, 'Station');
  props.disabled = true;
  ui.focus();
  ui.change('ignored');
  ui.key('Enter');
  assert.equal(ui.input().props.disabled, true);
  assert.equal(ui.input().props.value, 'Station');
  assert.equal(ui.options().length, 0);
});

test('keyboard movement scrolls the result list rather than invoking page scrolling', (t) => {
  const ui = harness({
    projects,
    activeProjectId: 'A',
    onSelect: async () => true,
  });
  t.after(() => ui.unmount());
  ui.focus();
  const list = elements(ui.render()).find(
    (item) => item.props.role === 'listbox',
  );
  const container = {
    scrollTop: 0,
    clientHeight: 60,
    querySelector(selector) {
      const index = Number(selector.match(/"(\d+)"/)[1]);
      return { offsetTop: index * 40, offsetHeight: 40 };
    },
  };
  list.props.ref.current = container;
  ui.key('ArrowDown');
  ui.render();
  assert.equal(container.scrollTop, 20);
  ui.key('ArrowDown');
  ui.render();
  assert.equal(container.scrollTop, 60);
  ui.key('ArrowUp');
  ui.render();
  assert.equal(container.scrollTop, 40);
});

test('failed promise selection preserves query, and unmount ignores a later successful response', async (t) => {
  let finish;
  let attempt = 0;
  const ui = harness({
    projects,
    activeProjectId: 'A',
    onSelect: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Workspace is locked');
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  ui.focus();
  ui.change('QUOTE-B');
  ui.options()[0].props.onClick();
  await settle();
  assert.match(textOf(ui.render()), /Workspace is locked/);
  assert.equal(ui.input().props.value, 'QUOTE-B');
  ui.options()[0].props.onClick();
  ui.unmount();
  finish(true);
  await settle();
  const next = harness({
    projects,
    activeProjectId: 'C',
    onSelect: async () => true,
  });
  t.after(() => next.unmount());
  assert.equal(next.input().props.value, '');
  assert.equal(next.input().props['aria-expanded'], false);
});
