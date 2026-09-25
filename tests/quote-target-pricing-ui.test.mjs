/** Exercise quotation controls through actual React handlers without project or database writes. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import {
  buildQuoteLines,
  calculateManualQuoteLines,
} from '../features/quote/quote-lines.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { lineCostAmounts } from '../features/quote/line-pricing.ts';
import { makeCostSnapshot } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hookKey = Symbol.for('quote-target-pricing-ui-hooks');
const reactAdapter = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('quote-target-pricing-ui-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useEffect = (...args) => hooks().useEffect(...args);
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (
      specifier === 'react' &&
      [
        '/quote-lines-editor.tsx',
        '/quote-number-input.tsx',
        '/quote-scope-dialog.tsx',
        '/percentage-input.tsx',
      ].some((name) => parent.endsWith(name))
    )
      return { url: reactAdapter, shortCircuit: true };
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      parent.startsWith(pathToFileURL(root).href) &&
      !parent.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, parent));
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
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
});
after(() => hooks.deregister());

const elements = (node) =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : React.isValidElement(node)
      ? [node, ...elements(node.props.children)]
      : [];
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : React.isValidElement(node)
      ? textOf(node.props.children)
      : node == null
        ? ''
        : String(node);

/** Preserve local numeric drafts and effects across controlled component rerenders. */
function harness(Component, props) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const api = {
    props,
    render() {
      cursor = 0;
      effects = [];
      globalThis[hookKey] = {
        useState(initial) {
          const index = cursor++;
          slots[index] ||= {
            value: typeof initial === 'function' ? initial() : initial,
          };
          return [
            slots[index].value,
            (next) => {
              slots[index].value =
                typeof next === 'function' ? next(slots[index].value) : next;
            },
          ];
        },
        useRef(initial) {
          const index = cursor++;
          slots[index] ||= { current: initial };
          return slots[index];
        },
        useEffect(effect, dependencies) {
          const index = cursor++;
          const previous = slots[index];
          if (
            !previous ||
            !dependencies ||
            dependencies.some(
              (value, i) => !Object.is(value, previous.dependencies[i]),
            )
          ) {
            slots[index] = { dependencies, cleanup: previous?.cleanup };
            effects.push(() => {
              slots[index].cleanup?.();
              slots[index].cleanup = effect();
            });
          }
        },
      };
      try {
        const tree = Component(props);
        for (const effect of effects) effect();
        return tree;
      } finally {
        delete globalThis[hookKey];
      }
    },
    find(predicate) {
      const element = elements(api.render()).find(predicate);
      assert.ok(element, 'Expected quotation control exists');
      return element;
    },
    label(label) {
      return api.find(
        (node) =>
          node.props['aria-label'] === label || node.props.label === label,
      );
    },
    button(label) {
      return api.find(
        (node) =>
          typeof node.props.onClick === 'function' &&
          textOf(node).trim() === label,
      );
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
    },
  };
  return api;
}

/** Source rows use deliberately unequal prices so reallocation and persisted edits are observable. */
const generatedLines = () => [
  {
    id: 'planning',
    description: 'Planning',
    quantity: 1,
    unit: 'lot',
    unitPrice: 25,
    amount: 25,
  },
  {
    id: 'delivery',
    description: 'Delivery',
    quantity: 1,
    unit: 'lot',
    unitPrice: 75,
    amount: 75,
  },
];
const manualLines = () =>
  generatedLines().map(({ amount, ...line }) => ({
    ...line,
    costWeight: amount,
    targetGrossMargin: 50,
    unitPrice: amount * 2,
  }));

