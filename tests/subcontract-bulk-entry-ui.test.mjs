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
const { SubcontractBulkEntryForm } =
  await import('../features/cost/components/subcontract-bulk-entry-dialog.tsx');
const { SubcontractCostSheet } =
  await import('../features/cost/components/subcontract-cost-sheet.tsx');
const { SubcontractLinesTable } =
  await import('../features/cost/components/subcontract-lines-table.tsx');
const { parseSubcontractBulkEntry } =
  await import('../features/cost/subcontract-bulk-entry.ts');
hooks.deregister();
const noop = () => {};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const content = (node) =>
  Array.isArray(node)
    ? node.map(content).join('')
    : React.isValidElement(node)
      ? content(node.props.children)
      : node == null
        ? ''
        : String(node);
const button = (tree, name) =>
  walk(tree).find(
    (node) =>
      typeof node.props.onClick === 'function' &&
      content(node).startsWith(name),
  );
const basis = {
  value: { mode: 'project', lines: [], siteTypes: [] },
  target: { kind: 'project' },
  catalog: [],
  actualYears: [2026, 2027, 2028, 2029, 2030],
};
const options = { defaultYear: 0, defaultBU: '', mapping: {} };
const text =
  'Code\tDescription\tBU\tUnit\tUnit Price\tY1\nSC-NEW\tInstallation\tNetwork\tjob\t25\t2';
const parsed = () => parseSubcontractBulkEntry(text, options, basis);
const props = (extra = {}) => ({
  text,
  options,
  basis,
  preview: null,
  current: false,
  page: 0,
  onPage: noop,
  onTextChange: noop,
  onOptionsChange: noop,
  onPreview: noop,
  onConfirm: noop,
  onClose: noop,
  onCopyTemplate: noop,
  ...extra,
});

test('bulk form stages text, options and preview; only a valid reviewed confirm appends', () => {
  let writes = 0,
    previews = 0,
    confirms = 0,
    changed;
  const tree = SubcontractBulkEntryForm(
    props({
      onTextChange: () => writes++,
      onOptionsChange: (value) => {
        changed = value;
      },
      onPreview: () => previews++,
      onConfirm: () => confirms++,
    }),
  );
  walk(tree)
    .find((node) => node.props['aria-label'] === 'Subcontract bulk table')
    .props.onChange({ target: { value: text } });
  assert.equal(writes, 1);
  walk(tree)
    .find(
      (node) => node.props['aria-label'] === 'Subcontract bulk quantity year',
    )
    .props.onChange({ target: { value: '2' } });
  assert.equal(changed.defaultYear, 2);
  button(tree, 'Preview').props.onClick();
  assert.equal(previews, 1);
  button(tree, 'Confirm & Add').props.onClick();
  assert.equal(confirms, 0);
  const ready = SubcontractBulkEntryForm(
    props({ preview: parsed(), current: true, onConfirm: () => confirms++ }),
  );
  assert.equal(button(ready, 'Confirm & Add').props.disabled, false);
  button(ready, 'Confirm & Add').props.onClick();
  assert.equal(confirms, 1);
});

test('stale or invalid previews stay visible without allowing confirm; locked handlers refuse edits', () => {
  let writes = 0,
    closes = 0;
  for (const extra of [
    { current: false },
    { preview: { ...parsed(), canConfirm: false } },
    { locked: true },
  ]) {
    const tree = SubcontractBulkEntryForm(
      props({
        preview: parsed(),
        current: true,
        onConfirm: () => writes++,
        ...extra,
      }),
    );
    assert.equal(button(tree, 'Confirm & Add').props.disabled, true);
    button(tree, 'Confirm & Add').props.onClick();
  }
  const locked = SubcontractBulkEntryForm(
    props({
      preview: parsed(),
      current: true,
      locked: true,
      onTextChange: () => writes++,
      onOptionsChange: () => writes++,
      onPreview: () => writes++,
      onCopyTemplate: () => writes++,
      onClose: () => closes++,
    }),
  );
  for (const node of walk(locked))
    if (node.props.onChange) {
      assert.equal(node.props.disabled, true);
      node.props.onChange({ target: { value: 'changed' } });
    }
  button(locked, 'Preview').props.onClick();
  button(locked, 'Copy template').props.onClick();
  button(locked, 'Cancel').props.onClick();
  assert.equal(writes, 0);
  assert.equal(closes, 1);
  assert.match(
    renderToStaticMarkup(
      SubcontractBulkEntryForm(props({ preview: parsed(), current: false })),
    ),
    /Generate a new preview/,
  );
});

test('oversized input keeps an invalid sentinel and copies never overwrite the pasted table', () => {
  let pasted = '',
    copied = '';
  const tree = SubcontractBulkEntryForm(
    props({
      onTextChange: (value) => {
        pasted = value;
      },
      onCopyTemplate: (value) => {
        copied = value;
      },
    }),
  );
  button(tree, 'Copy template').props.onClick();
  assert.match(copied, /Code\tDescription/);
  assert.equal(pasted, '');
  walk(tree)
    .find((node) => node.props['aria-label'] === 'Subcontract bulk table')
    .props.onChange({ target: { value: 'X'.repeat(1_000_100) } });
  assert.equal(pasted.length, 1_000_001);
  assert.equal(
    parseSubcontractBulkEntry(pasted, options, basis).canConfirm,
    false,
  );
});

test('project and site controls have compact Bulk Entry actions and item codes are bold', () => {
  const line = parsed().lines[0];
  const siteLine = { ...line, quantityPerSite: 2 };
  delete siteLine.quantities;
  const value = {
    mode: 'site-types',
    lines: [line],
    siteTypes: [
      {
        id: 'site-a',
        name: 'Small',
        sites: [1, 0, 0, 0, 0],
        lines: [siteLine],
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(SubcontractCostSheet, {
      value,
      catalog: [],
      actualYears: basis.actualYears,
      onChange: noop,
      announce: noop,
    }),
  );
  assert.equal((html.match(/Bulk Entry/g) || []).length, 2);
  assert.match(html, /<strong[^>]*font-bold[^>]*>SC-NEW<\/strong>/);
  const table = renderToStaticMarkup(
    React.createElement(SubcontractLinesTable, {
      lines: [line],
      actualYears: basis.actualYears,
      project: true,
      rateFactors: [1.1, 1, 1, 1, 1],
      onChange: noop,
      onDelete: noop,
      announce: noop,
    }),
  );
  assert.match(table, /55.00/);
  assert.match(table, /value="25"/);
});
