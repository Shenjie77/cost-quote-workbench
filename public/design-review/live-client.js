/** Same-device transport with revision checks. All responses retain the complete legacy workspace. */
export const API_VERSION = 'cost-workbench/local-v1';
export function apiBase(location = globalThis.location) {
  // Test instances explicitly opt into a different loopback port; never send local business data off-device.
  const port = new URLSearchParams(location.search).get('apiPort') || '3210';
  if (!/^\d{2,5}$/.test(port) || +port > 65535)
    throw new Error('Invalid local API port');
  return `http://127.0.0.1:${port}/api/local`;
}
export class CompactApi {
  constructor(base = apiBase(), fetcher = (...args) => fetch(...args)) {
    this.base = base;
    this.fetcher = fetcher;
  }
  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await this.fetcher(this.base + path, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof Blob)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: body instanceof Blob ? body : JSON.stringify(body) }
        : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const e = new Error(
        result.error?.message || `Local API ${response.status}`,
      );
      e.status = response.status;
      throw e;
    }
    return result.data;
  }
  list() {
    return this.request('/workspaces');
  }
  load(id) {
    return this.request(`/workspaces/${encodeURIComponent(id)}`);
  }
  save(workspace, revision) {
    return this.request(
      `/workspaces/${encodeURIComponent(workspace.project.id)}`,
      {
        method: 'PUT',
        body: {
          apiVersion: API_VERSION,
          kind: 'WorkspaceSaveRequest',
          expectedRevision: revision,
          workspace,
        },
      },
    );
  }
  workflow(id, revision, action) {
    return this.request(`/projects/${encodeURIComponent(id)}/workflow-action`, {
      method: 'POST',
      body: {
        apiVersion: API_VERSION,
        kind: 'WorkflowActionRequest',
        expectedRevision: revision,
        action,
      },
    });
  }
  files(id) {
    return this.request(`/projects/${encodeURIComponent(id)}/files`);
  }
  fileUrl(id, fileId) {
    return `${this.base}/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/content`;
  }
  openFolder(id, category, fileId) {
    return this.request(
      `/projects/${encodeURIComponent(id)}/files${fileId ? `/${encodeURIComponent(fileId)}` : ''}/open-folder${category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : ''}`,
      {
        method: 'POST',
        body: { apiVersion: API_VERSION, kind: 'ArchiveFolderOpenRequest' },
      },
    );
  }
  deleteFile(id, fileId) {
    return this.request(
      `/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        body: { apiVersion: API_VERSION, kind: 'ProjectFileDeleteRequest' },
      },
    );
  }
  createProject(project) {
    return this.request('/projects', {
      method: 'POST',
      body: { apiVersion: API_VERSION, kind: 'ProjectCreateRequest', project },
    });
  }
}
