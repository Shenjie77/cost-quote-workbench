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
  SubcontractCatalogPicker,
  SubcontractCatalogSelection,
  SubcontractCatalogOption,
  filterSubcontractCatalog,
  resolveSelectedSubcontractItems,
  subcontractCatalogRestriction,
} = await import('../features/cost/components/subcontract-catalog-picker.tsx');
hooks.deregister();

const noop = () => {};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
const textContent = (node) =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textContent).join('')
      : React.isValidElement(node)
        ? textContent(node.props.children)
        : '';
const item = (extra = {}) => ({
  id: 'router',
  code: 'ROUTER',
  item: 'Install core router',
  bu: 'Network',
  unit: 'pcs',
  unitPrice: 200,
  currency: 'SGD',
  active: true,
  ...extra,
});
const initial = () => [
  item(),
  item({
    id: 'cable',
    code: 'CABLE',
    item: 'Install fibre cable',
    bu: 'Optical',
    unit: 'm',
    unitPrice: 2.5,
  }),
  item({
    id: 'test',
    code: 'TEST',
    item: 'Commissioning',
    bu: 'Services',
    unit: 'site',
    unitPrice: null,
  }),
];
const props = (catalog = initial(), extra = {}) => ({
  catalog,
  query: '',
  onQueryChange: noop,
  onSelect: noop,
  onClose: noop,
  ...extra,
});
const control = (tree, label) =>
  walk(tree).find(
    (node) =>
      textContent(node.props.children) === label &&
      typeof node.props.onClick === 'function',
  );

test('bulk checkboxes preserve selections across search and only submit through the footer', () => {
  const catalog = initial();
  const batches = [];
  let query = '',
    selectedIds = [];
  const view = () =>
    SubcontractCatalogSelection({
      ...props(catalog, { query }),
      matches: filterSubcontractCatalog(catalog, query),
      selectedIds,
      onSelectionChange: (ids) => (selectedIds = ids),
      onAdd: () =>
        batches.push(resolveSelectedSubcontractItems(catalog, selectedIds)),
    });
  const toggle = (id, checked) => {
    const row = walk(view()).find(
      (node) =>
        node.type === SubcontractCatalogOption && node.props.item.id === id,
    );
    const checkbox = walk(SubcontractCatalogOption(row.props)).find(
      (node) =>
        node.props['aria-label'] ===
        `Select ${row.props.item.code} from catalogue`,
    );
    checkbox.props.onCheckedChange(checked);
  };
  toggle('router', true);
  query = 'optical';
  toggle('cable', true);
  assert.deepEqual(selectedIds, ['router', 'cable']);
  assert.deepEqual(batches, []);
  const html = render(SubcontractCatalogSelection, {
    ...props(catalog, { query }),
    matches: filterSubcontractCatalog(catalog, query),
    selectedIds,
    onSelectionChange: noop,
    onAdd: noop,
  });
  assert.match(html, /2 selected/);
  assert.match(html, /1 outside this search/);
  assert.match(html, /Add 2 Items/);
  control(view(), 'Add 2 Items').props.onClick();
  assert.deepEqual(batches, [[catalog[0], catalog[1]]]);
});

test('select visible only adds matching eligible items and preserves hidden selections', () => {
  const catalog = [
    ...initial(),
    item({
      id: 'foreign',
      code: 'USD-CABLE',
      item: 'Install cable',
      unit: 'm',
      currency: 'USD',
    }),
    item({ id: 'inactive', code: 'INACTIVE', active: false }),
  ];
  let selectedIds = ['router'];
  const view = () =>
    SubcontractCatalogSelection({
      ...props(catalog, { query: 'cable' }),
      matches: filterSubcontractCatalog(catalog, 'cable'),
      selectedIds,
      onSelectionChange: (ids) => (selectedIds = ids),
      onAdd: noop,
    });
  control(view(), 'Select Visible').props.onClick();
  assert.deepEqual(selectedIds, ['router', 'cable']);
  control(view(), 'Deselect Visible').props.onClick();
  assert.deepEqual(selectedIds, ['router']);
  assert.deepEqual(
    filterSubcontractCatalog(catalog, 'Optical fibre').map((entry) => entry.id),
    ['cable'],
  );
  assert.deepEqual(
    filterSubcontractCatalog(catalog, 'core router').map((entry) => entry.id),
    ['router'],
  );
  assert.equal(filterSubcontractCatalog(catalog, 'inactive').length, 0);
});

test('refresh resolves each selected identity once against current values and discards stale references', () => {
  const original = initial();
  const refreshed = [
    item({ unitPrice: 450 }),
    item({ id: 'cable', code: 'CABLE', active: false }),
    item({ id: 'test', code: 'TEST', unit: null }),
  ];
  const result = resolveSelectedSubcontractItems(refreshed, [
    'router',
    'router',
    'cable',
    'test',
    'removed',
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0], refreshed[0]);
  assert.equal(result[0].unitPrice, 450);
  assert.equal(original[0].unitPrice, 200);
  const prunedIds = result.map((entry) => entry.id);
  assert.deepEqual(
    resolveSelectedSubcontractItems(initial(), prunedIds).map(
      (entry) => entry.id,
    ),
    ['router'],
  );
  const repeated = [item({ unitPrice: 200 }), item({ unitPrice: 0 })];
  assert.deepEqual(
    filterSubcontractCatalog(repeated, '').map((entry) => entry.unitPrice),
    [0],
  );
  assert.deepEqual(
    resolveSelectedSubcontractItems(repeated, ['router', 'router']).map(
      (entry) => entry.unitPrice,
    ),
    [0],
  );
});

