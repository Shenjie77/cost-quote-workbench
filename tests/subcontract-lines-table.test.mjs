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
const {
  SubcontractLinesTable,
  SubcontractNumberInput,
  SubcontractItemForm,
  SubcontractDeleteButton,
  createSubcontractItemEdit,
  saveSubcontractItemEdit,
} = await import('../features/cost/components/subcontract-lines-table.tsx');
hooks.deregister();
const noop = () => {};
const actualYears = [2026, 2027, 2028, 2029, 2030];
const item = (extra = {}) => ({
  id: 'item-1',
  code: 'ROUTER',
  description: 'Install Cisco 2u router',
  bu: 'Network',
  unit: 'pcs',
  unitPrice: 200,
  currency: 'SGD',
  quantities: [1, 2, 3, 4, 5],
  ...extra,
});
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
const tableProps = (line, extra = {}) => ({
  lines: [line],
  project: true,
  actualYears,
  onChange: noop,
  onDelete: noop,
  announce: noop,
  ...extra,
});

test('focused annual table presents five columns and changes only the selected year', () => {
  const original = item();
  const changes = [];
  const props = tableProps(original, {
    yearIndex: 2,
    onChange: (line) => changes.push(line),
  });
  const html = render(SubcontractLinesTable, props);
  assert.equal((html.match(/data-slot="table-head"/g) || []).length, 5);
  assert.match(html, /Y3 Qty/);
  assert.match(html, /600.00/);
  assert.doesNotMatch(
    html,
    /ROUTER Y1 quantity|ROUTER Y2 quantity|ROUTER Y4 quantity|ROUTER Y5 quantity/,
  );
  assert.match(html, /Install Cisco 2u router/);
  assert.match(html, /Network/);
  assert.doesNotMatch(
    html,
    /aria-label="ROUTER unit"|aria-label="ROUTER item"/,
  );
  const field = walk(SubcontractLinesTable(props)).find(
    (node) =>
      node.type === SubcontractNumberInput &&
      node.props.label === 'ROUTER Y3 quantity',
  );
  SubcontractNumberInput(field.props).props.onChange({
    target: { value: '9' },
  });
  assert.deepEqual(changes[0].quantities, [1, 2, 9, 4, 5]);
  assert.deepEqual(original.quantities, [1, 2, 3, 4, 5]);
});

test('all-year view shows five quantity allocations and site mode keeps per-site input', () => {
  const html = render(
    SubcontractLinesTable,
    tableProps(item(), { yearIndex: 'all' }),
  );
  assert.equal((html.match(/ROUTER Y[1-5] quantity/g) || []).length, 5);
  assert.match(html, /3,000.00/);
  assert.match(html, /sticky left-0/);
  const site = item({ unit: 'm', quantityPerSite: 2.5 });
  delete site.quantities;
  const siteHtml = render(
    SubcontractLinesTable,
    tableProps(site, { project: false }),
  );
  assert.equal((siteHtml.match(/data-slot="table-head"/g) || []).length, 5);
  assert.match(siteHtml, /Qty \/ Site/);
  assert.match(siteHtml, /500.00/);
  assert.doesNotMatch(siteHtml, /Y1 Qty|Y1 Cost/);
});

test('item editing stages text and price until Save; Cancel leaves the saved version untouched', () => {
  const original = item();
  let draft = structuredClone(original),
    closed = 0;
  const saved = [];
  const form = () =>
    SubcontractItemForm({
      draft,
      onDraftChange: (next) => {
        draft = next;
      },
      onSave: (next) => saved.push(next),
      onClose: () => {
        closed += 1;
      },
      announce: noop,
    });
  walk(form())
    .find((node) => node.props['aria-label'] === 'Item description')
    .props.onChange({ target: { value: 'Updated router installation' } });
  const price = walk(form()).find(
    (node) => node.type === SubcontractNumberInput,
  );
  SubcontractNumberInput(price.props).props.onChange({
    target: { value: '250' },
  });
  assert.deepEqual(saved, []);
  assert.equal(original.description, 'Install Cisco 2u router');
  walk(form())
    .find((node) => node.props.children === 'Cancel')
    .props.onClick();
  assert.equal(closed, 1);
  assert.deepEqual(saved, []);
  draft = structuredClone(original);
  walk(form())
    .find((node) => node.props['aria-label'] === 'Item description')
    .props.onChange({ target: { value: 'Saved description' } });
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved[0].description, 'Saved description');
  assert.equal(saved[0].unitPrice, 200);
  assert.equal(closed, 2);
  draft.quantities[0] = 90;
  assert.equal(saved[0].quantities[0], 1);
});

test('dialog prevents invalid unit conversion and currency while allowing incomplete Draft metadata', () => {
  let draft = item({ unit: 'm', quantities: [2.5, 0, 0, 0, 0] });
  const errors = [],
    saved = [];
  const form = () =>
    SubcontractItemForm({
      draft,
      onDraftChange: (next) => {
        draft = next;
      },
      onSave: (next) => saved.push(next),
      onClose: noop,
      announce: (message) => errors.push(message),
    });
  walk(form())
    .find((node) => node.props['aria-label'] === 'Item unit')
    .props.onChange({ target: { value: 'pcs' } });
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved.length, 0);
  assert.equal(errors.length, 1);
  draft = item({ currency: 'USD' });
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved.length, 0);
  draft = item({
    description: '',
    code: '',
    bu: '',
    unit: '',
    unitPrice: null,
  });
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].unitPrice, null);
  draft = item({ unitPrice: 0 });
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved[1].unitPrice, 0);
});

