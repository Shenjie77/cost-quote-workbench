import assert from 'node:assert/strict';
import test from 'node:test';
import { getHQTravelSummary } from '../features/cost/domain.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('derived cost overflow is rejected before any database write', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const first = repository.save('PRJ-TEST-001', makeWorkspace(), null);
    const input = structuredClone(first.workspace);
    input.costRows[0].mdPerSite = 1000000;
    input.costRows[0].years[0].sites = 1000000;
    input.costRows[0].years[0].cost = 0;
    input.costVersions[0].resourceTypes.find(
      (resource) => resource.id === input.costRows[0].reTypeId,
    ).mandayRate = 1e12;
    assert.throws(
      () => repository.save(input.project.id, input, 1),
      /maximum|<=/,
    );
    assert.equal(repository.get(input.project.id).revision, 1);
  } finally {
    repository.close();
  }
});

test('legacy cost correction archives the exact original and runs only once', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workbench-migration-'));
  const dbPath = path.join(directory, 'workspace.sqlite');
  let repository;
  try {
    repository = openWorkspaceRepository(dbPath);
    const first = repository.save('PRJ-TEST-001', makeWorkspace(), null);
    const old = structuredClone(first.workspace);
    delete old.costVersions[0].resourceTypes;
    old.costVersions[0].costRows[0].years[0].cost = 184000;
    old.costRows[0].years[0].cost = 184000;
    const original = JSON.stringify(old);
    repository.close();
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE workspace_snapshots SET payload_json = ?').run(original);
    // Simulate a database from before the one-time current schema migration.
    db.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    db.close();
    repository = openWorkspaceRepository(dbPath);
    const migrated = repository.get(old.project.id);
    assert.equal(migrated.revision, 2);
    assert.equal(migrated.workspace.costRows[0].years[0].cost, 218400);
    assert.equal(
      migrated.workspace.costVersions[0].costRows[0].years[0].cost,
      218400,
    );
    assert.match(migrated.workspace.costVersions[0].calculationNote, /Legacy/);
    repository.close();
    const archived = new DatabaseSync(dbPath);
    assert.equal(
      archived
        .prepare('SELECT payload_json FROM workspace_migration_archive')
        .get().payload_json,
      original,
    );
    archived.close();
    repository = openWorkspaceRepository(dbPath);
    assert.equal(repository.get(old.project.id).revision, 2);
  } finally {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid workspace references reject without changing the stored revision', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const first = repository.save('PRJ-TEST-001', makeWorkspace(), null);
    const mutations = [
      (workspace) => {
        workspace.activeVersion = 'V999';
      },
      (workspace) => {
        workspace.costVersions.push(structuredClone(workspace.costVersions[0]));
      },
      (workspace) => {
        workspace.resourceTypes.push(
          structuredClone(workspace.resourceTypes[0]),
        );
      },
      (workspace) => {
        workspace.costRows[0].reTypeId = 'missing';
      },
      (workspace) => {
        workspace.costVersions[0].costRows[0].reTypeId = 'missing';
      },
      (workspace) => {
        workspace.costRows[0].years.reverse();
      },
      (workspace) => {
        workspace.costVersions[0].sourceVersion = 'V99';
      },
      (workspace) => {
        workspace.processSteps = structuredClone(initialProcessSteps);
        workspace.currentWorkflowStepCode = '';
      },
      (workspace) => {
        workspace.processSteps = structuredClone(initialProcessSteps);
        workspace.currentWorkflowStepCode = initialProcessSteps[0].code;
        workspace.selectedStep = 999;
      },
    ];
    for (const mutate of mutations) {
      const document = structuredClone(first.workspace);
      mutate(document);
      assert.throws(() => repository.save(document.project.id, document, 1));
      assert.equal(repository.get(document.project.id).revision, 1);
    }
  } finally {
    repository.close();
  }
});

