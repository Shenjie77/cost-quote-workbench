import {
  useEffect,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react';
import {
  defaultPersonnelColumns,
  movePersonnelColumn,
  setPersonnelColumnVisible,
  visiblePersonnelColumns,
  type PersonnelColumnId,
} from './personnel-columns.ts';
import { createPersonnelViewStore } from './personnel-view-preferences.ts';
import type { PersonnelTableLayout } from './personnel-table-layout.ts';

const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** One version-specific view shared by the grid and export; persistence requires explicit Save. */
export function usePersonnelTableView(configurationId?: string) {
  const [store] = useState(createPersonnelViewStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) store.hydrate(configurationId, browserStorage());
    });
    return () => {
      cancelled = true;
    };
  }, [configurationId, store]);
  // During project/version switches, never show the previous version's settings or accept edits to them.
  const current =
    snapshot.configurationId === configurationId
      ? snapshot
      : store.getServerSnapshot();
  const { preferences, ready, saved, storageAvailable, isViewDirty } = current;
  const setGrouped = (value: SetStateAction<boolean>) => {
    if (ready)
      store.update(configurationId, (view) => ({
        ...view,
        grouped: typeof value === 'function' ? value(view.grouped) : value,
      }));
  };
  const setYearIndex = (
    value: SetStateAction<PersonnelTableLayout['yearIndex']>,
  ) => {
    if (ready)
      store.update(configurationId, (view) => ({
        ...view,
        yearIndex: typeof value === 'function' ? value(view.yearIndex) : value,
      }));
  };
  const columnSettings = {
    preferences: preferences.columns,
    columns: visiblePersonnelColumns(preferences.columns),
    ready,
    storageAvailable,
    setVisible: (id: PersonnelColumnId, visible: boolean) => {
      if (ready)
        store.update(configurationId, (view) => ({
          ...view,
          columns: setPersonnelColumnVisible(view.columns, id, visible),
        }));
    },
    move: (id: PersonnelColumnId, direction: 'left' | 'right') => {
      if (ready)
        store.update(configurationId, (view) => ({
          ...view,
          columns: movePersonnelColumn(view.columns, id, direction),
        }));
    },
    reset: () => {
      if (ready)
        store.update(configurationId, (view) => ({
          ...view,
          columns: defaultPersonnelColumns(),
        }));
    },
  };
  const layout: PersonnelTableLayout = {
    grouped: preferences.grouped,
    yearIndex: preferences.yearIndex,
    columns: columnSettings.columns,
  };
  return {
    layout,
    columnSettings,
    setGrouped,
    setYearIndex,
    ready,
    saved,
    isViewDirty,
    saveView: () => ready && store.save(configurationId, browserStorage()),
  };
}

export type PersonnelTableView = ReturnType<typeof usePersonnelTableView>;
