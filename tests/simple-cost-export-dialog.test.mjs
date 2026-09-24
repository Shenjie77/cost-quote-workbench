/** Exercise the real worksheet picker handlers without downloading or persisting project data. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { makeCostSnapshot } from './helpers.mjs';
import { getAvailableSimpleCostSheets } from '../features/cost/simple-export-sheets.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hookKey = Symbol.for('simple-cost-export-dialog-hooks');
const adapter = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('simple-cost-export-dialog-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useId = (...args) => hooks().useId(...args);
`)}`;
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      context.parentURL?.endsWith('/simple-cost-export-dialog.tsx')
    )
      return { url: adapter, shortCircuit: true };
    if (
      specifier.startsWith('@/') ||
      (specifier.startsWith('.') &&
        context.parentURL?.startsWith(pathToFileURL(root).href) &&
        !context.parentURL.includes('/node_modules/'))
    ) {
      const base = specifier.startsWith('@/')
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Column hydration is independently tested; this fixture exposes the ready browser state to CostView.
    if (url.endsWith('/features/cost/use-personnel-table-view.ts'))
      return {
        format: 'module',
        shortCircuit: true,
        source: `export const usePersonnelTableView = () => ({
          ready: true, isViewDirty: false, columnSettings: { ready: true },
          layout: { grouped: false, yearIndex: 'all', columns: ['scope', 'totalCost'] },
          saveView: () => true,
        });`,
      };
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
const { SimpleCostExportDialog } =
  await import('../features/cost/components/simple-cost-export-dialog.tsx');
const { CostView } = await import('../features/cost/cost-view.tsx');
const { Dialog, DialogTrigger, DialogContent } =
  await import('../components/ui/dialog.tsx');
const { Checkbox } = await import('../components/ui/checkbox.tsx');
const { Button } = await import('../components/ui/button.tsx');
after(() => loader.deregister());

/** Inspect public component slots without executing unrelated controls or browser effects. */
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
      : typeof node === 'string' || typeof node === 'number'
        ? String(node)
        : '';
const button = (tree, name) => {
  const control = walk(tree).find(
    (node) => node.type === Button && textOf(node).trim() === name,
  );
  assert.ok(control, `Missing ${name} button`);
  return control;
};
const exportButton = (tree) => {
  const control = walk(tree).find(
    (node) => node.type === Button && textOf(node).trim().startsWith('Export'),
  );
  assert.ok(control, 'Missing export button');
  return control;
};
const checkboxes = (tree) =>
  walk(tree).filter((node) => node.type === Checkbox);
const checkedIds = (tree) =>
  checkboxes(tree)
    .filter((node) => node.props.checked)
    .map((node) => node.props['aria-label']);
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Preserve local hook state while invoking production callbacks, including same-tick duplicate clicks. */
function harness(props) {
  const state = [];
  let cursor = 0;
  const backend = {
    useId() {
      return 'simple-export-test';
    },
    useState(initial) {
      const index = cursor++;
      state[index] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      };
      return [
        state[index].value,
        (next) => {
          state[index].value =
            typeof next === 'function' ? next(state[index].value) : next;
        },
      ];
    },
    useRef(initial) {
      return (state[cursor++] ??= { current: initial });
    },
  };
  return () => {
    cursor = 0;
    globalThis[hookKey] = backend;
    try {
      return SimpleCostExportDialog(props);
    } finally {
      delete globalThis[hookKey];
    }
  };
}

/** The shared catalog supplies real stable IDs, while callbacks count every requested export. */
function fixture() {
  let available = getAvailableSimpleCostSheets(makeCostSnapshot());
  let reads = 0;
  const calls = [];
  const props = {
    disabled: false,
    getSheets: () => {
      reads++;
      return available;
    },
    onExport: async (sheets) => {
      calls.push(sheets);
      return true;
    },
  };
  const render = harness(props);
  return {
    props,
    render,
    calls,
    reads: () => reads,
    available: () => available,
    setAvailable: (next) => {
      available = next;
    },
    open: () => {
      render().props.onOpenChange(true);
      return render();
    },
  };
}

test('opening defaults to every available worksheet and cancellation never exports', () => {
  const f = fixture();
  let tree = f.render();
  assert.equal(tree.type, Dialog);
  assert.equal(tree.props.open, false);
  assert.equal(f.reads(), 0);
  assert.ok(walk(tree).some((node) => node.type === DialogTrigger));
  tree = f.open();
  assert.equal(tree.props.open, true);
  assert.deepEqual(
    checkedIds(tree),
    f.available().map((sheet) => sheet.id),
  );
  assert.equal(button(tree, 'Select all').props.disabled, true);
  button(tree, 'Cancel').props.onClick();
  assert.equal(f.render().props.open, false);
  assert.deepEqual(f.calls, []);
});

