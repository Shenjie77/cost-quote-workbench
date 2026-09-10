/** Company BU codes are editable reference metadata and never allocation keys. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { createProject } from '../server/workspace-resources.mjs';
import { calculatePricing } from '../features/quote/domain.ts';
import { validateProfitShareRates } from '../features/quote/profit-share.ts';

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
const { ProfitShareEditor } =
  await import('../features/master-data/profit-share-editor.tsx');
hooks.deregister();

/** Walk the real component tree without replacing controlled editor callbacks. */
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const rate = (overrides = {}) => ({
  id: 'network',
  bu: 'Network',
  ratePercent: 10,
  active: true,
  ...overrides,
});

// Duplicate or blank human codes are legitimate: stable IDs and BU names remain authoritative.
test('BU company codes persist, allow duplicates, and do not mutate existing project snapshots', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const store = repository.globalMasterData;
    const configured = store.update(
      'profit-share',
      {
        upsert: [
          rate({ buCode: 'COMPANY-01' }),
          rate({ id: 'cloud', bu: 'Cloud', buCode: 'COMPANY-01' }),
        ],
      },
      store.get('profit-share').revision,
    );
    assert.equal(configured.items[0].buCode, 'COMPANY-01');
    assert.equal(configured.items[1].buCode, 'COMPANY-01');
    createProject(repository, {
      id: 'BU-CODE',
      name: 'Company code fixture',
      client: 'Fixture',
    });
    const before = repository.get('BU-CODE');
    store.update(
      'profit-share',
      { upsert: [{ id: 'network', buCode: 'COMPANY-02' }] },
      configured.revision,
    );
    const updated = store
      .get('profit-share')
      .items.find((item) => item.id === 'network');
    assert.equal(updated.bu, 'Network');
    assert.equal(updated.ratePercent, 10);
    assert.equal(updated.buCode, 'COMPANY-02');
    assert.deepEqual(repository.get('BU-CODE'), before);
    assert.equal(
      before.workspace.pricing.profitShareRates[0].buCode,
      'COMPANY-01',
    );
  } finally {
    repository.close();
  }
});

test('legacy missing codes and empty codes remain valid; malformed metadata is rejected atomically', () => {
  assert.deepEqual(validateProfitShareRates([rate()]), []);
  assert.deepEqual(validateProfitShareRates([rate({ buCode: '' })]), []);
  const repository = openWorkspaceRepository(':memory:');
  try {
    const store = repository.globalMasterData;
    const baseline = store.get('profit-share');
    for (const buCode of [42, null, {}, 'X'.repeat(201)]) {
      assert.ok(validateProfitShareRates([rate({ buCode })]).length);
      assert.throws(() =>
        store.update(
          'profit-share',
          { upsert: [rate({ buCode })] },
          baseline.revision,
        ),
      );
      assert.deepEqual(store.get('profit-share'), baseline);
    }
  } finally {
    repository.close();
  }
});

test('company code changes never affect allocation or pricing and are never used to match a BU', () => {
  const settings = {
    targetGrossMargin: 20,
    discount: 0,
    gstPercent: 9,
    profitShareRates: [rate({ buCode: 'Cloud' })],
  };
  const allocation = {
    totalCost: 100,
    entries: [{ bu: 'Network', cost: 100, directCost: 100, unassignedCost: 0 }],
    largestBu: 'Network',
    unassignedCost: 0,
    warnings: [],
  };
  const before = calculatePricing(100, settings, allocation);
  const after = calculatePricing(
    100,
    { ...settings, profitShareRates: [rate({ buCode: 'OTHER-CODE' })] },
    allocation,
  );
  assert.deepEqual(after, before);
  const codeOnly = calculatePricing(100, settings, {
    ...allocation,
    entries: [{ ...allocation.entries[0], bu: 'Cloud' }],
    largestBu: 'Cloud',
  });
  assert.equal(codeOnly.weightedProfitShareRate, 0);
  assert.ok(codeOnly.warnings.some((message) => message.includes('Cloud')));
});

test('BU editor searches and edits company codes independently from BU names, IDs and rates', () => {
  let items = [rate({ buCode: 'CODE-01' })];
  const props = {
    items,
    query: 'code-01',
    setItems: (change) => {
      items = typeof change === 'function' ? change(items) : change;
    },
  };
  const rendered = renderToStaticMarkup(
    React.createElement(ProfitShareEditor, props),
  );
  assert.match(rendered, /BU Code/);
  assert.match(rendered, /value="CODE-01"/);
  assert.match(rendered, /manual comparison/);
  const controls = walk(ProfitShareEditor(props));
  controls
    .find((node) => node.props['aria-label'] === 'Network BU code')
    .props.onChange({ target: { value: 'NEW-CODE' } });
  assert.deepEqual(items, [rate({ buCode: 'NEW-CODE' })]);
  const legacy = renderToStaticMarkup(
    React.createElement(ProfitShareEditor, {
      ...props,
      items: [rate()],
      query: '',
    }),
  );
  assert.match(legacy, /aria-label="Network BU code"[^>]*value=""/);
});
