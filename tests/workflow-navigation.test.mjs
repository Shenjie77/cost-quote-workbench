/** Real asynchronous workflow stages must never override a newer page selection. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNavigationIntents,
  loadWorkflowNavigation,
  workflowRestoreFeedback,
} from '../features/workbench/workflow-navigation.ts';

/** A controlled API response exposes the exact navigation window under test. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Model the caller's commit only after all real save/load/select stages succeed. */
async function openPage(options, commit) {
  const record = await loadWorkflowNavigation(options);
  if (record && options.intent.isCurrent()) commit(record);
}

test('current navigation saves, loads and selects in order before committing its workflow page', async () => {
  const intents = createNavigationIntents();
  const calls = [];
  const record = { projectId: 'A', revision: 4 };
  await openPage(
    {
      intent: intents.begin(),
      saveCurrent: async () => {
        calls.push('save');
        return true;
      },
      load: async () => {
        calls.push('load');
        return record;
      },
      select: async () => {
        calls.push('select');
        return true;
      },
    },
    (value) => {
      calls.push('commit');
      assert.equal(value, record);
    },
  );
  assert.deepEqual(calls, ['save', 'load', 'select', 'commit']);
});

test('choosing another page while saving prevents the abandoned workflow load', async () => {
  const intents = createNavigationIntents();
  const saved = deferred();
  let currentPage = 'workflow';
  let loads = 0;
  const pending = openPage(
    {
      intent: intents.begin(),
      saveCurrent: () => saved.promise,
      load: async () => {
        loads++;
        return { projectId: 'A' };
      },
      select: async () => true,
    },
    () => {
      currentPage = 'workflow';
    },
  );
  currentPage = 'quote';
  intents.cancel();
  saved.resolve(true);
  await pending;
  assert.equal(loads, 0);
  assert.equal(currentPage, 'quote');
});

test('choosing another page while loading prevents project selection and the late workflow commit', async () => {
  const intents = createNavigationIntents();
  const loaded = deferred();
  let selected = false;
  let currentPage = 'workflow';
  const pending = openPage(
    {
      intent: intents.begin(),
      load: () => loaded.promise,
      select: async () => {
        selected = true;
        return true;
      },
    },
    () => {
      currentPage = 'workflow';
    },
  );
  currentPage = 'cost';
  intents.cancel();
  loaded.resolve({ projectId: 'A' });
  await pending;
  assert.equal(selected, false);
  assert.equal(currentPage, 'cost');
});

test('a completed business save may finish project selection but cannot overwrite the newer page', async () => {
  const intents = createNavigationIntents();
  const selected = deferred();
  const enteredSelection = deferred();
  let currentPage = 'workflow';
  const pending = openPage(
    {
      intent: intents.begin(),
      load: async () => ({ projectId: 'B' }),
      select: () => {
        enteredSelection.resolve();
        return selected.promise;
      },
    },
    () => {
      currentPage = 'workflow';
    },
  );
  await enteredSelection.promise;
  currentPage = 'master-data';
  intents.cancel();
  selected.resolve(true);
  await pending;
  assert.equal(currentPage, 'master-data');
});

test('superseded request errors stay silent while active save/load failures remain actionable', async () => {
  const intents = createNavigationIntents();
  const oldResponse = deferred();
  const old = loadWorkflowNavigation({
    intent: intents.begin(),
    load: () => oldResponse.promise,
    select: async () => true,
  });
  const current = await loadWorkflowNavigation({
    intent: intents.begin(),
    load: async () => ({ projectId: 'B' }),
    select: async () => true,
  });
  oldResponse.reject(new Error('Old request failed'));
  assert.equal(await old, null);
  assert.equal(current.projectId, 'B');
  await assert.rejects(
    () =>
      loadWorkflowNavigation({
        intent: intents.begin(),
        saveCurrent: async () => false,
        load: async () => ({ projectId: 'A' }),
        select: async () => true,
      }),
    /Save the current cost/,
  );
  await assert.rejects(
    () =>
      loadWorkflowNavigation({
        intent: intents.begin(),
        load: async () => null,
        select: async () => true,
      }),
    /no longer exists/,
  );
  await assert.rejects(
    () =>
      loadWorkflowNavigation({
        intent: intents.begin(),
        load: async () => {
          throw new Error('Connection failed');
        },
        select: async () => true,
      }),
    /Connection failed/,
  );
});

test('initial hydration failures expose their error for Retry instead of reporting perpetual loading', () => {
  for (const phase of ['offline', 'error', 'conflict'])
    assert.deepEqual(
      workflowRestoreFeedback(false, phase, 'Connection failed; retry'),
      { failed: true, message: 'Connection failed; retry' },
    );
  for (const [ready, phase] of [
    [false, 'connecting'],
    [true, 'saved'],
  ])
    assert.deepEqual(workflowRestoreFeedback(ready, phase, ''), {
      failed: false,
      message: 'Loading project workflow / 正在加载项目流程…',
    });
});