test('clear blocks empty export; single selection and select all preserve named worksheets', async () => {
  const f = fixture();
  button(f.open(), 'Clear').props.onClick();
  let tree = f.render();
  assert.deepEqual(checkedIds(tree), []);
  assert.equal(exportButton(tree).props.disabled, true);
  assert.ok(
    walk(tree).some(
      (node) =>
        (node.type === 'output' || node.props.role === 'status') &&
        /at least one/.test(textOf(node)),
    ),
  );
  exportButton(tree).props.onClick();
  await flush();
  assert.deepEqual(f.calls, []);
  const statement = checkboxes(tree).find(
    (node) => node.props['aria-label'] === 'Cost Statement',
  );
  statement.props.onCheckedChange(true);
  statement.props.onCheckedChange(true);
  tree = f.render();
  assert.deepEqual(checkedIds(tree), ['Cost Statement']);
  assert.equal(exportButton(tree).props.disabled, false);
  exportButton(tree).props.onClick();
  await flush();
  assert.deepEqual(f.calls, [['Cost Statement']]);
  assert.equal(f.render().props.open, false);
  button(f.open(), 'Clear').props.onClick();
  button(f.render(), 'Select all').props.onClick();
  tree = f.render();
  assert.deepEqual(
    checkedIds(tree),
    f.available().map((sheet) => sheet.id),
  );
  exportButton(tree).props.onClick();
  await flush();
  assert.deepEqual(
    f.calls[1],
    f.available().map((sheet) => sheet.id),
  );
});

