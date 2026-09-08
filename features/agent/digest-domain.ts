/** Deterministic daily digest shared by the browser and `cost-cli`. */

import { getReviewTiming, type ReviewGate } from '../reviews/types.ts';
import type { WorkflowStep } from '../projects/types.ts';
import {
  workflowComplete,
  workflowNodeActive,
  workflowPhaseGroups,
  workflowUrgency,
} from '../projects/workflow-engine.ts';

export type DigestSeverity = 'red' | 'amber' | 'blue' | 'gray';
export type DigestCategory =
  | 'immediate_follow_up'
  | 'decisions_due'
  | 'cost_attention'
  | 'data_quality';

export type DigestProject = {
  projectId: string;
  name: string;
  client: string;
  projectStatus?: string;
  activeVersion?: string;
  versionState?: string;
  totalCost?: number;
  totalQuote?: number;
  incompleteCostRows?: number;
  /** Project Workflow is the only follow-up source for unified projects. */
  workflowMode?: 'project';
  workflowEngineVersion?: 1;
  workflowTemplateRevision?: number;
  workflowVersion?: string;
  currentWorkflowStepCode?: string;
  workflowSteps?: WorkflowStep[];
  ssrAttention?: {
    id: string;
    title: string;
    detail: string;
    severity: 'red' | 'amber';
    fingerprint: string;
  }[];
};

/** A new workflow round may reopen a previously completed project. */
export const isDigestProjectCompleted = (project: DigestProject) =>
  project.workflowEngineVersion === 1
    ? workflowComplete(project)
    : project.workflowMode === 'project'
      ? project.currentWorkflowStepCode === 'QUOTE_COMPLETED'
      : project.projectStatus === 'completed';

const buildProjectWorkflowReminder = (
  project: DigestProject,
  asOf: string,
): DigestItem | undefined => {
  const step = project.workflowSteps?.find(
    (entry) => entry.code === project.currentWorkflowStepCode,
  );
  const followUpDate = step?.followUpDate || '';
  const daysUntilFollowUp = followUpDate
    ? (Date.parse(`${followUpDate}T00:00:00Z`) -
        Date.parse(`${asOf}T00:00:00Z`)) /
      86400000
    : undefined;
  if (daysUntilFollowUp !== undefined && daysUntilFollowUp > 3) return;

  const due = daysUntilFollowUp !== undefined && daysUntilFollowUp <= 0;
  const missingDate =
    daysUntilFollowUp === undefined || !Number.isFinite(daysUntilFollowUp);
  const stage = step?.name || 'Workflow';
  const stageZh = step?.nameZh || step?.name || '待登记流程节点';
  const owner = step?.owner || 'Unassigned';
  const ownerZh = step?.owner || '待指定';
  return {
    id: `project-workflow:${project.projectId}`,
    category: due || missingDate ? 'immediate_follow_up' : 'decisions_due',
    severity: due ? 'red' : 'amber',
    projectId: project.projectId,
    reviewId: '',
    title: `${project.name} · ${stage}`,
    titleZh: `${project.name} · ${stageZh}`,
    detail: `${missingDate ? 'Set a follow-up date and confirm the current workflow status.' : due ? 'Follow up and update the project workflow.' : 'Follow-up due soon.'} Owner: ${owner}. Next follow-up: ${missingDate ? 'not set' : followUpDate}.${step?.note ? ` Note: ${step.note}` : ''}`,
    detailZh: `${missingDate ? '请确认当前流程状态并补充跟进日期。' : due ? '已到跟进日期，请查看公司系统并更新项目流程。' : '即将到跟进日期。'}负责人：${ownerZh}；下次跟进：${missingDate ? '未设置' : followUpDate}。${step?.note ? `备注：${step.note}` : ''}`,
    action: 'project',
  };
};

export type DigestItem = {
  id: string;
  category: DigestCategory;
  severity: DigestSeverity;
  projectId: string;
  reviewId: string;
  title: string;
  titleZh: string;
  detail: string;
  detailZh: string;
  action: 'review' | 'cost' | 'project' | 'ssr';
  workflowNodeId?: string;
  workflowVersion?: string;
  urgency?: 'normal' | 'immediate' | 'urgent';
};

const formatWorkflowDeadline = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
};

