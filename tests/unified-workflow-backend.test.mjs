import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  normalizeProjectWorkflow,
  updateProjectWorkflow,
  projectWorkflowSteps,
  QUOTE_COMPLETED,
} from '../features/projects/workflow-domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { emptySsr } from '../features/ssr/domain.ts';
import { deleteSuspendedCostVersion } from '../features/cost/version-deletion.ts';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { initialProcessSteps } from '../features/projects/demo-data.ts';
import { LOCAL_DATABASE_SCHEMA_VERSION } from '../db/schema.ts';
import { completeWorkflowThrough } from './helpers/workflow-actions.mjs';

function fixture() {
  const w = createBlankWorkspace(
    projectRecord('WF-FIXTURE', 'Workflow fixture', 'Client'),
    'costing',
  );
  w.costVersionLocks = {};
  w.costRows = structuredClone(initialCostRows);
  w.manualCosts = {
    localPurchasedEquipment: 0,
    inlandLogistics: 0,
    countryWarehousing: 0,
    nonInHouseLabour: 0,
    settlement: 0,
    carFee: 0,
    otherService: 0,
    riskContingency: 100,
  };
  w.costVersions = [createCostVersion('V1', 'Draft', null, w)];
  w.activeVersion = w.workflowVersion = 'V1';
  w.currentWorkflowStepCode = 'TD_EFFORT_REVIEW';
  w.selectedStep = w.processSteps.findIndex(
    (s) => s.code === w.currentWorkflowStepCode,
  );
  w.versionWorkflows = {
    V1: {
      currentWorkflowStepCode: w.currentWorkflowStepCode,
      processSteps: structuredClone(w.processSteps),
      projectStatus: w.projectStatus,
    },
  };
  w.legacyWorkflowArchive = {};
  w.reviewGates = [];
  return w;
}
function confirm(w) {
  w.costVersions[0].state = 'Confirmed';
  return w;
}

test('normalization preserves all cost/evidence input and maps legacy completed projects even with Draft costs', () => {
  const w = fixture();
  w.projectStatus = 'completed';
  w.ssr = emptySsr();
  const prior = structuredClone(w);
  const result = normalizeProjectWorkflow(w);
  assert.equal(result.workflowMode, 'project');
  assert.equal(result.currentWorkflowStepCode, QUOTE_COMPLETED);
  for (const key of [
    'costVersions',
    'costRows',
    'resourceTypes',
    'costVersionLocks',
    'quoteHistory',
    'ssr',
    'reviewGates',
  ])
    assert.deepEqual(result[key], prior[key]);
  assert.deepEqual(w, prior);
  assert.deepEqual(normalizeProjectWorkflow(result), result);
  assert.equal(projectWorkflowSteps(result).length, 9);
});

test('single narrow register enforces cost confirmation, stores one immutable history entry, and checks CAS', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    let record = repo.save('WF-FIXTURE', fixture(), null);
    assert.throws(
      () =>
        updateResource(
          repo,
          'WF-FIXTURE',
          'project',
          { section: 'workflow-tracking' },
          { set: { currentWorkflowStepCode: 'DELIVERY_REVIEW' } },
          record.revision,
        ),
      /Confirmed/,
    );
    record = repo.save(
      'WF-FIXTURE',
      confirm(record.workspace),
      record.revision,
    );
    record = completeWorkflowThrough(repo, 'WF-FIXTURE', 'DELIVERY_REVIEW', {
      includeTarget: false,
    });
    const historyBefore = record.workspace.workflowUpdates.length;
    record = repo.applyWorkflowAction(
      'WF-FIXTURE',
      {
        nodeCode: 'DELIVERY_REVIEW',
        action: 'start',
        owner: 'PM Alice',
        followUpDate: '2026-09-12',
        note: 'Company DRB application pending',
      },
      record.revision,
    );
    const track = readResource(repo, 'WF-FIXTURE', 'project', {
      section: 'workflow-tracking',
    }).value;
    assert.equal(track.owner, 'PM Alice');
    assert.equal(track.workflowVersion, 'V1');
    assert.equal(track.completed, false);
    assert.equal(record.workspace.workflowUpdates.length, historyBefore + 1);
    assert.equal(record.workspace.projectStatus, 'solution_review');
    assert.equal(record.workspace.currentWorkflowStepCode, 'DELIVERY_REVIEW');
    updateResource(
      repo,
      'WF-FIXTURE',
      'project',
      { section: 'workflow-tracking' },
      { set: { note: 'PM follow-up completed' } },
      record.revision,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'WF-FIXTURE',
          'project',
          { section: 'workflow-tracking' },
          { set: { note: 'Stale' } },
          record.revision,
        ),
      /changed/,
    );
    const history = readResource(repo, 'WF-FIXTURE', 'project', {
      section: 'workflow-history',
      limit: 1,
    });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].note, 'PM follow-up completed');
    record = repo.get('WF-FIXTURE');
    const changed = structuredClone(record.workspace);
    changed.workflowUpdates[0].note = 'Tampered';
    assert.throws(
      () => repo.save('WF-FIXTURE', changed, record.revision),
      /server-owned|history cannot/,
    );
  } finally {
    repo.close();
  }
});

