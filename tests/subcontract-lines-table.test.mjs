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
  SubcontractDeleteButton,
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

test('focused annual details directly edit only the selected year quantity', () => {
  const original = item();
  const changes = [];
  const props = tableProps(original, {
    yearIndex: 2,
    onChange: (line) => changes.push(line),
  });
  const html = render(SubcontractLinesTable, props);
  assert.equal((html.match(/data-slot="table-head"/g) || []).length, 9);
  assert.match(html, /Y3 Qty/);
  assert.match(html, /600.00/);
  assert.doesNotMatch(
    html,
    /ROUTER Y1 quantity|ROUTER Y2 quantity|ROUTER Y4 quantity|ROUTER Y5 quantity/,
  );
  assert.match(html, /Install Cisco 2u router/);
  assert.match(html, /Network/);
  assert.match(html, /aria-label="ROUTER unit"/);
  assert.doesNotMatch(html, /Edit ROUTER|Edit Item/);
  const quantity = walk(SubcontractLinesTable(props)).find(
    (node) =>
      node.type === SubcontractNumberInput &&
      node.props.label.includes('quantity'),
  );
  SubcontractNumberInput(quantity.props).props.onChange({
    target: { value: '7' },
  });
  assert.deepEqual(changes[0].quantities, [1, 2, 7, 4, 5]);
  assert.equal(changes[0].unitPrice, 200);
  assert.match(
    render(SubcontractLinesTable, tableProps(changes[0], { yearIndex: 2 })),
    /1,400.00/,
  );
  assert.deepEqual(original.quantities, [1, 2, 3, 4, 5]);
});

test('all-year view shows five quantity allocations and site mode shows per-site quantities', () => {
  const html = render(
    SubcontractLinesTable,
    tableProps(item(), { yearIndex: 'all' }),
  );
  assert.equal((html.match(/ROUTER Y[1-5] quantity/g) || []).length, 5);
  assert.match(html, /3,000.00/);
  assert.equal((html.match(/<col style=/g) || []).length, 13);

  const site = item({ unit: 'm', quantityPerSite: 2.5 });
  delete site.quantities;
  const siteHtml = render(
    SubcontractLinesTable,
    tableProps(site, { project: false }),
  );
  assert.equal((siteHtml.match(/data-slot="table-head"/g) || []).length, 9);
  assert.match(siteHtml, /Qty \/ Site/);
  assert.match(siteHtml, /500.00/);
  assert.doesNotMatch(siteHtml, /Y1 Qty|Y1 Cost/);
});

test('site quantity edits accept decimal units and immediately recalculate per-site cost', () => {
  const site = item({ unit: 'm', quantityPerSite: 2.5 });
  delete site.quantities;
  const changes = [];
  const props = tableProps(site, {
    project: false,
    onChange: (line) => changes.push(line),
  });
  const input = walk(SubcontractLinesTable(props)).find(
    (node) =>
      node.type === SubcontractNumberInput &&
      node.props.label.includes('quantity'),
  );
  SubcontractNumberInput(input.props).props.onChange({
    target: { value: '3.75' },
  });
  assert.equal(changes[0].quantityPerSite, 3.75);
  assert.equal(site.quantityPerSite, 2.5);
  assert.match(
    render(SubcontractLinesTable, tableProps(changes[0], { project: false })),
    /750.00/,
  );
});

test('inline quantities reject negatives, fractional PCS and excessive values', () => {
  const changes = [],
    messages = [];
  const input = walk(
    SubcontractLinesTable(
      tableProps(item(), {
        onChange: (line) => changes.push(line),
        announce: (message) => messages.push(message),
      }),
    ),
  ).find(
    (node) =>
      node.type === SubcontractNumberInput &&
      node.props.label.includes('quantity'),
  );
  for (const value of ['-1', '2.5', '1000001', 'NaN'])
    SubcontractNumberInput(input.props).props.onChange({ target: { value } });
  assert.equal(changes.length, 0);
  assert.equal(messages.length, 4);
  SubcontractNumberInput(input.props).props.onChange({ target: { value: '' } });
  assert.deepEqual(changes[0].quantities, [0, 2, 3, 4, 5]);
});

