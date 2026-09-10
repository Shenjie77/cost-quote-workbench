/** File archives use small, dedicated endpoints, independently of cost/workflow writes. */
import { LOCAL_API_VERSION } from '../workbench/workspace-types';

const API_BASE = 'http://127.0.0.1:3210/api/local';
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
export type ProjectFileCategory =
  | 'general'
  | 'workflow'
  | 'cost'
  | 'quote'
  | 'cpq'
  | 'maintenance'
  | 'source'
  | 'backup';
export type ProjectFileRecord = {
  id: string;
  projectId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  category: ProjectFileCategory;
  nodeCode?: string;
  nodeName?: string;
  versionCode?: string;
  relativePath: string;
};
export type ProjectFileFilter = {
  category?: ProjectFileCategory;
  nodeCode?: string;
  versionCode?: string;
};
export type ProjectFileArchive = {
  projectId: string;
  rootPath: string;
  projectPath: string;
  /** Actual relative upload destination resolved from the project's saved archive policy. */
  uploadFolder?: string;
  files: ProjectFileRecord[];
};
export type ProjectArchiveLocation = Omit<ProjectFileArchive, 'files'>;
export type ArchiveSettings = {
  rootPath: string;
  defaultRootPath: string;
  revision: number;
};

export class ProjectFileApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProjectFileApiError';
    this.status = status;
  }
}

async function parse<T>(response: Response): Promise<T> {
  let envelope: { ok?: boolean; data?: T; error?: { message?: string } };
  try {
    envelope = await response.json();
  } catch {
    throw new ProjectFileApiError(
      `File archive API ${response.status}.`,
      response.status,
    );
  }
  if (!response.ok || !envelope.ok || !envelope.data)
    throw new ProjectFileApiError(
      envelope.error?.message || `File archive API ${response.status}.`,
      response.status,
    );
  return envelope.data;
}

const projectEndpoint = (projectId: string) =>
  `${API_BASE}/projects/${encodeURIComponent(projectId)}/files`;

/** Opens a saved archive location on the API host; browsers never navigate file URLs. */
export async function openArchiveFolder(
  projectId?: string,
  fileId?: string,
): Promise<{ opened: true }> {
  if (fileId && !projectId)
    throw new TypeError('A project is required to open a document folder.');
  const endpoint = projectId
    ? `${projectEndpoint(projectId)}${fileId ? `/${encodeURIComponent(fileId)}` : ''}`
    : `${API_BASE}/archive-settings`;
  return parse(
    await fetch(`${endpoint}/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'ArchiveFolderOpenRequest',
      }),
    }),
  );
}

/** Deletes one archived document through the dedicated project/file boundary. */
export async function deleteProjectFile(
  projectId: string,
  fileId: string,
): Promise<{ id: string; deleted: true }> {
  return parse(
    await fetch(`${projectEndpoint(projectId)}/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'ProjectFileDeleteRequest',
      }),
    }),
  );
}

export async function moveProjectArchive(
  projectId: string,
  projectPath: string,
  expectedProjectPath: string,
): Promise<ProjectArchiveLocation> {
  return parse(
    await fetch(`${projectEndpoint(projectId)}/location`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'ProjectArchiveMoveRequest',
        projectPath,
        expectedProjectPath,
      }),
    }),
  );
}
export async function getArchiveSettings(): Promise<ArchiveSettings> {
  return parse(await fetch(`${API_BASE}/archive-settings`));
}
export async function updateArchiveSettings(
  rootPath: string,
  expectedRevision: number,
): Promise<ArchiveSettings> {
  return parse(
    await fetch(`${API_BASE}/archive-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: LOCAL_API_VERSION,
        kind: 'ArchiveSettingsUpdateRequest',
        rootPath,
        expectedRevision,
      }),
    }),
  );
}
export async function listProjectFiles(
  projectId: string,
  filter: ProjectFileFilter = {},
): Promise<ProjectFileArchive> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter))
    if (value) query.set(key, value);
  return parse(
    await fetch(
      `${projectEndpoint(projectId)}${query.size ? `?${query}` : ''}`,
    ),
  );
}

/** Retain requestId when retrying an uncertain upload to avoid duplicate archives. */
export async function archiveProjectFile(
  projectId: string,
  file: Blob,
  options: ProjectFileFilter & {
    category: ProjectFileCategory;
    originalName?: string;
    requestId?: string;
  },
): Promise<ProjectFileRecord> {
  if (file.size > MAX_PROJECT_FILE_BYTES)
    throw new Error('Each file must be 50 MiB or smaller.');
  const originalName =
    options.originalName ||
    (typeof File !== 'undefined' && file instanceof File
      ? file.name
      : 'document');
  const query = new URLSearchParams({
    originalName,
    mimeType: file.type || 'application/octet-stream',
    category: options.category,
    requestId: options.requestId || crypto.randomUUID(),
  });
  if (options.nodeCode) query.set('nodeCode', options.nodeCode);
  if (options.versionCode) query.set('versionCode', options.versionCode);
  return parse(
    await fetch(`${projectEndpoint(projectId)}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }),
  );
}
export const projectFileDownloadUrl = (projectId: string, fileId: string) =>
  `${projectEndpoint(projectId)}/${encodeURIComponent(fileId)}/content`;

export function projectFileSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