test('old status and review write routes cannot become a second workflow', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const record = repo.save('WF-FIXTURE', fixture(), null);
    assert.throws(
      () =>
        updateResource(
          repo,
          'WF-FIXTURE',
          'project',
          {},
          { set: { projectStatus: 'completed' } },
          record.revision,
        ),
      /Unsupported field/,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'WF-FIXTURE',
          'project',
          { section: 'reviews' },
          { remove: ['x'] },
          record.revision,
        ),
      /read-only/,
    );
    assert.throws(
      () =>
        updateResource(
          repo,
          'WF-FIXTURE',
          'ssr',
          { section: 'bid-responses' },
          { remove: ['x'] },
          record.revision,
        ),
      /read-only/,
    );
    const changed = structuredClone(record.workspace);
    changed.projectStatus = 'completed';
    assert.throws(
      () => repo.save('WF-FIXTURE', changed, record.revision),
      /derived/,
    );
    changed.projectStatus = record.workspace.projectStatus;
    changed.reviewGates.push({ id: 'new-review' });
    assert.throws(() => repo.save('WF-FIXTURE', changed, record.revision));
  } finally {
    repo.close();
  }
});

test('completed project reopens DTRB for a new Draft, resets follow-up, and browsing old costs keeps current round', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    let record = repo.save('WF-FIXTURE', confirm(fixture()), null);
    record = completeWorkflowThrough(repo, 'WF-FIXTURE', QUOTE_COMPLETED);
    createCostDraft(
      repo,
      'WF-FIXTURE',
      { mode: 'clone', sourceVersion: 'V1' },
      record.revision,
    );
    record = repo.get('WF-FIXTURE');
    assert.equal(record.workspace.workflowVersion, 'V2');
    assert.equal(record.workspace.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.equal(record.workspace.projectStatus, 'solution_review');
    const current = record.workspace.processSteps.find(
      (s) => s.code === record.workspace.currentWorkflowStepCode,
    );
    assert.equal(current.followUpDate, '');
    assert.equal(current.note, '');
    assert.equal(
      record.workspace.versionWorkflows.V1.currentWorkflowStepCode,
      QUOTE_COMPLETED,
    );
    const expectedHistory = structuredClone(record.workspace.workflowUpdates);
    const w = structuredClone(record.workspace),
      v = w.costVersions[0];
    w.activeVersion = 'V1';
    for (const key of [
      'costRows',
      'rateSettings',
      'travelSettings',
      'travelRows',
      'travelUplift',
      'manualCosts',
    ])
      w[key] = structuredClone(v[key]);
    record = repo.save('WF-FIXTURE', w, record.revision);
    assert.equal(record.workspace.workflowVersion, 'V2');
    assert.equal(record.workspace.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.deepEqual(record.workspace.workflowUpdates, expectedHistory);
    record.workspace.costVersions[1].state = 'Suspended';
    record = repo.save('WF-FIXTURE', record.workspace, record.revision);
    record = repo.save(
      'WF-FIXTURE',
      deleteSuspendedCostVersion(record.workspace, 'V2'),
      record.revision,
    );
    assert.equal(record.workspace.workflowVersion, 'V1');
    assert.equal(record.workspace.currentWorkflowStepCode, QUOTE_COMPLETED);
    assert.deepEqual(record.workspace.workflowUpdates, expectedHistory);
  } finally {
    repo.close();
  }
});

test('workflow dates validate calendar dates and cost preparation remains editable before confirmation', () => {
  const w = normalizeProjectWorkflow(fixture());
  assert.throws(
    () => updateProjectWorkflow(w, { followUpDate: '2026-02-30' }),
    /date/,
  );
  assert.throws(() => updateProjectWorkflow(w, { owner: '' }), /owner/);
  assert.equal(
    updateProjectWorkflow(w, { currentWorkflowStepCode: 'COST_BUILD' })
      .currentWorkflowStepCode,
    'COST_BUILD',
  );
});

test('new register quotation export retains Confirmed requirement without SSR decision dependency', () => {
  const w = normalizeProjectWorkflow(confirm(fixture()));
  w.ssr = { ...emptySsr(), enabled: true };
  assert.equal(validatedQuoteInput(w, 'Q-1').costVersion, 'V1');
  w.costVersions[0].state = 'Draft';
  assert.throws(() => validatedQuoteInput(w, 'Q-1'), /Confirm/);
});

