/** Canonical bilingual presentation labels for workflow states. */

import type { WorkflowState } from '@/features/projects/types';
import type { StatusTone } from '@/features/workbench/types';

export const workflowStateLabels: Record<
  WorkflowState,
  { en: string; zh: string; tone: StatusTone }
> = {
  skipped: { en: 'Skipped', zh: '已跳过', tone: 'gray' },
  paused: { en: 'Paused', zh: '已暂停', tone: 'gray' },
  completed: { en: 'Completed', zh: '已完成', tone: 'green' },
  in_progress: { en: 'In progress', zh: '进行中', tone: 'blue' },
  awaiting_review: { en: 'Awaiting review', zh: '待评审', tone: 'amber' },
  blocked: { en: 'Blocked', zh: '已阻塞', tone: 'red' },
  not_started: { en: 'Not started', zh: '未开始', tone: 'gray' },
};
