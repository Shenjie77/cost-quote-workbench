import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { initialQuoteTemplates } from '../features/quote/types.ts';
import { captureQuoteReferences } from '../features/quote/catalog-domain.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const key = Symbol.for('quote-template-catalog-hooks');
const adapter = `data:text/javascript,${encodeURIComponent(`
import * as React from ${JSON.stringify(import.meta.resolve('react'))};
export * from ${JSON.stringify(import.meta.resolve('react'))};
export const useState = (...args) => globalThis[Symbol.for('quote-template-catalog-hooks')].useState(...args);
export const useEffect = (...args) => globalThis[Symbol.for('quote-template-catalog-hooks')].useEffect(...args);
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL || '';
    if (specifier === 'react' && parent.endsWith('/template-picker.tsx'))
      return { url: adapter, shortCircuit: true };
    if (
      specifier.startsWith('@/') ||
      (specifier.startsWith('.') &&
        parent.startsWith(pathToFileURL(root).href) &&
        !parent.includes('/node_modules/'))
    ) {
      const base = specifier.startsWith('@/')
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, parent));
      for (const ext of ['.ts', '.tsx'])
        if (existsSync(base + ext))
          return next(pathToFileURL(base + ext).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (
      (!url.endsWith('.tsx') && !url.endsWith('/workspace-client.ts')) ||
      url.includes('/node_modules/')
    )
      return next(url, context);
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
const { QuoteTemplatePicker } =
  await import('../features/quote/template-picker.tsx');
const { Select } = await import('../components/ui/select.tsx');
const { loadQuoteTemplateCatalog } =
  await import('../features/quote/template-catalog.ts');
const elements = (node) =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : React.isValidElement(node)
      ? [node, ...elements(node.props.children)]
      : [];
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join('')
    : React.isValidElement(node)
      ? text(node.props.children)
      : node == null
        ? ''
        : String(node);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function mount(props) {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const api = {
    props,
    render() {
      cursor = 0;
      pending = [];
      globalThis[key] = {
        useState(initial) {
          const i = cursor++;
          slots[i] ??= {
            value: typeof initial === 'function' ? initial() : initial,
          };
          return [
            slots[i].value,
            (next) => {
              slots[i].value =
                typeof next === 'function' ? next(slots[i].value) : next;
            },
          ];
        },
        useEffect(fn, deps) {
          const i = cursor++;
          const old = slots[i];
          if (!old || deps.some((d, n) => d !== old.deps[n])) {
            pending.push(() => {
              old?.cleanup?.();
              slots[i] = { deps, cleanup: fn() };
            });
          }
        },
      };
      try {
        api.tree = QuoteTemplatePicker(api.props);
      } finally {
        delete globalThis[key];
      }
      pending.forEach((fn) => fn());
      return api.tree;
    },
    button(label) {
      return elements(api.tree).find(
        (el) =>
          el.type?.displayName !== 'Select' &&
          el.props.onClick &&
          text(el.props.children) === label,
      );
    },
    select() {
      return elements(api.tree).find((el) => el.type === Select);
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
  api.render();
  return api;
}
const original = {
  ...initialQuoteTemplates[0],
  id: 'project-template',
  name: 'Applied snapshot',
};
const fresh = {
  ...original,
  id: 'new-global-template',
  name: 'New global template',
};
function setup(loadCatalog) {
  const applied = [];
  const api = mount({
    templates: [original],
    client: 'Client A',
    selectedId: original.id,
    busy: false,
    onManage() {},
    onApply(...args) {
      applied.push(args);
    },
    loadCatalog,
  });
  return { api, applied };
}

test('a saved global template created after the project becomes selectable without changing its applied snapshot', async () => {
  const source = {
    templates: [
      fresh,
      { ...fresh, id: 'inactive', active: false },
      { ...fresh, id: 'other', clientPattern: 'Client B' },
    ],
    assumptions: [],
  };
  const { api, applied } = setup(async () => source);
  assert.equal(api.button(' Apply Template').props.disabled, true);
  await flush();
  api.render();
  assert.deepEqual(
    api.select().props.items.map((i) => i.value),
    [fresh.id],
  );
  assert.match(text(api.tree), /Applied: Applied snapshot/);
  assert.deepEqual(applied, []);
  api.select().props.onValueChange(fresh.id);
  api.render();
  api.button(' Apply Template').props.onClick();
  assert.equal(applied[0][1].id, fresh.id);
  assert.deepEqual(applied[0][2], source.assumptions);
  assert.deepEqual(api.props.templates, [original]);
  api.unmount();
});

test('failed catalog reads block Apply, preserve snapshot, and retry on Refresh', async () => {
  let calls = 0;
  const { api, applied } = setup(async () => {
    if (++calls === 1) throw new Error('API unavailable');
    return { templates: [fresh], assumptions: [] };
  });
  await flush();
  api.render();
  assert.match(text(api.tree), /API unavailable/);
  assert.match(text(api.tree), /Applied snapshot/);
  assert.equal(api.button(' Apply Template').props.disabled, true);
  api.button(' Refresh templates').props.onClick();
  api.render();
  await flush();
  api.render();
  assert.equal(api.button(' Apply Template').props.disabled, false);
  assert.deepEqual(applied, []);
  api.unmount();
});

test('switching catalog source discards late results from the previous request', async () => {
  let finish;
  const { api } = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  api.props.loadCatalog = async () => ({ templates: [fresh], assumptions: [] });
  api.render();
  await flush();
  api.render();
  finish({ templates: [original], assumptions: [] });
  await flush();
  api.render();
  assert.deepEqual(
    api.select().props.items.map((i) => i.value),
    [fresh.id],
  );
  api.unmount();
});

test('same-ID template refresh requires Apply; captured snapshot is detached and unrelated templates remain unchanged', async () => {
  const revised = {
    ...original,
    name: 'Updated saved template',
    paymentTerms: 'New terms',
  };
  const { api, applied } = setup(async () => ({
    templates: [revised],
    assumptions: [],
  }));
  await flush();
  api.render();
  assert.match(text(api.tree), /Applied: Applied snapshot/);
  assert.deepEqual(applied, []);
  api.button(' Apply Template').props.onClick();
  const unrelated = { ...original, id: 'other' };
  const next = captureQuoteReferences([original, unrelated], [applied[0][1]]);
  assert.equal(next[0].paymentTerms, 'New terms');
  assert.equal(next[1], unrelated);
  revised.paymentTerms = 'Changed again';
  assert.equal(next[0].paymentTerms, 'New terms');
  assert.notEqual(original.paymentTerms, 'New terms');
  api.unmount();
});

test('catalog loading reads both saved catalogs and rejects unresolved conflicts', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  let conflict = false;
  globalThis.fetch = async (url) => {
    const address =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push(address);
    const templates = address.includes('quote-templates');
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          revision: 1,
          items: templates ? [fresh] : [],
          sources: [],
          total: templates ? 1 : 0,
          conflicts: conflict ? [{ key: fresh.id }] : [],
        },
      }),
    );
  };
  try {
    assert.deepEqual(await loadQuoteTemplateCatalog(), {
      templates: [fresh],
      assumptions: [],
    });
    assert.equal(calls.length, 2);
    assert(calls.some((url) => url.includes('/masterdata/assumptions')));
    conflict = true;
    await assert.rejects(
      loadQuoteTemplateCatalog(),
      /Resolve quotation template/,
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});
