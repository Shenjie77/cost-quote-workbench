/** Published definitions own dashboard labels/order; project snapshots own progress. */
import type { Project, WorkflowStep } from '../projects/types.ts';
import { projectWorkflowSteps } from '../projects/workflow-domain.ts';
import {
  workflowComplete,
  workflowPhaseGroups,
} from '../projects/workflow-engine.ts';

/** Locate recorded progress, including completed rounds retained for portfolio filtering. */
export function currentProjectWorkflowNodeCodes(project: Project): string[] {
  if (project.workflowEngineVersion !== 1)
    return project.currentWorkflowStepCode
      ? [project.currentWorkflowStepCode]
      : [];
  const steps = project.workflowSteps || [];
  const finish = steps.find(
    (step) => step.finishesWorkflow && step.state === 'completed',
  );
  if (finish) return [finish.code];
  const ongoing = steps.filter((step) =>
    ['in_progress', 'awaiting_review', 'blocked', 'paused'].includes(
      step.state,
    ),
  );
  if (ongoing.length) return ongoing.map((step) => step.code);
  return (
    workflowPhaseGroups(steps)
      .find((phase) => phase.steps.some((step) => step.state === 'not_started'))
      ?.steps.filter((step) => step.state === 'not_started')
      .map((step) => step.code) || []
  );
}

/** Count unresolved current tasks while excluding completed rounds and project-wide holds. */
export function pendingProjectWorkflowNodeCodes(project: Project): string[] {
  // A new engine-owned round can reopen a project whose manual status still says completed.
  const completed =
    project.workflowEngineVersion === 1 || project.workflowMode === 'project'
      ? workflowComplete(project)
      : project.projectStatus === 'completed';
  if (project.workflowHold || completed) return [];

  // Node-level pauses remain outstanding work; future phases are excluded by current-node selection.
  return [...new Set(currentProjectWorkflowNodeCodes(project))];
}

/** Keep published order and labels while exposing both historical position and pending task counts. */
export function buildWorkflowDistribution(
  projects: Project[],
  definitions?: WorkflowStep[],
) {
  // A fallback is useful for offline/legacy callers, but never overrides a published definition.
  const recorded = new Map<string, WorkflowStep>();
  for (const project of [...projects].sort(
    (a, b) =>
      (b.workflowTemplateRevision || 0) - (a.workflowTemplateRevision || 0),
  ))
    for (const step of projectWorkflowSteps(project))
      if (!recorded.has(step.code)) recorded.set(step.code, step);
  const counts = new Map<string, Set<string>>();
  const pendingCounts = new Map<string, Set<string>>();
  for (const project of projects) {
    // Existing position counts continue to include held projects and completed terminal nodes.
    for (const code of currentProjectWorkflowNodeCodes(project)) {
      const members = counts.get(code) || new Set<string>();
      members.add(project.id);
      counts.set(code, members);
    }
    // Use stable project IDs so duplicate records cannot inflate a node's pending count.
    for (const code of pendingProjectWorkflowNodeCodes(project)) {
      const members = pendingCounts.get(code) || new Set<string>();
      members.add(project.id);
      pendingCounts.set(code, members);
    }
  }
  const current = definitions ?? [...recorded.values()];
  const publishedCodes = new Set(current.map((step) => step.code));
  const entry = (step: WorkflowStep, legacy: boolean) => ({
    step,
    legacy,
    count: counts.get(step.code)?.size || 0,
    projectIds: [...(counts.get(step.code) || [])],
    pendingCount: pendingCounts.get(step.code)?.size || 0,
    pendingProjectIds: [...(pendingCounts.get(step.code) || [])],
  });
  return {
    nodes: current.map((step) => entry(step, false)),
    // Do not invent completion for old rounds whose terminal/current node was removed.
    retained: [...recorded.values()]
      .filter((step) => !publishedCodes.has(step.code) && counts.has(step.code))
      .map((step) => entry(step, true)),
  };
}
