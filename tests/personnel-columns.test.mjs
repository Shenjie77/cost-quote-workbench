import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PERSONNEL_COLUMN_SPECS,
  PERSONNEL_COLUMNS_STORAGE_KEY,
  defaultPersonnelColumns,
  normalizePersonnelColumns,
  visiblePersonnelColumns,
  setPersonnelColumnVisible,
  movePersonnelColumn,
  loadPersonnelColumns,
  savePersonnelColumns,
  usePersonnelColumns,
} from '../features/cost/personnel-columns.ts';

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
const { PersonnelColumnSettingsPanel, PersonnelColumnSettings } =
  await import('../features/cost/components/personnel-column-settings.tsx');
hooks.deregister();
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];

test('default columns retain compact field/year order and expose editable Group with fixed Action', () => {
  const preferences = defaultPersonnelColumns();
  assert.equal(preferences.order.length, 25);
  assert.equal(new Set(preferences.order).size, 25);
  assert.deepEqual(preferences.order.slice(0, 8), [
    'groupName',
    'scope',
    'bu',
    'reType',
    'mdPerSite',
    'totalSites',
    'totalMd',
    'totalCost',
  ]);
  for (let index = 0; index < 5; index++) {
    assert.deepEqual(preferences.order.slice(8 + index * 3, 11 + index * 3), [
      `Y${index + 1}:sites`,
      `Y${index + 1}:mandays`,
      `Y${index + 1}:cost`,
    ]);
    assert.ok(
      PERSONNEL_COLUMN_SPECS.filter((spec) => spec.yearIndex === index).every(
        (spec) => spec.hideable,
      ),
    );
  }
  assert.deepEqual(preferences.order.slice(-2), ['check', 'action']);
  assert.deepEqual(visiblePersonnelColumns(preferences), preferences.order);
  preferences.order.reverse();
  preferences.hidden.push('groupName');
  assert.equal(defaultPersonnelColumns().order[0], 'groupName');
  assert.deepEqual(defaultPersonnelColumns().hidden, []);
});

test('individual annual fields can hide and cross year boundaries without losing order when shown again', () => {
  const original = defaultPersonnelColumns();
  let preferences = setPersonnelColumnVisible(original, 'Y2:cost', false);
  for (let step = 0; step < 4; step++)
    preferences = movePersonnelColumn(preferences, 'Y2:cost', 'left');
  assert.equal(
    preferences.order.indexOf('Y2:cost'),
    original.order.indexOf('Y2:cost') - 4,
  );
  assert.equal(visiblePersonnelColumns(preferences).includes('Y2:cost'), false);
  const position = preferences.order.indexOf('Y2:cost');
  preferences = setPersonnelColumnVisible(preferences, 'Y2:cost', true);
  assert.equal(visiblePersonnelColumns(preferences)[position], 'Y2:cost');
  assert.equal(preferences.order[position - 1], 'Y1:sites');
  assert.equal(preferences.order[position + 1], 'Y1:mandays');
  assert.deepEqual(new Set(preferences.order), new Set(original.order));
  assert.deepEqual(original, defaultPersonnelColumns());
});

test('hide and move operations retain at least one data column and cannot hide or move the Action utility', () => {
  let preferences = defaultPersonnelColumns();
  for (const id of preferences.order.filter((id) => id !== 'groupName'))
    preferences = setPersonnelColumnVisible(preferences, id, false);
  assert.deepEqual(visiblePersonnelColumns(preferences), [
    'groupName',
    'action',
  ]);
  preferences = setPersonnelColumnVisible(preferences, 'groupName', false);
  assert.deepEqual(visiblePersonnelColumns(preferences), [
    'groupName',
    'action',
  ]);
  assert.deepEqual(
    movePersonnelColumn(preferences, 'action', 'left'),
    preferences,
  );
  assert.deepEqual(
    movePersonnelColumn(preferences, 'groupName', 'left'),
    preferences,
  );
  assert.deepEqual(
    movePersonnelColumn(preferences, 'check', 'right'),
    preferences,
  );
  assert.deepEqual(
    setPersonnelColumnVisible(preferences, 'unknown', false),
    preferences,
  );
  assert.deepEqual(
    movePersonnelColumn(preferences, 'unknown', 'left'),
    preferences,
  );
});

