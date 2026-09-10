import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_DATABASE_STATEMENTS } from '../db/schema.ts';
import {
  initializeGlobalMasterData,
  makeGlobalMasterDataStore,
} from '../server/global-master-data.mjs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  applyProjectMasterData,
  createProject,
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';

const rate = (id = 'rate-network', bu = 'Network', ratePercent = 20) => ({
  id,
  bu,
  ratePercent,
  active: true,
});
const create = (repo, id) =>
  createProject(repo, {
    id,
    name: 'Profit Share Fixture',
    client: 'Fixture Customer',
  });

test('profit-share initializes additively without reading projects or touching existing global tabs', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const sql of LOCAL_DATABASE_STATEMENTS) db.exec(sql);
    initializeGlobalMasterData(db);
    // Reproduce an installed database from before the new tab existed.
    db.prepare(
      "DELETE FROM master_data_revisions WHERE tab='profit-share'",
    ).run();
    db.prepare("DELETE FROM master_data_tabs WHERE tab='profit-share'").run();
    const otherTabs = db
      .prepare('SELECT * FROM master_data_tabs ORDER BY tab')
      .all();
    const isolatedDb = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        assert.doesNotMatch(sql, /workspace_snapshots|projects/);
        return db.prepare(sql);
      },
    };
    assert.equal(initializeGlobalMasterData(isolatedDb), false);
    const store = makeGlobalMasterDataStore(isolatedDb);
    const initial = store.get('profit-share');
    assert.equal(initial.revision, 1);
    assert.equal(initial.initializedFrom, 'defaults');
    assert.deepEqual(initial.items, []);
    const changed = store.update('profit-share', { upsert: [rate()] }, 1);
    assert.equal(changed.revision, 2);
    assert.throws(
      () => store.update('profit-share', { upsert: [rate()] }, 1),
      /changed/,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM master_data_tabs WHERE tab<>'profit-share' ORDER BY tab",
        )
        .all(),
      otherTabs,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM master_data_revisions WHERE tab='profit-share'",
        )
        .get().n,
      2,
    );
  } finally {
    db.close();
  }
});

test('profit-share rejects invalid percentages and normalized duplicate BU atomically', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const store = repo.globalMasterData;
    for (const value of [
      -1,
      101,
      '20',
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      assert.throws(() =>
        store.update(
          'profit-share',
          { upsert: [rate('x', 'Network', value)] },
          1,
        ),
      );
      assert.equal(store.get('profit-share').revision, 1);
    }
    store.update(
      'profit-share',
      { upsert: [rate('one', 'Network   Delivery')] },
      1,
    );
    assert.throws(
      () =>
        store.update(
          'profit-share',
          {
            upsert: [{ ...rate('two', ' network delivery '), active: false }],
          },
          2,
        ),
      /duplicate|unique/i,
    );
    assert.equal(store.get('profit-share').revision, 2);
    assert.throws(() =>
      store.update('profit-share', { upsert: [rate('two', '   ')] }, 2),
    );
    assert.deepEqual(store.get('profit-share').items, [
      rate('one', 'Network   Delivery'),
    ]);
  } finally {
    repo.close();
  }
});

test('new projects capture current rates; future global maintenance never rewrites project snapshots', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    create(repo, 'P-LEGACY');
    const legacy = repo.get('P-LEGACY');
    delete legacy.workspace.pricing.profitShareRates;
    delete legacy.workspace.pricing.profitShareMasterDataRevision;
    delete legacy.workspace.masterDataRevisions['profit-share'];
    repo.save('P-LEGACY', legacy.workspace, legacy.revision);
    const old = repo.get('P-LEGACY');
    repo.globalMasterData.update('profit-share', { upsert: [rate()] }, 1);
    assert.deepEqual(repo.get('P-LEGACY'), old);
    create(repo, 'P-CAPTURED');
    const captured = repo.get('P-CAPTURED');
    assert.deepEqual(captured.workspace.pricing.profitShareRates, [rate()]);
    assert.equal(captured.workspace.pricing.profitShareMasterDataRevision, 2);
    assert.equal(captured.workspace.masterDataRevisions['profit-share'], 2);
    repo.globalMasterData.update(
      'profit-share',
      { upsert: [{ id: rate().id, ratePercent: 35 }] },
      2,
    );
    assert.deepEqual(repo.get('P-CAPTURED'), captured);
    assert.deepEqual(repo.get('P-LEGACY'), old);
    create(repo, 'P-FUTURE');
    assert.equal(
      repo.get('P-FUTURE').workspace.pricing.profitShareRates[0].ratePercent,
      35,
    );
    assert.equal(
      repo.get('P-FUTURE').workspace.pricing.profitShareMasterDataRevision,
      3,
    );
  } finally {
    repo.close();
  }
});

test('explicit profit-share adoption respects project CAS and preserves confirmed costs and historical quotes', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    create(repo, 'P-CONFIRMED');
    const initial = repo.get('P-CONFIRMED');
    initial.workspace.quoteHistory.push({
      id: 'quote-old',
      quoteNumber: 'Q-OLD',
      generatedAt: '2025-01-01T00:00:00.000Z',
      costVersion: 'V1',
      templateId: initial.workspace.selectedQuoteTemplateId,
      status: 'Draft',
      costAmount: 50,
      quoteBeforeTax: 100,
      gstAmount: 0,
      quoteAfterTax: 100,
      grossMarginPercent: 50,
      note: 'Historical quote',
    });
    const withHistory = repo.save(
      'P-CONFIRMED',
      initial.workspace,
      initial.revision,
    );
    updateResource(
      repo,
      'P-CONFIRMED',
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      withHistory.revision,
    );
    const confirmed = repo.get('P-CONFIRMED');
    repo.globalMasterData.update('profit-share', { upsert: [rate()] }, 1);
    assert.throws(
      () =>
        applyProjectMasterData(
          repo,
          'P-CONFIRMED',
          'profit-share',
          confirmed.revision - 1,
        ),
      /changed/i,
    );
    assert.deepEqual(repo.get('P-CONFIRMED'), confirmed);
    const receipt = applyProjectMasterData(
      repo,
      'P-CONFIRMED',
      'profit-share',
      confirmed.revision,
    );
    assert.equal(receipt.section, 'profit-share');
    assert.equal(receipt.masterDataRevision, 2);
    const after = repo.get('P-CONFIRMED');
    const expected = structuredClone(confirmed.workspace);
    expected.pricing.profitShareRates = [rate()];
    expected.pricing.profitShareMasterDataRevision = 2;
    expected.masterDataRevisions['profit-share'] = 2;
    assert.deepEqual(after.workspace, expected);
    const settings = readResource(repo, 'P-CONFIRMED', 'quote', {
      section: 'settings',
    });
    assert.deepEqual(settings.value.pricing.profitShareRates, [rate()]);
    assert.throws(
      () =>
        applyProjectMasterData(
          repo,
          'P-CONFIRMED',
          'subcontract',
          after.revision,
        ),
      /locked|锁定|Confirmed/,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'P-CONFIRMED',
          'quote',
          { section: 'settings' },
          {
            set: {
              pricing: { profitShareRates: [rate(), rate('two', ' network ')] },
            },
          },
          after.revision,
        ),
      /duplicate|unique/i,
    );
    assert.deepEqual(repo.get('P-CONFIRMED'), after);
  } finally {
    repo.close();
  }
});
