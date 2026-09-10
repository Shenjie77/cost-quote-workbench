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
const { BusinessUnitSelect, BusinessUnitSelectField, BusinessUnitsProvider } =
  await import('../features/master-data/business-unit-select.tsx');
const { getBusinessUnitOptions } =
  await import('../features/master-data/business-units.ts');
const { PersonnelLinesTable, blankPersonnelRow } =
  await import('../features/cost/components/personnel-input-controls.tsx');
const { PersonnelBulkEntryForm } =
  await import('../features/cost/components/personnel-bulk-entry-dialog.tsx');
const { SubcontractItemForm } =
  await import('../features/cost/components/subcontract-lines-table.tsx');
const { AdditionalTravelTable } =
  await import('../features/cost/components/additional-travel-table.tsx');
const { CostView } = await import('../features/cost/cost-view.tsx');
const { initialResourceTypes } =
  await import('../features/master-data/demo-data.ts');
const { initialRateSettings } = await import('../features/cost/demo-data.ts');
const { makeCostSnapshot } = await import('./helpers.mjs');
hooks.deregister();

const noop = () => {};
const options = getBusinessUnitOptions([
  { bu: 'Networks', buCode: 'BU-NET', active: true },
  { bu: 'Delivery', buCode: 'BU-DLV', active: true },
  { bu: 'Retired', buCode: 'BU-OLD', active: false },
]);
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
/** Render the real context-bound selector and expose its resulting native select for events. */
function captureSelect(props, disabled = false) {
  let selected;
  function Probe() {
    selected = BusinessUnitSelect(props);
    return selected;
  }
  const html = renderToStaticMarkup(
    React.createElement(
      BusinessUnitsProvider,
      { options, disabled },
      React.createElement(Probe),
    ),
  );
  return { html, select: BusinessUnitSelectField(selected.props) };
}

test('BU selector displays company codes but emits only active names and retains historical values without writes', () => {
  const changes = [];
  const { html, select } = captureSelect({
    value: 'Retired',
    onChange: (event) => changes.push(event.target.value),
  });
  assert.match(html, /<option value="Networks">Networks · BU-NET<\/option>/);
  assert.match(
    html,
    /<option value="Retired" disabled="" selected="">Retired · Saved value<\/option>/,
  );
  assert.doesNotMatch(html, /value="BU-NET"|BU-OLD/);
  assert.deepEqual(
    changes,
    [],
    'rendering must not normalize or clear historical cost values',
  );
  for (const value of ['BU-NET', 'Retired', 'Invented BU'])
    select.props.onChange({ target: { value } });
  assert.deepEqual(changes, []);
  select.props.onChange({ target: { value: 'Delivery' } });
  select.props.onChange({ target: { value: '' } });
  assert.deepEqual(changes, ['Delivery', '']);
});

test('BU selector preserves exact unmatched spelling and blocks writes under either version or control locks', () => {
  for (const lock of ['version', 'control']) {
    const writes = [];
    const { html, select } = captureSelect(
      {
        value: '  NETWORKS  ',
        disabled: lock === 'control',
        onChange: (event) => writes.push(event.target.value),
      },
      lock === 'version',
    );
    assert.match(html, /<select[^>]*disabled=""/);
    assert.match(html, /value="  NETWORKS  " disabled="" selected=""/);
    select.props.onChange({ target: { value: 'Delivery' } });
    assert.deepEqual(writes, []);
  }
  const html = renderToStaticMarkup(
    React.createElement(BusinessUnitSelect, { value: 'Historical only' }),
  );
  assert.match(html, /Historical only · Saved value/);
  assert.match(html, /No active BU in Master Data/);
});

