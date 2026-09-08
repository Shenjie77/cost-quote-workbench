/** Render actual cost controls without a browser or database access. */
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
// Node strips .ts natively, but TSX needs a test-only transform. Resolve only
// application modules; leave dependency resolution and production builds alone.
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
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (
      (!url.endsWith('.tsx') && !url.endsWith('/workspace-client.ts')) ||
      url.includes('/node_modules/')
    )
      return nextLoad(url, context);
    const source = ts.transpileModule(
      readFileSync(fileURLToPath(url), 'utf8'),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    return { format: 'module', source, shortCircuit: true };
  },
});

const { MasterDataView } =
  await import('../features/master-data/master-data-view.tsx');
const {
  GlobalMasterDataPage,
  resolveGlobalConflict,
  GlobalConflictFields,
  globalConflictTitle,
} = await import('../features/master-data/global-master-data-page.tsx');
const {
  getGlobalMasterData,
  updateGlobalMasterData,
  globalMasterDataChanges,
  createProjectFromGlobalMasterData,
} = await import('../features/master-data/global-client.ts');
const { ProjectBootstrap } =
  await import('../features/workbench/project-bootstrap.tsx');
const { initialResourceTypes } =
  await import('../features/master-data/demo-data.ts');
const { initialProcessSteps } =
  await import('../features/projects/demo-data.ts');
hooks.deregister();

const noop = () => {};
const resources = structuredClone(initialResourceTypes);
const props = {
  activeTab: 'resources',
  onTabChange: noop,
  onSave: async () => true,
  resourceTypes: resources,
  setResourceTypes: noop,
  subcontractItems: [],
  setSubcontractItems: noop,
  supplementalCostItems: [],
  setSupplementalCostItems: noop,
  maintenancePriceRecords: [],
  setMaintenancePriceRecords: noop,
  assumptionLibrary: [],
  setAssumptionLibrary: noop,
  quoteTemplates: [],
  setQuoteTemplates: noop,
  processSteps: initialProcessSteps.map((step) => ({
    ...step,
    state: 'not_started',
    tone: 'gray',
    date: '',
    dateZh: '',
    input: '',
    inputZh: '',
  })),
  setProcessSteps: noop,
  projectStatusDefinitions: [],
  setProjectStatusDefinitions: noop,
  catalog: [],
  setCatalog: noop,
  announce: noop,
};
const record = (items = resources, patch = {}) => ({
  scope: 'global',
  tab: 'resources',
  revision: 7,
  keyField: 'id',
  updatedAt: '2026-09-08T00:00:00Z',
  initializedFrom: 'projects',
  initializedAt: '2026-09-08T00:00:00Z',
  items,
  total: items.length,
  conflicts: [],
  conflictTotal: 0,
  sources: [],
  limit: 1000,
  offset: 0,
  nextOffset: null,
  ...patch,
});
const response = (data, status = 200, error) =>
  new Response(
    JSON.stringify({
      ok: status < 400,
      ...(data ? { data } : {}),
      ...(error ? { error: { message: error } } : {}),
    }),
    { status },
  );

test('global RE Type editor renders without any project, lock or workspace props', () => {
  const markup = renderToStaticMarkup(
    React.createElement(MasterDataView, props),
  );
  assert.match(markup, /全局主数据供未来项目使用/);
  assert.match(markup, /已有 Draft 也不会自动更新汇率/);
  assert.match(markup, /Save this tab/);
  assert.match(markup, /CPQ Catalog/);
  assert.doesNotMatch(
    markup,
    /Current project|当前项目：|Project-owned|返回报价|按项目独立保存/,
  );
  assert.doesNotMatch(markup, /fieldset disabled/);
});

test('workflow master editor edits requirements but has no project progress control', () => {
  const markup = renderToStaticMarkup(
    React.createElement(MasterDataView, { ...props, activeTab: 'workflow' }),
  );
  assert.match(markup, /默认流程模板定义/);
  assert.match(markup, /Requirements/);
  assert.doesNotMatch(
    markup,
    /aria-label="[^"]* state"|Current \/ 当前|State \/ 状态/,
  );
});

test('empty project bootstrap exposes independent global data navigation', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ProjectBootstrap, {
      renderSession: noop,
      onOpenMasterData: noop,
    }),
  );
  assert.match(markup, /Global Master Data/);
  assert.match(markup, /Loading local projects/);
});

test('load error preserves tab navigation and disables data mutation', () => {
  const store = {
    tabs: {
      resources: { items: [], error: 'offline', loading: false, saving: false },
    },
    load: noop,
    save: noop,
    setItems: noop,
  };
  const markup = renderToStaticMarkup(
    React.createElement(GlobalMasterDataPage, {
      store,
      activeTab: 'resources',
      onTabChange: noop,
      announce: noop,
    }),
  );
  assert.match(markup, /offline/);
  assert.match(markup, /fieldset disabled/);
  const nav = markup.slice(
    markup.indexOf('role="tablist"'),
    markup.indexOf('<fieldset'),
  );
  assert.match(nav, /CPQ Catalog/);
  assert.doesNotMatch(nav, /aria-disabled="true"|\sdisabled=/);
});

