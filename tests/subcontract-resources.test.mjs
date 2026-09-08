import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  createCostDraft,
  deleteCostVersion,
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';
import { YEAR_BUCKETS } from '../features/cost/domain.ts';
import { costBaselineKey } from '../features/cpq/domain.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';

const line = (id = 'ROUTER', unitPrice = 200) => ({
  id,
  code: id,
  catalogItemId: id,
  description: 'Router installation',
  bu: 'Infrastructure',
  unit: 'pcs',
  unitPrice,
  currency: 'SGD',
});
const projectBoq = () => ({
  mode: 'project',
  lines: [{ ...line(), quantities: [1, 2, 0, 0, 0] }],
  siteTypes: [],
});
const siteBoq = () => ({
  mode: 'site-types',
  lines: [{ ...line('SETUP', 100), unit: 'job', quantities: [1, 0, 0, 0, 0] }],
  siteTypes: [
    {
      id: 'A',
      name: 'Type A',
      sites: [100, 200, 0, 0, 0],
      lines: [
        { ...line(), quantityPerSite: 1 },
        {
          ...line('CORD', 80),
          description: 'Supply and install fibre patch cord',
          quantityPerSite: 2,
        },
      ],
    },
  ],
});
const setup = (filename = ':memory:') => {
  const repo = openWorkspaceRepository(filename);
  createProject(repo, {
    id: 'SUB',
    name: 'Structured Subcon',
    client: 'Customer',
  });
  const record = repo.get('SUB');
  record.workspace.rateSettings.tdStart = '2026-01-01';
  record.workspace.rateSettings.tdEnd = '2030-12-31';
  record.workspace.rateSettings.baseYear = 2026;
  repo.save('SUB', record.workspace, record.revision);
  return repo;
};
const update = (repo, value, version = 'V1') =>
  updateResource(
    repo,
    'SUB',
    'cost',
    { section: 'subcontract', version },
    { set: value },
    repo.get('SUB').revision,
  );
const summary = (repo, version = 'V1') =>
  readResource(repo, 'SUB', 'cost', { section: 'summary', version }).value;
const confirm = (repo, version = 'V1') =>
  updateResource(
    repo,
    'SUB',
    'cost',
    { section: 'settings', version },
    { set: { state: 'Confirmed' } },
    repo.get('SUB').revision,
  );

test('version-scoped Subcon BOQ derives 2.3.2 and project overview without labour or 1% labour charges', () => {
  const repo = setup();
  try {
    const before = repo.get('SUB');
    const result = update(repo, siteBoq());
    assert.equal(result.version, 'V1');
    assert.equal(result.workspace, undefined);
    const saved = repo.get('SUB').workspace;
    assert.deepEqual(saved.subcontractCost, siteBoq());
    assert.deepEqual(saved.costVersions[0].subcontractCost, siteBoq());
    assert.deepEqual(saved.costRows, []);
    assert.deepEqual(saved.resourceTypes, before.workspace.resourceTypes);
    assert.equal(summary(repo).subcontract, 108100);
    assert.equal(summary(repo).totalWithRisk, 108100);
    assert.equal(repo.list()[0].subcontractCost, 108100);
    const resource = readResource(repo, 'SUB', 'cost', {
      section: 'subcontract',
      version: 'V1',
    });
    assert.deepEqual(resource.value, siteBoq());
    assert.equal(resource.workspace, undefined);
    assert.notEqual(
      costBaselineKey(saved.costVersions[0]),
      costBaselineKey(before.workspace.costVersions[0]),
    );
  } finally {
    repo.close();
  }
});

