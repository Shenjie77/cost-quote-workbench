import assert from 'node:assert/strict';
import test from 'node:test';
import {
  movePersonnelRow,
  renamePersonnelGroup,
} from '../features/cost/personnel-row-layout.ts';

const resources = [
  { id: 'person', category: 'internal' },
  { id: 'sub', category: 'subcontract' },
];
const makeRow = (id, groupName, extra = {}) => ({
  id,
  groupName,
  scope: `${id} design`,
  bu: 'Network',
  reTypeId: 'person',
  mdPerSite: 1,
  years: [{ bucket: 'Y1', sites: 1, cost: 100, mandays: 1 }],
  ...extra,
});
const source = { fileName: 'td.xlsx', row: 7 };

test('row ordering preserves latest values, provenance and legacy Subcon slots', () => {
  const rows = [
    makeRow('HLD', 'Design'),
    makeRow('SUB', '', { reTypeId: 'sub' }),
    makeRow('LLD', 'Design', { mdPerSite: 3, source }),
    makeRow('Plan', 'Design'),
  ];
  const next = movePersonnelRow(rows, resources, {
    rowId: 'LLD',
    targetRowId: 'HLD',
    position: 'before',
  });
  assert.deepEqual(
    next.map((row) => row.id),
    ['LLD', 'SUB', 'HLD', 'Plan'],
  );
  assert.equal(next[0], rows[2]);
  assert.equal(next[0].source, source);
  assert.equal(next[1], rows[1]);
  assert.equal(rows[0].id, 'HLD');
});

test('cross-group row and header drops assign a group without changing Scope or amounts', () => {
  const rows = [
    makeRow('HLD', 'Design'),
    makeRow('LLD', 'Design'),
    makeRow('Plan', 'Planning'),
  ];
  const next = movePersonnelRow(rows, resources, {
    rowId: 'LLD',
    targetRowId: 'Plan',
    position: 'after',
    groupName: 'Planning',
  });
  assert.deepEqual(
    next.map((row) => row.id),
    ['HLD', 'Plan', 'LLD'],
  );
  assert.equal(next[2].groupName, 'Planning');
  assert.equal(next[2].scope, rows[1].scope);
  assert.equal(next[2].years, rows[1].years);
  const headerDrop = movePersonnelRow(next, resources, {
    rowId: 'HLD',
    position: 'group-end',
    groupName: 'Planning',
  });
  assert.deepEqual(
    headerDrop.map((row) => row.id),
    ['Plan', 'LLD', 'HLD'],
  );
  assert.equal(headerDrop[2].groupName, 'Planning');
});

test('flat ordering leaves groups intact and blank groups are valid drop targets', () => {
  const rows = [makeRow('HLD', 'Design'), makeRow('LLD', '')];
  const next = movePersonnelRow(rows, resources, {
    rowId: 'HLD',
    targetRowId: 'LLD',
    position: 'after',
  });
  assert.equal(next[1].groupName, 'Design');
  const unassigned = movePersonnelRow(rows, resources, {
    rowId: 'HLD',
    position: 'group-end',
    groupName: '',
  });
  assert.equal(unassigned[1].groupName, '');
});

test('stale, missing, Subcon and locked moves do not modify rows', () => {
  const rows = [
    makeRow('HLD', 'Design'),
    makeRow('LLD', 'Changed'),
    makeRow('SUB', '', { reTypeId: 'sub' }),
  ];
  const move = {
    rowId: 'HLD',
    targetRowId: 'LLD',
    position: 'after',
    groupName: 'Old',
  };
  assert.equal(movePersonnelRow(rows, resources, move), null);
  assert.equal(
    movePersonnelRow(rows, resources, { ...move, groupName: 'Changed' }, true),
    null,
  );
  assert.equal(
    movePersonnelRow(rows, resources, {
      ...move,
      targetRowId: 'SUB',
      groupName: undefined,
    }),
    null,
  );
  assert.equal(
    movePersonnelRow(rows, resources, { ...move, rowId: 'SUB' }),
    null,
  );
  assert.equal(
    movePersonnelRow(rows, resources, {
      rowId: 'HLD',
      position: 'group-end',
      groupName: 'Missing',
    }),
    null,
  );
});

test('group rename spans different Scopes, supports merge, and keeps original order and data', () => {
  const rows = [
    makeRow('HLD', 'Design'),
    makeRow('LLD', 'Design'),
    makeRow('Plan', 'Planning'),
  ];
  const next = renamePersonnelGroup(rows, resources, {
    groupName: 'Design',
    nextGroupName: ' Planning ',
    rowIds: ['HLD', 'LLD'],
  });
  assert.deepEqual(
    next.map((row) => row.groupName),
    ['Planning', 'Planning', 'Planning'],
  );
  assert.deepEqual(
    next.map((row) => row.id),
    rows.map((row) => row.id),
  );
  next.forEach((row, i) => {
    assert.equal(row.scope, rows[i].scope);
    assert.equal(row.years, rows[i].years);
  });
  assert.equal(next[2], rows[2]);
});

test('group rename rejects changed membership, duplicate IDs, excessive names and locked versions', () => {
  const rows = [
    makeRow('HLD', 'Design'),
    makeRow('LLD', 'Design'),
    makeRow('SUB', 'Design', { reTypeId: 'sub' }),
  ];
  const request = {
    groupName: 'Design',
    nextGroupName: 'Network Design',
    rowIds: ['HLD', 'LLD'],
  };
  assert.equal(
    renamePersonnelGroup(rows, resources, { ...request, rowIds: ['HLD'] }),
    null,
  );
  assert.equal(
    renamePersonnelGroup(rows, resources, {
      ...request,
      rowIds: ['HLD', 'HLD'],
    }),
    null,
  );
  assert.equal(
    renamePersonnelGroup(rows, resources, {
      ...request,
      nextGroupName: 'x'.repeat(201),
    }),
    null,
  );
  assert.equal(renamePersonnelGroup(rows, resources, request, true), null);
  assert.equal(renamePersonnelGroup(rows, resources, request)[2], rows[2]);
});
