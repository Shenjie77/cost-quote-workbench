/**
 * Client-side composition root. It owns session state so switching views never
 * resets drafts; feature modules remain presentation/application boundaries.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Bell,
  Check,
  CircleAlert,
  Database,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Settings2,
  WifiOff,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentView } from '@/features/agent/agent-view';
import type { TravelCostRow } from '@/features/cost/additional-travel-domain';
import { CostView } from '@/features/cost/cost-view';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import {
  initialCostRows,
  initialManualCostInputs,
  initialRateSettings,
  initialTravelRows,
  initialTravelSettings,
} from '@/features/cost/demo-data';
import type {
  CostInputRow,
  CostVersionState,
  CostVersionSnapshot,
  ManualCostInputs,
  RateSettings,
  ResourceType,
  TravelSettings,
} from '@/features/cost/domain';
import {
  getCostStatementValues,
  getHQTravelSummary,
  roundMoney,
  totalRowMandays,
} from '@/features/cost/domain';
import type { CostViewKey } from '@/features/cost/ui-types';
import {
  initialResourceTypes,
  initialSubcontractItems,
} from '@/features/master-data/demo-data';
import {
  initialMaintenancePriceRecords,
  initialSupplementalCostItems,
  type MaintenancePriceRecord,
  type SupplementalCostItem,
} from '@/features/master-data/domain';
import type { SubcontractItem } from '@/features/master-data/types';
import { MasterDataView } from '@/features/master-data/master-data-view';
import { OverviewView } from '@/features/overview/overview-view';
import { initialProcessSteps, projects } from '@/features/projects/demo-data';
import type {
  Project,
  ProjectStatus,
  ProjectStatusDefinition,
  WorkflowStep,
} from '@/features/projects/types';
import { initialProjectStatusDefinitions } from '@/features/projects/types';
import { ProjectView } from '@/features/projects/project-view';
import { QuoteView } from '@/features/quote/quote-view';
import {
  calculatePricing,
  initialPricingSettings,
  type PricingSettings,
} from '@/features/quote/domain';
import {
  initialQuoteAssumptions,
  initialQuoteTemplates,
  type QuoteAssumption,
  type QuoteHistoryRecord,
  type QuoteTemplate,
} from '@/features/quote/types';
import { ReviewsView } from '@/features/reviews/reviews-view';
import type { ReviewGate } from '@/features/reviews/types';
import { DetailSheet } from '@/features/workbench/detail-sheet';
import { navItems, viewTitles } from '@/features/workbench/navigation';
import {
  WORKSPACE_SCHEMA_VERSION,
  getLocalWorkspace,
  listLocalWorkspaces,
  saveLocalWorkspaceDocument,
  useLocalWorkspace,
  type WorkbenchWorkspace,
} from '@/features/workbench/local-persistence';
import type { PanelState, ViewKey } from '@/features/workbench/types';

/** Creates an independent workflow template for a new project. */
const createBlankWorkflowSteps = () =>
  initialProcessSteps.map((step) => ({
    ...step,
    state: 'not_started' as const,
    tone: 'gray' as const,
  }));

/** Creates an independent editable project-status dictionary. */
const createProjectStatusDefinitions = () =>
  structuredClone(initialProjectStatusDefinitions);

