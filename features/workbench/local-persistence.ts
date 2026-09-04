/**
 * Browser adapter for the same-device SQLite API.
 *
 * It hydrates once, then saves complete workspace snapshots after a short
 * debounce. Revision checks prevent two browser tabs from silently replacing
 * one another. The hook deliberately exposes state instead of showing UI so
 * the workbench shell controls bilingual status presentation.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  QuoteAssumption,
  QuoteHistoryRecord,
  QuoteTemplate,
} from '@/features/quote/types';
import type { ReviewGate } from '@/features/reviews/types';

export const LOCAL_API_VERSION = 'cost-workbench/local-v1' as const;
export const WORKSPACE_SCHEMA_VERSION = '1.0.0' as const;

export type WorkbenchWorkspace = {
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

type WorkspaceRecord = {
  revision: number;
  updatedAt: string;
  workspace: WorkbenchWorkspace;
};

export type LocalWorkspaceIndexItem = {
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
};

const API_BASE = 'http://127.0.0.1:3210/api/local';

/** Lists locally persisted projects for the project switcher. */
export async function listLocalWorkspaces(): Promise<
  LocalWorkspaceIndexItem[]
> {
  const response = await fetch(`${API_BASE}/workspaces`);
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: LocalWorkspaceIndexItem[];
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new LocalApiError(
      envelope.error?.message || 'Unable to list local projects.',
    );
  }
  return envelope.data;
}

class LocalApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalApiError';
  }
}

const parseRecord = async (response: Response): Promise<WorkspaceRecord> => {
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: WorkspaceRecord;
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new LocalApiError(
      envelope.error?.message || `Local API ${response.status}.`,
    );
  }
  return envelope.data;
};

/** Reads one workspace without starting the React autosave lifecycle. */
export async function getLocalWorkspace(
  projectId: string,
): Promise<WorkspaceRecord | null> {
  const response = await fetch(
    `${API_BASE}/workspaces/${encodeURIComponent(projectId)}`,
  );
  if (response.status === 404) return null;
  return parseRecord(response);
}

/**
 * Performs one revision-checked workspace write. Project List uses this for a
 * status change on a project that is not currently mounted in the editor.
 */
export async function saveLocalWorkspaceDocument(
  workspace: WorkbenchWorkspace,
  expectedRevision: number | null,
): Promise<WorkspaceRecord> {
  const response = await fetch(
    `${API_BASE}/workspaces/${encodeURIComponent(workspace.project.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'WorkspaceSaveRequest',
        expectedRevision,
        workspace,
      }),
    },
  );
  return parseRecord(response);
}

export function useLocalWorkspace({
  projectId,
  workspace,
  onHydrate,
}: {
  projectId: string;
  workspace: WorkbenchWorkspace;
  onHydrate: (workspace: WorkbenchWorkspace) => void;
}) {
  const [status, setStatus] = useState<PersistenceStatus>({
    phase: 'connecting',
    revision: null,
    savedAt: null,
    message: 'Connecting to local SQLite / 正在连接本地数据库',
  });
  const revisionRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const latestWorkspaceRef = useRef(workspace);
  const hydrateRef = useRef(onHydrate);
  const lastSavedJsonRef = useRef('');

  useEffect(() => {
    latestWorkspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    hydrateRef.current = onHydrate;
  }, [onHydrate]);

  const saveDocument = useCallback(
    async (document: WorkbenchWorkspace) => {
      setStatus((current) => ({
        ...current,
        phase: 'saving',
        message: 'Saving locally / 正在保存',
      }));
      try {
        const response = await fetch(
          `${API_BASE}/workspaces/${encodeURIComponent(projectId)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiVersion: LOCAL_API_VERSION,
              kind: 'WorkspaceSaveRequest',
              expectedRevision: revisionRef.current,
              workspace: document,
            }),
          },
        );
        if (response.status === 409) {
          setStatus((current) => ({
            ...current,
            phase: 'conflict',
            message:
              'Another tab saved a newer revision; reload before editing. / 其他窗口已有新版本，请刷新后再编辑。',
          }));
          return false;
        }
        const record = await parseRecord(response);
        revisionRef.current = record.revision;
        lastSavedJsonRef.current = JSON.stringify(document);
        setStatus({
          phase: 'saved',
          revision: record.revision,
          savedAt: record.updatedAt,
          message: `Saved locally · R${record.revision} / 已保存`,
        });
        return true;
      } catch (error) {
        const rejected = error instanceof LocalApiError;
        setStatus({
          phase: rejected ? 'error' : 'offline',
          revision: revisionRef.current,
          savedAt: null,
          message:
            error instanceof Error
              ? rejected
                ? `Save rejected: ${error.message} / 数据未通过校验`
                : `Local API unavailable: ${error.message}`
              : 'Local API unavailable / 本地服务未连接',
        });
        return false;
      }
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    readyRef.current = false;
    // A revision belongs to exactly one project. Carrying it across a switch
    // would make a brand-new project incorrectly look like a write conflict.
    revisionRef.current = null;
    lastSavedJsonRef.current = '';
    void (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/workspaces/${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        if (response.status === 404) {
          readyRef.current = true;
          await saveDocument(latestWorkspaceRef.current);
          return;
        }
        const record = await parseRecord(response);
        if (controller.signal.aborted) return;
        revisionRef.current = record.revision;
        lastSavedJsonRef.current = JSON.stringify(record.workspace);
        hydrateRef.current(record.workspace);
        readyRef.current = true;
        setStatus({
          phase: 'saved',
          revision: record.revision,
          savedAt: record.updatedAt,
          message: `Loaded local data · R${record.revision} / 已载入`,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus({
          phase: 'offline',
          revision: null,
          savedAt: null,
          message:
            error instanceof Error
              ? `Local API unavailable: ${error.message}`
              : 'Local API unavailable / 本地服务未连接',
        });
      }
    })();
    return () => controller.abort();
  }, [projectId, saveDocument]);

  useEffect(() => {
    if (
      !readyRef.current ||
      status.phase === 'connecting' ||
      status.phase === 'saving' ||
      status.phase === 'conflict'
    )
      return;
    const serialized = JSON.stringify(workspace);
    if (serialized === lastSavedJsonRef.current) return;
    const timer = window.setTimeout(() => {
      void saveDocument(latestWorkspaceRef.current);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [saveDocument, status.phase, workspace]);

  const saveNow = useCallback(
    () => saveDocument(latestWorkspaceRef.current),
    [saveDocument],
  );

  return { status, saveNow };
}
