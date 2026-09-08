/** One company-workflow register; retained SSR records are historical evidence. */
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import type { WorkflowStep } from './types.ts';
import { workflowComplete } from './workflow-engine.ts';

export const QUOTE_COMPLETED = 'QUOTE_COMPLETED';
export type WorkflowUpdate = {
  action?: string;
  nodeCode?: string;
  fields?: Record<string, string>;
  startedAt?: string;
  dueAt?: string;
  id: string;
  costVersion: string;
  fromStepCode: string;
  toStepCode: string;
  owner: string;
  followUpDate: string;
  note: string;
  updatedAt: string;
};
export type ProjectWorkflowPatch = {
  currentWorkflowStepCode?: string;
  owner?: string;
  followUpDate?: string;
  note?: string;
};
export function requiresConfirmedWorkflowStage(
  workspace: { processSteps: WorkflowStep[] },
  stepCode: string,
): boolean {
  const target = workspace.processSteps.find((s) => s.code === stepCode);
  if (target?.requiresConfirmedCost !== undefined)
    return target.requiresConfirmedCost;
  return (
    [
      'DELIVERY_REVIEW',
      'COST_BASELINE_APPROVAL',
      'BUDGET_APPLICATION',
      'PROFESSIONAL_REVIEW',
      'BID_REVIEW',
      'QUOTE_DECISION',
      QUOTE_COMPLETED,
      'PRICING',
      'QUOTE_PACKAGE',
      'COMMERCIAL_ARCHIVE',
    ].includes(stepCode) ||
    /(^|[^A-Z])DRB([^A-Z]|$)/i.test(`${stepCode} ${target?.name || ''}`)
  );
}
export const PROJECT_WORKFLOW_STAGES = [
  ['SOLUTION_SCOPE', 'Proposal / Scope', '方案 / Scope', 'SSR'],
  ['TD_EFFORT_REVIEW', 'DTRB', 'DTRB 技术评审', 'TD'],
  ['COST_BUILD', 'Cost Preparation', '成本编制与确认', 'SSR'],
  ['DELIVERY_REVIEW', 'DRB', 'DRB 交付评审', 'PM'],
  ['BUDGET_APPLICATION', 'Budget Application', '概算申请', 'SSR'],
  ['PROFESSIONAL_REVIEW', 'Professional Reviews', '专业评审', 'SSR'],
  ['BID_REVIEW', 'Bid Responses / Review', '标书答复与评审', 'SSR'],
  ['QUOTE_DECISION', 'Quote Decision', '报价决策', 'SSR'],
  [QUOTE_COMPLETED, 'Quote Completed', '报价完成', 'SSR'],
] as const;

