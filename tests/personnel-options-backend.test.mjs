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
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  applyCapturedResourceRates,
  captureResourceRates,
} from '../features/master-data/capture.ts';
import { YEAR_BUCKETS } from '../features/cost/domain.ts';

const fixture = (legacy = false) => {
  const w = createBlankWorkspace(
    projectRecord('OPTIONS', 'Personnel options', 'Client'),
    'input_preparation',
  );
  const resources = w.resourceTypes.map((resource) => ({
    ...resource,
    mandayRate: resource.category === 'internal' ? 100 : 0,
    mandaysPerMonth: 20,
  }));
  resources.push({
    ...resources.find((resource) => resource.pool === 'LOCAL'),
    id: 'rt-other-l1',
    code: 'OTHER-L1',
    name: 'Remote support',
    pool: 'OTHER',
  });
  w.resourceTypes = structuredClone(resources);
  w.costVersions[0].resourceTypes = structuredClone(resources);
  w.rateSettings = {
    ...w.rateSettings,
    tdStart: '2026-01-01',
    tdEnd: '2030-12-31',
    baseYear: 2026,
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
  };
  w.travelSettings = {
    ...w.travelSettings,
    monthlyAllowance: 100,
    airfarePerTrip: 50,
    trips: 2,
  };
  if (legacy) {
    delete w.rateSettings.allowancePools;
    delete w.rateSettings.allowanceResourceTypeIds;
    w.rateSettings.localArpAllowanceEnabled = true;
    delete w.travelSettings.enabled;
  }
  w.costRows = ['HQ', 'LOCAL', 'ARP', 'OTHER'].map((pool) => ({
    id: `ROW-${pool}`,
    scope: `${pool} support`,
    bu: 'Services',
    reTypeId: resources.find((resource) => resource.pool === pool).id,
    inputMode: 'mandays',
    mdPerSite: 0,
    years: YEAR_BUCKETS.map((bucket, index) => ({
      bucket,
      sites: 0,
      mandays: index === 0 ? 10 : 0,
      cost: 0,
    })),
  }));
  return w;
};
const setup = (legacy = false, filename = ':memory:') => {
  const repo = openWorkspaceRepository(filename);
  repo.save('OPTIONS', fixture(legacy), null);
  return repo;
};
const update = (repo, set, version = 'V1') =>
  updateResource(
    repo,
    'OPTIONS',
    'cost',
    { section: 'settings', version },
    { set },
    repo.get('OPTIONS').revision,
  );
const summary = (repo, version = 'V1') =>
  readResource(repo, 'OPTIONS', 'cost', { section: 'summary', version }).value;

const setupWithLocalLevels = () => {
  const w = fixture();
  const local = w.resourceTypes.find((resource) => resource.pool === 'LOCAL');
  const second = {
    ...local,
    id: 'rt-local-additional-level',
    code: 'LOCAL-EXTRA',
    level: 'L2',
    name: 'Additional local level',
  };
  w.resourceTypes.push(second);
  w.costVersions[0].resourceTypes.push(structuredClone(second));
  w.costRows.push({
    ...structuredClone(w.costRows.find((row) => row.id === 'ROW-LOCAL')),
    id: 'ROW-LOCAL-EXTRA',
    reTypeId: second.id,
  });
  const repo = openWorkspaceRepository(':memory:');
  repo.save('OPTIONS', w, null);
  return repo;
};

test('Pool selections include every personnel level and override legacy selectors without changing rates or travel', () => {
  const repo = setupWithLocalLevels();
  try {
    const before = repo.get('OPTIONS').workspace;
    update(repo, {
      rateSettings: {
        allowancePools: ['LOCAL'],
        allowanceResourceTypeIds: ['retired-resource-id'],
        localArpAllowanceEnabled: true,
      },
    });
    let w = repo.get('OPTIONS').workspace;
    assert.deepEqual(
      w.costRows.map((row) => row.years[0].cost),
      [1000, 1030, 1000, 1000, 1030],
    );
    assert.equal(summary(repo).inHouseLabour, 5060);
    assert.equal(summary(repo).travel, 0);
    assert.deepEqual(w.resourceTypes, before.resourceTypes);
    update(repo, { rateSettings: { allowancePools: ['HQ', 'ARP', 'OTHER'] } });
    assert.equal(summary(repo).inHouseLabour, 5090);
    update(repo, { rateSettings: { allowancePools: [] } });
    w = repo.get('OPTIONS').workspace;
    assert.equal(summary(repo).inHouseLabour, 5000);
    assert.deepEqual(w.rateSettings.allowanceResourceTypeIds, [
      'retired-resource-id',
    ]);
    assert.equal(w.rateSettings.localArpAllowanceEnabled, true);
    assert.equal(summary(repo).travel, 0);
  } finally {
    repo.close();
  }
});

