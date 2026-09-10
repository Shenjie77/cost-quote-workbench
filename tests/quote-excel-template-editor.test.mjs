/** Exercise mapping boundaries and real editor events without writing the user's database or files. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateQuoteExcelMapping } from '../features/quote/excel-template-mapping.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hookKey = Symbol.for('quote-excel-editor-hooks');
const samplesKey = Symbol.for('quote-excel-editor-samples');
const sampleControlKey = Symbol.for('quote-excel-editor-sample-control');
const adapter = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('quote-excel-editor-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useEffect = (...args) => hooks().useEffect(...args);
`)}`;
const sampleBuilder = `data:text/javascript,${encodeURIComponent(`
  export async function buildQuoteWorkbookBuffer(input) {
    (globalThis[Symbol.for('quote-excel-editor-samples')] ||= []).push(structuredClone(input));
    await globalThis[Symbol.for('quote-excel-editor-sample-control')]?.(input);
    return new Uint8Array([80, 75, 3, 4]);
  }
`)}`;

// Only this editor uses the hook adapter; React rendering and real API-client behavior are preserved.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      context.parentURL?.endsWith('/quote-excel-template-editor.tsx')
    )
      return { url: adapter, shortCircuit: true };
    if (
      specifier === '@/features/quote/export-quote-workbook' &&
      context.parentURL?.endsWith('/quote-excel-template-editor.tsx')
    )
      return { url: sampleBuilder, shortCircuit: true };
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
const { QuoteExcelTemplateEditor } =
  await import('../features/master-data/quote-excel-template-editor.tsx');
after(() => hooks.deregister());

/** Every fixture uses a valid content address and only synthetic workbook names. */
const asset = (letter = 'a') => ({
  assetId: letter.repeat(64),
  fileName: 'Customer.xlsx',
  sheets: [
    { name: 'Quotation', rowCount: 30, columnCount: 6 },
    { name: 'Details', rowCount: 20, columnCount: 8 },
  ],
});
const requiredCells = {
  quoteNumber: 'B2',
  client: 'B3',
  project: 'B4',
  quoteBeforeTax: 'F20',
  gstAmount: 'F21',
  quoteAfterTax: 'F22',
  validityDays: 'B5',
  paymentTerms: 'B6',
};
const mapping = (overrides = {}) => ({
  assetId: asset().assetId,
  fileName: 'Customer.xlsx',
  sheetName: 'Quotation',
  detailRow: 12,
  columns: { description: 'B', amount: 'F' },
  ...overrides,
  cells: { ...requiredCells, ...overrides.cells },
});

/** Fill only the mandatory coordinates after upload; optional mappings remain untouched. */
function populateRequired(editor) {
  for (const [label, field] of [
    ['Quote number', 'quoteNumber'],
    ['Client', 'client'],
    ['Project', 'project'],
    ['Total before tax', 'quoteBeforeTax'],
    ['GST amount', 'gstAmount'],
    ['Total after tax', 'quoteAfterTax'],
    ['Validity days', 'validityDays'],
    ['Payment terms', 'paymentTerms'],
  ])
    editor.change(`${label} cell`, requiredCells[field]);
}
const response = (data, status = 200) =>
  new Response(
    JSON.stringify(status < 400 ? { data } : { error: { message: data } }),
    { status },
  );
const settle = () => new Promise((resolve) => setImmediate(resolve));
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
      : typeof node === 'string'
        ? node
        : '';