/** Mirror the parent’s controlled pricing state; all writes stay in this fixture. */
function quotationHarness(Component, initial, disabled = false) {
  let pricing = structuredClone(initial);
  let writes = 0;
  const costSnapshot = makeCostSnapshot();
  costSnapshot.costRows = costSnapshot.costRows
    .slice(0, 2)
    .map((row, index) => ({
      ...row,
      scope: index === 0 ? 'Planning' : 'Delivery',
      years: row.years.map((year, yearIndex) => ({
        ...year,
        cost: yearIndex === 0 ? (index === 0 ? 25 : 75) : 0,
      })),
    }));
  costSnapshot.manualCosts = Object.fromEntries(
    Object.keys(costSnapshot.manualCosts).map((key) => [key, 0]),
  );
  costSnapshot.travelSettings.enabled = false;
  const props = {
    disabled,
    costSnapshot,
    totalCost: 100,
    weightedProfitShareRate: 0,
    get allocatedLines() {
      return calculatePricing(props.totalCost, pricing).allocatedManualLines;
    },
    get pricing() {
      return pricing;
    },
    get lines() {
      return buildQuoteLines(
        costSnapshot,
        pricing.lineMode,
        calculatePricing(props.totalCost, pricing).listPrice,
        props.allocatedLines ?? pricing.manualLines,
      );
    },
    setPricing(update) {
      writes++;
      pricing = typeof update === 'function' ? update(pricing) : update;
    },
  };
  const view = harness(Component, props);
  return {
    ...view,
    get effectiveLines() {
      return props.allocatedLines ?? pricing.manualLines;
    },
    get pricing() {
      return pricing;
    },
    get result() {
      return calculatePricing(props.totalCost, pricing);
    },
    get writes() {
      return writes;
    },
    mode(next) {
      view
        .find((node) => typeof node.props.onValueChange === 'function')
        .props.onValueChange(next);
    },
  };
}

const { QuoteLinesEditor } =
  await import('../features/quote/quote-lines-editor.tsx');
const { QuoteNumberInput } =
  await import('../features/quote/quote-number-input.tsx');

/** Run the real numeric input handlers, including local text state before committing. */
function numericHarness(props) {
  const view = harness(QuoteNumberInput, props);
  const input = () =>
    view.find(
      (node) => node.props.type === 'number' || node.props.type === 'text',
    );
  return {
    ...view,
    input,
    type(value) {
      input().props.onChange({ target: { value } });
    },
    blur() {
      input().props.onBlur();
    },
    key(key) {
      input().props.onKeyDown({
        key,
        currentTarget: { blur: () => input().props.onBlur() },
      });
    },
  };
}

/** Match a keyed child mount after a parent update, then commit a user-entered value. */
function commitNumber(view, label, value) {
  const control = numericHarness(view.label(label).props);
  control.type(String(value));
  control.blur();
  return control;
}

/** Keep commercial terms non-default so accidental resets are visible in every scenario. */
const legacyTerms = () => ({
  targetGrossMargin: 27,
  discount: 5,
  gstPercent: 9,
});
const targetedPricing = () => ({
  ...legacyTerms(),
  lineMode: 'manual',
  manualPricingBasis: 'line-gp',
  manualLines: manualLines(),
});
const allocatedAmounts = (view) =>
  calculateManualQuoteLines(view.effectiveLines).lines.map(
    (line) => line.amount,
  );

/** Cost allocations are separate from selling amounts and remain observable after each edit. */
const allocatedCosts = (view) =>
  lineCostAmounts(view.effectiveLines, view.props.totalCost);
const shares = (view) =>
  allocatedAmounts(view).map(
    (amount) => (amount / view.result.listPrice) * 100,
  );

test('an empty new quotation still shows its default 50% line target without writing prices', () => {
  const view = quotationHarness(QuoteLinesEditor, {
    targetGrossMargin: 50,
    discount: 0,
    gstPercent: 0,
    lineMode: 'single',
  });
  view.props.totalCost = 0;
  assert.equal(view.label('Line 1 target GP').props.value, 50);
  assert.equal(view.result.listPrice, 0);
  assert.equal(view.writes, 0);
});

