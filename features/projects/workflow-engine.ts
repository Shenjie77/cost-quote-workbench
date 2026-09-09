/** Configurable project tasks. Definitions and execution share stable IDs, never semantics encoded in names. */
import type { WorkflowStep } from './types.ts';
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';

export const WORKFLOW_ACTIONS = [
  'start',
  'complete',
  'skip',
  'update',
  'pause',
  'resume',
  'reopen',
  'hold_project',
  'resume_project',
] as const;
export type WorkflowAction = {
  nodeCode?: string;
  action: (typeof WORKFLOW_ACTIONS)[number];
  owner?: string;
  note?: string;
  followUpDate?: string;
  startedAt?: string;
  dueAt?: string;
  fields?: Record<string, string>;
  confirmed?: boolean;
  reason?: string;
};
export type WorkflowPhase = {
  id: string;
  name: string;
  parallel: boolean;
  steps: WorkflowStep[];
};
export type WorkflowUrgency = 'none' | 'normal' | 'immediate' | 'urgent';
export type WorkflowSyncPreview = {
  changed: boolean;
  changes: string[];
  blockers: string[];
  retained: string[];
  steps: WorkflowStep[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OFFSET = 8 * HOUR;
const terminal = (step: WorkflowStep) =>
  ['completed', 'skipped'].includes(step.state);
export const workflowNodeActive = (step: WorkflowStep) =>
  ['in_progress', 'awaiting_review', 'blocked'].includes(step.state);
export const workflowLocalDate = (time: string | number = Date.now()) =>
  new Date((typeof time === 'number' ? time : Date.parse(time)) + OFFSET)
    .toISOString()
    .slice(0, 10);
const timestamp = (value: string, field: string) => {
  const parsed = Date.parse(value);
  if (!value || !Number.isFinite(parsed))
    throw new TypeError(`${field} must be a valid date and time.`);
  return parsed;
};
const dateOnly = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const businessDay = (time: number, holidays: string[]) => {
  const day = new Date(time + OFFSET).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.includes(workflowLocalDate(time));
};
const dayStart = (time: number) =>
  Date.parse(`${workflowLocalDate(time)}T00:00:00+08:00`);
function nextBusinessTime(time: number, holidays: string[]) {
  let cursor = time;
  for (let i = 0; i < 4000; i++) {
    const start = dayStart(cursor);
    if (businessDay(cursor, holidays) && cursor < start + 18 * HOUR)
      return Math.max(cursor, start + 9 * HOUR);
    cursor = start + DAY + 9 * HOUR;
  }
  throw new TypeError('The work calendar has no available business days.');
}
function addBusinessTime(time: number, duration: number, holidays: string[]) {
  let cursor = nextBusinessTime(time, holidays);
  let remaining = duration;
  while (remaining > 0) {
    const available = dayStart(cursor) + 18 * HOUR - cursor;
    if (remaining <= available) return cursor + remaining;
    remaining -= available;
    cursor = nextBusinessTime(dayStart(cursor) + DAY + 9 * HOUR, holidays);
  }
  return cursor;
}
function businessDuration(from: number, until: number, holidays: string[]) {
  let cursor = nextBusinessTime(from, holidays);
  let total = 0;
  while (cursor < until) {
    total += Math.max(
      0,
      Math.min(until, dayStart(cursor) + 18 * HOUR) - cursor,
    );
    cursor = nextBusinessTime(dayStart(cursor) + DAY + 9 * HOUR, holidays);
  }
  return total;
}
export function workflowDueAt(step: WorkflowStep, startedAt: string) {
  const start = timestamp(startedAt, 'Start time');
  const days = step.slaDays ?? 3;
  return new Date(
    step.slaCalendar === 'calendar'
      ? start + days * DAY
      : addBusinessTime(start, days * 9 * HOUR, step.slaHolidays || []),
  ).toISOString();
}

/** Defaults are inferred once for old data; explicit booleans always take priority over old codes/names. */
export function normalizeWorkflowDefinition(step: WorkflowStep): WorkflowStep {
  const legacyDrb =
    [
      'DELIVERY_REVIEW',
      'COST_BASELINE_APPROVAL',
      'BUDGET_APPLICATION',
      'PROFESSIONAL_REVIEW',
      'BID_REVIEW',
      'QUOTE_DECISION',
      'QUOTE_COMPLETED',
      'PRICING',
      'QUOTE_PACKAGE',
      'COMMERCIAL_ARCHIVE',
    ].includes(step.code) ||
    /(^|[^A-Z])DRB([^A-Z]|$)/i.test(`${step.code} ${step.name}`);
  return {
    ...step,
    parallelGroup: step.parallelGroup ?? '',
    slaDays: step.slaDays ?? 3,
    slaCalendar: step.slaCalendar ?? 'business',
    slaHolidays: step.slaHolidays ?? [],
    reminderEnabled: step.reminderEnabled ?? true,
    requiredFields: step.requiredFields ?? [],
    roundStart: step.roundStart ?? step.code === 'TD_EFFORT_REVIEW',
    requiresConfirmedCost: step.requiresConfirmedCost ?? legacyDrb,
    finishesWorkflow: step.finishesWorkflow ?? step.code === 'QUOTE_COMPLETED',
    autoSkip: step.autoSkip ?? !step.required,
  };
}
export function workflowPhaseGroups(steps: WorkflowStep[]): WorkflowPhase[] {
  const phases: WorkflowPhase[] = [];
  for (const step of steps) {
    const id = step.parallelGroup
      ? `parallel:${step.parallelGroup}`
      : `node:${step.code}`;
    const previous = phases.at(-1);
    if (step.parallelGroup && previous?.id === id) previous.steps.push(step);
    else
      phases.push({
        id,
        name: step.parallelGroup || step.nameZh || step.name,
        parallel: !!step.parallelGroup,
        steps: [step],
      });
  }
  return phases;
}
export function validateWorkflowTemplate(input: WorkflowStep[]) {
  if (!input.length)
    throw new TypeError('The workflow must contain at least one node.');
  const codes = new Set<string>();
  const phases = new Set<string>();
  let priorGroup = '';
  for (const raw of input) {
    const step = normalizeWorkflowDefinition(raw);
    if (!step.code || codes.has(step.code))
      throw new TypeError('Each node must have a unique internal ID.');
    codes.add(step.code);
    if (!step.name.trim() || !step.owner.trim())
      throw new TypeError('Node name and default owner are required.');
    if (
      !Number.isInteger(step.slaDays) ||
      step.slaDays! < 1 ||
      step.slaDays! > 365
    )
      throw new TypeError('Node SLA must be between 1 and 365 days.');
    if (!['business', 'calendar'].includes(step.slaCalendar!))
      throw new TypeError('Invalid SLA calendar.');
    if (
      step.slaHolidays!.length > 366 ||
      step.slaHolidays!.some((d) => !dateOnly(d))
    )
      throw new TypeError('Holidays must use YYYY-MM-DD.');
    if (
      step.requiredFields!.some((field) => !field.trim()) ||
      new Set(step.requiredFields).size !== step.requiredFields!.length ||
      step.requiredFields!.length > 30
    )
      throw new TypeError(
        'Required field names must be nonempty and unique, with no more than 30 fields.',
      );
    if (step.required && step.autoSkip)
      throw new TypeError('Mandatory nodes cannot be skipped automatically.');
    if (step.parallelGroup && step.parallelGroup !== priorGroup) {
      if (phases.has(step.parallelGroup))
        throw new TypeError(
          'Nodes in the same parallel group must be consecutive.',
        );
      phases.add(step.parallelGroup);
    }
    priorGroup = step.parallelGroup || '';
  }
  const starts = input.filter((s) => normalizeWorkflowDefinition(s).roundStart);
  const finishes = input.filter(
    (s) => normalizeWorkflowDefinition(s).finishesWorkflow,
  );
  if (starts.length !== 1)
    throw new TypeError(
      'The workflow must define exactly one start node for a new cost round.',
    );
  const startPhase = workflowPhaseGroups(input).find((phase) =>
    phase.steps.some((step) => step.code === starts[0].code),
  )!;
  if (
    startPhase.steps.some(
      (s) => normalizeWorkflowDefinition(s).requiresConfirmedCost,
    )
  )
    throw new TypeError(
      'The start node and its parallel peers cannot require a confirmed cost for a new cost round.',
    );
  if (
    finishes.length !== 1 ||
    finishes[0].code !== input.at(-1)!.code ||
    finishes[0].parallelGroup
  )
    throw new TypeError(
      'The workflow must have one finish node, placed last and outside parallel groups.',
    );
  if (!finishes[0].required)
    throw new TypeError('The finish node must be mandatory.');
}

export function workflowComplete(workspace: {
  processSteps?: WorkflowStep[];
  workflowSteps?: WorkflowStep[];
  workflowEngineVersion?: number;
  currentWorkflowStepCode?: string;
}) {
  const steps = workspace.processSteps || workspace.workflowSteps || [];
  if (workspace.workflowEngineVersion === 1)
    return steps.some((s) => s.finishesWorkflow && s.state === 'completed');
  return workspace.currentWorkflowStepCode === 'QUOTE_COMPLETED';
}
export function workflowUrgency(
  step: WorkflowStep,
  now = new Date().toISOString(),
): WorkflowUrgency {
  const time = timestamp(now, 'Current time');
  const today = workflowLocalDate(time);
  if (step.state === 'paused') {
    if (!step.followUpDate || step.followUpDate > today) return 'none';
    return step.followUpDate < today ? 'urgent' : 'immediate';
  }
  if (!workflowNodeActive(step)) return 'none';
  if (step.dueAt) {
    const due = timestamp(step.dueAt, 'Due time');
    if (time > due) return 'urgent';
    if (workflowLocalDate(due) === today) return 'immediate';
  }
  if (step.followUpDate && step.followUpDate <= today) return 'immediate';
  return 'normal';
}
function projectExecution<T extends WorkbenchWorkspace>(w: T): T {
  const finished = w.processSteps.find(
    (s) => s.finishesWorkflow && s.state === 'completed',
  );
  const active = w.processSteps.filter(
    (s) => workflowNodeActive(s) || s.state === 'paused',
  );
  const current =
    finished ||
    active[0] ||
    w.processSteps.find((s) => !terminal(s)) ||
    w.processSteps.at(-1)!;
  w.currentWorkflowStepCode = current.code;
  w.selectedStep = w.processSteps.indexOf(current);
  w.projectStatus = finished ? 'completed' : 'solution_review';
  if (!w.projectStatusDefinitions.some((s) => s.code === w.projectStatus))
    w.projectStatusDefinitions.push({
      code: w.projectStatus,
      name: finished ? 'Completed' : 'In progress',
      nameZh: finished ? '已完成' : '进行中',
      active: true,
    });
  const version = w.workflowVersion || w.activeVersion;
  w.versionWorkflows ||= {};
  w.versionWorkflows[version] = {
    currentWorkflowStepCode: current.code,
    processSteps: structuredClone(w.processSteps),
    projectStatus: w.projectStatus,
  };
  return w;
}

/** No completed predecessor is fabricated when adopting a historical manual register. */
export function migrateWorkflowEngine<T extends WorkbenchWorkspace>(
  workspace: T,
  now = new Date().toISOString(),
): T {
  if (workspace.workflowEngineVersion === 1) return workspace;
  const w = structuredClone(workspace);
  w.workflowEngineVersion = 1;
  // Only unconfigured legacy tool steps retire. Published definitions may reuse
  // these stable codes; inspect the raw marker before normalization adds defaults.
  const retired = new Set([
    'RATE_CONTRACT_IMPORT',
    'DIMENSION_CHECK',
    'COST_BASELINE_APPROVAL',
    'PRICING',
    'QUOTE_PACKAGE',
    'COMMERCIAL_ARCHIVE',
  ]);
  w.processSteps = w.processSteps
    .filter(
      (s) =>
        s.roundStart !== undefined ||
        !retired.has(s.code) ||
        s.code === w.currentWorkflowStepCode ||
        s.state === 'completed',
    )
    .map(normalizeWorkflowDefinition);
  const completed =
    w.currentWorkflowStepCode === 'QUOTE_COMPLETED' ||
    w.projectStatus === 'completed';
  const currentIndex = w.processSteps.findIndex(
    (s) => s.code === w.currentWorkflowStepCode,
  );
  for (const [index, step] of w.processSteps.entries()) {
    if (!completed && index < currentIndex && !terminal(step)) {
      step.state = 'skipped';
      step.skippedBy = 'legacy-registration';
      step.note = [
        step.note,
        'Migration retains the previous workflow position; earlier nodes were not individually recorded and are not confirmed as completed.',
      ]
        .filter(Boolean)
        .join('; ');
    }
    if (step.finishesWorkflow && completed) {
      step.state = 'completed';
      step.completedAt ||= now;
    } else if (
      step.code === w.currentWorkflowStepCode &&
      !completed &&
      !terminal(step)
    ) {
      step.state = 'in_progress';
      step.startedAt ||= now;
      // A saved follow-up date remains a follow-up, not invented evidence of the SLA start.
      step.dueAt ||= workflowDueAt(step, step.startedAt);
    } else if (workflowNodeActive(step)) step.state = 'not_started';
  }
  return projectExecution(w);
}

export function resetWorkflowRoundSteps(
  input: WorkflowStep[],
  now = new Date().toISOString(),
): WorkflowStep[] {
  const steps = input.map((s, index) => ({
    ...normalizeWorkflowDefinition(s),
    no: String(index + 1).padStart(2, '0'),
  }));
  const start = steps.find((s) => s.roundStart) || steps[0];
  const phases = workflowPhaseGroups(steps);
  const startPhase = phases.findIndex((p) =>
    p.steps.some((s) => s.code === start.code),
  );
  for (const [index, phase] of phases.entries())
    for (const step of phase.steps) {
      step.state =
        index < startPhase
          ? 'skipped'
          : index === startPhase
            ? 'in_progress'
            : 'not_started';
      step.tone = index === startPhase ? 'blue' : 'gray';
      step.note =
        index < startPhase
          ? 'The new cost round starts at the configured node and retains the project details.'
          : '';
      step.startedAt = index === startPhase ? now : '';
      step.dueAt = index === startPhase ? workflowDueAt(step, now) : '';
      step.completedAt = index < startPhase ? now : '';
      step.pausedAt = '';
      step.fieldValues = {};
      step.followUpDate = '';
      step.updatedAt = now;
      step.skippedBy = index < startPhase ? 'new-cost-round' : '';
      step.date = step.dateZh = '';
    }
  return steps;
}

export function workflowActionBlockers(
  workspace: WorkbenchWorkspace,
  nodeCode: string,
): string[] {
  if (workspace.workflowHold)
    return ['Resume project monitoring before updating workflow steps.'];
  const steps = workspace.processSteps;
  const target = steps.find((s) => s.code === nodeCode);
  if (!target) return ['Node not found. Reload the workflow.'];
  const phases = workflowPhaseGroups(steps);
  const index = phases.findIndex((p) =>
    p.steps.some((s) => s.code === nodeCode),
  );
  const blockers = phases
    .slice(0, index)
    .flatMap((p) => p.steps)
    .filter(
      (s) =>
        s.required &&
        s.state !== 'completed' &&
        !['new-cost-round', 'legacy-registration'].includes(s.skippedBy || ''),
    )
    .map((s) => `Complete the mandatory node first: ${s.name || s.nameZh}`);
  const code = workspace.workflowVersion || workspace.activeVersion;
  if (
    target.requiresConfirmedCost &&
    workspace.costVersions.find((v) => v.code === code)?.state !== 'Confirmed'
  )
    blockers.push(`Confirm cost ${code} first (Confirmed).`);
  return blockers;
}
const event = (
  w: WorkbenchWorkspace,
  step: WorkflowStep,
  action: string,
  note: string,
  now: string,
  from: string,
) => {
  w.workflowUpdates ||= [];
  w.workflowUpdates.push({
    id: `workflow-${w.workflowVersion || w.activeVersion}-${now}-${w.workflowUpdates.length + 1}`,
    costVersion: w.workflowVersion || w.activeVersion,
    fromStepCode: from,
    toStepCode: step.code,
    nodeCode: step.code,
    fields: structuredClone(step.fieldValues || {}),
    startedAt: step.startedAt || '',
    dueAt: step.dueAt || '',
    action,
    owner: step.owner,
    followUpDate: step.followUpDate || '',
    note,
    updatedAt: now,
  });
};

/** Extend only time covered by this pause, using the node's working calendar. */
function shiftWorkflowDeadline(
  step: WorkflowStep,
  from: number,
  until: number,
) {
  if (!step.dueAt || until <= from) return;
  const due = timestamp(step.dueAt, 'Due time');
  const elapsed =
    step.slaCalendar === 'calendar'
      ? until - from
      : businessDuration(from, until, step.slaHolidays || []);
  step.dueAt = new Date(
    step.slaCalendar === 'calendar'
      ? due + elapsed
      : elapsed
        ? addBusinessTime(due, elapsed, step.slaHolidays || [])
        : due,
  ).toISOString();
}

function extendProjectHoldStep(
  step: WorkflowStep,
  heldAt: number,
  time: number,
  now: string,
) {
  if (terminal(step)) return;
  const from = Math.max(
    heldAt,
    step.startedAt ? timestamp(step.startedAt, 'Start time') : heldAt,
  );
  if (workflowNodeActive(step)) shiftWorkflowDeadline(step, from, time);
  // A separately paused node's own Resume includes this interval once.
  if (step.followUpDate && dateOnly(step.followUpDate)) {
    const days = Math.max(
      0,
      (Date.parse(workflowLocalDate(time)) -
        Date.parse(workflowLocalDate(from))) /
        DAY,
    );
    step.followUpDate = new Date(Date.parse(step.followUpDate) + days * DAY)
      .toISOString()
      .slice(0, 10);
  }
  if (workflowNodeActive(step) || step.state === 'paused' || step.followUpDate)
    step.updatedAt = now;
}

/** Restore deadlines for project holds completed while this older round was inactive. */
export function restoreProjectHoldDeadlines(
  workspace: Pick<WorkbenchWorkspace, 'processSteps' | 'workflowUpdates'>,
): WorkflowStep[] {
  const steps = structuredClone(workspace.processSteps);
  let heldAt: number | undefined;
  for (const update of workspace.workflowUpdates || []) {
    const time = Date.parse(update.updatedAt);
    if (!Number.isFinite(time)) continue;
    if (update.action === 'hold_project') heldAt = time;
    else if (update.action === 'resume_project' && heldAt !== undefined) {
      if (time >= heldAt)
        for (const step of steps) {
          const lastApplied =
            Date.parse(step.updatedAt || step.startedAt || '') || 0;
          if (time > lastApplied)
            extendProjectHoldStep(step, heldAt, time, update.updatedAt);
        }
      heldAt = undefined;
    }
  }
  return steps;
}

function applyProjectHold<T extends WorkbenchWorkspace>(
  w: T,
  request: WorkflowAction,
  now: string,
): T {
  if (Object.keys(request).some((key) => !['action', 'reason'].includes(key)))
    throw new TypeError('Project hold actions only accept action and reason.');
  if (
    request.reason !== undefined &&
    (typeof request.reason !== 'string' || request.reason.length > 2000)
  )
    throw new TypeError(
      'Project hold reason must be text of at most 2000 characters.',
    );
  const time = timestamp(now, 'Current time');
  if (request.action === 'hold_project') {
    if (workflowComplete(w))
      throw new TypeError(
        'This quotation round is complete and has no active monitoring to pause.',
      );
    if (w.workflowHold)
      throw new TypeError('Project monitoring is already on hold.');
    w.workflowHold = {
      startedAt: new Date(time).toISOString(),
      ...(request.reason?.trim() ? { reason: request.reason.trim() } : {}),
    };
  } else {
    if (!w.workflowHold)
      throw new TypeError('Project monitoring is not on hold.');
    const heldAt = timestamp(w.workflowHold.startedAt, 'Project hold time');
    if (time < heldAt)
      throw new TypeError('Resume time cannot precede the project hold.');
    for (const step of w.processSteps)
      extendProjectHoldStep(step, heldAt, time, now);
    delete w.workflowHold;
  }
  const step =
    w.processSteps.find((item) => item.code === w.currentWorkflowStepCode) ||
    w.processSteps[0];
  event(
    w,
    step,
    request.action,
    request.reason?.trim() ||
      (request.action === 'hold_project'
        ? 'Project monitoring placed on hold. Follow-ups are suspended until resumed.'
        : 'Project monitoring resumed. Active SLA deadlines exclude the project hold.'),
    now,
    w.currentWorkflowStepCode,
  );
  return projectExecution(w);
}

export function applyWorkflowAction<T extends WorkbenchWorkspace>(
  workspace: T,
  request: WorkflowAction,
  now = new Date().toISOString(),
): T {
  const allowed = new Set([
    'nodeCode',
    'action',
    'owner',
    'note',
    'followUpDate',
    'startedAt',
    'dueAt',
    'fields',
    'confirmed',
    'reason',
  ]);
  if (!request || Object.keys(request).some((key) => !allowed.has(key)))
    throw new TypeError('The workflow action contains unknown fields.');
  if (!WORKFLOW_ACTIONS.includes(request.action))
    throw new TypeError('Unsupported workflow action.');
  const w = structuredClone(migrateWorkflowEngine(workspace, now));
  if (request.action === 'hold_project' || request.action === 'resume_project')
    return applyProjectHold(w, request, now);
  if (w.workflowHold)
    throw new TypeError(
      'Resume project monitoring before updating workflow steps.',
    );
  const step = w.processSteps.find((s) => s.code === request.nodeCode);
  if (!step) throw new TypeError('Node not found. Reload the workflow.');
  if (workflowComplete(w))
    throw new TypeError(
      'This quotation round is complete. Create a new cost version if the requirements change.',
    );
  const before = w.currentWorkflowStepCode;
  const wasTerminal = terminal(step);
  if (wasTerminal && request.action !== 'reopen')
    throw new TypeError(
      'Completed or skipped nodes must be reopened before they can be changed.',
    );
  for (const field of [
    'owner',
    'note',
    'followUpDate',
    'startedAt',
    'dueAt',
    'reason',
  ] as const)
    if (request[field] !== undefined && typeof request[field] !== 'string')
      throw new TypeError(`${field} must be text.`);
  if (request.owner !== undefined && !request.owner.trim())
    throw new TypeError('A follow-up owner is required.');
  if (request.followUpDate && !dateOnly(request.followUpDate))
    throw new TypeError('The follow-up date must use YYYY-MM-DD.');
  if (
    request.fields &&
    (typeof request.fields !== 'object' ||
      Array.isArray(request.fields) ||
      Object.entries(request.fields).some(
        ([key, value]) =>
          !(step.requiredFields || []).includes(key) ||
          typeof value !== 'string',
      ))
  )
    throw new TypeError('Only fields configured for this node may be entered.');
  if (['start', 'complete', 'reopen'].includes(request.action)) {
    const blockers = workflowActionBlockers(w, step.code);
    if (blockers.length) throw new TypeError(blockers.join('; '));
  }
  if (request.action === 'skip' && step.required)
    throw new TypeError('Mandatory nodes cannot be skipped.');
  if (
    ['skip', 'pause', 'reopen'].includes(request.action) &&
    !request.reason?.trim()
  )
    throw new TypeError('Enter a reason for this action.');
  if (request.action === 'reopen') {
    if (!wasTerminal)
      throw new TypeError('Only completed or skipped nodes can be reopened.');
    const phases = workflowPhaseGroups(w.processSteps);
    const position = phases.findIndex((p) =>
      p.steps.some((s) => s.code === step.code),
    );
    if (
      phases
        .slice(position + 1)
        .some((p) => p.steps.some((s) => s.required && s.state === 'completed'))
    )
      throw new TypeError(
        'A later mandatory node is already complete. Create a new cost round to revisit an earlier node.',
      );
    step.state = 'not_started';
    step.completedAt = '';
    step.skippedBy = '';
    step.fieldValues = {};
  }
  if (request.owner !== undefined) step.owner = request.owner.trim();
  if (request.note !== undefined) step.note = request.note;
  if (request.followUpDate !== undefined)
    step.followUpDate = request.followUpDate;
  if (request.fields)
    step.fieldValues = { ...step.fieldValues, ...request.fields };
  if (request.startedAt !== undefined) {
    if (
      step.startedAt &&
      request.startedAt !== step.startedAt &&
      !request.reason?.trim()
    )
      throw new TypeError(
        'A reason is required to correct the actual start time.',
      );
    if (
      timestamp(request.startedAt, 'Start time') >
      timestamp(now, 'Current time')
    )
      throw new TypeError('The actual start time cannot be in the future.');
    step.startedAt = new Date(request.startedAt).toISOString();
    step.dueAt = workflowDueAt(step, step.startedAt);
  }
  if (request.dueAt !== undefined) {
    if (!request.reason?.trim())
      throw new TypeError(
        'A reason is required to change the SLA due time manually.',
      );
    if (
      timestamp(request.dueAt, 'Due time') <
      timestamp(step.startedAt || now, 'Start time')
    )
      throw new TypeError(
        'The due time cannot be earlier than the start time.',
      );
    step.dueAt = new Date(request.dueAt).toISOString();
  }
  if (request.action === 'start' || request.action === 'reopen') {
    if (step.state !== 'not_started')
      throw new TypeError(
        'This node has already started. Use Update or Resume.',
      );
    const phase = workflowPhaseGroups(w.processSteps).find((p) =>
      p.steps.some((s) => s.code === step.code),
    )!;
    for (const peer of phase.steps.filter((s) => s.state === 'not_started')) {
      const blockers = workflowActionBlockers(w, peer.code);
      if (blockers.length) throw new TypeError(blockers.join('; '));
      peer.state = 'in_progress';
      peer.tone = 'blue';
      peer.startedAt ||= step.startedAt || now;
      peer.dueAt ||= workflowDueAt(peer, peer.startedAt);
      peer.updatedAt = now;
      if (peer.code !== step.code)
        event(
          w,
          peer,
          'start',
          `Started in parallel with ${step.name || step.nameZh}.`,
          now,
          before,
        );
    }
  } else if (request.action === 'complete') {
    if (!workflowNodeActive(step))
      throw new TypeError('Start the node before confirming completion.');
    if (step.required && request.confirmed !== true)
      throw new TypeError(
        'Explicitly confirm the recorded information for a mandatory node.',
      );
    const missing = (step.requiredFields || []).filter(
      (key) => !step.fieldValues?.[key]?.trim(),
    );
    if (missing.length)
      throw new TypeError(
        `Complete the required fields: ${missing.join(', ')}`,
      );
    if (step.finishesWorkflow) {
      const unresolved = w.processSteps.filter(
        (other) =>
          other.code !== step.code &&
          !terminal(other) &&
          !other.required &&
          !other.autoSkip,
      );
      if (unresolved.length)
        throw new TypeError(
          `Complete or explicitly skip the unresolved nodes first: ${unresolved.map((other) => other.name || other.nameZh).join(', ')}`,
        );
    }
    step.state = 'completed';
    step.completedAt = now;
    step.tone = 'green';
    const phases = workflowPhaseGroups(w.processSteps);
    const position = phases.findIndex((p) =>
      p.steps.some((s) => s.code === step.code),
    );
    for (const prior of phases.slice(0, position).flatMap((p) => p.steps))
      if (!prior.required && prior.autoSkip && !terminal(prior)) {
        prior.state = 'skipped';
        prior.completedAt = now;
        prior.skippedBy = step.code;
        prior.tone = 'gray';
        prior.updatedAt = now;
        event(
          w,
          prior,
          'auto_skip',
          `Automatically skipped as configured after downstream node ${step.name || step.nameZh} completed.`,
          now,
          before,
        );
      }
  } else if (request.action === 'skip') {
    step.state = 'skipped';
    step.completedAt = now;
    step.skippedBy = 'manual';
    step.tone = 'gray';
  } else if (request.action === 'pause') {
    if (!workflowNodeActive(step))
      throw new TypeError('Only active nodes can be paused.');
    if (!request.followUpDate || request.followUpDate < workflowLocalDate(now))
      throw new TypeError('Set a resume follow-up date for today or later.');
    step.state = 'paused';
    step.pausedAt = now;
    step.tone = 'gray';
  } else if (request.action === 'resume') {
    if (step.state !== 'paused' || !step.pausedAt)
      throw new TypeError('Only paused nodes can be resumed.');
    const start = timestamp(step.pausedAt, 'Pause time');
    const end = timestamp(now, 'Resume time');
    if (end < start)
      throw new TypeError('Resume time cannot precede the node pause.');
    shiftWorkflowDeadline(step, start, end);
    step.state = 'in_progress';
    step.pausedAt = '';
    step.tone = 'blue';
    if (request.followUpDate === undefined) step.followUpDate = '';
  }
  step.updatedAt = now;
  event(
    w,
    step,
    request.action,
    request.reason?.trim() ||
      request.note ||
      `${step.name || step.nameZh}: ${request.action}`,
    now,
    before,
  );
  return projectExecution(w);
}

const configFields = [
  'name',
  'nameZh',
  'detail',
  'detailZh',
  'input',
  'inputZh',
  'required',
  'parallelGroup',
  'slaDays',
  'slaCalendar',
  'slaHolidays',
  'reminderEnabled',
  'requiredFields',
  'roundStart',
  'requiresConfirmedCost',
  'finishesWorkflow',
  'autoSkip',
] as const;
const runtimeFields = [
  'state',
  'tone',
  'startedAt',
  'dueAt',
  'completedAt',
  'pausedAt',
  'fieldValues',
  'skippedBy',
  'followUpDate',
  'note',
  'updatedAt',
  'date',
  'dateZh',
] as const;
export function previewWorkflowSync(
  workspace: WorkbenchWorkspace,
  definitions: WorkflowStep[],
  options: { migrateActive?: boolean } = {},
): WorkflowSyncPreview {
  validateWorkflowTemplate(definitions);
  if (workflowComplete(workspace))
    return {
      changed: false,
      changes: [],
      blockers: [],
      retained: ['Completed rounds retain their original workflow.'],
      steps: structuredClone(workspace.processSteps),
    };
  const old = workspace.processSteps;
  const byCode = new Map(old.map((s) => [s.code, s]));
  const changes: string[] = [],
    blockers: string[] = [],
    retained: string[] = [];
  const steps = definitions.map((raw) => {
    const definition = normalizeWorkflowDefinition(raw);
    const previous = byCode.get(definition.code);
    if (!previous) {
      changes.push(`Add: ${definition.name || definition.nameZh}`);
      return {
        ...definition,
        state: 'not_started' as const,
        tone: 'gray' as const,
        startedAt: '',
        dueAt: '',
        completedAt: '',
        pausedAt: '',
        fieldValues: {},
        skippedBy: '',
        followUpDate: '',
        note: '',
        updatedAt: '',
      };
    }
    if (terminal(previous)) {
      retained.push(`Retain history: ${previous.name || previous.nameZh}`);
      return structuredClone(previous);
    }
    const next = { ...definition, owner: previous.owner };
    for (const field of runtimeFields)
      Object.assign(next, { [field]: structuredClone(previous[field]) });
    if (workflowNodeActive(previous) || previous.state === 'paused') {
      if (!options.migrateActive) {
        for (const field of configFields)
          if (
            ![
              'name',
              'nameZh',
              'detail',
              'detailZh',
              'reminderEnabled',
            ].includes(field)
          )
            Object.assign(next, { [field]: structuredClone(previous[field]) });
        retained.push(
          `Retain execution rules and deadline: ${previous.name || previous.nameZh}`,
        );
      } else if (
        next.startedAt &&
        (previous.slaDays !== next.slaDays ||
          previous.slaCalendar !== next.slaCalendar ||
          JSON.stringify(previous.slaHolidays) !==
            JSON.stringify(next.slaHolidays))
      ) {
        if (workspace.workflowHold)
          blockers.push(
            'Resume project monitoring before migrating active SLA rules.',
          );
        else if (previous.state === 'paused')
          blockers.push(
            `Resume paused node ${previous.name || previous.nameZh} before migrating its SLA.`,
          );
        else next.dueAt = workflowDueAt(next, next.startedAt);
      }
    } else next.owner = definition.owner;
    if (JSON.stringify(next) !== JSON.stringify(previous))
      changes.push(`Update: ${next.name || next.nameZh}`);
    return next;
  });
  for (const previous of old)
    if (!definitions.some((s) => s.code === previous.code)) {
      if (workflowNodeActive(previous) || previous.state === 'paused') {
        blockers.push(
          `Cannot delete an active node: ${previous.name || previous.nameZh}`,
        );
        steps.splice(
          Math.min(old.indexOf(previous), steps.length),
          0,
          structuredClone(previous),
        );
      } else if (terminal(previous)) {
        retained.push(
          `Retain historical node: ${previous.name || previous.nameZh}`,
        );
        steps.splice(
          Math.min(old.indexOf(previous), steps.length),
          0,
          structuredClone(previous),
        );
      } else
        changes.push(
          `Remove a pending node: ${previous.name || previous.nameZh}`,
        );
    }
  // Retained active/history rules must still form a valid phase graph after merging.
  try {
    validateWorkflowTemplate(steps);
  } catch (error) {
    blockers.push(
      `The merged workflow is not executable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // A pending required gate may never be moved/inserted behind recorded progress.
  const phases = workflowPhaseGroups(steps);
  for (const [index, phase] of phases.entries())
    for (const step of phase.steps) {
      if (step.required && step.state === 'not_started') {
        if (
          phases
            .slice(index + 1)
            .some((p) =>
              p.steps.some(
                (s) =>
                  workflowNodeActive(s) ||
                  s.state === 'paused' ||
                  s.state === 'completed',
              ),
            )
        )
          blockers.push(
            `Mandatory node ${step.name || step.nameZh} is before recorded progress. Adjust the workflow or complete this node first.`,
          );
      }
    }
  steps.forEach((s, i) => {
    s.no = String(i + 1).padStart(2, '0');
  });
  if (old.map((s) => s.code).join('|') !== steps.map((s) => s.code).join('|'))
    changes.push('Node order updated.');
  return {
    changed: JSON.stringify(old) !== JSON.stringify(steps),
    changes: [...new Set(changes)],
    blockers: [...new Set(blockers)],
    retained,
    steps,
  };
}
export function applyWorkflowTemplate<T extends WorkbenchWorkspace>(
  workspace: T,
  definitions: WorkflowStep[],
  revision: number,
  options: { migrateActive?: boolean } = {},
  now = new Date().toISOString(),
): T {
  const w = structuredClone(migrateWorkflowEngine(workspace, now));
  const plan = previewWorkflowSync(w, definitions, options);
  if (plan.blockers.length) throw new TypeError(plan.blockers.join('; '));
  if (
    workflowComplete(w) ||
    (!plan.changed && w.workflowTemplateRevision === revision)
  )
    return w;
  const before = w.currentWorkflowStepCode;
  w.processSteps = plan.steps;
  w.workflowTemplateRevision = revision;
  const step =
    w.processSteps.find((s) => s.code === before) || w.processSteps[0];
  event(
    w,
    step,
    'template_sync',
    `Global workflow r${revision}: ${plan.changes.join('; ') || 'Definitions match; existing execution rules retained.'}`,
    now,
    before,
  );
  return projectExecution(w);
}
