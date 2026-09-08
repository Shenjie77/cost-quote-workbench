import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  updateResource,
} from '../server/workspace-resources.mjs';
import { costLockReason } from '../features/cost/cost-lock.ts';

const item = (id = 'SUB-ROUTER') => ({
  id,
  code: id,
  item: 'Installation Cisco 2u router',
  bu: 'Infrastructure',
  currency: 'SGD',
  active: true,
});

test('subcontract reference prices work without supplier and distinguish unpriced from free items', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const store = repo.globalMasterData;
    const before = store.get('subcontract');
    const saved = store.update(
      'subcontract',
      {
        upsert: [
          { ...item(), unit: 'pcs', unitPrice: 200 },
          { ...item('SUB-FREE'), unit: 'pcs', unitPrice: 0 },
          item('SUB-UNPRICED'),
          {
            ...item('SUB-LEGACY'),
            supplier: 'Historic supplier',
            pricingBasis: 'Per unit',
          },
        ],
      },
      before.revision,
    );
    assert.equal(saved.revision, before.revision + 1);
    const priced = store.get('subcontract', { id: 'SUB-ROUTER' }).items[0];
    assert.equal(priced.unit, 'pcs');
    assert.equal(priced.unitPrice, 200);
    assert.equal(Object.hasOwn(priced, 'supplier'), false);
    assert.equal(Object.hasOwn(priced, 'pricingBasis'), false);
    assert.equal(
      store.get('subcontract', { id: 'SUB-FREE' }).items[0].unitPrice,
      0,
    );
    const unpriced = store.get('subcontract', { id: 'SUB-UNPRICED' }).items[0];
    assert.equal(Object.hasOwn(unpriced, 'unitPrice'), false);
    assert.equal(Object.hasOwn(unpriced, 'unit'), false);

    store.update(
      'subcontract',
      { upsert: [{ id: 'SUB-LEGACY', unit: 'pcs', unitPrice: 80 }] },
      saved.revision,
    );
    const legacy = store.get('subcontract', { id: 'SUB-LEGACY' }).items[0];
    assert.equal(legacy.supplier, 'Historic supplier');
    assert.equal(legacy.pricingBasis, 'Per unit');
    assert.equal(legacy.unitPrice, 80);
    let current = store.get('subcontract');
    current = store.update(
      'subcontract',
      { upsert: [{ id: 'SUB-ROUTER', unit: null, unitPrice: null }] },
      current.revision,
    );
    const cleared = store.get('subcontract', { id: 'SUB-ROUTER' }).items[0];
    assert.equal(cleared.unit, null);
    assert.equal(cleared.unitPrice, null);
    current = store.update(
      'subcontract',
      { upsert: [{ id: 'SUB-ROUTER', unit: 'pcs', unitPrice: 0 }] },
      current.revision,
    );
    store.update(
      'subcontract',
      { upsert: [{ id: 'SUB-ROUTER', item: 'Free router installation' }] },
      current.revision,
    );
    const free = store.get('subcontract', { id: 'SUB-ROUTER' }).items[0];
    assert.equal(free.unit, 'pcs');
    assert.equal(
      free.unitPrice,
      0,
      'omitted fields in narrow edits preserve saved prices',
    );
    assert.deepEqual(
      repo.headers(),
      [],
      'catalog maintenance needs no project',
    );
  } finally {
    repo.close();
  }
});

test('invalid subcontract reference quantities and prices reject the full update atomically', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const store = repo.globalMasterData;
    store.update(
      'subcontract',
      { upsert: [{ ...item(), unit: 'pcs', unitPrice: 200 }] },
      store.get('subcontract').revision,
    );
    const before = store.get('subcontract');
    const resourcesBefore = store.get('resources');
    for (const invalid of [
      { unitPrice: -1 },
      { unitPrice: 1_000_000_000_001 },
      { unitPrice: Number.POSITIVE_INFINITY },
      { unitPrice: Number.NaN },
      { unitPrice: '200' },
      { unit: '' },
      { unit: '   ' },
    ]) {
      assert.throws(() =>
        store.update(
          'subcontract',
          {
            upsert: [
              { id: 'SUB-ROUTER', unitPrice: 250 },
              { ...item('SUB-INVALID'), unit: 'pcs', ...invalid },
            ],
          },
          before.revision,
        ),
      );
      assert.deepEqual(store.get('subcontract'), before);
      assert.deepEqual(store.get('resources'), resourcesBefore);
    }
  } finally {
    repo.close();
  }
});

test('updating a reference price preserves captured project catalogs and confirmed cost versions', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const store = repo.globalMasterData;
    const catalog = store.update(
      'subcontract',
      { upsert: [{ ...item(), unit: 'pcs', unitPrice: 200 }] },
      store.get('subcontract').revision,
    );
    createProject(repo, {
      id: 'SUB-PROJECT',
      name: 'Frozen reference prices',
      client: 'Customer',
    });
    let record = repo.get('SUB-PROJECT');
    const w = record.workspace;
    w.rateSettings.tdStart = '2025-01-01';
    w.rateSettings.tdEnd = '2029-12-31';
    w.rateSettings.baseYear = 2025;
    w.subcontractCost = {
      mode: 'project',
      lines: [
        {
          id: 'COST-SUBCON',
          catalogItemId: 'SUB-ROUTER',
          code: 'SUB-ROUTER',
          description: 'Installation Cisco 2u router',
          bu: 'Infrastructure',
          unit: 'pcs',
          unitPrice: 200,
          currency: 'SGD',
          quantities: [10, 0, 0, 0, 0],
        },
      ],
      siteTypes: [],
    };
    record = repo.save('SUB-PROJECT', w, record.revision);
    updateResource(
      repo,
      'SUB-PROJECT',
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      record.revision,
    );
    const frozen = repo.get('SUB-PROJECT');
    assert.ok(costLockReason(frozen.workspace, 'V1'));
    assert.equal(frozen.workspace.subcontractItems[0].unitPrice, 200);
    assert.equal(
      frozen.workspace.costVersions[0].subcontractCost.lines[0].unitPrice,
      200,
    );
    store.update(
      'subcontract',
      { upsert: [{ id: 'SUB-ROUTER', unitPrice: 250 }] },
      catalog.revision,
    );
    assert.deepEqual(repo.get('SUB-PROJECT'), frozen);
    createProject(repo, {
      id: 'SUB-FUTURE',
      name: 'New reference prices',
      client: 'Customer',
    });
    assert.equal(
      repo.get('SUB-FUTURE').workspace.subcontractItems[0].unitPrice,
      250,
    );
    assert.deepEqual(repo.get('SUB-PROJECT'), frozen);
  } finally {
    repo.close();
  }
});
