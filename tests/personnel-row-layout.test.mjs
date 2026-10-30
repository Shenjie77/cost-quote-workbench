import assert from 'node:assert/strict';
import test from 'node:test';
import {
  movePersonnelRow,
  movePersonnelGroup,
  renamePersonnelGroup,
  copyPersonnelGroup,
  nextPersonnelGroupCopyName,
  setPersonnelGroupCategory,
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

test('group Category applies atomically to its current members without changing amounts or other groups', () => {
  const rows = [
    makeRow('a', 'Design', { category: 'Mandatory', source }),
    makeRow('b', 'Design', { category: 'Optional' }),
    makeRow('sub', 'Design', { reTypeId: 'sub' }),
    makeRow('c', 'Build'),
  ];
  const request = {
    groupName: 'Design',
    rowIds: ['a', 'b'],
    category: ' Phase2 ',
  };
  const next = setPersonnelGroupCategory(rows, resources, request);
  assert.deepEqual(
    next.map((row) => row.category),
    ['Phase2', 'Phase2', undefined, undefined],
  );
  assert.equal(next[0].years, rows[0].years);
  assert.equal(next[0].source, source);
  assert.equal(next[2], rows[2]);
  assert.equal(next[3], rows[3]);
  assert.equal(rows[0].category, 'Mandatory');
  assert.equal(setPersonnelGroupCategory(rows, resources, request, true), null);
  assert.equal(
    setPersonnelGroupCategory(rows, resources, { ...request, rowIds: ['a'] }),
    null,
  );
  assert.equal(
    setPersonnelGroupCategory(rows, resources, {
      ...request,
      category: 'x'.repeat(121),
    }),
    null,
  );
  assert.equal(
    setPersonnelGroupCategory(
      [...rows, makeRow('new', 'Design')],
      resources,
      request,
    ),
    null,
  );
  assert.equal(
    setPersonnelGroupCategory(rows, resources, { ...request, category: '' })[0]
      .category,
    '',
  );
});

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

test('whole-group moves preserve member order, cost values and legacy Subcon slots across interleaved groups', () => {
  const rows = [
    makeRow('a1', 'A'),
    makeRow('sub', '', { reTypeId: 'sub' }),
    makeRow('b1', 'B'),
    makeRow('a2', 'A', { source }),
    makeRow('c1', 'C'),
    makeRow('b2', 'B'),
  ];
  const before = structuredClone(rows);
  const next = movePersonnelGroup(rows, resources, {
    groupName: 'B',
    targetGroupName: 'A',
    direction: 'up',
    rowIds: ['b1', 'b2'],
  });
  assert.deepEqual(
    next.map((row) => row.id),
    ['b1', 'sub', 'b2', 'a1', 'a2', 'c1'],
  );
  assert.deepEqual(rows, before);
  for (const item of next)
    assert.equal(
      item,
      rows.find((row) => row.id === item.id),
    );
  const down = movePersonnelGroup(next, resources, {
    groupName: 'B',
    targetGroupName: 'A',
    direction: 'down',
    rowIds: ['b1', 'b2'],
  });
  assert.deepEqual(
    down.map((row) => row.id),
    ['a1', 'sub', 'a2', 'b1', 'b2', 'c1'],
  );
  assert.equal(
    movePersonnelGroup(rows, resources, {
      groupName: 'B',
      targetGroupName: 'A',
      direction: 'up',
      rowIds: ['b1'],
    }),
    null,
  );
  assert.equal(
    movePersonnelGroup(rows, resources, {
      groupName: 'B',
      targetGroupName: 'C',
      direction: 'up',
      rowIds: ['b1', 'b2'],
    }),
    null,
  );
  assert.equal(
    movePersonnelGroup(
      rows,
      resources,
      {
        groupName: 'B',
        targetGroupName: 'A',
        direction: 'up',
        rowIds: ['b1', 'b2'],
      },
      true,
    ),
    null,
  );
});

test('group copy inserts independent raw rows with new IDs and retains all years and categories', () => {
  const rows = [
    makeRow('HLD', 'Design', { category: 'Network', source }),
    makeRow('LLD', 'Design', {
      inputMode: 'mandays',
      years: [{ bucket: 'Y5', sites: 0, mandays: 12, cost: 1200 }],
    }),
    makeRow('SUB', '', { reTypeId: 'sub' }),
    makeRow('Plan', 'Planning'),
  ];
  const before = structuredClone(rows);
  const next = copyPersonnelGroup(rows, resources, {
    groupName: 'Design',
    nextGroupName: 'Implementation',
    rowIds: ['HLD', 'LLD'],
    newRowIds: ['copy-1', 'copy-2'],
  });
  assert.deepEqual(
    next.map((row) => row.id),
    ['HLD', 'LLD', 'copy-1', 'copy-2', 'SUB', 'Plan'],
  );
  assert.equal(next[2].category, 'Network');
  assert.equal(next[2].groupName, 'Implementation');
  assert.equal(next[2].source, undefined);
  assert.equal(next[3].inputMode, 'mandays');
  assert.deepEqual(next[3].years, rows[1].years);
  assert.notEqual(next[3].years, rows[1].years);
  next[3].years[0].mandays = 100;
  assert.deepEqual(rows, before);
  assert.equal(next[4], rows[2]);
});

test('group copying rejects stale membership, existing names, duplicate IDs and locked versions', () => {
  const rows = [
    makeRow('HLD', 'Design'),
    makeRow('LLD', 'Design'),
    makeRow('SUB', 'Design', { reTypeId: 'sub' }),
  ];
  const request = {
    groupName: 'Design',
    nextGroupName: 'Copy',
    rowIds: ['HLD', 'LLD'],
    newRowIds: ['new-1', 'new-2'],
  };
  for (const patch of [
    { rowIds: ['HLD'] },
    { rowIds: ['HLD', 'HLD'] },
    { nextGroupName: 'Design' },
    { nextGroupName: '  ' },
    { nextGroupName: 'x'.repeat(201) },
    { newRowIds: ['new-1', 'new-1'] },
    { newRowIds: ['SUB', 'new-2'] },
    { newRowIds: ['new-1', ''] },
  ])
    assert.equal(
      copyPersonnelGroup(rows, resources, { ...request, ...patch }),
      null,
    );
  assert.equal(copyPersonnelGroup(rows, resources, request, true), null);
  assert.equal(copyPersonnelGroup(rows, resources, request).length, 5);
});

test('group copy names stay unique and fit the group field including unassigned groups', () => {
  assert.equal(nextPersonnelGroupCopyName([], ''), 'Unassigned Group (copy)');
  assert.equal(
    nextPersonnelGroupCopyName(
      [makeRow('1', 'Design (copy)'), makeRow('2', 'Design (copy 2)')],
      'Design',
    ),
    'Design (copy 3)',
  );
  assert.equal(
    Array.from(nextPersonnelGroupCopyName([], 'A'.repeat(200))).length,
    200,
  );
});
