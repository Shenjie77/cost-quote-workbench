/** Preview and publish a workflow draft with explicit global/project revisions. */
import { LocalApiError } from '@/features/workbench/workspace-client';
import { LOCAL_API_VERSION } from '@/features/workbench/workspace-types';
import type { WorkflowStep } from '@/features/projects/types';
import type { WorkflowSyncPreview } from '@/features/projects/workflow-engine';
import type { GlobalMasterDataRecord } from './global-types';

export type WorkflowPublishProject = WorkflowSyncPreview & {
  projectId: string;
  name: string;
  revision: number;
  completed: boolean;
};
export type WorkflowPublishPreview = {
  revision: number;
  nextRevision: number;
  projects: WorkflowPublishProject[];
};
export type WorkflowPublishResult = {
  record: GlobalMasterDataRecord;
  updatedProjects: { projectId: string; revision: number }[];
  retainedProjects: { projectId: string; revision: number }[];
};
export type WorkflowPublishDraft = {
  steps: WorkflowStep[];
  expectedRevision: number;
  migrateActiveProjectIds?: string[];
};
async function request<T>(
  path: 'preview' | 'publish',
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `http://127.0.0.1:3210/api/local/workflow/${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiVersion: LOCAL_API_VERSION, ...body }),
    },
  );
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok || !envelope.data)
    throw new LocalApiError(
      envelope.error?.message || `Workflow API ${response.status}`,
      response.status,
    );
  return envelope.data;
}
export function previewWorkflowPublish(draft: WorkflowPublishDraft) {
  return request<WorkflowPublishPreview>('preview', {
    kind: 'WorkflowPublishPreviewRequest',
    ...draft,
  });
}
export function publishWorkflowTemplate(
  draft: WorkflowPublishDraft,
  projectRevisions: Record<string, number>,
) {
  return request<WorkflowPublishResult>('publish', {
    kind: 'WorkflowPublishRequest',
    ...draft,
    projectRevisions,
  });
}