/** Keep state across controlled renders and flush effect cleanup exactly when dependencies change. */
function harness(props) {
  const child = QuoteExcelTemplateEditor(props);
  const slots = [],
    effects = [];
  let cursor = 0;
  const backend = {
    useState(initial) {
      const index = cursor++;
      slots[index] ||= {
        value: typeof initial === 'function' ? initial() : initial,
      };
      return [
        slots[index].value,
        (value) => {
          slots[index].value =
            typeof value === 'function' ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      slots[index] ||= { current: value };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++,
        previous = slots[index];
      if (
        !previous ||
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
  return {
    render() {
      cursor = 0;
      globalThis[hookKey] = backend;
      let rendered;
      try {
        rendered = child.type(props);
      } finally {
        delete globalThis[hookKey];
      }
      for (const effect of effects.splice(0)) effect();
      return rendered;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
    input(label) {
      return elements(this.render()).find(
        (item) => item.props['aria-label'] === label,
      );
    },
    button(label) {
      return elements(this.render()).find(
        (item) => item.props.onClick && textOf(item).trim() === label,
      );
    },
    change(label, value) {
      this.input(label).props.onChange({ target: { value } });
    },
    upload(file) {
      this.input('Upload customer Excel template').props.onChange({
        target: { files: [file], value: file.name },
      });
    },
  };
}

test('mapping validation accepts original workbook limits and does not mutate its input', () => {
  const value = mapping({
    columns: { description: 'A', amount: 'XFD' },
    cells: { quoteNumber: 'XFD20000', quoteAfterTax: 'C20' },
  });
  const before = structuredClone(value);
  assert.deepEqual(validateQuoteExcelMapping(value, asset().sheets), []);
  assert.deepEqual(value, before);
});

test('mapping rejects conflicting writes, malformed addresses and out-of-workbook sheets', () => {
  for (const [patch, pattern] of [
    [{ assetId: '../wrong' }, /Upload/],
    [{ sheetName: 'Absent' }, /not present/],
    [{ detailRow: 0 }, /integer/],
    [{ detailRow: 1.5 }, /integer/],
    [{ detailRow: 20001 }, /integer/],
    [{ columns: { description: '', amount: 'F' } }, /description.*required/],
    [{ columns: { description: 'B', amount: 'B' } }, /more than one/],
    [{ columns: { description: 'XFE', amount: 'F' } }, /A to XFD/],
    [
      { columns: { description: 'B', amount: 'F', internalCost: 'C' } },
      /Unsupported detail/,
    ],
    [{ cells: { client: 'B12' } }, /repeatable detail row/],
    [{ cells: { client: 'B4', project: 'B4' } }, /more than one/],
    [{ cells: { client: 'A0' } }, /address/],
    [{ cells: { client: 'XFE1' } }, /address/],
    [{ cells: { client: 'A20001' } }, /address/],
    [{ cells: { client: 'Other!A1' } }, /address/],
    [{ cells: { client: '$A$1' } }, /address/],
    [{ cells: { internalCost: 'A1' } }, /Unsupported quotation/],
  ])
    assert.match(
      validateQuoteExcelMapping(mapping(patch), asset().sheets).join(' '),
      pattern,
    );
  for (const field of Object.keys(requiredCells)) {
    const missing = mapping();
    delete missing.cells[field];
    assert.match(
      validateQuoteExcelMapping(missing).join(' '),
      new RegExp(`${field} cell is required`),
    );
  }
});

test('editor entry is English, local-only and isolated by customer template identity', () => {
  const props = { templateId: 'first', onChange() {} };
  const html = renderToStaticMarkup(
    React.createElement(QuoteExcelTemplateEditor, props),
  );
  assert.match(html, /Upload customer Excel template/);
  assert.match(html, /local database/);
  assert.doesNotMatch(html, /\p{Script=Han}/u);
  assert.notEqual(
    QuoteExcelTemplateEditor(props).key,
    QuoteExcelTemplateEditor({ ...props, templateId: 'second' }).key,
  );
});

test('uploads stage mapping; Apply validates and canonicalizes while Reset and Remove keep the source immutable', async (t) => {
  const changes = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options?.method, 'POST');
    return response(asset());
  });
  const editor = harness({
    templateId: 'first',
    onChange: (value) => changes.push(value),
  });
  t.after(() => editor.unmount());
  editor.upload(new File(['xlsx-fixture'], 'Customer.xlsx'));
  await settle();
  assert.equal(changes.length, 0);
  assert.equal(editor.input('Repeatable detail row').props.value, '12');
  assert.equal(editor.input('Description column *').props.value, 'B');
  assert.equal(editor.input('Amount column *').props.value, 'F');
  editor.change('Amount column *', 'B');
  await editor.button('Apply mapping').props.onClick();
  assert.equal(changes.length, 0);
  assert.match(textOf(editor.render()), /more than one/);
  editor.change('Amount column *', ' f ');
  editor.change('Quantity column', 'd');
  populateRequired(editor);
  editor.change('Client cell', ' b8 ');
  await editor.button('Apply mapping').props.onClick();
  assert.deepEqual(
    changes[0],
    mapping({
      columns: { description: 'B', amount: 'F', quantity: 'D' },
      cells: { client: 'B8' },
    }),
  );
  editor.button('Reset mapping').props.onClick();
  assert.equal(
    changes.length,
    1,
    'reset remains local until explicitly applied',
  );
  assert.equal(editor.input('Quantity column').props.value, '');
  editor.button('Remove Excel layout').props.onClick();
  assert.equal(
    changes.length,
    1,
    'removing an unapplied upload only clears local staging',
  );
  assert.equal(editor.input('Description column *'), undefined);
});

test('existing mapping edits never mutate the source and removal only detaches this template', async (t) => {
  const saved = mapping(),
    before = structuredClone(saved),
    changes = [];
  t.mock.method(globalThis, 'fetch', async () => response(asset()));
  const editor = harness({
    templateId: 'saved',
    value: saved,
    onChange: (value) => changes.push(value),
  });
  editor.render();
  await settle();
  t.after(() => editor.unmount());
  editor.change('Description column *', 'C');
  assert.deepEqual(saved, before);
  assert.equal(changes.length, 0);
  editor.button('Remove Excel layout').props.onClick();
  assert.deepEqual(changes, [undefined]);
  assert.deepEqual(saved, before);
});

test('invalid uploads make no request and repeated in-flight uploads are locked; late responses are ignored after switching', async (t) => {
  const pending = [],
    changes = [];
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Promise((resolve) => pending.push(resolve)),
  );
  const editor = harness({
    templateId: 'first',
    onChange: (value) => changes.push(value),
  });
  editor.upload(new File(['data'], 'wrong.xlsm'));
  editor.upload(new File([], 'empty.xlsx'));
  assert.equal(pending.length, 0);
  const file = new File(['data'], 'Customer.xlsx');
  editor.upload(file);
  editor.upload(file);
  assert.equal(pending.length, 1);
  assert.equal(
    editor.input('Upload customer Excel template').props.disabled,
    true,
  );
  editor.unmount();
  pending[0](response(asset()));
  await settle();
  const next = harness({
    templateId: 'second',
    onChange: (value) => changes.push(value),
  });
  t.after(() => next.unmount());
  assert.equal(next.input('Description column *'), undefined);
  assert.equal(changes.length, 0);
});

test('failed replacement retains the current mapping and allows a clean retry', async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (!options?.method) return response(asset());
    attempts += 1;
    return attempts === 1
      ? response('Unsupported chart: use a plain workbook.', 400)
      : response(asset('b'));
  });
  const saved = mapping(),
    changes = [];
  const editor = harness({
    templateId: 'saved',
    value: saved,
    onChange: (value) => changes.push(value),
  });
  t.after(() => editor.unmount());
  editor.render();
  await settle();
  editor.upload(new File(['data'], 'Replacement.xlsx'));
  await settle();
  assert.match(textOf(editor.render()), /Unsupported chart/);
  assert.equal(editor.input('Description column *').props.value, 'B');
  assert.equal(changes.length, 0);
  editor.upload(new File(['data'], 'Replacement.xlsx'));
  await settle();
  assert.doesNotMatch(textOf(editor.render()), /Unsupported chart/);
  populateRequired(editor);
  await editor.button('Apply mapping').props.onClick();
  assert.equal(changes[0].assetId, 'b'.repeat(64));
  assert.equal(saved.assetId, 'a'.repeat(64));
});

