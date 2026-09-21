/** Excel input reaches the existing revisioned store without changing any project snapshot. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_DATABASE_STATEMENTS } from '../db/schema.ts';
import {
  initializeGlobalMasterData,
  makeGlobalMasterDataStore,
  GlobalMasterDataConflictError,
} from '../server/global-master-data.mjs';
import {
  createBulkImportWorkbook,
  readBulkImportWorkbook,
} from '../features/master-data/bulk-import-workbook.ts';
import { previewBulkImport } from '../features/master-data/bulk-import-model.ts';

/** An isolated database exercises production validation and optimistic concurrency. */
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const statement of LOCAL_DATABASE_STATEMENTS) db.exec(statement);
  initializeGlobalMasterData(db);
  return { db, store: makeGlobalMasterDataStore(db) };
}

test('preview is read-only; saving imported rates retains other rows and historical project bytes', async (t) => {
  const { db, store } = fixture(t);
  const timestamp = '2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO projects VALUES (?,?,?,'SGD',?,?)").run(
    'HISTORY',
    'Historical project',
    'Example',
    timestamp,
    timestamp,
  );
  db.prepare('INSERT INTO workspace_snapshots VALUES (?,?,?,?,?,?)').run(
    'HISTORY',
    '1.0.0',
    7,
    '{"immutable":"historical cost snapshot"}',
    'checksum',
    timestamp,
  );
  const originalSnapshot = db
    .prepare('SELECT * FROM workspace_snapshots')
    .get();
  const before = store.get('resources');
  const source = {
    ...before.items[0],
    mandayRate: before.items[0].mandayRate + 25,
  };
  const bytes = await createBulkImportWorkbook('resources', [source]);
  const input = await readBulkImportWorkbook('resources', bytes);
  const preview = previewBulkImport('resources', input, before.items);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.updated, 1);
  assert.equal(preview.added, 0);
  assert.deepEqual(store.get('resources').items, before.items);
  assert.equal(store.get('resources').revision, before.revision);
  assert.deepEqual(preview.items.slice(1), before.items.slice(1));
  const after = store.update(
    'resources',
    { upsert: preview.items },
    before.revision,
  );
  assert.equal(after.revision, before.revision + 1);
  assert.equal(
    after.items.find((row) => row.id === source.id).mandayRate,
    source.mandayRate,
  );
  assert.deepEqual(
    db.prepare('SELECT * FROM workspace_snapshots').get(),
    originalSnapshot,
  );
});

test('a newer saved revision rejects an older Excel preview and retains the newer values', async (t) => {
  const { store } = fixture(t);
  const before = store.get('profit-share');
  const input = await readBulkImportWorkbook(
    'profit-share',
    await createBulkImportWorkbook('profit-share', [
      { bu: 'Example BU', buCode: '0007', ratePercent: 12, active: true },
      { bu: 'Another BU', buCode: '0007', ratePercent: 0, active: false },
    ]),
  );
  const preview = previewBulkImport('profit-share', input, before.items);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.added, 2);
  store.update(
    'profit-share',
    {
      upsert: [
        { id: 'newer', bu: 'Saved elsewhere', ratePercent: 5, active: true },
      ],
    },
    before.revision,
  );
  assert.throws(
    () =>
      store.update('profit-share', { upsert: preview.items }, before.revision),
    GlobalMasterDataConflictError,
  );
  const latest = store.get('profit-share');
  assert.equal(latest.items.length, 1);
  assert.equal(latest.items[0].bu, 'Saved elsewhere');
  assert.equal(preview.items[0].buCode, '0007');
  assert.equal(preview.items[1].ratePercent, 0);
  assert.equal(preview.items[1].active, false);
});