test('narrow legacy selectors unmask Pool settings and preserve exact individual selections', () => {
  const repo = setupWithLocalLevels();
  try {
    const localId = repo
      .get('OPTIONS')
      .workspace.costRows.find((row) => row.id === 'ROW-LOCAL').reTypeId;
    update(repo, { rateSettings: { allowancePools: ['LOCAL'] } });
    assert.equal(summary(repo).inHouseLabour, 5060);
    update(repo, { rateSettings: { allowanceResourceTypeIds: [localId] } });
    let settings = readResource(repo, 'OPTIONS', 'cost', {
      section: 'settings',
    }).value.rateSettings;
    assert.equal(Object.hasOwn(settings, 'allowancePools'), false);
    assert.deepEqual(settings.allowanceResourceTypeIds, [localId]);
    assert.equal(summary(repo).inHouseLabour, 5030);
    update(repo, { rateSettings: { localArpAllowanceEnabled: true } });
    settings = repo.get('OPTIONS').workspace.rateSettings;
    assert.deepEqual(settings.allowancePools, ['LOCAL', 'ARP']);
    assert.equal(summary(repo).inHouseLabour, 5090);
    update(repo, { rateSettings: { localArpAllowanceEnabled: false } });
    assert.deepEqual(
      repo.get('OPTIONS').workspace.rateSettings.allowancePools,
      [],
    );
    assert.equal(summary(repo).inHouseLabour, 5000);
    update(repo, {
      rateSettings: {
        allowancePools: ['HQ'],
        allowanceResourceTypeIds: [],
        localArpAllowanceEnabled: false,
      },
    });
    assert.equal(summary(repo).inHouseLabour, 5030);
  } finally {
    repo.close();
  }
});

test('invalid Pool selectors are rejected atomically through narrow and full saves', () => {
  const repo = setup();
  try {
    const before = repo.get('OPTIONS');
    for (const pools of [
      'LOCAL',
      null,
      ['LOCAL', 'LOCAL'],
      ['SUBCON'],
      ['local'],
      [12],
      ['LOCAL', 'ARP', 'HQ', 'OTHER', 'LOCAL'],
    ]) {
      assert.throws(() =>
        update(repo, { rateSettings: { allowancePools: pools } }),
      );
      assert.deepEqual(repo.get('OPTIONS'), before);
    }
    const full = structuredClone(before.workspace);
    full.rateSettings.allowancePools = ['INVALID'];
    assert.throws(() => repo.save('OPTIONS', full, before.revision));
    assert.deepEqual(repo.get('OPTIONS'), before);
  } finally {
    repo.close();
  }
});

test('historical sparse ID selections survive clone and Pool edits affect only their unlocked target version', () => {
  const repo = setupWithLocalLevels();
  try {
    const localId = repo
      .get('OPTIONS')
      .workspace.costRows.find((row) => row.id === 'ROW-LOCAL').reTypeId;
    update(repo, { rateSettings: { allowanceResourceTypeIds: [localId] } });
    assert.equal(summary(repo).inHouseLabour, 5030);
    update(repo, { state: 'Confirmed' });
    const locked = repo.get('OPTIONS');
    assert.throws(
      () => update(repo, { rateSettings: { allowancePools: ['LOCAL'] } }),
      /锁定/,
    );
    const forbidden = structuredClone(locked.workspace);
    forbidden.rateSettings.allowancePools = [];
    assert.throws(
      () => repo.save('OPTIONS', forbidden, locked.revision),
      /锁定/,
    );
    createCostDraft(
      repo,
      'OPTIONS',
      { mode: 'clone', sourceVersion: 'V1' },
      locked.revision,
    );
    let w = repo.get('OPTIONS').workspace;
    assert.equal(Object.hasOwn(w.rateSettings, 'allowancePools'), false);
    assert.deepEqual(w.rateSettings.allowanceResourceTypeIds, [localId]);
    assert.equal(summary(repo, 'V2').inHouseLabour, 5030);
    createCostDraft(
      repo,
      'OPTIONS',
      { mode: 'blank' },
      repo.get('OPTIONS').revision,
    );
    const active = repo.get('OPTIONS').workspace;
    update(repo, { rateSettings: { allowancePools: ['LOCAL'] } }, 'V2');
    w = repo.get('OPTIONS').workspace;
    assert.equal(summary(repo, 'V2').inHouseLabour, 5060);
    assert.equal(summary(repo, 'V1').inHouseLabour, 5030);
    assert.deepEqual(w.costVersions[0], locked.workspace.costVersions[0]);
    assert.deepEqual(w.rateSettings, active.rateSettings);
    assert.deepEqual(w.costRows, active.costRows);
    assert.equal(summary(repo, 'V3').inHouseLabour, 0);
  } finally {
    repo.close();
  }
});