test('Apply retains the last valid mapping when workbook geometry fails validation and can be retried', async (t) => {
  const saved = mapping(),
    changes = [];
  globalThis[sampleControlKey] = async () => {
    throw new Error('Detail row intersects a vertical merge.');
  };
  t.after(() => {
    delete globalThis[sampleControlKey];
  });
  t.mock.method(globalThis, 'fetch', async () => response(asset()));
  const editor = harness({
    templateId: 'saved',
    value: saved,
    onChange: (value) => changes.push(value),
  });
  t.after(() => editor.unmount());
  editor.render();
  await settle();
  editor.change('Repeatable detail row', '14');
  await editor.button('Apply mapping').props.onClick();
  assert.equal(changes.length, 0);
  assert.equal(saved.detailRow, 12);
  assert.match(
    textOf(
      elements(editor.render()).find((item) => item.props.role === 'alert'),
    ),
    /vertical merge/,
  );
  assert.equal(
    editor.input('Upload customer Excel template').props.disabled,
    false,
  );
  delete globalThis[sampleControlKey];
  await editor.button('Apply mapping').props.onClick();
  assert.equal(changes[0].detailRow, 14);
  assert.equal(
    elements(editor.render()).find((item) => item.props.role === 'alert'),
    undefined,
  );
});

