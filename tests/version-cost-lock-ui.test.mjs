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
import { makeCostSnapshot } from './helpers.mjs';
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
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
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

const { CostView } = await import('../features/cost/cost-view.tsx');
const { CostStatementTable } =
  await import('../features/cost/components/cost-statement-table.tsx');
const { VersionComparisonView } =
  await import('../features/cost/version-comparison-view.tsx');
hooks.deregister();

const snapshot = makeCostSnapshot();
const noop = () => {};
const version = (code, state) => ({
  code,
  state,
  createdAt: '2026-09-07T00:00:00Z',
  sourceVersion: null,
  costRows: snapshot.costRows,
  resourceTypes: snapshot.resourceTypes,
  rateSettings: snapshot.rateSettings,
  travelSettings: snapshot.travelSettings,
  travelRows: [],
  travelUplift: 0,
  manualCosts: snapshot.manualCosts,
});
const versions = [
  version('V1', 'Confirmed'),
  version('V2', 'Draft'),
  version('V3', 'Draft'),
];
const lockReasons = { V1: 'V1 confirmed', V2: 'V2 DRB approved' };
const costProps = {
  lockedReason: lockReasons.V1,
  versionLockReasons: lockReasons,
  activeVersion: 'V1',
  versions,
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
  project: snapshot.project,
  announce: noop,
};
const walk = (node) => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!React.isValidElement(node)) return [];
  return [node, ...walk(node.props.children)];
};

test('locked cost keeps Scope, BU, RE, statement and Subcon tabs available', () => {
  const markup = renderToStaticMarkup(React.createElement(CostView, costProps));
  const tabs =
    markup.match(/<button[^>]*data-slot="tabs-trigger"[^>]*>/g) || [];
  assert.equal(tabs.length, 5);
  for (const tab of tabs)
    assert.doesNotMatch(tab, / disabled(?:[ =])|aria-disabled="true"/);
  assert.doesNotMatch(markup, /<fieldset[^>]*disabled/);
  assert.match(markup, /Scope/);
  assert.match(markup, /RE Type &amp; Level/);
  assert.match(markup, /Subcon/);
});

test('locked statement disables only money inputs and refuses write callbacks', () => {
  let writes = 0;
  const props = {
    rows: snapshot.costRows,
    resourceTypes: snapshot.resourceTypes,
    travelCost: 0,
    manualCosts: snapshot.manualCosts,
    setManualCosts: () => {
      writes += 1;
    },
  };
  for (const readOnly of [true, false]) {
    const tree = CostStatementTable({ ...props, readOnly });
    const inputs = walk(tree).filter((node) => node.props.type === 'number');
    assert.ok(inputs.length > 0);
    assert.ok(inputs.every((node) => node.props.disabled === readOnly));
    const before = writes;
    inputs[0].props.onChange({ target: { value: '100' } });
    inputs[0].props.onBlur({ target: { value: '100' } });
    assert.equal(writes - before, readOnly ? 0 : 2);
    const markup = renderToStaticMarkup(
      React.createElement(CostStatementTable, { ...props, readOnly }),
    );
    const fields = markup.match(/<input[^>]*>/g) || [];
    assert.equal(fields.length, inputs.length);
    assert.ok(
      fields.every((field) => / disabled(?:[ =])/.test(field) === readOnly),
    );
  }
});

test('version controls keep Open and unlocked versions usable while blocking locked downgrades', () => {
  const selections = [],
    updates = [];
  const props = {
    versions,
    activeVersion: 'V1',
    resourceTypes: snapshot.resourceTypes,
    lockReasons,
    onSelectVersion: (code) => selections.push(code),
    onUpdateVersionState: (code, state) => updates.push([code, state]),
  };
  const nodes = walk(VersionComparisonView(props));
  const selectors = nodes.filter(
    (node) => typeof node.props.onValueChange === 'function',
  );
  assert.equal(selectors.length, 3);
  assert.equal(selectors[0].props.disabled, true);
  assert.equal(selectors[1].props.disabled, false);
  assert.equal(selectors[2].props.disabled, false);
  selectors[0].props.onValueChange('Draft');
  selectors[1].props.onValueChange('Suspended');
  assert.deepEqual(updates, []);
  selectors[1].props.onValueChange('Confirmed');
  selectors[2].props.onValueChange('Suspended');
  assert.deepEqual(updates, [
    ['V2', 'Confirmed'],
    ['V3', 'Suspended'],
  ]);
  const openButtons = nodes.filter(
    (node) => typeof node.props.onClick === 'function',
  );
  assert.equal(openButtons.length, 3);
  assert.equal(openButtons[0].props.disabled, true);
  for (const button of openButtons.slice(1)) {
    assert.equal(button.props.disabled, false);
    button.props.onClick();
  }
  assert.deepEqual(selections, ['V2', 'V3']);
  const markup = renderToStaticMarkup(
    React.createElement(VersionComparisonView, props),
  );
  for (const code of ['V2', 'V3']) {
    const trigger = markup.match(
      new RegExp('<button[^>]*aria-label="' + code + ' version status"[^>]*>'),
    )?.[0];
    assert.ok(trigger);
    assert.doesNotMatch(trigger, / disabled(?:[ =])/);
  }
});

