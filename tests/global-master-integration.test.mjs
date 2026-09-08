import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  createCostDraft,
  updateResource,
  readResource,
  applyMasterRates,
  applyProjectMasterData,
} from '../server/workspace-resources.mjs';
import { captureResourceRates } from '../features/master-data/capture.ts';

const request = (operation, changes) => ({
  apiVersion: 'cost-workbench/v2',
  kind: 'OperationRequest',
  requestId: 'global-fixture',
  data: { schemaVersion: '1.0.0', operation, changes },
});
const cli = (...args) => {
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'cli/cost-cli.mjs', ...args],
    { encoding: 'utf8' },
  );
  return {
    status: result.status,
    body: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
};

test('global CLI can maintain one tab with no projects and rejects obsolete project binding', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'global-cli-'));
  const file = path.join(dir, 'db.sqlite');
  try {
    const first = cli(
      'masterdata',
      'get',
      '--tab',
      'resources',
      '--limit',
      '1',
      '--db',
      file,
    );
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.body.kind, 'GlobalMasterDataResult');
    assert.equal(first.body.data.scope, 'global');
    assert.equal(first.body.data.projectId, undefined);
    assert.equal(first.body.data.nextOffset, 1);
    const change = path.join(dir, 'change.json');
    writeFileSync(
      change,
      JSON.stringify(
        request('masterdata.update', {
          upsert: [{ id: first.body.data.items[0].id, mandayRate: 777 }],
        }),
      ),
    );
    const update = cli(
      'masterdata',
      'update',
      '--tab',
      'resources',
      '--input',
      change,
      '--expected-revision',
      '1',
      '--db',
      file,
    );
    assert.equal(update.status, 0, JSON.stringify(update.body));
    assert.equal(update.body.kind, 'GlobalMasterDataMutationResult');
    assert.equal(update.body.data.revision, 2);
    assert.equal(update.body.data.items, undefined);
    assert.equal(
      cli('project', 'list', '--db', file).body.data.items.length,
      0,
    );
    assert.notEqual(
      cli(
        'masterdata',
        'get',
        '--project-id',
        'P-OLD',
        '--tab',
        'resources',
        '--db',
        file,
      ).status,
      0,
    );
    assert.equal(
      cli('masterdata', 'get', '--tab', 'maintenance', '--db', file).body.data
        .revision,
      1,
    );
    assert.equal(
      cli(
        'masterdata',
        'update',
        '--tab',
        'resources',
        '--input',
        change,
        '--expected-revision',
        '1',
        '--db',
        file,
      ).status,
      5,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('future master rates cannot change a historical 2025 cost, Draft or Confirmed, and new projects capture the new rates', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const initial = repo.globalMasterData.get('resources');
    const rate = initial.items.find((r) => r.code === 'LOCAL-L1');
    repo.globalMasterData.update(
      'resources',
      {
        upsert: [{ id: rate.id, mandayRate: 100, effectiveFrom: '2025-01-01' }],
      },
      initial.revision,
    );
    createProject(repo, {
      id: 'P-2025',
      name: 'Historical Fixture',
      client: 'Fixture Customer',
    });
    updateResource(
      repo,
      'P-2025',
      'cost',
      { section: 'settings', version: 'V1' },
      {
        set: {
          manualCosts: { otherService: 0 },
          rateSettings: {
            quoteAsOf: '2025-01-01',
            tdStart: '2025-01-01',
            tdEnd: '2025-12-31',
            baseYear: 2025,
          },
        },
      },
      1,
    );
    updateResource(
      repo,
      'P-2025',
      'cost',
      { version: 'V1' },
      {
        upsert: [
          {
            id: 'row',
            scope: 'Fixture scope',
            bu: 'Delivery',
            reTypeId: rate.id,
            inputMode: 'mandays',
            mdPerSite: 0,
            years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket, i) => ({
              bucket,
              sites: 0,
              mandays: i === 0 ? 10 : 0,
              cost: 0,
            })),
          },
        ],
      },
      2,
    );
    const draft = repo.get('P-2025');
    const master = repo.globalMasterData.get('resources');
    repo.globalMasterData.update(
      'resources',
      {
        upsert: [{ id: rate.id, mandayRate: 200, effectiveFrom: '2026-01-01' }],
      },
      master.revision,
    );
    assert.deepEqual(repo.get('P-2025'), draft);
    assert.equal(
      readResource(repo, 'P-2025', 'cost', { section: 'summary' }).value
        .totalWithRisk,
      1000,
    );
    updateResource(
      repo,
      'P-2025',
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      draft.revision,
    );
    const confirmed = repo.get('P-2025');
    repo.globalMasterData.update(
      'resources',
      { upsert: [{ id: rate.id, mandayRate: 300 }] },
      master.revision + 1,
    );
    assert.deepEqual(repo.get('P-2025'), confirmed);
    assert.throws(
      () => applyMasterRates(repo, 'P-2025', 'V1', confirmed.revision),
      /锁定|locked|Confirmed/,
    );
    createProject(repo, {
      id: 'P-2026',
      name: 'Future Fixture',
      client: 'Fixture Customer',
    });
    const future = repo.get('P-2026').workspace.costVersions[0];
    assert.equal(
      future.resourceTypes.find((r) => r.id === rate.id).mandayRate,
      300,
    );
    assert.equal(future.masterDataRevision, master.revision + 2);
    const clone = createCostDraft(
      repo,
      'P-2025',
      { mode: 'clone', sourceVersion: 'V1' },
      confirmed.revision,
    );
    assert.equal(
      repo
        .get('P-2025')
        .workspace.costVersions[1].resourceTypes.find((r) => r.id === rate.id)
        .mandayRate,
      100,
    );
    const blank = createCostDraft(
      repo,
      'P-2025',
      { mode: 'blank' },
      clone.revision,
    );
    assert.equal(
      repo
        .get('P-2025')
        .workspace.costVersions[2].resourceTypes.find((r) => r.id === rate.id)
        .mandayRate,
      300,
    );
    assert.deepEqual(
      repo.get('P-2025').workspace.costVersions[0],
      confirmed.workspace.costVersions[0],
    );
    applyMasterRates(repo, 'P-2025', 'V2', blank.revision);
    const after = repo.get('P-2025').workspace;
    assert.equal(after.costVersions[1].costRows[0].years[0].cost, 3000);
    assert.equal(after.activeVersion, 'V3');
    assert.deepEqual(
      after.costVersions[0],
      confirmed.workspace.costVersions[0],
    );
  } finally {
    repo.close();
  }
});