test('confirmed Subcon versions are frozen; new copies and inactive drafts have independent BOQs', () => {
  const repo = setup();
  try {
    update(repo, projectBoq());
    confirm(repo);
    const locked = repo.get('SUB');
    assert.throws(() => update(repo, { lines: [] }), /锁定/);
    assert.deepEqual(repo.get('SUB'), locked);
    createCostDraft(
      repo,
      'SUB',
      { mode: 'clone', sourceVersion: 'V1' },
      locked.revision,
    );
    assert.equal(summary(repo, 'V2').subcontract, 600);
    assert.deepEqual(
      repo.get('SUB').workspace.costVersions[0],
      locked.workspace.costVersions[0],
    );
    createCostDraft(repo, 'SUB', { mode: 'blank' }, repo.get('SUB').revision);
    assert.equal(summary(repo, 'V3').subcontract, 0);
    const active = structuredClone(repo.get('SUB').workspace.subcontractCost);
    const changed = projectBoq();
    changed.lines[0].unitPrice = 250;
    update(repo, changed, 'V2');
    assert.equal(summary(repo, 'V2').subcontract, 750);
    assert.equal(summary(repo, 'V1').subcontract, 600);
    assert.equal(summary(repo, 'V3').subcontract, 0);
    assert.deepEqual(repo.get('SUB').workspace.subcontractCost, active);
  } finally {
    repo.close();
  }
});

test('unpriced Draft items cannot be confirmed, and invalid or stale narrow writes are atomic', () => {
  const repo = setup();
  try {
    const value = projectBoq();
    value.lines[0].unitPrice = null;
    update(repo, value);
    const before = repo.get('SUB');
    assert.throws(() => confirm(repo), /price/i);
    for (const invalid of [
      { ...value, lines: [{ ...value.lines[0], unitPrice: -1 }] },
      { ...value, lines: [value.lines[0], value.lines[0]] },
      {
        ...value,
        lines: [{ ...value.lines[0], quantities: [1, -1, 0, 0, 0] }],
      },
      { ...siteBoq(), mode: 'project' },
    ])
      assert.throws(() => update(repo, invalid));
    assert.throws(
      () =>
        updateResource(
          repo,
          'SUB',
          'cost',
          { section: 'subcontract' },
          { set: projectBoq() },
          before.revision - 1,
        ),
      /changed|revision/i,
    );
    assert.deepEqual(repo.get('SUB'), before);
    value.lines[0].unitPrice = 0;
    update(repo, value);
    confirm(repo);
    assert.equal(summary(repo).subcontract, 0);
  } finally {
    repo.close();
  }
});

test('catalog changes and older clients cannot reprice or erase captured Subcon costs', () => {
  const repo = setup();
  try {
    update(repo, projectBoq());
    const before = repo.get('SUB');
    const store = repo.globalMasterData;
    store.update(
      'subcontract',
      {
        upsert: [
          {
            id: 'ROUTER',
            code: 'ROUTER',
            item: 'Router installation',
            bu: 'Infrastructure',
            unit: 'pcs',
            unitPrice: 900,
            currency: 'SGD',
            active: true,
          },
        ],
      },
      store.get('subcontract').revision,
    );
    assert.deepEqual(repo.get('SUB'), before);
    const oldClient = structuredClone(before.workspace);
    delete oldClient.subcontractCost;
    delete oldClient.costVersions[0].subcontractCost;
    oldClient.project.name = 'Updated name';
    repo.save('SUB', oldClient, before.revision);
    assert.equal(summary(repo).subcontract, 600);
    assert.deepEqual(
      repo.get('SUB').workspace.costVersions[0].subcontractCost,
      projectBoq(),
    );
  } finally {
    repo.close();
  }
});

test('deleting the active suspended Subcon version restores an older version without leaking BOQ costs', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const historical = createBlankWorkspace(
      projectRecord('SUB', 'Historical project', 'Customer'),
      'input_preparation',
    );
    delete historical.subcontractCost;
    delete historical.costVersions[0].subcontractCost;
    repo.save('SUB', historical, null);
    createCostDraft(
      repo,
      'SUB',
      { mode: 'clone', sourceVersion: 'V1' },
      repo.get('SUB').revision,
    );
    update(repo, siteBoq(), 'V2');
    updateResource(
      repo,
      'SUB',
      'cost',
      { section: 'settings', version: 'V2' },
      { set: { state: 'Suspended' } },
      repo.get('SUB').revision,
    );
    const archived = structuredClone(
      repo.get('SUB').workspace.costVersions.find((v) => v.code === 'V2'),
    );
    deleteCostVersion(repo, 'SUB', 'V2', repo.get('SUB').revision);
    const saved = repo.get('SUB').workspace;
    assert.equal(saved.activeVersion, 'V1');
    assert.equal(saved.subcontractCost, undefined);
    assert.equal(summary(repo).subcontract, 0);
    assert.deepEqual(saved.deletedCostVersions.V2.version, archived);
    assert.equal(
      saved.deletedCostVersions.V2.version.subcontractCost.siteTypes[0]
        .sites[0],
      100,
    );
  } finally {
    repo.close();
  }
});

