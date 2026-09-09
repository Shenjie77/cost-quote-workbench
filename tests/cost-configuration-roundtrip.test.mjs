import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { updateResource } from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { makeCostSnapshot } from './helpers.mjs';

test('saved allowance, HQ travel, annual quantities, row order and groups survive a database reopen', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'cost-configuration-'));
  const database = path.join(directory, 'workspace.sqlite');
  let repository = openWorkspaceRepository(database);
  const id = 'P-CONFIGURATION';
  try {
    const snapshot = makeCostSnapshot();
    const workspace = createBlankWorkspace(
      projectRecord(id, 'Configuration', 'Fixture'),
      'input_preparation',
    );
    Object.assign(workspace, {
      costRows: snapshot.costRows.filter(
        (row) =>
          snapshot.resourceTypes.find((re) => re.id === row.reTypeId)
            ?.category === 'internal',
      ),
      rateSettings: snapshot.rateSettings,
      resourceTypes: snapshot.resourceTypes,
      travelSettings: snapshot.travelSettings,
      manualCosts: snapshot.manualCosts,
    });
    repository.save(id, workspace, null);
    const update = (section, changes) =>
      updateResource(
        repository,
        id,
        'cost',
        { section, version: 'V1' },
        changes,
        repository.get(id).revision,
      );
    update('settings', {
      set: {
        rateSettings: {
          allowancePools: ['LOCAL', 'HQ'],
          annualUplifts: [0.01, 0.02, 0.03, 0.04, 0.05],
        },
        travelSettings: {
          enabled: true,
          monthlyAllowance: 1800,
          airfarePerTrip: 750,
          trips: 3,
        },
      },
    });
    const initial = repository.get(id).workspace.costRows;
    const order = initial.map((row) => row.id).reverse();
    const edited = initial[0];
    update('rows', {
      upsert: [
        {
          id: edited.id,
          groupName: 'Network Design',
          inputMode: 'mandays',
          mdPerSite: 0,
          years: edited.years.map((year, index) => ({
            ...year,
            mandays: index === 2 ? 7 : 0,
            sites: 0,
          })),
        },
      ],
      order,
    });
    const saved = structuredClone(repository.get(id).workspace);
    assert.deepEqual(saved.rateSettings.allowancePools, ['LOCAL', 'HQ']);
    assert.equal(saved.travelSettings.enabled, true);
    assert.equal(saved.travelSettings.airfarePerTrip, 750);
    assert.deepEqual(
      saved.costRows.map((row) => row.id),
      order,
    );
    assert.equal(
      saved.costRows.find((row) => row.id === edited.id).years[2].mandays,
      7,
    );
    repository.close();
    repository = openWorkspaceRepository(database);
    const restored = repository.get(id).workspace;
    for (const key of [
      'rateSettings',
      'travelSettings',
      'costRows',
      'manualCosts',
    ]) {
      assert.deepEqual(restored[key], saved[key]);
      assert.deepEqual(
        restored.costVersions.find((version) => version.code === 'V1')[key],
        saved[key],
      );
    }
    assert.equal(
      restored.costRows.find((row) => row.id === edited.id).groupName,
      'Network Design',
    );
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
