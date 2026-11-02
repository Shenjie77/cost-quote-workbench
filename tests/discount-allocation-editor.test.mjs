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

const { DiscountAllocationEditor } =
  await import('../features/quote/discount-allocation-editor.tsx');
const { discountGroupKey } =
  await import('../features/quote/discount-allocation.ts');
hooks.deregister();
const lines = ['A', 'B'].map((category) => ({
  id: category,
  category,
  inclusion: 'mandatory',
  description: category,
  amount: 100,
  quantity: 1,
  unitPrice: 100,
  unit: 'lot',
}));
const key = (category) => discountGroupKey('mandatory', category);
function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function harness(disabled = false) {
  let pricing = {
    targetGrossMargin: 50,
    discount: 20,
    gstPercent: 0,
    discountDescription: 'Legacy description',
    discountAllocation: { mode: 'category' },
  };
  const render = () =>
    DiscountAllocationEditor({
      pricing,
      lines,
      disabled,
      setPricing: (next) => {
        pricing = typeof next === 'function' ? next(pricing) : next;
      },
    });
  const find = (predicate) => elements(render()).find(predicate);
  return {
    render,
    get pricing() {
      return pricing;
    },
    field: (label) => find((n) => n.props?.['aria-label'] === label),
    mode: () => find((n) => n.props?.id === 'discount-placement'),
    reset: () =>
      find((n) => n.props?.children === 'Reset to price proportions'),
  };
}
test('each group has a shared grid input, with no global description in grouped mode', () => {
  const h = harness();
  const html = renderToStaticMarkup(h.render());
  assert.ok(!html.includes('id="discount-description"'));
  assert.equal(
    (html.match(/aria-label="Discount description Mandatory \/ [AB]"/g) ?? [])
      .length,
    2,
  );
  assert.equal((html.match(/data-field-variant="grid"/g) ?? []).length, 4);
});
test('editing, clearing, share updates, proportional reset and mode changes preserve independent descriptions', () => {
  const h = harness();
  h.field('Discount description Mandatory / A').props.onChange({
    target: { value: 'A rebate' },
  });
  assert.equal(
    h.field('Discount description Mandatory / B').props.value,
    'Legacy description',
  );
  h.field('Discount description Mandatory / B').props.onChange({
    target: { value: '' },
  });
  h.field('Discount share Mandatory / A').props.onChange({
    target: { value: '75' },
  });
  assert.deepEqual(h.pricing.discountAllocation.descriptions, {
    [key('A')]: 'A rebate',
    [key('B')]: '',
  });
  h.reset().props.onClick();
  assert.equal(h.pricing.discountAllocation.shares, undefined);
  assert.equal(h.pricing.discountAllocation.descriptions[key('A')], 'A rebate');
  h.mode().props.onChange({ target: { value: 'total' } });
  assert.ok(
    renderToStaticMarkup(h.render()).includes('id="discount-description"'),
  );
  h.mode().props.onChange({ target: { value: 'category' } });
  assert.equal(
    h.field('Discount description Mandatory / A').props.value,
    'A rebate',
  );
  assert.equal(h.field('Discount description Mandatory / B').props.value, '');
});
test('locked pricing blocks group description, share, mode and reset handlers', () => {
  const h = harness(true);
  const before = structuredClone(h.pricing);
  h.field('Discount description Mandatory / A').props.onChange({
    target: { value: 'changed' },
  });
  h.field('Discount share Mandatory / A').props.onChange({
    target: { value: '75' },
  });
  h.reset().props.onClick();
  h.mode().props.onChange({ target: { value: 'total' } });
  assert.deepEqual(h.pricing, before);
});