test('database migration archives original JSON once, preserves business amounts and completed state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-v7-'));
  const file = path.join(dir, 'test.sqlite');
  try {
    let repo = openWorkspaceRepository(file);
    const record = repo.save('WF-FIXTURE', fixture(), null);
    repo.close();
    const legacy = fixture();
    legacy.projectStatus = 'completed';
    const raw = JSON.stringify(legacy);
    let db = new DatabaseSync(file);
    db.prepare(
      'UPDATE workspace_snapshots SET payload_json=?, payload_sha256=? WHERE project_id=?',
    ).run(raw, createHash('sha256').update(raw).digest('hex'), 'WF-FIXTURE');
    db.prepare('DELETE FROM schema_migrations WHERE version=?').run(
      LOCAL_DATABASE_SCHEMA_VERSION,
    );
    db.close();
    repo = openWorkspaceRepository(file);
    const migrated = repo.get('WF-FIXTURE');
    assert.equal(migrated.revision, record.revision + 1);
    assert.equal(migrated.workspace.currentWorkflowStepCode, QUOTE_COMPLETED);
    assert.deepEqual(migrated.workspace.costVersions, legacy.costVersions);
    repo.close();
    db = new DatabaseSync(file);
    assert.equal(
      db
        .prepare(
          'SELECT payload_json FROM workspace_migration_archive WHERE project_id=? AND revision=?',
        )
        .get('WF-FIXTURE', record.revision).payload_json,
      raw,
    );
    db.close();
    repo = openWorkspaceRepository(file);
    assert.equal(repo.get('WF-FIXTURE').revision, migrated.revision);
    repo.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI workflow-tracking updates and history reads stay narrow with explicit project revision', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-cli-'));
  const file = path.join(dir, 'db.sqlite');
  try {
    const repo = openWorkspaceRepository(file);
    const record = repo.save('WF-FIXTURE', fixture(), null);
    repo.close();
    const requestFile = path.join(dir, 'request.json');
    writeFileSync(
      requestFile,
      JSON.stringify({
        apiVersion: 'cost-workbench/v2',
        kind: 'OperationRequest',
        requestId: 'workflow-cli-fixture',
        data: {
          schemaVersion: '1.0.0',
          operation: 'project.update',
          changes: {
            set: {
              owner: 'PM Owner',
              note: 'Update from company system',
              followUpDate: '2026-09-15',
            },
          },
        },
      }),
    );
    const cli = (...args) => {
      const result = spawnSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          'cli/cost-cli.mjs',
          ...args,
          '--db',
          file,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return JSON.parse(result.stdout).data;
    };
    const receipt = cli(
      'project',
      'update',
      '--project-id',
      'WF-FIXTURE',
      '--section',
      'workflow-tracking',
      '--input',
      requestFile,
      '--expected-revision',
      String(record.revision),
    );
    assert.equal(receipt.revision, record.revision + 1);
    assert.equal(receipt.workspace, undefined);
    const tracked = cli(
      'project',
      'get',
      '--project-id',
      'WF-FIXTURE',
      '--section',
      'workflow-tracking',
    );
    assert.equal(tracked.value.owner, 'PM Owner');
    assert.equal(tracked.value.note, 'Update from company system');
    assert.equal(tracked.value.costRows, undefined);
    const history = cli(
      'project',
      'get',
      '--project-id',
      'WF-FIXTURE',
      '--section',
      'workflow-history',
      '--limit',
      '1',
    );
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].costVersion, 'V1');
    writeFileSync(
      requestFile,
      JSON.stringify({
        apiVersion: 'cost-workbench/v2',
        kind: 'OperationRequest',
        requestId: 'blocked-drb',
        data: {
          schemaVersion: '1.0.0',
          operation: 'project.update',
          changes: { set: { currentWorkflowStepCode: 'DELIVERY_REVIEW' } },
        },
      }),
    );
    const rejected = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        'project',
        'update',
        '--project-id',
        'WF-FIXTURE',
        '--section',
        'workflow-tracking',
        '--input',
        requestFile,
        '--expected-revision',
        String(receipt.revision),
        '--db',
        file,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(rejected.status, 6, rejected.stdout);
    assert.match(JSON.parse(rejected.stdout).error.message, /Confirmed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project metadata uses the same register context without touching workflow history or cost inputs', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const record = repo.save('WF-FIXTURE', fixture(), null);
    updateResource(
      repo,
      'WF-FIXTURE',
      'project',
      { section: 'metadata' },
      {
        set: {
          proposalNumber: 'P-100',
          companyUrl: 'https://company.example/proposal/100',
          scopeBrief: 'Remote delivery',
          technicalBasis: 'TD note',
          mode: 'tender',
        },
      },
      record.revision,
    );
    const value = readResource(repo, 'WF-FIXTURE', 'project', {
      section: 'metadata',
    }).value;
    assert.equal(value.proposalNumber, 'P-100');
    assert.equal(value.mode, 'tender');
    assert.deepEqual(
      repo.get('WF-FIXTURE').workspace.costVersions,
      record.workspace.costVersions,
    );
    assert.deepEqual(repo.get('WF-FIXTURE').workspace.workflowUpdates, []);
  } finally {
    repo.close();
  }
});

