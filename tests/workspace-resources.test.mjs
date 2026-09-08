import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import Ajv2020 from 'ajv/dist/2020.js';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  readResource,
  updateResource,
  applyMasterRates,
  MASTER_TABS,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { costLockReason } from '../features/cost/cost-lock.ts';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { openReminderService } from '../server/reminder-service.mjs';

const fixture = () => {
  const w = createBlankWorkspace(
    projectRecord('P-TEST', 'Fixture', 'Customer'),
    'input_preparation',
  );
  w.costRows = structuredClone(initialCostRows);
  return w;
};
const setup = () => {
  const repo = openWorkspaceRepository(':memory:');
  repo.save('P-TEST', fixture(), null);
  return repo;
};

test('recoverable deletion preserves archives, blocks stale/null saves, and restores with monotonic revision', () => {
  const repo = setup();
  try {
    const before = repo.get('P-TEST');
    assert.throws(() => repo.setDeleted('P-TEST', 2), /changed/);
    assert.equal(repo.headers().length, 1);
    assert.equal(repo.setDeleted('P-TEST', 1).revision, 2);
    assert.equal(repo.get('P-TEST'), null);
    assert.deepEqual(repo.list(), []);
    assert.deepEqual(repo.headers(), []);
    assert.equal(repo.headers(true)[0].revision, 2);
    for (const revision of [null, 1, 2])
      assert.throws(
        () => repo.save('P-TEST', before.workspace, revision),
        /deleted/,
      );
    assert.throws(() => repo.setDeleted('P-TEST', 1, false), /changed/);
    assert.equal(repo.setDeleted('P-TEST', 2, false).revision, 3);
    assert.deepEqual(repo.get('P-TEST').workspace, before.workspace);
    assert.throws(() => repo.save('P-TEST', before.workspace, 1), /revision/);
  } finally {
    repo.close();
  }
});

