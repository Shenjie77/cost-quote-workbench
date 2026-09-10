/** Exercise opt-in travel controls and readonly rate navigation without a database. */
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

const { HQTravelPanel } =
  await import('../features/cost/components/hq-travel-panel.tsx');
const { RateAssumptions } =
  await import('../features/cost/components/rate-assumptions.tsx');
const { makeCostSnapshot } = await import('./helpers.mjs');
hooks.deregister();

const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const fixture = () => {
  const snapshot = makeCostSnapshot();
  return {
    rows: snapshot.costRows,
    resourceTypes: snapshot.resourceTypes,
    settings: {
      enabled: false,
      monthlyAllowance: 4200,
      airfarePerTrip: 800,
      trips: 3,
    },
  };
};
const noop = () => {};
const render = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, props));

test('HQ travel opt-in saves only the flag and preserves entered expense assumptions', () => {
  const props = fixture();
  let settings = props.settings;
  const tree = HQTravelPanel({
    ...props,
    setSettings: (next) => {
      settings = typeof next === 'function' ? next(settings) : next;
    },
  });
  const toggle = walk(tree).find(
    (node) => node.props['aria-label'] === 'Include HQ travel cost',
  );
  assert.equal(toggle.props.checked, false);
  const html = render(HQTravelPanel, { ...props, setSettings: noop });
  assert.match(html, /no travel cost is included/);
  assert.match(html, /0.00/);
  assert.doesNotMatch(html, /aria-label="Monthly HQ allowance"/);
  toggle.props.onCheckedChange(true);
  assert.deepEqual(settings, { ...props.settings, enabled: true });
  const enabled = HQTravelPanel({
    ...props,
    settings,
    setSettings: (next) => {
      settings = next(settings);
    },
  });
  walk(enabled)
    .find((node) => node.props['aria-label'] === 'Include HQ travel cost')
    .props.onCheckedChange(false);
  assert.deepEqual(settings, props.settings);
});

test('enabled HQ travel validates whole trips and blocks mutations while locked', () => {
  const props = fixture();
  let settings = { ...props.settings, enabled: true };
  let writes = 0;
  const messages = [];
  const make = (locked = false) =>
    HQTravelPanel({
      ...props,
      settings,
      locked,
      setSettings: (next) => {
        writes++;
        settings = next(settings);
      },
      announce: (message) => messages.push(message),
    });
  const trip = walk(make()).find(
    (node) => node.props['aria-label'] === 'Number of HQ round trips',
  );
  trip.props.onChange({ target: { value: '2.5' } });
  trip.props.onChange({ target: { value: '-1' } });
  assert.equal(writes, 0);
  assert.equal(messages.length, 2);
  trip.props.onChange({ target: { value: '4' } });
  assert.equal(settings.trips, 4);
  for (const field of walk(make(true))) {
    if (field.props['aria-label'] === 'Include HQ travel cost') {
      assert.equal(field.props.disabled, true);
      field.props.onCheckedChange(false);
    }
    if (field.props.type === 'number') {
      assert.equal(field.props.disabled, true);
      field.props.onChange({ target: { value: '999' } });
      field.props.onBlur({ target: { value: '999' } });
    }
  }
  assert.equal(writes, 1);
});

test('legacy travel shows its saved enabled behavior and can be explicitly disabled', () => {
  const props = fixture();
  delete props.settings.enabled;
  const tree = HQTravelPanel({ ...props, setSettings: noop });
  assert.equal(
    walk(tree).find(
      (node) => node.props['aria-label'] === 'Include HQ travel cost',
    ).props.checked,
    true,
  );
  const html = render(HQTravelPanel, { ...props, setSettings: noop });
  assert.match(html, /Monthly allowance/);
  assert.doesNotMatch(html, /no travel cost is included/);
});

test('locked rate assumptions keep details navigation available while date editors are disabled', () => {
  const snapshot = makeCostSnapshot();
  const html = render(RateAssumptions, {
    settings: snapshot.rateSettings,
    setSettings: noop,
    locked: true,
  });
  for (const input of html.match(/<input[^>]*>/g) || [])
    assert.match(input, /disabled/);
  const nav = html.match(
    /<button[^>]*aria-controls="annual-rate-details delivery-date-settings"[^>]*>/,
  )?.[0];
  assert.ok(nav);
  assert.doesNotMatch(nav, / disabled(?:=|\s|>)/);
  assert.match(html, /Rate settings/);
});
