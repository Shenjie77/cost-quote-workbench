/** Exercise actual rate-control handlers with local React state and no workspace or database writes. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';

const root = fileURLToPath(new URL('../', import.meta.url));
const hookKey = Symbol.for('subcontract-rate-ui-hooks');
const reactAdapter = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  export const useState = (...args) => (globalThis[Symbol.for('subcontract-rate-ui-hooks')] || React).useState(...args);
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (
      specifier === 'react' &&
      parent.endsWith('/subcontract-rate-assumptions.tsx')
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
const {
  SubcontractRateAssumptions,
  SubcontractBaseYearInput,
  SubcontractUpliftInput,
} =
  await import('../features/cost/components/subcontract-rate-assumptions.tsx');
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

/** Keep hook values across rerenders so partial typing is tested through production handlers. */
function harness(Component, props) {
  const slots = [];
  let cursor = 0;
  return {
    props,
    render() {
      cursor = 0;
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
      };
      try {
        return Component(props);
      } finally {
        delete globalThis[hookKey];
      }
    },
    find(predicate) {
      const element = elements(this.render()).find(predicate);
      assert.ok(element, 'Expected control exists');
      return element;
    },
    input() {
      return this.find(
        (node) => node.props.type === 'number' || node.props.type === 'text',
      );
    },
    type(value) {
      this.input().props.onChange({ target: { value } });
    },
    blur() {
      this.input().props.onBlur();
    },
    key(key) {
      const input = this.input();
      input.props.onKeyDown({
        key,
        currentTarget: { blur: () => input.props.onBlur() },
      });
    },
  };
}
const years = [2026, 2027, 2028, 2029, 2030];
const settings = () => ({
  baseYear: 2025,
  defaultUplift: 3,
  annualUplifts: [3, 4, 5, 6, 7],
});
const expand = (panel) =>
  panel
    .find((node) => node.props['aria-controls'] === 'subcon-annual-rates')
    .props.onClick();
const uplift = (extra = {}) =>
  harness(SubcontractUpliftInput, {
    value: 3,
    label: 'Test uplift',
    disabled: false,
    className: '',
    onChange: () => {},
    ...extra,
  });

test('percentage typing remains local until a complete value is committed by blur or Enter', () => {
  const saved = [];
  const input = uplift({ onChange: (value) => saved.push(value) });
  input.type('');
  assert.equal(input.input().props.value, '');
  assert.deepEqual(saved, []);
  input.blur();
  assert.equal(input.input().props['aria-invalid'], true);
  assert.deepEqual(saved, []);
  input.type('-');
  input.blur();
  assert.deepEqual(saved, []);
  input.type('-2.5');
  assert.deepEqual(saved, []);
  input.key('Enter');
  assert.deepEqual(saved, [-2.5]);
  assert.equal(input.input().props['aria-invalid'], false);
  input.type('4.25');
  input.blur();
  assert.deepEqual(saved, [-2.5, 4.25]);
});

test('invalid percentage ranges never save, Escape restores saved text, and unchanged blur is inert', () => {
  const saved = [];
  const input = uplift({ onChange: (value) => saved.push(value) });
  input.blur();
  for (const value of ['-101', '1001', 'Infinity', 'NaN']) {
    input.type(value);
    input.blur();
    assert.equal(input.input().props['aria-invalid'], true);
  }
  assert.deepEqual(saved, []);
  input.key('Escape');
  assert.equal(input.input().props.value, '3.00');
  assert.equal(input.input().props['aria-invalid'], false);
  input.blur();
  assert.deepEqual(saved, []);
  for (const value of ['-100', '1000']) {
    input.type(value);
    input.blur();
  }
  assert.deepEqual(saved, [-100, 1000]);
});

test('base year is entered manually and incomplete, erased or invalid years never persist', () => {
  const saved = [];
  const unset = harness(SubcontractBaseYearInput, {
    locked: false,
    onChange: (year) => saved.push(year),
  });
  assert.equal(unset.input().props.value, '');
  unset.blur();
  assert.deepEqual(saved, []);
  unset.type('202');
  unset.blur();
  assert.equal(unset.input().props['aria-invalid'], true);
  assert.deepEqual(saved, []);
  unset.type('2028');
  assert.deepEqual(saved, []);
  unset.key('Enter');
  assert.deepEqual(saved, [2028]);
  const existing = harness(SubcontractBaseYearInput, {
    value: 2025,
    locked: false,
    onChange: (year) => saved.push(year),
  });
  for (const value of ['', '1999', '2201', '2025.5']) {
    existing.type(value);
    existing.blur();
  }
  assert.deepEqual(saved, [2028]);
});