test('existing BOQ identities are visibly added and cannot be selected or submitted again', () => {
  const catalog = initial(),
    existingItemIds = ['router'];
  const toggles = [];
  const tree = SubcontractCatalogOption({
    item: catalog[0],
    selected: false,
    existingItemIds,
    onToggle: (checked) => toggles.push(checked),
  });
  const checkbox = walk(tree).find(
    (node) => node.props['aria-label'] === 'Select ROUTER from catalogue',
  );
  assert.equal(checkbox.props.disabled, true);
  checkbox.props.onCheckedChange(true);
  assert.deepEqual(toggles, []);
  assert.deepEqual(
    resolveSelectedSubcontractItems(
      catalog,
      ['router', 'cable'],
      existingItemIds,
    ),
    [catalog[1]],
  );
  const html = render(SubcontractCatalogOption, {
    item: catalog[0],
    selected: false,
    existingItemIds,
    onToggle: noop,
  });
  assert.match(html, /Added/);
  assert.match(html, /Already added to this BOQ/);
});

test('unpriced drafts are selectable while foreign currency and missing units explain why they are disabled', () => {
  const unpriced = item({ unitPrice: null }),
    free = item({ unitPrice: 0 }),
    foreign = item({ currency: 'USD' }),
    missingUnit = item({ unit: null });
  for (const entry of [unpriced, free])
    assert.equal(subcontractCatalogRestriction(entry), '');
  for (const entry of [foreign, missingUnit]) {
    const tree = SubcontractCatalogOption({
      item: entry,
      selected: false,
      onToggle: () => assert.fail('ineligible selection'),
    });
    const checkbox = walk(tree).find(
      (node) => node.props['aria-label'] === 'Select ROUTER from catalogue',
    );
    assert.equal(checkbox.props.disabled, true);
    checkbox.props.onCheckedChange(true);
  }
  assert.match(
    render(SubcontractCatalogOption, {
      item: foreign,
      selected: false,
      onToggle: noop,
    }),
    /Currency conversion is not available/,
  );
  assert.match(
    render(SubcontractCatalogOption, {
      item: missingUnit,
      selected: false,
      onToggle: noop,
    }),
    /Set the unit in Master Data/,
  );
  assert.match(
    render(SubcontractCatalogOption, {
      item: unpriced,
      selected: false,
      onToggle: noop,
    }),
    /Not priced/,
  );
  assert.doesNotMatch(
    render(SubcontractCatalogOption, {
      item: free,
      selected: false,
      onToggle: noop,
    }),
    /Not priced/,
  );
  const html = render(SubcontractCatalogSelection, {
    ...props([unpriced]),
    matches: [unpriced],
    selectedIds: ['router'],
    onSelectionChange: noop,
    onAdd: noop,
  });
  assert.match(html, /Add as draft and set prices in the BOQ/);
});

test('locked and refreshing pickers suppress selection mutation and batch actions', () => {
  for (const state of [{ disabled: true }, { refreshing: true }]) {
    const base = {
      ...props(initial(), state),
      matches: initial(),
      selectedIds: ['router'],
      onSelectionChange: () => assert.fail('selection mutation'),
      onAdd: () => assert.fail('batch add'),
    };
    const tree = SubcontractCatalogSelection(base);
    for (const label of ['Clear Selection', 'Select Visible', 'Add 1 Item']) {
      const button = control(tree, label);
      assert.equal(button.props.disabled, true);
      button.props.onClick();
    }
    const row = walk(tree).find(
      (node) => node.type === SubcontractCatalogOption,
    );
    row.props.onToggle(true);
  }
});

test('empty and filtered results offer recovery without exposing obsolete supplier metadata', () => {
  const withMetadata = initial().map((entry) => ({
    ...entry,
    supplier: 'SECRET-SUPPLIER',
    pricingBasis: 'SECRET-PRICING',
  }));
  const html = render(SubcontractCatalogPicker, props(withMetadata));
  assert.doesNotMatch(html, /SECRET-SUPPLIER|SECRET-PRICING|<table/);
  assert.match(html, /Add 0 Items/);
  const filtered = render(
    SubcontractCatalogPicker,
    props(withMetadata, { query: 'missing-code' }),
  );
  assert.match(filtered, /No matching items/);
  assert.match(filtered, /Clear Search/);
  const empty = render(SubcontractCatalogPicker, props([]));
  assert.match(empty, /No active catalogue items/);
  assert.match(
    empty,
    /Refresh the catalogue, or add subcontract items in Master Data/,
  );
});

test('cancel dismisses the staged batch without submitting or changing any saved references', () => {
  const catalog = initial();
  const original = structuredClone(catalog);
  let closes = 0;
  const tree = SubcontractCatalogSelection({
    ...props(catalog, {
      onClose: () => (closes += 1),
      onSelect: () => assert.fail('cancel must not submit'),
    }),
    matches: catalog,
    selectedIds: ['router', 'cable'],
    onSelectionChange: () => assert.fail('cancel must not mutate selections'),
    onAdd: () => assert.fail('cancel must not add costs'),
  });
  control(tree, 'Cancel').props.onClick();
  assert.equal(closes, 1);
  assert.deepEqual(catalog, original);
});
