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
  generatedLines().map(({ amount: _amount, ...line }, index) => ({
    ...line,
    allocationWeight: index ? 3 : 1,
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
  const props = {
    disabled,
    get pricing() {
      return pricing;
    },
    get lines() {
      return pricing.lineMode === 'manual'
        ? calculateManualQuoteLines(pricing.manualLines).lines
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
  manualTargetPrice: 100,
  manualLines: manualLines(),
});
const allocatedAmounts = (view) =>
  calculateManualQuoteLines(view.pricing.manualLines).lines.map(
    (line) => line.amount,
  );

test('mode changes seed new target pricing once and preserve existing manual edits and tax', () => {
  const view = quotationHarness(QuoteLinesEditor, {
    ...legacyTerms(),
    lineMode: 'scope',
  });
  assert.equal(view.writes, 0);
  view.mode('manual');
  assert.equal(view.pricing.manualTargetPrice, 100);
  assert.deepEqual(allocatedAmounts(view), [25, 75]);
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.allocationWeight),
    [25, 75],
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

test('opening legacy manual pricing is read-only until Rebalance explicitly activates a target', () => {
  const saved = {
    ...legacyTerms(),
    lineMode: 'manual',
    manualLines: generatedLines().map(({ amount: _amount, ...line }) => line),
  };
  const view = quotationHarness(QuoteLinesEditor, saved);
  assert.match(textOf(view.render()), /Target not set/);
  assert.equal(view.writes, 0);
  assert.deepEqual(view.pricing, saved);
  view.mode('single');
  view.mode('manual');
  assert.deepEqual(view.pricing, saved);
  view.button('Rebalance · 按比例分配').props.onClick();
  assert.equal(view.pricing.manualTargetPrice, 100);
  assert.deepEqual(allocatedAmounts(view), [25, 75]);
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.allocationWeight),
    [25, 75],
  );
  assert.equal(view.pricing.gstPercent, 9);
});

test('target and relative-ratio edits allocate the entire target without changing tax or discount', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  const target = numericHarness(
    view.label('Target total before discount and tax').props,
  );
  target.type('200');
  assert.equal(
    view.pricing.manualTargetPrice,
    100,
    'Typing remains a local draft',
  );
  assert.equal(view.writes, 0);
  target.key('Enter');
  assert.equal(view.pricing.manualTargetPrice, 200);
  assert.deepEqual(allocatedAmounts(view), [50, 150]);
  commitNumber(view, 'Line 1 allocation ratio', 3);
  assert.deepEqual(allocatedAmounts(view), [100, 100]);
  assert.equal(view.pricing.manualLines[0].priceFixed, false);
  assert.match(textOf(view.render()), /Matched/);
  assert.equal(view.pricing.discount, 5);
  assert.equal(view.pricing.gstPercent, 9);
});

test('editing a unit price fixes that line, excludes its ratio, and releasing it restores allocation', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  commitNumber(view, 'Line 1 unit price', 40);
  assert.deepEqual(allocatedAmounts(view), [40, 60]);
  assert.equal(view.pricing.manualLines[0].priceFixed, true);
  assert.equal(view.label('Fix price for line 1').props.checked, true);
  const ratio = numericHarness(view.label('Line 1 allocation ratio').props);
  assert.equal(ratio.input().props.disabled, true);
  const writes = view.writes;
  ratio.type('500');
  ratio.blur();
  assert.equal(view.writes, writes, 'A fixed line does not accept ratio edits');
  commitNumber(view, 'Target total before discount and tax', 200);
  assert.deepEqual(allocatedAmounts(view), [40, 160]);
  view
    .label('Fix price for line 1')
    .props.onChange({ target: { checked: false } });
  assert.deepEqual(allocatedAmounts(view), [50, 150]);
  assert.equal(view.pricing.manualLines[0].priceFixed, false);
  assert.equal(view.label('Line 1 allocation ratio').props.disabled, false);
});

test('adding an editable draft and removing rows keeps the target and rebalances valid rows', () => {
  const view = quotationHarness(QuoteLinesEditor, targetedPricing());
  view.button('Add line').props.onClick();
  assert.equal(view.pricing.manualLines.length, 3);
  assert.deepEqual(allocatedAmounts(view), [25, 75, 0]);
  assert.equal(view.pricing.manualLines[2].description, '');
  assert.equal(view.pricing.manualLines[2].allocationWeight, 1);
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /description/,
  );
  view
    .label('Line 3 description')
    .props.onChange({ target: { value: 'Support' } });
  assert.deepEqual(allocatedAmounts(view), [20, 60, 20]);
  view.label('Line 3 unit').props.onChange({ target: { value: 'day' } });
  assert.equal(view.pricing.manualLines[2].unit, 'day');
  commitNumber(view, 'Line 3 quantity', 2);
  assert.equal(view.pricing.manualLines[2].quantity, 2);
  assert.equal(view.pricing.manualLines[2].unitPrice, 10);
  view.label('Remove quotation line 2').props.onClick();
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.description),
    ['Planning', 'Support'],
  );
  assert.deepEqual(allocatedAmounts(view), [50, 50]);
  assert.equal(view.pricing.manualTargetPrice, 100);
  view.label('Remove quotation line 2').props.onClick();
  view.label('Remove quotation line 1').props.onClick();
  assert.deepEqual(view.pricing.manualLines, []);
  assert.equal(view.pricing.manualTargetPrice, 100);
  assert.equal(view.button('Rebalance · 按比例分配').props.disabled, true);
});