test('visiting and expanding legacy rate settings never creates assumptions or inherits personnel dates', () => {
  const saved = [];
  const panel = harness(SubcontractRateAssumptions, {
    actualYears: years,
    onChange: (value) => saved.push(value),
  });
  panel.render();
  const base = panel.find((node) => node.type === SubcontractBaseYearInput);
  assert.equal(base.props.value, undefined);
  expand(panel);
  const percentages = elements(panel.render()).filter(
    (node) => node.type === SubcontractUpliftInput,
  );
  assert.equal(percentages.length, 6);
  assert.ok(percentages.every((node) => node.props.disabled));
  assert.deepEqual(saved, []);
  base.props.onChange(2028);
  assert.deepEqual(saved, [
    { baseYear: 2028, defaultUplift: 0, annualUplifts: [0, 0, 0, 0, 0] },
  ]);
});

test('future base year disables every annual percentage through the baseline and retains later saved rates', () => {
  const original = { ...settings(), baseYear: 2028 };
  const saved = [];
  const panel = harness(SubcontractRateAssumptions, {
    settings: original,
    actualYears: years,
    onChange: (value) => saved.push(value),
  });
  expand(panel);
  const annual = elements(panel.render()).filter(
    (node) =>
      node.type === SubcontractUpliftInput && node.props.label.startsWith('Y'),
  );
  assert.deepEqual(
    annual.map((node) => node.props.disabled),
    [true, true, true, false, false],
  );
  assert.deepEqual(
    annual.map((node) => node.props.value),
    [0, 0, 0, 6, 7],
  );
  for (const node of annual.slice(0, 3)) {
    const control = harness(SubcontractUpliftInput, node.props);
    control.type('99');
    control.blur();
  }
  assert.deepEqual(saved, []);
  assert.deepEqual(original.annualUplifts, [3, 4, 5, 6, 7]);
  const text = textOf(panel.render());
  assert.match(text, /1\.0600×/);
  assert.match(text, /1\.1342×/);
});

test('default uplift writes all years only after commit; an annual change preserves independent settings and other years', () => {
  const original = settings();
  const saved = [];
  const panel = harness(SubcontractRateAssumptions, {
    settings: original,
    actualYears: years,
    onChange: (value) => saved.push(value),
  });
  expand(panel);
  const defaultControl = harness(
    SubcontractUpliftInput,
    panel.find(
      (node) =>
        node.type === SubcontractUpliftInput &&
        node.props.label === 'Subcon default uplift',
    ).props,
  );
  defaultControl.type('-');
  defaultControl.blur();
  assert.deepEqual(saved, []);
  defaultControl.type('-2');
  defaultControl.blur();
  assert.deepEqual(saved[0], {
    baseYear: 2025,
    defaultUplift: -2,
    annualUplifts: [-2, -2, -2, -2, -2],
  });
  const annual = harness(
    SubcontractUpliftInput,
    panel.find(
      (node) =>
        node.type === SubcontractUpliftInput &&
        node.props.label === 'Y3 subcon rate uplift',
    ).props,
  );
  annual.type('9');
  annual.key('Enter');
  assert.deepEqual(saved[1], {
    baseYear: 2025,
    defaultUplift: 3,
    annualUplifts: [3, 4, 9, 6, 7],
  });
  assert.deepEqual(original, settings());
});

test('locked inputs and parent setters refuse changes while the settings panel remains readable', () => {
  const saved = [];
  const lockedUplift = uplift({
    disabled: true,
    onChange: (value) => saved.push(value),
  });
  lockedUplift.type('99');
  lockedUplift.blur();
  lockedUplift.key('Enter');
  assert.equal(lockedUplift.input().props.value, '3.00');
  const lockedBase = harness(SubcontractBaseYearInput, {
    value: 2025,
    locked: true,
    onChange: (value) => saved.push(value),
  });
  lockedBase.type('2030');
  lockedBase.blur();
  lockedBase.key('Enter');
  assert.equal(lockedBase.input().props.value, '2025');
  const panel = harness(SubcontractRateAssumptions, {
    settings: settings(),
    actualYears: years,
    locked: true,
    onChange: (value) => saved.push(value),
  });
  expand(panel);
  panel
    .find((node) => node.type === SubcontractBaseYearInput)
    .props.onChange(2030);
  for (const node of elements(panel.render()).filter(
    (node) => node.type === SubcontractUpliftInput,
  )) {
    assert.equal(node.props.disabled, true);
    node.props.onChange(99);
  }
  assert.deepEqual(saved, []);
});
