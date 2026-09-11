/**
 * Client-side composition root. It owns session state so switching views never
 * resets drafts; feature modules remain presentation/application boundaries.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Bell, Menu, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import {
  costLockReason,
  getCostVersionLocks,
  type CostLock,
} from '../cost/cost-lock';
import {
  costVersionDeletionReason,
  deleteSuspendedCostVersion,
  nextCostVersionCode,
} from '../cost/version-deletion';
import { ProjectBootstrap } from './project-bootstrap';
import { WorkbenchSidebar } from './workbench-sidebar';
import { WorkspaceToolbar } from './workspace-toolbar';
import {
  calculateWorkspaceMetrics,
  countIncompleteCostRows,
  mergeWorkflowProjection,
} from './workspace-projections';
import { ProjectSearch } from './project-search.tsx';
import {
  clearWorkbenchNavigation,
  readWorkbenchNavigation,
  restoreWorkbenchNavigation,
  rememberWorkbenchNavigation,
} from './navigation-state';
import {
  createNavigationIntents,
  loadWorkflowNavigation,
  workflowRestoreFeedback,
} from './workflow-navigation.ts';
import { OpenProjectTabs } from './open-project-tabs';
import { runVersionTransition } from '../cost/version-transition';
import {
  migrateVersionWorkflows,
  reconcileVersionWorkflows,
} from '../cost/version-workflow';
import { CostConfirmationDialog } from '../cost/cost-confirmation-dialog';
import {
  costConfirmationDetails,
  confirmReviewedCost,
  workflowConfirmationFingerprint,
  type CostConfirmationDetails,
} from '../cost/cost-confirmation';
import { deleteLocalProject } from './workspace-client';
import { AgentView } from '@/features/agent/agent-view';
import { MaintenanceView } from '@/features/maintenance/maintenance-view';
import {
  emptyMaintenance,
  type MaintenanceWorkspace,
} from '@/features/maintenance/domain';
import { ReminderInbox } from '@/features/agent/reminder-inbox';
import {
  assertQuoteDecision,
  commercialBasisKey,
  emptySsr,
  ssrAttention,
  type SsrWorkspace,
} from '@/features/ssr/domain';
import { normalizeDigestDate } from '@/features/agent/digest-domain';
import { CpqView } from '@/features/cpq/cpq-view';
import { emptyCpq, type CpqWorkspace } from '@/features/cpq/domain';
import type { TravelCostRow } from '@/features/cost/additional-travel-domain';
import { CostView } from '@/features/cost/cost-view';
import type { SubcontractCost } from '@/features/cost/subcontract-domain';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { buildCostExportSnapshot } from '@/features/cost/build-export-snapshot';
import { validateCostExportSnapshot } from '@/features/cost/validation';
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
import { recalculateCostRows } from '@/features/cost/domain';
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
import { usePublishedWorkflow } from '@/features/master-data/use-published-workflow';
import { GlobalMasterDataPage } from '@/features/master-data/global-master-data-page';
import {
  useGlobalMasterData,
  type GlobalMasterDataStore,
} from '@/features/master-data/use-global-master-data';
import {
  createProjectFromGlobalMasterData,
  getGlobalMasterData,
  applyGlobalProjectCatalog,
} from '@/features/master-data/global-client';
import {
  applyCapturedResourceRates,
  captureResourceRates,
} from '@/features/master-data/capture';
import type {
  MasterDataTab,
  QuoteMasterDataTab,
} from '@/features/master-data/navigation';
import { OverviewView } from '@/features/overview/overview-view';
import { initialProcessSteps } from '@/features/projects/demo-data';
import type {
  Project,
  ProjectStatus,
  ProjectStatusDefinition,
  WorkflowStep,
} from '@/features/projects/types';
import {
  createProjectStatusDefinitions,
  projectRecord,
  createCostVersion,
  createBlankWorkspace,
} from './workspace-factories';
import { ProjectView } from '@/features/projects/project-view';
import { ProjectEditDialog } from '@/features/projects/project-edit-dialog';
import { applyProjectDetails } from '@/features/projects/project-details';
import { calculateBuCostAllocation } from '@/features/quote/profit-share';
import { getBusinessUnitOptions } from '@/features/master-data/business-units';
import {
  applyLocalWorkflowAction,
  listLocalWorkspaces,
} from './workspace-client';
import { projectFromIndex } from './project-bootstrap';
import { preflightWorkflowAction } from '@/features/projects/workflow-action-preflight';
import type { WorkflowAction } from '@/features/projects/workflow-engine';
import type { WorkspaceRecord } from './workspace-types';
import { ProjectWorkflowPage } from '@/features/projects/project-workflow-page';
import { archiveProjectFile } from '@/features/projects/project-files';
import {
  workflowPageHash,
  parseWorkflowPageHash,
} from '@/features/projects/workflow-route';
import {
  updateProjectWorkflow as applyProjectWorkflow,
  requiresConfirmedWorkflowStage,
  type ProjectWorkflowPatch,
} from '@/features/projects/workflow-domain';
import { QuoteView } from '@/features/quote/quote-view';
import {
  initialPricingSettings,
  type PricingSettings,
} from '@/features/quote/domain';
import {
  createAssumptionLibrary,
  type AssumptionDefinition,
  initialQuoteAssumptions,
  initialQuoteTemplates,
  type QuoteAssumption,
  type QuoteHistoryRecord,
  type QuoteTemplate,
} from '@/features/quote/types';
import type { ReviewGate } from '@/features/reviews/types';
import { DetailSheet } from '@/features/workbench/detail-sheet';
import { OperationNotice, useOperationNotice } from './operation-notice';
import {
  resolveNewProjectId,
  type NewProjectInput,
} from '@/features/workbench/project-creation';
import { navItems, viewTitles } from '@/features/workbench/navigation';
import {
  WORKSPACE_SCHEMA_VERSION,
  getLocalWorkspace,
  saveLocalWorkspaceDocument,
  useLocalWorkspace,
  type WorkbenchWorkspace,
} from '@/features/workbench/local-persistence';
import type { PanelState, ViewKey } from '@/features/workbench/types';

type PendingCostConfirmation = {
  details: CostConfirmationDetails;
  action: string;
  workflowFingerprint?: string;
  apply: (workspace: WorkbenchWorkspace) => WorkbenchWorkspace;
  resolve: (success: boolean) => void;
};

/** Select the global catalogue or a project session while keeping catalogue state shared. */
export function WorkbenchApp() {
  const globalMasterData = useGlobalMasterData();
  const [masterDataOnly, setMasterDataOnly] = useState(false);
  const [masterDataTab, setMasterDataTab] = useState<MasterDataTab>(
    () => readWorkbenchNavigation()?.masterDataTab ?? 'resources',
  );
  const [globalNotice, setGlobalNotice] = useOperationNotice();
  // Standalone catalogs also survive refresh on an empty installation; defer browser-only restoration after hydration.
  useEffect(() => {
    const saved = readWorkbenchNavigation();
    let cancelled = false;
    if (
      saved?.standaloneMasterData &&
      !parseWorkflowPageHash(window.location.hash)
    )
      queueMicrotask(() => {
        if (!cancelled) setMasterDataOnly(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (masterDataOnly)
      rememberWorkbenchNavigation({
        version: 1,
        view: 'master-data',
        projectId: '',
        openProjectIds: [],
        costView: 'input',
        masterDataTab,
        standaloneMasterData: true,
      });
  }, [masterDataOnly, masterDataTab]);
  if (masterDataOnly)
    return (
      <main className="min-h-screen space-y-5 bg-background p-4 sm:p-6">
        <Button
          variant="outline"
          onClick={() => {
            clearWorkbenchNavigation();
            setMasterDataOnly(false);
          }}
        >
          Project List / 项目列表
        </Button>
        <OperationNotice
          message={globalNotice}
          onDismiss={() => setGlobalNotice('')}
        />
        <GlobalMasterDataPage
          store={globalMasterData}
          activeTab={masterDataTab}
          onTabChange={setMasterDataTab}
          announce={setGlobalNotice}
        />
      </main>
    );
  return (
    <ProjectBootstrap
      onOpenMasterData={() => setMasterDataOnly(true)}
      renderSession={(initialProjects, onEmpty) => (
        <ProjectSessionApp
          initialProjects={initialProjects}
          onEmpty={onEmpty}
          globalMasterData={globalMasterData}
          masterDataTab={masterDataTab}
          setMasterDataTab={setMasterDataTab}
        />
      )}
    />
  );
}

/** Compose project editors, persistence and workflow commands within one stable browser session. */
function ProjectSessionApp({
  initialProjects,
  onEmpty,
  globalMasterData,
  masterDataTab,
  setMasterDataTab,
}: {
  initialProjects: Project[];
  onEmpty: () => void;
  globalMasterData: GlobalMasterDataStore;
  masterDataTab: MasterDataTab;
  setMasterDataTab: (tab: MasterDataTab) => void;
}) {
  // Bootstrap renders this session only after the authoritative project index is loaded.
  // Restore identity before useLocalWorkspace starts, avoiding a temporary load/save of another project.
  const [initialNavigation] = useState(() =>
    restoreWorkbenchNavigation(
      initialProjects,
      readWorkbenchNavigation(),
      typeof window === 'undefined' ? '' : window.location.hash,
    ),
  );
  // Project, workflow, and version state stay here so view changes cannot reset drafts.
  const [projectList, setProjectList] = useState<Project[]>(initialProjects);
  const [masterDataRevisions, setMasterDataRevisions] =
    useState<WorkbenchWorkspace['masterDataRevisions']>();
  const [workflowEngineVersion, setWorkflowEngineVersion] = useState<1>();
  const [workflowTemplateRevision, setWorkflowTemplateRevision] =
    useState<number>();
  const [workflowMode, setWorkflowMode] =
    useState<WorkbenchWorkspace['workflowMode']>();
  const [workflowHold, setWorkflowHold] =
    useState<WorkbenchWorkspace['workflowHold']>();
  const [workflowUpdates, setWorkflowUpdates] =
    useState<WorkbenchWorkspace['workflowUpdates']>();
  const [workflowTarget, setWorkflowTarget] = useState<{
    project: Project;
    workspace: WorkbenchWorkspace;
    revision: number;
    focusNodeCode?: string;
  } | null>(null);
  const [workflowNavigationRequest, setWorkflowNavigationRequest] = useState(0);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const workflowDirtyRef = useRef(false);
  const workflowOpeningRef = useRef(false);
  const workflowReturnView = useRef<ViewKey>('project');
  const workflowPageGeneration = useRef(0);
  const [workflowPageKey, setWorkflowPageKey] = useState(0);
  const workflowRouteHandler = useRef<() => void>(() => {});
  const initialWorkflowRouteHandled = useRef(false);
  const workflowNavigationIntents = useRef(createNavigationIntents());
  const pendingWorkflowLocation = useRef(false);
  const workflowUiRef = useRef({
    target: workflowTarget,
    saving: workflowSaving,
  });
  useEffect(() => {
    workflowUiRef.current = { target: workflowTarget, saving: workflowSaving };
  }, [workflowTarget, workflowSaving]);
  useEffect(() => {
    /** Let the browser protect unsaved workflow fields when the tab is closed or reloaded. */
    const warn = (event: BeforeUnloadEvent) => {
      if (workflowDirtyRef.current) event.preventDefault();
    };
    /** Use the latest route handler without recreating the browser history subscriptions. */
    const followLocation = () => workflowRouteHandler.current();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('popstate', followLocation);
    window.addEventListener('hashchange', followLocation);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('popstate', followLocation);
      window.removeEventListener('hashchange', followLocation);
    };
  }, []);
  const [workflowError, setWorkflowError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [costVersionLocks, setCostVersionLocks] = useState<
    Record<string, CostLock>
  >({});
  const [deletedCostVersions, setDeletedCostVersions] =
    useState<WorkbenchWorkspace['deletedCostVersions']>();
  const switchingRef = useRef(false);
  const [workflowVersion, setWorkflowVersion] = useState('V3');
  const [versionWorkflows, setVersionWorkflows] = useState<
    NonNullable<WorkbenchWorkspace['versionWorkflows']>
  >({});
  const [legacyWorkflowArchive, setLegacyWorkflowArchive] = useState<
    NonNullable<WorkbenchWorkspace['legacyWorkflowArchive']>
  >({});
  const [costConfirmation, setCostConfirmation] =
    useState<PendingCostConfirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState('');
  const [requestedCostView, setRequestedCostView] = useState<{
    projectId: string;
    code: string;
  } | null>(null);
  const versionTransitionRef = useRef(false);
  const [isVersionTransitioning, setVersionTransitioning] = useState(false);
  const quoteExportingRef = useRef(false);
  const costConfigurationSaveRef = useRef<(() => Promise<boolean>) | null>(
    null,
  );
  /** Register the cost page flush operation so Save also persists its local view configuration. */
  const registerCostConfigurationSave = useCallback(
    (handler: (() => Promise<boolean>) | null) => {
      costConfigurationSaveRef.current = handler;
    },
    [],
  );
  const [quoteExporting, setQuoteExporting] = useState(false);
  /** Protect the output/history pair when users navigate during Excel generation. */
  useEffect(() => {
    /** Keep quotation generation and its history entry together across navigation attempts. */
    const warnPendingExport = (event: BeforeUnloadEvent) => {
      if (quoteExportingRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnPendingExport);
    return () => window.removeEventListener('beforeunload', warnPendingExport);
  }, []);
  const [isProjectSwitching, setProjectSwitching] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(
    initialNavigation.projectId,
  );
  const [openProjectIds, setOpenProjectIds] = useState<string[]>(
    initialNavigation.openProjectIds,
  );
  const activeProject =
    projectList.find((item) => item.id === activeProjectId) ??
    initialProjects[0];
  /** Project identity is shared by persisted documents and every export snapshot. */
  const exportProject = useMemo<CostExportSnapshot['project']>(
    () => ({
      id: activeProject.id,
      name: activeProject.name,
      client: activeProject.client,
      currency: 'SGD',
    }),
    [activeProject],
  );
  const [activeView, setActiveView] = useState<ViewKey>(initialNavigation.view);
  // New pages start at their primary controls; workflow pages locate the requested task instead.
  useEffect(() => {
    if (activeView !== 'workflow') window.scrollTo({ top: 0, left: 0 });
  }, [activeView]);
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
  const [costView, setCostView] = useState<CostViewKey>(
    initialNavigation.costView,
  );
  const [subcontractCost, setSubcontractCost] = useState<
    SubcontractCost | undefined
  >();
  const [costRowInputs, setCostRows] =
    useState<CostInputRow[]>(initialCostRows);
  const [rateSettings, setRateSettings] =
    useState<RateSettings>(initialRateSettings);
  const [resourceTypes, setResourceTypes] =
    useState<ResourceType[]>(initialResourceTypes);
  // The catalogue is editable; only an explicit rate refresh changes this
  // version's calculation basis. Other versions retain their own snapshots.
  const [versionResourceTypes, setVersionResourceTypes] =
    useState<ResourceType[]>(initialResourceTypes);
  /** Recalculate editor quantities using the selected version's captured rate card. */
  const costRows = useMemo(
    () =>
      recalculateCostRows(costRowInputs, versionResourceTypes, rateSettings),
    [costRowInputs, versionResourceTypes, rateSettings],
  );
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
  const [assumptionLibrary, setAssumptionLibrary] = useState<
    AssumptionDefinition[]
  >(() => createAssumptionLibrary(initialQuoteAssumptions));
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
  const [maintenanceBoq, setMaintenanceBoq] =
    useState<MaintenanceWorkspace>(emptyMaintenance);
  const [ssr, setSsr] = useState<SsrWorkspace>(emptySsr);
  const [cpq, setCpq] = useState<CpqWorkspace>(emptyCpq);
  const [panel, setPanel] = useState<PanelState>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notice, setNotice] = useOperationNotice();
  const publishedWorkflow = usePublishedWorkflow(
    activeView === 'overview',
    globalMasterData.tabs.workflow?.record,
  );
  const loadGlobalMasterData = globalMasterData.load;
  // Cost selectors use saved global BU definitions, independently of captured pricing rates.
  useEffect(() => {
    if (activeView === 'cost') void loadGlobalMasterData('profit-share');
  }, [activeView, loadGlobalMasterData]);
  const costBusinessUnits = getBusinessUnitOptions(
    globalMasterData.tabs['profit-share']?.record?.items,
  );
  const title = viewTitles[activeView];
  const projectScopedView = activeView === 'cost' || activeView === 'quote';
  const pageEyebrow = projectScopedView
    ? `${activeView === 'cost' ? 'COST' : 'PRICING'} / ${activeProject.id}`
    : title.eyebrow;
  const pageSubtitle =
    activeView === 'workflow'
      ? workflowTarget?.project.name || title.subtitle
      : projectScopedView
        ? activeProject.name
        : title.subtitle;
  const pageSubtitleZh = projectScopedView
    ? activeProject.nameZh
    : title.subtitleZh;

  /** Applies one database snapshot without coupling the API to child views. */
  const hydrateWorkspace = useCallback((input: WorkbenchWorkspace) => {
    const workspace = migrateVersionWorkflows(input);
    setWorkflowVersion(workspace.workflowVersion || workspace.activeVersion);
    setWorkflowEngineVersion(workspace.workflowEngineVersion);
    setWorkflowTemplateRevision(workspace.workflowTemplateRevision);
    setWorkflowMode(workspace.workflowMode);
    setWorkflowHold(workspace.workflowHold);
    setWorkflowUpdates(workspace.workflowUpdates);
    setVersionWorkflows(workspace.versionWorkflows || {});
    setLegacyWorkflowArchive(workspace.legacyWorkflowArchive || {});
    setDeletedCostVersions(workspace.deletedCostVersions);
    setCostVersionLocks(getCostVersionLocks(workspace));
    // Detail data is authoritative even if the parallel portfolio request is
    // delayed or unavailable (e.g. a project renamed through the CLI).
    setProjectList((current) => {
      const existing = current.find((item) => item.id === workspace.project.id);
      const project = {
        ...(existing ||
          projectRecord(
            workspace.project.id,
            workspace.project.name,
            workspace.project.client,
          )),
        name: workspace.project.name,
        client: workspace.project.client,
        proposalNumber: workspace.ssr?.proposalNumber || '',
      };
      return existing
        ? current.map((item) => (item.id === project.id ? project : item))
        : [...current, project];
    });
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
              subcontractCost: workspace.subcontractCost,
              rateSettings: workspace.rateSettings,
              travelSettings: workspace.travelSettings,
              travelRows: workspace.travelRows,
              travelUplift: workspace.travelUplift,
              manualCosts: workspace.manualCosts,
            }),
          ],
    );
    setCostRows(workspace.costRows);
    setSubcontractCost(
      workspace.costVersions?.find((v) => v.code === workspace.activeVersion)
        ?.subcontractCost ?? workspace.subcontractCost,
    );
    setRateSettings(workspace.rateSettings);
    setResourceTypes(workspace.resourceTypes);
    setVersionResourceTypes(
      structuredClone(
        workspace.costVersions?.find(
          (version) => version.code === workspace.activeVersion,
        )?.resourceTypes || workspace.resourceTypes,
      ),
    );
    setSubcontractItems(workspace.subcontractItems);
    setSupplementalCostItems(workspace.supplementalCostItems);
    setMaintenancePriceRecords(workspace.maintenancePriceRecords);
    setTravelSettings(workspace.travelSettings);
    setTravelRows(workspace.travelRows);
    setTravelUplift(workspace.travelUplift);
    setManualCosts(workspace.manualCosts);
    setPricing(workspace.pricing || initialPricingSettings);
    setAssumptionLibrary(
      workspace.assumptionLibrary ??
        createAssumptionLibrary(
          workspace.quoteAssumptions ?? initialQuoteAssumptions,
        ),
    );
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
    setMasterDataRevisions(workspace.masterDataRevisions);
    setCpq(workspace.cpq || emptyCpq());
    setSsr(workspace.ssr || emptySsr());
    setMaintenanceBoq(workspace.maintenanceBoq || emptyMaintenance());
  }, []);

  /** Keeps the active version's persisted snapshot synchronized with editors. */
  const synchronizedVersions = useMemo(
    () =>
      versionSnapshots.map((version) =>
        version.code === activeVersion
          ? {
              ...version,
              resourceTypes: structuredClone(versionResourceTypes),
              costRows: structuredClone(costRows),
              subcontractCost: structuredClone(subcontractCost),
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
      subcontractCost,
      manualCosts,
      rateSettings,
      travelRows,
      travelSettings,
      travelUplift,
      versionSnapshots,
      versionResourceTypes,
    ],
  );

  /** One immutable document is the atomic autosave and CLI exchange unit. */
  const workspace = useMemo<WorkbenchWorkspace>(
    () => ({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      ...(masterDataRevisions ? { masterDataRevisions } : {}),
      ...(deletedCostVersions ? { deletedCostVersions } : {}),
      costVersionLocks,
      ...(workflowEngineVersion ? { workflowEngineVersion } : {}),
      ...(workflowTemplateRevision !== undefined
        ? { workflowTemplateRevision }
        : {}),
      ...(workflowMode ? { workflowMode } : {}),
      ...(workflowHold ? { workflowHold } : {}),
      ...(workflowUpdates ? { workflowUpdates } : {}),
      workflowVersion,
      versionWorkflows,
      legacyWorkflowArchive,
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
      subcontractCost,
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
      assumptionLibrary,
      quoteTemplates,
      selectedQuoteTemplateId,
      quoteAssumptions,
      quoteHistory,
      cpq,
      maintenanceBoq,
      ssr: {
        ...ssr,
        commercialBasis: commercialBasisKey({
          project: exportProject,
          pricing,
          quoteAssumptions,
          selectedQuoteTemplateId,
          quoteTemplates,
        }),
      },
    }),
    [
      masterDataRevisions,
      deletedCostVersions,
      workflowEngineVersion,
      workflowTemplateRevision,
      workflowMode,
      workflowHold,
      workflowUpdates,
      costVersionLocks,
      workflowVersion,
      versionWorkflows,
      legacyWorkflowArchive,
      cpq,
      maintenanceBoq,
      ssr,
      activeVersion,
      costRows,
      subcontractCost,
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
      assumptionLibrary,
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
  /** Ignore edits during version transitions or after the selected cost has been locked. */
  const guardCostEdit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      if (
        !versionTransitionRef.current &&
        !costLockReason(workspace, activeVersion)
      )
        setter(value);
    };
  const lockedReason = costLockReason(workspace, activeVersion);
  const versionLockReasons = Object.fromEntries(
    Object.entries(getCostVersionLocks(workspace)).map(([code, lock]) => [
      code,
      lock.reason,
    ]),
  );
  const {
    status: persistenceStatus,
    saveNow,
    adoptSavedRecord,
    adoptRemoteIfClean,
    getLoadedRevision,
    pauseSaving,
    resumeSaving,
    isReady,
    retryLoad,
  } = useLocalWorkspace({
    projectId: exportProject.id,
    workspace,
    onHydrate: hydrateWorkspace,
    onSavedWorkspace: (saved, submitted) => {
      // A save response can normalize workflow metadata; retain any edits made after submission.
      setWorkflowEngineVersion(saved.workflowEngineVersion);
      setWorkflowTemplateRevision(saved.workflowTemplateRevision);
      setWorkflowMode(saved.workflowMode);
      setWorkflowHold(saved.workflowHold);
      setWorkflowUpdates(saved.workflowUpdates);
      setVersionWorkflows((current) => ({
        ...current,
        ...saved.versionWorkflows,
      }));
      setLegacyWorkflowArchive((current) => ({
        ...current,
        ...saved.legacyWorkflowArchive,
      }));
      setDeletedCostVersions((current) =>
        saved.deletedCostVersions
          ? { ...current, ...saved.deletedCostVersions }
          : current,
      );
      setWorkflowVersion((current) =>
        current === (submitted.workflowVersion || submitted.activeVersion)
          ? saved.workflowVersion || current
          : current,
      );
      setCurrentWorkflowStepCode((current) =>
        current === submitted.currentWorkflowStepCode
          ? saved.currentWorkflowStepCode
          : current,
      );
      setProcessSteps((current) =>
        JSON.stringify(current) === JSON.stringify(submitted.processSteps)
          ? saved.processSteps
          : current,
      );
      setProjectStatus((current) =>
        current === submitted.projectStatus ? saved.projectStatus : current,
      );
      setSelectedStep((current) =>
        current === submitted.selectedStep ? saved.selectedStep : current,
      );
      setReviewGates((current) =>
        JSON.stringify(current) === JSON.stringify(submitted.reviewGates)
          ? saved.reviewGates
          : current,
      );
      const savedLocks = getCostVersionLocks(saved);
      setCostVersionLocks((current) => {
        const merged = { ...current, ...savedLocks };
        return JSON.stringify(merged) === JSON.stringify(current)
          ? current
          : merged;
      });
    },
    onMissing: onEmpty,
  });

  /** Apply authoritative workflow details without replacing newer portfolio revisions. */
  const updateWorkflowProjection = (record: WorkspaceRecord) => {
    setProjectList((projects) => mergeWorkflowProjection(projects, record));
  };

  // Poll the compact index; load only changed open documents. Both editors retain
  // their original base while dirty, so external updates cannot rebase unsaved edits.
  const refreshPortfolio = useCallback(async () => {
    if (switchingRef.current || versionTransitionRef.current) return;
    try {
      const items = await listLocalWorkspaces();
      if (switchingRef.current || versionTransitionRef.current) return;
      setProjectList((current) =>
        items.map((item) => {
          const existing = current.find((p) => p.id === item.projectId);
          return existing && (existing.revision || 0) > (item.revision ?? 0)
            ? existing
            : projectFromIndex(item);
        }),
      );
      const active = items.find((item) => item.projectId === activeProjectId);
      const loaded = getLoadedRevision();
      let activeRecord: WorkspaceRecord | null = null;
      if (active && loaded !== null && (active.revision ?? 0) > loaded) {
        const record = await getLocalWorkspace(activeProjectId);
        activeRecord = record;
        if (record && !switchingRef.current && !versionTransitionRef.current) {
          const adopted = adoptRemoteIfClean(record);
          if (!adopted && record.revision > (getLoadedRevision() ?? 0))
            setNotice(
              '项目已有外部更新；当前未保存修改已保留，请先备份当前修改再重新载入。',
            );
        }
      }
      const target = workflowUiRef.current.target;
      const indexed = items.find(
        (item) => item.projectId === target?.project.id,
      );
      if (
        !target ||
        !indexed ||
        (indexed.revision ?? 0) <= target.revision ||
        workflowUiRef.current.saving ||
        workflowOpeningRef.current ||
        switchingRef.current ||
        versionTransitionRef.current
      )
        return;
      if (workflowDirtyRef.current) {
        setWorkflowError(
          'This project was updated elsewhere. Your edits are retained; use Refresh to review the latest progress.',
        );
        return;
      }
      const record =
        target.project.id === activeProjectId && activeRecord
          ? activeRecord
          : await getLocalWorkspace(target.project.id);
      const current = workflowUiRef.current;
      if (
        !record ||
        current.target?.project.id !== target.project.id ||
        record.revision <= current.target.revision ||
        current.saving ||
        workflowOpeningRef.current ||
        workflowDirtyRef.current ||
        switchingRef.current ||
        versionTransitionRef.current
      )
        return;
      const changedRound =
        (current.target.workspace.workflowVersion ||
          current.target.workspace.activeVersion) !==
        (record.workspace.workflowVersion || record.workspace.activeVersion);
      if (changedRound) {
        workflowPageGeneration.current++;
        setWorkflowPageKey(workflowPageGeneration.current);
      }
      setWorkflowTarget({
        ...current.target,
        project: { ...current.target.project, ...record.workspace.project },
        workspace: record.workspace,
        revision: record.revision,
        focusNodeCode: changedRound ? undefined : current.target.focusNodeCode,
      });
      setWorkflowError('');
    } catch {
      /* Existing connection status owns errors; the next refresh retries. */
    }
  }, [activeProjectId, adoptRemoteIfClean, getLoadedRevision, setNotice]);
  useEffect(() => {
    /** Refresh external changes on focus or timer ticks through the same guarded operation. */
    const refresh = () => {
      void refreshPortfolio();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshPortfolio]);

  /** Explicit lifecycle changes pause edits and adopt the server's canonical document. */
  const persistCanonicalChange = async (
    projectId: string,
    transform: (
      document: WorkbenchWorkspace,
    ) => WorkbenchWorkspace | Promise<WorkbenchWorkspace>,
    successMessage: string,
  ) => {
    if (!isReady || switchingRef.current) return false;
    const active = projectId === activeProjectId;
    return runVersionTransition({
      busy: versionTransitionRef,
      setBusy: setVersionTransitioning,
      flushAndPause: active ? pauseSaving : async () => 0,
      resume: active ? resumeSaving : () => {},
      commit: async () => {
        const record = await getLocalWorkspace(projectId);
        if (!record) throw new Error('项目已不存在，请刷新列表。');
        const next = reconcileVersionWorkflows(
          record.workspace,
          await transform(record.workspace),
        );
        const saved = await saveLocalWorkspaceDocument(next, record.revision);
        if (active) {
          adoptSavedRecord(saved);
          hydrateWorkspace(saved.workspace);
        } else {
          setProjectList((items) =>
            items.map((item) =>
              item.id !== projectId
                ? item
                : {
                    ...item,
                    projectStatus: saved.workspace.projectStatus,
                    revision: saved.revision,
                    workflowEngineVersion:
                      saved.workspace.workflowEngineVersion,
                    workflowTemplateRevision:
                      saved.workspace.workflowTemplateRevision,
                    workflowMode: saved.workspace.workflowMode,
                    workflowHold: saved.workspace.workflowHold,
                    workflowVersion: saved.workspace.workflowVersion,
                    currentWorkflowStepCode:
                      saved.workspace.currentWorkflowStepCode,
                    workflowSteps: saved.workspace.processSteps,
                    reviewGates: saved.workspace.reviewGates,
                    version: saved.workspace.activeVersion,
                    versionState:
                      saved.workspace.costVersions.find(
                        (v) => v.code === saved.workspace.activeVersion,
                      )?.state || item.versionState,
                  },
            ),
          );
        }
        setNotice(successMessage);
      },
      onFailure: (error) => {
        const message =
          error instanceof Error
            ? error.message
            : '保存失败，当前成本和流程保持不变。';
        setNotice(message);
        setConfirmationError(message);
      },
    });
  };

  /** Apply the selected global CPQ catalogue after flushing edits and verifying the same cost version. */
  const applyCpqCatalogFromGlobal = async () => {
    if (!isReady || switchingRef.current) return;
    const projectId = activeProjectId;
    const versionCode = activeVersion;
    if (
      !window.confirm(
        `${activeProject.name} · ${versionCode}：采用当前全局 CPQ 目录？未归档的匹配确认和计算结果将清除，原归档保持不变。`,
      )
    )
      return;
    await runVersionTransition({
      busy: versionTransitionRef,
      setBusy: setVersionTransitioning,
      flushAndPause: pauseSaving,
      resume: resumeSaving,
      commit: async () => {
        const record = await getLocalWorkspace(projectId);
        if (!record || record.workspace.activeVersion !== versionCode)
          throw new Error('当前成本版本已变化，请重新发起应用目录。');
        const saved = await applyGlobalProjectCatalog(
          projectId,
          'cpq-catalog',
          record.revision,
        );
        adoptSavedRecord(saved);
        hydrateWorkspace(saved.workspace);
        setNotice(
          '已明确采用全局 CPQ 目录，请重新确认条目并计算；历史归档保持不变。',
        );
      },
      onFailure: (error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : '应用目录失败，项目数据保持不变。',
        ),
    });
  };

  /** Capture current global profit-share rates through the serialized project transition. */
  const applyProfitShareFromGlobal = async (): Promise<boolean> => {
    if (!isReady || switchingRef.current || quoteExportingRef.current)
      return false;
    const projectId = activeProjectId;
    return runVersionTransition({
      busy: versionTransitionRef,
      setBusy: setVersionTransitioning,
      flushAndPause: pauseSaving,
      resume: resumeSaving,
      commit: async () => {
        const record = await getLocalWorkspace(projectId);
        if (!record)
          throw new Error(
            'Project no longer exists. Refresh the project list.',
          );
        const saved = await applyGlobalProjectCatalog(
          projectId,
          'profit-share',
          record.revision,
        );
        adoptSavedRecord(saved);
        hydrateWorkspace(saved.workspace);
        setNotice('Latest Profit Share rates applied to this project.');
      },
      onFailure: (error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : 'Unable to apply Profit Share rates.',
        ),
    });
  };

  /** Capture the reviewed cost and workflow fingerprints, then resolve when the dialog finishes. */
  const requestCostConfirmation = useCallback(
    (
      document: WorkbenchWorkspace,
      code: string,
      action: string,
      apply?: (confirmed: WorkbenchWorkspace) => WorkbenchWorkspace,
    ): Promise<boolean> => {
      try {
        const details = costConfirmationDetails(document, code);
        setConfirmationError('');
        return new Promise((resolve) =>
          setCostConfirmation({
            details,
            action,
            apply: apply || ((confirmed) => confirmed),
            resolve,
            workflowFingerprint: apply
              ? workflowConfirmationFingerprint(document)
              : undefined,
          }),
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return Promise.resolve(false);
      }
    },
    [setNotice],
  );
  /** Resolve the pending confirmation as cancelled and discard only dialog state. */
  const cancelCostConfirmation = () => {
    costConfirmation?.resolve(false);
    setCostConfirmation(null);
    setConfirmationError('');
  };
  /** Revalidate the reviewed fingerprints before saving confirmation and its dependent action. */
  const confirmCostAndContinue = async () => {
    const pending = costConfirmation;
    if (
      !pending ||
      pending.details.errors.length ||
      versionTransitionRef.current
    )
      return;
    const ok = await persistCanonicalChange(
      pending.details.projectId,
      (fresh) => {
        if (
          pending.workflowFingerprint &&
          pending.workflowFingerprint !== workflowConfirmationFingerprint(fresh)
        ) {
          throw new Error('流程或评审记录已更新，请重新发起并确认本次操作。');
        }
        const confirmed = confirmReviewedCost(
          fresh,
          pending.details.versionCode,
          pending.details.costKey,
        );
        return pending.apply(confirmed);
      },
      `成本 ${pending.details.versionCode} 已确认。${pending.action}。`,
    );
    if (ok) {
      pending.resolve(true);
      setCostConfirmation(null);
      setConfirmationError('');
    }
  };

  /** Downloads a restore-ready v2 request without sending local data away. */
  const downloadWorkspaceBackup = async () => {
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
    const fileName = `${exportProject.id}_${activeVersion}_workspace-backup.json`;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    try {
      await archiveProjectFile(exportProject.id, blob, {
        originalName: fileName,
        category: 'backup',
        versionCode: activeVersion,
      });
      setNotice(
        'Workspace backup downloaded and archived. / 工作区备份已下载并归档。',
      );
    } catch (error) {
      setNotice(
        `Workspace backup downloaded. Archive failed: ${error instanceof Error ? error.message : 'Archive unavailable'}. / 备份已下载，请保留下载文件。`,
      );
    }
  };

  /** Share the selected cost version's BU allocation with portfolio pricing and quote output. */
  const costAllocation = useMemo(
    () =>
      calculateBuCostAllocation({
        costRows,
        resourceTypes: versionResourceTypes,
        travelSettings,
        manualCosts,
        subcontractCost,
      }),
    [
      costRows,
      versionResourceTypes,
      travelSettings,
      manualCosts,
      subcontractCost,
    ],
  );

  /** Project List uses the exact same current cost and pricing engines. */
  const activeMetrics = useMemo(() => {
    return calculateWorkspaceMetrics(
      {
        costRows,
        resourceTypes: versionResourceTypes,
        travelSettings,
        manualCosts,
        subcontractCost,
        pricing,
      },
      costAllocation,
    );
  }, [
    costRows,
    manualCosts,
    pricing,
    versionResourceTypes,
    travelSettings,
    subcontractCost,
    costAllocation,
  ]);

  /** Overlay unsaved active-project values while preserving every inactive project record. */
  const portfolioProjects = useMemo(
    () =>
      projectList.map((project) =>
        project.id === activeProjectId
          ? {
              ...project,
              proposalNumber: ssr.proposalNumber || '',
              projectStatus,
              workflowEngineVersion,
              workflowTemplateRevision,
              workflowMode,
              workflowHold,
              workflowVersion,
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
              ssrAttention:
                workflowMode === 'project'
                  ? []
                  : ssrAttention(
                      workspace.ssr!,
                      synchronizedVersions.find(
                        (v) => v.code === activeVersion,
                      )!,
                      normalizeDigestDate(),
                    ),
              incompleteCostRows: countIncompleteCostRows(costRows),
            }
          : project,
      ),
    [
      activeMetrics,
      ssr.proposalNumber,
      workspace.ssr,
      workflowEngineVersion,
      workflowTemplateRevision,
      workflowMode,
      workflowHold,
      workflowVersion,
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

  /** Reset session state before loading or creating another project. */
  const selectProject = async (project: Project): Promise<boolean> => {
    if (quoteExportingRef.current) {
      setNotice(
        'Wait for quotation export before switching projects. / 请等待报价导出完成后切换项目。',
      );
      return false;
    }
    if (project.id === activeProjectId) return true;
    if (switchingRef.current || versionTransitionRef.current || !isReady)
      return false;
    switchingRef.current = true;
    setProjectSwitching(true);
    try {
      // Keep all editors intact until the newest queued revision is durable.
      if (!(await saveNow())) {
        setNotice(
          'Project switch cancelled: save failed. Your edits remain here. / 保存失败，已保留当前修改。',
        );
        return false;
      }
      // Cache the outgoing projection so portfolio and digest do not revert
      // to the values loaded at startup when another project becomes active.
      const outgoing = portfolioProjects.find(
        (item) => item.id === activeProjectId,
      );
      if (outgoing)
        setProjectList((current) =>
          current.map((item) => (item.id === outgoing.id ? outgoing : item)),
        );
      hydrateWorkspace(
        createBlankWorkspace(
          project,
          project.projectStatus || 'input_preparation',
        ),
      );
      setOpenProjectIds((current) =>
        current.includes(project.id) ? current : [...current, project.id],
      );
      setActiveProjectId(project.id);
      setNotice(`Active project: ${project.name} / 已切换项目`);
      return true;
    } finally {
      switchingRef.current = false;
      setProjectSwitching(false);
    }
  };

  /** Flush before version changes so completed workflow events lock their original version. */
  const transitionCostVersion = useCallback(
    (commit: () => void | Promise<void>) => {
      if (switchingRef.current) return Promise.resolve(false);
      return runVersionTransition({
        busy: versionTransitionRef,
        setBusy: setVersionTransitioning,
        flushAndPause: pauseSaving,
        resume: resumeSaving,
        commit,
        onFailure: () =>
          setNotice(
            '成本版本尚未保存，仍保留当前版本。请先处理保存错误后重试。',
          ),
      });
    },
    [pauseSaving, resumeSaving, setNotice],
  );

  /** Loads a version's complete snapshot after the current version is safely persisted. */
  const selectCostVersion = useCallback(
    (code: string, nextView: CostViewKey = 'input') => {
      if (code === activeVersion || !isReady) return;
      const target = synchronizedVersions.find(
        (version) => version.code === code,
      );
      if (!target) return;
      void transitionCostVersion(() => {
        // Keep server-added locks from the preceding save as well as locally derived ones.
        setCostVersionLocks((current) => ({
          ...getCostVersionLocks(workspace),
          ...current,
        }));
        setVersionSnapshots(synchronizedVersions);
        setActiveVersion(code);
        setVersionResourceTypes(
          structuredClone(target.resourceTypes || resourceTypes),
        );
        setCostRows(structuredClone(target.costRows));
        setSubcontractCost(structuredClone(target.subcontractCost));
        setRateSettings(structuredClone(target.rateSettings));
        setTravelSettings(structuredClone(target.travelSettings));
        setTravelRows(structuredClone(target.travelRows));
        setTravelUplift(target.travelUplift);
        setManualCosts(structuredClone(target.manualCosts));
        setCostView(nextView);
        setNotice(`Loaded ${code} cost snapshot / 已载入 ${code} 成本快照`);
      });
    },
    [
      activeVersion,
      synchronizedVersions,
      resourceTypes,
      workspace,
      isReady,
      transitionCostVersion,
      setNotice,
    ],
  );

  useEffect(() => {
    if (
      !requestedCostView ||
      !isReady ||
      requestedCostView.projectId !== activeProjectId
    )
      return;
    let cancelled = false;
    // Complete navigation after the requested project's asynchronous hydration.
    queueMicrotask(() => {
      if (cancelled) return;
      setRequestedCostView(null);
      setActiveView('cost');
      if (requestedCostView.code !== activeVersion)
        selectCostVersion(requestedCostView.code);
      else setCostView('summary');
    });
    return () => {
      cancelled = true;
    };
  }, [
    requestedCostView,
    isReady,
    activeProjectId,
    activeVersion,
    selectCostVersion,
  ]);

  /** New drafts start their own DTRB cycle while earlier workflow history remains intact. */
  const createNewCostVersion = () => {
    if (!isReady) return;
    void persistCanonicalChange(
      activeProjectId,
      (fresh) => {
        const source = fresh.costVersions.find(
          (v) => v.code === fresh.activeVersion,
        )!;
        const nextCode = nextCostVersionCode(fresh);
        const nextVersion = createCostVersion(
          nextCode,
          'Draft',
          source.code,
          source,
        );
        return {
          ...fresh,
          activeVersion: nextCode,
          costVersions: [...fresh.costVersions, nextVersion],
          costRows: nextVersion.costRows,
          subcontractCost: nextVersion.subcontractCost,
          rateSettings: nextVersion.rateSettings,
          travelSettings: nextVersion.travelSettings,
          travelRows: nextVersion.travelRows,
          travelUplift: nextVersion.travelUplift,
          manualCosts: nextVersion.manualCosts,
        };
      },
      '已创建新成本草稿，本轮流程停留 DTRB，原版本及评审历史已保留。',
    ).then((ok) => {
      if (ok) setCostView('input');
    });
  };

  /** Finalization always asks the user to confirm the exact version and total. */
  const updateCostVersionState = (code: string, state: CostVersionState) => {
    if (versionTransitionRef.current) return;
    const target = synchronizedVersions.find((v) => v.code === code);
    if (!target || target.state === state) return;
    if (
      target.state === 'Confirmed' ||
      (costLockReason(workspace, code) && state !== 'Confirmed')
    ) {
      setNotice(costLockReason(workspace, code) || '已定稿版本不能回退状态。');
      return;
    }
    if (state === 'Confirmed') {
      void requestCostConfirmation(
        workspace,
        code,
        '仅完成本版成本定稿，DRB 结果仍需实际登记',
      );
      return;
    }
    setVersionSnapshots((items) =>
      items.map((v) => (v.code === code ? { ...v, state } : v)),
    );
  };

  /** Creates a persisted project by switching the autosave unit to a new ID. */
  const createProject = async (input: NewProjectInput) => {
    const id = resolveNewProjectId(input.id);
    const project = {
      ...projectRecord(id, input.name, input.client),
      reviewOwner: input.owner || 'Me',
    };
    if (
      quoteExportingRef.current ||
      switchingRef.current ||
      versionTransitionRef.current ||
      !isReady
    )
      throw new Error(
        'Wait for the current project operation to finish before creating a project.',
      );
    switchingRef.current = true;
    setProjectSwitching(true);
    try {
      if (!(await saveNow()))
        throw new Error('Save current project before creating another.');
      const created = await createProjectFromGlobalMasterData(project);
      const blank = created.workspace;
      const outgoing = portfolioProjects.find(
        (item) => item.id === activeProjectId,
      );
      if (outgoing)
        setProjectList((current) =>
          current.map((item) => (item.id === outgoing.id ? outgoing : item)),
        );
      hydrateWorkspace(blank);
      setActiveProjectId(project.id);
      setOpenProjectIds((current) => [...current, project.id]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Create failed');
      throw e;
    } finally {
      switchingRef.current = false;
      setProjectSwitching(false);
    }
    setProjectList((current) => [
      project,
      ...current.filter((item) => item.id !== project.id),
    ]);
    setPanel(null);
    setActiveView('project');
  };

  /** Soft-delete a project at its saved revision and reconcile the session after a successful deletion. */
  const deleteProject = async () => {
    const target = deleteTarget;
    if (
      !target ||
      switchingRef.current ||
      quoteExportingRef.current ||
      !isReady
    )
      return;
    switchingRef.current = true;
    setProjectSwitching(true);
    setDeleteError('');
    const active = target.id === activeProjectId;
    /** Remove the deleted project from open views and choose a replacement session when needed. */
    const finishDeletion = () => {
      const remaining = portfolioProjects.filter(
        (item) => item.id !== target.id,
      );
      setPanel(null);
      setDeleteTarget(null);
      if (workflowTarget?.project.id === target.id) {
        workflowDirtyRef.current = false;
        setWorkflowTarget(null);
      }
      setProjectList(remaining);
      setOpenProjectIds((ids) => ids.filter((id) => id !== target.id));
      if (!remaining.length) {
        onEmpty();
        return;
      }
      if (active) {
        const next = remaining[0];
        hydrateWorkspace(
          createBlankWorkspace(next, next.projectStatus || 'input_preparation'),
        );
        setActiveProjectId(next.id);
        setOpenProjectIds((ids) =>
          ids.includes(next.id) ? ids : [...ids, next.id],
        );
      }
      setNotice(
        `项目已删除：${target.name}。成本及评审记录保留在本地，可通过 CLI 恢复。`,
      );
    };
    try {
      const revision = active
        ? await pauseSaving()
        : (await getLocalWorkspace(target.id))?.revision;
      if (!revision)
        throw new Error('无法保存或读取项目，请先处理保存错误再删除。');
      await deleteLocalProject(target.id, revision);
      finishDeletion();
    } catch (e) {
      if (active) resumeSaving();
      try {
        const current = await getLocalWorkspace(target.id);
        if (!current) {
          finishDeletion();
          return;
        }
      } catch (check) {
        if (
          check instanceof Error &&
          'status' in check &&
          check.status === 410
        ) {
          finishDeletion();
          return;
        }
      }
      setDeleteError(e instanceof Error ? e.message : '删除失败');
    } finally {
      switchingRef.current = false;
      setProjectSwitching(false);
    }
  };

  /** Aggregate project-owned review history for portfolio reminders and navigation. */
  const allReviewGates = useMemo(
    () => portfolioProjects.flatMap((project) => project.reviewGates || []),
    [portfolioProjects],
  );
  // Global search selects context through its dropdown; portfolio views keep their own data visible.
  const visiblePortfolioProjects = portfolioProjects;
  const displayDate = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).format(new Date());

  /** Route legacy views through Project List and keep dedicated workflow URLs synchronized. */
  const navigate = (view: ViewKey) => {
    if (view === 'workflow') {
      void openProjectWorkflow(activeProject);
      return;
    }
    const next = view === 'ssr' || view === 'reviews' ? 'project' : view;
    // A newer page choice wins over workflow saves/loads that are still awaiting the API.
    workflowNavigationIntents.current.cancel();
    pendingWorkflowLocation.current = false;
    if (parseWorkflowPageHash(window.location.hash))
      window.history.pushState(
        { ...window.history.state, workbenchView: next },
        '',
        window.location.pathname + window.location.search,
      );
    setActiveView(next);
    setMobileNavOpen(false);
    setNotice('');
  };

  /** Quote links open the independent global maintenance surface. */
  const openQuoteMasterData = (tab: QuoteMasterDataTab) => {
    setMasterDataTab(tab);
    navigate('master-data');
  };

  /** Open a dedicated workflow page while keeping the cost editor and its drafts intact. */
  const openProjectWorkflow = async (
    project: Project,
    focusNodeCode?: string,
    fromLocation = false,
  ): Promise<boolean> => {
    if (
      !isReady ||
      switchingRef.current ||
      versionTransitionRef.current ||
      workflowSaving ||
      workflowOpeningRef.current
    )
      return false;
    const sameProject = workflowTarget?.project.id === project.id;
    if (
      !sameProject &&
      workflowDirtyRef.current &&
      !window.confirm(
        'Discard unsaved workflow edits and open another project?',
      )
    ) {
      if (fromLocation && workflowTarget)
        window.history.replaceState(
          window.history.state,
          '',
          workflowPageHash(
            workflowTarget.project.id,
            workflowTarget.focusNodeCode,
          ),
        );
      return false;
    }
    const intent = workflowNavigationIntents.current.begin();
    workflowOpeningRef.current = true;
    setWorkflowLoading(true);
    setWorkflowError('');
    try {
      // Workflow and Cost share the same active project and open-tab session.
      // The standard switch flushes outgoing cost edits before changing IDs.
      const record = await loadWorkflowNavigation({
        intent,
        saveCurrent: project.id === activeProjectId ? saveNow : undefined,
        load: () => getLocalWorkspace(project.id),
        select: () => selectProject(project),
      });
      if (!record || !intent.isCurrent()) return false;
      adoptRemoteIfClean(record);
      updateWorkflowProjection(record);
      const preserveDrafts =
        sameProject && workflowDirtyRef.current && workflowTarget;
      const changedRound =
        sameProject &&
        workflowTarget &&
        (workflowTarget.workspace.workflowVersion ||
          workflowTarget.workspace.activeVersion) !==
          (record.workspace.workflowVersion || record.workspace.activeVersion);
      if (!sameProject || (changedRound && !preserveDrafts)) {
        workflowDirtyRef.current = false;
        workflowPageGeneration.current++;
        setWorkflowPageKey(workflowPageGeneration.current);
      }
      if (activeView !== 'workflow') workflowReturnView.current = activeView;
      const focus =
        focusNodeCode ||
        (sameProject && !changedRound
          ? workflowTarget?.focusNodeCode
          : undefined);
      setWorkflowTarget(
        preserveDrafts
          ? {
              ...workflowTarget,
              focusNodeCode: focus,
            }
          : {
              project: {
                ...project,
                name: record.workspace.project.name,
                client: record.workspace.project.client,
              },
              workspace: record.workspace,
              revision: record.revision,
              focusNodeCode: focus,
            },
      );
      if (preserveDrafts && record.revision > workflowTarget.revision)
        setWorkflowError(
          'This project was updated elsewhere. Your edits are retained; use Refresh to review the latest progress.',
        );
      // Reopening the same task is also an explicit request to reveal its editor.
      setWorkflowNavigationRequest((request) => request + 1);
      setActiveView('workflow');
      setMobileNavOpen(false);
      const hash = workflowPageHash(project.id, focus);
      if (!fromLocation && window.location.hash !== hash)
        window.history.pushState(
          { ...window.history.state, workbenchView: 'workflow' },
          '',
          hash,
        );
      return true;
    } catch (error) {
      if (!intent.isCurrent()) return false;
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load the project workflow.',
      );
      if (fromLocation) {
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search,
        );
        setActiveView('project');
      }
      return false;
    } finally {
      workflowOpeningRef.current = false;
      setWorkflowLoading(false);
    }
  };

  /** Reload authoritative workflow progress after resolving any unsaved workflow form edits. */
  const refreshWorkflowPage = async () => {
    if (!workflowTarget || workflowSaving || workflowOpeningRef.current)
      throw new Error('Another workflow operation is in progress.');
    if (
      workflowDirtyRef.current &&
      !window.confirm(
        'Discard unsaved workflow edits and reload the latest progress?',
      )
    )
      throw new Error('Refresh cancelled. Your unsaved edits are retained.');
    workflowOpeningRef.current = true;
    setWorkflowLoading(true);
    try {
      if (workflowTarget.project.id === activeProjectId && !(await saveNow()))
        throw new Error('Resolve the current save conflict before refreshing.');
      const record = await getLocalWorkspace(workflowTarget.project.id);
      if (!record) throw new Error('This project no longer exists.');
      adoptRemoteIfClean(record);
      updateWorkflowProjection(record);
      workflowDirtyRef.current = false;
      workflowPageGeneration.current++;
      setWorkflowPageKey(workflowPageGeneration.current);
      setWorkflowTarget((current) =>
        current
          ? {
              ...current,
              workspace: record.workspace,
              revision: record.revision,
              focusNodeCode:
                (current.workspace.workflowVersion ||
                  current.workspace.activeVersion) ===
                (record.workspace.workflowVersion ||
                  record.workspace.activeVersion)
                  ? current.focusNodeCode
                  : undefined,
            }
          : current,
      );
      setWorkflowError('');
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : 'Unable to refresh the workflow.',
      );
      throw error;
    } finally {
      workflowOpeningRef.current = false;
      setWorkflowLoading(false);
    }
  };

  // Restoring a link only selects a project/task. It never starts or completes a node.
  useEffect(() => {
    workflowRouteHandler.current = () => {
      if (!isReady) return;
      const route = parseWorkflowPageHash(window.location.hash);
      const wasOpening = workflowOpeningRef.current;
      if (wasOpening) {
        workflowNavigationIntents.current.cancel();
        // The latest workflow URL will replay after the old request releases its loading guard.
        pendingWorkflowLocation.current = Boolean(route);
        if (route) return;
      }
      if (route) {
        const project = portfolioProjects.find(
          (item) => item.id === route.projectId,
        );
        if (project) void openProjectWorkflow(project, route.nodeCode, true);
        else {
          setNotice('The linked project is unavailable.');
          window.history.replaceState(
            window.history.state,
            '',
            window.location.pathname + window.location.search,
          );
          setActiveView('project');
        }
      } else if (activeView === 'workflow' || wasOpening) {
        const previous = window.history.state?.workbenchView;
        setActiveView(
          previous &&
            previous !== 'workflow' &&
            Object.hasOwn(viewTitles, previous)
            ? previous
            : workflowReturnView.current,
        );
      }
    };
  });
  useEffect(() => {
    if (!isReady || initialWorkflowRouteHandled.current) return;
    initialWorkflowRouteHandled.current = true;
    // A page chosen during hydration supersedes refresh restoration instead of being pulled back to Workflow.
    if (activeView !== initialNavigation.view) return;
    // Existing workflow deep links win. A saved workflow view without a hash restores its own route.
    if (!window.location.hash && initialNavigation.view === 'workflow')
      window.history.replaceState(
        window.history.state,
        '',
        workflowPageHash(
          initialNavigation.projectId,
          initialNavigation.workflowNodeCode,
        ),
      );
    queueMicrotask(() => workflowRouteHandler.current());
  }, [isReady, initialNavigation, activeView]);
  useEffect(() => {
    if (
      !isReady ||
      workflowLoading ||
      workflowOpeningRef.current ||
      !pendingWorkflowLocation.current
    )
      return;
    pendingWorkflowLocation.current = false;
    queueMicrotask(() => workflowRouteHandler.current());
  }, [isReady, workflowLoading]);

  // Persist only after hydration, and never overwrite a workflow route while its project is loading.
  useEffect(() => {
    if (
      !isReady ||
      isProjectSwitching ||
      workflowLoading ||
      (activeView === 'workflow' &&
        workflowTarget?.project.id !== activeProjectId)
    )
      return;
    rememberWorkbenchNavigation({
      version: 1,
      view: activeView,
      projectId: activeProjectId,
      openProjectIds,
      costView,
      masterDataTab,
      ...(activeView === 'workflow' && workflowTarget?.focusNodeCode
        ? { workflowNodeCode: workflowTarget.focusNodeCode }
        : {}),
    });
  }, [
    isReady,
    isProjectSwitching,
    workflowLoading,
    activeView,
    activeProjectId,
    openProjectIds,
    costView,
    masterDataTab,
    workflowTarget,
  ]);

  /** Dropdown selection changes the project context, preserving the current page and cost subview. */
  const selectSearchProject = async (project: Project): Promise<boolean> => {
    if (activeView === 'workflow') return openProjectWorkflow(project);
    // The standard switch already saves business edits; optional display preferences never block it.
    return selectProject(project);
  };

  /** Validate fresh workflow evidence, confirm costs when required, and save one audited action. */
  const handleWorkflowAction = async (
    action: WorkflowAction,
  ): Promise<void> => {
    if (!workflowTarget || workflowSaving)
      throw new Error('Another workflow operation is in progress.');
    const target = workflowTarget;
    const targetId = target.project.id;
    const active = targetId === activeProjectId;
    setWorkflowSaving(true);
    setWorkflowError('');
    try {
      if (active && !(await saveNow()))
        throw new Error(
          'Save the current cost edits or resolve their conflict first.',
        );
      let record = await getLocalWorkspace(targetId);
      if (!record)
        throw new Error(
          'This project no longer exists. Refresh the project list.',
        );
      const expectedWorkflow = workflowConfirmationFingerprint(
        target.workspace,
      );
      if (
        workflowConfirmationFingerprint(record.workspace) !== expectedWorkflow
      )
        throw new Error(
          'The workflow has changed. Use Refresh to review it before making updates.',
        );
      const { versionCode: code, needsCostConfirmation: needsCost } =
        preflightWorkflowAction(record.workspace, action);
      if (needsCost) {
        const ok = await requestCostConfirmation(
          record.workspace,
          code,
          'Confirm this cost version before proceeding with the workflow task',
          (fresh) => fresh,
        );
        if (!ok)
          throw new Error(
            'Cost confirmation was cancelled. No workflow changes were saved.',
          );
        record = await getLocalWorkspace(targetId);
        if (!record) throw new Error('This project no longer exists.');
        if (
          workflowConfirmationFingerprint(record.workspace) !== expectedWorkflow
        )
          throw new Error(
            'The workflow changed after cost confirmation. Use Refresh to review the latest progress.',
          );
      }
      // Cost confirmation is a separate durable action; the node remains unmodified until this succeeds.
      const expectedRevision = record.revision;
      let failure: unknown;
      const ok = await runVersionTransition({
        busy: versionTransitionRef,
        setBusy: setVersionTransitioning,
        flushAndPause: active ? pauseSaving : async () => 0,
        resume: active ? resumeSaving : () => {},
        commit: async () => {
          const saved = await applyLocalWorkflowAction(
            targetId,
            action,
            expectedRevision,
          );
          if (active) {
            adoptSavedRecord(saved);
            hydrateWorkspace(saved.workspace);
          }
          updateWorkflowProjection(saved);
          setWorkflowTarget((current) =>
            current?.project.id === targetId
              ? {
                  ...current,
                  workspace: saved.workspace,
                  revision: saved.revision,
                  focusNodeCode: action.nodeCode || current.focusNodeCode,
                }
              : current,
          );
          setNotice(
            action.action === 'hold_project'
              ? 'Project is on hold. Workflow monitoring and reminders are paused.'
              : action.action === 'resume_project'
                ? 'Project resumed. Workflow monitoring is active again.'
                : saved.workspace.projectStatus === 'completed'
                  ? 'Quotation completed. Follow-up reminders for this round have stopped.'
                  : 'Workflow task and follow-up records updated.',
          );
        },
        onFailure: (error) => {
          failure =
            error ||
            new Error(
              'Unable to save the current edits. Resolve the conflict and try again.',
            );
        },
      });
      if (!ok)
        throw (
          failure ||
          new Error('Another save is in progress. Please try again shortly.')
        );
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : 'Unable to update the workflow task.',
      );
      throw error;
    } finally {
      setWorkflowSaving(false);
    }
  };

  /** Save workflow references against their original fingerprint and refresh the open detail page. */
  const saveProjectWorkflow = async (
    patch: ProjectWorkflowPatch,
    meta?: Pick<
      SsrWorkspace,
      | 'proposalNumber'
      | 'scopeBrief'
      | 'companyUrl'
      | 'cpqUrl'
      | 'technicalBasis'
    >,
  ) => {
    if (!workflowTarget || workflowSaving)
      throw new Error('Another workflow operation is in progress.');
    const targetId = workflowTarget.project.id;
    setWorkflowSaving(true);
    setWorkflowError('');
    try {
      if (targetId === activeProjectId && !(await saveNow()))
        throw new Error(
          'Resolve the current save conflict before saving references.',
        );
      const record = await getLocalWorkspace(targetId);
      if (!record)
        throw new Error(
          'This project no longer exists. Refresh the project list.',
        );
      const expectedWorkflow = workflowConfirmationFingerprint(
        workflowTarget.workspace,
      );
      if (
        workflowConfirmationFingerprint(record.workspace) !== expectedWorkflow
      )
        throw new Error(
          'The workflow has changed. Use Refresh to review it before making updates.',
        );
      const code =
        record.workspace.workflowVersion || record.workspace.activeVersion;
      const stage =
        patch.currentWorkflowStepCode ||
        record.workspace.currentWorkflowStepCode;
      /** Recheck concurrency before applying legacy progress or merging project reference fields. */
      const apply = (fresh: WorkbenchWorkspace) => {
        if (workflowConfirmationFingerprint(fresh) !== expectedWorkflow)
          throw new Error(
            'The workflow has changed. Use Refresh to review it before making updates.',
          );
        const next =
          fresh.workflowEngineVersion === 1
            ? structuredClone(fresh)
            : applyProjectWorkflow(fresh, patch);
        if (meta) next.ssr = { ...(next.ssr || emptySsr()), ...meta };
        return next;
      };
      const needsConfirmation =
        stage !== record.workspace.currentWorkflowStepCode &&
        requiresConfirmedWorkflowStage(record.workspace, stage) &&
        record.workspace.costVersions.find((version) => version.code === code)
          ?.state !== 'Confirmed';
      const ok = needsConfirmation
        ? await requestCostConfirmation(
            record.workspace,
            code,
            'Confirm this cost version before updating project progress',
            apply,
          )
        : await persistCanonicalChange(
            targetId,
            apply,
            stage === 'QUOTE_COMPLETED'
              ? 'Quotation completed. Project follow-up reminders have stopped.'
              : 'Project workflow and follow-up records updated.',
          );
      if (!ok)
        throw new Error(
          'References were not saved. Please retry after resolving the save error.',
        );
      if (ok) {
        const updated = await getLocalWorkspace(targetId);
        if (updated)
          setWorkflowTarget((current) =>
            current?.project.id === targetId
              ? {
                  ...current,
                  workspace: updated.workspace,
                  revision: updated.revision,
                }
              : current,
          );
      }
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : 'Unable to save the project workflow.',
      );
      throw error;
    } finally {
      setWorkflowSaving(false);
    }
  };

  /** Legacy links all resolve to the same project register. */
  const openPanel = (next: PanelState) => {
    if (!next || next.type === 'new-project') {
      setPanel(next);
      return;
    }
    const id =
      next.type === 'project'
        ? next.project.id
        : next.type === 'review'
          ? next.review.projectId
          : next.projectId;
    const project = portfolioProjects.find((item) => item.id === id);
    if (project) void openProjectWorkflow(project);
  };

  /** Switch projects through the save guard before opening the requested cost or quote page. */
  const openProjectModule = async (
    project: Project,
    view: 'cost' | 'quote',
  ) => {
    if (!(await selectProject(project))) return;
    setActiveView(view);
    setMobileNavOpen(false);
  };

  /** Closes only the visual tab; the SQLite workspace remains untouched. */
  const closeProjectTab = async (projectId: string) => {
    if (openProjectIds.length <= 1) {
      setNotice('Keep at least one project tab open / 至少保留一个项目标签');
      return;
    }
    const closingIndex = openProjectIds.indexOf(projectId);
    const remaining = openProjectIds.filter((id) => id !== projectId);
    if (projectId === activeProjectId) {
      const nextId = remaining[Math.min(closingIndex, remaining.length - 1)];
      const nextProject = portfolioProjects.find((item) => item.id === nextId);
      if (
        nextProject &&
        !(await (activeView === 'workflow'
          ? openProjectWorkflow(nextProject)
          : selectProject(nextProject)))
      )
        return;
    }
    setOpenProjectIds(remaining);
  };

  // Feature views receive explicit data and callbacks; session lifecycles remain above.
  const workflowFeedback = workflowRestoreFeedback(
    isReady,
    persistenceStatus.phase,
    persistenceStatus.message,
  );
  let content: ReactNode;
  if (activeView === 'overview')
    content = (
      <OverviewView
        workflowDefinitions={publishedWorkflow.record?.items}
        workflowDefinitionRevision={publishedWorkflow.record?.revision}
        workflowDefinitionError={publishedWorkflow.error}
        projects={visiblePortfolioProjects}
        reviews={allReviewGates}
        setView={navigate}
        setPanel={openPanel}
        onSelectProject={selectProject}
        onOpenCost={(project) => openProjectModule(project, 'cost')}
        onOpenQuote={(project) => openProjectModule(project, 'quote')}
        onTrackWorkflow={openProjectWorkflow}
      />
    );
  else if (
    activeView === 'project' ||
    activeView === 'ssr' ||
    activeView === 'reviews'
  )
    content = (
      <ProjectView
        projects={visiblePortfolioProjects}
        onOpenProject={(project) => openProjectModule(project, 'cost')}
        onOpenCost={(project) => openProjectModule(project, 'cost')}
        onOpenQuote={(project) => openProjectModule(project, 'quote')}
        onTrackWorkflow={openProjectWorkflow}
        onCreateProject={() => setPanel({ type: 'new-project' })}
        onEditProject={(project) => {
          if (
            quoteExportingRef.current ||
            switchingRef.current ||
            versionTransitionRef.current ||
            !isReady
          ) {
            setNotice('请等待当前保存或导出完成后编辑项目。');
            return;
          }
          void (async () => {
            if (project.id === activeProjectId && !(await saveNow())) {
              setNotice(
                'Resolve the current save error before editing project information.',
              );
              return;
            }
            if (!switchingRef.current && !versionTransitionRef.current)
              setEditTarget(project);
          })();
        }}
        onDeleteProject={(project) => {
          setDeleteTarget(project);
          setDeleteError('');
        }}
      />
    );
  else if (activeView === 'workflow') content = null;
  else if (activeView === 'cost')
    content = (
      <CostView
        businessUnits={costBusinessUnits}
        onSave={() =>
          isReady && !switchingRef.current && !versionTransitionRef.current
            ? saveNow()
            : Promise.resolve(false)
        }
        onRegisterSave={registerCostConfigurationSave}
        proposalNumber={ssr.proposalNumber}
        onProposalNumberChange={(proposalNumber) =>
          setSsr((current) => ({ ...current, proposalNumber }))
        }
        lockedReason={lockedReason}
        versionLockReasons={versionLockReasons}
        versionDeletionReasons={Object.fromEntries(
          synchronizedVersions.map((version) => [
            version.code,
            costVersionDeletionReason(workspace, version.code) || '',
          ]),
        )}
        onDeleteVersion={(code) => {
          if (!isReady || versionTransitionRef.current) return;
          const reason = costVersionDeletionReason(workspace, code);
          if (reason) {
            setNotice(reason);
            return;
          }
          if (
            !window.confirm(
              `删除成本 ${code}（Suspended）？它将从版本列表移除，历史快照和评审记录仍会保留。`,
            )
          )
            return;
          void persistCanonicalChange(
            activeProjectId,
            (fresh) => deleteSuspendedCostVersion(fresh, code),
            `成本 ${code} 已删除，历史记录已保留。`,
          );
        }}
        key={`${activeProject.id}:${activeVersion}`}
        activeVersion={activeVersion}
        versions={synchronizedVersions}
        onSelectVersion={selectCostVersion}
        onUpdateVersionState={updateCostVersionState}
        costView={costView}
        setCostView={setCostView}
        rows={costRows}
        setRows={guardCostEdit(setCostRows)}
        canEditCost={() =>
          isReady &&
          !switchingRef.current &&
          !versionTransitionRef.current &&
          !costLockReason(workspace, activeVersion)
        }
        subcontractCost={subcontractCost}
        onSubcontractCostChange={guardCostEdit(setSubcontractCost)}
        subcontractCatalog={subcontractItems}
        onRefreshSubcontractCatalog={async () => {
          const record =
            await getGlobalMasterData<SubcontractItem>('subcontract');
          if (record.conflictTotal)
            throw new Error(
              'Resolve Subcontract master data conflicts before selecting new items.',
            );
          return record.items;
        }}
        rateSettings={rateSettings}
        setRateSettings={guardCostEdit(setRateSettings)}
        resourceTypes={versionResourceTypes}
        onApplyMasterRates={() => {
          const projectId = activeProjectId;
          const versionCode = activeVersion;
          void persistCanonicalChange(
            projectId,
            async (fresh) => {
              const reason = costLockReason(fresh, versionCode);
              if (reason) throw new Error(reason);
              const version = fresh.costVersions.find(
                (item) => item.code === versionCode,
              );
              if (!version || version.state !== 'Draft')
                throw new Error('只能为指定 Draft 成本版本明确应用全局费率。');
              const globalRates =
                await getGlobalMasterData<ResourceType>('resources');
              const updated = captureResourceRates(version, globalRates);
              return applyCapturedResourceRates(fresh, updated);
            },
            `${versionCode} 已明确应用全局资源费率并重算；其他成本版本保持不变。`,
          );
        }}
        travelSettings={travelSettings}
        setTravelSettings={guardCostEdit(setTravelSettings)}
        travelRows={travelRows}
        setTravelRows={guardCostEdit(setTravelRows)}
        travelUplift={travelUplift}
        setTravelUplift={guardCostEdit(setTravelUplift)}
        manualCosts={manualCosts}
        setManualCosts={guardCostEdit(setManualCosts)}
        project={exportProject}
        announce={setNotice}
      />
    );
  else if (activeView === 'maintenance')
    content = (
      <MaintenanceView
        projectId={exportProject.id}
        canApply={() =>
          isReady && !switchingRef.current && !versionTransitionRef.current
        }
        key={activeProject.id}
        value={maintenanceBoq}
        onChange={(change) => {
          if (isReady && !switchingRef.current && !versionTransitionRef.current)
            setMaintenanceBoq(change);
        }}
        records={maintenancePriceRecords}
        client={exportProject.client}
        announce={setNotice}
      />
    );
  else if (activeView === 'cpq')
    content = (
      <CpqView
        projectId={exportProject.id}
        key={activeProject.id}
        value={cpq}
        catalogRevision={masterDataRevisions?.['cpq-catalog']}
        onApplyCatalog={applyCpqCatalogFromGlobal}
        catalogApplyDisabled={
          !!lockedReason ||
          synchronizedVersions.find((item) => item.code === activeVersion)
            ?.state !== 'Draft' ||
          isVersionTransitioning
        }
        onOpenCatalog={() => {
          setMasterDataTab('cpq-catalog');
          navigate('master-data');
        }}
        onChange={setCpq}
        baseline={synchronizedVersions.find(
          (version) => version.code === activeVersion,
        )!}
        totalCost={activeMetrics.totalCost}
        proposalNumber={ssr.proposalNumber}
        announce={setNotice}
      />
    );
  else if (activeView === 'master-data')
    content = (
      <GlobalMasterDataPage
        store={globalMasterData}
        activeTab={masterDataTab}
        onTabChange={setMasterDataTab}
        onWorkflowPublished={() => {
          void publishedWorkflow.refresh();
          void refreshPortfolio();
        }}
        announce={setNotice}
      />
    );
  else if (activeView === 'quote')
    content = (
      <QuoteView
        costSnapshot={buildCostExportSnapshot({
          activeVersion,
          versionStatus:
            synchronizedVersions.find(
              (version) => version.code === activeVersion,
            )?.state || 'Draft',
          project: exportProject,
          rateSettings,
          travelSettings,
          resourceTypes: versionResourceTypes,
          rows: costRows,
          manualCosts,
          subcontractCost,
        })}
        costAllocation={costAllocation}
        onApplyProfitShare={applyProfitShareFromGlobal}
        proposalNumber={ssr.proposalNumber}
        onProposalNumberChange={(proposalNumber) =>
          setSsr((current) => ({ ...current, proposalNumber }))
        }
        key={exportProject.id}
        onOpenMasterData={openQuoteMasterData}
        exportInProgress={quoteExporting}
        onExportStateChange={(exporting) => {
          quoteExportingRef.current = exporting;
          setQuoteExporting(exporting);
        }}
        project={exportProject}
        activeVersion={activeVersion}
        versionState={
          synchronizedVersions.find((version) => version.code === activeVersion)
            ?.state || 'Draft'
        }
        totalCost={activeMetrics.totalCost}
        decisionError={(() => {
          if (workflowMode === 'project') return '';
          try {
            assertQuoteDecision(
              workspace.ssr,
              synchronizedVersions.find((v) => v.code === activeVersion)!,
            );
            return '';
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        })()}
        costErrors={validateCostExportSnapshot(
          buildCostExportSnapshot({
            activeVersion,
            versionStatus:
              synchronizedVersions.find(
                (version) => version.code === activeVersion,
              )?.state || 'Draft',
            project: exportProject,
            rateSettings,
            travelSettings,
            resourceTypes: versionResourceTypes,
            rows: costRows,
            manualCosts,
            subcontractCost,
          }),
        )
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)}
        onSave={saveNow}
        pricing={pricing}
        setPricing={setPricing}
        assumptionLibrary={assumptionLibrary}
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
  else
    content = (
      <AgentView
        projects={portfolioProjects}
        reviews={allReviewGates}
        setView={navigate}
        setPanel={openPanel}
        onSelectProject={selectProject}
        onTrackWorkflow={openProjectWorkflow}
      />
    );

  return (
    <main
      inert={isProjectSwitching}
      aria-busy={isProjectSwitching}
      className="min-h-screen bg-background text-foreground"
    >
      {/* Shared chrome delegates all navigation and persistence effects to this session. */}
      <WorkbenchSidebar
        activeView={activeView}
        reviews={allReviewGates}
        onNavigate={navigate}
        onDownloadBackup={downloadWorkspaceBackup}
      />
      <div className="min-h-screen lg:pl-[216px]">
        <header
          data-workbench-header
          className="sticky top-0 z-40 border-b border-border bg-card"
        >
          <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 sm:gap-x-3 sm:px-4">
            <Button
              variant="outline"
              size="icon"
              className="size-8 lg:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-workbench-navigation"
            >
              {mobileNavOpen ? <X /> : <Menu />}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="sr-only">{pageEyebrow}</p>
              <div className="flex min-w-0 items-baseline gap-x-2">
                <h1 className="truncate text-base font-semibold leading-snug">
                  {title.title}
                </h1>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  {title.titleZh}
                </span>
                <p className="sr-only">{pageSubtitle}</p>
              </div>
              <p className="sr-only">{pageSubtitleZh}</p>
            </div>
            <div className="order-last w-full min-w-0 sm:order-none sm:w-[260px] xl:w-[320px]">
              <ProjectSearch
                projects={portfolioProjects}
                activeProjectId={activeProjectId}
                onSelect={selectSearchProject}
                disabled={
                  !isReady ||
                  isProjectSwitching ||
                  isVersionTransitioning ||
                  workflowSaving ||
                  workflowLoading ||
                  quoteExporting
                }
              />
            </div>
            <div className="sr-only">
              <span className="size-1.5 rounded-full bg-[#377054]" />
              Local Data <span className="text-[10px]">本地数据</span>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:ml-0">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Open project follow-up reminders"
                onClick={() => navigate('agent')}
              >
                <Bell />
              </Button>
              <Button
                size="sm"
                className="h-8 px-2"
                onClick={() => setPanel({ type: 'new-project' })}
              >
                <Plus />
                New Project{' '}
                <span className="sr-only sm:not-sr-only sm:text-[10px] sm:opacity-70">
                  新建项目
                </span>
              </Button>
            </div>
          </div>
          {mobileNavOpen ? (
            <nav
              id="mobile-workbench-navigation"
              aria-label="Main navigation"
              className="workbench-scrollbar flex gap-2 overflow-x-auto border-t border-border bg-muted/40 px-3 py-2 lg:hidden"
            >
              {navItems.map((item) => (
                <Button
                  key={item.key}
                  variant={activeView === item.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => navigate(item.key)}
                  aria-current={activeView === item.key ? 'page' : undefined}
                >
                  {item.label}
                  <span className="text-[10px] opacity-70">{item.labelZh}</span>
                </Button>
              ))}
            </nav>
          ) : null}
          {activeView === 'project' ||
          activeView === 'cost' ||
          activeView === 'workflow' ||
          activeView === 'quote' ? (
            <OpenProjectTabs
              projects={portfolioProjects}
              openProjectIds={openProjectIds}
              activeProjectId={activeProjectId}
              disabled={
                !isReady ||
                isProjectSwitching ||
                isVersionTransitioning ||
                workflowSaving ||
                workflowLoading ||
                quoteExporting
              }
              onSelect={async (project) => {
                if (activeView === 'workflow') {
                  await openProjectWorkflow(project);
                  return;
                }
                await selectProject(project);
              }}
              onClose={closeProjectTab}
            />
          ) : null}
        </header>
        <div className="relative z-0 isolate mx-auto min-w-0 w-full max-w-[1780px] px-3 py-2 sm:px-4 sm:py-3">
          {activeView !== 'master-data' && activeView !== 'workflow' && (
            <WorkspaceToolbar
              persistenceStatus={persistenceStatus}
              activeView={activeView}
              displayDate={displayDate}
              newVersionDisabled={!isReady || isVersionTransitioning}
              onSave={() =>
                !isReady
                  ? retryLoad()
                  : activeView === 'cost' && costConfigurationSaveRef.current
                    ? void costConfigurationSaveRef.current()
                    : void saveNow()
              }
              onBackupAndReload={async () => {
                await downloadWorkspaceBackup();
                onEmpty();
              }}
              onNewVersion={createNewCostVersion}
            />
          )}
          {activeView === 'workflow' && !workflowTarget && (
            <div className="flex flex-wrap items-center gap-2 p-3 text-sm text-muted-foreground">
              {workflowFeedback.failed ? (
                <p role="alert">{workflowFeedback.message}</p>
              ) : (
                <output>{workflowFeedback.message}</output>
              )}
              {workflowFeedback.failed && (
                <Button size="sm" variant="outline" onClick={retryLoad}>
                  Retry workflow loading / 重试加载
                </Button>
              )}
            </div>
          )}
          <div
            inert={
              activeView !== 'master-data' &&
              (!isReady || isVersionTransitioning)
            }
            aria-busy={
              activeView !== 'master-data' &&
              (!isReady || isVersionTransitioning)
            }
          >
            {activeView !== 'master-data' && activeView !== 'workflow' && (
              <ReminderInbox
                refreshKey={JSON.stringify(
                  portfolioProjects.map((project) => [
                    project.id,
                    project.workflowVersion,
                    project.workflowHold,
                    project.currentWorkflowStepCode,
                    project.workflowSteps?.map((step) => [
                      step.code,
                      step.state,
                      step.updatedAt,
                      step.reminderEnabled,
                      step.dueAt,
                      step.followUpDate,
                    ]),
                  ]),
                )}
                onOpen={(projectId, view, nodeCode) => {
                  const project = portfolioProjects.find(
                    (p) => p.id === projectId,
                  );
                  if (project) {
                    if (
                      view === 'project' ||
                      view === 'ssr' ||
                      view === 'reviews'
                    )
                      void openProjectWorkflow(project, nodeCode);
                    else
                      void selectProject(project).then((ok) => {
                        if (ok) setActiveView(view);
                      });
                  }
                }}
              />
            )}
            {workflowTarget && (
              <div
                hidden={activeView !== 'workflow'}
                inert={activeView !== 'workflow'}
              >
                <ProjectWorkflowPage
                  key={`${workflowTarget.project.id}:${workflowPageKey}`}
                  project={workflowTarget.project}
                  navigationRequest={workflowNavigationRequest}
                  workspace={workflowTarget.workspace}
                  onAction={handleWorkflowAction}
                  announce={setNotice}
                  onSetHold={(onHold) =>
                    handleWorkflowAction({
                      action: onHold ? 'hold_project' : 'resume_project',
                    })
                  }
                  onSaveReferences={(meta) => saveProjectWorkflow({}, meta)}
                  onBack={() => navigate(workflowReturnView.current)}
                  onRefresh={refreshWorkflowPage}
                  onOpenCost={() => {
                    const target = workflowTarget;
                    setRequestedCostView({
                      projectId: target.project.id,
                      code:
                        target.workspace.workflowVersion ||
                        target.workspace.activeVersion,
                    });
                    void selectProject(target.project).then((ok) => {
                      if (ok) navigate('cost');
                      else setRequestedCostView(null);
                    });
                  }}
                  onFocusNode={(code) => {
                    setWorkflowTarget((current) =>
                      current ? { ...current, focusNodeCode: code } : current,
                    );
                    if (activeView === 'workflow')
                      window.history.replaceState(
                        { ...window.history.state, workbenchView: 'workflow' },
                        '',
                        workflowPageHash(workflowTarget.project.id, code),
                      );
                  }}
                  onDirtyChange={(dirty) => {
                    workflowDirtyRef.current = dirty;
                  }}
                  focusNodeCode={workflowTarget.focusNodeCode}
                  busy={workflowSaving || workflowLoading || !isReady}
                  error={workflowError}
                />
              </div>
            )}
            {content}
          </div>
        </div>
      </div>
      <OperationNotice message={notice} onDismiss={() => setNotice('')} />
      {costConfirmation && (
        <CostConfirmationDialog
          open
          details={costConfirmation.details}
          action={costConfirmation.action}
          busy={isVersionTransitioning}
          error={confirmationError}
          onConfirm={() => {
            void confirmCostAndContinue();
          }}
          onCancel={cancelCostConfirmation}
          onViewCost={() => {
            const pending = costConfirmation;
            cancelCostConfirmation();
            const project = portfolioProjects.find(
              (item) => item.id === pending.details.projectId,
            );
            if (!project) return;
            setRequestedCostView({
              projectId: project.id,
              code: pending.details.versionCode,
            });
            void selectProject(project).then((ok) => {
              if (!ok) setRequestedCostView(null);
              else navigate('cost');
            });
          }}
        />
      )}
      {editTarget && (
        <ProjectEditDialog
          key={editTarget.id}
          project={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async (details, baseline) => {
            const targetId = editTarget.id;
            let failure: unknown;
            const saved = await persistCanonicalChange(
              targetId,
              (current) => {
                try {
                  return applyProjectDetails(current, details, baseline);
                } catch (error) {
                  failure = error;
                  throw error;
                }
              },
              'Project information saved.',
            );
            if (!saved)
              throw (
                failure ||
                new Error(
                  'Project information was not saved. Resolve the current save error and retry.',
                )
              );
            setProjectList((items) =>
              items.map((item) =>
                item.id === targetId
                  ? {
                      ...item,
                      name: details.name.trim(),
                      client: details.client.trim(),
                    }
                  : item,
              ),
            );
            try {
              const record = await getLocalWorkspace(targetId);
              if (record)
                setWorkflowTarget((current) =>
                  current?.project.id === targetId
                    ? {
                        ...current,
                        project: {
                          ...current.project,
                          name: record.workspace.project.name,
                          client: record.workspace.project.client,
                        },
                        workspace: record.workspace,
                        revision: record.revision,
                      }
                    : current,
                );
            } catch {
              setNotice(
                'Project information saved. Reopen Workflow to refresh its information.',
              );
            }
          }}
        />
      )}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isProjectSwitching) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              将「{deleteTarget?.name}
              」从项目列表移除，并停止其流程提醒。成本、报价和评审归档保留在本地，可通过
              CLI 恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  await downloadWorkspaceBackup();
                  setDeleteTarget(null);
                  onEmpty();
                }}
              >
                备份当前修改并重新加载项目列表
              </Button>
            </div>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isProjectSwitching}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteProject()}
              disabled={isProjectSwitching || quoteExporting || !isReady}
            >
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DetailSheet
        key={panel?.type === 'new-project' ? 'new-project' : 'closed'}
        open={panel?.type === 'new-project'}
        onClose={() => setPanel(null)}
        onCreateProject={createProject}
      />
    </main>
  );
}
