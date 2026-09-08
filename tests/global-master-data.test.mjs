import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_DATABASE_STATEMENTS } from '../db/schema.ts';
import {
  initializeGlobalMasterData,
  makeGlobalMasterDataStore,
  GlobalMasterDataConflictError,
} from '../server/global-master-data.mjs';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { initialProcessSteps } from '../features/projects/demo-data.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';

const database = () => {
  const db = new DatabaseSync(':memory:');
  for (const sql of LOCAL_DATABASE_STATEMENTS) db.exec(sql);
  return db;
};
const seed = (db, id, workspace, revision = 7) => {
  const timestamp = '2025-04-03T00:00:00.000Z';
  db.prepare(`INSERT INTO projects VALUES (?,?,?,'SGD',?,?)`).run(
    id,
    id,
    'Customer',
    timestamp,
    timestamp,
  );
  db.prepare('INSERT INTO workspace_snapshots VALUES (?,?,?,?,?,?)').run(
    id,
    '1.0.0',
    revision,
    JSON.stringify({ project: { id, name: id }, ...workspace }),
    'original-checksum',
    timestamp,
  );
};
const oldRows = (db) =>
  db.prepare('SELECT * FROM workspace_snapshots ORDER BY project_id').all();
const resource = (id = 'rt-local-l1', rate = 600) => ({
  ...initialResourceTypes.find((r) => r.id === 'rt-local-l1'),
  id,
  mandayRate: rate,
});