test('an impossible target remains visible with an error and preserves the typed fixed price', () => {
  const initial = targetedPricing();
  initial.manualLines[0].priceFixed = true;
  const view = quotationHarness(QuoteLinesEditor, initial);
  commitNumber(view, 'Target total before discount and tax', 10);
  assert.equal(view.pricing.manualTargetPrice, 10);
  assert.deepEqual(allocatedAmounts(view), [25, 75]);
  assert.match(
    textOf(view.find((node) => node.props.role === 'alert')),
    /fixed/i,
  );
  assert.match(textOf(view.render()), /Remaining/);
  assert.equal(view.pricing.manualLines[0].unitPrice, 25);
});

test('locked pricing rejects every editing handler without writing controlled state', () => {
  const saved = targetedPricing();
  const view = quotationHarness(QuoteLinesEditor, saved, true);
  view.mode('scope');
  view.button('Add line').props.onClick();
  view.button('Rebalance · 按比例分配').props.onClick();
  view.label('Remove quotation line 1').props.onClick();
  view
    .label('Line 1 description')
    .props.onChange({ target: { value: 'Changed' } });
  view.label('Line 1 unit').props.onChange({ target: { value: 'day' } });
  view
    .label('Fix price for line 1')
    .props.onChange({ target: { checked: true } });
  for (const label of [
    'Target total before discount and tax',
    'Line 1 quantity',
    'Line 1 allocation ratio',
    'Line 1 unit price',
  ]) {
    assert.equal(view.label(label).props.disabled, true);
    view.label(label).props.onCommit(50);
    commitNumber(view, label, 75);
  }
  assert.equal(view.writes, 0);
  assert.deepEqual(view.pricing, saved);
});

test('initial weights preserve fractional proportions and zero-price rows on repeated allocation', () => {
  const source = [
    ...generatedLines().map((line, index) => ({
      ...line,
      unitPrice: index + 1,
      amount: index + 1,
    })),
    {
      id: 'included',
      description: 'Included',
      quantity: 1,
      unit: 'lot',
      unitPrice: 0,
      amount: 0,
    },
  ];
  const view = quotationHarness(QuoteLinesEditor, legacyTerms(), false, source);
  view.mode('manual');
  const weights = view.pricing.manualLines.map((line) => line.allocationWeight);
  assert.deepEqual(weights, [(1 / 3) * 100, (2 / 3) * 100, 0]);
  const ratio = numericHarness(view.label('Line 1 allocation ratio').props);
  assert.equal(ratio.input().props.value, '33.3333');
  const writes = view.writes;
  ratio.blur();
  assert.equal(
    view.writes,
    writes,
    'An unchanged rounded display must not lose stored precision',
  );
  commitNumber(view, 'Target total before discount and tax', 30);
  assert.deepEqual(allocatedAmounts(view), [10, 20, 0]);
  commitNumber(view, 'Target total before discount and tax', 3);
  assert.deepEqual(allocatedAmounts(view), [1, 2, 0]);
  assert.deepEqual(
    view.pricing.manualLines.map((line) => line.allocationWeight),
    weights,
  );
});

test('adding to legacy and mixed-weight lines materializes the same ratios shown in the editor', () => {
  for (const mixed of [false, true]) {
    const initial = {
      ...legacyTerms(),
      lineMode: 'manual',
      manualLines: generatedLines().map(
        ({ amount: _amount, ...line }, index) => ({
          ...line,
          unitPrice: mixed ? (index ? 80 : 25) : index ? 160 : 40,
          ...(mixed && index === 0 ? { allocationWeight: 20 } : {}),
        }),
      ),
    };
    const view = quotationHarness(QuoteLinesEditor, initial);
    assert.equal(view.label('Line 1 allocation ratio').props.value, 20);
    assert.equal(view.label('Line 2 allocation ratio').props.value, 80);
    assert.equal(
      view.writes,
      0,
      'Displayed fallback ratios do not mutate a saved quotation',
    );
    view.button('Add line').props.onClick();
    assert.deepEqual(
      view.pricing.manualLines.map((line) => line.allocationWeight),
      [20, 80, 1],
    );
    assert.equal(view.pricing.manualTargetPrice, undefined);
    view
      .label('Line 3 description')
      .props.onChange({ target: { value: 'Support' } });
    commitNumber(view, 'Target total before discount and tax', 101);
    assert.deepEqual(allocatedAmounts(view), [20, 80, 1]);
    assert.deepEqual(
      view.pricing.manualLines.map((line) => line.allocationWeight),
      [20, 80, 1],
    );
    assert.equal(view.pricing.gstPercent, 9);
  }
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