test('same-tick duplicate confirmation submits once and all close paths wait for the export', async () => {
  const f = fixture();
  let complete;
  f.props.onExport = (sheets) => {
    f.calls.push(sheets);
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const tree = f.open();
  const confirm = exportButton(tree);
  confirm.props.onClick();
  confirm.props.onClick();
  tree.props.onOpenChange(false);
  button(tree, 'Cancel').props.onClick();
  // A stale checkbox callback cannot change the captured selection while generation is pending.
  checkboxes(tree)[0].props.onCheckedChange(false);
  const busy = f.render();
  assert.equal(f.calls.length, 1);
  assert.equal(busy.props.open, true);
  assert.equal(exportButton(busy).props.disabled, true);
  assert.equal(button(busy, 'Cancel').props.disabled, true);
  assert.equal(button(busy, 'Clear').props.disabled, true);
  assert.equal(button(busy, 'Select all').props.disabled, true);
  assert.ok(checkboxes(busy).every((node) => node.props.disabled));
  const content = walk(busy).find((node) => node.type === DialogContent);
  assert.equal(content.props.showCloseButton, false);
  assert.equal(content.props['aria-busy'], true);
  assert.deepEqual(checkedIds(busy), f.calls[0]);
  complete(true);
  await flush();
  assert.equal(f.render().props.open, false);
});

test('failed and rejected exports retain the exact selection and allow a successful retry', async () => {
  const f = fixture();
  let attempt = 0;
  f.props.onExport = async (sheets) => {
    f.calls.push(sheets);
    attempt++;
    if (attempt === 1) return false;
    if (attempt === 2) throw new Error('Archive destination unavailable');
    return true;
  };
  button(f.open(), 'Clear').props.onClick();
  checkboxes(f.render())
    .find((node) => node.props['aria-label'] === 'Summary BU')
    .props.onCheckedChange(true);
  for (const message of [/Export failed/, /Archive destination unavailable/]) {
    exportButton(f.render()).props.onClick();
    await flush();
    const tree = f.render();
    assert.equal(tree.props.open, true);
    assert.deepEqual(checkedIds(tree), ['Summary BU']);
    assert.equal(exportButton(tree).props.disabled, false);
    const error = walk(tree).find((node) => node.props.role === 'alert');
    assert.match(textOf(error), message);
  }
  exportButton(f.render()).props.onClick();
  await flush();
  assert.deepEqual(f.calls, [['Summary BU'], ['Summary BU'], ['Summary BU']]);
  assert.equal(f.render().props.open, false);
});

test('reopening refreshes conditional worksheets and restores all-selection without reusing stale choices', () => {
  const f = fixture();
  const initial = f.available();
  button(f.open(), 'Clear').props.onClick();
  button(f.render(), 'Cancel').props.onClick();
  f.setAvailable([
    ...initial,
    {
      id: 'Subcon Rates',
      label: 'Subcon Rates',
      description: 'Saved subcontract assumptions',
    },
  ]);
  let tree = f.open();
  assert.equal(f.reads(), 2);
  assert.deepEqual(
    checkedIds(tree),
    f.available().map((sheet) => sheet.id),
  );
  tree.props.onOpenChange(false);
  f.setAvailable(initial);
  tree = f.open();
  assert.deepEqual(
    checkedIds(tree),
    initial.map((sheet) => sheet.id),
  );
  assert.equal(
    checkboxes(tree).some(
      (node) => node.props['aria-label'] === 'Subcon Rates',
    ),
    false,
  );
  assert.deepEqual(f.calls, []);
});

test('disabled picker blocks opening and confirmation, while cancellation remains available', async () => {
  const f = fixture();
  f.props.disabled = true;
  let tree = f.open();
  assert.equal(tree.props.open, false);
  assert.equal(f.reads(), 0);
  assert.equal(
    walk(tree).find((node) => node.type === DialogTrigger).props.disabled,
    true,
  );
  f.props.disabled = false;
  f.open();
  f.props.disabled = true;
  tree = f.render();
  assert.equal(exportButton(tree).props.disabled, true);
  exportButton(tree).props.onClick();
  await flush();
  assert.deepEqual(f.calls, []);
  button(tree, 'Cancel').props.onClick();
  assert.equal(f.render().props.open, false);
});

test('CostView scopes picker lifetime to project and version while locked versions retain export access', () => {
  const snapshot = makeCostSnapshot();
  const before = structuredClone(snapshot);
  let writes = 0;
  const noop = () => {
    writes++;
  };
  const renderPicker = (projectId, code, state, exists = true) => {
    let tree;
    const Probe = () => {
      tree = CostView({
        project: { ...snapshot.project, id: projectId },
        lockedReason: `${state} cost is read-only`,
        activeVersion: code,
        versions: exists ? [{ code, state, costRows: snapshot.costRows }] : [],
        onSelectVersion: noop,
        onUpdateVersionState: noop,
        costView: 'summary',
        setCostView: noop,
        rows: snapshot.costRows,
        setRows: noop,
        rateSettings: snapshot.rateSettings,
        setRateSettings: noop,
        resourceTypes: snapshot.resourceTypes,
        onApplyMasterRates: noop,
        travelSettings: snapshot.travelSettings,
        setTravelSettings: noop,
        travelRows: [],
        setTravelRows: noop,
        travelUplift: 0,
        setTravelUplift: noop,
        manualCosts: snapshot.manualCosts,
        setManualCosts: noop,
        announce: noop,
      });
      return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    return walk(tree).find((node) => node.type === SimpleCostExportDialog);
  };
  const confirmed = renderPicker('P1', 'V1', 'Confirmed');
  const suspended = renderPicker('P1', 'V2', 'Suspended');
  const otherProject = renderPicker('P2', 'V2', 'Confirmed');
  assert.equal(confirmed.props.disabled, false);
  assert.equal(suspended.props.disabled, false);
  assert.notEqual(confirmed.key, suspended.key);
  assert.notEqual(suspended.key, otherProject.key);
  assert.ok(
    confirmed.props.getSheets().some((sheet) => sheet.id === 'Cost Statement'),
  );
  assert.equal(
    renderPicker('P1', 'missing', 'Confirmed', false).props.disabled,
    true,
  );
  assert.equal(
    writes,
    0,
    'opening the selection must not save, alter costs, or announce an export',
  );
  assert.deepEqual(snapshot, before);
});

test('worksheet discovery errors remain dismissible and reopening retries with a clean selection', () => {
  const f = fixture();
  const available = f.available();
  let fail = true;
  f.props.getSheets = () => {
    if (fail) throw new Error('Current cost snapshot is unavailable');
    return available;
  };
  let tree = f.open();
  assert.equal(tree.props.open, true);
  assert.deepEqual(checkedIds(tree), []);
  assert.equal(exportButton(tree).props.disabled, true);
  assert.match(
    textOf(walk(tree).find((node) => node.props.role === 'alert')),
    /Current cost snapshot is unavailable/,
  );
  button(tree, 'Cancel').props.onClick();
  assert.equal(f.render().props.open, false);
  fail = false;
  tree = f.open();
  assert.deepEqual(
    checkedIds(tree),
    available.map((sheet) => sheet.id),
  );
  assert.equal(
    walk(tree).some((node) => node.props.role === 'alert'),
    false,
  );
  assert.deepEqual(f.calls, []);
});

test('combined picker keeps Cost Statement mandatory even after Clear or forced checkbox events', async () => {
  const f = fixture();
  f.props.requiredSheets = ['Cost Statement'];
  f.props.triggerLabel = 'Quotation + Simple Cost';
  button(f.open(), 'Clear').props.onClick();
  let tree = f.render();
  assert.deepEqual(checkedIds(tree), ['Cost Statement']);
  const required = checkboxes(tree).find(
    (node) => node.props['aria-label'] === 'Cost Statement',
  );
  assert.equal(required.props.disabled, true);
  required.props.onCheckedChange(false);
  tree = f.render();
  assert.deepEqual(checkedIds(tree), ['Cost Statement']);
  exportButton(tree).props.onClick();
  await flush();
  assert.deepEqual(f.calls, [['Cost Statement']]);
});
