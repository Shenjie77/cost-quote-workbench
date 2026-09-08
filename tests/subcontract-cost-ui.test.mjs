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
  SubcontractCostSheet,
  SubcontractNumberInput,
  SubcontractLinesTable,
  LegacySubcontractCosts,
  copySubcontractCatalogLine,
  changeSubcontractMode,
  duplicateSubcontractSiteType,
  appendSubcontractLines,
  removeSubcontractSiteLine,
} = await import('../features/cost/components/subcontract-cost-sheet.tsx');
const { emptySubcontractCost } =
  await import('../features/cost/subcontract-domain.ts');
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
const actualYears = [2026, 2027, 2028, 2029, 2030];
const catalogItem = (extra = {}) => ({
  id: 'catalog-1',
  code: 'ROUTER',
  item: 'Install router',
  bu: 'Network',
  unit: 'pcs',
  unitPrice: 200,
  currency: 'SGD',
  active: true,
  ...extra,
});
const line = (extra = {}) => ({
  id: 'line-1',
  catalogItemId: 'catalog-1',
  code: 'ROUTER',
  description: 'Install router',
  bu: 'Network',
  unit: 'pcs',
  unitPrice: 200,
  currency: 'SGD',
  quantities: [1, 2, 0, 0, 0],
  ...extra,
});
const site = (extra = {}) => ({
  id: 'site-1',
  name: 'Small Site',
  sites: [2, 3, 0, 0, 0],
  lines: [
    {
      id: 'site-line-1',
      code: 'CABLE',
      description: 'Install cable',
      bu: 'Network',
      unit: 'm',
      unitPrice: 10,
      currency: 'SGD',
      quantityPerSite: 25,
    },
  ],
  ...extra,
});
const sheetProps = (value, extra = {}) => ({
  value,
  onChange: noop,
  catalog: [],
  actualYears,
  announce: noop,
  ...extra,
});
const inputMarkup = (html, label) =>
  html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0];

test('new subcontract editor defaults to annual project BOQ without deploying empty site types', () => {
  const value = emptySubcontractCost();
  const html = render(SubcontractCostSheet, sheetProps(value));
  assert.match(html, /value="project" selected/);
  assert.match(html, /Project BOQ/);
  assert.match(html, /Y1 · 2026/);
  assert.match(html, /Y5 · 2030/);
  assert.doesNotMatch(
    html,
    /Annual Site Deployments|Supplier|Pricing Basis|MD\/Site|RE Type/,
  );
  assert.deepEqual(value, { mode: 'project', lines: [], siteTypes: [] });
});

test('saved line prices and legacy amounts remain included despite newer catalogue prices', () => {
  const value = {
    mode: 'project',
    lines: [
      line(),
      line({ id: 'free', code: 'FREE', unitPrice: 0 }),
      line({ id: 'unpriced', code: 'UNPRICED', unitPrice: null }),
    ],
    siteTypes: [],
  };
  const original = structuredClone(value);
  const legacyRows = [
    {
      id: 'legacy-1',
      scope: 'Original PM package',
      bu: 'Network',
      reTypeId: 'legacy-re',
      mdPerSite: 1,
      years: [{ bucket: 'Y1', sites: 1, cost: 300 }],
    },
  ];
  const html = render(
    SubcontractCostSheet,
    sheetProps(value, {
      catalog: [catalogItem({ unitPrice: 9999 })],
      legacyRows,
    }),
  );
  assert.match(inputMarkup(html, 'ROUTER unit price'), /value="200"/);
  assert.match(inputMarkup(html, 'FREE unit price'), /value="0"/);
  assert.match(inputMarkup(html, 'UNPRICED unit price'), /value=""/);
  assert.match(html, /Not priced/);
  assert.match(html, /Priced Subtotal/);
  assert.match(html, /900.00/);
  assert.match(html, /Legacy Subcontract Costs/);
  assert.match(html, /Original PM package/);
  assert.doesNotMatch(html, /9,999|value="9999"|legacy-re/);
  assert.deepEqual(value, original);
});

test('site deployments include shared project lines and cannot be hidden by changing mode', () => {
  const value = {
    mode: 'site-types',
    lines: [line({ unitPrice: 100, quantities: [1, 0, 0, 0, 0] })],
    siteTypes: [site()],
  };
  const original = structuredClone(value);
  const html = render(SubcontractCostSheet, sheetProps(value));
  assert.match(html, /BOQ per Site/);
  assert.match(html, /Annual Site Deployments/);
  assert.match(html, /Shared \/ One-off Project Costs/);
  assert.match(html, /1,350.00/);
  assert.match(inputMarkup(html, 'CABLE quantity per site'), /value="25"/);
  assert.match(inputMarkup(html, 'Small Site Y1 sites'), /value="2"/);
  assert.throws(
    () => changeSubcontractMode(value, 'project'),
    /cannot be hidden/,
  );
  assert.throws(
    () =>
      changeSubcontractMode(
        { ...value, siteTypes: [site({ sites: [0, 0, 0, 0, 0] })] },
        'project',
      ),
    /cannot be hidden/,
  );
  assert.equal(
    changeSubcontractMode(
      { ...value, siteTypes: [site({ sites: [0, 0, 0, 0, 0], lines: [] })] },
      'project',
    ).mode,
    'project',
  );
  assert.deepEqual(value, original);
});

