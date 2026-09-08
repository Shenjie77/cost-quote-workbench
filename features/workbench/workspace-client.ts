/** Same-device HTTP transport. It owns envelopes/errors, but no React state. */
import {
  LOCAL_API_VERSION,
  type WorkbenchWorkspace,
  type LocalWorkspaceIndexItem,
  type WorkspaceRecord,
} from './workspace-types';
const API_BASE = 'http://127.0.0.1:3210/api/local';

/** Lists locally persisted projects for the project switcher. */
export async function listLocalWorkspaces(): Promise<
  LocalWorkspaceIndexItem[]
> {
  const response = await fetch(`${API_BASE}/workspaces`);
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: LocalWorkspaceIndexItem[];
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new LocalApiError(
      envelope.error?.message || 'Unable to list local projects.',
    );
  }
  return envelope.data;
}

export class LocalApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = 'LocalApiError';
  }
}

const parseRecord = async (response: Response): Promise<WorkspaceRecord> => {
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: WorkspaceRecord;
    error?: { message?: string };
  };
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new LocalApiError(
      envelope.error?.message || `Local API ${response.status}.`,
      response.status,
    );
  }
  return envelope.data;
};

/** Reads one workspace without starting the React autosave lifecycle. */
export async function getLocalWorkspace(
  projectId: string,
): Promise<WorkspaceRecord | null> {
  const response = await fetch(
    `${API_BASE}/workspaces/${encodeURIComponent(projectId)}`,
  );
  if (response.status === 404) return null;
  return parseRecord(response);
}

/**
 * Performs one revision-checked workspace write. Project List uses this for a
 * status change on a project that is not currently mounted in the editor.
 */
export async function saveLocalWorkspaceDocument(
  workspace: WorkbenchWorkspace,
  expectedRevision: number | null,
): Promise<WorkspaceRecord> {
  const response = await fetch(
    `${API_BASE}/workspaces/${encodeURIComponent(workspace.project.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'WorkspaceSaveRequest',
        expectedRevision,
        workspace,
      }),
    },
  );
  return parseRecord(response);
}

/** Recoverable removal; the server retains complete snapshots and rejects stale saves. */
export async function deleteLocalProject(
  projectId: string,
  expectedRevision: number,
) {
  const response = await fetch(
    `${API_BASE}/workspaces/${encodeURIComponent(projectId)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'ProjectDeleteRequest',
        expectedRevision,
      }),
    },
  );
  const envelope = (await response.json()) as {
    ok: boolean;
    error?: { message?: string };
    data?: { projectId: string; revision: number; deleted: boolean };
  };
  if (!response.ok || !envelope.ok)
    throw new LocalApiError(
      envelope.error?.message || 'Unable to delete project.',
      response.status,
    );
  return envelope.data as {
    projectId: string;
    revision: number;
    deleted: boolean;
  };
}

/** Dedicated node action; the server owns workflow transitions and audit history. */
export async function applyLocalWorkflowAction(
  projectId: string,
  action: import('../projects/workflow-engine').WorkflowAction,
  expectedRevision: number,
): Promise<WorkspaceRecord> {
  return parseRecord(
    await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/workflow-action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: LOCAL_API_VERSION,
          kind: 'WorkflowActionRequest',
          expectedRevision,
          action,
        }),
      },
    ),
  );
}
