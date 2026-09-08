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
  WifiOff,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { costVersionDeletionReason, deleteSuspendedCostVersion, nextCostVersionCode } from '../cost/version-deletion';
import { ProjectBootstrap } from './project-bootstrap';
import { runVersionTransition } from '../cost/version-transition';
import {
  migrateVersionWorkflows,
  reconcileVersionWorkflows,
  isDrbStep,
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
import { SsrView } from '@/features/ssr/ssr-view';
import { applySsrEditFromView } from '@/features/ssr/review-submission-action';
import {
  assertQuoteDecision,
  commercialBasisKey,
  emptySsr,
  recordSubmission,
  ssrAttention,
  type SsrWorkspace,
} from '@/features/ssr/domain';
import { normalizeDigestDate } from '@/features/agent/digest-domain';
import { CpqView } from '@/features/cpq/cpq-view';
import { emptyCpq, type CpqWorkspace } from '@/features/cpq/domain';
import type { TravelCostRow } from '@/features/cost/additional-travel-domain';
import { CostView } from '@/features/cost/cost-view';
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
import {
  getCostStatementValues,
  getHQTravelSummary,
  roundMoney,
  recalculateCostRows,
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
import { captureResourceRates } from '@/features/master-data/capture';
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
import { QuoteView } from '@/features/quote/quote-view';
import {
  calculatePricing,
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
import { ReviewsView } from '@/features/reviews/reviews-view';
import type { ReviewGate } from '@/features/reviews/types';
import { DetailSheet } from '@/features/workbench/detail-sheet';
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

export function WorkbenchApp() {
  const globalMasterData = useGlobalMasterData();
  const [masterDataOnly, setMasterDataOnly] = useState(false);
  const [masterDataTab, setMasterDataTab] =
    useState<MasterDataTab>('resources');
  const [globalNotice, setGlobalNotice] = useState('');
  if (masterDataOnly)
    return (
      <main className="min-h-screen space-y-4 bg-background p-6">
        <Button variant="outline" onClick={() => setMasterDataOnly(false)}>
          Project List / 项目列表
        </Button>
        {globalNotice && (
          <output className="block text-sm">{globalNotice}</output>
        )}
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
  const [projectList, setProjectList] = useState<Project[]>(initialProjects);
  const [masterDataRevisions, setMasterDataRevisions] =
    useState<WorkbenchWorkspace['masterDataRevisions']>();
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [costVersionLocks, setCostVersionLocks] = useState<
    Record<string, CostLock>
  >({});
  const [deletedCostVersions, setDeletedCostVersions] = useState<WorkbenchWorkspace['deletedCostVersions']>();
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
  const [quoteExporting, setQuoteExporting] = useState(false);
  /** Protect the output/history pair when users navigate during Excel generation. */
  useEffect(() => {
    const warnPendingExport = (event: BeforeUnloadEvent) => {
      if (quoteExportingRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnPendingExport);
    return () => window.removeEventListener('beforeunload', warnPendingExport);
  }, []);
  const [isProjectSwitching, setProjectSwitching] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0].id);
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([
    initialProjects[0].id,
  ]);
  const activeProject =
    projectList.find((item) => item.id === activeProjectId) ??
    initialProjects[0];
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
  const hydrateWorkspace = useCallback((input: WorkbenchWorkspace) => {
    const workspace = migrateVersionWorkflows(input);
    setWorkflowVersion(workspace.workflowVersion || workspace.activeVersion);
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
      costVersionLocks,
      workflowVersion,
      versionWorkflows,
      legacyWorkflowArchive,
      cpq,
      maintenanceBoq,
      ssr,
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
    saveProjectDetails,
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
      setVersionWorkflows((current) => ({
        ...current,
        ...saved.versionWorkflows,
      }));
      setLegacyWorkflowArchive((current) => ({
        ...current,
        ...saved.legacyWorkflowArchive,
      }));
      setDeletedCostVersions((current) => saved.deletedCostVersions
        ? { ...current, ...saved.deletedCostVersions } : current);
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
    [],
  );
  const cancelCostConfirmation = () => {
    costConfirmation?.resolve(false);
    setCostConfirmation(null);
    setConfirmationError('');
  };
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

  const handleSsrChange = (next: SsrWorkspace): boolean =>
    applySsrEditFromView({
      previous: workspace.ssr!,
      next,
      versions: synchronizedVersions,
      onChange: setSsr,
      onRequestConfirmCost: (code, value) => {
        void requestCostConfirmation(
          workspace,
          code,
          '登记本版 DRB 实际评审结果或条件关闭记录',
          (confirmed) => ({ ...confirmed, ssr: value }),
        );
      },
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
      versionResourceTypes,
      travelSettings,
    ).totalCost;
    const statement = getCostStatementValues(
      costRows,
      versionResourceTypes,
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
  }, [costRows, manualCosts, pricing, versionResourceTypes, travelSettings]);

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
              ssrAttention: ssrAttention(
                workspace.ssr!,
                synchronizedVersions.find((v) => v.code === activeVersion)!,
                normalizeDigestDate(),
              ),
              incompleteCostRows: costRows.filter(
                (row) =>
                  !row.scope.trim() ||
                  !row.bu.trim() ||
                  !row.reTypeId.trim() ||
                  (row.inputMode !== 'mandays' && row.mdPerSite <= 0) ||
                  !row.years.some(
                    (year) =>
                      year.sites > 0 ||
                      (year.mandays || 0) > 0 ||
                      year.cost > 0,
                  ),
              ).length,
            }
          : project,
      ),
    [
      activeMetrics,
      workspace.ssr,
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
    [pauseSaving, resumeSaving],
  );

  /** Loads a version's complete snapshot after the current version is safely persisted. */
  const selectCostVersion = useCallback(
    (code: string) => {
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
        setRateSettings(structuredClone(target.rateSettings));
        setTravelSettings(structuredClone(target.travelSettings));
        setTravelRows(structuredClone(target.travelRows));
        setTravelUplift(target.travelUplift);
        setManualCosts(structuredClone(target.manualCosts));
        setCostView('input');
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
        if (!record)
          throw new Error('Project no longer exists. Refresh Project List.');
        const document = { ...record.workspace, projectStatus: status };
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

  /** Advancing this project's current cycle to DRB requires an explicitly confirmed cost. */
  const updateProjectWorkflow = async (
    project: Project,
    workflowCode: string,
  ) => {
    if (versionTransitionRef.current) return;
    const record =
      project.id === activeProjectId
        ? { workspace }
        : await getLocalWorkspace(project.id);
    if (!record) {
      setNotice('项目已不存在。');
      return;
    }
    const document = record.workspace;
    const step = document.processSteps.find((row) => row.code === workflowCode);
    if (!step) {
      setNotice('Workflow node not found / 未找到流程节点');
      return;
    }
    const code = document.workflowVersion || document.activeVersion;
    const version = document.costVersions.find((v) => v.code === code);
    const apply = (fresh: WorkbenchWorkspace) => ({
      ...fresh,
      currentWorkflowStepCode: workflowCode,
      selectedStep: fresh.processSteps.findIndex(
        (row) => row.code === workflowCode,
      ),
    });
    if (isDrbStep(step) && version?.state !== 'Confirmed') {
      await requestCostConfirmation(document, code, '进入本版 DRB 流程', apply);
      return;
    }
    await persistCanonicalChange(project.id, apply, '当前流程已更新。');
  };

  /** Creates or updates one review gate in its owning project workspace. */
  const saveReviewGate = useCallback(
    async (review: ReviewGate) => {
      const source =
        review.projectId === activeProjectId
          ? { workspace }
          : await getLocalWorkspace(review.projectId);
      if (!source) {
        setNotice('未找到评审所属项目');
        return false;
      }
      const document = source.workspace;
      const boundCode =
        review.costVersion ||
        document.reviewGates.find((item) => item.id === review.id)
          ?.costVersion ||
        document.workflowVersion ||
        document.activeVersion;
      review = { ...review, costVersion: boundCode };
      const previous = document.reviewGates.find(
        (item) => item.id === review.id,
      );
      const startsDrb =
        isDrbStep({ code: review.workflowStepCode, name: review.gate }) &&
        !['not_started', 'cancelled'].includes(review.status) &&
        previous?.status !== review.status;
      if (
        startsDrb &&
        document.costVersions.find((v) => v.code === boundCode)?.state !==
          'Confirmed'
      ) {
        return requestCostConfirmation(
          document,
          boundCode,
          '保存本版 DRB 评审节点',
          (confirmed) => ({
            ...confirmed,
            reviewGates: confirmed.reviewGates.some(
              (item) => item.id === review.id,
            )
              ? confirmed.reviewGates.map((item) =>
                  item.id === review.id ? review : item,
                )
              : [...confirmed.reviewGates, review],
          }),
        );
      }
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
        if (!record)
          throw new Error('Project no longer exists. Refresh Project List.');
        const document = record.workspace;
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
    [activeProjectId, portfolioProjects, workspace, requestCostConfirmation],
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
  const createProject = async (input: {
    name: string;
    client: string;
    owner: string;
  }) => {
    const id = `PRJ-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8)}`;
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
      return;
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
      return;
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
    const finishDeletion = () => {
      const remaining = portfolioProjects.filter(
        (item) => item.id !== target.id,
      );
      setPanel(null);
      setDeleteTarget(null);
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

  /** Quote links open the independent global maintenance surface. */
  const openQuoteMasterData = (tab: QuoteMasterDataTab) => {
    setMasterDataTab(tab);
    navigate('master-data');
  };

  /** Opens a project in the tab strip and routes to its requested module. */
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
      if (nextProject && !(await selectProject(nextProject))) return;
    }
    setOpenProjectIds(remaining);
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
          setEditTarget(project);
        }}
        onDeleteProject={(project) => {
          setDeleteTarget(project);
          setDeleteError('');
        }}
      />
    );
  else if (activeView === 'cost')
    content = (
      <CostView
        lockedReason={lockedReason}
        versionLockReasons={versionLockReasons}
        versionDeletionReasons={Object.fromEntries(synchronizedVersions.map((version) => [version.code, costVersionDeletionReason(workspace, version.code) || '']))}
        onDeleteVersion={(code) => {
          if (!isReady || versionTransitionRef.current) return;
          const reason = costVersionDeletionReason(workspace, code);
          if (reason) { setNotice(reason); return; }
          if (!window.confirm(`删除成本 ${code}（Suspended）？它将从版本列表移除，历史快照和评审记录仍会保留。`)) return;
          void persistCanonicalChange(activeProjectId, (fresh) => deleteSuspendedCostVersion(fresh, code), `成本 ${code} 已删除，历史记录已保留。`);
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
              return {
                ...fresh,
                costVersions: fresh.costVersions.map((item) =>
                  item.code === versionCode ? updated : item,
                ),
                ...(fresh.activeVersion === versionCode
                  ? { costRows: updated.costRows }
                  : {}),
              };
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
        key={activeProject.id}
        value={maintenanceBoq}
        onChange={setMaintenanceBoq}
        records={maintenancePriceRecords}
        client={exportProject.client}
        announce={setNotice}
      />
    );
  else if (activeView === 'ssr')
    content = (
      <SsrView
        key={`${activeProject.id}:${workflowVersion}`}
        value={workspace.ssr!}
        onChange={handleSsrChange}
        baseline={synchronizedVersions.find((v) => v.code === workflowVersion)!}
        baselines={synchronizedVersions}
        onRequestConfirmCost={(input) => {
          void requestCostConfirmation(
            workspace,
            workflowVersion,
            '登记本版 DRB 送审记录',
            (confirmed) => ({
              ...confirmed,
              ssr: recordSubmission(
                confirmed.ssr!,
                confirmed.costVersions.find((v) => v.code === workflowVersion)!,
                input,
              ),
            }),
          );
        }}
        announce={setNotice}
      />
    );
  else if (activeView === 'cpq')
    content = (
      <CpqView
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
        announce={setNotice}
      />
    );
  else if (activeView === 'quote')
    content = (
      <QuoteView
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
    <main
      inert={isProjectSwitching}
      aria-busy={isProjectSwitching}
      className="min-h-screen bg-background text-foreground"
    >
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
                  全局主数据 · Rates, CPQ & templates
                </span>
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
                      onClick={async () => {
                        if (!(await selectProject(tabProject))) return;
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
          {activeView !== 'master-data' && (
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
                  Local SQLite{' '}
                  <span className="ml-1 text-[8px]">本地数据库</span>
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
                  onClick={() => (isReady ? void saveNow() : retryLoad())}
                  disabled={persistenceStatus.phase === 'saving'}
                >
                  <Save className="size-3" /> Save{' '}
                  <span className="text-[8px]">保存</span>
                </Button>
                {['conflict', 'error', 'offline'].includes(
                  persistenceStatus.phase,
                ) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      downloadWorkspaceBackup();
                      onEmpty();
                    }}
                  >
                    备份并重载项目列表
                  </Button>
                )}
                {activeView === 'cost' ? (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[9px]"
                    onClick={createNewCostVersion}
                    disabled={!isReady || isVersionTransitioning}
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
            {activeView !== 'master-data' && (
              <ReminderInbox
                onOpen={(projectId, view) => {
                  const project = portfolioProjects.find(
                    (p) => p.id === projectId,
                  );
                  if (project)
                    void selectProject(project).then((ok) => {
                      if (ok) setActiveView(view);
                    });
                }}
              />
            )}
            {content}
          </div>
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
            });
          }}
        />
      )}
      {editTarget && (
        <ProjectEditDialog
          key={editTarget.id}
          project={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async (details, revision) => {
            const targetId = editTarget.id;
            if (targetId === activeProjectId) {
              if (!(await saveProjectDetails(details)))
                throw new Error(
                  '保存失败，请先处理工作区保存错误；输入内容已保留。',
                );
            } else {
              const current = await getLocalWorkspace(targetId);
              if (!current) throw new Error('项目已删除，请刷新列表。');
              if (current.revision !== revision)
                throw new Error('项目已被更新，请关闭并重新打开 Edit 后修改。');
              await saveLocalWorkspaceDocument(
                {
                  ...current.workspace,
                  project: { ...current.workspace.project, ...details },
                },
                revision,
              );
            }
            setProjectList((items) =>
              items.map((item) =>
                item.id === targetId ? { ...item, ...details } : item,
              ),
            );
            setNotice('Project updated / 项目名称与客户已保存');
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
                onClick={() => {
                  downloadWorkspaceBackup();
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
