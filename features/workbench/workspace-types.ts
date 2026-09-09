/** Durable workspace and local API contracts shared by adapters and UI. */
import type { TravelCostRow } from '@/features/cost/additional-travel-domain';
import type {
  CostVersionState,
  CostInputRow,
  CostVersionSnapshot,
  ManualCostInputs,
  RateSettings,
  ResourceType,
  TravelSettings,
} from '@/features/cost/domain';
import type {
  MaintenancePriceRecord,
  SupplementalCostItem,
} from '@/features/master-data/domain';
import type { SubcontractItem } from '@/features/master-data/types';
import type {
  ProjectStatus,
  ProjectStatusDefinition,
  WorkflowStep,
} from '@/features/projects/types';
import type { PricingSettings } from '@/features/quote/domain';
import type {
  AssumptionDefinition,
  QuoteAssumption,
  QuoteHistoryRecord,
  QuoteTemplate,
} from '@/features/quote/types';
import type { ReviewGate } from '@/features/reviews/types';
import type { MaintenanceWorkspace } from '@/features/maintenance/domain';
import type { SsrWorkspace } from '@/features/ssr/domain';
import type { CpqWorkspace } from '@/features/cpq/domain';

export const LOCAL_API_VERSION = 'cost-workbench/local-v1' as const;
export const WORKSPACE_SCHEMA_VERSION = '1.0.0' as const;

export type WorkbenchWorkspace = {
  workflowHold?: import('../projects/types').WorkflowHold;
  workflowEngineVersion?: 1;
  workflowTemplateRevision?: number;
  workflowMode?: 'project';
  workflowUpdates?: import('../projects/workflow-domain').WorkflowUpdate[];
  /** Global catalogue revisions explicitly captured by this project. */
  masterDataRevisions?: Record<string, number>;
  /** Current delivery-review round; opening a historical cost does not change it. */
  workflowVersion?: string;
  legacyWorkflowArchive?: Record<
    string,
    {
      currentWorkflowStepCode: string;
      processSteps: import('../projects/types').WorkflowStep[];
      projectStatus: string;
    }
  >;
  versionWorkflows?: Record<
    string,
    {
      currentWorkflowStepCode: string;
      processSteps: import('../projects/types').WorkflowStep[];
      projectStatus: string;
    }
  >;
  costVersionLocks?: import('../cost/cost-lock').CostVersionLocks;
  /** Removed suspended versions remain immutable provenance for review and copy history. */
  deletedCostVersions?: import('../cost/version-deletion').DeletedCostVersions;
  /** Legacy project lock, migrated to costVersionLocks on load. */
  costLock?: import('../cost/cost-lock').CostLock;
  cpq?: CpqWorkspace;
  ssr?: SsrWorkspace;
  maintenanceBoq?: MaintenanceWorkspace;
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  project: {
    id: string;
    name: string;
    client: string;
    currency: 'SGD';
  };
  /** Stable workflow-node code; selectedStep remains for v1 compatibility. */
  currentWorkflowStepCode: string;
  selectedStep: number;
  processSteps: WorkflowStep[];
  projectStatus: ProjectStatus;
  /** Editable status dictionary; projectStatus references one code here. */
  projectStatusDefinitions: ProjectStatusDefinition[];
  reviewGates: ReviewGate[];
  activeVersion: string;
  costVersions: CostVersionSnapshot[];
  costRows: CostInputRow[];
  subcontractCost?: import('../cost/subcontract-domain').SubcontractCost;
  rateSettings: RateSettings;
  resourceTypes: ResourceType[];
  subcontractItems: SubcontractItem[];
  supplementalCostItems: SupplementalCostItem[];
  maintenancePriceRecords: MaintenancePriceRecord[];
  travelSettings: TravelSettings;
  travelRows: TravelCostRow[];
  travelUplift: number;
  manualCosts: ManualCostInputs;
  pricing: PricingSettings;
  assumptionLibrary: AssumptionDefinition[];
  quoteTemplates: QuoteTemplate[];
  selectedQuoteTemplateId: string;
  quoteAssumptions: QuoteAssumption[];
  quoteHistory: QuoteHistoryRecord[];
};

export type PersistencePhase =
  | 'connecting'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'error';

export type PersistenceStatus = {
  phase: PersistencePhase;
  revision: number | null;
  savedAt: string | null;
  message: string;
};

export type WorkspaceRecord = {
  revision: number;
  updatedAt: string;
  workspace: WorkbenchWorkspace;
};

export type LocalWorkspaceIndexItem = {
  workflowHold?: import('../projects/types').WorkflowHold;
  workflowEngineVersion?: 1;
  workflowTemplateRevision?: number;
  workflowMode?: 'project';
  workflowVersion?: string;
  workflowOwner?: string;
  workflowFollowUpDate?: string;
  workflowNote?: string;
  workflowUpdatedAt?: string;
  projectId: string;
  name: string;
  client: string;
  currency: 'SGD';
  revision: number | null;
  updatedAt: string;
  projectStatus?: ProjectStatus;
  statusDefinitions?: ProjectStatusDefinition[];
  reviewGates?: ReviewGate[];
  currentWorkflowStepCode?: string;
  workflowSteps?: WorkflowStep[];
  activeVersion?: string;
  versionState?: CostVersionState;
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
