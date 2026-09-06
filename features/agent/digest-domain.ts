/** Deterministic daily digest shared by the browser and `cost-cli`. */

import { getReviewTiming, type ReviewGate } from '../reviews/types.ts';

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
  ssrAttention?: {
    id: string;
    title: string;
    detail: string;
    severity: 'red' | 'amber';
    fingerprint: string;
  }[];
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
};

export type DailyDigest = {
  asOf: string;
  generatedAt: string;
  counts: Record<DigestCategory, number>;
  items: DigestItem[];
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
): DailyDigest => {
  const normalizedDate = normalizeDigestDate(asOf);
  const now = new Date(`${normalizedDate}T12:00:00`);
  const projectById = new Map(
    projects.map((project) => [project.projectId, project]),
  );
  const items: DigestItem[] = [];

  for (const review of reviews) {
    const project = projectById.get(review.projectId);
    const timing = getReviewTiming(review, now);
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

  const order: Record<DigestSeverity, number> = {
    red: 0,
    amber: 1,
    blue: 2,
    gray: 3,
  };
  items.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] || a.title.localeCompare(b.title),
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
