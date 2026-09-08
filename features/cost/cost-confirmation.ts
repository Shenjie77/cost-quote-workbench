/** Reviewable UI confirmation for an exact, already-calculated cost version. */
import { costBaselineKey } from '../cpq/domain';
import { costLockReason } from './cost-lock';
import { buildCostExportSnapshot } from './build-export-snapshot';
import { validateCostExportSnapshot } from './validation';
import {
  getCostStatementValues,
  getHQTravelSummary,
  totalRowMandays,
} from './domain';
import type { WorkbenchWorkspace } from '../workbench/workspace-types';

export function costConfirmationDetails(
  workspace: WorkbenchWorkspace,
  code: string,
) {
  const version = workspace.costVersions.find((v) => v.code === code);
  if (!version) throw new Error(`成本版本 ${code} 不存在。`);
  const resources = version.resourceTypes || workspace.resourceTypes;
  const issues = validateCostExportSnapshot(
    buildCostExportSnapshot({
      activeVersion: code,
      versionStatus: version.state,
      project: workspace.project,
      rateSettings: version.rateSettings,
      travelSettings: version.travelSettings,
      resourceTypes: resources,
      rows: version.costRows,
      manualCosts: version.manualCosts,
    }),
  );
  // An old immutable draft cannot repair missing TD dates. Confirming the same
  // stored amounts remains possible; export validation is intentionally unchanged.
  const legacyLocked =
    !!costLockReason(workspace, code) && version.state !== 'Confirmed';
  const displayIssues = issues.map((issue) =>
    legacyLocked && issue.code === 'DELIVERY_YEAR_REQUIRED'
      ? { ...issue, severity: 'warning' as const }
      : issue,
  );
  const travel = getHQTravelSummary(
    version.costRows,
    resources,
    version.travelSettings,
  ).totalCost;
  return {
    projectId: workspace.project.id,
    projectName: workspace.project.name,
    versionCode: code,
    costKey: costBaselineKey({ ...version, resourceTypes: resources }),
    totalCost: getCostStatementValues(
      version.costRows,
      resources,
      travel,
      version.manualCosts,
    ).totalWithRisk,
    totalMandays: version.costRows.reduce(
      (sum, row) => sum + totalRowMandays(row),
      0,
    ),
    issues: displayIssues,
    errors: displayIssues.filter((issue) => issue.severity === 'error'),
  };
}
export type CostConfirmationDetails = ReturnType<
  typeof costConfirmationDetails
>;

/** Call only after the user explicitly confirms the displayed cost fingerprint. */
export function confirmReviewedCost(
  workspace: WorkbenchWorkspace,
  code: string,
  expectedCostKey: string,
): WorkbenchWorkspace {
  const details = costConfirmationDetails(workspace, code);
  if (details.costKey !== expectedCostKey)
    throw new Error('成本已变化，请重新查看并确认当前金额。');
  if (details.errors.length)
    throw new Error(`请先修正成本：${details.errors[0].message}`);
  return {
    ...workspace,
    costVersions: workspace.costVersions.map((version) =>
      version.code === code ? { ...version, state: 'Confirmed' } : version,
    ),
  };
}

/** Prevent a delayed confirmation from replacing workflow or review evidence. */
export function workflowConfirmationFingerprint(workspace: WorkbenchWorkspace) {
  return JSON.stringify({
    workflowVersion: workspace.workflowVersion,
    processSteps: workspace.processSteps,
    currentWorkflowStepCode: workspace.currentWorkflowStepCode,
    reviewGates: workspace.reviewGates,
    ssr: workspace.ssr,
  });
}
