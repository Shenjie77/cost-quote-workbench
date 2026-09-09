import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  updateResource,
  readResource,
  createCostDraft,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { buildCostExportSnapshot } from '../features/cost/build-export-snapshot.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { makeCostSnapshot } from './helpers.mjs';

const id = 'P-GROUP';
const fixture = () => {
  const workspace = createBlankWorkspace(
    projectRecord(id, 'Grouping', 'Customer'),
    'input_preparation',
  );
  workspace.costRows = [
    initialCostRows[0],
    initialCostRows[4],
    initialCostRows[1],
    initialCostRows[2],
  ].map((row) => structuredClone(row));
  workspace.costRows[0].source = {
    fileName: 'TD.xlsx',
    sha256: 'a'.repeat(64),
    sheet: 'Plan',
    row: 2,
    mappingKey: 'fixture-mapping',
    role: 'TD',
    importedAt: '2026-09-09T00:00:00Z',
  };
  return workspace;
};
const setup = () => {
  const repository = openWorkspaceRepository(':memory:');
  repository.save(id, fixture(), null);
  return repository;
};
const update = (
  repository,
  changes,
  revision = repository.get(id).revision,
  version = 'V1',
) =>
  updateResource(
    repository,
    id,
    'cost',
    { section: 'rows', version },
    changes,
    revision,
  );
const ids = (rows) => rows.map((row) => row.id);
const personnel = ['CI-001', 'CI-002', 'CI-003'];

test('Group is optional, trimmed on narrow edits, case-sensitive and independent of Scope and cost', () => {
  const repository = setup();
  try {
    const original = repository.get(id).workspace;
    assert.ok(
      original.costRows.every((row) => !Object.hasOwn(row, 'groupName')),
    );
    update(repository, {
      upsert: [
        { id: 'CI-001', groupName: '  Site A  ' },
        { id: 'CI-002', groupName: 'site a' },
        { id: 'CI-003', groupName: '   ' },
      ],
    });
    const rows = repository.get(id).workspace.costRows;
    assert.deepEqual(
      rows.map((row) => row.groupName),
      ['Site A', undefined, 'site a', ''],
    );
    assert.deepEqual(
      rows.map(({ groupName: _groupName, ...row }) => row),
      original.costRows,
    );
    const compact = readResource(repository, id, 'cost', {
      section: 'rows',
      version: 'V1',
      fields: 'id,groupName,scope',
      limit: 20,
    });
    assert.equal(compact.items[0].groupName, 'Site A');
    assert.equal(compact.items[0].scope, original.costRows[0].scope);
  } finally {
    repository.close();
  }
});

test('Personnel order is exact, atomic and keeps legacy Subcon in its saved slots with costs unchanged', () => {
  const repository = setup();
  try {
    const before = repository.get(id).workspace;
    const summary = readResource(repository, id, 'cost', {
      section: 'summary',
      version: 'V1',
    }).value;
    const receipt = update(repository, {
      order: ['CI-003', 'CI-001', 'CI-002'],
    });
    assert.deepEqual(receipt.changedFields, ['order']);
    assert.equal(receipt.reorderedCount, 3);
    assert.deepEqual(receipt.changedIds, []);
    const after = repository.get(id).workspace;
    assert.deepEqual(ids(after.costRows), [
      'CI-003',
      'CI-005',
      'CI-001',
      'CI-002',
    ]);
    assert.deepEqual(after.costRows, after.costVersions[0].costRows);
    for (const row of before.costRows)
      assert.deepEqual(
        after.costRows.find((item) => item.id === row.id),
        row,
      );
    assert.deepEqual(
      readResource(repository, id, 'cost', {
        section: 'summary',
        version: 'V1',
      }).value,
      summary,
    );
    const saved = repository.get(id);
    for (const order of [
      null,
      'CI-001',
      [],
      ['CI-001'],
      ['CI-001', 'CI-002', 'CI-002'],
      ['CI-001', 'CI-002', 'missing'],
      ['CI-001', 'CI-002', 'CI-003', 'CI-005'],
    ]) {
      assert.throws(
        () =>
          update(repository, {
            upsert: [{ id: 'CI-001', groupName: 'Must not save' }],
            order,
          }),
        /order/,
      );
      assert.deepEqual(repository.get(id), saved);
    }
    assert.throws(
      () =>
        updateResource(
          repository,
          id,
          'cost',
          { section: 'settings', version: 'V1' },
          { set: { state: 'Draft' }, order: personnel },
          saved.revision,
        ),
      /only for cost rows/,
    );
    assert.deepEqual(repository.get(id), saved);
  } finally {
    repository.close();
  }
});