test('published custom workflow nodes are usable and explicit cost gates take priority over their names', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    let record = repo.save('WF-FIXTURE', fixture(), null);
    const master = repo.globalMasterData.get('workflow');
    const steps = structuredClone(master.items);
    const index =
      steps.findIndex((step) => step.code === 'TD_EFFORT_REVIEW') + 1;
    const custom = {
      ...steps[index],
      code: 'CUSTOM_PROGRESS',
      name: 'DRB customer inputs',
      nameZh: '客户输入',
      required: false,
      requiresConfirmedCost: false,
      roundStart: false,
      finishesWorkflow: false,
      requiredFields: [],
    };
    steps.splice(index, 0, custom, {
      ...custom,
      code: 'CUSTOM_GATE',
      name: 'Cost approval',
      requiresConfirmedCost: true,
    });
    steps.forEach((step, i) => {
      step.no = String(i + 1).padStart(2, '0');
    });
    repo.publishWorkflow(steps, master.revision, {
      'WF-FIXTURE': record.revision,
    });
    record = completeWorkflowThrough(repo, 'WF-FIXTURE', 'TD_EFFORT_REVIEW');
    record = repo.applyWorkflowAction(
      'WF-FIXTURE',
      { nodeCode: custom.code, action: 'start' },
      record.revision,
    );
    assert.equal(record.workspace.currentWorkflowStepCode, custom.code);
    assert.equal(record.workspace.costVersions[0].state, 'Draft');
    assert.throws(
      () =>
        repo.applyWorkflowAction(
          'WF-FIXTURE',
          { nodeCode: 'CUSTOM_GATE', action: 'start' },
          record.revision,
        ),
      /Confirmed/,
    );
    const forged = structuredClone(record.workspace);
    forged.processSteps.push({ ...custom, code: 'FORGED' });
    assert.throws(
      () => repo.save('WF-FIXTURE', forged, record.revision),
      /server-owned/,
    );
  } finally {
    repo.close();
  }
});

test('global workflow upgrades only untouched legacy defaults and retains the old catalog revision', () => {
  for (const custom of [false, true]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'workflow-template-'));
    const file = path.join(dir, 'db.sqlite');
    try {
      let repo = openWorkspaceRepository(file);
      assert.equal(repo.globalMasterData.get('workflow').items.length, 9);
      const initialRevision = repo.globalMasterData.get('workflow').revision;
      repo.close();
      let db = new DatabaseSync(file);
      const row = db
        .prepare('SELECT payload_json FROM master_data_tabs WHERE tab=?')
        .get('workflow');
      const payload = JSON.parse(row.payload_json);
      payload.items = initialProcessSteps.map((step) => ({
        ...step,
        state: 'not_started',
        tone: 'gray',
        date: '',
        dateZh: '',
        input: '',
        inputZh: '',
      }));
      if (custom) payload.items[0].owner = 'Custom Owner';
      const raw = JSON.stringify(payload);
      db.prepare('UPDATE master_data_tabs SET payload_json=? WHERE tab=?').run(
        raw,
        'workflow',
      );
      db.prepare(
        'UPDATE master_data_revisions SET payload_json=? WHERE tab=? AND revision=1',
      ).run(raw, 'workflow');
      db.prepare('DELETE FROM master_data_metadata WHERE key=?').run(
        'project-workflow-template-v1',
      );
      db.close();
      repo = openWorkspaceRepository(file);
      const result = repo.globalMasterData.get('workflow');
      assert.equal(result.revision, initialRevision + (custom ? 0 : 1));
      assert.equal(result.items.length, custom ? 10 : 9);
      if (custom) assert.deepEqual(result.items, payload.items);
      repo.close();
      db = new DatabaseSync(file);
      assert.equal(
        db
          .prepare(
            'SELECT payload_json FROM master_data_revisions WHERE tab=? AND revision=1',
          )
          .get('workflow').payload_json,
        raw,
      );
      db.close();
      repo = openWorkspaceRepository(file);
      assert.equal(
        repo.globalMasterData.get('workflow').revision,
        result.revision,
      );
      repo.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