test('cost-backed grouping starts at 50% line GP and exposes separate Cost, Weight and Quote share columns', () => {
  const view = quotationHarness(QuoteLinesEditor, {
    ...legacyTerms(),
    lineMode: 'single',
  });
  view.mode('scope');
  assert.equal(view.pricing.manualPricingBasis, 'line-gp');
  assert.equal(view.pricing.lineSourceMode, 'scope');
  assert.equal(view.pricing.manualTargetPrice, undefined);
  assert.deepEqual(allocatedCosts(view), [25, 75]);
  assert.deepEqual(allocatedAmounts(view), [50, 150]);
  assert.deepEqual(shares(view), [25, 75]);
  assert.ok(
    view.pricing.manualLines.every((line) => line.targetGrossMargin === 50),
  );
  const text = textOf(view.render());
  for (const header of [
    'Cost',
    'Weight %',
    'Quote share %',
    'Target GP %',
    'Price / Unit',
    'Amount',
  ])
    assert.ok(text.includes(header), header);
  assert.equal(
    elements(view.render()).some((node) =>
      /cost weight/i.test(node.props.label || node.props['aria-label'] || ''),
    ),
    false,
  );
  assert.deepEqual(
    [
      view.pricing.targetGrossMargin,
      view.pricing.discount,
      view.pricing.gstPercent,
    ],
    [27, 5, 9],
  );
});

test('editing one line GP changes only its price and the summed quotation while cost weights stay fixed', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  const second = structuredClone(view.effectiveLines[1]);
  commitNumber(view, 'Line 1 target GP', 75);
  assert.deepEqual(allocatedAmounts(view), [100, 150]);
  assert.deepEqual(view.effectiveLines[1], second);
  assert.deepEqual(allocatedCosts(view), [25, 75]);
  assert.equal(view.result.listPrice, 250);
  assert.equal(view.result.quoteBeforeTax, 245);
  assert.equal(view.result.grossMarginPercent, (145 / 245) * 100);
  assert.equal(
    view.pricing.targetGrossMargin,
    27,
    'the legacy whole-quote GP field is not a new pricing control',
  );
  assert.equal(view.label('Line 1 target GP').props.value, 75);
  assert.equal(view.label('Line 2 target GP').props.value, 50);
});

test('editing unit price derives the line GP and quotation total without repricing another line or its costs', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  commitNumber(view, 'Line 1 unit price', 125);
  assert.deepEqual(allocatedAmounts(view), [125, 150]);
  assert.deepEqual(allocatedCosts(view), [25, 75]);
  assert.equal(view.result.listPrice, 275);
  assert.equal(view.label('Line 1 target GP').props.value, 80);
  assert.equal(view.pricing.manualLines[0].targetGrossMargin, undefined);
  assert.equal(view.pricing.manualLines[0].priceFixed, true);
  commitNumber(view, 'Line 1 target GP', 50);
  assert.deepEqual(allocatedAmounts(view), [50, 150]);
  assert.equal(view.pricing.manualLines[0].priceFixed, false);
  assert.equal(view.result.listPrice, 200);
});

/** Three unequal cost rows reveal whether editable quotation percentages accidentally rewrite cost Weight. */
const threeLinePricing = () => ({
  ...targetedPricing(),
  manualLines: [20, 30, 50].map((costWeight, index) => ({
    id: `line-${index + 1}`,
    description: `Service ${index + 1}`,
    quantity: 1,
    unit: 'lot',
    costWeight,
    targetGrossMargin: 50,
    unitPrice: costWeight * 2,
  })),
});

test('custom cost weights redistribute costs and GP prices while retaining fixed prices', () => {
  const view = quotationHarness(QuoteLinesEditor, threeLinePricing());
  commitNumber(view, 'Line 1 cost weight', 60);
  assert.deepEqual(allocatedCosts(view), [60, 15, 25]);
  assert.deepEqual(allocatedAmounts(view), [120, 30, 50]);
  assert.equal(view.result.listPrice, 200);
  commitNumber(view, 'Line 2 unit price', 45);
  commitNumber(view, 'Line 1 cost weight', 20);
  assert.deepEqual(allocatedCosts(view), [20, 30, 50]);
  assert.deepEqual(allocatedAmounts(view), [40, 45, 100]);
  assert.equal(view.result.listPrice, 185);
});

