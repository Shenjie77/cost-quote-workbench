/** Version-owned workflow cycles. Cost browsing never switches the review round. */
import type { WorkflowStep } from '../projects/types.ts';
import type { CostVersionSnapshot } from './domain.ts';
import { requiresConfirmedWorkflowStage } from '../projects/workflow-domain.ts';
import {
  resetWorkflowRoundSteps,
  restoreProjectHoldDeadlines,
} from '../projects/workflow-engine.ts';
import {
  isApproved,
  isStale,
  latestResult,
  type SsrWorkspace,
} from '../ssr/domain.ts';

export type VersionWorkflowSnapshot = {
  currentWorkflowStepCode: string;
  processSteps: WorkflowStep[];
  projectStatus: string;
};
type Gate = {
  id: string;
  gate: string;
  workflowStepCode: string;
  status: string;
  costVersion?: string;
};
export type WorkflowWorkspace = VersionWorkflowSnapshot & {
  workflowUpdates?: import('../projects/workflow-domain.ts').WorkflowUpdate[];
  workflowEngineVersion?: 1;
  workflowMode?: 'project';
  activeVersion: string;
  costVersions: CostVersionSnapshot[];
  deletedCostVersions?: import('./version-deletion.ts').DeletedCostVersions;
  selectedStep?: number;
  workflowVersion?: string;
  versionWorkflows?: Record<string, VersionWorkflowSnapshot>;
  legacyWorkflowArchive?: Record<string, VersionWorkflowSnapshot>;
  reviewGates?: Gate[];
  projectStatusDefinitions?: { code: string; active?: boolean }[];
  ssr?: SsrWorkspace;
};
type StepIdentity = {
  code: string;
  name?: string;
  roundStart?: boolean;
  requiresConfirmedCost?: boolean;
};
const explicit = (step: StepIdentity, token: 'DTRB' | 'DRB') =>
  new RegExp(`(^|[^A-Z])${token}([^A-Z]|$)`, 'i').test(
    `${step.code} ${step.name || ''}`,
  );
export const isDtrbStep = (step: StepIdentity) =>
  step.roundStart !== undefined
    ? step.roundStart
    : step.code === 'TD_EFFORT_REVIEW' || explicit(step, 'DTRB');
export const isDrbStep = (step: StepIdentity) =>
  step.requiresConfirmedCost !== undefined
    ? step.requiresConfirmedCost
    : ['DELIVERY_REVIEW', 'COST_BASELINE_APPROVAL'].includes(step.code) ||
      explicit(step, 'DRB');
const clone = <T>(value: T): T => structuredClone(value);
const snapshot = (w: VersionWorkflowSnapshot): VersionWorkflowSnapshot => ({
  currentWorkflowStepCode: w.currentWorkflowStepCode,
  processSteps: clone(w.processSteps),
  projectStatus: w.projectStatus,
});
const versionRank = (code: string) =>
  /^V[1-9][0-9]*$/.test(code) ? BigInt(code.slice(1)) : BigInt(0);
const highestVersion = (w: WorkflowWorkspace) =>
  w.costVersions.reduce<(typeof w.costVersions)[number] | undefined>(
    (highest, v) =>
      !highest || versionRank(v.code) > versionRank(highest.code) ? v : highest,
    undefined,
  );
const knownVersion = (w: WorkflowWorkspace, code: string | undefined) =>
  !!code && w.costVersions.some((v) => v.code === code);
const canonicalStep = (kind: 'DTRB' | 'DRB'): WorkflowStep => ({
  code: kind === 'DTRB' ? 'TD_EFFORT_REVIEW' : 'DELIVERY_REVIEW',
  no: '',
  name: kind === 'DTRB' ? 'DTRB / TD Effort Review' : 'DRB / Delivery Review',
  nameZh: kind === 'DTRB' ? 'DTRB 技术评审' : 'DRB 交付评审',
  owner: kind === 'DTRB' ? 'TD' : 'PM',
  state: 'not_started',
  tone: 'gray',
  date: '',
  dateZh: '',
  detail: '',
  detailZh: '',
  input: '',
  inputZh: '',
  required: true,
});
const ensureStep = (steps: WorkflowStep[], kind: 'DTRB' | 'DRB'): number => {
  const match = kind === 'DTRB' ? isDtrbStep : isDrbStep;
  const found = steps.findIndex(match);
  if (found >= 0) return found;
  const before = kind === 'DTRB' ? steps.findIndex(isDrbStep) : -1;
  const index =
    kind === 'DTRB'
      ? before >= 0
        ? before
        : Math.min(
            steps.findIndex((s) => s.code === 'SOLUTION_SCOPE') + 1,
            steps.length,
          )
      : ensureStep(steps, 'DTRB') + 1;
  steps.splice(index, 0, canonicalStep(kind));
  steps.forEach((s, i) => {
    s.no = String(i + 1).padStart(2, '0');
  });
  return index;
};
const draftStatus = (w: WorkflowWorkspace) => {
  if (!w.projectStatusDefinitions) return 'solution_review';
  return (
    ['solution_review', 'costing', 'input_preparation'].find((code) =>
      w.projectStatusDefinitions?.some(
        (s) => s.code === code && s.active !== false,
      ),
    ) || w.projectStatus
  );
};
const freshCycle = (w: WorkflowWorkspace): VersionWorkflowSnapshot => {
  if (w.workflowEngineVersion === 1) {
    const steps = resetWorkflowRoundSteps(w.processSteps);
    return {
      currentWorkflowStepCode:
        steps.find((s) => s.roundStart)?.code || steps[0].code,
      processSteps: steps,
      projectStatus: draftStatus(w),
    };
  }
  const steps = clone(w.processSteps);
  const start = ensureStep(steps, 'DTRB');
  for (let i = start; i < steps.length; i++) {
    steps[i] = {
      ...steps[i],
      state: 'not_started',
      tone: 'gray',
      date: '',
      dateZh: '',
      input: '',
      inputZh: '',
      detail: '',
      detailZh: '',
      followUpDate: '',
      note: '',
      updatedAt: '',
    };
  }
  return {
    currentWorkflowStepCode: steps[start].code,
    processSteps: steps,
    projectStatus: draftStatus(w),
  };
};
const applyProjection = <T extends WorkflowWorkspace>(
  w: T,
  value: VersionWorkflowSnapshot,
) => {
  Object.assign(w, snapshot(value));
  w.selectedStep = Math.max(
    0,
    w.processSteps.findIndex((s) => s.code === w.currentWorkflowStepCode),
  );
};

