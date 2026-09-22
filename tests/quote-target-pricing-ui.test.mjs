/** Exercise quotation controls through actual React handlers without project or database writes. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { calculateManualQuoteLines } from '../features/quote/quote-lines.ts';
import { allocateQuotePercentages } from '../features/quote/percentage-allocation.ts';

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
      ['/quote-lines-editor.tsx', '/quote-number-input.tsx'].some((name) =>
        parent.endsWith(name),
      )
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
  generatedLines().map(({ amount: _amount, ...line }) => ({
    ...line,
    allocationWeight: 50,
    unitPrice: 50,
  }));

/** Mirror the parent’s controlled pricing state; all writes stay in this fixture. */
function quotationHarness(
  Component,
  initial,
  disabled = false,
  sourceLines = generatedLines(),
) {
  let pricing = structuredClone(initial);
  let writes = 0;
  let gpTargetPrice = 100;
  const props = {
    disabled,
    get gpTargetPrice() {
      return gpTargetPrice;
    },
    get allocatedLines() {
      return pricing.manualPricingBasis === 'gp'
        ? allocateQuotePercentages(pricing.manualLines ?? [], gpTargetPrice)
            .lines
        : undefined;
    },
    get pricing() {
      return pricing;
    },
    get lines() {
      return pricing.lineMode === 'manual'
        ? calculateManualQuoteLines(props.allocatedLines ?? pricing.manualLines)
            .lines
        : sourceLines;
    },
    setPricing(update) {
      writes++;
      pricing = typeof update === 'function' ? update(pricing) : update;
    },
  };
  const view = harness(Component, props);
  return {
    ...view,
    changeGpTarget(value) {
      gpTargetPrice = value;
    },
    get effectiveLines() {
      return props.allocatedLines ?? pricing.manualLines;
    },
    get pricing() {
      return pricing;
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
  const input = () => view.find((node) => node.props.type === 'number');
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
  manualPricingBasis: 'gp',
  manualLines: manualLines(),
});
const allocatedAmounts = (view) =>
  calculateManualQuoteLines(view.effectiveLines).lines.map(
    (line) => line.amount,
  );

test('manual mode uses the GP target with equal unlocked percentages and preserves commercial terms', () => {
  const view = quotationHarness(QuoteLinesEditor, {
    ...legacyTerms(),
    lineMode: 'scope',
  });
  view.mode('manual');
  assert.equal(view.pricing.manualPricingBasis, 'gp');
  assert.equal(view.pricing.manualTargetPrice, undefined);
  assert.deepEqual(allocatedAmounts(view), [50, 50]);
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.allocationWeight),
    [50, 50],
  );
  assert.ok(
    !elements(view.render()).some(
      (node) => node.props.label === 'Target total before discount and tax',
    ),
  );
  commitNumber(view, 'Line 1 unit price', 30);
  const saved = structuredClone(view.pricing);
  view.mode('item');
  view.mode('manual');
  assert.deepEqual(view.pricing, saved);
  assert.deepEqual(
    [
      view.pricing.targetGrossMargin,
      view.pricing.discount,
      view.pricing.gstPercent,
    ],
    [27, 5, 9],
  );
});

test('loading and text edits preserve historical prices until a GP allocation edit', () => {
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
  assert.match(textOf(view.render()), /Saved prices retained/);
  assert.equal(view.writes, 0);
  assert.deepEqual(view.pricing, saved);
  view
    .label('Line 1 description')
    .props.onChange({ target: { value: 'Revised scope' } });
  assert.equal(view.pricing.manualPricingBasis, undefined);
  assert.deepEqual(allocatedAmounts(view), [25, 75]);
  commitNumber(view, 'Line 1 allocation percentage', 40);
  assert.deepEqual(allocatedAmounts(view), [40, 60]);
  assert.equal(view.pricing.manualTargetPrice, undefined);
  assert.equal(view.pricing.gstPercent, 9);
});

