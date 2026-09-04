import assert from 'node:assert/strict';
import test from 'node:test';

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

test('SQLite repository creates, reads, lists, and revises one workspace', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    const first = repository.save('PRJ-TEST-001', makeWorkspace(), null);
    assert.equal(first.revision, 1);
    assert.equal(first.workspace.project.name, 'Repository Test');
    assert.equal(first.workspace.projectStatus, 'input_preparation');
    assert.deepEqual(
      first.workspace.projectStatusDefinitions,
      initialProjectStatusDefinitions,
    );
    assert.equal(first.workspace.currentWorkflowStepCode, '');
    assert.equal(first.workspace.costVersions.length, 1);
    assert.equal(first.workspace.costVersions[0].code, 'V1');
    assert.equal(first.workspace.pricing.targetGrossMargin, 25);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);

    const changed = makeWorkspace();
    changed.selectedStep = 3;
    const second = repository.save('PRJ-TEST-001', changed, 1);
    assert.equal(second.revision, 2);
    assert.equal(repository.get('PRJ-TEST-001').workspace.selectedStep, 3);
    assert.deepEqual(
      repository.list().map((item) => item.projectId),
      ['PRJ-TEST-001'],
    );
    const [portfolioItem] = repository.list();
    assert.equal(portfolioItem.activeVersion, 'V1');
    assert.equal(portfolioItem.projectStatus, 'delivery_review');
    assert.deepEqual(
      portfolioItem.statusDefinitions,
      initialProjectStatusDefinitions,
    );
    assert.equal(portfolioItem.currentWorkflowStepCode, '');
    assert.deepEqual(portfolioItem.workflowSteps, []);
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
    assert.equal(
      saved.workspace.currentWorkflowStepCode,
      'COST_BASELINE_APPROVAL',
    );
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