test('global source conflict choice stages only the selected record and preserves original data', () => {
  const a = { id: 'old-a', code: 'LOCAL-L1', mandayRate: 2025 };
  const b = { id: 'old-b', code: 'LOCAL-L1', mandayRate: 2026 };
  const untouched = { id: 'another', code: 'HQ-L1', mandayRate: 100 };
  const conflict = {
    key: 'LOCAL-L1',
    variants: [
      { item: a, sources: [] },
      { item: b, sources: [] },
    ],
  };
  const items = [untouched];
  const result = resolveGlobalConflict(items, 'id', conflict, b);
  assert.deepEqual(result, [untouched, b]);
  assert.deepEqual(items, [untouched]);
  assert.notEqual(result[1], b);
  assert.throws(
    () =>
      resolveGlobalConflict(items, 'id', conflict, { ...b, mandayRate: 999 }),
    /Select/,
  );
  assert.deepEqual(globalMasterDataChanges(record(items), result), {
    upsert: [b],
    remove: [],
  });
});

test('global edits produce only changed and removed rows', () => {
  const before = [
    { id: 'one', cost: 2025 },
    { id: 'two', cost: 2025 },
    { id: 'three', cost: 2025 },
  ];
  const after = [
    { id: 'one', cost: 2026 },
    before[1],
    { id: 'four', cost: 2026 },
  ];
  assert.deepEqual(globalMasterDataChanges(record(before), after), {
    upsert: [after[0], after[2]],
    remove: ['three'],
  });
  assert.equal(before[0].cost, 2025);
});

test('master client paginates one tab without requesting a project or workspace', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return response(
      calls.length === 1
        ? record([{ id: 'first' }], { total: 2, nextOffset: 1 })
        : record([{ id: 'second' }], { total: 2, offset: 1 }),
    );
  });
  const value = await getGlobalMasterData('resources');
  assert.deepEqual(
    value.items.map((item) => item.id),
    ['first', 'second'],
  );
  assert.equal(calls.length, 2);
  for (const url of calls)
    assert.match(url, /api\/local\/masterdata\/resources\?limit=1000&offset=/);
  assert.doesNotMatch(calls.join(' '), /projects|workspaces|project-id/);
});

test('pagination rejects mixed revisions instead of rendering mixed rates', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    response(record([{ id: String(++count) }], { revision: count, total: 2 })),
  );
  await assert.rejects(
    getGlobalMasterData('resources'),
    /changed while loading/,
  );
});

test('master save is scoped to one global tab and carries its own optimistic revision', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, ...options };
    return response(
      record([{ id: 'rate', mandayRate: 2026 }], { revision: 8 }),
    );
  });
  const changes = { upsert: [{ id: 'rate', mandayRate: 2026 }], remove: [] };
  await updateGlobalMasterData('resources', 7, changes);
  assert.match(request.url, /masterdata\/resources$/);
  assert.equal(request.method, 'PUT');
  assert.deepEqual(JSON.parse(request.body), {
    apiVersion: 'cost-workbench/local-v1',
    kind: 'GlobalMasterDataUpdateRequest',
    expectedRevision: 7,
    changes,
  });
  assert.doesNotMatch(request.body, /project|workspace/);
});

test('concurrent global update returns typed conflict without retrying or writing a project', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response(null, 409, 'Global revision changed');
  });
  await assert.rejects(
    updateGlobalMasterData('resources', 7, { remove: ['rate'] }),
    (error) => error.status === 409,
  );
  assert.equal(calls, 1);
});

test('new project creation requests server-side global capture instead of writing browser defaults', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    return response({ workspace: { project: { id: 'PRJ-NEW' } }, revision: 1 });
  });
  const project = {
    id: 'PRJ-NEW',
    name: 'New estimate',
    client: 'Client',
    reviewOwner: 'SSR',
  };
  await createProjectFromGlobalMasterData({
    ...project,
    unrelatedBrowserDefaults: true,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\/local\/projects$/);
  assert.deepEqual(JSON.parse(calls[0].body), {
    apiVersion: 'cost-workbench/local-v1',
    kind: 'ProjectCreateRequest',
    project,
  });
  assert.doesNotMatch(calls[0].body, /resourceTypes|rateSettings|costRows/);
});

test('source differences render business fields and human-readable labels instead of raw JSON', () => {
  const item = {
    ...resources[0],
    id: 'internal-record-uuid',
    code: 'LOCAL-L1',
    name: 'Local engineer',
  };
  const conflict = {
    key: 'internal-record-uuid',
    variants: [{ item, sources: [] }],
  };
  assert.equal(globalConflictTitle(conflict), 'LOCAL-L1 · Local engineer');
  const markup = renderToStaticMarkup(
    React.createElement(GlobalConflictFields, { item }),
  );
  assert.match(markup, /人天费率/);
  assert.match(markup, /生效日期/);
  assert.match(markup, /每月人天/);
  assert.doesNotMatch(markup, /<pre|internal-record-uuid|mandayRate/);
});

test('all loaded global rows retain their source records across pagination', async (t) => {
  let calls = 0;
  const firstSource = { key: 'a', sources: [{ projectName: '2025 project' }] };
  const secondSource = { key: 'b', sources: [{ projectName: '2026 project' }] };
  t.mock.method(globalThis, 'fetch', async () =>
    response(
      ++calls === 1
        ? record([{ id: 'a' }], {
            total: 2,
            sources: [firstSource],
            nextOffset: 1,
          })
        : record([{ id: 'b' }], {
            total: 2,
            offset: 1,
            sources: [secondSource],
          }),
    ),
  );
  const result = await getGlobalMasterData('resources');
  assert.deepEqual(result.sources, [firstSource, secondSource]);
  assert.equal(result.nextOffset, null);
});
