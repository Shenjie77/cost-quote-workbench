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
  PersonnelLinesTable,
  PersonnelNumberInput,
  PersonnelAllowanceOptions,
  blankPersonnelRow,
  patchPersonnelRows,
  getPersonnelMode,
  preparePersonnelModeChange,
  applyPersonnelModeChange,
  changePersonnelBasis,
  hasPartialLegacyAllowance,
} = await import('../features/cost/components/personnel-input-controls.tsx');
const { CostInputSheet } =
  await import('../features/cost/components/cost-input-sheet.tsx');
const { initialResourceTypes } =
  await import('../features/master-data/demo-data.ts');
const { initialRateSettings } = await import('../features/cost/demo-data.ts');
const { recalculateCostRows, getAllowancePools } =
  await import('../features/cost/domain.ts');
const { updatePersonnelCostRows } =
  await import('../features/cost/personnel-cost-rows.ts');
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
const resources = [
  ...initialResourceTypes,
  {
    ...initialResourceTypes.find((item) => item.pool === 'LOCAL'),
    id: 'rt-remote',
    code: 'REMOTE',
    name: 'Remote Support',
    pool: 'OTHER',
  },
];
const rates = {
  ...initialRateSettings,
  tdStart: '2026-01-01',
  baseYear: 2026,
  annualUplifts: [0, 0, 0, 0, 0],
};
const row = (extra = {}) =>
  recalculateCostRows(
    [
      {
        id: 'CI-1',
        scope: 'Router rollout',
        bu: 'Networks',
        reTypeId: resources.find((r) => r.pool === 'LOCAL').id,
        inputMode: 'sites',
        mdPerSite: 2,
        years: [1, 2, 3, 4, 5].map((sites, index) => ({
          bucket: `Y${index + 1}`,
          sites,
          cost: 0,
        })),
        ...extra,
      },
    ],
    resources,
    rates,
  )[0];
const tableProps = (line, extra = {}) => ({
  rows: [line],
  resources,
  rates,
  actualYears: [2026, 2027, 2028, 2029, 2030],
  onPatch: noop,
  onDelete: noop,
  announce: noop,
  ...extra,
});
const input = (props, label) =>
  walk(PersonnelLinesTable(props)).find(
    (node) => node.props['aria-label'] === label,
  );
const numeric = (props, label) =>
  walk(PersonnelLinesTable(props)).find(
    (node) => node.type === PersonnelNumberInput && node.props.label === label,
  );