test('catalogue adoption copies values, preserves null and zero, and rejects unsupported references', () => {
  const item = catalogItem({
    supplier: 'Legacy supplier',
    pricingBasis: 'Per unit',
  });
  const copied = copySubcontractCatalogLine(item);
  item.unitPrice = 800;
  item.item = 'Changed catalogue';
  assert.equal(copied.unitPrice, 200);
  assert.equal(copied.description, 'Install router');
  assert.equal(copied.catalogItemId, item.id);
  assert.equal(copied.currency, 'SGD');
  assert.notEqual(copied.id, item.id);
  assert.equal(Object.hasOwn(copied, 'supplier'), false);
  assert.equal(Object.hasOwn(copied, 'pricingBasis'), false);
  assert.equal(
    copySubcontractCatalogLine(catalogItem({ unitPrice: null })).unitPrice,
    null,
  );
  assert.equal(
    copySubcontractCatalogLine(catalogItem({ unitPrice: 0 })).unitPrice,
    0,
  );
  assert.throws(
    () => copySubcontractCatalogLine(catalogItem({ currency: 'USD' })),
    /Only SGD/,
  );
  assert.throws(
    () => copySubcontractCatalogLine(catalogItem({ unit: null })),
    /no unit/,
  );
});

test('quantity controls accept metres, reject fractional pieces, preserve blank prices and honor locks', () => {
  const accepted = [],
    errors = [];
  const input = (extra = {}) =>
    SubcontractNumberInput({
      value: 0,
      label: 'quantity',
      onChange: (value) => accepted.push(value),
      announce: (message) => errors.push(message),
      ...extra,
    });
  input().props.onChange({ target: { value: '2.75' } });
  input({ integer: true }).props.onChange({ target: { value: '2.75' } });
  input({ integer: true }).props.onChange({ target: { value: '3' } });
  input({ price: true }).props.onChange({ target: { value: '' } });
  input({ price: true }).props.onChange({ target: { value: '0' } });
  input({ locked: true }).props.onChange({ target: { value: '999' } });
  input().props.onChange({ target: { value: '-1' } });
  assert.deepEqual(accepted, [2.75, 3, null, 0]);
  assert.equal(errors.length, 2);
});

test('inline draft price changes preserve quantities and saved unit', () => {
  const changes = [],
    errors = [];
  const item = line({
    code: 'CABLE',
    unit: 'm',
    quantities: [2.5, 0, 0, 0, 0],
  });
  const props = {
    lines: [item],
    project: true,
    actualYears,
    onChange: (line) => changes.push(line),
    onDelete: noop,
    announce: (message) => errors.push(message),
  };
  const nodes = walk(SubcontractLinesTable(props));
  const price = nodes.find(
    (node) =>
      node.type === SubcontractNumberInput &&
      node.props.label === 'CABLE unit price',
  );
  SubcontractNumberInput(price.props).props.onChange({
    target: { value: '80' },
  });
  assert.equal(changes[0].unitPrice, 80);
  assert.equal(changes[0].unit, 'm');
  assert.equal(item.unitPrice, 200);
});

test('duplicated configurations keep saved BOQ prices with new identities and zero deployments', () => {
  const original = site();
  const copied = duplicateSubcontractSiteType(original);
  assert.notEqual(copied.id, original.id);
  assert.notEqual(copied.lines[0].id, original.lines[0].id);
  assert.equal(copied.name, 'Small Site (Copy)');
  assert.deepEqual(copied.sites, [0, 0, 0, 0, 0]);
  assert.equal(
    copied.lines[0].quantityPerSite,
    original.lines[0].quantityPerSite,
  );
  assert.equal(copied.lines[0].unitPrice, original.lines[0].unitPrice);
  copied.sites[0] = 10;
  copied.lines[0].unitPrice = 500;
  assert.equal(original.sites[0], 2);
  assert.equal(original.lines[0].unitPrice, 10);
});

