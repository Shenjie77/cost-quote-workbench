/**
 * Workspace/version construction. Defaults are detached from demo objects so
 * creating one project cannot share mutable arrays with another.
 */
import type { TravelCostRow } from '../cost/additional-travel-domain.ts';
import type {
  CostInputRow,
  CostVersionSnapshot,
  ManualCostInputs,
  RateSettings,
  ResourceType,
  TravelSettings,
} from '../cost/domain.ts';
import { recalculateCostRows } from '../cost/domain.ts';
import {
  initialManualCostInputs,
  initialRateSettings,
  initialTravelSettings,
} from '../cost/demo-data.ts';
import {
  initialResourceTypes,
  initialSubcontractItems,
} from '../master-data/demo-data.ts';
import {
  initialMaintenancePriceRecords,
  initialSupplementalCostItems,
} from '../master-data/domain.ts';
import { initialProcessSteps } from '../projects/demo-data.ts';
import {
  initialProjectStatusDefinitions,
  type Project,
  type ProjectStatus,
} from '../projects/types.ts';
import { initialPricingSettings } from '../quote/domain.ts';
import {
  createAssumptionLibrary,
  initialQuoteAssumptions,
  initialQuoteTemplates,
} from '../quote/types.ts';
import {
  WORKSPACE_SCHEMA_VERSION,
  type WorkbenchWorkspace,
} from './workspace-types.ts';

/** Creates an independent workflow template for a new project. */
export const createBlankWorkflowSteps = () =>
  initialProcessSteps.map((step) => ({
    ...step,
    state: 'not_started' as const,
    tone: 'gray' as const,
  }));

/** Creates an independent editable project-status dictionary. */
export const createProjectStatusDefinitions = () =>
  structuredClone(initialProjectStatusDefinitions);

/** Maps the broad project status to the most useful initial workflow node. */
export const defaultWorkflowCode = (status?: ProjectStatus) => {
  const workflowCodeByStatus: Record<string, string> = {
    input_preparation: 'SOLUTION_SCOPE',
    solution_review: 'TD_EFFORT_REVIEW',
    delivery_review: 'DELIVERY_REVIEW',
    costing: 'COST_BUILD',
    cost_review: 'COST_BASELINE_APPROVAL',
    pricing: 'PRICING',
    quote_review: 'QUOTE_PACKAGE',
    completed: 'COMMERCIAL_ARCHIVE',
    on_hold: 'SOLUTION_SCOPE',
  };
  return (
    workflowCodeByStatus[status || 'input_preparation'] || 'SOLUTION_SCOPE'
  );
};

/** Builds a complete UI project record from the minimal persisted index. */
export const projectRecord = (
  id: string,
  name: string,
  client: string,
): Project => ({
  id,
  name,
  nameZh: '',
  client,
  clientZh: '',
  stage: 'Input Preparation',
  stageZh: '输入准备',
  version: 'V1',
  versionState: 'Draft',
  versionStateZh: '草稿',
  cost: 'Pending',
  delta: '—',
  nextReview: 'Not set',
  nextReviewZh: '未设置',
  reviewOwner: 'Me',
  risk: 'low',
  progress: 0,
  projectStatus: 'input_preparation',
  statusDefinitions: createProjectStatusDefinitions(),
  reviewGates: [],
  currentWorkflowStepCode: 'SOLUTION_SCOPE',
  workflowSteps: createBlankWorkflowSteps(),
  serviceCost: 0,
  subcontractCost: 0,
  totalCost: 0,
  totalMandays: 0,
  totalQuote: 0,
  grossMarginPercent: 0,
  incompleteCostRows: 0,
});

/** Creates one independent cost input snapshot for a project version. */
export const createCostVersion = (
  code: string,
  state: CostVersionSnapshot['state'],
  sourceVersion: string | null,
  inputs: {
    costRows: CostInputRow[];
    rateSettings: RateSettings;
    travelSettings: TravelSettings;
    travelRows: TravelCostRow[];
    travelUplift: number;
    manualCosts: ManualCostInputs;
    resourceTypes?: ResourceType[];
  },
): CostVersionSnapshot => ({
  code,
  state,
  sourceVersion,
  createdAt: new Date().toISOString(),
  costRows: recalculateCostRows(
    inputs.costRows,
    inputs.resourceTypes || initialResourceTypes,
    inputs.rateSettings,
  ),
  resourceTypes: structuredClone(inputs.resourceTypes || initialResourceTypes),
  rateSettings: structuredClone(inputs.rateSettings),
  travelSettings: structuredClone(inputs.travelSettings),
  travelRows: structuredClone(inputs.travelRows),
  travelUplift: inputs.travelUplift,
  manualCosts: structuredClone(inputs.manualCosts),
});

/** Builds a valid empty workspace when a starter-list project is first edited. */
export const createBlankWorkspace = (
  project: Project,
  projectStatus: ProjectStatus,
): WorkbenchWorkspace => {
  const processSteps = project.workflowSteps?.length
    ? structuredClone(project.workflowSteps)
    : createBlankWorkflowSteps();
  const requestedCode =
    project.currentWorkflowStepCode || defaultWorkflowCode(projectStatus);
  const selectedStep = Math.max(
    0,
    processSteps.findIndex((step) => step.code === requestedCode),
  );
  const currentWorkflowStepCode =
    processSteps[selectedStep]?.code || processSteps[0]?.code || '';
  const version = createCostVersion('V1', 'Draft', null, {
    costRows: [],
    rateSettings: initialRateSettings,
    travelSettings: initialTravelSettings,
    travelRows: [],
    travelUplift: 0,
    manualCosts: initialManualCostInputs,
  });
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    project: {
      id: project.id,
      name: project.name,
      client: project.client,
      currency: 'SGD',
    },
    currentWorkflowStepCode,
    selectedStep,
    processSteps,
    projectStatus,
    projectStatusDefinitions: project.statusDefinitions?.length
      ? structuredClone(project.statusDefinitions)
      : createProjectStatusDefinitions(),
    reviewGates: structuredClone(project.reviewGates || []),
    activeVersion: 'V1',
    costVersions: [version],
    costRows: [],
    rateSettings: structuredClone(initialRateSettings),
    resourceTypes: structuredClone(initialResourceTypes),
    subcontractItems: structuredClone(initialSubcontractItems),
    supplementalCostItems: structuredClone(initialSupplementalCostItems),
    maintenancePriceRecords: structuredClone(initialMaintenancePriceRecords),
    travelSettings: structuredClone(initialTravelSettings),
    travelRows: [],
    travelUplift: 0,
    manualCosts: structuredClone(initialManualCostInputs),
    pricing: { ...initialPricingSettings },
    assumptionLibrary: createAssumptionLibrary(initialQuoteAssumptions),
    quoteTemplates: structuredClone(initialQuoteTemplates),
    selectedQuoteTemplateId: initialQuoteTemplates[0].id,
    quoteAssumptions: structuredClone(initialQuoteAssumptions),
    quoteHistory: [],
  };
};