test('inline personnel grid edits metadata and MD/Site without an edit dialog', () => {
  let rows = [row()];
  const props = tableProps(rows[0], {
    yearIndex: 2,
    onPatch: (id, patch) => {
      rows = patchPersonnelRows(rows, id, patch, resources, rates);
    },
  });
  const html = render(PersonnelLinesTable, props);
  assert.match(html, /aria-label="Scope for row CI-1"/);
  assert.match(html, /aria-label="BU for CI-1"/);
  assert.match(html, /aria-label="RE Type for CI-1"/);
  assert.doesNotMatch(html, /aria-label="Input mode for/);
  assert.match(html, /w-\[72px\] max-w-\[72px\]/);
  assert.match(html, /w-\[120px\] max-w-\[120px\]/);
  assert.match(html, /w-\[64px\] max-w-\[64px\]/);
  assert.match(html, /Total Sites/);
  assert.match(html, /Total MD/);
  assert.match(html, /Total Cost/);
  assert.doesNotMatch(html, /Edit personnel|Save Details|dialog/);
  input(props, 'Scope for row CI-1').props.onChange({
    target: { value: 'Inline rollout' },
  });
  input(props, 'BU for CI-1').props.onChange({ target: { value: 'Delivery' } });
  const md = numeric(props, 'Mandays per site for CI-1');
  PersonnelNumberInput(md.props).props.onChange({ target: { value: '4' } });
  assert.equal(rows[0].scope, 'Inline rollout');
  assert.equal(rows[0].bu, 'Delivery');
  assert.equal(rows[0].mdPerSite, 4);
  assert.deepEqual(
    rows[0].years.map((year) => year.sites),
    [1, 2, 3, 4, 5],
  );
  const recalculated = recalculateCostRows(rows, resources, rates)[0];
  assert.equal(recalculated.years[0].cost, row().years[0].cost * 2);
});

test('focused annual edit patches the latest raw row and preserves other years and concurrent metadata', () => {
  const shown = row();
  let latest = [
    {
      ...structuredClone(shown),
      bu: 'Updated by another input',
      source: {
        fileName: 'TD.xlsx',
        sha256: 'saved-hash',
        sheet: 'Plan',
        row: 7,
        mappingKey: 'map',
        role: 'TD',
        importedAt: '2026-09-09T00:00:00Z',
      },
    },
  ];
  latest[0].years[3].sites = 50;
  const before = structuredClone(latest[0]);
  const props = tableProps(shown, {
    yearIndex: 2,
    onPatch: (id, patch) => {
      latest = patchPersonnelRows(latest, id, patch, resources, rates);
    },
  });
  const html = render(PersonnelLinesTable, props);
  assert.match(html, /Y3 sites for CI-1/);
  assert.doesNotMatch(html, /Y1 sites|Y2 sites|Y4 sites|Y5 sites/);
  assert.doesNotMatch(html, /aria-label="Y3 cost/);
  PersonnelNumberInput(
    numeric(props, 'Y3 sites for CI-1').props,
  ).props.onChange({ target: { value: '9' } });
  assert.deepEqual(
    latest[0].years.map((year) => year.sites),
    [1, 2, 9, 50, 5],
  );
  assert.equal(latest[0].bu, before.bu);
  assert.deepEqual(latest[0].source, before.source);
  assert.deepEqual(
    latest[0].years.filter((_, index) => index !== 2),
    before.years.filter((_, index) => index !== 2),
  );
  assert.equal(shown.years[2].sites, 3);
});

test('metadata edits after allowance changes do not restore displayed costs or stale effort into raw rows', () => {
  const raw = row();
  const currentRates = { ...rates, allowancePools: ['LOCAL'] };
  const displayed = recalculateCostRows([raw], resources, currentRates)[0];
  assert.notDeepEqual(displayed.years, raw.years);
  let latest = [raw];
  const props = tableProps(displayed, {
    rates: currentRates,
    onPatch: (id, patch) => {
      latest = patchPersonnelRows(latest, id, patch, resources, currentRates);
    },
  });
  input(props, 'Scope for row CI-1').props.onChange({
    target: { value: 'Saved after allowance change' },
  });
  assert.equal(latest[0].scope, 'Saved after allowance change');
  assert.deepEqual(latest[0].years, raw.years);
  assert.deepEqual(
    recalculateCostRows(latest, resources, currentRates)[0].years,
    displayed.years,
  );
});

test('inline RE selection supports active internal types and preserves unknown or inactive saved references', () => {
  let latest = [row()];
  const other = resources.find((resource) => resource.pool === 'OTHER');
  const props = tableProps(latest[0], {
    onPatch: (id, patch) => {
      latest = patchPersonnelRows(latest, id, patch, resources, rates);
    },
  });
  input(props, 'RE Type for CI-1').props.onChange({
    target: { value: other.id },
  });
  assert.equal(latest[0].reTypeId, other.id);
  const subcontract = resources.find(
    (resource) => resource.category === 'subcontract',
  );
  const selected = input(props, 'RE Type for CI-1');
  assert.equal(
    walk(selected).some(
      (node) => node.type === 'option' && node.props.value === subcontract.id,
    ),
    false,
  );
  assert.deepEqual(
    patchPersonnelRows(
      latest,
      'CI-1',
      { field: 'reTypeId', value: subcontract.id },
      resources,
      rates,
    ),
    latest,
  );
  const unknown = row({ reTypeId: 'missing-re' });
  assert.match(
    render(PersonnelLinesTable, tableProps(unknown)),
    /Unknown: missing-re/,
  );
  const inactiveResources = resources.map((resource) =>
    resource.id === latest[0].reTypeId
      ? { ...resource, active: false }
      : resource,
  );
  assert.match(
    render(
      PersonnelLinesTable,
      tableProps(latest[0], { resources: inactiveResources }),
    ),
    /Inactive/,
  );
});

test('All Years keeps five inline allocations and new personnel immediately exposes editable cells', () => {
  const html = render(PersonnelLinesTable, tableProps(row()));
  assert.equal((html.match(/Y[1-5] sites for CI-1/g) || []).length, 5);
  assert.match(html, /sticky left-0/);
  assert.doesNotMatch(html, /sticky left-\[/);
  const fresh = blankPersonnelRow('CI-NEW', resources);
  const rendered = render(PersonnelLinesTable, tableProps(fresh));
  assert.match(rendered, /Scope for row CI-NEW/);
  assert.match(rendered, /BU for CI-NEW/);
  assert.match(rendered, /RE Type for CI-NEW/);
  assert.equal(fresh.years.length, 5);
  assert.equal(
    resources.find((resource) => resource.id === fresh.reTypeId).category,
    'internal',
  );
});

test('mode projection recognizes mixed historical rows without converting them', () => {
  const site = row(),
    direct = changePersonnelBasis(row({ id: 'CI-DIRECT' }), 'mandays');
  const before = structuredClone([site, direct]);
  assert.equal(getPersonnelMode([]), 'sites');
  assert.equal(getPersonnelMode([site]), 'sites');
  assert.equal(getPersonnelMode([direct]), 'mandays');
  assert.equal(getPersonnelMode([site, direct]), 'mixed');
  assert.deepEqual([site, direct], before);
});

test('bulk Direct MD conversion preserves every annual effort and source while leaving Subcon untouched', () => {
  const site = row({
    source: {
      fileName: 'TD.xlsx',
      sha256: 'saved-hash',
      sheet: 'Plan',
      row: 7,
      mappingKey: 'map',
      role: 'TD',
      importedAt: '2026-09-09T00:00:00Z',
    },
  });
  const direct = changePersonnelBasis(row({ id: 'CI-DIRECT' }), 'mandays');
  const legacy = row({
    id: 'LEGACY',
    reTypeId: resources.find((resource) => resource.category === 'subcontract')
      .id,
  });
  const shown = recalculateCostRows([site, direct], resources, {
    ...rates,
    allowancePools: ['LOCAL'],
  });
  const plan = preparePersonnelModeChange(shown, 'mandays');
  assert.equal(plan.error, undefined);
  assert.equal(plan.affectedCount, 1);
  assert.equal(plan.clearedMandays, 0);
  const latest = [{ ...site, bu: 'Current BU' }, direct, legacy];
  const saved = applyPersonnelModeChange(latest, plan, resources);
  assert.notEqual(saved, null);
  assert.deepEqual(
    saved[0].years.map((year) => year.mandays),
    [2, 4, 6, 8, 10],
  );
  assert.deepEqual(
    saved[0].years.map((year) => year.sites),
    [0, 0, 0, 0, 0],
  );
  assert.equal(saved[0].mdPerSite, 0);
  assert.equal(saved[0].bu, 'Current BU');
  assert.deepEqual(saved[0].source, site.source);
  assert.equal(saved[1], direct);
  assert.equal(saved[2], legacy);
  assert.equal(getPersonnelMode(saved.slice(0, 2)), 'mandays');
  assert.equal(site.inputMode, 'sites');
});

test('bulk clear preflight reports the entire affected set once and apply is atomic against membership or effort changes', () => {
  const first = changePersonnelBasis(row(), 'mandays');
  const second = changePersonnelBasis(row({ id: 'CI-TWO' }), 'mandays');
  const existingSite = row({ id: 'CI-SITE' });
  const original = [first, second, existingSite];
  const before = structuredClone(original);
  const plan = preparePersonnelModeChange(original, 'sites');
  assert.equal(plan.clearedMandays, 60);
  assert.equal(plan.affectedCount, 2);
  assert.deepEqual(
    original,
    before,
    'preflight leaves all effort unchanged until explicit action',
  );
  const saved = applyPersonnelModeChange(original, plan, resources);
  assert.deepEqual(
    saved.slice(0, 2).flatMap((line) => line.years.map((year) => year.sites)),
    Array(10).fill(0),
  );
  assert.equal(saved[2], existingSite);
  assert.equal(getPersonnelMode(saved), 'sites');
  const changed = structuredClone(original);
  changed[1].years[0].mandays = 99;
  for (const stale of [
    changed,
    original.slice(1),
    [...original, row({ id: 'CI-NEW' })],
  ]) {
    const beforeStale = structuredClone(stale);
    assert.equal(applyPersonnelModeChange(stale, plan, resources), null);
    assert.deepEqual(stale, beforeStale);
  }
  const changedUnaffected = structuredClone(original);
  changedUnaffected[2].years[0].sites = 88;
  assert.equal(
    applyPersonnelModeChange(changedUnaffected, plan, resources),
    null,
  );
  assert.equal(applyPersonnelModeChange(original, plan, resources, true), null);
  assert.deepEqual(original, before);
});

test('one oversized allocation blocks an entire bulk Direct MD conversion', () => {
  const valid = row();
  const large = row({
    id: 'CI-LARGE',
    mdPerSite: 2000,
    years: [1000, 0, 0, 0, 0].map((sites, index) => ({
      bucket: `Y${index + 1}`,
      sites,
      cost: 0,
    })),
  });
  const before = structuredClone([valid, large]);
  const plan = preparePersonnelModeChange([valid, large], 'mandays');
  assert.match(plan.error, /at most 1,000,000 MD per year/);
  assert.equal(plan.affectedCount, 2);
  assert.equal(applyPersonnelModeChange([valid, large], plan, resources), null);
  assert.deepEqual([valid, large], before);
  assert.equal(changePersonnelBasis(large, 'mandays'), large);
});

test('personnel patches preserve legacy subcontract costs and imported provenance', () => {
  const subcontract = row({
    id: 'LEGACY',
    reTypeId: resources.find((resource) => resource.category === 'subcontract')
      .id,
  });
  const source = {
    fileName: 'TD.xlsx',
    sha256: 'saved-hash',
    sheet: 'Plan',
    row: 7,
    mappingKey: 'map',
    role: 'TD',
    importedAt: '2026-09-09T00:00:00Z',
  };
  const personnel = row({ source });
  let rows = [subcontract, personnel];
  rows = patchPersonnelRows(
    rows,
    personnel.id,
    { field: 'scope', value: 'Updated import' },
    resources,
    rates,
  );
  assert.deepEqual(rows[0], subcontract);
  assert.deepEqual(rows[1].source, source);
  assert.deepEqual(
    patchPersonnelRows(
      rows,
      subcontract.id,
      { field: 'scope', value: 'Blocked' },
      resources,
      rates,
    ),
    rows,
  );
  const added = blankPersonnelRow('CI-NEW', resources);
  const next = updatePersonnelCostRows(rows, resources, (people) => [
    added,
    ...people,
  ]);
  assert.deepEqual(
    next.find((line) => line.id === 'LEGACY'),
    subcontract,
  );
  assert.ok(next.some((line) => line.id === 'CI-NEW'));
});

test('locked grid blocks inline writers while keeping year views available', () => {
  let writes = 0;
  const props = tableProps(row(), {
    locked: true,
    onPatch: () => writes++,
    onDelete: () => writes++,
  });
  for (const node of walk(PersonnelLinesTable(props))) {
    if (node.type === PersonnelNumberInput) {
      assert.equal(node.props.locked, true);
      PersonnelNumberInput(node.props).props.onChange({
        target: { value: '50' },
      });
    } else if (node.props.onChange && node.props['aria-label']) {
      assert.equal(node.props.disabled, true);
      node.props.onChange({
        target: {
          value: 'Changed',
        },
      });
    } else if (node.props['aria-label']?.startsWith('Delete cost'))
      node.props.onClick();
  }
  const original = row();
  assert.deepEqual(
    patchPersonnelRows(
      [original],
      original.id,
      { field: 'scope', value: 'Blocked' },
      resources,
      rates,
      true,
    ),
    [original],
  );
  const html = render(CostInputSheet, {
    rows: [original],
    setRows: noop,
    rateSettings: rates,
    setRateSettings: noop,
    resourceTypes: resources,
    includedTravelCost: 0,
    announce: noop,
    locked: true,
  });
  assert.match(html, /Locked · View only/);
  assert.doesNotMatch(html, /Search personnel rows/);
  assert.doesNotMatch(
    html.match(/<button[^>]*>All Years<\/button>/)?.[0] || '',
    /\sdisabled(?:=|\s|>)/,
  );
  assert.equal(writes, 0);
});

test('allowance uses exactly four Pool checkboxes and leaves historical individual choices untouched until edited', () => {
  const local = resources.find((resource) => resource.pool === 'LOCAL');
  const historical = { ...rates, allowanceResourceTypeIds: [local.id] };
  const before = structuredClone(historical),
    toggles = [];
  assert.equal(hasPartialLegacyAllowance(historical, resources), true);
  const props = {
    selectedPools: getAllowancePools(historical, resources),
    partialLegacy: true,
    onToggle: (pool, selected) => toggles.push([pool, selected]),
  };
  const html = render(PersonnelAllowanceOptions, props);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 4);
  for (const pool of ['LOCAL', 'ARP', 'HQ', 'OTHER'])
    assert.match(html, new RegExp(`3% allowance for ${pool}`));
  assert.doesNotMatch(html, /Search allowance|Select Visible|<details/);
  assert.match(html, /retained until edited/);
  assert.deepEqual(historical, before);
  walk(PersonnelAllowanceOptions(props))
    .find((node) => node.props['aria-label'] === '3% allowance for HQ')
    .props.onChange({ target: { checked: true } });
  assert.deepEqual(toggles, [['HQ', true]]);
  walk(PersonnelAllowanceOptions({ ...props, locked: true }))
    .find((node) => node.props['aria-label'] === '3% allowance for OTHER')
    .props.onChange({ target: { checked: true } });
  assert.equal(toggles.length, 1);
  assert.equal(
    hasPartialLegacyAllowance({ ...historical, allowancePools: [] }, resources),
    false,
  );
});
