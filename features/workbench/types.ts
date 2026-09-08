/**
 * Cross-feature UI contracts owned by the workbench shell. Feature views should
 * prefer semantic callbacks; PanelState remains centralized for the global sheet.
 */

import type { Project } from '@/features/projects/types';
import type { ReviewGate } from '@/features/reviews/types';
export type { StatusTone } from '@/features/workbench/status-tone';

export type ViewKey =
  | 'overview'
  | 'project'
  | 'workflow'
  | 'cost'
  | 'quote'
  | 'cpq'
  | 'ssr'
  | 'maintenance'
  | 'reviews'
  | 'agent'
  | 'master-data';

export type PanelState =
  | { type: 'project'; project: Project }
  | { type: 'review'; review: ReviewGate; projectId: string }
  | { type: 'new-review'; projectId: string }
  | { type: 'new-project' }
  | null;
