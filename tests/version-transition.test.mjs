import assert from 'node:assert/strict';
import test from 'node:test';
import { runVersionTransition } from '../features/cost/version-transition.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('rapid version navigation waits for workflow locks from the source save and rejects duplicate clicks', async () => {
  const saved = deferred();
  const busy = { current: false };
  const events = [];
  let activeVersion = 'V1';
  let locks = {};
  const options = {
    busy,
    setBusy: (value) => events.push(['busy', value]),
    flushAndPause: () => {
      events.push(['flush', activeVersion]);
      return saved.promise;
    },
    resume: () => events.push(['resume']),
    commit: () => {
      events.push(['commit', Object.keys(locks)]);
      activeVersion = 'V2';
    },
    onFailure: () => assert.fail('save succeeded'),
  };
  const first = runVersionTransition(options);
  assert.equal(busy.current, true);
  assert.equal(activeVersion, 'V1');
  assert.equal(await runVersionTransition(options), false);
  assert.deepEqual(events, [
    ['busy', true],
    ['flush', 'V1'],
  ]);
  // The repository responds with the lock for V1 before navigation commits.
  locks = { V1: { reason: 'DRB completed', lockedAt: '2026-09-07T00:00:00Z' } };
  saved.resolve(2);
  assert.equal(await first, true);
  assert.equal(activeVersion, 'V2');
  assert.equal(busy.current, false);
  assert.deepEqual(events.slice(2), [
    ['commit', ['V1']],
    ['resume'],
    ['busy', false],
  ]);
  assert.equal(locks.V2, undefined);
});

for (const failure of ['unsaved', 'offline']) {
  test(`${failure} flush keeps the current version and restores editing`, async () => {
    const busy = { current: false };
    let commits = 0,
      resumes = 0,
      failures = 0;
    const busyStates = [];
    const ok = await runVersionTransition({
      busy,
      setBusy: (value) => busyStates.push(value),
      flushAndPause: async () => {
        if (failure === 'offline') throw new Error('offline');
        return null;
      },
      resume: () => {
        resumes += 1;
      },
      commit: () => {
        commits += 1;
      },
      onFailure: () => {
        failures += 1;
      },
    });
    assert.equal(ok, false);
    assert.equal(commits, 0);
    assert.equal(resumes, 1);
    assert.equal(failures, 1);
    assert.equal(busy.current, false);
    assert.deepEqual(busyStates, [true, false]);
  });
}

test('canonical workflow persistence finishes before navigation unlocks', async () => {
  const saved = deferred(),
    busy = { current: false },
    events = [];
  const pending = runVersionTransition({
    busy,
    setBusy: (value) => events.push(['busy', value]),
    flushAndPause: async () => 3,
    resume: () => events.push(['resume']),
    commit: async (revision) => {
      assert.equal(revision, 3);
      await saved.promise;
      events.push(['canonical']);
    },
    onFailure: () => assert.fail('success expected'),
  });
  await Promise.resolve();
  assert.equal(busy.current, true);
  assert.deepEqual(events, [['busy', true]]);
  saved.resolve();
  await pending;
  assert.deepEqual(events, [
    ['busy', true],
    ['canonical'],
    ['resume'],
    ['busy', false],
  ]);
});