test('custom cost weights handle zero siblings, zero cost, invalid input and disabled editing', () => {
  const view = quotationHarness(QuoteLinesEditor, threeLinePricing());
  commitNumber(view, 'Line 1 cost weight', 100);
  assert.deepEqual(allocatedCosts(view), [100, 0, 0]);
  commitNumber(view, 'Line 1 cost weight', 50);
  assert.deepEqual(allocatedCosts(view), [50, 25, 25]);
  const before = structuredClone(view.pricing);
  commitNumber(view, 'Line 1 cost weight', 101);
  assert.deepEqual(view.pricing, before);
  view.props.totalCost = 0;
  commitNumber(view, 'Line 1 cost weight', 20);
  assert.equal(view.label('Line 1 cost weight').props.value, 20);
  view.props.totalCost = 100;
  assert.deepEqual(allocatedCosts(view), [20, 40, 40]);
  const disabled = quotationHarness(QuoteLinesEditor, threeLinePricing(), true);
  commitNumber(disabled, 'Line 1 cost weight', 80);
  assert.equal(disabled.writes, 0);
  const single = quotationHarness(QuoteLinesEditor, {
    ...targetedPricing(),
    manualLines: manualLines().slice(0, 1),
  });
  assert.equal(single.label('Line 1 cost weight').props.disabled, true);
  assert.equal(single.label('Line 1 cost weight').props.value, 100);
});

test('quote share uses the current total, locks edited shares and equally divides the remainder without changing cost weights', () => {
  const view = quotationHarness(QuoteLinesEditor, threeLinePricing());
  commitNumber(view, 'Line 1 quotation percentage', 40);
  assert.deepEqual(allocatedAmounts(view), [80, 60, 60]);
  assert.equal(view.pricing.manualLines[0].allocationFixed, true);
  assert.equal(view.label('Lock allocation for line 1').props.checked, true);
  commitNumber(view, 'Line 2 quotation percentage', 10);
  assert.deepEqual(allocatedAmounts(view), [80, 20, 100]);
  assert.deepEqual(allocatedCosts(view), [20, 30, 50]);
  assert.equal(view.result.listPrice, 200);
  view
    .label('Lock allocation for line 1')
    .props.onChange({ target: { checked: false } });
  commitNumber(view, 'Line 2 quotation percentage', 20);
  assert.deepEqual(allocatedAmounts(view), [80, 40, 80]);
  assert.deepEqual(allocatedCosts(view), [20, 30, 50]);
  assert.equal(view.result.listPrice, 200);
});

test('fixed prices survive quote-share reallocation while unlocked rows absorb the remainder', () => {
  const view = quotationHarness(QuoteLinesEditor, threeLinePricing());
  commitNumber(view, 'Line 1 unit price', 50);
  assert.equal(view.result.listPrice, 210);
  commitNumber(view, 'Line 2 quotation percentage', 20);
  assert.deepEqual(allocatedAmounts(view), [50, 42, 118]);
  assert.equal(view.pricing.manualLines[0].priceFixed, true);
  assert.equal(view.pricing.manualLines[1].allocationFixed, true);
  assert.deepEqual(allocatedCosts(view), [20, 30, 50]);
  assert.equal(view.result.listPrice, 210);
});

test('oversubscribed or out-of-range quotation shares show an error without saving the invalid allocation', () => {
  const view = quotationHarness(QuoteLinesEditor, threeLinePricing());
  commitNumber(view, 'Line 1 quotation percentage', 60);
  const before = structuredClone(view.pricing);
  const writes = view.writes;
  commitNumber(view, 'Line 2 quotation percentage', 50);
  assert.equal(view.writes, writes);
  assert.deepEqual(view.pricing, before);
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /100|exceed|percent/i,
  );
  const control = commitNumber(view, 'Line 2 quotation percentage', 101);
  assert.equal(control.input().props['aria-invalid'], true);
  assert.equal(view.writes, writes);
  commitNumber(view, 'Line 2 quotation percentage', 20);
  assert.deepEqual(allocatedAmounts(view), [120, 40, 40]);
  assert.equal(
    elements(view.render()).some((node) => node.props.role === 'alert'),
    false,
  );
});

