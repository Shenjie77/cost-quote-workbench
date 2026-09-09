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
  groupPersonnelRows,
  personnelDropPosition,
} = await import('../features/cost/components/personnel-input-controls.tsx');
const { CostInputSheet } =
  await import('../features/cost/components/cost-input-sheet.tsx');
const { usePersonnelTableView } =
  await import('../features/cost/use-personnel-table-view.ts');
function StandaloneCostInputSheet(props) {
  const tableView = usePersonnelTableView();
  return React.createElement(CostInputSheet, { ...props, tableView });
}
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
  assert.doesNotMatch(html, /sticky left-0/);
  assert.match(
    render(
      PersonnelLinesTable,
      tableProps(row(), { columns: ['scope', 'Y1:sites', 'action'] }),
    ),
    /sticky left-0/,
  );
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

test('Action stays last and pinned to the right across header, rows and totals', () => {
  for (const yearIndex of ['all', 0]) {
    const nodes = walk(PersonnelLinesTable(tableProps(row(), { yearIndex })));
    const actions = nodes.filter(
      (node) => node.props['data-personnel-column'] === 'action',
    );
    assert.equal(actions.length, 3);
    for (const action of actions) {
      assert.match(action.props.className, /sticky right-0/);
      assert.match(action.props.className, /border-l/);
      assert.match(action.props.className, /bg-/);
    }
    const body = nodes.find(
      (node) => node.props['data-personnel-row'] === 'CI-1',
    );
    assert.equal(
      body.props.children.at(-1).props['data-personnel-column'],
      'action',
    );
  }
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
  const html = render(StandaloneCostInputSheet, {
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

test('independent Group names contain different Scopes and preserve first-seen group and row ordering', () => {
  const rows = [
    row({
      id: 'CI-A1',
      scope: 'HLD',
      groupName: '  Network Design & Planning  ',
    }),
    row({ id: 'CI-B1', scope: 'HLD', groupName: 'Implementation' }),
    row({ id: 'CI-A2', scope: 'LLD', groupName: 'Network Design & Planning' }),
    row({ id: 'CI-EMPTY1', scope: 'Network planning' }),
    row({ id: 'CI-CASE', scope: '', groupName: 'implementation' }),
    row({
      id: 'CI-B2',
      scope: 'Router installation',
      groupName: ' Implementation\n',
    }),
    row({ id: 'CI-EMPTY2', scope: 'HLD', groupName: '  ' }),
  ];
  const before = structuredClone(rows);
  const groups = groupPersonnelRows(rows);
  assert.deepEqual(
    groups.map((group) => group.groupName),
    ['Network Design & Planning', 'Implementation', '', 'implementation'],
  );
  assert.deepEqual(
    groups.map((group) => group.rows.map((line) => line.id)),
    [
      ['CI-A1', 'CI-A2'],
      ['CI-B1', 'CI-B2'],
      ['CI-EMPTY1', 'CI-EMPTY2'],
      ['CI-CASE'],
    ],
  );
  const props = tableProps(rows[0], { rows, grouped: true });
  const html = render(PersonnelLinesTable, props);
  assert.deepEqual(
    [...html.matchAll(/aria-label="Scope for row ([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ['CI-A1', 'CI-A2', 'CI-B1', 'CI-B2', 'CI-EMPTY1', 'CI-EMPTY2', 'CI-CASE'],
  );
  assert.match(html, /Unassigned Group/);
  assert.equal((html.match(/data-personnel-group=/g) || []).length, 4);
  const flat = render(PersonnelLinesTable, { ...props, grouped: false });
  assert.doesNotMatch(flat, /data-personnel-group=/);
  assert.deepEqual(
    [...flat.matchAll(/aria-label="Scope for row ([^"]+)"/g)].map(
      (match) => match[1],
    ),
    rows.map((line) => line.id),
  );
  assert.deepEqual(rows, before);
});

test('group headers contain no amount rows and totals remain aligned under focused, reordered and hidden columns', () => {
  const rows = [
    row({ id: 'A1', groupName: 'Design', scope: 'HLD' }),
    row({ id: 'B1', groupName: 'Build' }),
    row({ id: 'A2', groupName: 'Design', scope: 'LLD' }),
  ];
  for (const yearIndex of [2, 'all']) {
    const props = tableProps(rows[0], { rows, yearIndex });
    const grouped = walk(PersonnelLinesTable({ ...props, grouped: true }));
    const flat = walk(PersonnelLinesTable(props));
    const headers = grouped.filter((node) =>
      Object.hasOwn(node.props, 'data-personnel-group'),
    );
    assert.equal(headers.length, 2);
    for (const header of headers) {
      assert.equal(
        header.props.children.props.colSpan,
        yearIndex === 'all' ? 25 : 13,
      );
      assert.equal(
        walk(header).filter((node) => node.type === PersonnelNumberInput)
          .length,
        0,
      );
    }
    const footer = (nodes) =>
      nodes.find(
        (node) => node.props.className === 'bg-[#eeece6] font-semibold',
      );
    assert.equal(
      renderToStaticMarkup(footer(grouped)),
      renderToStaticMarkup(footer(flat)),
    );
    assert.equal(
      grouped.filter((node) =>
        node.props['aria-label']?.startsWith('Scope for row '),
      ).length,
      rows.length,
    );
  }
  const columns = [
    'scope',
    'Y2:cost',
    'bu',
    'Y1:sites',
    'Y1:cost',
    'Y2:mandays',
    'totalCost',
    'action',
  ];
  const props = tableProps(rows[0], { rows, columns, grouped: true });
  const nodes = walk(PersonnelLinesTable(props));
  const firstRow = nodes.find(
    (node) => node.props['data-personnel-row'] === 'A1',
  );
  assert.deepEqual(
    firstRow.props.children.map((node) => node.props['data-personnel-column']),
    columns,
  );
  const yearHeads = nodes.filter(
    (node) =>
      node.props.colSpan && node.props.className?.includes('text-center'),
  );
  assert.deepEqual(
    yearHeads.map((node) => node.props.colSpan),
    [1, 2, 1],
  );
  const html = render(PersonnelLinesTable, props);
  assert.match(html, /Y1 sites for A1/);
  assert.doesNotMatch(html, /Y2 sites for A1|Y1 direct mandays|Group for A1/);
  const focused = walk(PersonnelLinesTable({ ...props, yearIndex: 1 }));
  assert.deepEqual(
    focused
      .find((node) => node.props['data-personnel-row'] === 'A1')
      .props.children.map((node) => node.props['data-personnel-column']),
    ['scope', 'Y2:cost', 'bu', 'Y2:mandays', 'totalCost', 'action'],
  );
  assert.equal(
    focused.find((node) => Object.hasOwn(node.props, 'data-personnel-group'))
      .props.children.props.colSpan,
    6,
  );
  const noAnnual = render(PersonnelLinesTable, { ...props, yearIndex: 4 });
  assert.match(noAnnual, /No columns selected for Y5/);
  assert.doesNotMatch(noAnnual, /Y5 sites|Y5 direct mandays/);
});

test('Scope edits never regroup rows, Group edits preserve Scope and provenance, and delete uses stable row IDs', () => {
  let current = [
    row({ id: 'CI-A1', groupName: 'Design', scope: 'HLD' }),
    row({ id: 'CI-B1', groupName: 'Build' }),
    row({ id: 'CI-A2', groupName: 'Design', scope: 'LLD' }),
  ];
  const deleted = [];
  const props = () =>
    tableProps(current[0], {
      rows: current,
      grouped: true,
      onPatch: (id, patch) => {
        current = patchPersonnelRows(current, id, patch, resources, rates);
      },
      onDelete: (line) => deleted.push(line.id),
    });
  input(props(), 'Scope for row CI-A2').props.onChange({
    target: { value: 'Network planning' },
  });
  assert.deepEqual(
    groupPersonnelRows(current).map((group) =>
      group.rows.map((line) => line.id),
    ),
    [['CI-A1', 'CI-A2'], ['CI-B1']],
  );
  const effort = structuredClone(current[2].years);
  input(props(), 'Group for CI-A2').props.onChange({
    target: { value: 'Build' },
  });
  assert.deepEqual(
    groupPersonnelRows(current).map((group) =>
      group.rows.map((line) => line.id),
    ),
    [['CI-A1'], ['CI-B1', 'CI-A2']],
  );
  assert.equal(current[2].scope, 'Network planning');
  assert.deepEqual(current[2].years, effort);
  input(props(), 'Group for CI-A2').props.onChange({
    target: { value: 'Network ' },
  });
  assert.equal(current[2].groupName, 'Network ');
  const rowNode = walk(PersonnelLinesTable(props())).find(
    (node) => node.key === 'row:CI-A2',
  );
  walk(rowNode)
    .find((node) => node.props['aria-label']?.startsWith('Delete cost row'))
    .props.onClick();
  assert.deepEqual(deleted, ['CI-A2']);
  const before = structuredClone(current);
  const locked = {
    ...props(),
    locked: true,
    onPatch: () => assert.fail('Locked rows must not write'),
  };
  input(locked, 'Group for CI-A1').props.onChange({
    target: { value: 'Blocked' },
  });
  input(locked, 'Scope for row CI-A1').props.onChange({
    target: { value: 'Blocked' },
  });
  assert.deepEqual(current, before);
});

test('group rename commits explicitly with captured membership, including merge and blank-group names', () => {
  const rows = [
    row({ id: 'HLD', groupName: 'Design', scope: 'HLD' }),
    row({ id: 'LLD', groupName: 'Design', scope: 'LLD' }),
    row({ id: 'INSTALL', groupName: 'Build' }),
  ];
  const updates = [];
  const props = tableProps(rows[0], {
    rows,
    grouped: true,
    onRenameGroup: (value) => updates.push(value),
  });
  const nodes = walk(PersonnelLinesTable(props));
  const header = nodes.find(
    (node) => node.props['data-personnel-group'] === 'Design',
  );
  const field = walk(header).find(
    (node) => node.props['aria-label'] === 'Group name Design',
  );
  assert.equal(field.props.onChange, undefined);
  assert.equal(updates.length, 0);
  const submit = walk(header).find((node) => node.type === 'form').props
    .onSubmit;
  const event = (value) => ({
    preventDefault: noop,
    currentTarget: { elements: { namedItem: () => ({ value }) } },
  });
  submit(event(' Build '));
  submit(event('  '));
  assert.deepEqual(updates, [
    { groupName: 'Design', nextGroupName: 'Build', rowIds: ['HLD', 'LLD'] },
    { groupName: 'Design', nextGroupName: '', rowIds: ['HLD', 'LLD'] },
  ]);
  submit(event('X'.repeat(201)));
  assert.equal(updates.length, 2);
  const locked = walk(PersonnelLinesTable({ ...props, locked: true }));
  const lockedHeader = locked.find(
    (node) => node.props['data-personnel-group'] === 'Design',
  );
  walk(lockedHeader)
    .find((node) => node.type === 'form')
    .props.onSubmit(event('Blocked'));
  assert.equal(updates.length, 2);
  assert.match(render(PersonnelLinesTable, props), /Save \/ Merge/);
});

test('row up/down and drag/drop express position and target Group without writing displayed cost values', () => {
  const rows = [
    row({ id: 'HLD', groupName: 'Design' }),
    row({ id: 'LLD', groupName: 'Design' }),
    row({ id: 'INSTALL', groupName: 'Build' }),
  ];
  const before = structuredClone(rows),
    moves = [];
  const props = tableProps(rows[0], {
    rows,
    grouped: true,
    onMoveRow: (value) => moves.push(value),
  });
  const nodes = walk(PersonnelLinesTable(props));
  input(props, 'Move personnel row LLD down').props.onClick();
  input(props, 'Move personnel row INSTALL up').props.onClick();
  assert.deepEqual(moves.slice(0, 2), [
    {
      rowId: 'LLD',
      targetRowId: 'INSTALL',
      position: 'after',
      groupName: 'Build',
    },
    {
      rowId: 'INSTALL',
      targetRowId: 'LLD',
      position: 'before',
      groupName: 'Design',
    },
  ]);
  const payload = new Map();
  const dataTransfer = {
    types: ['application/x-ssr-personnel-row'],
    setData: (key, value) => payload.set(key, value),
    getData: (key) => payload.get(key) || '',
  };
  input(props, 'Drag personnel row HLD').props.onDragStart({
    dataTransfer,
    preventDefault: noop,
  });
  assert.equal(dataTransfer.effectAllowed, 'move');
  const dropEvent = (clientY) => ({
    dataTransfer,
    clientY,
    preventDefault: noop,
    currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 32 }) },
  });
  const target = nodes.find(
    (node) => node.props['data-personnel-row'] === 'INSTALL',
  );
  target.props.onDragOver(dropEvent(102));
  assert.equal(dataTransfer.dropEffect, 'move');
  target.props.onDrop(dropEvent(102));
  target.props.onDrop(dropEvent(130));
  nodes
    .find((node) => node.props['data-personnel-group'] === 'Build')
    .props.onDrop(dropEvent(0));
  assert.deepEqual(moves.slice(2), [
    {
      rowId: 'HLD',
      targetRowId: 'INSTALL',
      position: 'before',
      groupName: 'Build',
    },
    {
      rowId: 'HLD',
      targetRowId: 'INSTALL',
      position: 'after',
      groupName: 'Build',
    },
    { rowId: 'HLD', position: 'group-end', groupName: 'Build' },
  ]);
  assert.equal(personnelDropPosition(115, 100, 32), 'before');
  assert.equal(personnelDropPosition(116, 100, 32), 'after');
  const locked = { ...props, locked: true };
  input(locked, 'Move personnel row LLD down').props.onClick();
  input(locked, 'Drag personnel row HLD').props.onDragStart({
    dataTransfer,
    preventDefault: noop,
  });
  const lockedNodes = walk(PersonnelLinesTable(locked));
  lockedNodes
    .find((node) => node.props['data-personnel-row'] === 'INSTALL')
    .props.onDrop(dropEvent(102));
  lockedNodes
    .find((node) => node.props['data-personnel-group'] === 'Build')
    .props.onDrop(dropEvent(0));
  assert.equal(moves.length, 5);
  assert.deepEqual(rows, before);
});

test('flat row moves preserve existing Group assignments and drag feedback marks before/after targets', () => {
  const rows = [
    row({ id: 'A', groupName: 'Design' }),
    row({ id: 'B', groupName: 'Build' }),
  ];
  const moves = [];
  const props = tableProps(rows[0], {
    rows,
    grouped: false,
    onMoveRow: (value) => moves.push(value),
  });
  input(props, 'Move personnel row A down').props.onClick();
  input(props, 'Move personnel row B up').props.onClick();
  const attributes = new Map();
  const event = {
    dataTransfer: {
      types: ['application/x-ssr-personnel-row'],
      getData: () => 'A',
    },
    clientY: 102,
    preventDefault: noop,
    currentTarget: {
      getBoundingClientRect: () => ({ top: 100, height: 32 }),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
    },
  };
  const target = walk(PersonnelLinesTable(props)).find(
    (node) => node.props['data-personnel-row'] === 'B',
  );
  target.props.onDragOver(event);
  assert.equal(attributes.get('data-drop-position'), 'before');
  target.props.onDragOver({ ...event, clientY: 130 });
  assert.equal(attributes.get('data-drop-position'), 'after');
  target.props.onDrop(event);
  assert.equal(attributes.size, 0);
  assert.deepEqual(moves, [
    { rowId: 'A', targetRowId: 'B', position: 'after' },
    { rowId: 'B', targetRowId: 'A', position: 'before' },
    { rowId: 'A', targetRowId: 'B', position: 'before' },
  ]);
  assert.deepEqual(
    rows.map((line) => line.groupName),
    ['Design', 'Build'],
  );
});
