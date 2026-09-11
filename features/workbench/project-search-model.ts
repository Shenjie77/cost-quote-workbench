/** Read-only portfolio search shares the dashboard's definition of current workflow work. */
import type { Project, WorkflowStep } from '../projects/types.ts';
import {
  currentProjectWorkflowNodeCodes,
  pendingProjectWorkflowNodeCodes,
} from '../overview/workflow-distribution.ts';
import { workflowComplete } from '../projects/workflow-engine.ts';
import { workflowStateLabels } from '../projects/workflow-constants.ts';

/** Normalize full-width input and whitespace while preserving Chinese and other project-name scripts. */
function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Match the workflow engine's completion evidence instead of a stale manual completed status. */
function projectIsComplete(project: Project): boolean {
  return project.workflowEngineVersion === 1 ||
    project.workflowMode === 'project'
    ? workflowComplete(project)
    : project.projectStatus === 'completed';
}

/** English and Chinese names stay useful independently when one translation is absent. */
function bilingualName(english?: string, chinese?: string): string {
  return [...new Set([english, chinese].filter(Boolean))].join(' / ');
}

/** Resolve current phases, holds and finish evidence without indexing already-completed historical steps. */
export function projectWorkflowSearchInfo(project: Project): {
  summary: string;
  terms: string[];
} {
  const completed = projectIsComplete(project);
  const held = !!project.workflowHold;
  const pending = pendingProjectWorkflowNodeCodes(project);
  const codes = pending.length
    ? pending
    : currentProjectWorkflowNodeCodes(project);
  const snapshots = project.workflowSteps || [];
  const terms: string[] = [];
  const summaries: string[] = [];

  // The same codes describe parallel active peers and the next ready phase, never all future stages.
  for (const code of codes) {
    const step = snapshots.find((item) => item.code === code);
    if (step && !isCurrentSearchStep(step, completed)) continue;
    const label =
      workflowStateLabels[
        held ? 'paused' : completed ? 'completed' : step?.state || 'not_started'
      ];
    const name = bilingualName(step?.name, step?.nameZh) || code;
    terms.push(
      code,
      name,
      label.en,
      label.zh,
      held ? 'paused' : completed ? 'completed' : step?.state || 'not_started',
    );
    summaries.push(`${name} · ${label.en} / ${label.zh}`);
  }

  // A project-wide pause overrides node status for search while retaining the current node names.
  if (held) terms.push('on_hold', 'On hold', 'Paused', '暂停', '已暂停');
  else if (completed) terms.push('completed', 'Completed', '完成', '已完成');
  if (summaries.length) return { summary: summaries.join(' · '), terms };
  if (held) return { summary: 'On hold / 已暂停', terms };
  if (completed) return { summary: 'Completed / 已完成', terms };

  // Legacy records without current workflow evidence can still be found by their saved project status.
  if (project.workflowEngineVersion !== 1 && !codes.length) {
    const status = project.statusDefinitions?.find(
      (item) => item.code === project.projectStatus,
    );
    const label =
      bilingualName(status?.name, status?.nameZh) ||
      bilingualName(project.stage, project.stageZh);
    if (project.projectStatus) terms.push(project.projectStatus);
    if (label) {
      terms.push(label);
      return { summary: label, terms };
    }
  }
  return { summary: 'No current workflow / 暂无当前流程', terms };
}

/** Only an actual terminal finish node is searchable after the workflow completes. */
function isCurrentSearchStep(step: WorkflowStep, completed: boolean): boolean {
  return completed
    ? !!step.finishesWorkflow || step.code === 'QUOTE_COMPLETED'
    : step.state !== 'completed' && step.state !== 'skipped';
}

/** Search all query words across identity and effective workflow fields without mutating or reordering projects. */
export function searchProjects(projects: Project[], query: string): Project[] {
  const words = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!words.length) return [...projects];
  return projects.filter((project) => {
    const searchable = normalizeSearchText(
      [
        project.proposalNumber,
        project.name,
        project.nameZh,
        project.id,
        project.client,
        project.clientZh,
        project.version,
        ...projectWorkflowSearchInfo(project).terms,
      ]
        .filter(Boolean)
        .join(' '),
    );
    return words.every((word) => searchable.includes(word));
  });
}