test('new project and blank-version options default off while personnel IDs and travel opt-in change only targeted costs', () => {
  const repo = setup();
  try {
    createProject(repo, { id: 'NEW', name: 'New project', client: 'Client' });
    const created = repo.get('NEW').workspace;
    assert.deepEqual(created.rateSettings.allowanceResourceTypeIds, []);
    assert.deepEqual(created.rateSettings.allowancePools, []);
    assert.equal(created.travelSettings.enabled, false);
    assert.equal(summary(repo).inHouseLabour, 4000);
    assert.equal(summary(repo).travel, 0);
    const initial = repo.get('OPTIONS').workspace;
    update(repo, {
      rateSettings: { allowanceResourceTypeIds: ['rt-hq-l1', 'rt-other-l1'] },
      travelSettings: { enabled: true },
    });
    const after = repo.get('OPTIONS').workspace;
    assert.deepEqual(
      after.costRows.map((row) => row.years[0].cost),
      [1030, 1000, 1000, 1030],
    );
    assert.equal(summary(repo).travel, 150);
    assert.equal(summary(repo).totalWithRisk, 4210);
    assert.deepEqual(after.resourceTypes, initial.resourceTypes);
    assert.deepEqual(
      after.costRows.map((row) => row.years.map((year) => year.mandays)),
      initial.costRows.map((row) => row.years.map((year) => year.mandays)),
    );
    update(repo, { travelSettings: { enabled: false } });
    assert.equal(summary(repo).travel, 0);
    assert.equal(
      repo.get('OPTIONS').workspace.travelSettings.monthlyAllowance,
      100,
    );
    createCostDraft(
      repo,
      'OPTIONS',
      { mode: 'blank' },
      repo.get('OPTIONS').revision,
    );
    const blank = repo.get('OPTIONS').workspace;
    assert.deepEqual(blank.rateSettings.allowanceResourceTypeIds, []);
    assert.deepEqual(blank.rateSettings.allowancePools, []);
    assert.equal(blank.travelSettings.enabled, false);
    assert.equal(summary(repo, 'V1').inHouseLabour, 4060);
  } finally {
    repo.close();
  }
});

test('legacy narrow flag patches expand captured LOCAL/ARP IDs; explicit ID selection is authoritative even empty', () => {
  const repo = setup();
  try {
    update(repo, { rateSettings: { localArpAllowanceEnabled: true } });
    let w = repo.get('OPTIONS').workspace;
    assert.deepEqual(
      w.rateSettings.allowanceResourceTypeIds,
      w.costVersions[0].resourceTypes
        .filter(
          (resource) =>
            resource.category === 'internal' &&
            ['LOCAL', 'ARP'].includes(resource.pool),
        )
        .map((resource) => resource.id),
    );
    assert.equal(summary(repo).inHouseLabour, 4060);
    update(repo, {
      rateSettings: {
        localArpAllowanceEnabled: true,
        allowanceResourceTypeIds: ['rt-hq-l1'],
      },
    });
    assert.equal(summary(repo).inHouseLabour, 4030);
    update(repo, {
      rateSettings: {
        localArpAllowanceEnabled: true,
        allowanceResourceTypeIds: [],
      },
    });
    assert.equal(summary(repo).inHouseLabour, 4000);
    update(repo, { rateSettings: { localArpAllowanceEnabled: false } });
    w = repo.get('OPTIONS').workspace;
    assert.deepEqual(w.rateSettings.allowanceResourceTypeIds, []);
    assert.equal(summary(repo).inHouseLabour, 4000);
  } finally {
    repo.close();
  }
});

test('invalid option types, unknown/subcontract IDs and duplicates fail atomically', () => {
  const repo = setup();
  try {
    const before = repo.get('OPTIONS');
    for (const set of [
      { rateSettings: { allowanceResourceTypeIds: 'rt-hq-l1' } },
      { rateSettings: { allowanceResourceTypeIds: null } },
      { rateSettings: { allowanceResourceTypeIds: ['missing'] } },
      { rateSettings: { allowanceResourceTypeIds: ['rt-subcon'] } },
      { rateSettings: { allowanceResourceTypeIds: ['rt-hq-l1', 'rt-hq-l1'] } },
      { rateSettings: { allowanceResourceTypeIds: [12] } },
      { rateSettings: { localArpAllowanceEnabled: 'true' } },
      { travelSettings: { enabled: 'true' } },
      { travelSettings: { enabled: null } },
    ]) {
      assert.throws(() => update(repo, set));
      assert.deepEqual(repo.get('OPTIONS'), before);
    }
    const full = structuredClone(before.workspace);
    delete full.costVersions[0].rateSettings.allowancePools;
    full.costVersions[0].rateSettings.allowanceResourceTypeIds = ['missing'];
    assert.throws(() => repo.save('OPTIONS', full, before.revision));
    assert.deepEqual(repo.get('OPTIONS'), before);
  } finally {
    repo.close();
  }
});