test('historical prices load without writes and metadata edits preserve those prices until an explicit line pricing edit', () => {
  const saved = {
    ...legacyTerms(),
    lineMode: 'manual',
    manualTargetPrice: 100,
    manualLines: generatedLines().map(({ amount: _amount, ...line }) => ({
      ...line,
      allocationWeight: 1500,
    })),
  };
  const view = quotationHarness(QuoteLinesEditor, saved);
  view.render();
  assert.equal(view.writes, 0);
  assert.deepEqual(view.pricing, saved);
  view
    .label('Line 1 description')
    .props.onChange({ target: { value: 'Revised scope' } });
  assert.deepEqual(allocatedAmounts(view), [25, 75]);
  assert.deepEqual(allocatedCosts(view), [25, 75]);
  assert.equal(view.pricing.manualTargetPrice, undefined);
  commitNumber(view, 'Line 1 target GP', 50);
  assert.deepEqual(allocatedAmounts(view), [50, 75]);
  assert.deepEqual(allocatedCosts(view), [25, 75]);
  assert.equal(view.pricing.gstPercent, 9);
  assert.equal(view.result.gstAmount, 0);
});

/** Older unmarked manual quotes used relative weights larger than percentages. */
const legacyRelativePricing = () => ({
  ...legacyTerms(),
  lineMode: 'manual',
  manualTargetPrice: 100,
  manualLines: generatedLines().map(({ amount: _amount, ...line }) => ({
    ...line,
    allocationWeight: 1500,
  })),
});

test('editing a quote share normalizes legacy relative weights without losing prices, costs or commercial terms', () => {
  const view = quotationHarness(QuoteLinesEditor, legacyRelativePricing());
  commitNumber(view, 'Line 1 quotation percentage', 40);
  assert.equal(view.writes, 1);
  assert.deepEqual(allocatedAmounts(view), [40, 60]);
  assert.deepEqual(allocatedCosts(view), [25, 75]);
  assert.equal(view.result.listPrice, 100);
  assert.equal(view.pricing.manualPricingBasis, 'line-gp');
  assert.equal(view.pricing.manualLines[0].allocationFixed, true);
  assert.equal(view.pricing.manualLines[0].allocationWeight, 40);
  assert.deepEqual(
    [
      view.pricing.targetGrossMargin,
      view.pricing.discount,
      view.pricing.gstPercent,
    ],
    [27, 5, 9],
  );
  assert.equal(
    elements(view.render()).some((node) => node.props.role === 'alert'),
    false,
  );
});

test('legacy relative weights remain editable after description or GP edits first activate independent line pricing', () => {
  for (const transition of ['description', 'GP']) {
    const view = quotationHarness(QuoteLinesEditor, legacyRelativePricing());
    if (transition === 'description')
      view
        .label('Line 1 description')
        .props.onChange({ target: { value: 'Revised planning' } });
    else commitNumber(view, 'Line 1 target GP', 50);
    assert.equal(view.pricing.manualPricingBasis, 'line-gp');
    const total = view.result.listPrice;
    const writes = view.writes;
    commitNumber(view, 'Line 1 quotation percentage', 60);
    assert.equal(view.writes, writes + 1, transition);
    assert.deepEqual(
      allocatedAmounts(view),
      transition === 'description' ? [60, 40] : [75, 50],
    );
    assert.deepEqual(allocatedCosts(view), [25, 75]);
    assert.equal(view.result.listPrice, total);
    assert.equal(view.pricing.manualLines[0].allocationFixed, true);
    assert.deepEqual(
      [
        view.pricing.targetGrossMargin,
        view.pricing.discount,
        view.pricing.gstPercent,
      ],
      [27, 5, 9],
    );
    assert.equal(
      elements(view.render()).some((node) => node.props.role === 'alert'),
      false,
    );
  }
});

