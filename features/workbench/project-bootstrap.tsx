'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listLocalWorkspaces } from './workspace-client';
import { projectRecord } from './workspace-factories';
import { NewProjectIdField } from './new-project-id-field';
import { projectIdError, resolveNewProjectId } from './project-creation';
import { createProjectFromGlobalMasterData } from '@/features/master-data/global-client';
import type { Project } from '../projects/types';
import type { LocalWorkspaceIndexItem } from './workspace-types';
import { ArchiveSettingsPanel } from '../projects/project-files-panel';

export const projectFromIndex = (item: LocalWorkspaceIndexItem): Project => ({
  ...projectRecord(item.projectId, item.name, item.client),
  revision: item.revision ?? undefined,
  workflowHold: item.workflowHold,
  workflowEngineVersion: item.workflowEngineVersion,
  workflowTemplateRevision: item.workflowTemplateRevision,
  projectStatus: item.projectStatus,
  workflowMode: item.workflowMode,
  workflowVersion: item.workflowVersion,
  ...(item.statusDefinitions?.length
    ? { statusDefinitions: item.statusDefinitions }
    : {}),
  reviewGates: item.reviewGates || [],
  ...(item.currentWorkflowStepCode
    ? { currentWorkflowStepCode: item.currentWorkflowStepCode }
    : {}),
  ...(item.workflowSteps?.length ? { workflowSteps: item.workflowSteps } : {}),
  version: item.activeVersion || 'V1',
  versionState: item.versionState || 'Draft',
  serviceCost: item.serviceCost,
  subcontractCost: item.subcontractCost,
  totalCost: item.totalCost,
  totalMandays: item.totalMandays,
  totalQuote: item.totalQuote,
  grossMarginPercent: item.grossMarginPercent,
  incompleteCostRows: item.incompleteCostRows,
  ssrAttention: item.ssrAttention,
});

/** Persisted index is authoritative. Empty/deleted databases never seed demo projects. */
export function ProjectBootstrap({
  renderSession,
  onOpenMasterData,
}: {
  renderSession: (projects: Project[], onEmpty: () => void) => ReactNode;
  onOpenMasterData?: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [archiveBlocked, setArchiveBlocked] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void listLocalWorkspaces()
      .then((items) => {
        if (!cancelled) {
          setProjects(items.map(projectFromIndex));
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);
  const reload = () => {
    setProjects(null);
    setError('');
    setRefresh((n) => n + 1);
  };
  if (projects?.length) return renderSession(projects, reload);
  const create = async () => {
    if (
      !name.trim() ||
      !client.trim() ||
      busy ||
      archiveBlocked ||
      projectIdError(projectId)
    )
      return;
    setBusy(true);
    try {
      const project = projectRecord(
        resolveNewProjectId(projectId),
        name.trim(),
        client.trim(),
      );
      await createProjectFromGlobalMasterData(project);
      setProjects([project]);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-16">
      <section className="wb-panel mx-auto max-w-xl space-y-5 p-5 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">
          Cost & Quote Workbench
        </h1>
        {onOpenMasterData && (
          <Button variant="outline" onClick={onOpenMasterData}>
            Global Master Data / 全局主数据
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {projects === null ? (
          <>
            <p>Loading local projects / 正在加载本地项目</p>
            {error && <Button onClick={reload}>Retry / 重试</Button>}
          </>
        ) : (
          <>
            <h2 className="font-semibold">Project List / 项目列表 · 0</h2>
            <p className="text-sm text-muted-foreground">
              暂无项目。新建项目后开始维护成本和报价。
            </p>
            <NewProjectIdField
              inputId="first-project-id"
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setError('');
              }}
              disabled={busy}
            />
            <label className="block text-sm">
              项目名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="block text-sm">
              客户
              <Input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                disabled={busy}
              />
            </label>
            <ArchiveSettingsPanel
              disabled={busy}
              onBlockedChange={setArchiveBlocked}
            />
            <Button
              onClick={() => void create()}
              disabled={
                busy ||
                archiveBlocked ||
                !name.trim() ||
                !client.trim() ||
                Boolean(projectIdError(projectId))
              }
            >
              New Project / 新建项目
            </Button>
            <p className="text-xs text-muted-foreground">
              已删除项目的成本和评审记录保留在本地，可通过 CLI 恢复。
            </p>
          </>
        )}
      </section>
    </main>
  );
}