test('locked cost remains readable while inputs and legacy removal stay disabled', () => {
  const legacyRows = [
    {
      id: 'legacy',
      scope: 'Legacy package',
      bu: 'Network',
      reTypeId: 'old',
      mdPerSite: 1,
      years: [{ bucket: 'Y1', sites: 2, cost: 125 }],
    },
  ];
  const html = render(
    SubcontractCostSheet,
    sheetProps(
      { mode: 'site-types', lines: [line()], siteTypes: [site()] },
      { lockedReason: 'Confirmed V1', legacyRows, onRemoveLegacyRow: noop },
    ),
  );
  assert.match(html, /Read only · Confirmed V1/);
  assert.match(html, /Legacy package/);
  for (const input of html.match(/<input[^>]*>/g) || [])
    assert.match(input, /disabled/, input);
  assert.match(html.match(/<select[^>]*>/)?.[0] || '', /disabled/);
  const removed = [];
  const tree = LegacySubcontractCosts({
    rows: legacyRows,
    actualYears,
    locked: true,
    onRemove: (id) => removed.push(id),
  });
  const remove = walk(tree).find(
    (node) =>
      node.props['aria-label'] === 'Remove legacy subcontract Legacy package',
  );
  assert.equal(remove.props.disabled, true);
  remove.props.onClick();
  assert.deepEqual(removed, []);
  assert.doesNotMatch(html, /RE Type|MD\/Site|Pricing Basis|Supplier/);
});

test('batch catalogue adoption is scoped, atomic, deduplicated and never reprices existing entries', () => {
  const value = { mode: 'site-types', lines: [line()], siteTypes: [site()] };
  const original = structuredClone(value);
  const fresh = copySubcontractCatalogLine(
    catalogItem({ id: 'new-catalog', code: 'NEW', unitPrice: 80 }),
  );
  const existing = copySubcontractCatalogLine(catalogItem({ unitPrice: 9999 }));
  const next = appendSubcontractLines(
    value,
    [existing, fresh, { ...fresh, id: 'duplicate' }],
    { kind: 'project' },
  );
  assert.equal(next.lines.length, 2);
  assert.equal(next.lines[0].unitPrice, 200);
  assert.equal(next.lines[1].unitPrice, 80);
  assert.deepEqual(next.lines[1].quantities, [0, 0, 0, 0, 0]);
  assert.equal(next.siteTypes, value.siteTypes);
  assert.deepEqual(value, original);
  assert.equal(
    appendSubcontractLines(next, [existing, fresh], { kind: 'project' }),
    next,
  );
  const siteNext = appendSubcontractLines(value, [existing, fresh], {
    kind: 'site',
    id: 'site-1',
  });
  assert.equal(siteNext.siteTypes[0].lines.length, 3);
  assert.equal(siteNext.siteTypes[0].lines[1].quantityPerSite, 0);
  assert.equal(siteNext.lines, value.lines);
  assert.throws(
    () =>
      appendSubcontractLines(value, [fresh], {
        kind: 'site',
        id: 'deleted-site',
      }),
    /no longer available/,
  );
  assert.deepEqual(value, original);
});

test('locked cost keeps year and site navigation available without editable costs', () => {
  const html = render(
    SubcontractCostSheet,
    sheetProps(
      { mode: 'site-types', lines: [line()], siteTypes: [site()] },
      { lockedReason: 'Confirmed V1' },
    ),
  );
  for (const label of [
    'Project BOQ quantity year',
    'Select subcontract site type',
  ]) {
    const select = html.match(
      new RegExp('<select[^>]*aria-label="' + label + '"[^>]*>'),
    )?.[0];
    assert.ok(select, label);
    assert.doesNotMatch(select, /disabled/);
  }
});

test('a site with ID project keeps catalogue additions in its own BOQ', () => {
  const value = {
    mode: 'site-types',
    lines: [],
    siteTypes: [site({ id: 'project' })],
  };
  const next = appendSubcontractLines(
    value,
    [copySubcontractCatalogLine(catalogItem())],
    { kind: 'site', id: 'project' },
  );
  assert.equal(next.lines.length, 0);
  assert.equal(next.siteTypes[0].lines.length, 2);
  assert.equal(next.siteTypes[0].lines[1].quantityPerSite, 0);
  assert.throws(
    () =>
      appendSubcontractLines(
        { ...value, mode: 'project' },
        [copySubcontractCatalogLine(catalogItem())],
        { kind: 'site', id: 'project' },
      ),
    /cost model has changed/,
  );
});

test('last site BOQ deletion clears deployments atomically and leaves other site items intact', () => {
  const original = site();
  const next = removeSubcontractSiteLine(original, original.lines[0].id);
  assert.deepEqual(next.lines, []);
  assert.deepEqual(next.sites, [0, 0, 0, 0, 0]);
  assert.deepEqual(original.sites, [2, 3, 0, 0, 0]);
  const populated = site({
    lines: [...original.lines, { ...original.lines[0], id: 'another' }],
  });
  const retained = removeSubcontractSiteLine(populated, original.lines[0].id);
  assert.equal(retained.lines.length, 1);
  assert.deepEqual(retained.sites, populated.sites);
});
