/** Validate the intended node operation before a separate cost-confirmation write. */
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import { applyWorkflowAction, type WorkflowAction } from './workflow-engine.ts';
import { requiresConfirmedWorkflowStage } from './workflow-domain.ts';

export function preflightWorkflowAction(
  workspace: WorkbenchWorkspace,
  action: WorkflowAction,
  now = new Date().toISOString(),
) {
  const versionCode = workspace.workflowVersion || workspace.activeVersion;
  const node = workspace.processSteps.find(
    (step) => step.code === action.nodeCode,
  );
  const peers =
    ['start', 'reopen'].includes(action.action) && node?.parallelGroup
      ? workspace.processSteps.filter(
          (step) =>
            step.parallelGroup === node.parallelGroup &&
            step.state === 'not_started',
        )
      : [];
  const needsCostConfirmation =
    ['start', 'complete', 'reopen'].includes(action.action) &&
    [node, ...peers].some(
      (step) => step && requiresConfirmedWorkflowStage(workspace, step.code),
    ) &&
    workspace.costVersions.find((version) => version.code === versionCode)
      ?.state !== 'Confirmed';
  const validationCopy = needsCostConfirmation
    ? {
        ...workspace,
        costVersions: workspace.costVersions.map((version) =>
          version.code === versionCode
            ? { ...version, state: 'Confirmed' as const }
            : version,
        ),
      }
    : workspace;
  // Pure simulation checks prerequisites, field confirmation and action eligibility.
  // The repository repeats these checks against the revision used for the actual write.
  applyWorkflowAction(validationCopy, action, now);
  return { versionCode, needsCostConfirmation };
}