test('a fixed small-price line displays the same GP as domain profit-share cent rounding', () => {
  const pricing = {
    ...targetedPricing(),
    discount: 0,
    profitShareRates: [
      { id: 'share-network', bu: 'Network', ratePercent: 20, active: true },
    ],
    manualLines: [
      {
        id: 'small',
        description: 'Small service',
        quantity: 1,
        unit: 'lot',
        unitPrice: 0.03,
        costWeight: 0.02,
        priceFixed: true,
      },
    ],
  };
  const result = calculatePricing(0.02, pricing, {
    totalCost: 0.02,
    entries: [
      { bu: 'Network', cost: 0.02, directCost: 0.02, unassignedCost: 0 },
    ],
    largestBu: 'Network',
    unassignedCost: 0,
    warnings: [],
  });
  let writes = 0;
  const view = harness(QuoteLinesEditor, {
    pricing,
    setPricing: () => {
      writes++;
    },
    lines: calculateManualQuoteLines(result.allocatedManualLines).lines,
    allocatedLines: result.allocatedManualLines,
    totalCost: 0.02,
    weightedProfitShareRate: result.weightedProfitShareRate,
    disabled: false,
  });
  assert.equal(result.valid, true);
  assert.equal(result.profitShareAmount, 0.01);
  assert.equal(result.grossMarginPercent, 0);
  assert.equal(
    view.label('Line 1 target GP').props.value,
    result.grossMarginPercent,
  );
  assert.equal(writes, 0);
});

test('explicit typing can set a pricing lock while an unchanged focus and blur never saves', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  numericHarness(view.label('Line 1 quotation percentage').props).blur();
  assert.equal(view.writes, 0);
  commitNumber(view, 'Line 1 quotation percentage', 25);
  assert.equal(view.pricing.manualLines[0].allocationFixed, true);
  commitNumber(view, 'Line 1 unit price', 50);
  assert.equal(view.pricing.manualLines[0].priceFixed, true);
  assert.equal(view.pricing.manualLines[0].allocationFixed, false);
  assert.deepEqual(allocatedAmounts(view), [50, 150]);
});

test('custom rows start at zero cost; removal reallocates retained project costs and prices sum from the remaining lines', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  view.button('Add line').props.onClick();
  assert.equal(view.pricing.manualLines.length, 3);
  assert.equal(view.pricing.manualLines[2].description, '');
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /description/,
  );
  view
    .label('Line 3 description')
    .props.onChange({ target: { value: 'Support' } });
  assert.deepEqual(allocatedCosts(view), [25, 75, 0]);
  assert.deepEqual(allocatedAmounts(view), [50, 150, 0]);
  commitNumber(view, 'Line 3 unit price', 30);
  assert.deepEqual(allocatedCosts(view), [25, 75, 0]);
  assert.equal(view.result.listPrice, 230);
  view.label('Line 3 unit').props.onChange({ target: { value: 'day' } });
  commitNumber(view, 'Line 3 quantity', 2);
  assert.equal(view.result.listPrice, 260);
  view.label('Remove quotation line 2').props.onClick();
  assert.deepEqual(allocatedCosts(view), [100, 0]);
  assert.deepEqual(allocatedAmounts(view), [200, 60]);
  assert.equal(view.result.listPrice, 260);
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.description),
    ['Planning', 'Support'],
  );
  view.label('Remove quotation line 2').props.onClick();
  assert.deepEqual(allocatedAmounts(view), [200]);
  view.label('Remove quotation line 1').props.onClick();
  assert.deepEqual(view.pricing.manualLines, []);
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /at least one/,
  );
});

test('disabled pricing rejects every editing handler without writing state', () => {
  const saved = targetedPricing();
  const view = quotationHarness(QuoteLinesEditor, saved, true);
  view.mode('scope');
  view.button('Add line').props.onClick();
  view.label('Remove quotation line 1').props.onClick();
  view
    .label('Line 1 description')
    .props.onChange({ target: { value: 'Changed' } });
  view.label('Line 1 unit').props.onChange({ target: { value: 'day' } });
  view
    .label('Lock allocation for line 1')
    .props.onChange({ target: { checked: true } });
  for (const label of [
    'Line 1 quantity',
    'Line 1 quotation percentage',
    'Line 1 target GP',
    'Line 1 unit price',
  ]) {
    assert.equal(view.label(label).props.disabled, true);
    view.label(label).props.onCommit(50);
    commitNumber(view, label, 75);
  }
  assert.equal(view.writes, 0);
  assert.deepEqual(view.pricing, saved);
});

