/** Stable project and workflow records shared by project UI and shell state. */

import type { StatusTone } from '@/features/workbench/status-tone';
import type { ReviewGate } from '@/features/reviews/types';

export type WorkflowState =
  | 'completed'
  | 'in_progress'
  | 'awaiting_review'
  | 'blocked'
  | 'not_started'
  | 'skipped'
  | 'paused';

/** Stable code of a user-controlled project status shown in Project List. */
export type ProjectStatus = string;

/**
 * Editable status dictionary. `code` is the Agent/CLI key and therefore stays
 * stable while the two display names can be changed in Master Data.
 */
export type ProjectStatusDefinition = {
  code: ProjectStatus;
  name: string;
  nameZh: string;
  active: boolean;
};

/** Default dictionary copied into every new or migrated project workspace. */
export const initialProjectStatusDefinitions: ProjectStatusDefinition[] = [
  {
    code: 'input_preparation',
    name: 'Input Preparation',
    nameZh: '输入准备',
    active: true,
  },
  {
    code: 'solution_review',
    name: 'Solution Review',
    nameZh: '方案评审',
    active: true,
  },
  {
    code: 'delivery_review',
    name: 'Delivery Review',
    nameZh: '交付评审',
    active: true,
  },
  { code: 'costing', name: 'Costing', nameZh: '成本编制', active: true },
  {
    code: 'cost_review',
    name: 'Cost Review',
    nameZh: '成本评审',
    active: true,
  },
  { code: 'pricing', name: 'Pricing', nameZh: '定价中', active: true },
  {
    code: 'quote_review',
    name: 'Quote Review',
    nameZh: '报价评审',
    active: true,
  },
  { code: 'completed', name: 'Completed', nameZh: '已完成', active: true },
  { code: 'on_hold', name: 'On Hold', nameZh: '已暂停', active: true },
];

export type Project = {
  workflowHold?: WorkflowHold;
  revision?: number;
  workflowEngineVersion?: 1;
  workflowTemplateRevision?: number;
  workflowMode?: 'project';
  workflowVersion?: string;
  workflowOwner?: string;
  workflowFollowUpDate?: string;
  workflowNote?: string;
  workflowUpdatedAt?: string;
  id: string;
  name: string;
  nameZh: string;
  client: string;
  clientZh: string;
  stage: string;
  stageZh: string;
  version: string;
  versionState: string;
  versionStateZh: string;
  cost: string;
  delta: string;
  nextReview: string;
  nextReviewZh: string;
  reviewOwner: string;
  risk: 'high' | 'medium' | 'low';
  progress: number;
  /** New portfolio fields are optional for legacy/starter records. */
  projectStatus?: ProjectStatus;
  /** Project-specific status options used by the Project List selector. */
  statusDefinitions?: ProjectStatusDefinition[];
  /** Persisted manual review checkpoints used by Reviews and Agent Digest. */
  reviewGates?: ReviewGate[];
  /** Stable code of the workflow node selected from Project List. */
  currentWorkflowStepCode?: string;
  /** Project-specific options shown by the Project List workflow selector. */
  workflowSteps?: WorkflowStep[];
  serviceCost?: number;
  subcontractCost?: number;
  totalCost?: number;
  totalMandays?: number;
  totalQuote?: number;
  grossMarginPercent?: number;
  incompleteCostRows?: number;
  ssrAttention?: {
    id: string;
    title: string;
    detail: string;
    severity: 'red' | 'amber';
    fingerprint: string;
  }[];
};

/** Project-owned monitoring pause; independent from cost-version and node states. */
export type WorkflowHold = {
  startedAt: string;
  reason?: string;
};

export type WorkflowStep = {
  /** Definition fields are independent from the immutable internal code. */
  parallelGroup?: string;
  slaDays?: number;
  slaCalendar?: 'business' | 'calendar';
  slaHolidays?: string[];
  reminderEnabled?: boolean;
  requiredFields?: string[];
  roundStart?: boolean;
  requiresConfirmedCost?: boolean;
  finishesWorkflow?: boolean;
  autoSkip?: boolean;
  /** Create this step's archive folder for newly created projects; omitted means true. */
  createFolder?: boolean;
  /** Version-owned execution data; templates never carry these values. */
  startedAt?: string;
  dueAt?: string;
  completedAt?: string;
  pausedAt?: string;
  fieldValues?: Record<string, string>;
  skippedBy?: string;
  followUpDate?: string;
  note?: string;
  updatedAt?: string;
  code: string;
  no: string;
  name: string;
  nameZh: string;
  owner: string;
  state: WorkflowState;
  tone: StatusTone;
  date: string;
  dateZh: string;
  detail: string;
  detailZh: string;
  input: string;
  inputZh: string;
  required: boolean;
};
