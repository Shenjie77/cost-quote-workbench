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
const {
  PersonnelBulkEntryForm,
  confirmPersonnelBulkPreview,
  personnelBulkInputKey,
} = await import('../features/cost/components/personnel-bulk-entry-dialog.tsx');
const { parsePersonnelBulkEntry } =
  await import('../features/cost/personnel-bulk-entry.ts');
const { initialResourceTypes } =
  await import('../features/master-data/demo-data.ts');
const { initialRateSettings } = await import('../features/cost/demo-data.ts');
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
const button = (tree, label) =>
  walk(tree).find(
    (node) =>
      typeof node.props.onClick === 'function' &&
      content(node).startsWith(label),
  );
const resources = structuredClone(initialResourceTypes);
const rates = {
  ...initialRateSettings,
  tdStart: '2026-01-01',
  baseYear: 2026,
  annualUplifts: [0, 0, 0, 0, 0],
  allowancePools: ['LOCAL'],
};
const text = 'Scope\tBU\tRE Type\tMD\nDeployment\tNetwork\tLOCAL-L1\t2.5';
const options = {
  defaultMode: 'mandays',
  defaultYear: 0,
  fillDownScope: true,
  hasHeader: true,
  mapping: {},
  reTypeOverrides: {},
};
const parsed = () =>
  parsePersonnelBulkEntry(text, { ...options, resources, rates });
const formProps = (extra = {}) => ({
  text,
  options,
  resources,
  rates,
  preview: null,
  current: false,
  page: 0,
  onPage: noop,
  onTextChange: noop,
  onOptionsChange: noop,
  onPreview: noop,
  onConfirm: noop,
  onClose: noop,
  ...extra,
});

test('Bulk preview shows Group separately and changing its fill-down option invalidates the reviewed input', () => {
  const groupedText =
    'Group\tScope\tBU\tRE Type\tMD\nBranch A\tDeployment\tNetwork\tLOCAL-L1\t2\n\tDesign\tNetwork\tLOCAL-L1\t1';
  const preview = parsePersonnelBulkEntry(groupedText, {
    ...options,
    resources,
    rates,
  });
  let changed;
  const tree = PersonnelBulkEntryForm(
    formProps({
      text: groupedText,
      preview,
      current: true,
      onOptionsChange: (value) => {
        changed = value;
      },
    }),
  );
  const markup = renderToStaticMarkup(tree);
  assert.match(markup, />Group<\/th>/);
  assert.match(markup, />Branch A<\/td>/);
  assert.match(markup, />Unassigned Group<\/td>/);
  assert.match(markup, /Deployment/);
  const field = walk(tree).find(
    (node) => node.props['aria-label'] === 'Bulk fill down Group',
  );
  assert.equal(field.props.checked, false);
  field.props.onChange({ target: { checked: true } });
  assert.equal(changed.fillDownGroup, true);
  assert.equal(changed.fillDownScope, true);
  assert.notEqual(
    personnelBulkInputKey(groupedText, options, resources, rates),
    personnelBulkInputKey(groupedText, changed, resources, rates),
  );
  assert.equal(preview.rows[1].groupName, '');
});

test('typing and Preview never append rows; only a current valid Confirm invokes the append callback', () => {
  let previews = 0,
    confirms = 0,
    closes = 0,
    edited = '';
  const props = formProps({
    onTextChange: (value) => {
      edited = value;
    },
    onPreview: () => previews++,
    onConfirm: () => confirms++,
    onClose: () => closes++,
  });
  const tree = PersonnelBulkEntryForm(props);
  walk(tree)
    .find((node) => node.props['aria-label'] === 'Bulk personnel table')
    .props.onChange({ target: { value: text } });
  assert.equal(edited, text);
  button(tree, 'Preview').props.onClick();
  assert.equal(previews, 1);
  button(tree, 'Confirm & Add').props.onClick();
  assert.equal(confirms, 0);
  const ready = PersonnelBulkEntryForm({
    ...props,
    preview: parsed(),
    current: true,
  });
  assert.equal(button(ready, 'Confirm & Add').props.disabled, false);
  button(ready, 'Confirm & Add').props.onClick();
  assert.equal(confirms, 1);
  button(ready, 'Cancel').props.onClick();
  assert.equal(closes, 1);
});