/** Maps the broad project status to the most useful initial workflow node. */
const defaultWorkflowCode = (status?: ProjectStatus) => {
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
const projectRecord = (id: string, name: string, client: string): Project => ({
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
const createCostVersion = (
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
  },
): CostVersionSnapshot => ({
  code,
  state,
  sourceVersion,
  createdAt: new Date().toISOString(),
  costRows: structuredClone(inputs.costRows),
  rateSettings: structuredClone(inputs.rateSettings),
  travelSettings: structuredClone(inputs.travelSettings),
  travelRows: structuredClone(inputs.travelRows),
  travelUplift: inputs.travelUplift,
  manualCosts: structuredClone(inputs.manualCosts),
});

/** Builds a valid empty workspace when a starter-list project is first edited. */
const createBlankWorkspace = (
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
    quoteTemplates: structuredClone(initialQuoteTemplates),
    selectedQuoteTemplateId: initialQuoteTemplates[0].id,
    quoteAssumptions: structuredClone(initialQuoteAssumptions),
    quoteHistory: [],
  };
};

export function WorkbenchApp() {
  const [projectList, setProjectList] = useState<Project[]>(() =>
    projects.map((project) => ({
      ...project,
      statusDefinitions: createProjectStatusDefinitions(),
      currentWorkflowStepCode: defaultWorkflowCode(project.projectStatus),
      workflowSteps: createBlankWorkflowSteps(),
    })),
  );
  const [activeProjectId, setActiveProjectId] = useState(projects[0].id);
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([
    projects[0].id,
  ]);
  const activeProject =
    projectList.find((item) => item.id === activeProjectId) ?? projects[0];
  const exportProject = useMemo<CostExportSnapshot['project']>(
    () => ({
      id: activeProject.id,
      name: activeProject.name,
      client: activeProject.client,
      currency: 'SGD',
    }),
    [activeProject],
  );
  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [selectedStep, setSelectedStep] = useState(6);
  const [currentWorkflowStepCode, setCurrentWorkflowStepCode] = useState(
    initialProcessSteps[6]?.code || initialProcessSteps[0]?.code || '',
  );
  const [processSteps, setProcessSteps] =
    useState<WorkflowStep[]>(initialProcessSteps);
  const [projectStatus, setProjectStatus] =
    useState<ProjectStatus>('cost_review');
  const [projectStatusDefinitions, setProjectStatusDefinitions] = useState<
    ProjectStatusDefinition[]
  >(createProjectStatusDefinitions);
  const [reviewGates, setReviewGates] = useState<ReviewGate[]>([]);
  const [activeVersion, setActiveVersion] = useState('V3');
  const [costView, setCostView] = useState<CostViewKey>('input');
  const [costRows, setCostRows] = useState<CostInputRow[]>(initialCostRows);
  const [rateSettings, setRateSettings] =
    useState<RateSettings>(initialRateSettings);
  const [resourceTypes, setResourceTypes] =
    useState<ResourceType[]>(initialResourceTypes);
  const [subcontractItems, setSubcontractItems] = useState<SubcontractItem[]>(
    initialSubcontractItems,
  );
  const [supplementalCostItems, setSupplementalCostItems] = useState<
    SupplementalCostItem[]
  >(initialSupplementalCostItems);
  const [maintenancePriceRecords, setMaintenancePriceRecords] = useState<
    MaintenancePriceRecord[]
  >(initialMaintenancePriceRecords);
  const [travelSettings, setTravelSettings] = useState<TravelSettings>(
    initialTravelSettings,
  );
  const [travelRows, setTravelRows] =
    useState<TravelCostRow[]>(initialTravelRows);
  const [travelUplift, setTravelUplift] = useState(0);
  const [manualCosts, setManualCosts] = useState<ManualCostInputs>(
    initialManualCostInputs,
  );
  const [versionSnapshots, setVersionSnapshots] = useState<
    CostVersionSnapshot[]
  >(() => [
    createCostVersion('V3', 'Draft', null, {
      costRows: initialCostRows,
      rateSettings: initialRateSettings,
      travelSettings: initialTravelSettings,
      travelRows: initialTravelRows,
      travelUplift: 0,
      manualCosts: initialManualCostInputs,
    }),
  ]);
  const [pricing, setPricing] = useState<PricingSettings>(
    initialPricingSettings,
  );
  const [quoteTemplates, setQuoteTemplates] = useState<QuoteTemplate[]>(
    initialQuoteTemplates,
  );
  const [selectedQuoteTemplateId, setSelectedQuoteTemplateId] = useState(
    initialQuoteTemplates[0].id,
  );
  const [quoteAssumptions, setQuoteAssumptions] = useState<QuoteAssumption[]>(
    initialQuoteAssumptions,
  );
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistoryRecord[]>([]);
  const [panel, setPanel] = useState<PanelState>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const title = viewTitles[activeView];
  const projectScopedView = activeView === 'cost' || activeView === 'quote';
  const pageEyebrow = projectScopedView
    ? `${activeView === 'cost' ? 'COST' : 'PRICING'} / ${activeProject.id}`
    : title.eyebrow;
  const pageSubtitle = projectScopedView ? activeProject.name : title.subtitle;
  const pageSubtitleZh = projectScopedView
    ? activeProject.nameZh
    : title.subtitleZh;

  /** Applies one database snapshot without coupling the API to child views. */
  const hydrateWorkspace = useCallback((workspace: WorkbenchWorkspace) => {
    setSelectedStep(workspace.selectedStep);
    setProcessSteps(workspace.processSteps);
    setCurrentWorkflowStepCode(
      workspace.currentWorkflowStepCode ||
        workspace.processSteps[workspace.selectedStep]?.code ||
        workspace.processSteps[0]?.code ||
        '',
    );
    setProjectStatus(workspace.projectStatus || 'input_preparation');
    setProjectStatusDefinitions(
      workspace.projectStatusDefinitions?.length
        ? workspace.projectStatusDefinitions
        : createProjectStatusDefinitions(),
    );
    setReviewGates(workspace.reviewGates || []);
    setActiveVersion(workspace.activeVersion);
    setVersionSnapshots(
      workspace.costVersions?.length
        ? workspace.costVersions
        : [
            createCostVersion(workspace.activeVersion, 'Draft', null, {
              costRows: workspace.costRows,
              rateSettings: workspace.rateSettings,
              travelSettings: workspace.travelSettings,
              travelRows: workspace.travelRows,
              travelUplift: workspace.travelUplift,
              manualCosts: workspace.manualCosts,
            }),
          ],
    );
    setCostRows(workspace.costRows);
    setRateSettings(workspace.rateSettings);
    setResourceTypes(workspace.resourceTypes);
    setSubcontractItems(workspace.subcontractItems);
    setSupplementalCostItems(workspace.supplementalCostItems);
    setMaintenancePriceRecords(workspace.maintenancePriceRecords);
    setTravelSettings(workspace.travelSettings);
    setTravelRows(workspace.travelRows);
    setTravelUplift(workspace.travelUplift);
    setManualCosts(workspace.manualCosts);
    setPricing(workspace.pricing || initialPricingSettings);
    setQuoteTemplates(
      workspace.quoteTemplates?.length
        ? workspace.quoteTemplates
        : structuredClone(initialQuoteTemplates),
    );
    setSelectedQuoteTemplateId(
      workspace.selectedQuoteTemplateId || initialQuoteTemplates[0].id,
    );
    setQuoteAssumptions(
      workspace.quoteAssumptions || structuredClone(initialQuoteAssumptions),
    );
    setQuoteHistory(workspace.quoteHistory || []);
  }, []);

  /** Keeps the active version's persisted snapshot synchronized with editors. */
  const synchronizedVersions = useMemo(
    () =>
      versionSnapshots.map((version) =>
        version.code === activeVersion
          ? {
              ...version,
              costRows: structuredClone(costRows),
              rateSettings: structuredClone(rateSettings),
              travelSettings: structuredClone(travelSettings),
              travelRows: structuredClone(travelRows),
              travelUplift,
              manualCosts: structuredClone(manualCosts),
            }
          : version,
      ),
    [
      activeVersion,
      costRows,
      manualCosts,
      rateSettings,
      travelRows,
      travelSettings,
      travelUplift,
      versionSnapshots,
    ],
  );

  /** One immutable document is the atomic autosave and CLI exchange unit. */
  const workspace = useMemo<WorkbenchWorkspace>(
    () => ({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      project: exportProject,
      currentWorkflowStepCode,
      selectedStep,
      processSteps,
      projectStatus,
      projectStatusDefinitions,
      reviewGates,
      activeVersion,
      costVersions: synchronizedVersions,
      costRows,
      rateSettings,
      resourceTypes,
      subcontractItems,
      supplementalCostItems,
      maintenancePriceRecords,
      travelSettings,
      travelRows,
      travelUplift,
      manualCosts,
      pricing,
      quoteTemplates,
      selectedQuoteTemplateId,
      quoteAssumptions,
      quoteHistory,
    }),
    [
      activeVersion,
      costRows,
      currentWorkflowStepCode,
      exportProject,
      maintenancePriceRecords,
      manualCosts,
      pricing,
      processSteps,
      projectStatus,
      projectStatusDefinitions,
      quoteAssumptions,
      quoteHistory,
      quoteTemplates,
      rateSettings,
      reviewGates,
      resourceTypes,
      selectedQuoteTemplateId,
      selectedStep,
      subcontractItems,
      supplementalCostItems,
      travelRows,
      travelSettings,
      travelUplift,
      synchronizedVersions,
    ],
  );
  const { status: persistenceStatus, saveNow } = useLocalWorkspace({
    projectId: exportProject.id,
    workspace,
    onHydrate: hydrateWorkspace,
  });

  /** Downloads a restore-ready v2 request without sending local data away. */
  const downloadWorkspaceBackup = () => {
    const request = {
      apiVersion: 'cost-workbench/v2',
      kind: 'WorkspaceSaveRequest',
      requestId: `backup_${Date.now()}`,
      actor: { type: 'user', id: 'local-workbench' },
      data: workspace,
    };
    const blob = new Blob([`${JSON.stringify(request, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${exportProject.id}_${activeVersion}_workspace-backup.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(
      'Workspace backup downloaded. Store it only in a company-approved location. / 工作区备份已下载，请仅保存到公司认可的位置。',
    );
  };

  /** Project List uses the exact same current cost and pricing engines. */
  const activeMetrics = useMemo(() => {
    const travelCost = getHQTravelSummary(
      costRows,
      resourceTypes,
      travelSettings,
    ).totalCost;
    const statement = getCostStatementValues(
      costRows,
      resourceTypes,
      travelCost,
      manualCosts,
    );
    const quote = calculatePricing(statement.totalWithRisk, pricing);
    return {
      serviceCost: roundMoney(statement.service - statement.subcontract),
      subcontractCost: statement.subcontract,
      totalCost: statement.totalWithRisk,
      totalMandays: costRows.reduce(
        (sum, row) => sum + totalRowMandays(row),
        0,
      ),
      totalQuote: quote.quoteBeforeTax,
      grossMarginPercent: quote.grossMarginPercent,
    };
  }, [costRows, manualCosts, pricing, resourceTypes, travelSettings]);

  const portfolioProjects = useMemo(
    () =>
      projectList.map((project) =>
        project.id === activeProjectId
          ? {
              ...project,
              projectStatus,
              statusDefinitions: projectStatusDefinitions,
              reviewGates,
              currentWorkflowStepCode,
              workflowSteps: processSteps,
              version: activeVersion,
              versionState:
                synchronizedVersions.find(
                  (version) => version.code === activeVersion,
                )?.state || 'Draft',
              ...activeMetrics,
              incompleteCostRows: costRows.filter(
                (row) =>
                  !row.scope.trim() ||
                  !row.bu.trim() ||
                  !row.reTypeId.trim() ||
                  row.mdPerSite <= 0 ||
                  !row.years.some((year) => year.sites > 0 || year.cost > 0),
              ).length,
            }
          : project,
      ),
    [
      activeMetrics,
      activeProjectId,
      activeVersion,
      currentWorkflowStepCode,
      projectList,
      projectStatus,
      projectStatusDefinitions,
      processSteps,
      reviewGates,
      synchronizedVersions,
      costRows,
    ],
  );

  /** Merge persisted projects into the built-in portfolio on startup. */
  useEffect(() => {
    void listLocalWorkspaces()
      .then((items) => {
        setProjectList((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          items.forEach((item) => {
            const existing = byId.get(item.projectId);
            byId.set(
              item.projectId,
              existing
                ? {
                    ...existing,
                    name: item.name,
                    client: item.client,
                    projectStatus: item.projectStatus,
                    statusDefinitions: item.statusDefinitions?.length
                      ? item.statusDefinitions
                      : existing.statusDefinitions,
                    reviewGates: item.reviewGates || existing.reviewGates,
                    currentWorkflowStepCode:
                      item.currentWorkflowStepCode ||
                      existing.currentWorkflowStepCode,
                    workflowSteps: item.workflowSteps?.length
                      ? item.workflowSteps
                      : existing.workflowSteps,
                    version: item.activeVersion || existing.version,
                    serviceCost: item.serviceCost,
                    subcontractCost: item.subcontractCost,
                    totalCost: item.totalCost,
                    totalMandays: item.totalMandays,
                    totalQuote: item.totalQuote,
                    grossMarginPercent: item.grossMarginPercent,
                    incompleteCostRows: item.incompleteCostRows,
                    versionState: item.versionState || existing.versionState,
                  }
                : {
                    ...projectRecord(item.projectId, item.name, item.client),
                    projectStatus: item.projectStatus,
                    statusDefinitions: item.statusDefinitions?.length
                      ? item.statusDefinitions
                      : createProjectStatusDefinitions(),
                    reviewGates: item.reviewGates || [],
                    currentWorkflowStepCode:
                      item.currentWorkflowStepCode ||
                      defaultWorkflowCode(item.projectStatus),
                    workflowSteps: item.workflowSteps?.length
                      ? item.workflowSteps
                      : createBlankWorkflowSteps(),
                    version: item.activeVersion || 'V1',
                    serviceCost: item.serviceCost,
                    subcontractCost: item.subcontractCost,
                    totalCost: item.totalCost,
                    totalMandays: item.totalMandays,
                    totalQuote: item.totalQuote,
                    grossMarginPercent: item.grossMarginPercent,
                    incompleteCostRows: item.incompleteCostRows,
                    versionState: item.versionState || 'Draft',
                  },
            );
          });
          return [...byId.values()];
        });
      })
      .catch(() => undefined);
  }, []);

  /** Reset session state before loading or creating another project. */
  const selectProject = useCallback(
    (project: Project) => {
      if (project.id === activeProjectId) return;
      // Start the current write before replacing editor state. The request body
      // is serialized synchronously, so project switching cannot lose a draft.
      void saveNow();
      const blankVersion = createCostVersion('V1', 'Draft', null, {
        costRows: [],
        rateSettings: initialRateSettings,
        travelSettings: initialTravelSettings,
        travelRows: [],
        travelUplift: 0,
        manualCosts: initialManualCostInputs,
      });
      const nextProcessSteps = project.workflowSteps?.length
        ? structuredClone(project.workflowSteps)
        : createBlankWorkflowSteps();
      const nextWorkflowCode =
        project.currentWorkflowStepCode ||
        defaultWorkflowCode(project.projectStatus);
      const nextSelectedStep = Math.max(
        0,
        nextProcessSteps.findIndex((step) => step.code === nextWorkflowCode),
      );
      setSelectedStep(nextSelectedStep);
      setCurrentWorkflowStepCode(
        nextProcessSteps[nextSelectedStep]?.code ||
          nextProcessSteps[0]?.code ||
          '',
      );
      setProcessSteps(nextProcessSteps);
      setProjectStatus(project.projectStatus || 'input_preparation');
      setProjectStatusDefinitions(
        project.statusDefinitions?.length
          ? structuredClone(project.statusDefinitions)
          : createProjectStatusDefinitions(),
      );
      setReviewGates(structuredClone(project.reviewGates || []));
      setActiveVersion('V1');
      setVersionSnapshots([blankVersion]);
      setCostRows([]);
      setRateSettings(structuredClone(initialRateSettings));
      setResourceTypes(structuredClone(initialResourceTypes));
      setSubcontractItems(structuredClone(initialSubcontractItems));
      setSupplementalCostItems(structuredClone(initialSupplementalCostItems));
      setMaintenancePriceRecords(
        structuredClone(initialMaintenancePriceRecords),
      );
      setTravelSettings(structuredClone(initialTravelSettings));
      setTravelRows([]);
      setTravelUplift(0);
      setManualCosts(structuredClone(initialManualCostInputs));
      setPricing({ ...initialPricingSettings });
      setQuoteTemplates(structuredClone(initialQuoteTemplates));
      setSelectedQuoteTemplateId(initialQuoteTemplates[0].id);
      setQuoteAssumptions(structuredClone(initialQuoteAssumptions));
      setQuoteHistory([]);
      setOpenProjectIds((current) =>
        current.includes(project.id) ? current : [...current, project.id],
      );
      setActiveProjectId(project.id);
      setNotice(`Active project: ${project.name} / 已切换项目`);
    },
    [activeProjectId, saveNow],
  );

  /** Loads a version's complete snapshot into the cost editors. */
  const selectCostVersion = useCallback(
    (code: string) => {
      if (code === activeVersion) return;
      const target = synchronizedVersions.find(
        (version) => version.code === code,
      );
      if (!target) return;
      setVersionSnapshots(synchronizedVersions);
      setActiveVersion(code);
      setCostRows(structuredClone(target.costRows));
      setRateSettings(structuredClone(target.rateSettings));
      setTravelSettings(structuredClone(target.travelSettings));
      setTravelRows(structuredClone(target.travelRows));
      setTravelUplift(target.travelUplift);
      setManualCosts(structuredClone(target.manualCosts));
      setCostView('input');
      setNotice(`Loaded ${code} cost snapshot / 已载入 ${code} 成本快照`);
    },
    [activeVersion, synchronizedVersions],
  );

  /**
   * Clones the currently selected snapshot. Existing version states are
   * intentionally preserved because lifecycle changes are user-controlled.
   */
  const createNewCostVersion = useCallback(() => {
    const nextNumber =
      Math.max(
        0,
        ...synchronizedVersions.map((version) =>
          Number(version.code.replace(/^V/, '')),
        ),
      ) + 1;
    const nextCode = `V${nextNumber}`;
    const activeSnapshot = synchronizedVersions.find(
      (version) => version.code === activeVersion,
    );
    const nextVersion = createCostVersion(nextCode, 'Draft', activeVersion, {
      costRows,
      rateSettings,
      travelSettings,
      travelRows,
      travelUplift,
      manualCosts,
    });
    setVersionSnapshots([...synchronizedVersions, nextVersion]);
    setActiveVersion(nextCode);
    setCostView('input');
    setNotice(
      `${nextCode} created from ${activeSnapshot?.code || activeVersion} / 已复制为新成本版本`,
    );
  }, [
    activeVersion,
    costRows,
    manualCosts,
    rateSettings,
    synchronizedVersions,
    travelRows,
    travelSettings,
    travelUplift,
  ]);

  /** Updates one version lifecycle without altering any other version. */
  const updateCostVersionState = useCallback(
    (code: string, state: CostVersionState) => {
      setVersionSnapshots((current) =>
        current.map((version) =>
          version.code === code ? { ...version, state } : version,
        ),
      );
      setNotice(`${code}: ${state} / 版本状态已更新`);
    },
    [],
  );

  /** Direct table status edit; inactive workspaces are updated without opening. */
  const updateProjectStatus = useCallback(
    async (project: Project, status: ProjectStatus) => {
      setProjectList((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, projectStatus: status } : item,
        ),
      );
      if (project.id === activeProjectId) {
        setProjectStatus(status);
        return;
      }
      try {
        const record = await getLocalWorkspace(project.id);
        const document = record
          ? { ...record.workspace, projectStatus: status }
          : createBlankWorkspace(project, status);
        await saveLocalWorkspaceDocument(document, record?.revision ?? null);
        setNotice(`Project status updated / 项目状态已更新：${project.name}`);
      } catch (error) {
        setProjectList((current) =>
          current.map((item) =>
            item.id === project.id
              ? {
                  ...item,
                  projectStatus: project.projectStatus || 'input_preparation',
                }
              : item,
          ),
        );
        setNotice(
          error instanceof Error
            ? `Status save failed: ${error.message} / 状态保存失败`
            : 'Status save failed / 状态保存失败',
        );
      }
    },
    [activeProjectId],
  );

  /**
   * Selects the project's current workflow node by stable code. Inactive
   * projects are updated directly in SQLite without forcing a tab switch.
   */
  const updateProjectWorkflow = useCallback(
    async (project: Project, workflowCode: string) => {
      const previousCode = project.currentWorkflowStepCode || '';
      setProjectList((current) =>
        current.map((item) =>
          item.id === project.id
            ? { ...item, currentWorkflowStepCode: workflowCode }
            : item,
        ),
      );
      if (project.id === activeProjectId) {
        const nextIndex = processSteps.findIndex(
          (step) => step.code === workflowCode,
        );
        if (nextIndex < 0) {
          setProjectList((current) =>
            current.map((item) =>
              item.id === project.id
                ? { ...item, currentWorkflowStepCode: previousCode }
                : item,
            ),
          );
          setNotice('Workflow node not found / 未找到流程节点');
          return;
        }
        setCurrentWorkflowStepCode(workflowCode);
        setSelectedStep(nextIndex);
        setNotice(`Current workflow updated / 当前流程已更新：${project.name}`);
        return;
      }
      try {
        const record = await getLocalWorkspace(project.id);
        const document = record
          ? record.workspace
          : createBlankWorkspace(
              project,
              project.projectStatus || 'input_preparation',
            );
        const nextIndex = document.processSteps.findIndex(
          (step) => step.code === workflowCode,
        );
        if (nextIndex < 0) {
          throw new Error('The selected workflow node is not in this project.');
        }
        await saveLocalWorkspaceDocument(
          {
            ...document,
            currentWorkflowStepCode: workflowCode,
            selectedStep: nextIndex,
          },
          record?.revision ?? null,
        );
        setNotice(`Current workflow updated / 当前流程已更新：${project.name}`);
      } catch (error) {
        setProjectList((current) =>
          current.map((item) =>
            item.id === project.id
              ? { ...item, currentWorkflowStepCode: previousCode }
              : item,
          ),
        );
        setNotice(
          error instanceof Error
            ? `Workflow save failed: ${error.message} / 流程保存失败`
            : 'Workflow save failed / 流程保存失败',
        );
      }
    },
    [activeProjectId, processSteps],
  );

  /** Creates or updates one review gate in its owning project workspace. */
  const saveReviewGate = useCallback(
    async (review: ReviewGate) => {
      const project = portfolioProjects.find(
        (item) => item.id === review.projectId,
      );
      if (!project) {
        setNotice('Review project not found / 未找到评审所属项目');
        return false;
      }
      const upsert = (rows: ReviewGate[]) => {
        const exists = rows.some((item) => item.id === review.id);
        return exists
          ? rows.map((item) => (item.id === review.id ? review : item))
          : [review, ...rows];
      };
      if (review.projectId === activeProjectId) {
        setReviewGates(upsert);
        setNotice(`Review gate saved / 评审节点已保存：${review.gate}`);
        return true;
      }
      try {
        const record = await getLocalWorkspace(review.projectId);
        const document = record
          ? record.workspace
          : createBlankWorkspace(
              project,
              project.projectStatus || 'input_preparation',
            );
        const nextReviewGates = upsert(document.reviewGates || []);
        await saveLocalWorkspaceDocument(
          { ...document, reviewGates: nextReviewGates },
          record?.revision ?? null,
        );
        setProjectList((current) =>
          current.map((item) =>
            item.id === review.projectId
              ? { ...item, reviewGates: nextReviewGates }
              : item,
          ),
        );
        setNotice(`Review gate saved / 评审节点已保存：${review.gate}`);
        return true;
      } catch (error) {
        setNotice(
          `Review save failed: ${error instanceof Error ? error.message : 'Unknown error'} / 评审保存失败`,
        );
        return false;
      }
    },
    [activeProjectId, portfolioProjects],
  );

  /** Removes one review gate while preserving its project's other records. */
  const deleteReviewGate = useCallback(
    async (projectId: string, reviewId: string) => {
      if (projectId === activeProjectId) {
        setReviewGates((rows) => rows.filter((item) => item.id !== reviewId));
        setNotice('Review gate deleted / 评审节点已删除');
        return true;
      }
      try {
        const record = await getLocalWorkspace(projectId);
        if (!record) throw new Error('Project workspace not found.');
        const nextReviewGates = (record.workspace.reviewGates || []).filter(
          (item) => item.id !== reviewId,
        );
        await saveLocalWorkspaceDocument(
          { ...record.workspace, reviewGates: nextReviewGates },
          record.revision,
        );
        setProjectList((current) =>
          current.map((item) =>
            item.id === projectId
              ? { ...item, reviewGates: nextReviewGates }
              : item,
          ),
        );
        setNotice('Review gate deleted / 评审节点已删除');
        return true;
      } catch (error) {
        setNotice(
          `Review delete failed: ${error instanceof Error ? error.message : 'Unknown error'} / 评审删除失败`,
        );
        return false;
      }
    },
    [activeProjectId],
  );

  /** Creates a persisted project by switching the autosave unit to a new ID. */
  const createProject = useCallback(
    (input: { name: string; client: string; owner: string }) => {
      const id = `PRJ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const project = {
        ...projectRecord(id, input.name, input.client),
        reviewOwner: input.owner || 'Me',
      };
      setProjectList((current) => [project, ...current]);
      selectProject(project);
      setPanel(null);
      setActiveView('project');
    },
    [selectProject],
  );

  const allReviewGates = useMemo(
    () => portfolioProjects.flatMap((project) => project.reviewGates || []),
    [portfolioProjects],
  );
  /** Header search filters portfolio surfaces without changing saved records. */
  const visiblePortfolioProjects = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return portfolioProjects;
    return portfolioProjects.filter((project) =>
      [project.id, project.name, project.client, project.version]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [portfolioProjects, searchQuery]);
  const displayDate = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).format(new Date());

  const navigate = (view: ViewKey) => {
    setActiveView(view);
    setMobileNavOpen(false);
    setNotice('');
  };

  /** Opens a project in the tab strip and routes to its requested module. */
  const openProjectModule = (project: Project, view: 'cost' | 'quote') => {
    selectProject(project);
    setActiveView(view);
    setMobileNavOpen(false);
  };

  /** Closes only the visual tab; the SQLite workspace remains untouched. */
  const closeProjectTab = (projectId: string) => {
    if (openProjectIds.length <= 1) {
      setNotice('Keep at least one project tab open / 至少保留一个项目标签');
      return;
    }
    const closingIndex = openProjectIds.indexOf(projectId);
    const remaining = openProjectIds.filter((id) => id !== projectId);
    setOpenProjectIds(remaining);
    if (projectId === activeProjectId) {
      const nextId = remaining[Math.min(closingIndex, remaining.length - 1)];
      const nextProject = portfolioProjects.find((item) => item.id === nextId);
      if (nextProject) selectProject(nextProject);
    }
  };

  let content: ReactNode;
  if (activeView === 'overview')
    content = (
      <OverviewView
        projects={visiblePortfolioProjects}
        reviews={allReviewGates}
        setView={navigate}
        setPanel={setPanel}
        onSelectProject={selectProject}
        onOpenCost={(project) => openProjectModule(project, 'cost')}
        onOpenQuote={(project) => openProjectModule(project, 'quote')}
        onStatusChange={updateProjectStatus}
        onWorkflowChange={updateProjectWorkflow}
      />
    );
  else if (activeView === 'project')
    content = (
      <ProjectView
        projects={visiblePortfolioProjects}
        onOpenProject={(project) => openProjectModule(project, 'cost')}
        onOpenCost={(project) => openProjectModule(project, 'cost')}
        onOpenQuote={(project) => openProjectModule(project, 'quote')}
        onStatusChange={updateProjectStatus}
        onWorkflowChange={updateProjectWorkflow}
        onCreateProject={() => setPanel({ type: 'new-project' })}
      />
    );
  else if (activeView === 'cost')
    content = (
      <CostView
        activeVersion={activeVersion}
        versions={synchronizedVersions}
        onSelectVersion={selectCostVersion}
        onUpdateVersionState={updateCostVersionState}
        costView={costView}
        setCostView={setCostView}
        rows={costRows}
        setRows={setCostRows}
        rateSettings={rateSettings}
        setRateSettings={setRateSettings}
        resourceTypes={resourceTypes}
        travelSettings={travelSettings}
        setTravelSettings={setTravelSettings}
        travelRows={travelRows}
        setTravelRows={setTravelRows}
        travelUplift={travelUplift}
        setTravelUplift={setTravelUplift}
        manualCosts={manualCosts}
        setManualCosts={setManualCosts}
        project={exportProject}
        announce={setNotice}
      />
    );
  else if (activeView === 'master-data')
    content = (
      <MasterDataView
        project={activeProject}
        costRows={synchronizedVersions.flatMap((version) => version.costRows)}
        currentWorkflowStepCode={currentWorkflowStepCode}
        setCurrentWorkflowStepCode={setCurrentWorkflowStepCode}
        setSelectedStep={setSelectedStep}
        processSteps={processSteps}
        setProcessSteps={setProcessSteps}
        projectStatus={projectStatus}
        setProjectStatus={setProjectStatus}
        projectStatusDefinitions={projectStatusDefinitions}
        setProjectStatusDefinitions={setProjectStatusDefinitions}
        resourceTypes={resourceTypes}
        setResourceTypes={setResourceTypes}
        subcontractItems={subcontractItems}
        setSubcontractItems={setSubcontractItems}
        supplementalCostItems={supplementalCostItems}
        setSupplementalCostItems={setSupplementalCostItems}
        maintenancePriceRecords={maintenancePriceRecords}
        setMaintenancePriceRecords={setMaintenancePriceRecords}
        quoteTemplates={quoteTemplates}
        setQuoteTemplates={setQuoteTemplates}
        selectedQuoteTemplateId={selectedQuoteTemplateId}
        setSelectedQuoteTemplateId={setSelectedQuoteTemplateId}
        announce={setNotice}
      />
    );
  else if (activeView === 'quote')
    content = (
      <QuoteView
        project={exportProject}
        activeVersion={activeVersion}
        versionState={
          synchronizedVersions.find((version) => version.code === activeVersion)
            ?.state || 'Draft'
        }
        totalCost={activeMetrics.totalCost}
        pricing={pricing}
        setPricing={setPricing}
        quoteTemplates={quoteTemplates}
        selectedQuoteTemplateId={selectedQuoteTemplateId}
        setSelectedQuoteTemplateId={setSelectedQuoteTemplateId}
        quoteAssumptions={quoteAssumptions}
        setQuoteAssumptions={setQuoteAssumptions}
        quoteHistory={quoteHistory}
        setQuoteHistory={setQuoteHistory}
        announce={setNotice}
      />
    );
  else if (activeView === 'reviews')
    content = (
      <ReviewsView
        projects={portfolioProjects}
        reviews={allReviewGates}
        setPanel={setPanel}
      />
    );
  else
    content = (
      <AgentView
        projects={portfolioProjects}
        reviews={allReviewGates}
        setView={navigate}
        setPanel={setPanel}
        onSelectProject={selectProject}
      />
    );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[244px] flex-col border-r border-[#29495c] bg-[#132c3d] text-[#eaf0f2] lg:flex">
        <div className="flex h-[74px] items-center gap-3 border-b border-[#29495c] px-5">
          <span className="financial-numeral flex size-9 items-center justify-center rounded-md border border-[#65808f] bg-[#1b3d51] text-xs font-bold">
            CQ
          </span>
          <div>
            <p className="text-sm font-semibold tracking-wide">
              Cost & Quote Workbench
            </p>
            <p className="mt-0.5 text-[9px] text-[#9fb0b9]">报价管控台</p>
          </div>
        </div>
        <nav
          aria-label="Main navigation"
          className="workbench-scrollbar flex-1 overflow-y-auto px-3 py-5"
        >
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#78909e]">
            Workspace{' '}
            <span className="text-[8px] normal-case tracking-normal">
              工作空间
            </span>
          </p>
          <div className="mt-2 space-y-1">
            {navItems
              .filter((item) => item.key !== 'master-data')
              .map((item) => {
                const Icon = item.icon;
                const active = item.key === activeView;
                return (
                  <button
                    key={item.key}
                    onClick={() => navigate(item.key)}
                    className={
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ' +
                      (active
                        ? 'bg-[#e8f0f0] text-[#173a52]'
                        : 'text-[#c8d3d9] hover:bg-[#1b3d51] hover:text-white')
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">
                        {item.label}
                      </span>
                      <span
                        className={
                          'mt-0.5 block text-[9px] ' +
                          (active ? 'text-[#587078]' : 'text-[#8197a3]')
                        }
                      >
                        {item.labelZh} · {item.description}
                      </span>
                      <span
                        className={
                          'block text-[8px] ' +
                          (active ? 'text-[#6f858c]' : 'text-[#718792]')
                        }
                      >
                        {item.descriptionZh}
                      </span>
                    </span>
                    {item.key === 'reviews' ? (
                      <span className="financial-numeral flex size-5 items-center justify-center rounded-full bg-[#a86432] text-[9px] font-bold text-white">
                        {
                          allReviewGates.filter(
                            (review) =>
                              review.status !== 'completed' &&
                              review.status !== 'cancelled',
                          ).length
                        }
                      </span>
                    ) : null}
                  </button>
                );
              })}
          </div>
          <p className="mt-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#78909e]">
            Data Management{' '}
            <span className="text-[8px] normal-case tracking-normal">
              数据管理
            </span>
          </p>
          <div className="mt-2 space-y-1">
            <button
              onClick={() => navigate('master-data')}
              aria-current={activeView === 'master-data' ? 'page' : undefined}
              className={
                'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ' +
                (activeView === 'master-data'
                  ? 'bg-[#e8f0f0] text-[#173a52]'
                  : 'text-[#c8d3d9] hover:bg-[#1b3d51] hover:text-white')
              }
            >
              <Database className="size-4" />
              <span className="flex-1">
                <span className="block text-xs font-medium">Master Data</span>
                <span
                  className={
                    'text-[8px] ' +
                    (activeView === 'master-data'
                      ? 'text-[#587078]'
                      : 'text-[#8197a3]')
                  }
                >
                  基础数据 · Reference & price history
                </span>
              </span>
              <span className="text-[8px]">Live</span>
            </button>
            <button
              onClick={() => {
                navigate('master-data');
                setNotice(
                  'Open Quote Templates in Master Data. / 请在基础数据中打开“报价模板”页签。',
                );
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[#91a3ad] hover:bg-[#1b3d51] hover:text-white"
            >
              <Settings2 className="size-4" />
              <span className="flex-1">
                <span className="block text-xs font-medium">
                  Templates & Settings
                </span>
                <span className="text-[8px]">模板与设置</span>
              </span>
              <span className="text-[8px]">Live</span>
            </button>
          </div>
        </nav>
        <div className="border-t border-[#29495c] p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-[#dbe7e8] text-xs font-bold text-[#173a52]">
              ME
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">
                Personal Quote Workspace
              </p>
              <p className="mt-0.5 text-[8px] text-[#8197a3]">
                个人报价工作区 · Local SQLite / 本地数据库
              </p>
            </div>
            <button
              type="button"
              aria-label="Download workspace backup"
              title="Download restore-ready workspace backup / 下载可恢复工作区备份"
              onClick={downloadWorkspaceBackup}
            >
              <MoreHorizontal className="size-4 text-[#8197a3]" />
            </button>
          </div>
        </div>
      </aside>
      <div className="min-h-screen lg:pl-[244px]">
        <header className="sticky top-0 z-50 border-b border-border bg-[#f8f6f1]/95 backdrop-blur">
          <div className="flex min-h-[74px] items-center gap-4 px-4 sm:px-6 xl:px-8">
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label="Open navigation"
            >
              {mobileNavOpen ? <X /> : <Menu />}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="financial-numeral text-[9px] font-semibold uppercase tracking-[0.11em] text-[#a86432]">
                {pageEyebrow}
              </p>
              <div className="mt-1 flex min-w-0 items-baseline gap-3">
                <h1 className="truncate text-lg font-semibold tracking-[-0.02em] sm:text-xl">
                  {title.title}
                </h1>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {title.titleZh}
                </span>
                <p className="hidden truncate text-xs text-muted-foreground 2xl:block">
                  {pageSubtitle}
                </p>
              </div>
              <p className="mt-0.5 hidden text-[9px] text-muted-foreground sm:block 2xl:hidden">
                {pageSubtitleZh}
              </p>
            </div>
            <div className="relative hidden w-[280px] xl:block">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="bg-white pl-8"
                placeholder="Search project, client, or version / 搜索"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="hidden items-center gap-2 text-[9px] text-muted-foreground sm:flex">
              <span className="size-1.5 rounded-full bg-[#377054]" />
              Local Data <span className="text-[8px]">本地数据</span>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Open review notifications"
              onClick={() => navigate('reviews')}
            >
              <Bell />
            </Button>
            <Button onClick={() => setPanel({ type: 'new-project' })}>
              <Plus />
              New Project{' '}
              <span className="text-[9px] opacity-60">新建项目</span>
            </Button>
          </div>
          {mobileNavOpen ? (
            <div className="workbench-scrollbar flex gap-2 overflow-x-auto border-t border-border px-4 py-3 lg:hidden">
              {navItems.map((item) => (
                <Button
                  key={item.key}
                  variant={activeView === item.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => navigate(item.key)}
                >
                  {item.label}
                  <span className="text-[8px] opacity-60">{item.labelZh}</span>
                </Button>
              ))}
            </div>
          ) : null}
          {activeView === 'project' ||
          activeView === 'cost' ||
          activeView === 'quote' ? (
            <div className="workbench-scrollbar flex items-end gap-1 overflow-x-auto border-t border-border bg-[#eeeae2] px-4 pt-1.5 sm:px-6 xl:px-8">
              <span className="mb-2 mr-2 shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Open Projects <span className="normal-case">已打开项目</span>
              </span>
              {openProjectIds.map((projectId) => {
                const tabProject = portfolioProjects.find(
                  (item) => item.id === projectId,
                );
                if (!tabProject) return null;
                const active = projectId === activeProjectId;
                return (
                  <div
                    key={projectId}
                    className={
                      'flex h-8 min-w-[190px] max-w-[280px] items-center border border-b-0 ' +
                      (active
                        ? 'border-border bg-background text-[#173a52]'
                        : 'border-transparent bg-[#e3dfd6] text-muted-foreground hover:bg-[#e9e6de]')
                    }
                  >
                    <button
                      className="min-w-0 flex-1 px-3 text-left"
                      onClick={() => {
                        selectProject(tabProject);
                        if (activeView === 'project') setActiveView('cost');
                      }}
                      title={`${tabProject.id} · ${tabProject.name}`}
                    >
                      <span className="financial-numeral block truncate text-[9px] font-semibold">
                        {tabProject.id}
                      </span>
                      <span className="block truncate text-[8px]">
                        {tabProject.name}
                      </span>
                    </button>
                    <button
                      className="mr-1.5 rounded-sm p-1 hover:bg-black/5"
                      onClick={() => closeProjectTab(projectId)}
                      aria-label={`Close ${tabProject.name} tab`}
                      title="Close tab only / 仅关闭标签"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </header>
        <div className="relative z-0 isolate mx-auto w-full max-w-[1780px] px-4 py-5 sm:px-6 xl:px-8 xl:py-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Badge
                variant="outline"
                className={
                  'h-5 ' +
                  (persistenceStatus.phase === 'saved'
                    ? 'border-[#9fb9aa] bg-[#edf5ef] text-[#377054]'
                    : persistenceStatus.phase === 'offline' ||
                        persistenceStatus.phase === 'error' ||
                        persistenceStatus.phase === 'conflict'
                      ? 'border-[#d0b787] bg-[#f8f0e2] text-[#8d5b12]'
                      : 'border-[#9eb9ba] bg-[#edf4f3] text-[#2e6f77]')
                }
              >
                {persistenceStatus.phase === 'saved' ? (
                  <Check className="mr-1 size-3" />
                ) : persistenceStatus.phase === 'offline' ||
                  persistenceStatus.phase === 'error' ||
                  persistenceStatus.phase === 'conflict' ? (
                  <WifiOff className="mr-1 size-3" />
                ) : (
                  <LoaderCircle className="mr-1 size-3 animate-spin" />
                )}
                Local SQLite <span className="ml-1 text-[8px]">本地数据库</span>
              </Badge>
              <span
                className="max-w-[760px] truncate"
                title={persistenceStatus.message}
              >
                {persistenceStatus.message}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[9px]"
                onClick={() => void saveNow()}
                disabled={persistenceStatus.phase === 'saving'}
              >
                <Save className="size-3" /> Save{' '}
                <span className="text-[8px]">保存</span>
              </Button>
              {activeView === 'cost' ? (
                <Button
                  size="sm"
                  className="h-6 px-2 text-[9px]"
                  onClick={createNewCostVersion}
                >
                  <Plus className="size-3" /> New Version{' '}
                  <span className="text-[8px] opacity-60">创建版本</span>
                </Button>
              ) : null}
            </div>
            <span className="financial-numeral hidden text-[10px] text-muted-foreground sm:block">
              {displayDate}
            </span>
          </div>
          {content}
        </div>
      </div>
      {notice ? (
        <output
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 border border-[#9eb9ba] bg-[#173a52] px-4 py-3 text-xs text-white shadow-xl"
        >
          <CircleAlert className="size-4 shrink-0 text-[#b9d7d5]" />
          <span>{notice}</span>
          <button
            aria-label="Close notice"
            onClick={() => setNotice('')}
            className="ml-2 text-[#b9c9d0] hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        </output>
      ) : null}
      <DetailSheet
        key={
          panel
            ? `${panel.type}-${panel.type === 'review' ? panel.review.id : panel.type === 'new-review' ? panel.projectId : panel.type === 'project' ? panel.project.id : 'new'}`
            : 'closed'
        }
        panel={panel}
        setPanel={setPanel}
        setView={navigate}
        projects={portfolioProjects}
        onCreateProject={createProject}
        onSelectProject={selectProject}
        onSaveReview={saveReviewGate}
        onDeleteReview={deleteReviewGate}
        announce={setNotice}
      />
    </main>
  );
}