test('global catalogs can be read and maintained without any project', () => {
  const db = database();
  try {
    assert.equal(initializeGlobalMasterData(db), true);
    const store = makeGlobalMasterDataStore(db);
    assert.equal(store.all().length, 9);
    const current = store.get('resources');
    assert.equal(current.scope, 'global');
    assert.equal(current.initializedFrom, 'defaults');
    assert.equal(current.conflicts.length, 0);
    assert.ok(current.items.length > 0);
    const item = { ...current.items[0], mandayRate: 2026 };
    const next = store.update(
      'resources',
      { upsert: [item] },
      current.revision,
    );
    assert.equal(next.revision, current.revision + 1);
    assert.equal(
      store.get('resources', { id: item.id }).items[0].mandayRate,
      2026,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM projects').get().n, 0);
    assert.equal(store.get('maintenance').conflicts.length, 0);
    for (const tab of [
      'subcontract',
      'supplemental',
      'maintenance',
      'cpq-catalog',
    ])
      assert.equal(
        store.get(tab).total,
        0,
        `${tab} must not contain starter supplier/customer records`,
      );
  } finally {
    db.close();
  }
});

test('each tab has independent CAS and complete historical revisions', () => {
  const db = database();
  try {
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const before = store.get('resources');
    const changed = { ...before.items[0], mandayRate: 777 };
    store.update('resources', { upsert: [changed] }, 1);
    assert.equal(store.get('status').revision, 1);
    assert.throws(
      () =>
        store.update(
          'resources',
          { upsert: [{ ...changed, mandayRate: 1 }] },
          1,
        ),
      (error) =>
        error instanceof GlobalMasterDataConflictError &&
        error.currentRevision === 2,
    );
    assert.equal(store.get('resources').revision, 2);
    const history = db
      .prepare(
        "SELECT revision,payload_json FROM master_data_revisions WHERE tab='resources' ORDER BY revision",
      )
      .all();
    assert.deepEqual(
      history.map((r) => r.revision),
      [1, 2],
    );
    assert.deepEqual(JSON.parse(history[0].payload_json).items, before.items);
    assert.equal(
      JSON.parse(history[1].payload_json).items.find((r) => r.id === changed.id)
        .mandayRate,
      777,
    );
  } finally {
    db.close();
  }
});

test('existing rows support narrow field updates while new and conflicted rows need complete input', () => {
  const db = database();
  try {
    seed(db, 'PRJ-A', { resourceTypes: [resource()] });
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const saved = store.update(
      'resources',
      { upsert: [{ id: 'rt-local-l1', mandayRate: 725 }] },
      1,
    );
    assert.equal(saved.items[0].mandayRate, 725);
    assert.equal(saved.items[0].name, resource().name);
    assert.throws(
      () =>
        store.update(
          'resources',
          { upsert: [{ id: 'NEW', mandayRate: 800 }] },
          2,
        ),
      /required property/,
    );
    assert.throws(
      () => store.update('resources', { upsert: [resource('NEW', 800)] }, 2),
      /duplicate code/,
    );
    assert.throws(
      () => store.update('resources', { remove: ['UNKNOWN'] }, 2),
      /Unknown resources key/,
    );
    assert.equal(store.get('resources').revision, 2);
  } finally {
    db.close();
  }
  const conflicted = database();
  try {
    seed(conflicted, 'PRJ-A', { resourceTypes: [resource()] });
    seed(conflicted, 'PRJ-B', {
      resourceTypes: [resource('rt-local-l1', 800)],
    });
    initializeGlobalMasterData(conflicted);
    const store = makeGlobalMasterDataStore(conflicted);
    assert.throws(
      () =>
        store.update(
          'resources',
          { upsert: [{ id: 'rt-local-l1', mandayRate: 900 }] },
          1,
        ),
      /required property/,
    );
    assert.equal(store.get('resources').conflicts.length, 1);
  } finally {
    conflicted.close();
  }
});

test('initial collection and later updates preserve historical project bytes and revisions', () => {
  const db = database();
  try {
    seed(db, 'PRJ-2025', {
      resourceTypes: [resource()],
      costVersions: [
        {
          code: 'V1',
          state: 'Confirmed',
          resourceTypes: [resource()],
          rateSettings: { baseYear: 2025 },
        },
      ],
      costRows: [{ total: 1200 }],
    });
    const before = oldRows(db);
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    assert.equal(
      store.get('resources').items.length,
      1,
      'existing projects must not be mixed with starter catalog records',
    );
    assert.equal(store.get('subcontract').items.length, 0);
    store.update('resources', { upsert: [resource('rt-local-l1', 999)] }, 1);
    assert.deepEqual(oldRows(db), before);
  } finally {
    db.close();
  }
});

test('same key with different historical rates is withheld until explicit resolution', () => {
  const db = database();
  try {
    seed(db, 'PRJ-A', { resourceTypes: [resource()] });
    seed(db, 'PRJ-B', { resourceTypes: [resource('rt-local-l1', 800)] }, 12);
    seed(db, 'PRJ-C', { resourceTypes: [resource()] });
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const current = store.get('resources');
    assert.equal(current.items.length, 0);
    assert.equal(current.conflicts.length, 1);
    assert.equal(current.conflicts[0].variants.length, 2);
    assert.deepEqual(
      current.conflicts[0].variants[0].sources.map((s) => s.projectId),
      ['PRJ-A', 'PRJ-C'],
    );
    assert.equal(current.conflicts[0].variants[1].sources[0].revision, 12);
    const before = oldRows(db);
    const accepted = store.update(
      'resources',
      { upsert: [resource('rt-local-l1', 900)] },
      1,
    );
    assert.equal(accepted.conflicts.length, 0);
    assert.equal(accepted.items[0].mandayRate, 900);
    assert.deepEqual(oldRows(db), before);
    const history = JSON.parse(
      db
        .prepare(
          "SELECT payload_json FROM master_data_revisions WHERE tab='resources' AND revision=1",
        )
        .get().payload_json,
    );
    assert.equal(history.conflicts[0].variants.length, 2);
  } finally {
    db.close();
  }
});

test('same business code with different IDs also requires explicit resolution', () => {
  const db = database();
  try {
    seed(db, 'PRJ-A', { resourceTypes: [resource('row-A', 600)] });
    seed(db, 'PRJ-B', { resourceTypes: [resource('row-B', 800)] });
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    assert.equal(store.get('resources').items.length, 0);
    const accepted = store.update(
      'resources',
      { upsert: [resource('row-B', 800)] },
      1,
    );
    assert.equal(accepted.conflicts.length, 0);
    assert.deepEqual(
      accepted.items.map((item) => item.id),
      ['row-B'],
    );
    assert.throws(
      () =>
        store.update(
          'resources',
          { upsert: [resource('one'), resource('two')] },
          2,
        ),
      /duplicate code/,
    );
    assert.equal(store.get('resources').revision, 2);
  } finally {
    db.close();
  }
});

test('matching historical records deduplicate and retain their distinct provenance', () => {
  const db = database();
  try {
    seed(db, 'PRJ-A', { resourceTypes: [resource()] });
    seed(db, 'PRJ-B', { resourceTypes: [resource()] });
    initializeGlobalMasterData(db);
    const item = makeGlobalMasterDataStore(db).get('resources');
    assert.equal(item.items.length, 1);
    assert.equal(item.conflicts.length, 0);
    assert.deepEqual(
      item.sources[0].sources.map((source) => source.projectId),
      ['PRJ-A', 'PRJ-B'],
    );
  } finally {
    db.close();
  }
});

test('workflow collection copies definitions and clears per-project execution', () => {
  const db = database();
  try {
    const step = {
      ...initialProcessSteps[0],
      state: 'completed',
      tone: 'green',
      date: '2025-01-03',
      dateZh: '旧日期',
      input: 'Actual attachment',
      inputZh: '实际附件',
      owner: 'TD',
      detail: 'Required company design',
      detailZh: '方案要求',
      required: true,
    };
    seed(db, 'PRJ-A', { processSteps: [step] });
    const before = oldRows(db);
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const current = store.get('workflow');
    assert.equal(current.items[0].state, 'not_started');
    for (const key of ['date', 'dateZh', 'input', 'inputZh'])
      assert.equal(current.items[0][key], '');
    for (const key of ['owner', 'detail', 'detailZh', 'required'])
      assert.equal(current.items[0][key], step[key]);
    assert.throws(
      () =>
        store.update(
          'workflow',
          { upsert: [{ ...current.items[0], state: 'completed' }] },
          1,
        ),
      /definitions only/,
    );
    assert.equal(store.get('workflow').revision, 1);
    assert.deepEqual(oldRows(db), before);
  } finally {
    db.close();
  }
});

test('editing workflow requirements preserves node sequence', () => {
  const db = database();
  try {
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const before = store.get('workflow').items;
    const next = store.update(
      'workflow',
      { upsert: [{ code: before[0].code, owner: 'Updated owner' }] },
      1,
    );
    assert.deepEqual(
      next.items.map((step) => step.code),
      before.map((step) => step.code),
    );
    assert.equal(next.items[0].owner, 'Updated owner');
  } finally {
    db.close();
  }
});

test('field and cross-template validation are atomic and never rewrite other tabs', () => {
  const db = database();
  try {
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const assumption = store.get('assumptions').items[0];
    const template = {
      ...initialQuoteTemplates[0],
      defaultAssumptionIds: [assumption.id],
    };
    store.update('quote-templates', { upsert: [template] }, 1);
    assert.throws(
      () => store.update('assumptions', { remove: [assumption.id] }, 1),
      /references unavailable assumptions/,
    );
    assert.equal(store.get('assumptions').revision, 1);
    assert.equal(store.get('quote-templates').revision, 2);
    assert.throws(
      () =>
        store.update(
          'resources',
          { upsert: [{ ...resource(), surprise: 'unsupported' }] },
          1,
        ),
      /additional properties/,
    );
    assert.throws(() =>
      store.update(
        'resources',
        { upsert: [{ ...resource(), mandayRate: -1 }] },
        1,
      ),
    );
    assert.throws(
      () =>
        store.update(
          'resources',
          { upsert: [resource()], projectId: 'PRJ-A' },
          1,
        ),
      /Unsupported change/,
    );
    assert.equal(store.get('resources').revision, 1);
    store.update(
      'quote-templates',
      { upsert: [{ ...template, defaultAssumptionIds: [] }] },
      2,
    );
    store.update('assumptions', { remove: [assumption.id] }, 1);
    assert.equal(store.get('assumptions', { id: assumption.id }).total, 0);
  } finally {
    db.close();
  }
});

test('templates with conflicting historical assumptions stay withheld and recover explicitly', () => {
  const db = database();
  try {
    const assumption = {
      id: 'A',
      name: 'Scope',
      category: 'General',
      clientPattern: '*',
      text: 'Original',
      textZh: '',
      active: true,
    };
    const template = {
      ...initialQuoteTemplates[0],
      defaultAssumptionIds: ['A'],
    };
    seed(db, 'PRJ-A', {
      assumptionLibrary: [assumption],
      quoteTemplates: [template],
    });
    seed(db, 'PRJ-B', {
      assumptionLibrary: [{ ...assumption, text: 'Different' }],
      quoteTemplates: [template],
    });
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    assert.equal(store.get('quote-templates').total, 0);
    assert.match(
      store.get('quote-templates').conflicts[0].reason,
      /assumption references/,
    );
    assert.throws(
      () => store.update('quote-templates', { upsert: [template] }, 1),
      /unavailable assumptions/,
    );
    store.update('assumptions', { upsert: [assumption] }, 1);
    assert.equal(
      store.update('quote-templates', { upsert: [template] }, 1).conflicts
        .length,
      0,
    );
  } finally {
    db.close();
  }
});

test('reopening and targeted reads or updates never scan project payloads again', () => {
  const db = database();
  try {
    seed(db, 'PRJ-A', { resourceTypes: [resource()] });
    initializeGlobalMasterData(db);
    const isolatedDb = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        assert.doesNotMatch(sql, /workspace_snapshots|projects/);
        return db.prepare(sql);
      },
    };
    assert.equal(initializeGlobalMasterData(isolatedDb), false);
    const store = makeGlobalMasterDataStore(isolatedDb);
    assert.equal(
      store.get('resources', { id: 'rt-local-l1', query: 'local' }).total,
      1,
    );
    store.update('resources', { upsert: [resource('rt-local-l1', 800)] }, 1);
    assert.equal(store.get('resources').items[0].mandayRate, 800);
  } finally {
    db.close();
  }
});

