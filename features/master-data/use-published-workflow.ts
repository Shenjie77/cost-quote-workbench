'use client';
/** Read-only workflow source for Today, separate from unsaved Master Data edits. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getGlobalMasterData } from './global-client';
import type { GlobalMasterDataRecord } from './global-types';
import type { WorkflowStep } from '../projects/types';

export function usePublishedWorkflow(
  enabled: boolean,
  savedRecord?: GlobalMasterDataRecord,
) {
  const [record, setRecord] = useState<GlobalMasterDataRecord<WorkflowStep>>();
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef<Promise<void> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Only the saved record participates; unsaved editor items never reach Today.
  const saved =
    savedRecord?.tab === 'workflow'
      ? (savedRecord as unknown as GlobalMasterDataRecord<WorkflowStep>)
      : undefined;
  const published =
    saved && (!record || saved.revision > record.revision) ? saved : record;
  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    const request = (async () => {
      try {
        const latest = await getGlobalMasterData<WorkflowStep>('workflow');
        if (!mounted.current) return;
        setRecord((current) =>
          !current || latest.revision > current.revision ? latest : current,
        );
        setError('');
      } catch {
        if (mounted.current)
          setError(
            'Unable to refresh published workflow definitions. The last available definitions are shown.',
          );
      }
    })();
    pending.current = request;
    void request.finally(() => {
      if (pending.current === request) pending.current = null;
    });
    return request;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const reload = () => {
      void refresh();
    };
    reload();
    const timer = window.setInterval(reload, 15000);
    window.addEventListener('focus', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, [enabled, refresh]);
  return { record: published, error, refresh };
}
