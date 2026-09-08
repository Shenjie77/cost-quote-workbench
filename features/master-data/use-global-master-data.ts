'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import { contentKey } from '@/features/cpq/domain';
import {
  getGlobalMasterData,
  globalMasterDataChanges,
  updateGlobalMasterData,
} from './global-client';
import type {
  GlobalMasterDataRecord,
  GlobalMasterDataTab,
} from './global-types';

type Item = Record<string, unknown>;
export type GlobalTabState = {
  record?: GlobalMasterDataRecord;
  items: Item[];
  loading: boolean;
  saving: boolean;
  error: string;
};
export const emptyGlobalTabState: GlobalTabState = {
  items: [],
  loading: false,
  saving: false,
  error: '',
};
export const isGlobalTabDirty = (state: GlobalTabState) =>
  !!state.record && contentKey(state.record.items) !== contentKey(state.items);

/** Global draft edits live for the app session, independent of active projects. */
export function useGlobalMasterData() {
  const [tabs, setTabs] = useState<
    Partial<Record<GlobalMasterDataTab, GlobalTabState>>
  >({});
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const pending = useRef(new Set<GlobalMasterDataTab>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const patch = useCallback(
    (tab: GlobalMasterDataTab, value: Partial<GlobalTabState>) => {
      if (mounted.current)
        setTabs((all) => ({
          ...all,
          [tab]: { ...(all[tab] || emptyGlobalTabState), ...value },
        }));
    },
    [],
  );
  const load = useCallback(
    async (tab: GlobalMasterDataTab, reload = false) => {
      if (pending.current.has(tab) || (!reload && tabsRef.current[tab]?.record))
        return;
      pending.current.add(tab);
      patch(tab, { loading: true, error: '' });
      try {
        const record = await getGlobalMasterData(tab);
        patch(tab, {
          record,
          items: structuredClone(record.items),
          loading: false,
        });
      } catch (cause) {
        patch(tab, {
          loading: false,
          error:
            cause instanceof Error
              ? cause.message
              : 'Global data could not load / 全局数据加载失败',
        });
      } finally {
        pending.current.delete(tab);
      }
    },
    [patch],
  );
  const setItems = useCallback(
    <T>(tab: GlobalMasterDataTab, change: SetStateAction<T[]>) => {
      setTabs((all) => {
        const state = all[tab];
        if (!state?.record || state.loading || state.saving) return all;
        const current = state.items as T[];
        const items = typeof change === 'function' ? change(current) : change;
        return {
          ...all,
          [tab]: { ...state, items: items as Item[], error: '' },
        };
      });
    },
    [],
  );
  const save = useCallback(
    async (tab: GlobalMasterDataTab) => {
      const state = tabsRef.current[tab];
      if (!state?.record || pending.current.has(tab)) return false;
      if (!isGlobalTabDirty(state)) return true;
      pending.current.add(tab);
      patch(tab, { saving: true, error: '' });
      try {
        const saved = await updateGlobalMasterData(
          tab,
          state.record.revision,
          globalMasterDataChanges(state.record, state.items),
        );
        const record =
          saved.items.length < saved.total
            ? await getGlobalMasterData(tab)
            : saved;
        patch(tab, {
          record,
          items: structuredClone(record.items),
          saving: false,
        });
        return true;
      } catch (cause) {
        patch(tab, {
          saving: false,
          error:
            cause instanceof Error
              ? cause.message
              : 'Global save failed; edits retained / 全局保存失败，修改已保留',
        });
        return false;
      } finally {
        pending.current.delete(tab);
      }
    },
    [patch],
  );
  const dirty = Object.values(tabs).some(
    (state) => state && isGlobalTabDirty(state),
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return { tabs, load, save, setItems, dirty };
}
export type GlobalMasterDataStore = ReturnType<typeof useGlobalMasterData>;
