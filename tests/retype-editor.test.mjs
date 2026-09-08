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

const { MasterDataView, ResourceIdentityCells } =
  await import('../features/master-data/master-data-view.tsx');
const { createResourceType, editResourceType, resourceClassificationIssue } =
  await import('../features/master-data/resource-editing.ts');
const { initialResourceTypes } =
  await import('../features/master-data/demo-data.ts');
const { recalculateCostRows, getCostStatementValues } =
  await import('../features/cost/domain.ts');
const { initialRateSettings, initialManualCostInputs } =
  await import('../features/cost/demo-data.ts');
const { DatabaseSync } = await import('node:sqlite');
const { LOCAL_DATABASE_STATEMENTS } = await import('../db/schema.ts');
const { initializeGlobalMasterData, makeGlobalMasterDataStore } =
  await import('../server/global-master-data.mjs');
hooks.deregister();
const noop = () => {};
const resource = () => createResourceType('rt-manual', 'MANUAL', '2026-01-01');
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const props = {
  activeTab: 'resources',
  onTabChange: noop,
  onSave: async () => true,
  resourceTypes: initialResourceTypes,
  setResourceTypes: noop,
  subcontractItems: [],
  setSubcontractItems: noop,
  supplementalCostItems: [],
  setSupplementalCostItems: noop,
  maintenancePriceRecords: [],
  setMaintenancePriceRecords: noop,
  assumptionLibrary: [],
  setAssumptionLibrary: noop,
  quoteTemplates: [],
  setQuoteTemplates: noop,
  processSteps: [],
  setProcessSteps: noop,
  projectStatusDefinitions: [],
  setProjectStatusDefinitions: noop,
  catalog: [],
  setCatalog: noop,
  announce: noop,
};

test('manual RE defaults to internal LOCAL L1 and visible editable classification', () => {
  const row = resource();
  assert.equal(row.category, 'internal');
  assert.equal(row.pool, 'LOCAL');
  assert.equal(row.level, 'L1');
  assert.equal(row.hqTravel, false);
  const markup = renderToStaticMarkup(
    React.createElement(MasterDataView, {
      ...props,
      resourceTypes: [...initialResourceTypes, row],
    }),
  );
  for (const label of [
    'Category / 种类',
    'Internal / 自有',
    'Subcontract / 分包',
  ])
    assert.ok(markup.includes(label));
  for (const field of ['category', 'pool', 'level'])
    assert.match(
      markup,
      new RegExp(`<select[^>]*aria-label="RE-MANUAL ${field}"`),
    );
  assert.match(markup, /aria-label="RE-MANUAL code"/);
  assert.match(markup, /aria-label="RE-MANUAL name"/);
});

test('actual RE controls update category and dependents in one event without changing code or name', () => {
  let row = { ...resource(), code: 'ENGINEER-2026', name: 'Customer Engineer' };
  let events = 0;
  const tree = () =>
    ResourceIdentityCells({
      row,
      onChange(key, value) {
        events++;
        row = editResourceType(row, key, value);
      },
    });
  const change = (field, value) => {
    const select = walk(tree()).find(
      (node) =>
        node.type === 'select' &&
        node.props['aria-label'].endsWith(` ${field}`),
    );
    assert.ok(select);
    const before = events;
    select.props.onChange({ target: { value } });
    assert.equal(events, before + 1);
    assert.equal(row.code, 'ENGINEER-2026');
    assert.equal(row.name, 'Customer Engineer');
    assert.equal(resourceClassificationIssue(row), null);
  };
  change('pool', 'HQ');
  assert.equal(row.hqTravel, true);
  change('level', 'L4');
  assert.equal(row.level, 'L4');
  change('pool', 'ARP');
  assert.equal(row.hqTravel, false);
  change('level', 'L0');
  change('category', 'subcontract');
  assert.deepEqual([row.pool, row.level, row.hqTravel], [null, null, false]);
  for (const control of walk(tree()).filter(
    (node) =>
      node.type === 'select' && / (pool|level)$/.test(node.props['aria-label']),
  ))
    assert.equal(control.props.disabled, true);
  change('category', 'internal');
  assert.deepEqual([row.pool, row.level, row.hqTravel], ['LOCAL', 'L1', false]);
  for (const control of walk(tree()).filter(
    (node) =>
      node.type === 'select' && / (pool|level)$/.test(node.props['aria-label']),
  ))
    assert.equal(control.props.disabled, false);
});