/** Preserve the old actual cycle before introducing the highest-version round. */
export function migrateVersionWorkflows<T extends WorkflowWorkspace>(
  workspace: T,
): T {
  const w = clone(workspace);
  const oldVersion = knownVersion(w, w.workflowVersion)
    ? w.workflowVersion!
    : w.activeVersion;
  if (w.versionWorkflows !== undefined) {
    w.workflowVersion ||= oldVersion;
    w.versionWorkflows[w.workflowVersion] ||= snapshot(w);
    w.legacyWorkflowArchive ||= {};
    w.reviewGates = w.reviewGates?.map((g) => ({
      ...g,
      costVersion: g.costVersion || oldVersion,
    }));
    return w;
  }
  const old = snapshot(w);
  w.versionWorkflows = { [oldVersion]: old };
  w.legacyWorkflowArchive ||= {};
  const highest = highestVersion(w);
  w.workflowVersion = highest?.code || oldVersion;
  for (const version of w.costVersions) {
    if (!w.versionWorkflows[version.code])
      w.versionWorkflows[version.code] = freshCycle(w);
  }
  if (highest?.state === 'Draft') {
    if (highest.code === oldVersion)
      w.legacyWorkflowArchive[oldVersion] ||= clone(old);
    w.versionWorkflows[highest.code] = freshCycle(w);
  }
  applyProjection(w, w.versionWorkflows[w.workflowVersion]);
  w.reviewGates = w.reviewGates?.map((g) => ({
    ...g,
    costVersion: g.costVersion || oldVersion,
  }));
  return w;
}

const newDraftRound = (
  previous: WorkflowWorkspace,
  next: WorkflowWorkspace,
) => {
  const highest = highestVersion(next);
  return highest?.state === 'Draft' &&
    !previous.costVersions.some((v) => v.code === highest.code)
    ? highest.code
    : undefined;
};
const staleDetail =
  'Review materials have changed. Resubmit this cost version.';
const staleDetailZh = '送审资料已变化，请对本成本版本重新提交评审。';
const reviewDetail = (detail: string, notice: string, stale: boolean) =>
  [
    ...detail.split('\n').filter((line) => line !== notice),
    ...(stale ? [notice] : []),
  ]
    .filter(Boolean)
    .join('\n');
const applySsrEvents = (
  previous: WorkflowWorkspace,
  next: WorkflowWorkspace,
) => {
  for (const submission of next.ssr?.submissions || []) {
    if (!['DTRB', 'DRB'].includes(submission.kind)) continue;
    const old = previous.ssr?.submissions.find((s) => s.id === submission.id);
    if (
      old &&
      old.results.length === submission.results.length &&
      old.closures.length === submission.closures.length
    )
      continue;
    const version = submission.costBaseline.code;
    const latest = next
      .ssr!.submissions.filter(
        (s) => s.kind === submission.kind && s.costBaseline.code === version,
      )
      .at(-1);
    const baseline = next.costVersions.find((v) => v.code === version);
    if (latest?.id !== submission.id || !baseline) continue;
    const cycle = (next.versionWorkflows![version] ||= freshCycle(next));
    const index = ensureStep(
      cycle.processSteps,
      submission.kind as 'DTRB' | 'DRB',
    );
    const outcome = latestResult(submission)?.outcome;
    const stale = isStale(next.ssr!, submission, baseline);
    const state = stale
      ? 'blocked'
      : isApproved(submission)
        ? 'completed'
        : outcome === 'rejected' || outcome === 'withdrawn'
          ? 'blocked'
          : 'awaiting_review';
    cycle.processSteps[index] = {
      ...cycle.processSteps[index],
      state,
      tone:
        state === 'completed' ? 'green' : state === 'blocked' ? 'red' : 'amber',
      detail: reviewDetail(
        cycle.processSteps[index].detail,
        staleDetail,
        stale,
      ),
      detailZh: reviewDetail(
        cycle.processSteps[index].detailZh,
        staleDetailZh,
        stale,
      ),
    };
    cycle.currentWorkflowStepCode = cycle.processSteps[index].code;
  }
};