test('legacy absence is preserved on clone; locked settings reject writes and inactive drafts stay independent', () => {
  const repo = setup(true);
  try {
    assert.equal(summary(repo).inHouseLabour, 4060);
    assert.equal(summary(repo).travel, 150);
    update(repo, { state: 'Confirmed' });
    const before = repo.get('OPTIONS');
    for (const set of [
      { rateSettings: { allowanceResourceTypeIds: [] } },
      { rateSettings: { localArpAllowanceEnabled: false } },
      { travelSettings: { enabled: false } },
    ])
      assert.throws(() => update(repo, set), /锁定/);
    const full = structuredClone(before.workspace);
    full.travelSettings.enabled = false;
    assert.throws(() => repo.save('OPTIONS', full, before.revision), /锁定/);
    assert.deepEqual(repo.get('OPTIONS'), before);
    createCostDraft(
      repo,
      'OPTIONS',
      { mode: 'clone', sourceVersion: 'V1' },
      before.revision,
    );
    let w = repo.get('OPTIONS').workspace;
    assert.equal(w.rateSettings.allowanceResourceTypeIds, undefined);
    assert.equal(w.travelSettings.enabled, undefined);
    assert.equal(
      summary(repo, 'V2').totalWithRisk,
      summary(repo, 'V1').totalWithRisk,
    );
    createCostDraft(
      repo,
      'OPTIONS',
      { mode: 'blank' },
      repo.get('OPTIONS').revision,
    );
    update(
      repo,
      {
        rateSettings: { allowanceResourceTypeIds: ['rt-other-l1'] },
        travelSettings: { enabled: false },
      },
      'V2',
    );
    w = repo.get('OPTIONS').workspace;
    assert.equal(summary(repo, 'V2').inHouseLabour, 4030);
    assert.equal(summary(repo, 'V2').travel, 0);
    assert.deepEqual(w.costVersions[0], before.workspace.costVersions[0]);
    assert.deepEqual(w.rateSettings.allowanceResourceTypeIds, []);
    assert.equal(w.travelSettings.enabled, false);
  } finally {
    repo.close();
  }
});

test('applying updated rate IDs remaps selected allowance identities by code and rejects disappearing selections', () => {
  const repo = setup();
  try {
    update(repo, { rateSettings: { allowanceResourceTypeIds: ['rt-hq-l1'] } });
    const before = repo.get('OPTIONS').workspace.costVersions[0];
    const items = structuredClone(before.resourceTypes);
    items.find((resource) => resource.id === 'rt-hq-l1').id = 'new-hq-id';
    const applied = captureResourceRates(before, {
      tab: 'resources',
      revision: 2,
      items,
      conflicts: [],
    });
    assert.deepEqual(applied.rateSettings.allowanceResourceTypeIds, [
      'new-hq-id',
    ]);
    assert.equal(applied.costRows[0].reTypeId, 'new-hq-id');
    assert.equal(applied.costRows[0].years[0].cost, 1030);
    assert.deepEqual(before.rateSettings.allowanceResourceTypeIds, [
      'rt-hq-l1',
    ]);
    assert.throws(
      () =>
        captureResourceRates(before, {
          tab: 'resources',
          revision: 2,
          items: items.filter((resource) => resource.id !== 'new-hq-id'),
          conflicts: [],
        }),
      /Allowance RE Type/,
    );
  } finally {
    repo.close();
  }
});