const buildWorkflowTaskReminders = (
  project: DigestProject,
  now: string,
): DigestItem[] => {
  const steps = project.workflowSteps || [];
  // Completing one phase leaves the next pending until the user starts it.
  // Keep that handoff visible without starting its SLA or exposing later phases.
  const readyPhase = steps.some(
    (step) => workflowNodeActive(step) || step.state === 'paused',
  )
    ? undefined
    : workflowPhaseGroups(steps).find((phase) =>
        phase.steps.some((step) => step.state === 'not_started'),
      );
  const readyCodes = new Set(
    readyPhase?.steps
      .filter((step) => step.state === 'not_started')
      .map((step) => step.code),
  );
  return steps.flatMap((step) => {
    if (step.reminderEnabled === false) return [];
    const ready = readyCodes.has(step.code);
    const urgency = ready ? 'normal' : workflowUrgency(step, now);
    if (urgency === 'none') return [];
    const paused = step.state === 'paused';
    const status = ready
      ? 'Awaiting start / status registration. SLA has not started'
      : paused
        ? 'Resume follow-up due'
        : urgency === 'urgent'
          ? 'Urgent: deadline exceeded'
          : urgency === 'immediate'
            ? 'Handle today'
            : 'Normal follow-up';
    const statusZh = ready
      ? '待启动/待登记，尚未开始计时'
      : paused
        ? '请安排恢复'
        : urgency === 'urgent'
          ? '紧急：已超过期限'
          : urgency === 'immediate'
            ? '马上处理'
            : '普通跟进';
    const deadline = formatWorkflowDeadline(step.dueAt);
    const version = project.workflowVersion || project.activeVersion || '';
    return [
      {
        id: `project-workflow:${project.projectId}:${version}:${step.code}`,
        category:
          urgency === 'normal' ? 'decisions_due' : 'immediate_follow_up',
        severity:
          urgency === 'urgent'
            ? 'red'
            : urgency === 'immediate'
              ? 'amber'
              : 'blue',
        projectId: project.projectId,
        reviewId: '',
        action: 'project',
        workflowNodeId: step.code,
        workflowVersion: version,
        urgency,
        title: `${project.name} · ${step.name}`,
        titleZh: `${project.name} · ${step.nameZh || step.name}`,
        detail: `${status}. Owner: ${step.owner || 'Unassigned'}.${paused || ready ? '' : ` SLA deadline: ${deadline ? `${deadline} (SGT)` : 'not set'}.`}${step.followUpDate ? ` ${paused ? 'Resume check' : 'Follow-up'}: ${step.followUpDate}.` : ''}${step.note ? ` Note: ${step.note}` : ''}`,
        detailZh: `${statusZh}。负责人：${step.owner || '待指定'}。${paused || ready ? '' : `处理期限：${deadline ? `${deadline}（新加坡时间）` : '未设置'}。`}${step.followUpDate ? `${paused ? '恢复跟进' : '跟进日期'}：${step.followUpDate}。` : ''}${step.note ? `备注：${step.note}` : ''}`,
      },
    ];
  });
};

export type DailyDigest = {
  asOf: string;
  generatedAt: string;
  counts: Record<DigestCategory, number>;
  items: DigestItem[];
};

const digestSeverityOrder: Record<DigestSeverity, number> = {
  red: 0,
  amber: 1,
  blue: 2,
  gray: 3,
};

/** A project with parallel tasks counts once, ordered by its most urgent task. */
export const groupDigestItemsByProject = (items: DigestItem[]) => {
  const groups = new Map<
    string,
    {
      projectId: string;
      severity: DigestSeverity;
      items: DigestItem[];
    }
  >();
  for (const item of items) {
    const group = groups.get(item.projectId);
    if (group) {
      group.items.push(item);
      if (
        digestSeverityOrder[item.severity] < digestSeverityOrder[group.severity]
      )
        group.severity = item.severity;
    } else
      groups.set(item.projectId, {
        projectId: item.projectId,
        severity: item.severity,
        items: [item],
      });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) =>
          digestSeverityOrder[a.severity] - digestSeverityOrder[b.severity] ||
          a.title.localeCompare(b.title),
      ),
    }))
    .sort(
      (a, b) =>
        digestSeverityOrder[a.severity] - digestSeverityOrder[b.severity] ||
        a.projectId.localeCompare(b.projectId),
    );
};

