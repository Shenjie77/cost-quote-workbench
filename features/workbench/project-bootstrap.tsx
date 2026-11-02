'use client';

import { Surface, Text } from '@/components/ui/presentation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listLocalWorkspaces } from './workspace-client';
import { projectFromIndex, projectRecord } from './workspace-factories';
import { NewProjectIdField } from './new-project-id-field';
import { projectIdError, resolveNewProjectId } from './project-creation';
import { createProjectFromGlobalMasterData } from '@/features/master-data/global-client';
import type { Project } from '../projects/types';
import { ArchiveSettingsPanel } from '../projects/project-files-panel';

// Keep the shell's existing import stable while the projection remains independently testable.
export { projectFromIndex } from './workspace-factories';

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
    <Surface as="main" variant="inset" className="min-h-screen">
      <Surface
        as="section"
        variant="panel"
        padded
        className="mx-auto max-w-xl space-y-5"
      >
        <Text as="h1" tone="primary">
          Cost & Quote Workbench
        </Text>
        {onOpenMasterData && (
          <Button variant="outline" onClick={onOpenMasterData}>
            Global Master Data / 全局主数据
          </Button>
        )}
        {error && (
          <Text role="alert" as="p" tone="danger" textRole="body-main">
            {error}
          </Text>
        )}
        {projects === null ? (
          <>
            <p>Loading local projects / 正在加载本地项目</p>
            {error && <Button onClick={reload}>Retry / 重试</Button>}
          </>
        ) : (
          <>
            <h2>Project List / 项目列表 · 0</h2>
            <Text as="p" tone="muted" textRole="body-main">
              暂无项目。新建项目后开始维护成本和报价。
            </Text>
            <NewProjectIdField
              inputId="first-project-id"
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setError('');
              }}
              disabled={busy}
            />
            <Surface
              as="label"
              variant="field"
              textRole="body-main"
              className="block"
            >
              项目名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-main"
              className="block"
            >
              客户
              <Input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                disabled={busy}
              />
            </Surface>
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
            <Text as="p" tone="muted" textRole="body-small">
              已删除项目的成本和评审记录保留在本地，可通过 CLI 恢复。
            </Text>
          </>
        )}
      </Surface>
    </Surface>
  );
}