test('version rate snapshots preserve historical HQ travel after catalogue changes', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const first = repository.save('PRJ-TEST-001', makeWorkspace(), null);
    const document = structuredClone(first.workspace);
    const v1 = document.costVersions[0];
    v1.state = 'Suspended';
    const before = getHQTravelSummary(
      v1.costRows,
      v1.resourceTypes,
      v1.travelSettings,
    ).totalCost;
    document.costVersions.push({
      ...structuredClone(v1),
      code: 'V2',
      state: 'Draft',
      sourceVersion: 'V1',
    });
    document.activeVersion = 'V2';
    document.resourceTypes.forEach((resource) => {
      resource.mandaysPerMonth = 40;
      resource.mandayRate *= 2;
    });
    const saved = repository.save(
      document.project.id,
      document,
      first.revision,
    );
    const historical = saved.workspace.costVersions[0];
    assert.equal(historical.state, 'Suspended');
    assert.equal(
      getHQTravelSummary(
        historical.costRows,
        historical.resourceTypes,
        historical.travelSettings,
      ).totalCost,
      before,
    );
    assert.deepEqual(historical.costRows, first.workspace.costRows);
    assert.equal(saved.workspace.costRows[0].years[0].cost, 218400);
    // Explicitly applying today's catalogue to V2 is the only rate change.
    const updated = structuredClone(saved.workspace);
    updated.costVersions[1].resourceTypes = structuredClone(
      updated.resourceTypes,
    );
    const refreshed = repository.save(
      updated.project.id,
      updated,
      saved.revision,
    );
    assert.equal(refreshed.workspace.costRows[0].years[0].cost, 436800);
    assert.equal(
      refreshed.workspace.costVersions[0].costRows[0].years[0].cost,
      218400,
    );
  } finally {
    repository.close();
  }
});

import {
  RepositoryConflictError,
  migrateWorkspaceDocument,
  openWorkspaceRepository,
} from '../server/workspace-repository.mjs';
import {
  initialCostRows,
  initialManualCostInputs,
  initialRateSettings,
  initialTravelRows,
  initialTravelSettings,
} from '../features/cost/demo-data.ts';
import {
  initialResourceTypes,
  initialSubcontractItems,
} from '../features/master-data/demo-data.ts';
import {
  initialMaintenancePriceRecords,
  initialSupplementalCostItems,
} from '../features/master-data/domain.ts';
import {
  initialProcessSteps,
  projects,
} from '../features/projects/demo-data.ts';
import { initialProjectStatusDefinitions } from '../features/projects/types.ts';
import { initialPricingSettings } from '../features/quote/domain.ts';
import { makeCostSnapshot } from './helpers.mjs';

const costData = makeCostSnapshot();

const makeWorkspace = () => ({
  schemaVersion: '1.0.0',
  project: { ...costData.project, id: 'PRJ-TEST-001', name: 'Repository Test' },
  selectedStep: 0,
  processSteps: [],
  activeVersion: 'V1',
  costRows: costData.costRows,
  rateSettings: costData.rateSettings,
  resourceTypes: costData.resourceTypes,
  subcontractItems: [],
  supplementalCostItems: [],
  maintenancePriceRecords: [],
  travelSettings: costData.travelSettings,
  travelRows: [],
  travelUplift: 0,
  manualCosts: costData.manualCosts,
});

test('quote catalog migration preserves existing text, empty libraries and is idempotent', () => {
  const base = migrateWorkspaceDocument(makeWorkspace());
  delete base.assumptionLibrary;
  base.quoteAssumptions[0].text = 'My existing terms';
  base.quoteTemplates[0].paymentTerms = 'Existing payment';
  delete base.quoteTemplates[0].termsAndConditions;
  delete base.quoteTemplates[0].defaultAssumptionIds;
  const migrated = migrateWorkspaceDocument(base);
  assert.equal(migrated.assumptionLibrary[0].text, 'My existing terms');
  assert.equal(migrated.quoteTemplates[0].paymentTerms, 'Existing payment');
  assert.equal(migrated.quoteTemplates[0].termsAndConditions, '');
  assert.equal(migrateWorkspaceDocument(migrated), migrated);
  migrated.assumptionLibrary = [];
  assert.deepEqual(migrateWorkspaceDocument(migrated).assumptionLibrary, []);
});