test('pagination and CPQ equipment quantity rules are validated independently', () => {
  const db = database();
  try {
    initializeGlobalMasterData(db);
    const store = makeGlobalMasterDataStore(db);
    const page = store.get('resources', { offset: 1, limit: 2 });
    assert.equal(page.items.length, 2);
    assert.equal(page.sources.length, 2);
    assert.equal(page.offset, 1);
    assert.equal(page.nextOffset, 3);
    assert.equal(
      store.get('resources', { offset: 100, limit: 2 }).nextOffset,
      null,
    );
    assert.ok(page.total > 2);
    assert.throws(
      () => store.get('resources', { limit: 'NaN' }),
      /limit must be/,
    );
    const equipment = {
      code: 'EQ',
      scope: 'Device setup',
      unit: 'device',
      unitCost: 100,
      kind: 'equipment',
      adjustable: true,
      active: true,
      step: 1,
      minQty: 0,
      maxQty: 100,
      referenceQty: 1,
      tags: '',
      revision: '2026',
    };
    assert.throws(
      () => store.update('cpq-catalog', { upsert: [equipment] }, 1),
      /equipment quantity cannot be adjustable/,
    );
    assert.equal(store.get('cpq-catalog').revision, 1);
    assert.equal(
      store.update(
        'cpq-catalog',
        { upsert: [{ ...equipment, adjustable: false }] },
        1,
      ).items.length,
      1,
    );
  } finally {
    db.close();
  }
});
