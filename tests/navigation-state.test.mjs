/** Refresh restoration uses UI preferences only and resolves against the live project index. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKBENCH_NAVIGATION_KEY,
  parseWorkbenchNavigation,
  readWorkbenchNavigation,
  restoreWorkbenchNavigation,
  rememberWorkbenchNavigation,
  clearWorkbenchNavigation,
} from '../features/workbench/navigation-state.ts';

const projects = [{ id: 'A' }, { id: 'B' }];

/** Represents a browser tab without touching real browser or business data. */
function browserFixture() {
  const storage = new Map();
  return {
    location: { hash: '' },
    history: {
      state: { frameworkEntry: 17 },
      replaceState(state) {
        this.state = structuredClone(state);
      },
    },
    sessionStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
  };
}

/** Starts from a saved summary view with a different active project and explicit master-data tab. */
function navigation(patch = {}) {
  return {
    version: 1,
    view: 'cost',
    projectId: 'B',
    openProjectIds: ['A', 'B'],
    costView: 'summary',
    masterDataTab: 'quote-templates',
    ...patch,
  };
}

test('each page survives refresh with the selected project, open tabs and child view', () => {
  for (const view of [
    'overview',
    'project',
    'cost',
    'quote',
    'cpq',
    'maintenance',
    'agent',
    'master-data',
    'workflow',
  ]) {
    const browser = browserFixture();
    const saved = navigation({
      view,
      ...(view === 'workflow' ? { workflowNodeCode: 'LEGAL' } : {}),
    });
    rememberWorkbenchNavigation(saved, browser);
    assert.deepEqual(
      restoreWorkbenchNavigation(projects, readWorkbenchNavigation(browser)),
      saved,
    );
    assert.equal(browser.history.state.frameworkEntry, 17);
    assert.equal(browser.history.state.workbenchView, view);
  }
});

test('explicit workflow project and node outrank saved navigation without borrowing another node', () => {
  const saved = navigation({ view: 'workflow', workflowNodeCode: 'OLD' });
  const restored = restoreWorkbenchNavigation(
    projects,
    saved,
    '#workflow/A/REVIEW',
  );
  assert.equal(restored.projectId, 'A');
  assert.equal(restored.view, 'workflow');
  assert.equal(restored.workflowNodeCode, 'REVIEW');
  const withoutNode = restoreWorkbenchNavigation(
    projects,
    saved,
    '#workflow/A',
  );
  assert.equal(withoutNode.workflowNodeCode, undefined);
});

test('deleted project references fall back to an available project while retaining the page', () => {
  const saved = navigation({
    view: 'quote',
    projectId: 'deleted',
    openProjectIds: ['deleted', 'A', 'A'],
    workflowNodeCode: 'OLD',
  });
  assert.deepEqual(restoreWorkbenchNavigation(projects, saved), {
    version: 1,
    view: 'quote',
    projectId: 'A',
    openProjectIds: ['A'],
    costView: 'summary',
    masterDataTab: 'quote-templates',
  });
  const reset = restoreWorkbenchNavigation(projects, {
    ...saved,
    view: 'unsafe-url',
  });
  assert.equal(reset.view, 'overview');
  assert.equal(reset.projectId, 'A');
});

test('damaged browser preferences are bounded and legacy views normalize to Project List', () => {
  assert.equal(parseWorkbenchNavigation(null), null);
  assert.equal(parseWorkbenchNavigation({ ...navigation(), version: 2 }), null);
  assert.equal(
    parseWorkbenchNavigation({ ...navigation(), projectId: 'x'.repeat(201) }),
    null,
  );
  for (const view of ['ssr', 'reviews'])
    assert.equal(
      parseWorkbenchNavigation(navigation({ view })).view,
      'project',
    );
  const normalized = parseWorkbenchNavigation(
    navigation({
      openProjectIds: ['A', null, {}, 'A', ''],
      costView: 'unknown',
      masterDataTab: 'unknown',
      workflowNodeCode: ' ',
    }),
  );
  assert.deepEqual(normalized.openProjectIds, ['A']);
  assert.equal(normalized.costView, 'input');
  assert.equal(normalized.masterDataTab, 'resources');
  assert.equal(normalized.workflowNodeCode, undefined);
  const browser = browserFixture();
  browser.sessionStorage.setItem(WORKBENCH_NAVIGATION_KEY, '{broken');
  assert.equal(readWorkbenchNavigation(browser), null);
});

test('history survives blocked storage, and session fallback survives unavailable history writes', () => {
  const browser = browserFixture();
  Object.defineProperty(browser, 'sessionStorage', {
    get() {
      throw new Error('SecurityError');
    },
  });
  assert.doesNotThrow(() => rememberWorkbenchNavigation(navigation(), browser));
  assert.equal(readWorkbenchNavigation(browser).view, 'cost');
  const fallback = browserFixture();
  fallback.history.replaceState = () => {
    throw new Error('History unavailable');
  };
  rememberWorkbenchNavigation(navigation({ view: 'quote' }), fallback);
  assert.equal(readWorkbenchNavigation(fallback).view, 'quote');
  const broken = browserFixture();
  Object.defineProperty(broken, 'history', {
    get() {
      throw new Error('History unavailable');
    },
  });
  rememberWorkbenchNavigation(navigation(), broken);
  assert.equal(readWorkbenchNavigation(broken).projectId, 'B');
});

test('navigation is tab-local, current history wins, and snapshots omit business inputs', () => {
  const first = browserFixture();
  const second = browserFixture();
  const saved = {
    ...navigation(),
    costRows: [{ cost: 123 }],
    pricing: { discount: 10 },
    search: 'private query',
  };
  rememberWorkbenchNavigation(saved, first);
  rememberWorkbenchNavigation(
    navigation({ projectId: 'A', view: 'quote' }),
    second,
  );
  first.sessionStorage.setItem(
    WORKBENCH_NAVIGATION_KEY,
    JSON.stringify(navigation({ view: 'project' })),
  );
  assert.equal(readWorkbenchNavigation(first).view, 'cost');
  assert.equal(readWorkbenchNavigation(second).projectId, 'A');
  assert.equal(first.history.state.workbenchNavigation.costRows, undefined);
  assert.equal(first.history.state.workbenchNavigation.pricing, undefined);
  assert.equal(first.history.state.workbenchNavigation.search, undefined);
});

test('standalone master data restores without any project and closing it clears only navigation preferences', () => {
  const browser = browserFixture();
  rememberWorkbenchNavigation(
    navigation({
      view: 'master-data',
      projectId: '',
      openProjectIds: [],
      standaloneMasterData: true,
    }),
    browser,
  );
  assert.equal(readWorkbenchNavigation(browser).standaloneMasterData, true);
  assert.equal(
    readWorkbenchNavigation(browser).masterDataTab,
    'quote-templates',
  );
  clearWorkbenchNavigation(browser);
  assert.equal(readWorkbenchNavigation(browser), null);
  assert.equal(browser.history.state.frameworkEntry, 17);
});