test('personnel, bulk, subcontract and travel inputs use the common directory with their original update contracts', () => {
  const writes = [];
  const personnel = {
    ...blankPersonnelRow('ROW-1', initialResourceTypes),
    bu: 'Retired',
    scope: 'Install',
  };
  const subcontract = {
    id: 'SUB-1',
    code: 'SUB',
    description: 'Install',
    bu: 'Retired',
    unit: 'pcs',
    currency: 'SGD',
    unitPrice: 100,
    quantities: [1, 0, 0, 0, 0],
  };
  const travel = {
    id: 'TR-1',
    scope: 'Visit',
    bu: 'Retired',
    destination: 'SG',
    expenseType: 'Other',
    unitBasis: 'trip',
    currency: 'SGD',
    baseUnitRate: 100,
    rateBaseYear: 2026,
    quantities: [1, 0, 0, 0, 0],
    treatment: 'included',
  };
  const trees = [
    [
      'BU for ROW-1',
      PersonnelLinesTable({
        rows: [personnel],
        resources: initialResourceTypes,
        rates: initialRateSettings,
        actualYears: [2026, 2027, 2028, 2029, 2030],
        onPatch: (id, patch) => writes.push(['personnel', id, patch]),
        onDelete: noop,
        announce: noop,
      }),
    ],
    [
      'Bulk default BU',
      PersonnelBulkEntryForm({
        text: '',
        options: {
          defaultBU: 'Retired',
          defaultMode: 'mandays',
          defaultYear: 0,
        },
        resources: initialResourceTypes,
        rates: initialRateSettings,
        preview: null,
        current: false,
        page: 0,
        onPage: noop,
        onTextChange: noop,
        onOptionsChange: (value) => writes.push(['bulk', value.defaultBU]),
        onPreview: noop,
        onConfirm: noop,
        onClose: noop,
      }),
    ],
    [
      'Item business unit',
      SubcontractItemForm({
        draft: subcontract,
        onDraftChange: (value) => writes.push(['subcontract', value.bu]),
        onSave: noop,
        onClose: noop,
        announce: noop,
      }),
    ],
    [
      'Travel BU for TR-1',
      AdditionalTravelTable({
        rows: [travel],
        setRows: (change) => writes.push(['travel', change([travel])[0].bu]),
        rateSettings: initialRateSettings,
        travelUplift: 0,
        setTravelUplift: noop,
      }),
    ],
  ];
  for (const [label, tree] of trees) {
    const control = walk(tree).find(
      (entry) => entry.props['aria-label'] === label,
    );
    assert.equal(control.type, BusinessUnitSelect, label);
    const { html, select } = captureSelect(control.props);
    assert.match(html, /Networks · BU-NET/);
    select.props.onChange({ target: { value: 'Networks' } });
  }
  assert.deepEqual(writes, [
    ['personnel', 'ROW-1', { field: 'bu', value: 'Networks' }],
    ['bulk', 'Networks'],
    ['subcontract', 'Networks'],
    ['travel', 'Networks'],
  ]);
  assert.equal(personnel.bu, 'Retired');
  assert.equal(subcontract.bu, 'Retired');
  assert.equal(travel.bu, 'Retired');
});

test('CostView provides the saved BU directory to nested controls without altering historical rows or amounts', () => {
  const snapshot = makeCostSnapshot();
  const rows = snapshot.costRows.filter(
    (row) =>
      snapshot.resourceTypes.find((item) => item.id === row.reTypeId)
        ?.category === 'internal',
  );
  const version = {
    ...snapshot,
    code: 'V1',
    state: 'Draft',
    createdAt: '2026-09-10T00:00:00Z',
    sourceVersion: null,
    costRows: rows,
    travelRows: [],
    travelUplift: 0,
  };
  const before = structuredClone(rows);
  const props = {
    businessUnits: options,
    activeVersion: 'V1',
    versions: [version],
    onSelectVersion: noop,
    onUpdateVersionState: noop,
    costView: 'input',
    setCostView: noop,
    rows,
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
    project: snapshot.project,
    announce: noop,
  };
  for (const lockedReason of [null, 'Confirmed cost']) {
    const html = renderToStaticMarkup(
      React.createElement(CostView, { ...props, lockedReason }),
    );
    const selectors =
      html.match(/<select[^>]*aria-label="BU for [^"]*"[\s\S]*?<\/select>/g) ||
      [];
    assert.ok(selectors.length > 0);
    for (const selector of selectors) {
      assert.match(selector, /value="Networks">Networks · BU-NET/);
      assert.doesNotMatch(selector, /value="BU-NET"/);
      if (lockedReason) assert.match(selector, /disabled=""/);
    }
  }
  assert.deepEqual(rows, before);
});

test('application wiring loads the saved global BU record and import defaults use the same selector', () => {
  const app = readFileSync(
    path.join(root, 'features/workbench/workbench-app.tsx'),
    'utf8',
  );
  assert.match(app, /loadGlobalMasterData\('profit-share'\)/);
  assert.match(
    app,
    /getBusinessUnitOptions\(\s*globalMasterData\.tabs\['profit-share'\]\?\.record\?\.items/,
  );
  assert.match(app, /<CostView\s+businessUnits=\{costBusinessUnits\}/);
  const imports = readFileSync(
    path.join(root, 'features/cost/components/cost-import-panel.tsx'),
    'utf8',
  );
  assert.match(
    imports,
    /<BusinessUnitSelect\s+aria-label="Import default BU"[\s\S]*?value=\{mapping\.defaultBu\}[\s\S]*?defaultBu: e\.target\.value/,
  );
});
