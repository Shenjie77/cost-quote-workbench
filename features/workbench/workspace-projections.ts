/** Pure display projections shared by the session and its regression tests. */
import {
  getCostStatementValues,
  getHQTravelSummary,
  roundMoney,
  totalRowMandays,
  type CostInputRow,
} from '../cost/domain.ts';
import type { Project } from '../projects/types.ts';
import { calculatePricing } from '../quote/domain.ts';
import type { BuCostAllocation } from '../quote/profit-share.ts';
import type { WorkbenchWorkspace, WorkspaceRecord } from './workspace-types.ts';

type WorkspaceMetricInputs = Pick<
  WorkbenchWorkspace,
  | 'costRows'
  | 'resourceTypes'
  | 'travelSettings'
  | 'manualCosts'
  | 'subcontractCost'
  | 'pricing'
>;

/**
 * Calculate portfolio totals with the same captured rates and pricing engines as
 * the cost and quote pages. Resource types must come from the selected version.
 */
export function calculateWorkspaceMetrics(
  inputs: WorkspaceMetricInputs,
  costAllocation: BuCostAllocation,
) {
  const {
    costRows,
    resourceTypes,
    travelSettings,
    manualCosts,
    subcontractCost,
    pricing,
  } = inputs;
  // Preserve the statement's rounding boundaries before applying quotation pricing.
  const travelCost = getHQTravelSummary(
    costRows,
    resourceTypes,
    travelSettings,
  ).totalCost;
  const statement = getCostStatementValues(
    costRows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );
  const quote = calculatePricing(
    statement.totalWithRisk,
    pricing,
    costAllocation,
  );
  return {
    serviceCost: roundMoney(statement.service - statement.subcontract),
    subcontractCost: statement.subcontract,
    totalCost: statement.totalWithRisk,
    totalMandays: costRows.reduce((sum, row) => sum + totalRowMandays(row), 0),
    totalQuote: quote.quoteBeforeTax,
    grossMarginPercent: quote.grossMarginPercent,
  };
}

/** Count missing identities or effort while retaining legacy positive-cost entries. */
export function countIncompleteCostRows(rows: CostInputRow[]): number {
  return rows.filter(
    (row) =>
      !row.scope.trim() ||
      !row.bu.trim() ||
      !row.reTypeId.trim() ||
      (row.inputMode !== 'mandays' && row.mdPerSite <= 0) ||
      !row.years.some(
        (year) => year.sites > 0 || (year.mandays || 0) > 0 || year.cost > 0,
      ),
  ).length;
}

/** Filter the visible portfolio only; an empty search retains the original array. */
export function filterPortfolioProjects(
  projects: Project[],
  searchQuery: string,
): Project[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return projects;
  return projects.filter((project) =>
    [project.id, project.name, project.client, project.version]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

/**
 * Merge authoritative workflow metadata into the project index without replacing
 * newer revisions, financial totals, or unrelated projects.
 */
export function mergeWorkflowProjection(
  projects: Project[],
  record: WorkspaceRecord,
): Project[] {
  const workspace = record.workspace;
  return projects.map((project) => {
    // A delayed response must not undo a newer portfolio refresh.
    if (
      project.id !== workspace.project.id ||
      (project.revision || 0) > record.revision
    )
      return project;
    return {
      ...project,
      revision: record.revision,
      name: workspace.project.name,
      client: workspace.project.client,
      proposalNumber: workspace.ssr?.proposalNumber ?? '',
      workflowEngineVersion: workspace.workflowEngineVersion,
      workflowTemplateRevision: workspace.workflowTemplateRevision,
      workflowMode: workspace.workflowMode,
      workflowHold: workspace.workflowHold,
      workflowVersion: workspace.workflowVersion,
      projectStatus: workspace.projectStatus,
      currentWorkflowStepCode: workspace.currentWorkflowStepCode,
      workflowSteps: workspace.processSteps,
      versionState:
        workspace.costVersions.find(
          (version) => version.code === workspace.activeVersion,
        )?.state || project.versionState,
    };
  });
}