test('rounded display preserves an untouched ratio but commits an explicitly typed rounded ratio', () => {
  const commits = [];
  const view = numericHarness({
    value: 33.333333333333336,
    label: 'Ratio',
    disabled: false,
    onCommit: (value) => commits.push(value),
  });
  assert.equal(view.input().props.value, '33.3333');
  view.blur();
  assert.deepEqual(commits, []);
  view.type('33.3333');
  view.blur();
  assert.deepEqual(commits, [33.3333]);
  view.blur();
  assert.deepEqual(
    commits,
    [33.3333],
    'A repeated blur does not reapply a committed draft',
  );
  view.type('33.3333');
  view.key('Escape');
  view.blur();
  assert.deepEqual(
    commits,
    [33.3333],
    'Escape clears the edit marker as well as the displayed draft',
  );
});

test('displayed actual GP outside the target range stays valid until the user explicitly edits it', () => {
  for (const value of [100, -20]) {
    const commits = [];
    const view = numericHarness({
      value,
      label: 'Line 1 target GP',
      min: 0,
      max: 95,
      disabled: false,
      commitUnchanged: true,
      onCommit: (next) => commits.push(next),
    });
    view.blur();
    view.key('Enter');
    assert.equal(view.input().props['aria-invalid'], false);
    assert.deepEqual(commits, []);
    view.type(String(value));
    view.blur();
    assert.equal(view.input().props['aria-invalid'], true);
    assert.deepEqual(commits, []);
    view.key('Escape');
    view.blur();
    assert.equal(view.input().props['aria-invalid'], false);
    assert.deepEqual(commits, []);
    view.type('50');
    view.blur();
    assert.deepEqual(commits, [50]);
  }
});

test('numeric drafts stay local until blur or Enter and support clearing and Escape', () => {
  const commits = [];
  const view = numericHarness({
    value: 12,
    label: 'Price',
    disabled: false,
    onCommit: (value) => commits.push(value),
  });
  view.type('');
  assert.equal(view.input().props.value, '');
  assert.deepEqual(commits, []);
  view.type('1.');
  assert.equal(view.input().props.value, '1.');
  assert.deepEqual(commits, []);
  view.type('1.25');
  view.blur();
  assert.deepEqual(commits, [1.25]);
  view.type('23');
  view.key('Enter');
  assert.deepEqual(commits, [1.25, 23]);
  view.type('999');
  view.key('Escape');
  assert.equal(view.input().props.value, '12');
  view.blur();
  assert.deepEqual(commits, [1.25, 23]);
});

test('invalid numeric drafts report errors without coercion and can be corrected or cancelled', () => {
  const commits = [];
  const view = numericHarness({
    value: 1,
    label: 'Target',
    min: 0,
    max: 100,
    decimals: 2,
    disabled: false,
    onCommit: (value) => commits.push(value),
  });
  for (const invalid of ['', ' ', '-1', '101', '1.001', 'Infinity', 'NaN']) {
    view.type(invalid);
    assert.equal(view.input().props['aria-invalid'], false);
    view.blur();
    assert.equal(
      view.input().props['aria-invalid'],
      true,
      `Reject ${JSON.stringify(invalid)}`,
    );
    assert.match(
      textOf(view.find((node) => node.props.role === 'alert')),
      /up to 2 decimals/,
    );
  }
  assert.deepEqual(commits, []);
  view.key('Escape');
  assert.equal(view.input().props.value, '1');
  assert.equal(view.input().props['aria-invalid'], false);
  view.type('0');
  view.key('Enter');
  assert.deepEqual(commits, [0]);
  view.type('100');
  view.blur();
  assert.deepEqual(commits, [0, 100]);
});

test('disabled numeric inputs cannot commit or replace an existing local draft', () => {
  const commits = [];
  const props = {
    value: 5,
    label: 'Price',
    disabled: false,
    onCommit: (value) => commits.push(value),
  };
  const view = numericHarness(props);
  view.type('25');
  props.disabled = true;
  view.type('50');
  assert.equal(view.input().props.value, '25');
  view.blur();
  view.key('Enter');
  assert.deepEqual(commits, []);
});

