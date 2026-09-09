import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PERSONNEL_COLUMNS_STORAGE_KEY,
  defaultPersonnelColumns,
  movePersonnelColumn,
  setPersonnelColumnVisible,
  visiblePersonnelColumns,
} from '../features/cost/personnel-columns.ts';
import {
  createPersonnelViewStore,
  defaultPersonnelView,
  loadPersonnelView,
  parsePersonnelView,
  personnelViewStorageKey,
  savePersonnelView,
} from '../features/cost/personnel-view-preferences.ts';
import { usePersonnelTableView } from '../features/cost/use-personnel-table-view.ts';

const memoryStorage = () => {
  const items = new Map(),
    writes = [];
  return {
    items,
    writes,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
      writes.push([key, value]);
    },
  };
};
const configured = () => ({
  ...defaultPersonnelView(),
  grouped: true,
  yearIndex: 2,
  columns: movePersonnelColumn(
    setPersonnelColumnVisible(defaultPersonnelColumns(), 'Y1:cost', false),
    'scope',
    'left',
  ),
});

test('explicit Save round-trips grouping, focused year and full column preferences per project and cost version', () => {
  const storage = memoryStorage();
  const a1 = 'project A:V1',
    a2 = 'project A:V2',
    b1 = 'project B:V1';
  const viewA = configured(),
    viewB = { ...defaultPersonnelView(), yearIndex: 4 };
  assert.equal(savePersonnelView(storage, a1, viewA), true);
  assert.equal(savePersonnelView(storage, b1, viewB), true);
  assert.deepEqual(
    loadPersonnelView(storage, a1).preferences,
    parsePersonnelView(viewA),
  );
  assert.deepEqual(
    loadPersonnelView(storage, b1).preferences,
    parsePersonnelView(viewB),
  );
  assert.deepEqual(
    loadPersonnelView(storage, a2).preferences,
    defaultPersonnelView(),
  );
  assert.equal(loadPersonnelView(storage, a2).saved, false);
  assert.equal(loadPersonnelView(storage, a1).saved, true);
  const reloaded = createPersonnelViewStore();
  reloaded.hydrate(a1, storage);
  assert.deepEqual(
    reloaded.getSnapshot().preferences,
    parsePersonnelView(viewA),
  );
  assert.equal(reloaded.getSnapshot().isViewDirty, false);
  assert.equal(
    reloaded.getSnapshot().preferences.columns.hidden.includes('Y1:cost'),
    true,
  );
  assert.equal(reloaded.getSnapshot().preferences.columns.order[0], 'scope');
  assert.deepEqual(
    [...storage.items.keys()],
    [personnelViewStorageKey(a1), personnelViewStorageKey(b1)],
  );
});

test('legacy global columns are only a read-only first-use fallback; saved per-version view wins after global changes', () => {
  const storage = memoryStorage();
  storage.items.set(
    PERSONNEL_COLUMNS_STORAGE_KEY,
    JSON.stringify(configured().columns),
  );
  const store = createPersonnelViewStore();
  store.hydrate('A/V1', storage);
  assert.deepEqual(
    store.getSnapshot().preferences.columns,
    configured().columns,
  );
  assert.equal(store.getSnapshot().saved, false);
  assert.equal(storage.writes.length, 0);
  store.update('A/V1', (current) => ({
    ...current,
    grouped: true,
    yearIndex: 1,
  }));
  assert.equal(storage.writes.length, 0);
  assert.equal(store.getSnapshot().isViewDirty, true);
  assert.equal(store.save('A/V1', storage), true);
  storage.items.set(
    PERSONNEL_COLUMNS_STORAGE_KEY,
    JSON.stringify(defaultPersonnelColumns()),
  );
  store.hydrate('A/V1', storage);
  assert.equal(store.getSnapshot().preferences.grouped, true);
  assert.equal(store.getSnapshot().preferences.yearIndex, 1);
  assert.deepEqual(
    store.getSnapshot().preferences.columns,
    parsePersonnelView(configured()).columns,
  );
  store.hydrate('A/V2', storage);
  assert.deepEqual(store.getSnapshot().preferences, defaultPersonnelView());
  assert.ok(
    storage.writes.every(([key]) => key !== PERSONNEL_COLUMNS_STORAGE_KEY),
  );
});

test('refresh discards unsaved view changes, saving uses the latest view, and stale project callbacks cannot write another version', () => {
  const storage = memoryStorage();
  const store = createPersonnelViewStore();
  assert.equal(store.save('A/V1', storage), false);
  assert.equal(
    store.update('A/V1', () => configured()),
    false,
  );
  store.hydrate('A/V1', storage);
  const saveA = () => store.save('A/V1', storage);
  const updateA = () => store.update('A/V1', () => configured());
  updateA();
  store.hydrate('A/V1', storage);
  assert.deepEqual(store.getSnapshot().preferences, defaultPersonnelView());
  store.update('A/V1', (current) => ({ ...current, yearIndex: 0 }));
  store.update('A/V1', (current) => ({
    ...current,
    yearIndex: 4,
    grouped: true,
  }));
  assert.equal(saveA(), true);
  assert.equal(loadPersonnelView(storage, 'A/V1').preferences.yearIndex, 4);
  store.hydrate('B/V2', storage);
  assert.equal(updateA(), false);
  assert.equal(saveA(), false);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(store.getSnapshot().preferences, defaultPersonnelView());
  assert.equal(loadPersonnelView(storage, 'B/V2').saved, false);
});

