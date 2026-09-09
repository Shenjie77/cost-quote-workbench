import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPersonnelAnnualColumn,
  getPersonnelAnnualColumnLabel,
  getPersonnelHeaderSegments,
  groupPersonnelRows,
  resolvePersonnelTableColumns,
  UNASSIGNED_PERSONNEL_GROUP,
} from '../features/cost/personnel-table-layout.ts';

test('shared layout preserves each visible column order and keeps Action last without mutating preferences', () => {
  const columns = Object.freeze([
    'action',
    'Y2:cost',
    'scope',
    'Y1:mandays',
    'Y2:sites',
    'groupName',
    'Y2:cost',
  ]);
  assert.deepEqual(resolvePersonnelTableColumns(columns, 'all'), [
    'Y2:cost',
    'scope',
    'Y1:mandays',
    'Y2:sites',
    'groupName',
    'action',
  ]);
  assert.deepEqual(resolvePersonnelTableColumns(columns, 1), [
    'Y2:cost',
    'scope',
    'Y2:sites',
    'groupName',
    'action',
  ]);
  assert.equal(columns[0], 'action');
  assert.equal(columns.length, 7);
});

test('focused years never reveal hidden annual or metadata fields when the only selected field belongs to another year', () => {
  assert.deepEqual(resolvePersonnelTableColumns(['Y4:cost', 'action'], 0), [
    'action',
  ]);
  assert.deepEqual(resolvePersonnelTableColumns([], 'all'), ['action']);
  assert.deepEqual(resolvePersonnelTableColumns(['Y4:cost', 'action'], 3), [
    'Y4:cost',
    'action',
  ]);
});

test('shared header segments merge only consecutive same-year fields and preserve their custom order', () => {
  const columns = Object.freeze([
    'Y1:cost',
    'Y1:sites',
    'scope',
    'Y1:mandays',
    'Y3:cost',
    'Y2:sites',
    'Y2:cost',
    'action',
  ]);
  assert.deepEqual(getPersonnelHeaderSegments(columns), [
    { ids: ['Y1:cost', 'Y1:sites'], index: 0 },
    { ids: ['scope'] },
    { ids: ['Y1:mandays'], index: 0 },
    { ids: ['Y3:cost'], index: 2 },
    { ids: ['Y2:sites', 'Y2:cost'], index: 1 },
    { ids: ['action'] },
  ]);
  assert.deepEqual(getPersonnelAnnualColumn('Y5:mandays'), {
    index: 4,
    field: 'mandays',
  });
  assert.equal(getPersonnelAnnualColumn('totalCost'), null);
  assert.equal(getPersonnelAnnualColumnLabel('sites'), 'Sites');
  assert.equal(getPersonnelAnnualColumnLabel('mandays'), 'Mandays');
  assert.equal(getPersonnelAnnualColumnLabel('cost'), 'Cost (SGD)');
});

test('shared grouping uses independent trimmed case-sensitive Group names, first-seen order and original row identities', () => {
  const rows = Object.freeze([
    Object.freeze({
      id: '1',
      groupName: ' Network Design & Planning ',
      scope: 'HLD',
      years: [{ cost: 10 }],
    }),
    Object.freeze({
      id: '2',
      groupName: '',
      scope: 'HLD',
      years: [{ cost: 20 }],
    }),
    Object.freeze({
      id: '3',
      groupName: 'Network Design & Planning',
      scope: 'LLD',
      years: [{ cost: 30 }],
    }),
    Object.freeze({
      id: '4',
      groupName: 'network design & planning',
      scope: 'Planning',
      years: [{ cost: 40 }],
    }),
    Object.freeze({ id: '5', scope: 'Different scope', years: [{ cost: 50 }] }),
  ]);
  const before = structuredClone(rows);
  const groups = groupPersonnelRows(rows);
  assert.deepEqual(
    groups.map((group) => [group.groupName, group.rows.map((row) => row.id)]),
    [
      ['Network Design & Planning', ['1', '3']],
      ['', ['2', '5']],
      ['network design & planning', ['4']],
    ],
  );
  assert.equal(UNASSIGNED_PERSONNEL_GROUP, 'Unassigned Group');
  const displayed = groups.flatMap((group) => group.rows);
  assert.equal(displayed.length, rows.length);
  assert.equal(
    displayed.reduce((total, row) => total + row.years[0].cost, 0),
    150,
  );
  assert.equal(groups[0].rows[0], rows[0]);
  assert.equal(groups[0].rows[1], rows[2]);
  assert.deepEqual(rows, before);
});