/** Validates an optional CLI date while keeping the browser default local. */
export const normalizeDigestDate = (asOf?: string, now = new Date()) => {
  if (asOf === undefined || asOf === '') {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = (type: 'year' | 'month' | 'day') =>
      parts.find((part) => part.type === type)?.value || '';
    const year = value('year');
    const month = value('month');
    const day = value('day');
    return `${year}-${month}-${day}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new TypeError('asOf must use YYYY-MM-DD.');
  }
  const [year, month, day] = asOf.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TypeError('asOf must be a real calendar date.');
  }
  return asOf;
};

/**
 * Creates a source-grounded exception list. It reports missing confirmation
 * and explicit dates/statuses only; it never guesses whether work progressed.
 */
export const buildDailyDigest = (
  projects: DigestProject[],
  reviews: ReviewGate[],
  asOf?: string,
  now?: string,
): DailyDigest => {
  const referenceNow =
    now ||
    (asOf
      ? `${normalizeDigestDate(asOf)}T12:00:00+08:00`
      : new Date().toISOString());
  if (!Number.isFinite(Date.parse(referenceNow)))
    throw new TypeError('now must be a valid timestamp.');
  const normalizedDate = normalizeDigestDate(asOf, new Date(referenceNow));
  const reviewNow = new Date(`${normalizedDate}T12:00:00`);
  const projectById = new Map(
    projects.map((project) => [project.projectId, project]),
  );
  const items: DigestItem[] = [];

  for (const review of reviews) {
    const project = projectById.get(review.projectId);
    if (
      project &&
      (project.workflowEngineVersion === 1 ||
        project.workflowMode === 'project' ||
        isDigestProjectCompleted(project))
    )
      continue;
    const timing = getReviewTiming(review, reviewNow);
    // Only the latest follow-up sets the next reminder; older promised dates
    // must stop recurring after a newer follow-up supersedes them.
    const latestFollowUp = [...review.followUps].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    const followUpDue =
      !['completed', 'cancelled'].includes(review.status) &&
      Boolean(
        latestFollowUp?.nextFollowUpAt &&
        latestFollowUp.nextFollowUpAt <= normalizedDate,
      );
    if (
      review.status === 'blocked' ||
      timing.overdue ||
      timing.stale ||
      followUpDue
    ) {
      items.push({
        id: `review-follow-up:${review.projectId}:${review.id}`,
        category: 'immediate_follow_up',
        severity: 'red',
        projectId: review.projectId,
        reviewId: review.id,
        title: `${project?.name || review.projectId} · ${review.gate}`,
        titleZh: `${project?.name || review.projectId} · ${review.gateZh || review.gate}`,
        detail: followUpDue
          ? `Follow-up due ${latestFollowUp.nextFollowUpAt}; owner: ${review.owner}.`
          : review.status === 'blocked'
            ? `Blocked; owner confirmation required from ${review.owner}.`
            : `${timing.en}; status confirmation required from ${review.owner}.`,
        detailZh: followUpDue
          ? `已到跟进日期 ${latestFollowUp.nextFollowUpAt}；负责人：${review.owner}。`
          : review.status === 'blocked'
            ? `节点阻塞，需要 ${review.owner} 确认。`
            : `${timing.zh}，需要 ${review.owner} 确认状态。`,
        action: 'review',
      });
    } else if (timing.dueSoon || review.status === 'in_review') {
      items.push({
        id: `review-decision:${review.projectId}:${review.id}`,
        category: 'decisions_due',
        severity: 'amber',
        projectId: review.projectId,
        reviewId: review.id,
        title: `${project?.name || review.projectId} · ${review.gate}`,
        titleZh: `${project?.name || review.projectId} · ${review.gateZh || review.gate}`,
        detail: `${timing.en}; owner: ${review.owner}.`,
        detailZh: `${timing.zh}；负责人：${review.owner}。`,
        action: 'review',
      });
    }
  }

  for (const project of projects) {
    if (isDigestProjectCompleted(project)) continue;
    if (project.workflowEngineVersion === 1) {
      items.push(...buildWorkflowTaskReminders(project, referenceNow));
      continue;
    }
    if (project.workflowMode === 'project') {
      const reminder = buildProjectWorkflowReminder(project, normalizedDate);
      if (reminder) items.push(reminder);
      continue;
    }
    for (const attention of project.ssrAttention || [])
      items.push({
        id: `ssr:${project.projectId}:${attention.id}`,
        category:
          attention.severity === 'red'
            ? 'immediate_follow_up'
            : 'decisions_due',
        severity: attention.severity,
        projectId: project.projectId,
        reviewId: attention.id,
        title: `${project.name} · ${attention.title}`,
        titleZh: `${project.name} · ${attention.title}`,
        detail: attention.detail,
        detailZh: attention.detail,
        action: 'ssr',
      });
    if (
      project.versionState === 'Draft' &&
      Number(project.totalCost || 0) > 0
    ) {
      items.push({
        id: `cost-draft:${project.projectId}:${project.activeVersion || ''}`,
        category: 'cost_attention',
        severity: 'blue',
        projectId: project.projectId,
        reviewId: '',
        title: `${project.name} · Cost ${project.activeVersion || ''} is Draft`,
        titleZh: `${project.name} · 成本 ${project.activeVersion || ''} 尚为草稿`,
        detail:
          'Confirm the cost version before using it as a formal pricing baseline.',
        detailZh: '作为正式报价基线前，需要确认该成本版本。',
        action: 'cost',
      });
    }
    const incompleteRows = Number(project.incompleteCostRows || 0);
    if (incompleteRows > 0) {
      items.push({
        id: `data-quality:${project.projectId}`,
        category: 'data_quality',
        severity: 'gray',
        projectId: project.projectId,
        reviewId: '',
        title: `${project.name} · ${incompleteRows} incomplete cost row${incompleteRows === 1 ? '' : 's'}`,
        titleZh: `${project.name} · ${incompleteRows} 条成本明细不完整`,
        detail:
          'Complete Scope, BU, RE Type, direct MD or MD/site, and annual allocation before export.',
        detailZh:
          '导出前请补齐 Scope、BU、RE Type、总人天或 MD/site 和年度分配。',
        action: 'cost',
      });
    }
  }

  items.sort(
    (a, b) =>
      digestSeverityOrder[a.severity] - digestSeverityOrder[b.severity] ||
      a.title.localeCompare(b.title),
  );
  const counts: Record<DigestCategory, number> = {
    immediate_follow_up: 0,
    decisions_due: 0,
    cost_attention: 0,
    data_quality: 0,
  };
  items.forEach((item) => {
    counts[item.category] += 1;
  });
  return {
    asOf: normalizedDate,
    generatedAt: new Date().toISOString(),
    counts,
    items,
  };
};