test('dirty state clears when edits are reversed or saved; failed saves retain dirty view without overwriting stored settings', () => {
  const storage = memoryStorage();
  const store = createPersonnelViewStore();
  store.hydrate('A/V1', storage);
  store.update('A/V1', (view) => ({ ...view, grouped: true }));
  assert.equal(store.getSnapshot().isViewDirty, true);
  store.update('A/V1', (view) => ({ ...view, grouped: false }));
  assert.equal(store.getSnapshot().isViewDirty, false);
  store.update('A/V1', () => configured());
  store.save('A/V1', storage);
  const savedText = storage.getItem(personnelViewStorageKey('A/V1'));
  store.update('A/V1', (view) => ({ ...view, yearIndex: 0 }));
  assert.equal(
    store.save('A/V1', {
      setItem: () => {
        throw new Error('quota');
      },
    }),
    false,
  );
  assert.equal(store.getSnapshot().isViewDirty, true);
  assert.equal(store.getSnapshot().saved, true);
  assert.equal(store.getSnapshot().storageAvailable, false);
  assert.equal(storage.getItem(personnelViewStorageKey('A/V1')), savedText);
  assert.equal(store.save('A/V1', storage), true);
  assert.equal(store.getSnapshot().isViewDirty, false);
  assert.equal(store.getSnapshot().storageAvailable, true);
});

test('corrupt, oversized and obsolete records fail safely while repaired column IDs retain accessible fields', () => {
  const storage = memoryStorage(),
    key = personnelViewStorageKey('A/V1');
  for (const value of [
    'invalid JSON',
    ' '.repeat(20001),
    'null',
    '[]',
    JSON.stringify({ ...configured(), version: 9 }),
    JSON.stringify({ ...configured(), grouped: 'yes' }),
    JSON.stringify({ ...configured(), yearIndex: '1' }),
    JSON.stringify({ ...configured(), yearIndex: 5 }),
    JSON.stringify({
      ...configured(),
      columns: { version: 1, order: [3], hidden: [] },
    }),
  ]) {
    storage.items.set(key, value);
    assert.deepEqual(loadPersonnelView(storage, 'A/V1'), {
      preferences: defaultPersonnelView(),
      saved: false,
      storageAvailable: true,
    });
  }
  storage.items.set(
    key,
    JSON.stringify({
      ...configured(),
      columns: {
        version: 1,
        order: ['removed', 'action', 'Y2:cost', 'Y2:cost'],
        hidden: defaultPersonnelColumns().order,
      },
    }),
  );
  const repaired = loadPersonnelView(storage, 'A/V1');
  assert.equal(repaired.saved, true);
  assert.equal(repaired.preferences.columns.order[0], 'Y2:cost');
  assert.equal(repaired.preferences.columns.order.at(-1), 'action');
  assert.deepEqual(visiblePersonnelColumns(repaired.preferences.columns), [
    'groupName',
    'action',
  ]);
  assert.equal(storage.writes.length, 0);
  assert.equal(savePersonnelView(storage, undefined, configured()), false);
  assert.equal(personnelViewStorageKey(''), null);
  assert.equal(personnelViewStorageKey('\ud800'), null);
  assert.notEqual(
    personnelViewStorageKey('A/V1'),
    personnelViewStorageKey('A%2FV1'),
  );
  assert.equal(
    savePersonnelView(storage, 'A/V1', { ...configured(), yearIndex: 100 }),
    false,
  );
  assert.equal(storage.writes.length, 0);
});

test('blocked browser storage still permits in-memory view changes and never writes amount fields or cost locks', () => {
  const store = createPersonnelViewStore();
  store.hydrate('locked/A/V1', {
    getItem: () => {
      throw new Error('blocked');
    },
  });
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().storageAvailable, false);
  assert.equal(
    store.update('locked/A/V1', () => configured()),
    true,
  );
  assert.equal(store.save('locked/A/V1', undefined), false);
  assert.equal(store.getSnapshot().isViewDirty, true);
  const storage = memoryStorage();
  const forbidden = Object.freeze({
    allowancePools: ['HQ'],
    hqTravelEnabled: true,
    costRows: [{ cost: 100 }],
    status: 'Confirmed',
  });
  assert.equal(
    savePersonnelView(storage, 'locked/A/V1', {
      ...configured(),
      ...forbidden,
    }),
    true,
  );
  const saved = JSON.parse(
    storage.getItem(personnelViewStorageKey('locked/A/V1')),
  );
  assert.deepEqual(Object.keys(saved), [
    'version',
    'grouped',
    'yearIndex',
    'columns',
  ]);
  assert.deepEqual(forbidden.costRows, [{ cost: 100 }]);
});

test('SSR uses the same safe initial view for every project without reading storage or accepting Save before hydration', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get() {
      throw new Error('SSR must not read window');
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  });
  function Probe({ id }) {
    const view = usePersonnelTableView(id);
    assert.equal(view.saveView(), false);
    return React.createElement('div', {
      'data-ready': view.ready,
      'data-grouped': view.layout.grouped,
      'data-year': view.layout.yearIndex,
      'data-dirty': view.isViewDirty,
      'data-columns': view.layout.columns.join(','),
    });
  }
  const a = renderToStaticMarkup(React.createElement(Probe, { id: 'A/V1' }));
  assert.equal(
    a,
    renderToStaticMarkup(React.createElement(Probe, { id: 'B/V2' })),
  );
  assert.match(a, /data-ready="false"/);
  assert.match(a, /data-grouped="false"/);
  assert.match(a, /data-year="all"/);
  assert.match(a, /data-dirty="false"/);
});
