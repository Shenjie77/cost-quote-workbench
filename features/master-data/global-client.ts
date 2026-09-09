/** Transport for global references. No project ID or workspace read is involved. */
import { contentKey } from '@/features/cpq/domain';
import { LocalApiError } from '@/features/workbench/workspace-client';
import {
  LOCAL_API_VERSION,
  type WorkspaceRecord,
} from '@/features/workbench/workspace-types';
import type {
  GlobalMasterDataRecord,
  GlobalMasterDataTab,
  GlobalMasterDataChanges,
} from './global-types';

const API_BASE = 'http://127.0.0.1:3210/api/local';
const endpoint = (tab: GlobalMasterDataTab) =>
  `${API_BASE}/masterdata/${encodeURIComponent(tab)}`;
async function parse<T>(response: Response): Promise<T> {
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok || !envelope.data)
    throw new LocalApiError(
      envelope.error?.message || `Local API ${response.status}`,
      response.status,
    );
  return envelope.data;
}

/** A tab may have more than one page; never combine records from different revisions. */
export async function getGlobalMasterData<T = Record<string, unknown>>(
  tab: GlobalMasterDataTab,
): Promise<GlobalMasterDataRecord<T>> {
  const first = await parse<GlobalMasterDataRecord<T>>(
    await fetch(`${endpoint(tab)}?limit=1000&offset=0`),
  );
  const items = [...first.items];
  const sources = new Map(first.sources.map((entry) => [entry.key, entry]));
  for (let offset = first.items.length; offset < first.total;) {
    const page = await parse<GlobalMasterDataRecord<T>>(
      await fetch(`${endpoint(tab)}?limit=1000&offset=${offset}`),
    );
    if (page.revision !== first.revision || !page.items.length)
      throw new LocalApiError(
        'Global data changed while loading. Reload this tab. / 加载期间主数据发生变化，请重新加载页签。',
        409,
      );
    items.push(...page.items);
    page.sources.forEach((entry) => sources.set(entry.key, entry));
    offset += page.items.length;
  }
  return { ...first, items, sources: [...sources.values()], nextOffset: null };
}

export async function updateGlobalMasterData<T = Record<string, unknown>>(
  tab: GlobalMasterDataTab,
  expectedRevision: number,
  changes: GlobalMasterDataChanges<T>,
): Promise<GlobalMasterDataRecord<T>> {
  return parse(
    await fetch(endpoint(tab), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'GlobalMasterDataUpdateRequest',
        expectedRevision,
        changes,
      }),
    }),
  );
}

/** Changed rows only: untouched references never appear in the mutation payload. */
export function globalMasterDataChanges<T>(
  record: Pick<GlobalMasterDataRecord<T>, 'items' | 'keyField'>,
  items: T[],
): GlobalMasterDataChanges<T> {
  const key = (item: T) =>
    String((item as Record<string, unknown>)[record.keyField]);
  const previous = new Map(record.items.map((item) => [key(item), item]));
  const current = new Set(items.map(key));
  return {
    upsert: items.filter(
      (item) =>
        !previous.has(key(item)) ||
        contentKey(item) !== contentKey(previous.get(key(item))),
    ) as GlobalMasterDataChanges<T>['upsert'],
    remove: [...previous.keys()].filter((id) => !current.has(id)),
  };
}

/** Creation is the explicit point where the server captures the global catalog. */
export async function createProjectFromGlobalMasterData(project: {
  id: string;
  name: string;
  client: string;
  reviewOwner?: string;
}): Promise<WorkspaceRecord> {
  return parse<WorkspaceRecord>(
    await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'ProjectCreateRequest',
        project: {
          id: project.id,
          name: project.name,
          client: project.client,
          ...(project.reviewOwner === undefined
            ? {}
            : { reviewOwner: project.reviewOwner }),
        },
      }),
    }),
  ).catch((error: unknown) => {
    if (error instanceof LocalApiError && error.status === 409)
      throw new LocalApiError(
        `Project ID "${project.id}" already exists. Choose another ID or open the existing project.`,
        409,
      );
    if (error instanceof LocalApiError && error.status === 410)
      throw new LocalApiError(
        `Project ID "${project.id}" belongs to a deleted project. Restore that project or choose another ID.`,
        410,
      );
    throw error;
  });
}

/** Applying references is a separate, explicit project action with its own revision. */
export async function applyGlobalProjectCatalog(
  projectId: string,
  tab: GlobalMasterDataTab,
  expectedRevision: number,
): Promise<WorkspaceRecord> {
  return parse(
    await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/apply-masterdata`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: LOCAL_API_VERSION,
          kind: 'ApplyMasterDataRequest',
          tab,
          expectedRevision,
        }),
      },
    ),
  );
}