test('deletion survives reopen and retires only that project’s reminders', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'resource-delete-')),
    file = path.join(dir, 'db.sqlite');
  let repo = openWorkspaceRepository(file),
    reminders;
  try {
    const w = fixture();
    w.costRows[0].scope = '';
    repo.save('P-TEST', w, null);
    const other = structuredClone(w);
    other.project.id = 'P-KEEP';
    repo.save('P-KEEP', other, null);
    reminders = openReminderService(file, repo);
    reminders.scan('2026-09-07');
    assert.ok(
      reminders.list().some((r) => r.active && r.item.projectId === 'P-TEST'),
    );
    repo.setDeleted('P-TEST', 1);
    reminders.scan('2026-09-07');
    assert.equal(
      reminders.list().some((r) => r.active && r.item.projectId === 'P-TEST'),
      false,
    );
    assert.ok(
      reminders.list().some((r) => r.active && r.item.projectId === 'P-KEEP'),
    );
    reminders.close();
    reminders = null;
    repo.close();
    repo = openWorkspaceRepository(file);
    assert.equal(repo.isDeleted('P-TEST'), true);
    assert.equal(repo.headers().length, 1);
    repo.setDeleted('P-KEEP', 1);
    assert.deepEqual(repo.headers(), []);
    const fresh = fixture();
    fresh.project.id = 'P-NEW';
    repo.save('P-NEW', fresh, null);
    assert.equal(repo.headers()[0].projectId, 'P-NEW');
  } finally {
    reminders?.close();
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('single-row updates recalculate active cost while preserving unrelated master data and inactive version', () => {
  const repo = setup();
  try {
    const w = repo.get('P-TEST').workspace;
    w.costVersions.push({
      ...structuredClone(w.costVersions[0]),
      code: 'V2',
      sourceVersion: 'V1',
    });
    repo.save('P-TEST', w, 1);
    const row = w.costRows[0];
    const receipt = updateResource(
      repo,
      'P-TEST',
      'cost',
      { version: 'V1' },
      { upsert: [{ id: row.id, mdPerSite: row.mdPerSite * 2 }] },
      2,
    );
    assert.equal(receipt.revision, 3);
    assert.equal(receipt.workspace, undefined);
    const after = repo.get('P-TEST').workspace;
    assert.deepEqual(after.costRows, after.costVersions[0].costRows);
    assert.equal(
      after.costRows[0].years[0].cost,
      w.costRows[0].years[0].cost * 2,
    );
    assert.deepEqual(after.costVersions[1], w.costVersions[1]);
    assert.deepEqual(after.resourceTypes, w.resourceTypes);
    updateResource(
      repo,
      'P-TEST',
      'cost',
      { version: 'V2' },
      { upsert: [{ id: row.id, mdPerSite: row.mdPerSite * 3 }] },
      3,
    );
    const inactive = repo.get('P-TEST').workspace;
    assert.deepEqual(inactive.costRows, after.costRows);
    assert.equal(inactive.activeVersion, 'V1');
    assert.equal(
      inactive.costVersions[1].costRows[0].years[0].cost,
      w.costRows[0].years[0].cost * 3,
    );
  } finally {
    repo.close();
  }
});

test('master rate edits stay separate until explicitly applied to a named version', () => {
  const repo = setup();
  try {
    const old = repo.get('P-TEST').workspace,
      resource = old.costVersions[0].resourceTypes.find(
        (r) => r.id === old.costRows[0].reTypeId,
      );
    updateResource(
      repo,
      'P-TEST',
      'masterdata',
      { tab: 'resources' },
      { upsert: [{ id: resource.id, mandayRate: resource.mandayRate * 2 }] },
      1,
    );
    assert.deepEqual(
      repo.get('P-TEST').workspace.costVersions,
      old.costVersions,
    );
    applyMasterRates(repo, 'P-TEST', 'V1', 2);
    assert.equal(
      repo.get('P-TEST').workspace.costRows[0].years[0].cost,
      old.costRows[0].years[0].cost * 2,
    );
  } finally {
    repo.close();
  }
});

test('all master tabs have independent reads, filters and stable-ID updates', () => {
  const repo = setup();
  try {
    let revision = 1;
    for (const [tab, [field, key]] of Object.entries(MASTER_TABS)) {
      const record = repo.get('P-TEST');
      const items = readResource(repo, 'P-TEST', 'masterdata', {
        tab,
        limit: 1,
      });
      assert.equal(items.items.length, 1);
      assert.equal(items.total, record.workspace[field].length);
      const item = items.items[0];
      const changed = readResource(repo, 'P-TEST', 'masterdata', {
        tab,
        id: item[key],
      });
      assert.equal(changed.total, 1);
      const result = updateResource(
        repo,
        'P-TEST',
        'masterdata',
        { tab },
        {
          upsert: [
            {
              [key]: item[key],
              ...('name' in item
                ? { name: item.name + ' updated' }
                : 'service' in item
                  ? { service: item.service + ' updated' }
                  : { active: item.active }),
            },
          ],
        },
        revision,
      );
      revision = result.revision;
      for (const [other] of Object.values(MASTER_TABS))
        if (other !== field)
          assert.deepEqual(
            repo.get('P-TEST').workspace[other],
            record.workspace[other],
          );
    }
  } finally {
    repo.close();
  }
});

test('invalid narrow writes and conflicts are atomic; imported evidence is not editable', () => {
  const repo = setup();
  try {
    const workspace = repo.get('P-TEST').workspace;
    const row = workspace.costRows[0];
    const cases = [
      ['cost', {}, { upsert: [{ id: row.id, reTypeId: 'missing' }] }],
      ['cost', {}, { upsert: [{ id: row.id, source: { fileName: 'fake' } }] }],
      ['cost', {}, { upsert: [{ id: row.id, bogus: true }] }],
      ['cost', {}, { upsert: [{ id: row.id }, { id: row.id }] }],
      ['cost', {}, { remove: ['unknown'] }],
      ['cost', {}, { upsert: [{ id: row.id }], remove: [row.id] }],
      ['project', {}, { set: { id: 'other' } }],
      ['cpq', {}, { set: { confirmation: { by: 'agent' } } }],
      [
        'masterdata',
        { tab: 'workflow' },
        { remove: [workspace.currentWorkflowStepCode] },
      ],
      ['masterdata', { tab: 'status' }, { remove: [workspace.projectStatus] }],
    ];
    for (const [module, options, changes] of cases) {
      assert.throws(() =>
        updateResource(repo, 'P-TEST', module, options, changes, 1),
      );
      assert.equal(repo.get('P-TEST').revision, 1);
    }
    assert.throws(
      () => updateResource(repo, 'P-TEST', 'cost', {}, { remove: [row.id] }, 2),
      /changed/,
    );
    assert.throws(
      () => readResource(repo, 'P-TEST', 'masterdata', { tab: '__proto__' }),
      /tab/,
    );
    assert.throws(
      () => readResource(repo, 'P-TEST', 'cost', { limit: 201 }),
      /limit/,
    );
    assert.throws(
      () => readResource(repo, 'P-TEST', 'cost', { version: 'V404' }),
      /version/,
    );
  } finally {
    repo.close();
  }
});

const envelopeSchema = JSON.parse(
  readFileSync(
    new URL('../schemas/command-envelope.schema.json', import.meta.url),
    'utf8',
  ),
);
const validate = new Ajv2020({ strict: true }).compile(envelopeSchema);
const cli = (db, args, data, status = 0) => {
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      'cli/cost-cli.mjs',
      ...args,
      '--db',
      db,
    ],
    {
      encoding: 'utf8',
      input: data
        ? JSON.stringify({
            apiVersion: 'cost-workbench/v2',
            kind: 'OperationRequest',
            requestId: 'granular-test',
            data: {
              schemaVersion: '1.0.0',
              operation: args.slice(0, 2).join('.'),
              changes: data,
            },
          })
        : undefined,
    },
  );
  const output = JSON.parse(result.stdout);
  assert.equal(result.status, status, result.stdout + result.stderr);
  assert.ok(validate(output), JSON.stringify(validate.errors));
  return { data: output.data, bytes: Buffer.byteLength(result.stdout), output };
};

