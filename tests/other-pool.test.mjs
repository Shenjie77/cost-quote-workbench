import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  getHQTravelSummary,
  recalculateCostRows,
} from '../features/cost/domain.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import {
  createResourceType,
  editResourceType,
  resourceClassificationIssue,
} from '../features/master-data/resource-editing.ts';
import { captureResourceRates } from '../features/master-data/capture.ts';
import { createCostVersion } from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  createCostDraft,
} from '../server/workspace-resources.mjs';
import { makeCostSnapshot } from './helpers.mjs';

const remoteResource = () => ({
  ...createResourceType('rt-remote', 'REMOTE', '2026-01-01'),
  name: 'Remote Support',
  pool: 'OTHER',
  mandayRate: 100,
});

const remoteSnapshot = () => {
  const snapshot = makeCostSnapshot();
  snapshot.resourceTypes = [remoteResource()];
  snapshot.rateSettings = {
    ...snapshot.rateSettings,
    baseYear: 2026,
    tdStart: '2026-01-01',
    tdEnd: '2030-12-31',
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
    localArpAllowanceEnabled: true,
  };
  snapshot.travelSettings = {
    monthlyAllowance: 2000,
    airfarePerTrip: 1000,
    trips: 5,
  };
  snapshot.costRows = [
    {
      id: 'remote-row',
      scope: 'Remote support',
      bu: 'Delivery',
      reTypeId: 'rt-remote',
      inputMode: 'mandays',
      mdPerSite: 0,
      years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket, index) => ({
        bucket,
        sites: 0,
        mandays: index + 1,
        cost: 0,
      })),
    },
  ];
  snapshot.costRows = recalculateCostRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.rateSettings,
  );
  return snapshot;
};

test('OTHER uses its normal rate in all five years with neither 3% allowance nor HQ travel', () => {
  const snapshot = remoteSnapshot();
  assert.deepEqual(
    snapshot.costRows[0].years.map((year) => year.cost),
    [100, 200, 300, 400, 500],
  );
  assert.deepEqual(
    recalculateCostRows(snapshot.costRows, snapshot.resourceTypes, {
      ...snapshot.rateSettings,
      localArpAllowanceEnabled: false,
    }),
    snapshot.costRows,
  );
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  assert.equal(travel.hqMandays, 0);
  assert.equal(travel.totalCost, 0);
  assert.equal(travel.required, false);

  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(
      readFileSync(
        new URL('../schemas/cost-export.schema.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  assert.ok(validate(snapshot), JSON.stringify(validate.errors));
  assert.deepEqual(
    validateCostExportSnapshot(snapshot).filter(
      (issue) => issue.severity === 'error',
    ),
    [],
  );
});

test('changing HQ to OTHER clears HQ travel while retaining RE identity, level and price', () => {
  const hq = { ...remoteResource(), pool: 'HQ', level: 'L3', hqTravel: true };
  const before = structuredClone(hq);
  const other = editResourceType(hq, 'pool', 'OTHER');
  assert.deepEqual(other, { ...hq, pool: 'OTHER', hqTravel: false });
  assert.equal(resourceClassificationIssue(other), null);
  assert.deepEqual(hq, before);
});

test('global master data accepts OTHER for future projects and clones but rejects an HQ-travel override', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const initial = repo.globalMasterData.get('resources');
    repo.globalMasterData.update(
      'resources',
      { upsert: [remoteResource()] },
      initial.revision,
    );
    const saved = repo.globalMasterData.get('resources');
    assert.deepEqual(
      saved.items.find((r) => r.id === 'rt-remote'),
      remoteResource(),
    );
    assert.throws(
      () =>
        repo.globalMasterData.update(
          'resources',
          {
            upsert: [{ id: 'rt-remote', hqTravel: true }],
          },
          saved.revision,
        ),
      /HQ travel applies only to HQ/,
    );
    assert.deepEqual(repo.globalMasterData.get('resources'), saved);

    createProject(repo, {
      id: 'P-REMOTE',
      name: 'Remote Fixture',
      client: 'Fixture',
    });
    const project = repo.get('P-REMOTE');
    assert.deepEqual(
      project.workspace.costVersions[0].resourceTypes.find(
        (r) => r.id === 'rt-remote',
      ),
      remoteResource(),
    );
    createCostDraft(
      repo,
      'P-REMOTE',
      { mode: 'clone', sourceVersion: 'V1' },
      project.revision,
    );
    const versions = repo.get('P-REMOTE').workspace.costVersions;
    assert.deepEqual(versions[0], project.workspace.costVersions[0]);
    assert.deepEqual(versions[1].resourceTypes, versions[0].resourceTypes);
  } finally {
    repo.close();
  }
});

test('explicit master-rate capture retains OTHER rules and leaves the previous cost snapshot untouched', () => {
  const snapshot = remoteSnapshot();
  const version = createCostVersion('V1', 'Draft', null, {
    ...snapshot,
    travelRows: [],
    travelUplift: 0,
  });
  const before = structuredClone(version);
  const updated = { ...remoteResource(), id: 'rt-remote-new', mandayRate: 200 };
  const next = captureResourceRates(version, {
    tab: 'resources',
    revision: 42,
    items: [updated],
    conflicts: [],
  });
  assert.deepEqual(next.resourceTypes, [updated]);
  assert.equal(next.masterDataRevision, 42);
  assert.equal(next.costRows[0].reTypeId, 'rt-remote-new');
  assert.deepEqual(
    next.costRows[0].years.map((year) => year.cost),
    [200, 400, 600, 800, 1000],
  );
  assert.equal(
    getHQTravelSummary(next.costRows, next.resourceTypes, next.travelSettings)
      .totalCost,
    0,
  );
  assert.deepEqual(version, before);
});