/** Keep history server-owned; a new highest Draft opens a new DTRB cycle. */
export function reconcileVersionWorkflows<T extends WorkflowWorkspace>(
  previous: T | null,
  next: T,
): T {
  if (!previous) return migrateVersionWorkflows(next);
  const old = migrateVersionWorkflows(previous);
  const w = clone(next);
  const round = old.workflowVersion!;
  w.workflowVersion = round;
  w.versionWorkflows = clone(old.versionWorkflows!);
  w.legacyWorkflowArchive = clone(old.legacyWorkflowArchive || {});
  const newRound = newDraftRound(old, w);
  const removedRound =
    !knownVersion(w, round) && !!w.deletedCostVersions?.[round];
  // A caller may already have projected the new cycle. Never write that
  // DTRB projection over the outgoing version's actual review history.
  if (!removedRound && (!newRound || next.workflowVersion !== newRound))
    w.versionWorkflows[round] = snapshot(w);
  for (const version of w.costVersions) {
    if (!w.versionWorkflows[version.code])
      w.versionWorkflows[version.code] = freshCycle(w);
  }
  if (newRound) {
    w.workflowVersion = newRound;
    w.versionWorkflows[newRound] = freshCycle(w);
  }
  if (removedRound) w.workflowVersion = highestVersion(w)!.code;
  const oldGates = old.reviewGates || [];
  const incomingGates = w.reviewGates || [];
  w.reviewGates = incomingGates.map((g) => {
    const prior = oldGates.find((p) => p.id === g.id);
    return {
      ...g,
      costVersion: prior?.costVersion || g.costVersion || round,
      ...(prior && prior.costVersion !== w.workflowVersion
        ? { workflowStepCode: prior.workflowStepCode }
        : {}),
    };
  });
  // Creating a cycle must not clear old checkpoints. Ordinary same-cycle
  // writes retain the existing explicit review-gate deletion behavior.
  if (newRound) {
    for (const gate of oldGates) {
      if (!w.reviewGates.some((g) => g.id === gate.id))
        w.reviewGates.push(clone(gate));
    }
  }
  if (w.workflowMode !== 'project') applySsrEvents(old, w);
  applyProjection(w, w.versionWorkflows[w.workflowVersion!]);
  if (removedRound) {
    w.processSteps = restoreProjectHoldDeadlines(w);
    w.versionWorkflows[w.workflowVersion!] = snapshot(w);
  }
  return w;
}

/** Check only newly requested actions; historical recorded Draft reviews remain readable. */
export function assertVersionWorkflowTransition(
  previous: WorkflowWorkspace | null,
  next: WorkflowWorkspace,
): void {
  if (!previous) return;
  const old = migrateVersionWorkflows(previous);
  const round = old.workflowVersion!;
  const requireConfirmed = (code: string) => {
    if (next.costVersions.find((v) => v.code === code)?.state !== 'Confirmed')
      throw new TypeError(`请先确认成本 ${code} (Confirmed)`);
  };
  for (const step of next.processSteps) {
    const prior = old.processSteps.find((s) => s.code === step.code);
    if (
      isDrbStep(step) &&
      ['in_progress', 'awaiting_review', 'completed'].includes(step.state) &&
      prior?.state !== step.state
    )
      requireConfirmed(round);
  }
  for (const gate of next.reviewGates || []) {
    const prior = old.reviewGates?.find((g) => g.id === gate.id);
    if (
      isDrbStep({ code: gate.workflowStepCode, name: gate.gate }) &&
      ['in_review', 'completed'].includes(gate.status) &&
      prior?.status !== gate.status
    )
      requireConfirmed(prior?.costVersion || gate.costVersion || round);
  }
  if (next.currentWorkflowStepCode !== old.currentWorkflowStepCode) {
    if (next.workflowMode === 'project') {
      if (requiresConfirmedWorkflowStage(next, next.currentWorkflowStepCode))
        requireConfirmed(round);
      return;
    }
    const dtrb = next.processSteps.findIndex(isDtrbStep);
    const target = next.processSteps.findIndex(
      (s) => s.code === next.currentWorkflowStepCode,
    );
    if (
      isDrbStep(
        next.processSteps[target] || { code: next.currentWorkflowStepCode },
      ) ||
      (dtrb >= 0 &&
        target > dtrb &&
        next.processSteps[target]?.code !== 'COST_BUILD')
    )
      requireConfirmed(round);
  }
}
