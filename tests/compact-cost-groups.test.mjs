import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  projectState,
  workspaceFromState,
  liveSnapshot,
} from '../public/design-review/business/live-model.js';
import {
  moveCostGroup,
  removeCostGroup,
} from '../public/design-review/business/cost-groups.js';
import { costInputSummary } from '../public/design-review/business/cost-input.js';
const fixture = () => {
  const w = createBlankWorkspace(
    projectRecord('GROUP-TEST', 'Groups', 'Client'),
    'input_preparation',
  );
  w.costRows = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    groupName: i < 2 ? 'Same' : 'Other',
    category: i === 3 ? 'Optional' : 'Mandatory',
    scope: id,
    bu: 'FBB',
    reTypeId: w.resourceTypes[0].id,
    inputMode: 'mandays',
    mdPerSite: 0,
    years: Array.from({ length: 5 }, (_, y) => ({
      bucket: `Y${y + 1}`,
      sites: 0,
      mandays: y === 0 ? i + 1 : 0,
      cost: 0,
    })),
    extension: { preserve: id },
  }));
  return projectState(w);
};
test('moving a whole group persists row order, retains intra-group order and does not reprice effort', () => {
  const state = fixture();
  const before = costInputSummary(liveSnapshot(state));
  const group = state.groups[1].id;
  assert.equal(moveCostGroup(state, group, -1), true);
  assert.deepEqual(
    state.rows.map((r) => r.id),
    ['c', 'a', 'b', 'd'],
  );
  const saved = workspaceFromState(state);
  const reopened = projectState(saved);
  assert.deepEqual(
    reopened.rows.map((r) => r.id),
    ['c', 'a', 'b', 'd'],
  );
  assert.deepEqual(
    reopened.groups.map((g) => [g.name, g.category]),
    [
      ['Other', 'Mandatory'],
      ['Same', 'Mandatory'],
      ['Other', 'Optional'],
    ],
  );
  assert.deepEqual(costInputSummary(liveSnapshot(reopened)), before);
  assert.deepEqual(
    saved.costRows.map((r) => r.extension.preserve),
    ['c', 'a', 'b', 'd'],
  );
});
test('group boundary moves are no-ops and down restores exact internal row order', () => {
  const state = fixture(),
    before = structuredClone(state);
  assert.equal(moveCostGroup(state, state.groups[0].id, -1), false);
  assert.equal(moveCostGroup(state, state.groups.at(-1).id, 1), false);
  assert.equal(moveCostGroup(state, 'missing', 1), false);
  assert.deepEqual(state, before);
  const id = state.groups[0].id;
  moveCostGroup(state, id, 1);
  moveCostGroup(state, id, -1);
  assert.deepEqual(state, before);
});
test('group deletion removes every member, keeps other categories, project costs and history', () => {
  const state = fixture();
  const old = workspaceFromState(state);
  removeCostGroup(state, state.groups[1].id);
  const next = workspaceFromState(state);
  assert.deepEqual(
    next.costRows.map((r) => r.id),
    ['a', 'b', 'd'],
  );
  assert.deepEqual(next.manualCosts, old.manualCosts);
  assert.deepEqual(next.quoteHistory, old.quoteHistory);
  assert.deepEqual(next.subcontractCost, old.subcontractCost);
  assert.deepEqual(next.costVersions[0].costRows, next.costRows);
  for (const group of state.groups) removeCostGroup(state, group.id);
  assert.equal(state.rows.length, 0);
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].name, '');
  assert.deepEqual(workspaceFromState(state).costRows, []);
});
test('confirmed versions reject reordered or deleted groups at the persistence boundary', () => {
  for (const mutation of [
    (s) => moveCostGroup(s, s.groups[0].id, 1),
    (s) => removeCostGroup(s, s.groups[0].id),
  ]) {
    const state = fixture();
    state._source.costVersions[0].state = 'Confirmed';
    mutation(state);
    assert.throws(() => workspaceFromState(state), /read-only/);
  }
});