test('subcontract category edits preserve quantities and locks block the inline handler', () => {
  const changes = [];
  const field = (locked) =>
    walk(
      SubcontractLinesTable(
        tableProps(item(), {
          locked,
          onChange: (line) => changes.push(line),
        }),
      ),
    ).find((node) => node.props['aria-label'] === 'ROUTER category');
  field(false).props.onChange({ target: { value: 'Installation' } });
  assert.equal(changes[0].category, 'Installation');
  assert.deepEqual(changes[0].quantities, [1, 2, 3, 4, 5]);
  field(true).props.onChange({ target: { value: 'Changed' } });
  assert.equal(changes.length, 1);
});

test('metadata edits apply in the row and retain the latest quantities and catalog reference', () => {
  let current = item({
    catalogItemId: 'catalog-1',
    quantities: [9, 2, 3, 4, 5],
  });
  const original = structuredClone(current);
  const fields = () =>
    walk(
      SubcontractLinesTable(
        tableProps(current, {
          onChange: (next) => {
            current = next;
          },
        }),
      ),
    );
  for (const [field, value] of [
    ['description', 'Updated\nrouter installation'],
    ['code', 'SWITCH'],
    ['unit', 'm'],
  ]) {
    fields()
      .find((node) => node.props['aria-label'] === `${current.code} ${field}`)
      .props.onChange({ target: { value } });
  }
  const price = fields().find(
    (node) => node.props.label === 'SWITCH unit price',
  );
  SubcontractNumberInput(price.props).props.onChange({
    target: { value: '250' },
  });
  assert.equal(current.unitPrice, 250);
  assert.equal(current.description, 'Updated\nrouter installation');
  assert.deepEqual(current.quantities, [9, 2, 3, 4, 5]);
  assert.equal(current.catalogItemId, 'catalog-1');
  assert.equal(original.code, 'ROUTER');
});

test('inline unit conversion rejects fractional PCS and blank price remains different from zero', () => {
  let current = item({ unit: 'm', quantities: [2.5, 0, 0, 0, 0] });
  const errors = [],
    saved = [];
  const fields = () =>
    walk(
      SubcontractLinesTable(
        tableProps(current, {
          onChange: (next) => {
            current = next;
            saved.push(next);
          },
          announce: (message) => errors.push(message),
        }),
      ),
    );
  fields()
    .find((node) => node.props['aria-label'] === 'ROUTER unit')
    .props.onChange({ target: { value: 'pcs' } });
  assert.equal(saved.length, 0);
  assert.equal(errors.length, 1);
  for (const value of ['', '0']) {
    const price = fields().find(
      (node) => node.props.label === 'ROUTER unit price',
    );
    SubcontractNumberInput(price.props).props.onChange({ target: { value } });
  }
  assert.equal(saved[0].unitPrice, null);
  assert.equal(saved[1].unitPrice, 0);
});

test('locked inline callbacks cannot mutate any saved field', () => {
  const changes = [];
  const props = tableProps(item(), {
    locked: true,
    onChange: (next) => changes.push(next),
  });
  for (const field of walk(SubcontractLinesTable(props))) {
    if (field.type === SubcontractNumberInput) {
      SubcontractNumberInput(field.props).props.onChange({
        target: { value: '500' },
      });
      field.props.onChange(500);
    } else if (
      field.props['aria-label']?.startsWith('ROUTER') &&
      field.props.onChange
    ) {
      field.props.onChange({ target: { value: 'CHANGED' } });
    }
  }
  assert.deepEqual(changes, []);
  const html = render(SubcontractLinesTable, props);
  assert.doesNotMatch(html, /Edit ROUTER|Edit Item/);
  assert.match(html, /disabled/);
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
