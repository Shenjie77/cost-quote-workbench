/** Portfolio projections must retain exact financial totals and stale-response protections. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateWorkspaceMetrics,
  countIncompleteCostRows,
  filterPortfolioProjects,
  mergeWorkflowProjection,
} from '../features/workbench/workspace-projections.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { calculateBuCostAllocation } from '../features/quote/profit-share.ts';

/** Create a small captured-cost fixture whose totals are independently calculable. */
function metricInputs() {
  const workspace = createBlankWorkspace(
    projectRecord('METRICS', 'Cost projection', 'Client'),
    'input_preparation',
  );
  const resource = {
    ...workspace.resourceTypes[0],
    id: 'captured',
    category: 'internal',
    pool: 'LOCAL',
  };
  return {
    ...workspace,
    resourceTypes: [resource],
    costRows: [
      {
        id: 'row',
        scope: 'Design',
        bu: 'Network',
        reTypeId: 'captured',
        mdPerSite: 3,
        years: [{ bucket: 'Y1', sites: 2, cost: 60 }],
      },
    ],
    manualCosts: { ...workspace.manualCosts, riskContingency: 5 },
    pricing: { targetGrossMargin: 20, discount: 0, gstPercent: 9 },
  };
}

test('portfolio totals retain cost, risk, mandays and pre-tax quote without mutating captured inputs', () => {
  const inputs = metricInputs();
  const before = structuredClone(inputs);
  assert.deepEqual(
    calculateWorkspaceMetrics(inputs, calculateBuCostAllocation(inputs)),
    {
      serviceCost: 60,
      subcontractCost: 0,
      totalCost: 65,
      totalMandays: 6,
      totalQuote: 81.25,
      grossMarginPercent: 20,
    },
  );
  assert.deepEqual(inputs, before);
});

test('portfolio pricing includes captured BU profit share while total cost stays unchanged', () => {
  const inputs = metricInputs();
  inputs.pricing.profitShareRates = [
    { id: 'share', bu: 'Network', ratePercent: 10, active: true },
  ];
  inputs.pricing.targetGrossMargin = 25;
  const metrics = calculateWorkspaceMetrics(
    inputs,
    calculateBuCostAllocation(inputs),
  );
  assert.equal(metrics.totalCost, 65);
  assert.equal(metrics.totalQuote, 100);
  assert.equal(metrics.grossMarginPercent, 25);
});

test('incomplete rows distinguish direct mandays, legacy positive costs, and missing identities', () => {
  const valid = metricInputs().costRows[0];
  const rows = [
    valid,
    {
      ...valid,
      inputMode: 'mandays',
      mdPerSite: 0,
      years: [{ bucket: 'Y1', sites: 0, mandays: 2, cost: 0 }],
    },
    { ...valid, years: [{ bucket: 'Y1', sites: 0, cost: 1 }] },
    { ...valid, scope: ' ' },
    { ...valid, bu: '\t' },
    { ...valid, reTypeId: '' },
    { ...valid, mdPerSite: 0 },
    { ...valid, years: [{ bucket: 'Y1', sites: 0, mandays: 0, cost: 0 }] },
  ];
  const before = structuredClone(rows);
  assert.equal(countIncompleteCostRows(rows), 5);
  assert.deepEqual(rows, before);
});

test('portfolio search preserves identity, order and case-insensitive cross-field matching', () => {
  const projects = [
    projectRecord('P-1', 'Alpha', 'Client A'),
    projectRecord('P-2', 'Beta', 'Client B'),
  ];
  projects[1].version = 'V2';
  assert.equal(filterPortfolioProjects(projects, ' \n'), projects);
  assert.deepEqual(filterPortfolioProjects(projects, ' CLIENT b '), [
    projects[1],
  ]);
  assert.equal(filterPortfolioProjects(projects, 'p-1')[0], projects[0]);
  assert.deepEqual(filterPortfolioProjects(projects, 'a client'), projects);
  assert.deepEqual(filterPortfolioProjects(projects, 'V2'), [projects[1]]);
  assert.deepEqual(filterPortfolioProjects(projects, 'no match'), []);
});

test('workflow projections reject stale revisions and preserve unrelated rows and financial values', () => {
  const project = {
    ...projectRecord('P-1', 'Original', 'Client'),
    revision: 4,
    totalCost: 99,
  };
  const other = projectRecord('P-2', 'Other', 'Other client');
  const workspace = createBlankWorkspace(project, 'input_preparation');
  workspace.project.name = 'Renamed';
  workspace.costVersions[0].state = 'Confirmed';
  const before = structuredClone([project, other]);
  const record = { revision: 3, workspace, updatedAt: '2026-09-10T00:00:00Z' };
  const stale = mergeWorkflowProjection([project, other], record);
  assert.equal(stale[0], project);
  assert.equal(stale[1], other);
  const updated = mergeWorkflowProjection([project, other], {
    ...record,
    revision: 4,
  });
  assert.equal(updated[0].name, 'Renamed');
  assert.equal(updated[0].versionState, 'Confirmed');
  assert.equal(updated[0].totalCost, 99);
  assert.equal(updated[0].workflowSteps, workspace.processSteps);
  assert.equal(updated[1], other);
  assert.deepEqual([project, other], before);
});

test('workflow projection retains displayed version state when legacy snapshots lack the active version', () => {
  const project = {
    ...projectRecord('P-1', 'Legacy', 'Client'),
    versionState: 'Suspended',
  };
  const workspace = createBlankWorkspace(project, 'input_preparation');
  workspace.activeVersion = 'missing';
  const [updated] = mergeWorkflowProjection([project], {
    revision: 1,
    workspace,
  });
  assert.equal(updated.versionState, 'Suspended');
  assert.equal(project.revision, undefined);
});