test('an external quantity or price update rejects stale dialog Save and keeps its unsaved draft open', () => {
  let current = item();
  let edit = createSubcontractItemEdit(current);
  edit.draft.description = 'Unsaved local edit';
  const saved = [],
    messages = [];
  let closed = 0;
  const form = () =>
    SubcontractItemForm({
      draft: edit.draft,
      onDraftChange: (draft) => {
        edit = { ...edit, draft };
      },
      onSave: (draft) =>
        saveSubcontractItemEdit({
          line: current,
          baseline: edit.baseline,
          draft,
          onSave: (next) => {
            saved.push(next);
          },
          announce: (message) => messages.push(message),
        }),
      onClose: () => {
        closed += 1;
      },
      announce: noop,
    });
  current = item({ quantities: [9, 2, 3, 4, 5] });
  form().props.onSubmit({ preventDefault: noop });
  assert.deepEqual(saved, []);
  assert.equal(closed, 0);
  assert.equal(edit.draft.description, 'Unsaved local edit');
  assert.equal(current.quantities[0], 9);
  assert.match(messages[0], /Reload the latest/);
  edit = createSubcontractItemEdit(current);
  assert.equal(edit.draft.quantities[0], 9);
  edit.draft.description = 'Reviewed against latest';
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved[0].description, 'Reviewed against latest');
  assert.equal(saved[0].quantities[0], 9);
  assert.equal(closed, 1);
  edit = createSubcontractItemEdit(current);
  current = { ...current, unitPrice: null };
  form().props.onSubmit({ preventDefault: noop });
  assert.equal(saved.length, 1);
  assert.equal(closed, 1);
});

test('site quantity conflicts and explicit parent rejection leave Item Form open', () => {
  const site = item({ quantityPerSite: 2 });
  delete site.quantities;
  const edit = createSubcontractItemEdit(site);
  let calls = 0,
    closed = 0;
  const accepted = saveSubcontractItemEdit({
    line: { ...site, quantityPerSite: 7 },
    baseline: edit.baseline,
    draft: edit.draft,
    onSave: () => {
      calls += 1;
    },
    announce: noop,
  });
  assert.equal(accepted, false);
  assert.equal(calls, 0);
  const form = SubcontractItemForm({
    draft: item(),
    onDraftChange: noop,
    onSave: () => false,
    onClose: () => {
      closed += 1;
    },
    announce: noop,
  });
  form.props.onSubmit({ preventDefault: noop });
  assert.equal(closed, 0);
  assert.equal(
    saveSubcontractItemEdit({
      line: Object.fromEntries(Object.entries(site).reverse()),
      baseline: edit.baseline,
      draft: edit.draft,
      onSave: () => {
        calls += 1;
      },
      announce: noop,
    }),
    true,
  );
  assert.equal(calls, 1);
});

test('locked inline and dialog callbacks cannot mutate saved costs', () => {
  const changes = [];
  const props = tableProps(item(), {
    locked: true,
    onChange: (next) => changes.push(next),
  });
  for (const field of walk(SubcontractLinesTable(props)).filter(
    (node) => node.type === SubcontractNumberInput,
  )) {
    SubcontractNumberInput(field.props).props.onChange({
      target: { value: '500' },
    });
    field.props.onChange(500);
  }
  const form = SubcontractItemForm({
    draft: item(),
    locked: true,
    onDraftChange: (next) => changes.push(next),
    onSave: (next) => changes.push(next),
    onClose: noop,
    announce: noop,
  });
  walk(form)
    .find((node) => node.props['aria-label'] === 'Item code')
    .props.onChange({ target: { value: 'CHANGED' } });
  form.props.onSubmit({ preventDefault: noop });
  assert.deepEqual(changes, []);
  const html = render(SubcontractLinesTable, props);
  assert.match(
    html,
    /aria-label="Edit ROUTER"[^>]*disabled|disabled[^>]*aria-label="Edit ROUTER"/,
  );
});

test('removing an item requires confirmation and locks bypass neither prompt nor guard', () => {
  const priorWindow = globalThis.window;
  let answer = false,
    prompts = 0;
  const deleted = [];
  globalThis.window = {
    confirm: () => {
      prompts += 1;
      return answer;
    },
  };
  try {
    const button = (locked = false) =>
      SubcontractDeleteButton({
        line: item(),
        locked,
        onDelete: (id) => deleted.push(id),
      });
    button().props.onClick();
    assert.deepEqual(deleted, []);
    answer = true;
    button().props.onClick();
    button(true).props.onClick();
    assert.deepEqual(deleted, ['item-1']);
    assert.equal(prompts, 2);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('custom delete confirmation names the effect of removing the last site BOQ item', () => {
  const priorWindow = globalThis.window;
  const prompts = [],
    deleted = [];
  const source = item();
  const confirmation = (line) =>
    `Remove ${line.code} and clear annual deployments for this site type?`;
  const actions = walk(
    SubcontractLinesTable(
      tableProps(source, { deleteConfirmation: confirmation }),
    ),
  ).find((node) => node.props.deleteConfirmation === confirmation);
  assert.ok(
    actions,
    'table passes the configured confirmation to its item actions',
  );
  globalThis.window = {
    confirm: (message) => {
      prompts.push(message);
      return true;
    },
  };
  try {
    SubcontractDeleteButton({
      line: source,
      onDelete: (id) => deleted.push(id),
      deleteConfirmation: confirmation,
    }).props.onClick();
    assert.deepEqual(prompts, [
      'Remove ROUTER and clear annual deployments for this site type?',
    ]);
    assert.deepEqual(deleted, ['item-1']);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});