test('CLI performs CPQ catalog → draft → user-confirmed selections → solve → archive → export with only narrow requests', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cpq-narrow-')),
    db = path.join(dir, 'db.sqlite');
  const repo = openWorkspaceRepository(db);
  repo.save('P-TEST', fixture(), null);
  repo.close();
  try {
    const update = (section, changes, revision) =>
      cli(
        db,
        [
          'cpq',
          'update',
          '--project-id',
          'P-TEST',
          '--section',
          section,
          '--input',
          '-',
          '--expected-revision',
          String(revision),
        ],
        changes,
      );
    const item = (code, kind, unitCost) => ({
      code,
      scope:
        kind === 'equipment' ? 'Router device' : 'Router deployment service',
      unit: 'unit',
      unitCost,
      kind,
      adjustable: kind === 'service',
      active: true,
      step: 1,
      minQty: 0,
      maxQty: 100,
      referenceQty: 1,
      tags: 'router deployment',
      revision: '1',
    });
    update(
      'catalog',
      { upsert: [item('EQ', 'equipment', 100), item('SRV', 'service', 10)] },
      1,
    );
    const match = cli(db, [
      'cpq',
      'match',
      '--project-id',
      'P-TEST',
      '--scope',
      'router deployment',
    ]);
    assert.equal(match.data.revision, 2);
    assert.equal(match.data.candidates[0].step, 1);
    update(
      'draft',
      {
        set: {
          brief: 'router deployment',
          costVersion: 'V1',
          targetCost: 150,
          targetBasis: 'Approved fixture target',
          tolerance: 0,
          allocationBasis: 'Equal service allocation',
        },
      },
      2,
    );
    update(
      'selections',
      {
        upsert: [
          {
            code: 'EQ',
            quantity: 1,
            locked: true,
            weight: 1,
            reason: 'Actual BOQ',
          },
          {
            code: 'SRV',
            quantity: 1,
            locked: false,
            weight: 1,
            reason: 'User selected',
          },
        ],
      },
      3,
    );
    cli(db, [
      'cpq',
      'confirm',
      '--project-id',
      'P-TEST',
      '--confirmed-by',
      'Fixture user',
      '--expected-revision',
      '4',
      '--compact',
    ]);
    const solved = cli(db, [
      'cpq',
      'solve',
      '--project-id',
      'P-TEST',
      '--expected-revision',
      '5',
      '--compact',
    ]);
    assert.equal(solved.data.result.totalCost, 150);
    assert.equal(solved.data.result.lines[0].quantity, 1);
    assert.equal(solved.data.result.lines[1].quantity, 5);
    assert.ok(solved.bytes < 3000);
    assert.equal(solved.data.result.inputKey, undefined);
    const archive = cli(db, [
      'cpq',
      'archive',
      '--project-id',
      'P-TEST',
      '--expected-revision',
      '6',
      '--compact',
    ]);
    assert.ok(archive.bytes < 1000);
    assert.ok(archive.data.archiveId);
    const before = openWorkspaceRepository(db);
    const archived = before.get('P-TEST').workspace.cpq.archives;
    before.close();
    update('selections', { upsert: [{ code: 'SRV', quantity: 2 }] }, 7);
    const draft = cli(db, ['cpq', 'get', '--project-id', 'P-TEST']);
    assert.equal(draft.data.value.confirmationValid, false);
    assert.equal(draft.data.value.resultCurrent, false);
    const after = openWorkspaceRepository(db);
    assert.deepEqual(after.get('P-TEST').workspace.cpq.archives, archived);
    after.close();
    const exported = cli(db, [
      'cpq',
      'export',
      '--project-id',
      'P-TEST',
      '--archive-id',
      archive.data.archiveId,
      '--output',
      path.join(dir, 'cpq.xlsx'),
    ]);
    assert.ok(exported.data.artifact.sizeBytes > 0);
    cli(db, [
      'cost',
      'export',
      '--project-id',
      'P-TEST',
      '--version',
      'V1',
      '--output',
      path.join(dir, 'cost.xlsx'),
    ]);
    const deleted = cli(db, [
      'project',
      'delete',
      '--project-id',
      'P-TEST',
      '--expected-revision',
      '8',
    ]);
    assert.equal(deleted.data.deleted, true);
    assert.equal(cli(db, ['project', 'list']).data.items.length, 0);
    assert.equal(
      cli(db, ['project', 'list', '--deleted']).data.items[0].revision,
      9,
    );
    cli(db, [
      'project',
      'restore',
      '--project-id',
      'P-TEST',
      '--expected-revision',
      '9',
    ]);
    assert.equal(
      cli(db, ['project', 'get', '--project-id', 'P-TEST']).data.revision,
      10,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('already migrated databases do not deserialize unrelated project snapshots on CLI startup', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'narrow-startup-')),
    db = path.join(dir, 'db.sqlite');
  const repo = openWorkspaceRepository(db);
  repo.save('P-TEST', fixture(), null);
  repo.close();
  try {
    // A marker-carrying database is current; a header read must not parse payload.
    const raw = new DatabaseSync(db);
    raw
      .prepare('UPDATE workspace_snapshots SET payload_json=?')
      .run('{"unrelated":"header read does not migrate"}');
    raw.close();
    assert.equal(
      cli(db, ['project', 'list']).data.items[0].projectId,
      'P-TEST',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finalized costs allow master rate maintenance but preserve captured costs and quotation amounts', () => {
  const repo = setup();
  try {
    const receipt = updateResource(
      repo,
      'P-TEST',
      'cost',
      { section: 'settings' },
      { set: { state: 'Confirmed' } },
      1,
    );
    assert.match(receipt.costLockReason, /定稿/);
    const locked = repo.get('P-TEST');
    const quote = validatedQuoteInput(locked.workspace, 'Q-LOCK');
    const resource = locked.workspace.resourceTypes.find(
      (r) => r.id === locked.workspace.costRows[0].reTypeId,
    );
    const updated = updateResource(
      repo,
      'P-TEST',
      'masterdata',
      { tab: 'resources' },
      {
        upsert: [
          {
            id: resource.id,
            mandayRate: resource.mandayRate * 2,
            mandaysPerMonth: resource.mandaysPerMonth + 5,
            hoursPerManday: resource.hoursPerManday + 2,
          },
        ],
      },
      2,
    );
    assert.equal(updated.revision, 3);
    assert.match(updated.costLockReason, /定稿/);
    const refreshed = repo.get('P-TEST').workspace;
    assert.deepEqual(refreshed.costVersions, locked.workspace.costVersions);
    assert.deepEqual(refreshed.costRows, locked.workspace.costRows);
    assert.deepEqual(validatedQuoteInput(refreshed, 'Q-LOCK'), quote);
    assert.equal(
      refreshed.resourceTypes.find((r) => r.id === resource.id).mandayRate,
      resource.mandayRate * 2,
    );
    assert.throws(() => applyMasterRates(repo, 'P-TEST', 'V1', 3), /锁定/);
    assert.throws(
      () =>
        updateResource(
          repo,
          'P-TEST',
          'cost',
          { section: 'settings' },
          { set: { manualCosts: { riskContingency: 999 } } },
          3,
        ),
      /锁定/,
    );
    // The full-workspace UI save can also refresh the catalogue independently.
    const w = structuredClone(refreshed);
    w.resourceTypes[0].mandayRate += 1;
    repo.save('P-TEST', w, 3);
    assert.deepEqual(
      repo.get('P-TEST').workspace.costVersions,
      locked.workspace.costVersions,
    );
    w.costVersions[0].state = 'Draft';
    delete w.costVersionLocks;
    assert.throws(() => repo.save('P-TEST', w, 4), /锁定/);
    w.costVersions[0].state = 'Confirmed';
    w.costVersions[0].resourceTypes[0].mandayRate = 1;
    assert.throws(() => repo.save('P-TEST', w, 4), /锁定/);
    // Older clients cannot omit the captured rates to reimport the new catalogue.
    delete w.costVersions[0].resourceTypes;
    assert.throws(() => repo.save('P-TEST', w, 4), /锁定/);
    const costAssumptions = repo.get('P-TEST').workspace;
    costAssumptions.rateSettings.annualUplifts[0] += 10;
    assert.throws(() => repo.save('P-TEST', costAssumptions, 4), /锁定/);
    // Quote/T&C work can continue against the frozen cost base.
    updateResource(
      repo,
      'P-TEST',
      'quote',
      { section: 'settings' },
      { set: { pricing: { targetGrossMargin: 30 } } },
      4,
    );
    assert.deepEqual(
      repo.get('P-TEST').workspace.costVersions,
      locked.workspace.costVersions,
    );
  } finally {
    repo.close();
  }
});

test('confirmed costs remain locked after DRB completion and later workflow label resets', () => {
  const repo = setup();
  try {
    updateResource(
      repo,
      'P-TEST',
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      1,
    );
    const w = repo.get('P-TEST').workspace;
    const existing = w.processSteps.find((step) => step.code === 'DRB');
    const drb = existing || {
      ...w.processSteps[0],
      code: 'DRB',
      name: 'DRB Review',
      no: '99',
    };
    if (!existing) w.processSteps.push(drb);
    drb.state = 'completed';
    repo.save('P-TEST', w, 2);
    const locked = repo.get('P-TEST');
    assert.match(locked.workspace.costVersionLocks.V1.reason, /锁定/);
    assert.equal(locked.workspace.costVersions[0].state, 'Confirmed');
    const reset = structuredClone(locked.workspace);
    reset.processSteps.find((step) => step.code === 'DRB').state =
      'not_started';
    delete reset.costVersionLocks;
    repo.save('P-TEST', reset, 3);
    assert.deepEqual(
      repo.get('P-TEST').workspace.costVersionLocks.V1,
      locked.workspace.costVersionLocks.V1,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'P-TEST',
          'cost',
          { version: 'V1' },
          { remove: [w.costRows[0].id] },
          4,
        ),
      /锁定/,
    );
    const changed = repo.get('P-TEST').workspace;
    changed.resourceTypes[0].mandayRate += 1;
    repo.save('P-TEST', changed, 4);
    assert.deepEqual(
      repo.get('P-TEST').workspace.costVersions,
      locked.workspace.costVersions,
    );
    assert.equal(
      repo.get('P-TEST').workspace.costVersionLocks.V1.lockedAt,
      locked.workspace.costVersionLocks.V1.lockedAt,
    );
    assert.throws(() => applyMasterRates(repo, 'P-TEST', 'V1', 5), /锁定/);
  } finally {
    repo.close();
  }
});

for (const trigger of ['DRB', 'Confirmed']) {
  test(`CLI refreshes Resources after ${trigger} without changing calculated cost or unlocking cost writes`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'locked-master-rates-'));
    const db = path.join(dir, 'db.sqlite');
    const repo = openWorkspaceRepository(db);
    let before, initialRevision;
    try {
      const w = fixture();
      w.costVersions[0].state = 'Confirmed';
      let saved = repo.save('P-TEST', w, null);
      if (trigger === 'DRB') {
        const confirmed = saved.workspace;
        const existing = confirmed.processSteps.find(
          (step) => step.code === 'DRB',
        );
        const drb = existing || {
          ...confirmed.processSteps[0],
          code: 'DRB',
          name: 'DRB Review',
          no: '99',
        };
        if (!existing) confirmed.processSteps.push(drb);
        drb.state = 'completed';
        saved = repo.save('P-TEST', confirmed, saved.revision);
      }
      before = saved.workspace;
      initialRevision = saved.revision;
    } finally {
      repo.close();
    }
    try {
      const calculation = cli(db, [
        'cost',
        'calculate',
        '--project-id',
        'P-TEST',
      ]).data;
      const resource = before.resourceTypes.find(
        (r) => r.id === before.costRows[0].reTypeId,
      );
      const updated = cli(
        db,
        [
          'masterdata',
          'update',
          '--project-id',
          'P-TEST',
          '--tab',
          'resources',
          '--input',
          '-',
          '--expected-revision',
          String(initialRevision),
        ],
        { upsert: [{ id: resource.id, mandayRate: resource.mandayRate * 3 }] },
      );
      assert.equal(updated.data.revision, initialRevision + 1);
      assert.match(updated.data.costLockReason, /锁定/);
      const catalog = cli(db, [
        'masterdata',
        'get',
        '--project-id',
        'P-TEST',
        '--tab',
        'resources',
        '--id',
        resource.id,
      ]);
      assert.equal(catalog.data.items[0].mandayRate, resource.mandayRate * 3);
      const captured = cli(db, [
        'cost',
        'get',
        '--project-id',
        'P-TEST',
        '--section',
        'resources',
        '--id',
        resource.id,
      ]);
      assert.equal(captured.data.items[0].mandayRate, resource.mandayRate);
      assert.deepEqual(
        cli(db, ['cost', 'calculate', '--project-id', 'P-TEST']).data,
        calculation,
      );
      cli(
        db,
        [
          'cost',
          'apply-rates',
          '--project-id',
          'P-TEST',
          '--version',
          'V1',
          '--expected-revision',
          String(initialRevision + 1),
        ],
        undefined,
        6,
      );
      cli(
        db,
        [
          'cost',
          'update',
          '--project-id',
          'P-TEST',
          '--input',
          '-',
          '--expected-revision',
          String(initialRevision + 1),
        ],
        { upsert: [{ id: before.costRows[0].id, mdPerSite: 999 }] },
        6,
      );
      cli(
        db,
        [
          'cost',
          'update',
          '--project-id',
          'P-TEST',
          '--section',
          'settings',
          '--input',
          '-',
          '--expected-revision',
          String(initialRevision + 1),
        ],
        { set: { rateSettings: { annualUplifts: [99, 99, 99, 99, 99] } } },
        6,
      );
      const reopened = openWorkspaceRepository(db);
      try {
        const after = reopened.get('P-TEST');
        assert.equal(after.revision, initialRevision + 1);
        assert.deepEqual(after.workspace.costVersions, before.costVersions);
        assert.deepEqual(
          after.workspace.costVersionLocks,
          before.costVersionLocks,
        );
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('legacy lock wording no longer presents the master catalogue as locked', () => {
  const w = fixture();
  w.costLock = {
    reason: '成本已定稿（V1），项目成本及 RE 费率已锁定。',
    lockedAt: '2026-09-07T00:00:00.000Z',
  };
  assert.match(costLockReason(w), /V1.*该版本成本已锁定/);
  assert.equal(w.costLock.lockedAt, '2026-09-07T00:00:00.000Z');
});

test('DRB requires Confirmed cost and condition closure changes approval without repricing it', async () => {
  const {
    emptySsr,
    recordSubmission,
    recordReviewResult,
    closeCondition,
    commercialBasisKey,
    isApproved,
  } = await import('../features/ssr/domain.ts');
  const repo = setup();
  try {
    updateResource(
      repo,
      'P-TEST',
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      1,
    );
    let w = repo.get('P-TEST').workspace;
    const baseline = w.costVersions[0];
    let s = {
      ...emptySsr(),
      enabled: true,
      proposalNumber: 'P-DEMO',
      scopeBrief: 'Deployment',
      commercialBasis: commercialBasisKey(w),
    };
    const submit = (data, kind, target = baseline) =>
      recordSubmission(data, target, {
        kind,
        domain: '',
        owner: 'PM',
        dueDate: '2026-09-07',
        applicationNumber: kind + '-fixture',
        evidence: 'Company fixture record',
      });
    s = submit(s, 'DTRB');
    s = recordReviewResult(s, s.submissions.at(-1).id, {
      outcome: 'approved',
      evidence: 'DTRB fixture approved',
      conditions: [],
    });
    assert.throws(
      () => submit(s, 'DRB', { ...baseline, state: 'Draft' }),
      /Confirmed|确认成本/,
    );
    s = submit(s, 'DRB');
    const id = s.submissions.at(-1).id;
    s = recordReviewResult(s, id, {
      outcome: 'conditional',
      evidence: 'DRB fixture conditions',
      conditions: ['scope evidence'],
    });
    repo.save('P-TEST', { ...w, ssr: s }, 2);
    assert.match(
      readResource(repo, 'P-TEST', 'project').costLockReason,
      /定稿/,
    );
    assert.equal(
      isApproved(s.submissions.find((entry) => entry.id === id)),
      false,
    );
    assert.deepEqual(repo.get('P-TEST').workspace.costVersions[0], baseline);
    w = repo.get('P-TEST').workspace;
    s = closeCondition(w.ssr, id, 'scope evidence', 'Signed fixture closure');
    repo.save('P-TEST', { ...w, ssr: s }, 3);
    assert.equal(
      isApproved(s.submissions.find((entry) => entry.id === id)),
      true,
    );
    assert.match(
      readResource(repo, 'P-TEST', 'project').costLockReason,
      /锁定/,
    );
    assert.throws(() => applyMasterRates(repo, 'P-TEST', 'V1', 4), /锁定/);
    updateResource(
      repo,
      'P-TEST',
      'masterdata',
      { tab: 'resources' },
      {
        upsert: [
          {
            id: w.resourceTypes[0].id,
            mandayRate: w.resourceTypes[0].mandayRate * 2,
          },
        ],
      },
      4,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'P-TEST',
          'cost',
          { section: 'settings', version: 'V1' },
          { set: { manualCosts: { riskContingency: 999 } } },
          5,
        ),
      /锁定/,
    );
    const after = repo.get('P-TEST').workspace;
    assert.equal(after.costVersions[0].state, 'Confirmed');
    assert.deepEqual(after.costVersions[0], baseline);
    assert.deepEqual(after.costRows, w.costRows);
    assert.deepEqual(after.ssr.submissions, s.submissions);
  } finally {
    repo.close();
  }
});

test('target-only CPQ changes preserve user selection confirmation while discarding the old calculation', async () => {
  const { emptyCpq, confirmMapping } =
    await import('../features/cpq/domain.ts');
  const repo = setup();
  try {
    const w = repo.get('P-TEST').workspace;
    const cpq = emptyCpq();
    cpq.catalog = [
      {
        code: 'S',
        scope: 'service',
        unit: 'MD',
        unitCost: 10,
        kind: 'service',
        adjustable: true,
        active: true,
        step: 1,
        minQty: 0,
        maxQty: 100,
        referenceQty: 1,
        tags: 'service',
        revision: '1',
      },
    ];
    cpq.draft = {
      ...cpq.draft,
      brief: 'service',
      costVersion: 'V1',
      targetCost: 10,
      targetBasis: 'Fixture',
      selections: [
        {
          code: 'S',
          quantity: 1,
          locked: false,
          weight: 1,
          reason: 'User fixture',
        },
      ],
    };
    w.cpq = confirmMapping(cpq, 'Fixture user');
    repo.save('P-TEST', w, 1);
    updateResource(
      repo,
      'P-TEST',
      'cpq',
      { section: 'draft' },
      { set: { targetCost: 20 } },
      2,
    );
    const draft = readResource(repo, 'P-TEST', 'cpq');
    assert.equal(draft.section, 'draft');
    assert.equal(draft.value.confirmationValid, true);
    assert.equal(draft.value.resultCurrent, false);
  } finally {
    repo.close();
  }
});

test('compact SSR follow-up reports the actual targeted earlier submission', async () => {
  const { emptySsr, recordSubmission, recordReviewResult, commercialBasisKey } =
    await import('../features/ssr/domain.ts');
  const dir = mkdtempSync(path.join(tmpdir(), 'ssr-compact-')),
    db = path.join(dir, 'db.sqlite');
  const repo = openWorkspaceRepository(db);
  try {
    const initial = fixture();
    initial.costRows = [];
    initial.costVersions[0].state = 'Confirmed';
    const w = repo.save('P-TEST', initial, null).workspace;
    const b = w.costVersions[0];
    let s = {
      ...emptySsr(),
      enabled: true,
      proposalNumber: 'P',
      scopeBrief: 'Scope',
      commercialBasis: commercialBasisKey(w),
    };
    const submit = (kind) => {
      s = recordSubmission(s, b, {
        kind,
        domain: '',
        owner: 'PM',
        dueDate: '2026-09-07',
        applicationNumber: kind,
        evidence: 'Fixture',
      });
    };
    submit('DTRB');
    const id = s.submissions[0].id;
    s = recordReviewResult(s, id, {
      outcome: 'approved',
      evidence: 'Fixture approved',
      conditions: [],
    });
    submit('DRB');
    w.ssr = s;
    repo.save('P-TEST', w, 1);
    const response = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        'ssr',
        'followup',
        '--project-id',
        'P-TEST',
        '--input',
        '-',
        '--expected-revision',
        '2',
        '--compact',
        '--db',
        db,
      ],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'target-test',
          data: {
            schemaVersion: '1.0.0',
            operation: 'ssr.followup',
            submissionId: id,
            note: 'Fixture follow up',
            nextDate: '2026-09-08',
          },
        }),
      },
    );
    assert.equal(response.status, 0, response.stdout);
    const output = JSON.parse(response.stdout);
    assert.ok(validate(output));
    assert.equal(output.data.submissionId, id);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale inactive CPQ selections remain readable and repairable through narrow commands', async () => {
  const { emptyCpq, confirmMapping } =
    await import('../features/cpq/domain.ts');
  const repo = setup();
  try {
    const w = repo.get('P-TEST').workspace,
      cpq = emptyCpq();
    cpq.catalog = [
      {
        code: 'S',
        scope: 'Service',
        unit: 'MD',
        unitCost: 10,
        kind: 'service',
        adjustable: true,
        active: true,
        step: 1,
        minQty: 0,
        maxQty: 100,
        referenceQty: 1,
        tags: 'service',
        revision: '1',
      },
    ];
    cpq.draft = {
      ...cpq.draft,
      brief: 'Service',
      costVersion: 'V1',
      targetCost: 10,
      targetBasis: 'Fixture',
      selections: [
        {
          code: 'S',
          quantity: 1,
          locked: false,
          weight: 1,
          reason: 'Fixture selected',
        },
      ],
    };
    w.cpq = confirmMapping(cpq, 'Fixture user');
    repo.save('P-TEST', w, 1);
    const legacy = repo.get('P-TEST').workspace;
    legacy.cpq.catalog[0].active = false;
    repo.save('P-TEST', legacy, 2);
    const read = readResource(repo, 'P-TEST', 'cpq');
    assert.equal(read.value.confirmationValid, false);
    assert.equal(read.value.resultCurrent, false);
    assert.match(read.value.mappingIssue, /inactive/);
    updateResource(
      repo,
      'P-TEST',
      'cpq',
      { section: 'selections' },
      { remove: ['S'] },
      3,
    );
    assert.deepEqual(
      readResource(repo, 'P-TEST', 'cpq', { section: 'selections' }).items,
      [],
    );
  } finally {
    repo.close();
  }
});