test('shared CPQ and quotation catalog updates remain detached until explicit project application', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const item = {
      code: 'SVC',
      scope: 'Fixture service',
      unit: 'MD',
      unitCost: 100,
      kind: 'service',
      adjustable: true,
      active: true,
      step: 1,
      minQty: 0,
      maxQty: 100,
      referenceQty: 1,
      tags: '',
      revision: '2025',
    };
    repo.globalMasterData.update('cpq-catalog', { upsert: [item] }, 1);
    createProject(repo, {
      id: 'P-CATALOG',
      name: 'Fixture',
      client: 'Fixture',
    });
    const before = repo.get('P-CATALOG');
    repo.globalMasterData.update(
      'cpq-catalog',
      { upsert: [{ code: 'SVC', unitCost: 200, revision: '2026' }] },
      2,
    );
    const templates = repo.globalMasterData.get('quote-templates');
    repo.globalMasterData.update(
      'quote-templates',
      { upsert: [{ id: templates.items[0].id, validityDays: 99 }] },
      templates.revision,
    );
    assert.deepEqual(repo.get('P-CATALOG'), before);
    assert.equal(
      readResource(repo, 'P-CATALOG', 'cpq', { section: 'catalog' }).items[0]
        .unitCost,
      100,
    );
    assert.notEqual(
      readResource(repo, 'P-CATALOG', 'quote', { section: 'templates' })
        .items[0].validityDays,
      99,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'P-CATALOG',
          'cpq',
          { section: 'catalog' },
          { upsert: [{ code: 'SVC', unitCost: 999 }] },
          before.revision,
        ),
      /read-only/,
    );
    const applied = applyProjectMasterData(
      repo,
      'P-CATALOG',
      'cpq-catalog',
      before.revision,
    );
    assert.equal(
      readResource(repo, 'P-CATALOG', 'cpq', { section: 'catalog' }).items[0]
        .unitCost,
      200,
    );
    assert.deepEqual(
      repo.get('P-CATALOG').workspace.costVersions,
      before.workspace.costVersions,
    );
    assert.equal(applied.masterDataRevision, 3);
    assert.throws(
      () =>
        applyProjectMasterData(repo, 'P-CATALOG', 'workflow', applied.revision),
      /templates only seed new projects/,
    );
  } finally {
    repo.close();
  }
});