test('CLI settings option patches and calculation output retain narrow contracts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personnel-options-'));
  const filename = path.join(dir, 'workbench.sqlite');
  const repo = setup(false, filename);
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
              requestId: 'personnel-options',
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
    const receipt = cli(
      [
        'cost',
        'update',
        '--project-id',
        'OPTIONS',
        '--version',
        'V1',
        '--section',
        'settings',
        '--input',
        '-',
        '--expected-revision',
        '1',
      ],
      {
        set: {
          rateSettings: { allowanceResourceTypeIds: ['rt-hq-l1'] },
          travelSettings: { enabled: true },
        },
      },
    );
    assert.equal(receipt.workspace, undefined);
    const result = cli([
      'cost',
      'calculate',
      '--project-id',
      'OPTIONS',
      '--version',
      'V1',
    ]);
    assert.equal(result.totals.inHouseLabour, 4030);
    assert.equal(result.hqTravel.enabled, true);
    assert.equal(result.hqTravel.totalCost, 150);
    const current = cli([
      'cost',
      'get',
      '--project-id',
      'OPTIONS',
      '--section',
      'settings',
    ]);
    assert.deepEqual(current.value.rateSettings.allowanceResourceTypeIds, [
      'rt-hq-l1',
    ]);
    assert.equal(current.value.travelSettings.enabled, true);
    cli(
      [
        'cost',
        'update',
        '--project-id',
        'OPTIONS',
        '--version',
        'V1',
        '--section',
        'settings',
        '--input',
        '-',
        '--expected-revision',
        '2',
      ],
      { set: { rateSettings: { allowancePools: ['LOCAL', 'OTHER'] } } },
    );
    const pooled = cli([
      'cost',
      'calculate',
      '--project-id',
      'OPTIONS',
      '--version',
      'V1',
    ]);
    assert.equal(pooled.totals.inHouseLabour, 4060);
    assert.equal(pooled.hqTravel.totalCost, 150);
    const pooledSettings = cli([
      'cost',
      'get',
      '--project-id',
      'OPTIONS',
      '--section',
      'settings',
    ]);
    assert.deepEqual(pooledSettings.value.rateSettings.allowancePools, [
      'LOCAL',
      'OTHER',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const allowanceMode of ['legacy-ids', 'pools'])
  for (const targetKind of ['active', 'inactive'])
    test(`UI Apply Rates saves ${allowanceMode} for an ${targetKind} version without altering the other snapshot`, () => {
      const repo = setup();
      try {
        update(repo, {
          rateSettings: {
            allowanceResourceTypeIds: ['rt-hq-l1'],
            ...(allowanceMode === 'pools' ? { allowancePools: ['HQ'] } : {}),
          },
        });
        createCostDraft(
          repo,
          'OPTIONS',
          { mode: 'clone', sourceVersion: 'V1' },
          repo.get('OPTIONS').revision,
        );
        const before = repo.get('OPTIONS');
        const code = targetKind === 'active' ? 'V2' : 'V1';
        const otherCode = targetKind === 'active' ? 'V1' : 'V2';
        const target = before.workspace.costVersions.find(
          (version) => version.code === code,
        );
        const other = structuredClone(
          before.workspace.costVersions.find(
            (version) => version.code === otherCode,
          ),
        );
        const items = structuredClone(target.resourceTypes);
        const changed = items.find((resource) => resource.id === 'rt-hq-l1');
        changed.id = 'updated-hq-id';
        changed.mandayRate = 250;
        const captured = captureResourceRates(target, {
          tab: 'resources',
          revision: 2,
          items,
          conflicts: [],
        });
        const next = applyCapturedResourceRates(before.workspace, captured);
        const saved = repo.save('OPTIONS', next, before.revision).workspace;
        const version = saved.costVersions.find((entry) => entry.code === code);
        assert.deepEqual(version.rateSettings.allowanceResourceTypeIds, [
          allowanceMode === 'legacy-ids' ? 'updated-hq-id' : 'rt-hq-l1',
        ]);
        assert.deepEqual(
          version.rateSettings.allowancePools,
          allowanceMode === 'pools' ? ['HQ'] : undefined,
        );
        assert.equal(version.costRows[0].reTypeId, 'updated-hq-id');
        assert.equal(version.costRows[0].years[0].cost, 2575);
        assert.deepEqual(
          saved.costVersions.find((entry) => entry.code === otherCode),
          other,
        );
        assert.deepEqual(saved.resourceTypes, before.workspace.resourceTypes);
        if (targetKind === 'active') {
          assert.deepEqual(saved.rateSettings, version.rateSettings);
          assert.deepEqual(saved.costRows, version.costRows);
        } else {
          assert.deepEqual(saved.rateSettings, before.workspace.rateSettings);
          assert.deepEqual(saved.costRows, before.workspace.costRows);
        }
        assert.deepEqual(target.rateSettings.allowanceResourceTypeIds, [
          'rt-hq-l1',
        ]);
        assert.equal(target.costRows[0].years[0].cost, 1030);
        assert.throws(
          () =>
            applyCapturedResourceRates(before.workspace, {
              ...captured,
              code: 'V999',
            }),
          /does not exist/,
        );
      } finally {
        repo.close();
      }
    });
