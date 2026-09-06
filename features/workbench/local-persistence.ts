/**
 * React lifecycle for a project-scoped save queue. Late network responses can
 * only update their own session; navigation flushes edits before changing IDs.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createSaveQueue } from './save-queue';
import {
  getLocalWorkspace,
  saveLocalWorkspaceDocument,
  LocalApiError,
} from './workspace-client';
import type { WorkbenchWorkspace, PersistenceStatus } from './workspace-types';

export * from './workspace-types';
export {
  getLocalWorkspace,
  listLocalWorkspaces,
  saveLocalWorkspaceDocument,
} from './workspace-client';

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
  const [readyProjectId, setReadyProjectId] = useState<string | null>(null);
  const isReady = readyProjectId === projectId;
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(workspace);
  const hydrate = useRef(onHydrate);
  const session = useRef<{
    projectId: string;
    queue: ReturnType<typeof createSaveQueue<WorkbenchWorkspace>>;
  } | null>(null);
  useEffect(() => {
    latest.current = workspace;
  }, [workspace]);
  useEffect(() => {
    hydrate.current = onHydrate;
  }, [onHydrate]);

  useEffect(() => {
    let cancelled = false;
    session.current = null;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setReadyProjectId(null);
      setStatus({
        phase: 'connecting',
        revision: null,
        savedAt: null,
        message: 'Loading project / 正在加载项目',
      });
      try {
        const record = await getLocalWorkspace(projectId);
        if (cancelled) return;
        const queue = createSaveQueue<WorkbenchWorkspace>({
          revision: record?.revision ?? null,
          savedDocument: record?.workspace,
          persist: saveLocalWorkspaceDocument,
          onSaving: () => {
            if (!cancelled)
              setStatus((current) => ({
                ...current,
                phase: 'saving',
                message: 'Saving locally / 正在保存',
              }));
          },
          onSaved: (saved) => {
            if (!cancelled)
              setStatus({
                phase: 'saved',
                revision: saved.revision,
                savedAt: saved.updatedAt,
                message: `Saved locally · R${saved.revision} / 已保存`,
              });
          },
          isConflict: (error) =>
            error instanceof LocalApiError && error.status === 409,
          onError: (error) => {
            if (cancelled) return;
            const phase =
              error instanceof LocalApiError
                ? error.status === 409
                  ? 'conflict'
                  : 'error'
                : 'offline';
            setStatus((current) => ({
              ...current,
              phase,
              message:
                phase === 'conflict'
                  ? 'Newer data exists. Download a backup of these edits before reloading. / 数据冲突，请先备份当前修改再刷新。'
                  : `Save failed: ${error instanceof Error ? error.message : 'Unknown error'} / 保存失败，修改仍保留在当前项目`,
            }));
          },
        });
        session.current = { projectId, queue };
        if (record) {
          hydrate.current(record.workspace);
          setStatus({
            phase: 'saved',
            revision: record.revision,
            savedAt: record.updatedAt,
            message: `Loaded local data · R${record.revision} / 已载入`,
          });
        } else if (latest.current.project.id === projectId) {
          await queue.save(latest.current);
        }
        if (!cancelled) setReadyProjectId(projectId);
      } catch (error) {
        if (!cancelled)
          setStatus({
            phase: 'offline',
            revision: null,
            savedAt: null,
            message: `Load failed: ${error instanceof Error ? error.message : 'Unknown error'} / 加载失败，请重试`,
          });
      }
    })();
    return () => {
      cancelled = true;
      session.current = null;
    };
  }, [projectId, reloadKey]);

  useEffect(() => {
    const current = session.current;
    if (
      !isReady ||
      current?.projectId !== projectId ||
      workspace.project.id !== projectId ||
      ['connecting', 'saving', 'conflict', 'offline', 'error'].includes(
        status.phase,
      ) ||
      current.queue.isSaved(workspace)
    )
      return;
    const timer = window.setTimeout(() => {
      void current.queue.save(latest.current);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [isReady, projectId, status.phase, workspace]);

  /** Flushes even when autosave is in flight; failure leaves the editor intact. */
  const saveNow = useCallback(() => {
    const current = session.current;
    if (
      !isReady ||
      current?.projectId !== projectId ||
      latest.current.project.id !== projectId
    ) {
      return Promise.resolve(false);
    }
    return current.queue.save(latest.current);
  }, [isReady, projectId]);

  useEffect(() => {
    const warnIfDirty = (event: BeforeUnloadEvent) => {
      if (session.current && !session.current.queue.isSaved(latest.current)) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warnIfDirty);
    return () => window.removeEventListener('beforeunload', warnIfDirty);
  }, []);

  return {
    status,
    isReady,
    saveNow,
    retryLoad: () => setReloadKey((key) => key + 1),
  };
}