test('an edited percentage locks that share while remaining unlocked rows equally divide the remainder', () => {
  const initial = targetedPricing();
  initial.manualLines.push({
    id: 'support',
    description: 'Support',
    quantity: 1,
    unit: 'lot',
    unitPrice: 0,
  });
  const view = quotationHarness(QuoteLinesEditor, initial);
  commitNumber(view, 'Line 1 allocation percentage', 40);
  assert.deepEqual(allocatedAmounts(view), [40, 30, 30]);
  assert.equal(view.pricing.manualLines[0].allocationFixed, true);
  assert.equal(view.label('Lock allocation for line 1').props.checked, true);
  commitNumber(view, 'Line 2 allocation percentage', 10);
  assert.deepEqual(allocatedAmounts(view), [40, 10, 50]);
  view
    .label('Lock allocation for line 1')
    .props.onChange({ target: { checked: false } });
  assert.deepEqual(allocatedAmounts(view), [45, 10, 45]);
  view.changeGpTarget(200);
  assert.deepEqual(allocatedAmounts(view), [90, 20, 90]);
  assert.equal(view.pricing.discount, 5);
});

test('unit price locking survives GP changes, percentage edits replace that lock, and unlocking shares equally', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  commitNumber(view, 'Line 1 unit price', 40);
  assert.deepEqual(allocatedAmounts(view), [40, 60]);
  assert.equal(view.pricing.manualLines[0].priceFixed, true);
  view.changeGpTarget(200);
  assert.deepEqual(allocatedAmounts(view), [40, 160]);
  commitNumber(view, 'Line 1 allocation percentage', 30);
  assert.deepEqual(allocatedAmounts(view), [60, 140]);
  assert.equal(view.pricing.manualLines[0].priceFixed, false);
  assert.equal(view.pricing.manualLines[0].allocationFixed, true);
  view.changeGpTarget(100);
  assert.deepEqual(allocatedAmounts(view), [30, 70]);
  view
    .label('Lock allocation for line 1')
    .props.onChange({ target: { checked: false } });
  assert.deepEqual(allocatedAmounts(view), [50, 50]);
});

test('explicitly typing the existing value locks it, while merely focusing and blurring does not', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  numericHarness(view.label('Line 1 allocation percentage').props).blur();
  assert.equal(view.writes, 0);
  commitNumber(view, 'Line 1 allocation percentage', 50);
  assert.equal(view.pricing.manualLines[0].allocationFixed, true);
  commitNumber(view, 'Line 1 unit price', 50);
  assert.equal(view.pricing.manualLines[0].priceFixed, true);
  assert.equal(view.pricing.manualLines[0].allocationFixed, false);
});

test('adding or removing rows redistributes the unlocked shares and retains draft validation', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  view.changeGpTarget(120);
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
  assert.deepEqual(allocatedAmounts(view), [40, 40, 40]);
  view.label('Line 3 unit').props.onChange({ target: { value: 'day' } });
  commitNumber(view, 'Line 3 quantity', 2);
  assert.equal(view.effectiveLines[2].unitPrice, 20);
  view.label('Remove quotation line 2').props.onClick();
  assert.deepEqual(allocatedAmounts(view), [60, 60]);
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.description),
    ['Planning', 'Support'],
  );
  view.label('Remove quotation line 2').props.onClick();
  assert.deepEqual(allocatedAmounts(view), [120]);
  view.label('Remove quotation line 1').props.onClick();
  assert.deepEqual(view.pricing.manualLines, []);
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /at least one/,
  );
});

test('oversubscribed locks retain the entered values and show a repairable allocation error', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  commitNumber(view, 'Line 1 allocation percentage', 60);
  commitNumber(view, 'Line 2 allocation percentage', 50);
  assert.equal(view.pricing.manualLines[1].allocationWeight, 50);
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /100|exceed|percent/i,
  );
  view
    .label('Lock allocation for line 2')
    .props.onChange({ target: { checked: false } });
  assert.deepEqual(allocatedAmounts(view), [60, 40]);
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
    'Line 1 allocation percentage',
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