test('explicit rate capture maps stable codes, blocks removed references, and leaves its source intact', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    createProject(repo, { id: 'P-MAP', name: 'Fixture', client: 'Fixture' });
    const v = repo.get('P-MAP').workspace.costVersions[0];
    const r = v.resourceTypes[0];
    v.costRows = [
      {
        id: 'row',
        scope: 'Scope',
        bu: 'BU',
        reTypeId: r.id,
        mdPerSite: 1,
        years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket) => ({
          bucket,
          sites: 1,
          cost: 0,
        })),
      },
    ];
    const before = structuredClone(v);
    const master = {
      tab: 'resources',
      revision: 2,
      items: [{ ...r, id: 'new-id', mandayRate: 123 }],
      conflicts: [],
    };
    const applied = captureResourceRates(v, master);
    assert.equal(applied.costRows[0].reTypeId, 'new-id');
    assert.deepEqual(v, before);
    assert.throws(
      () => captureResourceRates(v, { ...master, items: [] }),
      /missing from global/,
    );
    assert.throws(
      () => captureResourceRates(v, { ...master, conflicts: [{ key: r.id }] }),
      /unresolved/,
    );
  } finally {
    repo.close();
  }
});

test('template application captures required assumptions atomically and preserves selected retired templates', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const assumptions = repo.globalMasterData.get('assumptions');
    const oldAssumption = assumptions.items[0];
    const templates = repo.globalMasterData.get('quote-templates');
    const template = {
      ...templates.items[0],
      defaultAssumptionIds: [oldAssumption.id],
    };
    repo.globalMasterData.update(
      'quote-templates',
      { upsert: [template] },
      templates.revision,
    );
    createProject(repo, {
      id: 'P-REFS',
      name: 'References Fixture',
      client: 'Fixture',
    });
    const before = repo.get('P-REFS');
    const replacement = {
      ...oldAssumption,
      id: 'A-FUTURE',
      text: 'Future scope assumption',
    };
    repo.globalMasterData.update(
      'assumptions',
      { upsert: [replacement] },
      assumptions.revision,
    );
    repo.globalMasterData.update(
      'quote-templates',
      { upsert: [{ ...template, defaultAssumptionIds: [replacement.id] }] },
      templates.revision + 1,
    );
    repo.globalMasterData.update(
      'assumptions',
      { remove: [oldAssumption.id] },
      assumptions.revision + 1,
    );
    const first = applyProjectMasterData(
      repo,
      'P-REFS',
      'assumptions',
      before.revision,
    );
    assert.ok(
      repo
        .get('P-REFS')
        .workspace.assumptionLibrary.some((a) => a.id === oldAssumption.id),
    );
    const second = applyProjectMasterData(
      repo,
      'P-REFS',
      'quote-templates',
      first.revision,
    );
    assert.deepEqual(
      repo.get('P-REFS').workspace.quoteTemplates[0].defaultAssumptionIds,
      [replacement.id],
    );
    assert.ok(
      repo
        .get('P-REFS')
        .workspace.assumptionLibrary.some((a) => a.id === replacement.id),
    );
    const current = repo.globalMasterData.get('quote-templates');
    repo.globalMasterData.update(
      'quote-templates',
      {
        upsert: [
          {
            ...template,
            id: 'T-FUTURE',
            defaultAssumptionIds: [replacement.id],
          },
        ],
        remove: [template.id],
      },
      current.revision,
    );
    applyProjectMasterData(repo, 'P-REFS', 'quote-templates', second.revision);
    const after = repo.get('P-REFS');
    assert.equal(after.workspace.selectedQuoteTemplateId, template.id);
    assert.ok(after.workspace.quoteTemplates.some((t) => t.id === 'T-FUTURE'));
    assert.deepEqual(
      after.workspace.costVersions,
      before.workspace.costVersions,
    );
    assert.deepEqual(
      after.workspace.quoteAssumptions,
      before.workspace.quoteAssumptions,
    );
    assert.deepEqual(
      after.workspace.quoteHistory,
      before.workspace.quoteHistory,
    );
    const w = after.workspace;
    w.costVersions[0].state = 'Suspended';
    repo.save('P-REFS', w, after.revision);
    const suspended = repo.get('P-REFS');
    assert.throws(
      () => applyMasterRates(repo, 'P-REFS', 'V1', suspended.revision),
      /editable Draft/,
    );
    assert.throws(
      () =>
        applyProjectMasterData(
          repo,
          'P-REFS',
          'cpq-catalog',
          suspended.revision,
        ),
      /editable Draft/,
    );
    assert.deepEqual(repo.get('P-REFS'), suspended);
  } finally {
    repo.close();
  }
});
