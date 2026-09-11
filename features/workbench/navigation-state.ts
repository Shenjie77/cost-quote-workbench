/** Browser-only navigation preferences, kept separate from durable business documents. */
import type { CostViewKey } from '../cost/ui-types.ts';
import {
  isMasterDataTab,
  type MasterDataTab,
} from '../master-data/navigation.ts';
import { parseWorkflowPageHash } from '../projects/workflow-route.ts';
import type { ViewKey } from './types.ts';

export const WORKBENCH_NAVIGATION_KEY = 'cost-workbench.navigation.v1';
const views: ViewKey[] = [
  'overview',
  'project',
  'workflow',
  'cost',
  'quote',
  'cpq',
  'maintenance',
  'agent',
  'master-data',
];
const costViews: CostViewKey[] = ['input', 'subcontract', 'summary', 'compare'];

export type WorkbenchNavigation = {
  version: 1;
  view: ViewKey;
  projectId: string;
  openProjectIds: string[];
  costView: CostViewKey;
  masterDataTab: MasterDataTab;
  workflowNodeCode?: string;
  /** Global catalog can be open before the first project has been created. */
  standaloneMasterData?: true;
};

/** A small browser boundary makes blocked storage and refresh behavior independently testable. */
export type NavigationBrowser = {
  history: {
    state: unknown;
    replaceState(data: unknown, unused: string): void;
  };
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  location: { hash: string };
};

/** Identifiers are preferences only; never interpret them as filesystem paths or executable URLs. */
function identifier(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 200;
}

/** Accept only known destinations and bounded identifiers from older or edited browser state. */
export function parseWorkbenchNavigation(
  value: unknown,
): WorkbenchNavigation | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  const view =
    saved.view === 'ssr' || saved.view === 'reviews' ? 'project' : saved.view;
  const standalone =
    saved.standaloneMasterData === true &&
    view === 'master-data' &&
    saved.projectId === '';
  if (
    saved.version !== 1 ||
    !views.includes(view as ViewKey) ||
    (!identifier(saved.projectId) && !standalone)
  )
    return null;
  return {
    version: 1,
    view: view as ViewKey,
    projectId: saved.projectId as string,
    openProjectIds: Array.isArray(saved.openProjectIds)
      ? [...new Set(saved.openProjectIds.filter(identifier))].slice(0, 100)
      : [],
    costView: costViews.includes(saved.costView as CostViewKey)
      ? (saved.costView as CostViewKey)
      : 'input',
    masterDataTab: isMasterDataTab(saved.masterDataTab)
      ? saved.masterDataTab
      : 'resources',
    ...(identifier(saved.workflowNodeCode)
      ? { workflowNodeCode: saved.workflowNodeCode }
      : {}),
    ...(standalone ? { standaloneMasterData: true } : {}),
  };
}

/** Leaving a standalone catalog returns to bootstrap instead of reopening that saved catalog on refresh. */
export function clearWorkbenchNavigation(
  browser: NavigationBrowser | undefined = typeof window === 'undefined'
    ? undefined
    : window,
): void {
  if (!browser) return;
  try {
    const current = browser.history.state;
    const next =
      current && typeof current === 'object'
        ? ({ ...current } as Record<string, unknown>)
        : {};
    delete next.workbenchNavigation;
    delete next.workbenchView;
    browser.history.replaceState(next, '');
  } catch {
    /* A restricted browser may still allow clearing the session fallback. */
  }
  try {
    browser.sessionStorage.removeItem(WORKBENCH_NAVIGATION_KEY);
  } catch {
    /* Storage availability never blocks navigation. */
  }
}

/** History belongs to the current entry; session storage provides a same-tab fallback. */
export function readWorkbenchNavigation(
  browser: NavigationBrowser | undefined = typeof window === 'undefined'
    ? undefined
    : window,
): WorkbenchNavigation | null {
  if (!browser) return null;
  try {
    const state = browser.history.state as {
      workbenchNavigation?: unknown;
    } | null;
    const entry = parseWorkbenchNavigation(state?.workbenchNavigation);
    if (entry) return entry;
  } catch {
    /* A restricted history implementation can still use session storage. */
  }
  try {
    const raw = browser.sessionStorage.getItem(WORKBENCH_NAVIGATION_KEY);
    return raw && raw.length <= 100_000
      ? parseWorkbenchNavigation(JSON.parse(raw))
      : null;
  } catch {
    return null;
  }
}

/** Resolve saved projects against the current index; explicit workflow links take precedence. */
export function restoreWorkbenchNavigation(
  projects: ReadonlyArray<{ id: string }>,
  saved: unknown,
  hash = '',
): WorkbenchNavigation {
  const parsed = parseWorkbenchNavigation(saved);
  const ids = new Set(projects.map((project) => project.id));
  const route = parseWorkflowPageHash(hash);
  const requestedId = route?.projectId ?? parsed?.projectId;
  const projectId =
    requestedId && ids.has(requestedId) ? requestedId : projects[0]?.id || '';
  const openProjectIds = (parsed?.openProjectIds ?? []).filter((id) =>
    ids.has(id),
  );
  if (projectId && !openProjectIds.includes(projectId))
    openProjectIds.push(projectId);
  const sameProject = requestedId === projectId;
  return {
    version: 1,
    view: route ? 'workflow' : (parsed?.view ?? 'overview'),
    projectId,
    openProjectIds,
    costView: parsed?.costView ?? 'input',
    masterDataTab: parsed?.masterDataTab ?? 'resources',
    ...(sameProject && (route?.nodeCode || parsed?.workflowNodeCode)
      ? { workflowNodeCode: route ? route.nodeCode : parsed?.workflowNodeCode }
      : {}),
  };
}

/** Persist only UI location; unrelated history metadata and every business record remain untouched. */
export function rememberWorkbenchNavigation(
  navigation: WorkbenchNavigation,
  browser: NavigationBrowser | undefined = typeof window === 'undefined'
    ? undefined
    : window,
): void {
  if (!browser) return;
  const saved = parseWorkbenchNavigation(navigation);
  if (!saved) return;
  try {
    const state = browser.history.state;
    browser.history.replaceState(
      {
        ...(state && typeof state === 'object' ? state : {}),
        workbenchView: saved.view,
        workbenchNavigation: saved,
      },
      '',
    );
  } catch {
    /* Session storage still restores the page if history writes are unavailable. */
  }
  try {
    browser.sessionStorage.setItem(
      WORKBENCH_NAVIGATION_KEY,
      JSON.stringify(saved),
    );
  } catch {
    /* Reload can use this history entry when session storage is disabled or full. */
  }
}
