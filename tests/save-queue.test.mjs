/** Simulates delayed/offline writes without depending on browser timing. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaveQueue } from '../features/workbench/save-queue.ts';

const noop = () => {};
const create = (options) =>
  createSaveQueue({
    revision: 4,
    onSaving: noop,
    onSaved: noop,
    onError: noop,
    isConflict: (error) => error.message === 'conflict',
    ...options,
  });

test('a flush behind an in-flight autosave uses the newly acknowledged revision', async () => {
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const writes = [];
  const queue = create({
    persist: async (document, revision) => {
      writes.push({ document, revision });
      if (writes.length === 1) await delayed;
      return { revision: revision + 1, updatedAt: 'now' };
    },
  });
  const first = queue.save({ project: 'A', cost: 1 });
  const edited = { project: 'A', cost: 2 };
  const flush = queue.save(edited);
  edited.cost = 999;
  await Promise.resolve();
  assert.equal(writes.length, 1);
  release();
  assert.deepEqual(await Promise.all([first, flush]), [true, true]);
  assert.deepEqual(
    writes.map((item) => item.revision),
    [4, 5],
  );
  assert.equal(writes[1].document.cost, 2);
  assert.equal(queue.isSaved({ project: 'A', cost: 2 }), true);
});

test('conflicts stop queued writes without marking unsaved edits durable', async () => {
  let writes = 0;
  const queue = create({
    savedDocument: { cost: 0 },
    persist: async () => {
      writes += 1;
      throw new Error('conflict');
    },
  });
  assert.deepEqual(
    await Promise.all([queue.save({ cost: 1 }), queue.save({ cost: 2 })]),
    [false, false],
  );
  assert.equal(writes, 1);
  assert.equal(queue.isSaved({ cost: 2 }), false);
});

test('offline edits can retry without advancing the expected revision', async () => {
  const revisions = [];
  const queue = create({
    persist: async (_document, revision) => {
      revisions.push(revision);
      if (revisions.length === 1) throw new Error('offline');
      return { revision: 5, updatedAt: 'now' };
    },
  });
  assert.equal(await queue.save({ cost: 1 }), false);
  assert.equal(await queue.save({ cost: 2 }), true);
  assert.deepEqual(revisions, [4, 4]);
});

test('separate project sessions never share revisions and duplicate saves coalesce', async () => {
  const revisions = [];
  const persist = async (_document, revision) => {
    revisions.push(revision);
    return { revision: (revision ?? 0) + 1, updatedAt: 'now' };
  };
  const a = create({ revision: 12, persist });
  const b = create({ revision: null, persist });
  await Promise.all([a.save({ project: 'A' }), b.save({ project: 'B' })]);
  await a.save({ project: 'A' });
  assert.deepEqual(revisions, [12, null]);
});