test('cost toolbar retains version information, current status, master apply and both exports', () => {
  const selections = [],
    updates = [];
  let applies = 0,
    tree;
  const draft = {
    ...costProps,
    lockedReason: null,
    activeVersion: 'V3',
    onSelectVersion: (code, view) => selections.push([code, view]),
    onUpdateVersionState: (code, state) => updates.push([code, state]),
    onApplyMasterRates: () => {
      applies += 1;
    },
  };
  const Probe = (props) => {
    tree = CostView(props);
    return tree;
  };
  const html = renderToStaticMarkup(React.createElement(Probe, draft));
  assert.match(html, /aria-label="Cost version information"/);
  assert.match(html, /Version Total/);
  assert.match(html, /aria-label="Input Completeness"/);
  assert.match(html, /Calculation Basis/);
  const versionPanel = html.match(/<section[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(versionPanel);
  assert.doesNotMatch(versionPanel, /[\p{Script=Han}]/u);
  const controls = walk(tree);
  controls
    .find((node) => node.props['aria-label'] === 'View cost version')
    .props.onChange({ target: { value: 'V1' } });
  controls
    .find((node) => node.props['aria-label'] === 'Current version status')
    .props.onChange({ target: { value: 'Suspended' } });
  controls
    .find((node) => node.props.children === 'Apply Master Rates')
    .props.onClick();
  assert.deepEqual(selections, [['V1', 'summary']]);
  assert.deepEqual(updates, [['V3', 'Suspended']]);
  assert.equal(applies, 1);
  assert.match(html, /Current version status/);
  assert.match(html, /Simple Export/);
  assert.match(html, /Export Cost Workbook/);
  const apply = html.match(
    /<button[^>]*>(?:(?!<\/button>)[\s\S])*Apply Master Rates(?:(?!<\/button>)[\s\S])*<\/button>/,
  )?.[0];
  assert.ok(apply);
  assert.doesNotMatch(apply, / disabled(?:[ =])/);
  const lockedHtml = renderToStaticMarkup(
    React.createElement(Probe, {
      ...costProps,
      onApplyMasterRates: draft.onApplyMasterRates,
      onUpdateVersionState: draft.onUpdateVersionState,
    }),
  );
  walk(tree)
    .find((node) => node.props.children === 'Apply Master Rates')
    .props.onClick();
  walk(tree)
    .find((node) => node.props['aria-label'] === 'Current version status')
    .props.onChange({ target: { value: 'Draft' } });
  assert.equal(applies, 1);
  assert.deepEqual(updates, [['V3', 'Suspended']]);
  const lockedApply = lockedHtml.match(
    /<button[^>]*>(?:(?!<\/button>)[\s\S])*Apply Master Rates(?:(?!<\/button>)[\s\S])*<\/button>/,
  )?.[0];
  assert.match(lockedApply, / disabled(?:[ =])/);
});

test('other service field displays calculated one percent, preserves auto on blur and permits explicit override', () => {
  let manual = {
    ...snapshot.manualCosts,
    otherService: 999999,
    otherServiceRate: 0.01,
  };
  const render = (readOnly = false) =>
    walk(
      CostStatementTable({
        rows: snapshot.costRows,
        resourceTypes: snapshot.resourceTypes,
        travelCost: 0,
        manualCosts: manual,
        setManualCosts: (next) => {
          manual = next(manual);
        },
        readOnly,
      }),
    );
  const input = (nodes) =>
    nodes.find(
      (node) => node.props['aria-label'] === 'Other Service Costs cost in SGD',
    );
  const automatic = input(render());
  assert.notEqual(automatic.props.value, 999999);
  assert.ok(Number(automatic.props.value) > 0);
  automatic.props.onBlur({ target: { value: String(automatic.props.value) } });
  assert.equal(manual.otherServiceRate, 0.01);
  automatic.props.onChange({ target: { value: '123.45' } });
  assert.equal(manual.otherServiceRate, undefined);
  assert.equal(input(render()).props.value, 123.45);
  const restore = render().find((node) =>
    node.props.title?.startsWith('2.3.4.2 ='),
  );
  restore.props.onClick();
  assert.equal(manual.otherServiceRate, 0.01);
  input(render(true)).props.onChange({ target: { value: '999' } });
  assert.equal(manual.otherServiceRate, 0.01);
});

test('comparison deletion control is only offered for suspended versions and respects server eligibility', () => {
  const chosen = [];
  const props = {
    versions: [
      version('V1', 'Confirmed'),
      version('V2', 'Suspended'),
      version('V3', 'Draft'),
    ],
    activeVersion: 'V3',
    resourceTypes: snapshot.resourceTypes,
    onSelectVersion: noop,
    onUpdateVersionState: noop,
    onDeleteVersion: (code) => chosen.push(code),
  };
  const nodes = walk(VersionComparisonView(props));
  const del = nodes.filter(
    (node) => node.props.title === '删除暂停版本，保留历史记录',
  );
  assert.equal(del.length, 1);
  del[0].props.onClick();
  assert.deepEqual(chosen, ['V2']);
  const locked = walk(
    VersionComparisonView({
      ...props,
      deletionReasons: { V2: 'Locked by DRB' },
    }),
  );
  assert.equal(
    locked.find((node) => node.props.title === 'Locked by DRB').props.disabled,
    true,
  );
});