test('Upsert/remove and ordering share one transaction, and version clones preserve groups and order independently', () => {
  const repository = setup();
  try {
    const newRow = {
      ...structuredClone(initialCostRows[0]),
      id: 'CI-NEW',
      groupName: 'New group',
      scope: 'New work',
    };
    update(repository, {
      upsert: [newRow, { id: 'CI-003', groupName: 'Group C' }],
      remove: ['CI-002'],
      order: ['CI-NEW', 'CI-003', 'CI-001'],
    });
    const v1 = structuredClone(repository.get(id).workspace.costVersions[0]);
    assert.deepEqual(ids(v1.costRows), [
      'CI-NEW',
      'CI-005',
      'CI-003',
      'CI-001',
    ]);
    createCostDraft(
      repository,
      id,
      { mode: 'clone', sourceVersion: 'V1' },
      repository.get(id).revision,
    );
    const cloned = repository.get(id).workspace;
    assert.equal(cloned.activeVersion, 'V2');
    assert.deepEqual(cloned.costVersions[1].costRows, v1.costRows);
    update(
      repository,
      {
        upsert: [{ id: 'CI-NEW', groupName: '' }],
        order: ['CI-001', 'CI-003', 'CI-NEW'],
      },
      repository.get(id).revision,
      'V2',
    );
    const updated = repository.get(id).workspace;
    assert.deepEqual(updated.costVersions[0], cloned.costVersions[0]);
    assert.deepEqual(ids(updated.costRows), [
      'CI-001',
      'CI-005',
      'CI-003',
      'CI-NEW',
    ]);
    assert.equal(updated.costRows[3].groupName, '');
  } finally {
    repository.close();
  }
});

test('Grouping and ordering obey revision and version locks; another Draft remains editable', () => {
  const repository = setup();
  try {
    update(repository, { upsert: [{ id: 'CI-001', groupName: 'Group A' }] });
    const before = repository.get(id);
    assert.throws(
      () => update(repository, { order: personnel }, 1),
      /changed|revision/,
    );
    assert.deepEqual(repository.get(id), before);
    updateResource(
      repository,
      id,
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      before.revision,
    );
    const confirmed = repository.get(id);
    for (const changes of [
      { order: personnel },
      { upsert: [{ id: 'CI-001', groupName: 'Altered' }] },
    ]) {
      assert.throws(() => update(repository, changes), /Confirmed|locked|定稿/);
      assert.deepEqual(repository.get(id), confirmed);
    }
    createCostDraft(
      repository,
      id,
      { mode: 'clone', sourceVersion: 'V1' },
      confirmed.revision,
    );
    update(
      repository,
      { order: ['CI-003', 'CI-002', 'CI-001'] },
      repository.get(id).revision,
      'V2',
    );
    assert.deepEqual(
      repository.get(id).workspace.costVersions[0].costRows,
      confirmed.workspace.costVersions[0].costRows,
    );
  } finally {
    repository.close();
  }
});