test('code and name edits remain independent of all classification controls', () => {
  let row = resource();
  const edit = (field, value) => {
    const tree = ResourceIdentityCells({
      row,
      onChange(key, val) {
        row = editResourceType(row, key, val);
      },
    });
    const input = walk(tree).find((node) =>
      node.props.ariaLabel?.endsWith(` ${field}`),
    );
    assert.ok(input);
    input.props.onChange(value);
  };
  edit('code', 'CUSTOM-LOCAL');
  edit('name', 'Local Specialist');
  assert.equal(row.code, 'CUSTOM-LOCAL');
  assert.equal(row.name, 'Local Specialist');
  row = editResourceType(row, 'pool', 'HQ');
  row = editResourceType(row, 'level', 'L3');
  assert.equal(row.code, 'CUSTOM-LOCAL');
  assert.equal(row.name, 'Local Specialist');
});

test('new internal RE calculates own labour; explicitly selected subcontract remains a package', () => {
  const internal = { ...resource(), mandayRate: 600 };
  const subcontract = {
    ...editResourceType(
      { ...resource(), id: 'rt-package' },
      'category',
      'subcontract',
    ),
    mandayRate: 900,
  };
  const costRows = [internal, subcontract].map((re, index) => ({
    id: `cost-${index}`,
    scope: 'Delivery',
    bu: 'Services',
    reTypeId: re.id,
    mdPerSite: 10,
    years: [1, 0, 0, 0, 0].map((sites, i) => ({
      bucket: `Y${i + 1}`,
      sites,
      cost: i === 0 ? 1000 : 0,
    })),
  }));
  const rates = {
    ...initialRateSettings,
    baseYear: 2026,
    tdStart: '2026-01-01',
    tdEnd: '2026-12-31',
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
  };
  const rows = recalculateCostRows(costRows, [internal, subcontract], rates);
  assert.equal(rows[0].years[0].cost, 6000);
  assert.equal(rows[1].years[0].cost, 1000);
  const manual = Object.fromEntries(
    Object.keys(initialManualCostInputs).map((key) => [key, 0]),
  );
  const summary = getCostStatementValues(
    rows,
    [internal, subcontract],
    0,
    manual,
  );
  assert.equal(summary.inHouseLabour, 6000);
  assert.equal(summary.subcontract, 1000);
  assert.equal(summary.sales, 7000);
});

test('invalid imported classifications are visible and global save rejects without rewriting records', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const sql of LOCAL_DATABASE_STATEMENTS) db.exec(sql);
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const before = store.get('resources');
    const invalidRows = [
      { ...resource(), pool: null },
      { ...resource(), level: null },
      { ...resource(), category: 'subcontract' },
      { ...resource(), hqTravel: true },
      { ...resource(), category: 'unknown' },
    ];
    for (const row of invalidRows) {
      assert.ok(resourceClassificationIssue(row));
      const original = structuredClone(row);
      const markup = renderToStaticMarkup(
        React.createElement(
          'table',
          {},
          React.createElement(
            'tbody',
            {},
            React.createElement(
              'tr',
              {},
              React.createElement(ResourceIdentityCells, {
                row,
                onChange: noop,
              }),
            ),
          ),
        ),
      );
      assert.match(markup, /role="alert"/);
      assert.deepEqual(row, original);
      assert.throws(() =>
        store.update('resources', { upsert: [row] }, before.revision),
      );
      assert.equal(store.get('resources').revision, before.revision);
      assert.deepEqual(store.get('resources').items, before.items);
    }
    assert.throws(
      () => editResourceType(resource(), 'pool', 'UNKNOWN'),
      /Pool/,
    );
    assert.throws(() => editResourceType(resource(), 'level', 'L9'), /Level/);
    assert.throws(
      () => editResourceType(resource(), 'category', 'other'),
      /Select/,
    );
    assert.throws(
      () =>
        editResourceType(
          editResourceType(resource(), 'category', 'subcontract'),
          'pool',
          'LOCAL',
        ),
      /Pool/,
    );
  } finally {
    db.close();
  }
});