test('late Apply validation is discarded after switching templates and repeat clicks share the in-flight lock', async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  let builds = 0;
  globalThis[sampleControlKey] = async () => {
    builds += 1;
    await pending;
  };
  t.after(() => {
    delete globalThis[sampleControlKey];
  });
  t.mock.method(globalThis, 'fetch', async () => response(asset()));
  const changes = [];
  const editor = harness({
    templateId: 'first',
    value: mapping(),
    onChange: (value) => changes.push(value),
  });
  editor.render();
  await settle();
  const apply = editor.button('Apply mapping').props.onClick;
  const first = apply();
  await apply();
  await settle();
  assert.equal(builds, 1);
  editor.unmount();
  finish();
  await first;
  const next = harness({
    templateId: 'second',
    onChange: (value) => changes.push(value),
  });
  t.after(() => next.unmount());
  assert.equal(next.input('Description column *'), undefined);
  assert.equal(
    changes.length,
    0,
    'the old template validation must not update the current selection',
  );
});

test('sample export uses three synthetic rows and downloads without applying mapping or creating project archives', async (t) => {
  const requests = [],
    changes = [],
    downloads = [];
  globalThis[samplesKey] = [];
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      createElement: (tag) => {
        assert.equal(tag, 'a');
        return {
          click() {
            downloads.push({ fileName: this.download, href: this.href });
          },
        };
      },
    },
  });
  t.after(() => {
    globalThis.document = previousDocument;
    delete globalThis[samplesKey];
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options?.method || 'GET' });
    return response(asset());
  });
  const editor = harness({
    templateId: 'saved',
    value: mapping(),
    onChange: (value) => changes.push(value),
  });
  t.after(() => editor.unmount());
  editor.render();
  await settle();
  editor.button('Test with sample rows').props.onClick();
  for (let attempt = 0; attempt < 30 && !downloads.length; attempt++)
    await settle();
  const input = globalThis[samplesKey][0];
  assert.ok(input);
  assert.equal(input.project.id, 'SAMPLE');
  assert.equal(input.lines.length, 3);
  assert.equal(
    input.lines.reduce((sum, row) => sum + row.amount, 0),
    input.pricing.listPrice,
  );
  assert.match(input.quoteNumber, /SAMPLE/);
  assert.deepEqual(input.template.excel, mapping());
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileName, 'SAMPLE_Customer.xlsx');
  assert.equal(changes.length, 0);
  assert.equal(
    requests.length,
    1,
    'only the local inventory is read by this controller',
  );
  assert.ok(
    requests.every(
      (request) =>
        request.method === 'GET' &&
        request.url.includes('/quote-template-assets/'),
    ),
  );
});
