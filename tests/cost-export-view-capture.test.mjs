import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeCostSnapshot } from './helpers.mjs';

// Keep the actual React export hook; intercept only browser download side effects.
const root = new URL('../', import.meta.url);
const simpleUrl = new URL('features/cost/export-simple-workbook.ts', root).href;
const fullUrl = new URL('features/cost/export-workbook.ts', root).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/'))
      return nextResolve(
        new URL(`${specifier.slice(2)}.ts`, root).href,
        context,
      );
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== simpleUrl && url !== fullUrl) return nextLoad(url, context);
    const name =
      url === simpleUrl ? 'downloadSimpleCostWorkbook' : 'downloadCostWorkbook';
    return {
      format: 'module',
      shortCircuit: true,
      source: `export const calls = []; let finish;
        export function ${name}(...args) {
          calls.push(args);
          return new Promise(resolve => { finish = resolve; });
        }
        export function complete() { finish({fileName:'test.xlsx',sizeBytes:1024}); }`,
    };
  },
});
const { useCostWorkbookExport } =
  await import('../features/cost/use-cost-workbook-export.ts');
const simple = await import(simpleUrl);
const full = await import(fullUrl);
hooks.deregister();

function renderExport(input) {
  let exports;
  function Probe({ capture }) {
    capture(useCostWorkbookExport(input));
    return null;
  }
  renderToStaticMarkup(
    React.createElement(Probe, {
      capture: (value) => {
        exports = value;
      },
    }),
  );
  return exports;
}

test('Simple Export freezes the clicked cost and view together before asynchronous work', async () => {
  const snapshot = makeCostSnapshot();
  const layout = {
    grouped: true,
    yearIndex: 1,
    columns: ['groupName', 'scope', 'Y2:cost', 'action'],
  };
  const before = structuredClone({ snapshot, layout });
  const messages = [];
  const actions = renderExport({
    enabled: true,
    announce: (message) => messages.push(message),
    createSnapshot: () => snapshot,
    createSimpleLayout: () => layout,
    simpleLayoutReady: true,
  });
  const previous = simple.calls.length;
  const pending = actions.exportSimpleWorkbook();
  snapshot.costRows.reverse();
  snapshot.costRows[0].scope = 'Changed after click';
  layout.columns.reverse();
  layout.grouped = false;
  layout.yearIndex = 'all';
  assert.deepEqual(simple.calls[previous], [before.snapshot, before.layout]);
  await actions.exportSimpleWorkbook();
  assert.equal(
    simple.calls.length,
    previous + 1,
    'double-click does not launch a second download',
  );
  simple.complete();
  await pending;
  assert.match(messages[0], /五年完整口径/);
});

test('Simple Export waits for browser columns to hydrate while Full Export remains standard', async () => {
  const snapshot = makeCostSnapshot();
  let layoutsRead = 0;
  const actions = renderExport({
    enabled: true,
    announce: () => {},
    createSnapshot: () => snapshot,
    createSimpleLayout: () => {
      layoutsRead++;
      return { grouped: true, yearIndex: 2, columns: ['scope'] };
    },
    simpleLayoutReady: false,
  });
  const previous = simple.calls.length;
  await actions.exportSimpleWorkbook();
  assert.equal(simple.calls.length, previous);
  assert.equal(layoutsRead, 0);
  const pending = actions.exportWorkbook();
  assert.deepEqual(full.calls.at(-1), [snapshot]);
  assert.equal(layoutsRead, 0);
  full.complete();
  await pending;
});

test('exporting a locked snapshot uses its captured values without any write callback', async () => {
  const snapshot = makeCostSnapshot();
  snapshot.costVersion.status = 'Confirmed';
  const before = structuredClone(snapshot);
  const actions = renderExport({
    enabled: true,
    announce: () => {},
    createSnapshot: () => snapshot,
    createSimpleLayout: () => ({
      grouped: false,
      yearIndex: 4,
      columns: ['scope', 'Y5:cost'],
    }),
  });
  const pending = actions.exportSimpleWorkbook();
  assert.deepEqual(simple.calls.at(-1)[0], before);
  assert.deepEqual(snapshot, before);
  simple.complete();
  await pending;
  assert.deepEqual(snapshot, before);
});