test('quote catalog validates references atomically and preserves historical snapshots after deletion', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const input = migrateWorkspaceDocument(makeWorkspace());
    const template = input.quoteTemplates[0];
    template.termsAndConditions = 'Customer-specific T&C\n第二条';
    template.defaultAssumptionIds = [input.assumptionLibrary[0].id];
    input.quoteHistory = [
      {
        id: 'history-1',
        quoteNumber: 'QT-1',
        generatedAt: '2026-09-05T01:00:00.000Z',
        costVersion: 'V1',
        templateId: template.id,
        status: 'Draft',
        costAmount: 100,
        quoteBeforeTax: 125,
        gstAmount: 0,
        quoteAfterTax: 125,
        grossMarginPercent: 20,
        note: '',
        templateSnapshot: structuredClone(template),
        assumptionSnapshots: structuredClone(input.quoteAssumptions),
      },
    ];
    const saved = repository.save(input.project.id, input, null);
    assert.equal(
      saved.workspace.quoteTemplates[0].termsAndConditions,
      template.termsAndConditions,
    );
    for (const mutate of [
      (value) => value.quoteTemplates[0].defaultAssumptionIds.push('missing'),
      (value) =>
        value.assumptionLibrary.push(
          structuredClone(value.assumptionLibrary[0]),
        ),
      (value) => {
        value.assumptionLibrary[0].text = '   ';
      },
      (value) => {
        value.quoteTemplates[0].termsAndConditions = 'x'.repeat(20001);
      },
    ]) {
      const invalid = structuredClone(saved.workspace);
      mutate(invalid);
      assert.throws(() => repository.save(input.project.id, invalid, 1));
      assert.equal(repository.get(input.project.id).revision, 1);
    }
    const updated = structuredClone(saved.workspace);
    updated.assumptionLibrary = [];
    updated.quoteTemplates[0].defaultAssumptionIds = [];
    updated.quoteTemplates[0].termsAndConditions = 'New text';
    updated.quoteTemplates[0].id = 'replacement-template';
    updated.selectedQuoteTemplateId = 'replacement-template';
    const second = repository.save(input.project.id, updated, 1);
    assert.equal(
      second.workspace.quoteHistory[0].templateSnapshot.termsAndConditions,
      template.termsAndConditions,
    );
    assert.equal(
      second.workspace.quoteHistory[0].assumptionSnapshots.length,
      input.quoteAssumptions.length,
    );
  } finally {
    repository.close();
  }
});

test('SQLite repository creates, reads, lists, and revises one workspace', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const first = repository.save('PRJ-TEST-001', makeWorkspace(), null);
    assert.equal(first.revision, 1);
    assert.equal(first.workspace.project.name, 'Repository Test');
    assert.equal(first.workspace.projectStatus, 'solution_review');
    assert.deepEqual(
      first.workspace.projectStatusDefinitions,
      initialProjectStatusDefinitions,
    );
    assert.equal(first.workspace.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.equal(first.workspace.costVersions.length, 1);
    assert.equal(first.workspace.costVersions[0].code, 'V1');
    assert.equal(first.workspace.pricing.targetGrossMargin, 25);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);

    const changed = structuredClone(first.workspace);
    changed.project.name = 'Updated repository test';
    const second = repository.save('PRJ-TEST-001', changed, 1);
    assert.equal(second.revision, 2);
    assert.equal(
      repository.get('PRJ-TEST-001').workspace.project.name,
      'Updated repository test',
    );
    assert.deepEqual(
      repository.list().map((item) => item.projectId),
      ['PRJ-TEST-001'],
    );
    const [portfolioItem] = repository.list();
    assert.equal(portfolioItem.activeVersion, 'V1');
    assert.equal(portfolioItem.projectStatus, 'solution_review');
    assert.deepEqual(
      portfolioItem.statusDefinitions,
      initialProjectStatusDefinitions,
    );
    assert.equal(portfolioItem.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.equal(portfolioItem.workflowSteps.length, 1);
    assert.ok(portfolioItem.totalCost > 0);
    assert.ok(portfolioItem.totalQuote > portfolioItem.totalCost);
    assert.ok(portfolioItem.totalMandays > 0);
  } finally {
    repository.close();
  }
});

test('SQLite repository rejects stale saves and mismatched project ids', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    repository.save('PRJ-TEST-001', makeWorkspace(), null);
    assert.throws(
      () => repository.save('PRJ-TEST-001', makeWorkspace(), null),
      RepositoryConflictError,
    );
    assert.throws(
      () => repository.save('OTHER', makeWorkspace(), null),
      /must match/,
    );
    const invalidWorkflow = {
      ...migrateWorkspaceDocument(makeWorkspace()),
      processSteps: initialProcessSteps,
      currentWorkflowStepCode: 'MISSING-NODE',
    };
    assert.throws(
      () => repository.save('PRJ-TEST-001', invalidWorkflow, 1),
      /must reference processSteps/,
    );
    const invalidStatus = {
      ...migrateWorkspaceDocument(makeWorkspace()),
      projectStatus: 'missing_status',
    };
    assert.throws(
      () => repository.save('PRJ-TEST-001', invalidStatus, 1),
      /must reference projectStatusDefinitions/,
    );
  } finally {
    repository.close();
  }
});