test('Group shape is validated for Draft storage and export while export snapshots retain optional labels', () => {
  const repository = setup();
  try {
    for (const groupName of [null, 42, 'a'.repeat(201)]) {
      const saved = repository.get(id);
      assert.throws(
        () => update(repository, { upsert: [{ id: 'CI-001', groupName }] }),
        /groupName|schema|workspace/i,
      );
      assert.deepEqual(repository.get(id), saved);
      const snapshot = makeCostSnapshot();
      snapshot.costRows[0].groupName = groupName;
      assert.ok(
        validateCostExportSnapshot(snapshot).some(
          (issue) => issue.code === 'INVALID_GROUP_NAME',
        ),
      );
    }
    const input = makeCostSnapshot();
    input.costRows[0].groupName = 'Site A';
    input.costRows[1].groupName = '';
    const exported = buildCostExportSnapshot({
      activeVersion: 'V1',
      versionStatus: 'Draft',
      project: input.project,
      rateSettings: input.rateSettings,
      travelSettings: input.travelSettings,
      resourceTypes: input.resourceTypes,
      rows: input.costRows,
      manualCosts: input.manualCosts,
    });
    assert.equal(exported.costRows[0].groupName, 'Site A');
    assert.equal(exported.costRows[1].groupName, '');
    assert.equal(Object.hasOwn(exported.costRows[2], 'groupName'), false);
    input.costRows[0].groupName = 'Later';
    assert.equal(exported.costRows[0].groupName, 'Site A');
    const schema = JSON.parse(
      readFileSync(
        new URL('../schemas/cost-export.schema.json', import.meta.url),
        'utf8',
      ),
    );
    const validate = new Ajv2020({ strict: true }).compile(schema);
    assert.ok(validate(exported), JSON.stringify(validate.errors));
  } finally {
    repository.close();
  }
});

test('Group Unicode limits agree between saved drafts and export validation', () => {
  const repository = setup();
  try {
    const groupName = '🔧'.repeat(101);
    update(repository, { upsert: [{ id: 'CI-001', groupName }] });
    const saved = repository.get(id);
    const input = makeCostSnapshot();
    input.costRows[0].groupName = saved.workspace.costRows.find(
      (row) => row.id === 'CI-001',
    ).groupName;
    const exported = buildCostExportSnapshot({
      activeVersion: 'V1',
      versionStatus: 'Draft',
      project: input.project,
      rateSettings: input.rateSettings,
      travelSettings: input.travelSettings,
      resourceTypes: input.resourceTypes,
      rows: input.costRows,
      manualCosts: input.manualCosts,
    });
    assert.equal(exported.costRows[0].groupName, groupName);
    assert.deepEqual(
      validateCostExportSnapshot(exported).filter(
        (issue) => issue.severity === 'error',
      ),
      [],
    );

    const tooLong = '🔧'.repeat(201);
    assert.throws(
      () =>
        update(repository, {
          upsert: [{ id: 'CI-001', groupName: tooLong }],
        }),
      /groupName|schema|workspace/i,
    );
    assert.deepEqual(repository.get(id), saved);
    exported.costRows[0].groupName = tooLong;
    assert.ok(
      validateCostExportSnapshot(exported).some(
        (issue) => issue.code === 'INVALID_GROUP_NAME',
      ),
    );
  } finally {
    repository.close();
  }
});

test('CLI accepts narrow Group/order operation and returns a compact schema-valid receipt', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personnel-groups-'));
  const db = path.join(dir, 'workspace.sqlite');
  const repository = openWorkspaceRepository(db);
  repository.save(id, fixture(), null);
  repository.close();
  try {
    const response = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        'cost',
        'update',
        '--project-id',
        id,
        '--version',
        'V1',
        '--section',
        'rows',
        '--expected-revision',
        '1',
        '--input',
        '-',
        '--db',
        db,
      ],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'group-order-test',
          data: {
            schemaVersion: '1.0.0',
            operation: 'cost.update',
            changes: {
              upsert: [{ id: 'CI-001', groupName: ' Branch A ' }],
              order: ['CI-003', 'CI-001', 'CI-002'],
            },
          },
        }),
      },
    );
    assert.equal(response.status, 0, response.stdout + response.stderr);
    const envelope = JSON.parse(response.stdout);
    const schema = JSON.parse(
      readFileSync(
        new URL('../schemas/command-envelope.schema.json', import.meta.url),
        'utf8',
      ),
    );
    const validate = new Ajv2020({ strict: true }).compile(schema);
    assert.ok(validate(envelope), JSON.stringify(validate.errors));
    assert.equal(envelope.kind, 'MutationResult');
    assert.equal(envelope.data.reorderedCount, 3);
    assert.deepEqual(envelope.data.changedFields, ['order']);
    assert.equal(envelope.data.workspace, undefined);
    const read = openWorkspaceRepository(db);
    try {
      assert.deepEqual(ids(read.get(id).workspace.costRows), [
        'CI-003',
        'CI-005',
        'CI-001',
        'CI-002',
      ]);
      assert.equal(read.get(id).workspace.costRows[2].groupName, 'Branch A');
    } finally {
      read.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