test('legacy manual RE subcontract costs can be read, copied or explicitly removed, but not added or changed', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const w = createBlankWorkspace(
      projectRecord('SUB', 'Historical project', 'Customer'),
      'input_preparation',
    );
    const legacy = {
      id: 'LEGACY',
      scope: 'Archived package',
      bu: 'Infrastructure',
      reTypeId: 'rt-subcon',
      mdPerSite: 0,
      years: YEAR_BUCKETS.map((bucket, index) => ({
        bucket,
        sites: 0,
        cost: index ? 0 : 500,
      })),
    };
    w.costRows = [legacy];
    repo.save('SUB', w, null);
    assert.equal(summary(repo).subcontract, 500);
    const before = repo.get('SUB');
    for (const value of [
      { ...legacy, id: 'NEW' },
      { id: legacy.id, scope: 'Changed scope' },
    ])
      assert.throws(
        () =>
          updateResource(
            repo,
            'SUB',
            'cost',
            { section: 'rows' },
            { upsert: [value] },
            before.revision,
          ),
        /legacy read-only/i,
      );
    const full = structuredClone(before.workspace);
    full.costRows[0].years[0].cost = 999;
    assert.throws(
      () => repo.save('SUB', full, before.revision),
      /legacy read-only/i,
    );
    assert.deepEqual(repo.get('SUB'), before);
    createCostDraft(
      repo,
      'SUB',
      { mode: 'clone', sourceVersion: 'V1' },
      before.revision,
    );
    assert.equal(summary(repo, 'V2').subcontract, 500);
    updateResource(
      repo,
      'SUB',
      'cost',
      { section: 'rows', version: 'V2' },
      { remove: ['LEGACY'] },
      repo.get('SUB').revision,
    );
    assert.equal(summary(repo, 'V2').subcontract, 0);
    assert.equal(summary(repo, 'V1').subcontract, 500);
  } finally {
    repo.close();
  }
});

test('CLI Subcon reads and updates one version without returning the workspace; calculate includes annual BOQ cost', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'subcon-cli-'));
  const filename = path.join(dir, 'workbench.sqlite');
  const repo = setup(filename);
  const revision = repo.get('SUB').revision;
  repo.close();
  const cli = (args, changes) => {
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        ...args,
        '--db',
        filename,
      ],
      {
        encoding: 'utf8',
        input: changes
          ? JSON.stringify({
              apiVersion: 'cost-workbench/v2',
              kind: 'OperationRequest',
              requestId: 'subcon-test',
              data: {
                schemaVersion: '1.0.0',
                operation: 'cost.update',
                changes,
              },
            })
          : undefined,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).data;
  };
  try {
    const written = cli(
      [
        'cost',
        'update',
        '--project-id',
        'SUB',
        '--version',
        'V1',
        '--section',
        'subcontract',
        '--input',
        '-',
        '--expected-revision',
        String(revision),
      ],
      { set: siteBoq() },
    );
    assert.equal(written.workspace, undefined);
    const read = cli([
      'cost',
      'get',
      '--project-id',
      'SUB',
      '--version',
      'V1',
      '--section',
      'subcontract',
    ]);
    assert.deepEqual(read.value, siteBoq());
    assert.equal(read.resourceTypes, undefined);
    const calculated = cli([
      'cost',
      'calculate',
      '--project-id',
      'SUB',
      '--version',
      'V1',
    ]);
    assert.equal(calculated.totals.subcontract, 108100);
    assert.equal(calculated.totals.totalWithRisk, 108100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