test('stored preferences reject malformed structures and safely repair stale IDs, duplicates and hidden utilities', () => {
  for (const value of [
    null,
    false,
    [],
    'text',
    { version: 2, order: [], hidden: [] },
    { version: 1, order: [1], hidden: [] },
    { version: 1, order: [], hidden: null },
  ])
    assert.deepEqual(
      normalizePersonnelColumns(value),
      defaultPersonnelColumns(),
    );
  const stored = {
    version: 1,
    order: ['action', 'Y3:cost', 'unknown', 'Y3:cost', 'scope'],
    hidden: [...defaultPersonnelColumns().order, '__proto__'],
  };
  const before = structuredClone(stored);
  const normalized = normalizePersonnelColumns(stored);
  assert.deepEqual(normalized.order.slice(0, 2), ['Y3:cost', 'scope']);
  assert.equal(normalized.order.length, 25);
  assert.equal(normalized.order.at(-1), 'action');
  assert.deepEqual(visiblePersonnelColumns(normalized), [
    'groupName',
    'action',
  ]);
  assert.deepEqual(stored, before);
});

test('preferences round-trip through one browser key independently of project/version and fail safely when storage is blocked', () => {
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) || null,
    setItem: (key, value) => items.set(key, value),
  };
  let preferences = setPersonnelColumnVisible(
    defaultPersonnelColumns(),
    'bu',
    false,
  );
  preferences = movePersonnelColumn(preferences, 'scope', 'left');
  assert.equal(savePersonnelColumns(storage, preferences), true);
  assert.deepEqual([...items.keys()], [PERSONNEL_COLUMNS_STORAGE_KEY]);
  assert.deepEqual(loadPersonnelColumns(storage), preferences);
  assert.equal(savePersonnelColumns(storage, defaultPersonnelColumns()), true);
  assert.deepEqual(loadPersonnelColumns(storage), defaultPersonnelColumns());
  storage.setItem(PERSONNEL_COLUMNS_STORAGE_KEY, 'malformed json');
  assert.deepEqual(loadPersonnelColumns(storage), defaultPersonnelColumns());
  storage.setItem(PERSONNEL_COLUMNS_STORAGE_KEY, ' '.repeat(20001));
  assert.deepEqual(loadPersonnelColumns(storage), defaultPersonnelColumns());
  assert.deepEqual(
    loadPersonnelColumns({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    defaultPersonnelColumns(),
  );
  assert.equal(
    savePersonnelColumns(
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
      preferences,
    ),
    false,
  );
});

test('SSR uses deterministic defaults and never reads or overwrites browser storage before hydration', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get() {
      throw new Error('SSR must not access window');
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  });
  function Probe() {
    const state = usePersonnelColumns();
    return React.createElement('div', {
      'data-ready': state.ready,
      'data-columns': state.columns.join(','),
    });
  }
  const html = renderToStaticMarkup(React.createElement(Probe));
  assert.match(html, /data-ready="false"/);
  assert.ok(
    html.includes(
      `data-columns="${defaultPersonnelColumns().order.join(',')}"`,
    ),
  );
});

test('column controls submit only view intent, enforce minimum visibility and allow configuration for locked versions', () => {
  const events = [];
  const preferences = defaultPersonnelColumns();
  const props = {
    preferences,
    onSetVisible: (...args) => events.push(['visible', ...args]),
    onMove: (...args) => events.push(['move', ...args]),
    onReset: () => events.push(['reset']),
  };
  const controls = walk(PersonnelColumnSettingsPanel(props));
  const control = (label) =>
    controls.find((node) => node.props['aria-label'] === label);
  control('Show Y1 · MD column').props.onChange({ target: { checked: false } });
  control('Move Y1 · Cost left').props.onClick();
  control('Move Group left').props.onClick();
  control('Show Action column').props.onChange({ target: { checked: false } });
  assert.deepEqual(events, [
    ['visible', 'Y1:mandays', false],
    ['move', 'Y1:cost', 'left'],
  ]);
  assert.deepEqual(preferences, defaultPersonnelColumns());
  const last = {
    ...preferences,
    hidden: preferences.order.filter((id) => id !== 'scope' && id !== 'action'),
  };
  const lastControl = walk(
    PersonnelColumnSettingsPanel({ ...props, preferences: last }),
  ).find((node) => node.props['aria-label'] === 'Show Scope column');
  assert.equal(lastControl.props.disabled, true);
  lastControl.props.onChange({ target: { checked: false } });
  assert.equal(events.length, 2);
  const waiting = walk(
    PersonnelColumnSettingsPanel({ ...props, ready: false }),
  );
  waiting
    .find((node) => node.props['aria-label'] === 'Move Scope right')
    .props.onClick();
  assert.equal(events.length, 2);
  const html = renderToStaticMarkup(
    React.createElement(PersonnelColumnSettings, props),
  );
  assert.match(html, /Columns/);
});
