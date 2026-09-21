/** Exercise the real import controller with isolated workbook/model boundaries and no business writes. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';

const root = fileURLToPath(new URL('../', import.meta.url));
const hookKey = Symbol.for('master-data-bulk-ui-hooks');
const serviceKey = Symbol.for('master-data-bulk-ui-services');
const moduleUrl = (source) =>
  `data:text/javascript,${encodeURIComponent(source)}`;
const reactAdapter = moduleUrl(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('master-data-bulk-ui-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useEffect = (...args) => hooks().useEffect(...args);
`);
const workbookAdapter = moduleUrl(`
  const services = () => globalThis[Symbol.for('master-data-bulk-ui-services')];
  export const createBulkImportWorkbook = (...args) => services().create(...args);
  export const readBulkImportWorkbook = (...args) => services().read(...args);
`);
const modelAdapter = moduleUrl(`
  const services = () => globalThis[Symbol.for('master-data-bulk-ui-services')];
  export const previewBulkImport = (...args) => services().preview(...args);
  export const bulkImportContextKey = (...args) => services().context(...args);
`);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (
      specifier === 'react' &&
      /\/(bulk-import-controls|global-master-data-page)\.tsx$/.test(parent)
    )
      return { url: reactAdapter, shortCircuit: true };
    if (parent.endsWith('/bulk-import-controls.tsx')) {
      if (specifier === './bulk-import-workbook')
        return { url: workbookAdapter, shortCircuit: true };
      if (specifier === './bulk-import-model')
        return { url: modelAdapter, shortCircuit: true };
    }
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
    if (
      (!url.endsWith('.tsx') && !url.endsWith('/workspace-client.ts')) ||
      url.includes('/node_modules/')
    )
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
const { BulkImportControls } =
  await import('../features/master-data/bulk-import-controls.tsx');
const { GlobalMasterDataPage } =
  await import('../features/master-data/global-master-data-page.tsx');
const { MasterDataView } =
  await import('../features/master-data/master-data-view.tsx');
const { WorkflowPublishDialog } =
  await import('../features/master-data/workflow-publish-dialog.tsx');
const { Dialog } = await import('../components/ui/dialog.tsx');
const { masterDataTabs } =
  await import('../features/master-data/navigation.ts');
after(() => hooks.deregister());

/** Preserve React elements so tests invoke production callbacks rather than copied controller logic. */
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
      : typeof node === 'string' || typeof node === 'number'
        ? String(node)
        : '';
