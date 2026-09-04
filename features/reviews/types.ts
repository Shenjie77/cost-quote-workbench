/** Durable review-gate and follow-up records shared by UI, SQLite, and CLI. */

import type { StatusTone } from '@/features/workbench/status-tone';

export type ReviewStatus =
  | 'not_started'
  | 'awaiting_material'
  | 'in_review'
  | 'blocked'
  | 'completed'
  | 'cancelled';

export type ReviewFollowUp = {
  id: string;
  createdAt: string;
  summary: string;
  statusAfter: ReviewStatus;
  nextFollowUpAt: string;
};

/** One user-created checkpoint belonging to exactly one project workspace. */
export type ReviewGate = {
  id: string;
  projectId: string;
  gate: string;
  gateZh: string;
  owner: string;
  dueDate: string;
  status: ReviewStatus;
  note: string;
  noteZh: string;
  workflowStepCode: string;
  lastUpdatedAt: string;
  followUps: ReviewFollowUp[];
};

export const reviewStatusLabels: Record<
  ReviewStatus,
  { en: string; zh: string; tone: StatusTone }
> = {
  not_started: { en: 'Not started', zh: '未开始', tone: 'gray' },
  awaiting_material: { en: 'Awaiting material', zh: '待材料', tone: 'amber' },
  in_review: { en: 'In review', zh: '评审中', tone: 'blue' },
  blocked: { en: 'Blocked', zh: '阻塞', tone: 'red' },
  completed: { en: 'Completed', zh: '已完成', tone: 'green' },
  cancelled: { en: 'Cancelled', zh: '已取消', tone: 'gray' },
};

export type ReviewTiming = {
  daysUntilDue: number;
  en: string;
  zh: string;
  tone: StatusTone;
  overdue: boolean;
  dueSoon: boolean;
  stale: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Converts a date into local midnight so daily reminders are timezone-stable. */
const localMidnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Derives time-sensitive presentation from stored ISO dates. No progress is
 * inferred: only the deadline, explicit status, and last update are evaluated.
 */
export const getReviewTiming = (
  review: ReviewGate,
  now = new Date(),
): ReviewTiming => {
  const due = new Date(`${review.dueDate}T00:00:00`);
  const dueValid = Number.isFinite(due.getTime());
  const daysUntilDue = dueValid
    ? Math.round((localMidnight(due) - localMidnight(now)) / DAY_MS)
    : 9999;
  const closed = review.status === 'completed' || review.status === 'cancelled';
  const overdue = !closed && daysUntilDue < 0;
  const dueSoon = !closed && daysUntilDue >= 0 && daysUntilDue <= 3;
  const lastUpdate = new Date(review.lastUpdatedAt);
  const staleDays = Number.isFinite(lastUpdate.getTime())
    ? Math.floor((now.getTime() - lastUpdate.getTime()) / DAY_MS)
    : 9999;
  const stale = !closed && staleDays >= 5;

  if (closed) {
    return {
      daysUntilDue,
      en: review.status === 'completed' ? 'Completed' : 'Cancelled',
      zh: review.status === 'completed' ? '已完成' : '已取消',
      tone: review.status === 'completed' ? 'green' : 'gray',
      overdue: false,
      dueSoon: false,
      stale: false,
    };
  }
  if (overdue) {
    const days = Math.abs(daysUntilDue);
    return {
      daysUntilDue,
      en: `Overdue · ${days} day${days === 1 ? '' : 's'}`,
      zh: `已逾期 ${days} 天`,
      tone: 'red',
      overdue,
      dueSoon,
      stale,
    };
  }
  if (daysUntilDue === 0) {
    return {
      daysUntilDue,
      en: 'Due today',
      zh: '今日到期',
      tone: 'amber',
      overdue,
      dueSoon,
      stale,
    };
  }
  if (dueSoon) {
    return {
      daysUntilDue,
      en: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
      zh: `${daysUntilDue} 天后到期`,
      tone: 'amber',
      overdue,
      dueSoon,
      stale,
    };
  }
  return {
    daysUntilDue,
    en: stale ? `No update for ${staleDays} days` : 'Scheduled',
    zh: stale ? `${staleDays} 天未更新` : '已排期',
    tone: reviewStatusLabels[review.status].tone,
    overdue,
    dueSoon,
    stale,
  };
};