test('custom drafts survive repeated regrouping and a persisted workspace reload', () => {
  const view = quotationHarness(QuoteLinesEditor, {
    targetGrossMargin: 50,
    discount: 0,
    gstPercent: 0,
    lineMode: 'manual',
    lineSourceMode: 'manual',
    manualPricingBasis: 'line-gp',
    manualLines: manualLines(),
  });
  commitNumber(view, 'Line 1 cost weight', 60);
  commitNumber(view, 'Line 2 unit price', 123);
  const expected = structuredClone(view.pricing.manualLines);
  view.mode('scope');
  commitNumber(view, 'Line 1 target GP', 30);
  view.mode('item');
  view.mode('single');
  assert.deepEqual(view.pricing.customLinesDraft, expected);
  const restored = quotationHarness(
    QuoteLinesEditor,
    JSON.parse(JSON.stringify(view.pricing)),
  );
  restored.mode('manual');
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.pricing.manualLines)),
    JSON.parse(JSON.stringify(expected)),
  );
  restored.mode('scope');
  restored.mode('manual');
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.pricing.manualLines)),
    JSON.parse(JSON.stringify(expected)),
  );
});

test('percentage controls show two decimals, use manual text input and do not round untouched values', () => {
  const writes = [];
  const view = numericHarness({
    label: 'Percent',
    value: 33.333333,
    percentage: true,
    disabled: false,
    onCommit: (value) => writes.push(value),
  });
  assert.equal(view.input().props.type, 'text');
  assert.equal(view.input().props.inputMode, 'decimal');
  assert.equal(view.input().props.value, '33.33');
  view.blur();
  assert.deepEqual(writes, []);
  view.type('25.5');
  view.blur();
  assert.deepEqual(writes, [25.5]);
  assert.equal(view.input().props.value, '25.50');
});

test('scope dialog supports searchable multiselect, cancels cleanly, and applies chosen keys only', async () => {
  const { QuoteScopeDialog } =
    await import('../features/quote/quote-scope-dialog.tsx');
  const writes = [];
  const view = harness(QuoteScopeDialog, {
    lineNumber: 1,
    amount: 100,
    selectedKeys: ['a'],
    scopes: [
      { key: 'a', description: 'Planning', amount: 30 },
      { key: 'b', description: 'Delivery', amount: 70 },
    ],
    disabled: false,
    onSave: (keys) => writes.push(keys),
  });
  const open = () =>
    view
      .find((node) => typeof node.props.onOpenChange === 'function')
      .props.onOpenChange(true);
  open();
  view
    .label('Include scope Delivery')
    .props.onChange({ target: { checked: true } });
  view.button('Cancel').props.onClick();
  assert.deepEqual(writes, []);
  open();
  assert.equal(view.label('Include scope Delivery').props.checked, false);
  view
    .label('Search cost scopes')
    .props.onChange({ target: { value: 'Delivery' } });
  view.button('Select visible / 全选搜索结果').props.onClick();
  view.button('Apply scopes / 应用').props.onClick();
  assert.deepEqual(writes, [['a', 'b']]);
});

test('shared percentage input retains full precision until editing and validates bounds', async () => {
  const { PercentageInput } =
    await import('../components/ui/percentage-input.tsx');
  const writes = [];
  const view = harness(PercentageInput, {
    value: 3.4567,
    min: -100,
    max: 1000,
    onChange: (event) => writes.push(Number(event.target.value)),
  });
  const input = () => view.find((node) => node.props.type === 'text');
  assert.equal(input().props.value, '3.46');
  input().props.onBlur();
  assert.deepEqual(writes, []);
  input().props.onChange({ target: { value: '-' } });
  input().props.onBlur();
  assert.equal(input().props['aria-invalid'], true);
  assert.deepEqual(writes, []);
  input().props.onChange({ target: { value: '2.5' } });
  input().props.onBlur();
  assert.deepEqual(writes, [2.5]);
});