const settle = () => new Promise((resolve) => setImmediate(resolve));
const contextKey = (items, related) => JSON.stringify({ items, related });
const defer = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Track hook lifetimes and rerendered props, including cancellation during pending async work. */
function harness(Component, props) {
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
    props,
    render() {
      cursor = 0;
      globalThis[hookKey] = backend;
      let tree;
      try {
        tree = Component(props);
      } finally {
        delete globalThis[hookKey];
      }
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
    find(predicate) {
      const result = elements(this.render()).find(predicate);
      assert.ok(result, 'Requested control is rendered');
      return result;
    },
    button(label) {
      return this.find(
        (node) =>
          typeof node.props.onClick === 'function' &&
          (node.props['aria-label'] === label || textOf(node).trim() === label),
      );
    },
    upload(file) {
      const event = { target: { files: [file], value: file.name } };
      this.find(
        (node) => node.type === 'input' && node.props.type === 'file',
      ).props.onChange(event);
      assert.equal(
        event.target.value,
        '',
        'The same file can be selected again after correction',
      );
    },
    dialog() {
      return this.find((node) => node.type === Dialog);
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

/** Supply realistic boundary results while recording all controller requests. */
function fixture(t, patch = {}) {
  const calls = {
    create: [],
    read: [],
    preview: [],
    apply: [],
    announcements: [],
  };
  const rows = [
    {
      row: 2,
      values: { id: 'row-new', code: 'NEW', unitPrice: 0, active: false },
    },
  ];
  const imported = [
    { id: 'row-new', code: 'NEW', unitPrice: 0, active: false },
  ];
  const services = {
    context: contextKey,
    create: async (...args) => {
      calls.create.push(args);
      return new Uint8Array([1, 2, 3]);
    },
    read: async (...args) => {
      calls.read.push(args);
      return structuredClone(rows);
    },
    preview: (...args) => {
      calls.preview.push(args);
      return {
        items: [...structuredClone(args[2]), ...structuredClone(imported)],
        added: 1,
        updated: 0,
        unchanged: 0,
        issues: [],
        contextKey: contextKey(args[2], args[3]),
        changes: [{ row: 2, action: 'add', key: 'row-new', label: 'New row' }],
      };
    },
  };
  globalThis[serviceKey] = services;
  const props = {
    tab: 'resources',
    items: [{ id: 'old', code: 'OLD', active: true }],
    revision: 7,
    disabled: false,
    onApply: (items) => calls.apply.push(items),
    announce: (message) => calls.announcements.push(message),
    ...patch,
  };
  const ui = harness(BulkImportControls, props);
  const file = new File([new Uint8Array([4, 5])], 'catalog.xlsx');
  t.after(() => {
    ui.unmount();
    delete globalThis[serviceKey];
  });
  return { ui, props, services, calls, rows, imported, file };
}

/** Browser download shims capture output bytes and filename without opening a browser or writing files. */
function downloads(t) {
  const blobs = [],
    anchors = [],
    timers = [],
    revoked = [];
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag) => {
        assert.equal(tag, 'a');
        const anchor = {
          click() {
            this.clicked = true;
          },
          remove() {
            this.removed = true;
          },
        };
        anchors.push(anchor);
        return anchor;
      },
      body: {
        appendChild: (anchor) => {
          anchor.appended = true;
          return anchor;
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: (callback) => timers.push(callback) },
  });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    blobs.push(blob);
    return 'blob:bulk-import-test';
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  t.after(() => {
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  });
  return { blobs, anchors, timers, revoked };
}

test('all ten tabs expose an accessible template and import entry, with disabled catalogs protected', (t) => {
  const { ui, props, calls } = fixture(t);
  assert.equal(masterDataTabs.length, 10);
  for (const tab of masterDataTabs) {
    props.tab = tab.value;
    assert.equal(
      ui.button(`Download ${tab.label} Excel template`).props.disabled,
      false,
    );
    assert.equal(ui.button(`Bulk import ${tab.label}`).props.disabled, false);
    assert.equal(ui.dialog().props.open, false);
  }
  props.disabled = true;
  assert.equal(ui.button('Bulk import Status').props.disabled, true);
  assert.equal(
    ui.button('Download Status Excel template').props.disabled,
    false,
  );
  assert.equal(ui.find((node) => node.type === 'input').props.disabled, true);
  assert.deepEqual(calls.apply, []);
});

test('template and current-data downloads use the selected tab and copy draft records without applying them', async (t) => {
  const { ui, props, calls } = fixture(t);
  const output = downloads(t);
  ui.button('Download RE Types Excel template').props.onClick();
  await settle();
  assert.deepEqual(calls.create, [['resources', undefined]]);
  assert.equal(
    output.anchors[0].download,
    'master-data-resources-template.xlsx',
  );
  assert.equal(
    output.anchors[0].clicked &&
      output.anchors[0].removed &&
      output.anchors[0].appended,
    true,
  );
  assert.deepEqual(
    [...new Uint8Array(await output.blobs[0].arrayBuffer())],
    [1, 2, 3],
  );
  ui.button('Bulk import RE Types').props.onClick();
  ui.button('Export Current Data').props.onClick();
  await settle();
  assert.deepEqual(calls.create[1], ['resources', props.items]);
  assert.notEqual(calls.create[1][1], props.items);
  assert.equal(output.anchors[1].download, 'master-data-resources-data.xlsx');
  assert.deepEqual(calls.apply, []);
  output.timers.forEach((callback) => callback());
  assert.deepEqual(output.revoked, [
    'blob:bulk-import-test',
    'blob:bulk-import-test',
  ]);
});

test('selecting a file only prepares a review with zero and false intact; confirmation applies a detached draft once', async (t) => {
  const { ui, calls, file, props } = fixture(t);
  const before = structuredClone(props.items);
  ui.button('Bulk import RE Types').props.onClick();
  ui.upload(file);
  await settle();
  assert.deepEqual(calls.read[0], ['resources', new Uint8Array([4, 5])]);
  assert.equal(calls.preview.length, 1);
  assert.deepEqual(calls.apply, []);
  assert.deepEqual(props.items, before);
  assert.equal(ui.dialog().props.open, true);
  assert.match(textOf(ui.render()), /unitPrice: 0/);
  assert.match(textOf(ui.render()), /active: false/);
  const confirm = ui.button('Import to Draft');
  assert.equal(confirm.props.disabled, false);
  confirm.props.onClick();
  confirm.props.onClick();
  await settle();
  assert.equal(calls.apply.length, 1);
  assert.equal(calls.apply[0].length, 2);
  assert.notEqual(calls.apply[0][0], props.items[0]);
  assert.equal(ui.dialog().props.open, false);
  assert.match(calls.announcements.at(-1), /Use Save this tab to save/);
});

test('row issues are visible and reject even a stale direct confirm callback without partial draft changes', async (t) => {
  const { ui, calls, services, file } = fixture(t);
  const preview = services.preview;
  services.preview = (...args) => ({
    ...preview(...args),
    issues: [{ row: 2, column: 'mandayRate', message: 'Invalid rate' }],
  });
  ui.button('Bulk import RE Types').props.onClick();
  ui.upload(file);
  await settle();
  assert.match(textOf(ui.render()), /Row 2 · mandayRate: Invalid rate/);
  assert.match(textOf(ui.render()), /No changes will be imported/);
  assert.equal(ui.button('Import to Draft').props.disabled, true);
  ui.button('Import to Draft').props.onClick();
  await settle();
  assert.deepEqual(calls.apply, []);
});

for (const change of ['draft', 'revision', 'related']) {
  test(`a ${change} change after review rejects the stale preview and retains the dialog`, async (t) => {
    const { ui, props, calls, file } = fixture(t, {
      related: { assumptions: [{ id: 'A', text: 'Saved terms' }] },
    });
    ui.button('Bulk import RE Types').props.onClick();
    ui.upload(file);
    await settle();
    if (change === 'draft')
      props.items = [...props.items, { id: 'other', code: 'OTHER' }];
    if (change === 'revision') props.revision++;
    if (change === 'related')
      props.related = { assumptions: [{ id: 'B', text: 'New saved terms' }] };
    ui.button('Import to Draft').props.onClick();
    await settle();
    assert.deepEqual(calls.apply, []);
    assert.equal(ui.dialog().props.open, true);
    assert.match(textOf(ui.render()), /catalog changed after this preview/);
  });
}

test('a catalog becoming busy prevents both file inspection and confirmation', async (t) => {
  const { ui, props, calls, file } = fixture(t);
  ui.button('Bulk import RE Types').props.onClick();
  ui.upload(file);
  await settle();
  props.disabled = true;
  ui.button('Import to Draft').props.onClick();
  ui.upload(file);
  await settle();
  assert.equal(calls.read.length, 1);
  assert.deepEqual(calls.apply, []);
});

test('file reading uses the latest draft and revision when preparing a review', async (t) => {
  const { ui, props, services, calls, file, rows } = fixture(t);
  const pending = defer();
  services.read = (...args) => {
    calls.read.push(args);
    return pending.promise;
  };
  ui.button('Bulk import RE Types').props.onClick();
  ui.upload(file);
  await settle();
  props.items = [{ id: 'edited-during-read', code: 'CURRENT' }];
  props.revision = 8;
  ui.render();
  pending.resolve(rows);
  await settle();
  assert.equal(calls.preview[0][2], props.items);
  assert.deepEqual(calls.apply, []);
  ui.button('Import to Draft').props.onClick();
  await settle();
  assert.equal(calls.apply.length, 1);
  assert.equal(calls.apply[0][0].id, 'edited-during-read');
});

test('tab unmount prevents a late workbook export from downloading or announcing success', async (t) => {
  const { ui, services, calls } = fixture(t);
  const output = downloads(t);
  const pending = defer();
  services.create = (...args) => {
    calls.create.push(args);
    return pending.promise;
  };
  ui.button('Download RE Types Excel template').props.onClick();
  await settle();
  assert.equal(calls.create.length, 1);
  ui.unmount();
  pending.resolve(new Uint8Array([1, 2, 3]));
  await settle();
  assert.deepEqual(output.anchors, []);
  assert.deepEqual(calls.announcements, []);
});

test('cancel or tab unmount discards pending reads; they cannot populate or apply a later preview', async (t) => {
  for (const mode of ['cancel', 'unmount']) {
    const { ui, services, calls, file } = fixture(t);
    const pending = defer();
    services.read = (...args) => {
      calls.read.push(args);
      return pending.promise;
    };
    ui.button('Bulk import RE Types').props.onClick();
    ui.upload(file);
    await settle();
    assert.equal(calls.read.length, 1);
    if (mode === 'cancel') {
      ui.button('Cancel').props.onClick();
      ui.button('Bulk import RE Types').props.onClick();
    } else ui.unmount();
    pending.resolve([{ row: 2, values: { id: 'late' } }]);
    await settle();
    assert.deepEqual(calls.preview, []);
    assert.deepEqual(calls.apply, []);
    assert.deepEqual(calls.announcements, []);
    if (mode === 'cancel')
      assert.equal(ui.button('Import to Draft').props.disabled, true);
  }
});

test('repeated upload and download clicks share one operation lock and recover after completion', async (t) => {
  const { ui, services, calls, file } = fixture(t);
  const output = downloads(t);
  const pending = defer();
  services.read = (...args) => {
    calls.read.push(args);
    return pending.promise;
  };
  ui.button('Bulk import RE Types').props.onClick();
  ui.upload(file);
  ui.upload(file);
  ui.button('Download RE Types Excel template').props.onClick();
  await settle();
  assert.equal(calls.read.length, 1);
  assert.equal(calls.create.length, 0);
  assert.equal(
    ui.button('Download RE Types Excel template').props.disabled,
    true,
  );
  pending.resolve([]);
  await settle();
  const download = ui.button('Download RE Types Excel template');
  assert.equal(download.props.disabled, false);
  download.props.onClick();
  download.props.onClick();
  await settle();
  assert.equal(calls.create.length, 1);
  assert.equal(output.anchors.length, 1);
});

test('invalid file type, oversized files and parser failures remain recoverable without an apply', async (t) => {
  const { ui, services, calls, file } = fixture(t);
  ui.button('Bulk import RE Types').props.onClick();
  ui.upload(new File(['x'], 'catalog.csv'));
  await settle();
  assert.match(textOf(ui.render()), /Choose an .xlsx file/);
  ui.upload({ name: 'huge.xlsx', size: 21 * 1024 * 1024 });
  await settle();
  assert.match(textOf(ui.render()), /exceeds 20 MB/);
  assert.deepEqual(calls.read, []);
  services.read = async () => {
    throw new Error('Wrong catalog template');
  };
  ui.upload(file);
  await settle();
  assert.match(textOf(ui.render()), /Wrong catalog template/);
  assert.equal(ui.button('Choose Excel File').props.disabled, false);
  assert.deepEqual(calls.apply, []);
});

/** Give the real page a memory-only store to inspect its import/save publication boundary. */
function pageFixture(t, activeTab) {
  const savedAssumptions = [
    { id: 'saved-assumption', text: 'Published reference' },
  ];
  const draftAssumptions = [
    ...savedAssumptions,
    { id: 'unsaved-assumption', text: 'Draft reference' },
  ];
  const state = (items, saved = items) => ({
    items,
    loading: false,
    saving: false,
    error: '',
    record: { items: saved, revision: 9, conflicts: [], keyField: 'id' },
  });
  const calls = { load: [], save: [], setItems: [] };
  const tabs = {
    assumptions: state(draftAssumptions, savedAssumptions),
    'quote-templates': state([{ id: 'template', defaultAssumptionIds: [] }]),
    workflow: state([{ code: 'START', name: 'Start' }]),
  };
  const store = {
    tabs,
    load: async (...args) => {
      calls.load.push(args);
    },
    save: async (...args) => {
      calls.save.push(args);
      return true;
    },
    setItems: (tab, items) => {
      calls.setItems.push([tab, items]);
      tabs[tab].items = items;
    },
  };
  const ui = harness(GlobalMasterDataPage, {
    store,
    activeTab,
    onTabChange() {},
    announce() {},
  });
  t.after(() => ui.unmount());
  return { ui, tabs, calls, savedAssumptions };
}

test('global page validates template references against saved catalogs and stages imports without saving', async (t) => {
  const { ui, calls, tabs, savedAssumptions } = pageFixture(
    t,
    'quote-templates',
  );
  const view = ui.find((node) => node.type === MasterDataView);
  const bulk = view.props.bulkActions;
  assert.equal(bulk.type, BulkImportControls);
  assert.equal(bulk.key, 'quote-templates');
  assert.equal(bulk.props.items, tabs['quote-templates'].items);
  assert.equal(bulk.props.related.assumptions, savedAssumptions);
  assert.equal(bulk.props.revision, 9);
  assert.deepEqual(calls.load, [['quote-templates'], ['assumptions']]);
  const imported = [{ id: 'template-new' }];
  bulk.props.onApply(imported);
  assert.deepEqual(calls.setItems, [['quote-templates', imported]]);
  assert.deepEqual(calls.save, []);
  assert.equal(await view.props.onSave(), true);
  assert.deepEqual(calls.save, [['quote-templates']]);
});

test('workflow import remains a draft and its save action opens impact preview with the existing revision', async (t) => {
  const { ui, calls, tabs } = pageFixture(t, 'workflow');
  const view = ui.find((node) => node.type === MasterDataView);
  assert.equal(view.props.saveLabel, 'Preview & Publish');
  view.props.bulkActions.props.onApply([{ code: 'IMPORTED' }]);
  assert.deepEqual(calls.setItems, [['workflow', [{ code: 'IMPORTED' }]]]);
  assert.deepEqual(calls.save, []);
  await view.props.onSave();
  const publication = ui.find((node) => node.type === WorkflowPublishDialog);
  assert.equal(publication.props.expectedRevision, 9);
  assert.deepEqual(publication.props.steps, tabs.workflow.items);
  assert.notEqual(publication.props.steps, tabs.workflow.items);
  assert.deepEqual(calls.save, []);
});

test('unresolved source conflicts disable bulk merging until a source is selected and saved', (t) => {
  const { ui, tabs } = pageFixture(t, 'quote-templates');
  tabs['quote-templates'].record.conflicts = [
    { key: 'template', variants: [] },
  ];
  assert.equal(
    ui.find((node) => node.type === MasterDataView).props.bulkActions.props
      .disabled,
    true,
  );
});