test('legacy cost version states migrate without changing other snapshots', () => {
  const base = migrateWorkspaceDocument(makeWorkspace());
  const snapshot = base.costVersions[0];
  const legacy = {
    ...base,
    activeVersion: 'V3',
    costVersions: [
      { ...snapshot, code: 'V1', state: 'Pending freeze' },
      {
        ...structuredClone(snapshot),
        code: 'V2',
        state: 'Frozen',
        sourceVersion: 'V1',
      },
      {
        ...structuredClone(snapshot),
        code: 'V3',
        state: 'Superseded',
        sourceVersion: 'V2',
      },
    ],
  };
  const repository = openWorkspaceRepository(':memory:');
  try {
    const saved = repository.save('PRJ-TEST-001', legacy, null);
    assert.deepEqual(
      saved.workspace.costVersions.map((version) => version.state),
      ['Draft', 'Confirmed', 'Suspended'],
    );
    assert.deepEqual(
      saved.workspace.costVersions.map((version) => version.sourceVersion),
      [null, 'V1', 'V2'],
    );
  } finally {
    repository.close();
  }
});

test('editable project status names and custom codes persist into Project List', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const workspace = migrateWorkspaceDocument(makeWorkspace());
    workspace.projectStatusDefinitions[0].name = 'Scope Intake';
    workspace.projectStatusDefinitions[0].nameZh = '范围收集';
    workspace.projectStatusDefinitions.push({
      code: 'commercial_approval',
      name: 'Commercial Approval',
      nameZh: '商务审批',
      active: true,
    });
    workspace.projectStatus = 'commercial_approval';

    const saved = repository.save('PRJ-TEST-001', workspace, null);
    assert.equal(saved.workspace.projectStatus, 'commercial_approval');
    assert.equal(
      saved.workspace.projectStatusDefinitions[0].name,
      'Scope Intake',
    );
    const [portfolioItem] = repository.list();
    assert.equal(portfolioItem.projectStatus, 'commercial_approval');
    assert.equal(portfolioItem.statusDefinitions.at(-1).nameZh, '商务审批');
  } finally {
    repository.close();
  }
});

test('bundled UI defaults satisfy the durable workspace contract', () => {
  const project = projects[0];
  const workspace = {
    schemaVersion: '1.0.0',
    project: {
      id: project.id,
      name: project.name,
      client: project.client,
      currency: 'SGD',
    },
    selectedStep: 6,
    processSteps: initialProcessSteps,
    projectStatus: 'cost_review',
    activeVersion: 'V3',
    costVersions: [
      {
        code: 'V3',
        state: 'Draft',
        createdAt: '2026-09-04T01:42:00.000Z',
        sourceVersion: null,
        costRows: structuredClone(initialCostRows),
        rateSettings: structuredClone(initialRateSettings),
        travelSettings: structuredClone(initialTravelSettings),
        travelRows: structuredClone(initialTravelRows),
        travelUplift: 0,
        manualCosts: structuredClone(initialManualCostInputs),
      },
    ],
    costRows: initialCostRows,
    rateSettings: initialRateSettings,
    resourceTypes: initialResourceTypes,
    subcontractItems: initialSubcontractItems,
    supplementalCostItems: initialSupplementalCostItems,
    maintenancePriceRecords: initialMaintenancePriceRecords,
    travelSettings: initialTravelSettings,
    travelRows: initialTravelRows,
    travelUplift: 0,
    manualCosts: initialManualCostInputs,
    pricing: initialPricingSettings,
  };
  const repository = openWorkspaceRepository(':memory:');
  try {
    const saved = repository.save(project.id, workspace, null);
    assert.equal(saved.revision, 1);
    assert.equal(saved.workspace.costRows.length, initialCostRows.length);
    assert.equal(saved.workspace.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.equal(
      saved.workspace.projectStatusDefinitions.length,
      initialProjectStatusDefinitions.length,
    );
    assert.equal(
      saved.workspace.maintenancePriceRecords.length,
      initialMaintenancePriceRecords.length,
    );
  } finally {
    repository.close();
  }
});