const stage = ([
  code,
  name,
  nameZh,
  owner,
]: (typeof PROJECT_WORKFLOW_STAGES)[number]): WorkflowStep => ({
  code,
  name,
  nameZh,
  owner,
  no: '01',
  state: 'not_started',
  tone: 'gray',
  date: '',
  dateZh: '',
  detail: '',
  detailZh: '',
  input: '',
  inputZh: '',
  required: code !== 'BID_REVIEW',
  followUpDate: '',
  note: '',
});
export function createProjectWorkflowSteps(): WorkflowStep[] {
  return PROJECT_WORKFLOW_STAGES.map((value, index) => ({
    ...stage(value),
    no: String(index + 1).padStart(2, '0'),
  }));
}
export function isProjectWorkflowComplete(workspace: {
  currentWorkflowStepCode?: string;
  workflowEngineVersion?: number;
  processSteps?: WorkflowStep[];
}): boolean {
  if (workspace.workflowEngineVersion === 1) return workflowComplete(workspace);
  return workspace.currentWorkflowStepCode === QUOTE_COMPLETED;
}
/** Current and custom stages survive; retired costing-tool steps are not extra workflow choices. */
export function projectWorkflowSteps(workspace: {
  processSteps?: WorkflowStep[];
  workflowSteps?: WorkflowStep[];
  currentWorkflowStepCode?: string;
}): WorkflowStep[] {
  const steps = workspace.processSteps || workspace.workflowSteps || [];
  const retired = new Set([
    'RATE_CONTRACT_IMPORT',
    'DIMENSION_CHECK',
    'COST_BASELINE_APPROVAL',
    'PRICING',
    'QUOTE_PACKAGE',
    'COMMERCIAL_ARCHIVE',
  ]);
  return steps.filter(
    (s) =>
      s.roundStart !== undefined ||
      !retired.has(s.code) ||
      s.code === workspace.currentWorkflowStepCode,
  );
}
export function projectWorkflowStatus(workspace: {
  currentWorkflowStepCode: string;
}): string {
  const code = workspace.currentWorkflowStepCode;
  if (code === QUOTE_COMPLETED) return 'completed';
  if (code === 'TD_EFFORT_REVIEW') return 'solution_review';
  if (code === 'DELIVERY_REVIEW' || code === 'COST_BASELINE_APPROVAL')
    return 'delivery_review';
  if (code === 'SOLUTION_SCOPE') return 'input_preparation';
  if (['RATE_CONTRACT_IMPORT', 'COST_BUILD', 'DIMENSION_CHECK'].includes(code))
    return 'costing';
  return 'quote_review';
}
/** Add the register without guessing historical company approvals or changing costs. */
export function normalizeProjectWorkflow<T extends WorkbenchWorkspace>(
  workspace: T,
): T {
  const w = structuredClone(workspace);
  if (w.workflowEngineVersion === 1) {
    w.workflowMode = 'project';
    w.projectStatus = workflowComplete(w) ? 'completed' : 'solution_review';
    w.selectedStep = Math.max(
      0,
      w.processSteps.findIndex(
        (step) => step.code === w.currentWorkflowStepCode,
      ),
    );
    if (w.workflowVersion && w.versionWorkflows)
      w.versionWorkflows[w.workflowVersion] = {
        currentWorkflowStepCode: w.currentWorkflowStepCode,
        processSteps: structuredClone(w.processSteps),
        projectStatus: w.projectStatus,
      };
    return w;
  }
  const legacyCompleted =
    w.workflowMode !== 'project' && w.projectStatus === 'completed';
  w.workflowMode = 'project';
  w.workflowUpdates ||= [];
  for (const value of w.processSteps.some((s) => s.roundStart !== undefined)
    ? []
    : PROJECT_WORKFLOW_STAGES) {
    if (!w.processSteps.some((s) => s.code === value[0]))
      w.processSteps.push(stage(value));
  }
  w.processSteps.forEach((s, i) => {
    s.no = String(i + 1).padStart(2, '0');
  });
  if (legacyCompleted) w.currentWorkflowStepCode = QUOTE_COMPLETED;
  if (!w.processSteps.some((s) => s.code === w.currentWorkflowStepCode))
    w.currentWorkflowStepCode = w.processSteps[0].code;
  w.selectedStep = w.processSteps.findIndex(
    (s) => s.code === w.currentWorkflowStepCode,
  );
  w.projectStatus = projectWorkflowStatus(w);
  if (!w.projectStatusDefinitions.some((s) => s.code === w.projectStatus))
    w.projectStatusDefinitions.push({
      code: w.projectStatus,
      name: w.projectStatus,
      nameZh: '',
      active: true,
    });
  if (w.workflowVersion && w.versionWorkflows) {
    w.versionWorkflows[w.workflowVersion] = {
      currentWorkflowStepCode: w.currentWorkflowStepCode,
      processSteps: structuredClone(w.processSteps),
      projectStatus: w.projectStatus,
    };
  }
  return w;
}
const validDate = (value: string) =>
  !value ||
  (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

/** Register the actual company-system position and follow-up details in one action. */
export function updateProjectWorkflow<T extends WorkbenchWorkspace>(
  workspace: T,
  patch: ProjectWorkflowPatch,
  updatedAt = new Date().toISOString(),
): T {
  for (const key of Object.keys(patch))
    if (
      !['currentWorkflowStepCode', 'owner', 'followUpDate', 'note'].includes(
        key,
      )
    )
      throw new TypeError(`Unsupported workflow field: ${key}`);
  if (!Object.keys(patch).length)
    throw new TypeError('At least one workflow change is required.');
  for (const value of Object.values(patch))
    if (typeof value !== 'string')
      throw new TypeError('Workflow fields must be text.');
  if (patch.followUpDate !== undefined && !validDate(patch.followUpDate))
    throw new TypeError('Follow-up date must be YYYY-MM-DD or empty.');
  if (patch.owner !== undefined && !patch.owner.trim())
    throw new TypeError('Workflow owner is required.');
  const w = normalizeProjectWorkflow(workspace);
  const fromStepCode = w.currentWorkflowStepCode;
  const target = w.processSteps.find(
    (s) => s.code === (patch.currentWorkflowStepCode ?? fromStepCode),
  );
  if (!target) throw new TypeError('Workflow stage does not exist.');
  const costVersion = w.workflowVersion || w.activeVersion;
  const needsConfirmed = requiresConfirmedWorkflowStage(w, target.code);
  if (
    target.code !== fromStepCode &&
    needsConfirmed &&
    w.costVersions.find((v) => v.code === costVersion)?.state !== 'Confirmed'
  )
    throw new TypeError(`请先确认成本 ${costVersion} (Confirmed)`);
  w.currentWorkflowStepCode = target.code;
  if (patch.owner !== undefined) target.owner = patch.owner.trim();
  if (patch.followUpDate !== undefined)
    target.followUpDate = patch.followUpDate;
  if (patch.note !== undefined) target.note = patch.note;
  target.updatedAt = updatedAt;
  target.state = target.code === QUOTE_COMPLETED ? 'completed' : 'in_progress';
  target.tone = target.code === QUOTE_COMPLETED ? 'green' : 'blue';
  w.workflowUpdates!.push({
    id: `workflow-${costVersion}-${updatedAt}-${w.workflowUpdates!.length + 1}`,
    costVersion,
    fromStepCode,
    toStepCode: target.code,
    owner: target.owner,
    followUpDate: target.followUpDate || '',
    note: target.note || '',
    updatedAt,
  });
  return normalizeProjectWorkflow(w);
}
