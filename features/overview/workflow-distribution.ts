/** Published definitions own dashboard labels/order; project snapshots own progress. */
import type { Project, WorkflowStep } from '../projects/types.ts';
import { projectWorkflowSteps } from '../projects/workflow-domain.ts';
import { workflowPhaseGroups } from '../projects/workflow-engine.ts';

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
  for (const project of projects)
    for (const code of currentProjectWorkflowNodeCodes(project)) {
      const members = counts.get(code) || new Set<string>();
      members.add(project.id);
      counts.set(code, members);
    }
  const current = definitions ?? [...recorded.values()];
  const publishedCodes = new Set(current.map((step) => step.code));
  const entry = (step: WorkflowStep, legacy: boolean) => ({
    step,
    legacy,
    count: counts.get(step.code)?.size || 0,
    projectIds: [...(counts.get(step.code) || [])],
  });
  return {
    nodes: current.map((step) => entry(step, false)),
    // Do not invent completion for old rounds whose terminal/current node was removed.
    retained: [...recorded.values()]
      .filter((step) => !publishedCodes.has(step.code) && counts.has(step.code))
      .map((step) => entry(step, true)),
  };
}