test('invalid or stale previews remain visible but cannot confirm; mapping and RE corrections are staged', () => {
  let updates,
    confirms = 0;
  const preview = parsePersonnelBulkEntry(text.replace('LOCAL-L1', 'Unknown'), {
    ...options,
    resources,
    rates,
  });
  assert.equal(preview.canConfirm, false);
  const props = formProps({
    preview,
    current: true,
    onOptionsChange: (value) => {
      updates = value;
    },
    onConfirm: () => confirms++,
  });
  const tree = PersonnelBulkEntryForm(props);
  walk(tree)
    .find((node) => node.props['aria-label'] === 'Bulk row 2 RE Type')
    .props.onChange({ target: { value: 'rt-local-l1' } });
  assert.deepEqual(updates.reTypeOverrides, { 2: 'rt-local-l1' });
  assert.equal(preview.canConfirm, false);
  button(tree, 'Confirm & Add').props.onClick();
  assert.equal(confirms, 0);
  const stale = PersonnelBulkEntryForm({
    ...props,
    preview: parsed(),
    current: false,
  });
  assert.equal(button(stale, 'Confirm & Add').props.disabled, true);
  button(stale, 'Confirm & Add').props.onClick();
  assert.equal(confirms, 0);
  const html = renderToStaticMarkup(
    React.createElement(PersonnelBulkEntryForm, {
      ...props,
      preview: parsed(),
      current: false,
    }),
  );
  assert.match(html, /Generate a new preview/);
  assert.match(html, /Batch personnel cost/);
  assert.match(html, /1,545.00/);
});

test('confirmation rejects changed text/options/rates and a newly locked version', () => {
  const preview = parsed();
  const key = personnelBulkInputKey(text, options, resources, rates);
  let calls = 0;
  const messages = [];
  const attempt = (extra = {}) =>
    confirmPersonnelBulkPreview({
      preview,
      currentKey: key,
      previewKey: key,
      resources,
      rates,
      onConfirm: () => {
        calls++;
        return true;
      },
      announce: (message) => messages.push(message),
      ...extra,
    });
  assert.equal(
    attempt({
      currentKey: personnelBulkInputKey(
        text + '\nOther',
        options,
        resources,
        rates,
      ),
    }),
    false,
  );
  assert.equal(
    attempt({
      currentKey: personnelBulkInputKey(
        text,
        { ...options, defaultYear: 2 },
        resources,
        rates,
      ),
    }),
    false,
  );
  assert.equal(attempt({ rates: { ...rates, allowancePools: [] } }), false);
  assert.equal(
    attempt({
      resources: resources.map((resource) => ({
        ...resource,
        mandayRate: resource.mandayRate + 1,
      })),
    }),
    false,
  );
  assert.equal(attempt({ locked: true }), false);
  assert.equal(calls, 0);
  assert.equal(messages.length, 4);
});

test('Confirm supplies fresh manual IDs and a rejected append keeps the proposal reusable', () => {
  const preview = parsed(),
    before = structuredClone(preview);
  const key = personnelBulkInputKey(text, options, resources, rates);
  const saved = [],
    messages = [];
  let accept = false;
  const attempt = () =>
    confirmPersonnelBulkPreview({
      preview,
      currentKey: key,
      previewKey: key,
      resources,
      rates,
      onConfirm: (rows, basis) => {
        assert.equal(basis, preview.basisFingerprint);
        if (accept) saved.push(...rows);
        return accept;
      },
      announce: (message) => messages.push(message),
    });
  assert.equal(attempt(), false);
  assert.deepEqual(saved, []);
  assert.equal(messages.length, 1);
  accept = true;
  assert.equal(attempt(), true);
  assert.equal(saved.length, 1);
  assert.match(saved[0].id, /^CI-[0-9a-f-]{36}$/);
  assert.ok(!('source' in saved[0]));
  assert.deepEqual(preview, before);
  assert.notEqual(saved[0].id, preview.rows[0].id);
  saved[0].scope = 'Changed outside preview';
  assert.equal(preview.rows[0].scope, 'Deployment');
});

test('locked form guards all editing handlers while preserving Cancel and review paging', () => {
  let writes = 0,
    closes = 0;
  const tree = PersonnelBulkEntryForm(
    formProps({
      preview: parsed(),
      current: true,
      locked: true,
      onTextChange: () => writes++,
      onOptionsChange: () => writes++,
      onPreview: () => writes++,
      onConfirm: () => writes++,
      onClose: () => closes++,
    }),
  );
  for (const node of walk(tree)) {
    if (node.props.onChange) {
      assert.equal(node.props.disabled, true);
      node.props.onChange({ target: { value: 'changed', checked: false } });
    }
  }
  button(tree, 'Preview').props.onClick();
  button(tree, 'Confirm & Add').props.onClick();
  assert.equal(writes, 0);
  button(tree, 'Cancel').props.onClick();
  assert.equal(closes, 1);
});

test('oversized paste retains an invalid-size sentinel instead of silently truncating into a valid batch', () => {
  let pasted = '';
  const tree = PersonnelBulkEntryForm(
    formProps({
      onTextChange: (value) => {
        pasted = value;
      },
    }),
  );
  const field = walk(tree).find(
    (node) => node.props['aria-label'] === 'Bulk personnel table',
  );
  assert.equal(field.props.maxLength, undefined);
  field.props.onChange({ target: { value: text + ' '.repeat(1_000_010) } });
  assert.equal(pasted.length, 1_000_001);
  const preview = parsePersonnelBulkEntry(pasted, {
    ...options,
    resources,
    rates,
  });
  assert.equal(preview.canConfirm, false);
  assert.match(preview.issues[0], /1,000,000 characters/);
});
