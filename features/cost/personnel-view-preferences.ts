/** Version-specific display settings, deliberately separate from persisted cost inputs. */
import {
  PERSONNEL_COLUMNS_STORAGE_KEY,
  defaultPersonnelColumns,
  normalizePersonnelColumns,
  type PersonnelColumnPreferences,
} from './personnel-columns.ts';
import type { PersonnelTableLayout } from './personnel-table-layout.ts';

export type PersonnelViewPreferences = {
  version: 1;
  grouped: boolean;
  yearIndex: PersonnelTableLayout['yearIndex'];
  columns: PersonnelColumnPreferences;
};
type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;
export const PERSONNEL_VIEW_STORAGE_PREFIX =
  'cost-workbench:personnel-view:v1:';
const MAX_STORED_LENGTH = 20000;

export function personnelViewStorageKey(
  configurationId?: string,
): string | null {
  if (
    typeof configurationId !== 'string' ||
    !configurationId.trim() ||
    configurationId.length > 2000
  )
    return null;
  try {
    return `${PERSONNEL_VIEW_STORAGE_PREFIX}${encodeURIComponent(configurationId)}`;
  } catch {
    return null;
  }
}

export function defaultPersonnelView(
  columns: PersonnelColumnPreferences = defaultPersonnelColumns(),
): PersonnelViewPreferences {
  return {
    version: 1,
    grouped: false,
    yearIndex: 'all',
    columns: normalizePersonnelColumns(columns),
  };
}

/** Reject malformed view envelopes; repair obsolete column IDs using the established column rules. */
export function parsePersonnelView(
  value: unknown,
): PersonnelViewPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const view = value as Partial<PersonnelViewPreferences>;
  if (
    view.version !== 1 ||
    typeof view.grouped !== 'boolean' ||
    !['all', 0, 1, 2, 3, 4].includes(view.yearIndex as number | string) ||
    !view.columns ||
    view.columns.version !== 1 ||
    !Array.isArray(view.columns.order) ||
    !Array.isArray(view.columns.hidden) ||
    view.columns.order.some((id) => typeof id !== 'string') ||
    view.columns.hidden.some((id) => typeof id !== 'string')
  )
    return null;
  const columns = normalizePersonnelColumns(view.columns);
  return {
    version: 1,
    grouped: view.grouped,
    yearIndex: view.yearIndex!,
    columns: {
      ...columns,
      hidden: columns.order.filter((id) => columns.hidden.includes(id)),
    },
  };
}

const parseStored = (text: string | null): unknown => {
  if (!text || text.length > MAX_STORED_LENGTH) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function loadPersonnelView(
  storage: ReadStorage | undefined,
  configurationId?: string,
) {
  try {
    if (!storage) throw new Error('Browser storage unavailable');
    const key = personnelViewStorageKey(configurationId);
    const saved = key
      ? parsePersonnelView(parseStored(storage.getItem(key)))
      : null;
    if (saved)
      return { preferences: saved, saved: true, storageAvailable: true };
    const legacyColumns = normalizePersonnelColumns(
      parseStored(storage.getItem(PERSONNEL_COLUMNS_STORAGE_KEY)),
    );
    return {
      preferences: defaultPersonnelView(legacyColumns),
      saved: false,
      storageAvailable: true,
    };
  } catch {
    return {
      preferences: defaultPersonnelView(),
      saved: false,
      storageAvailable: false,
    };
  }
}

export function savePersonnelView(
  storage: WriteStorage | undefined,
  configurationId: string | undefined,
  value: PersonnelViewPreferences,
): boolean {
  const key = personnelViewStorageKey(configurationId);
  const normalized = parsePersonnelView(value);
  if (!storage || !key || !normalized) return false;
  try {
    storage.setItem(key, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

type ViewSnapshot = {
  configurationId?: string;
  preferences: PersonnelViewPreferences;
  ready: boolean;
  saved: boolean;
  storageAvailable: boolean;
  isViewDirty: boolean;
};

/** A single owner for grouped/year/columns prevents independent hydration or auto-save effects racing. */
export function createPersonnelViewStore() {
  const serverSnapshot: ViewSnapshot = {
    preferences: defaultPersonnelView(),
    ready: false,
    saved: false,
    storageAvailable: true,
    isViewDirty: false,
  };
  let snapshot = serverSnapshot;
  let baseline = '';
  const listeners = new Set<() => void>();
  const publish = (next: ViewSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate: (
      configurationId: string | undefined,
      storage: ReadStorage | undefined,
    ) => {
      const loaded = loadPersonnelView(storage, configurationId);
      baseline = JSON.stringify(parsePersonnelView(loaded.preferences));
      publish({ configurationId, ...loaded, ready: true, isViewDirty: false });
    },
    update: (
      configurationId: string | undefined,
      update: (current: PersonnelViewPreferences) => PersonnelViewPreferences,
    ) => {
      if (!snapshot.ready || configurationId !== snapshot.configurationId)
        return false;
      const preferences = parsePersonnelView(update(snapshot.preferences));
      if (!preferences) return false;
      const fingerprint = JSON.stringify(preferences);
      publish({
        ...snapshot,
        preferences,
        isViewDirty: fingerprint !== baseline,
      });
      return true;
    },
    save: (
      configurationId: string | undefined,
      storage: WriteStorage | undefined,
    ) => {
      if (!snapshot.ready || configurationId !== snapshot.configurationId)
        return false;
      const saved = savePersonnelView(
        storage,
        configurationId,
        snapshot.preferences,
      );
      if (saved)
        baseline = JSON.stringify(parsePersonnelView(snapshot.preferences));
      publish({
        ...snapshot,
        saved: saved || snapshot.saved,
        storageAvailable: saved,
        isViewDirty: saved ? false : snapshot.isViewDirty,
      });
      return saved;
    },
  };
}
