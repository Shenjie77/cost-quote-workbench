#!/usr/bin/env node

/** Minimal same-device JSON API for the SQLite workbench repository. */

import { openReminderService } from './reminder-service.mjs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalMasterDataConflictError } from './global-master-data.mjs';
import { ProjectFileError } from './project-files.mjs';
import { routeProjectFiles } from './project-files-api.mjs';
import {
  createProject,
  applyProjectMasterData,
} from './workspace-resources.mjs';

import {
  LOCAL_API_VERSION,
  RepositoryConflictError,
  RepositoryNotFoundError,
  openWorkspaceRepository,
} from './workspace-repository.mjs';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const PORT = Number(process.env.COST_WORKBENCH_API_PORT || 3210);
const DATABASE_PATH = path.resolve(
  process.env.COST_WORKBENCH_DB || path.join(ROOT_DIR, 'data/workbench.sqlite'),
);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const repository = openWorkspaceRepository(DATABASE_PATH);
const reminders = openReminderService(DATABASE_PATH, repository);
const scanReminders = () => {
  try {
    reminders.scan();
  } catch (e) {
    process.stderr.write(`[reminders] ${e.message}\n`);
  }
};
scanReminders();
const reminderTimer = setInterval(scanReminders, 60000);
reminderTimer.unref();
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const commonHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type, If-Match',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

const send = (response, status, body, extraHeaders = {}) => {
  response.writeHead(status, { ...commonHeaders, ...extraHeaders });
  response.end(`${JSON.stringify(body)}\n`);
};

const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new RangeError('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const route = async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    send(response, 403, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'LocalError',
      ok: false,
      error: { code: 'ORIGIN_FORBIDDEN', message: 'Origin is not allowed.' },
    });
    return;
  }
  const respond = (status, body, headers = {}) =>
    send(response, status, body, {
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      ...headers,
    });
  if (request.method === 'OPTIONS') {
    respond(204, null);
    return;
  }
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/api/local/health') {
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'LocalHealth',
      ok: true,
      data: {
        database: 'ready',
        schemaVersion: repository.schemaVersion,
      },
    });
    return;
  }
  if (
    await routeProjectFiles({
      request,
      response,
      url,
      repository,
      respond,
      readJson,
      origin,
    })
  )
    return;
  if (request.method === 'GET' && url.pathname === '/api/local/workspaces') {
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'WorkspaceList',
      ok: true,
      data: repository.list(),
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/local/projects') {
    const body = await readJson(request);
    if (
      body?.apiVersion !== LOCAL_API_VERSION ||
      body?.kind !== 'ProjectCreateRequest' ||
      !body.project ||
      !['id', 'name', 'client'].every(
        (key) =>
          typeof body.project[key] === 'string' && body.project[key].trim(),
      ) ||
      (body.project.reviewOwner !== undefined &&
        typeof body.project.reviewOwner !== 'string') ||
      Object.keys(body.project).some(
        (key) => !['id', 'name', 'client', 'reviewOwner'].includes(key),
      )
    )
      throw new TypeError('Invalid ProjectCreateRequest envelope.');
    createProject(repository, body.project);
    const record = repository.get(body.project.id);
    respond(201, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'WorkspaceRecord',
      ok: true,
      data: record,
    });
    return;
  }
  const applyMasterMatch = url.pathname.match(
    /^\/api\/local\/projects\/([^/]+)\/apply-masterdata$/,
  );
  const workflowProject = url.pathname.match(
    /^\/api\/local\/projects\/([^/]+)\/(workflow-plan|workflow-action)$/,
  );
  if (workflowProject) {
    const projectId = decodeURIComponent(workflowProject[1]);
    if (workflowProject[2] === 'workflow-plan' && request.method === 'GET') {
      respond(200, {
        apiVersion: LOCAL_API_VERSION,
        kind: 'WorkflowPlanResult',
        ok: true,
        data: repository.workflowPlan(projectId),
      });
      return;
    }
    if (workflowProject[2] === 'workflow-action' && request.method === 'POST') {
      const body = await readJson(request);
      if (
        body?.apiVersion !== LOCAL_API_VERSION ||
        body?.kind !== 'WorkflowActionRequest' ||
        !body.action ||
        !Number.isSafeInteger(body.expectedRevision) ||
        body.expectedRevision < 1
      )
        throw new TypeError('Invalid WorkflowActionRequest envelope.');
      const record = repository.applyWorkflowAction(
        projectId,
        body.action,
        body.expectedRevision,
      );
      scanReminders();
      respond(200, {
        apiVersion: LOCAL_API_VERSION,
        kind: 'WorkspaceRecord',
        ok: true,
        data: record,
      });
      return;
    }
  }
  if (
    ['/api/local/workflow/preview', '/api/local/workflow/publish'].includes(
      url.pathname,
    ) &&
    request.method === 'POST'
  ) {
    const body = await readJson(request);
    const publishing = url.pathname.endsWith('/publish');
    if (
      body?.apiVersion !== LOCAL_API_VERSION ||
      body?.kind !==
        (publishing
          ? 'WorkflowPublishRequest'
          : 'WorkflowPublishPreviewRequest') ||
      !Array.isArray(body.steps) ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 1 ||
      (body.migrateActiveProjectIds !== undefined &&
        (!Array.isArray(body.migrateActiveProjectIds) ||
          body.migrateActiveProjectIds.some((id) => typeof id !== 'string')))
    )
      throw new TypeError('Invalid workflow publication envelope.');
    const options = {
      migrateActiveProjectIds: body.migrateActiveProjectIds || [],
    };
    const data = publishing
      ? repository.publishWorkflow(
          body.steps,
          body.expectedRevision,
          body.projectRevisions,
          options,
        )
      : repository.previewWorkflowPublication(
          body.steps,
          body.expectedRevision,
          options,
        );
    if (publishing) scanReminders();
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: publishing
        ? 'WorkflowPublishResult'
        : 'WorkflowPublishPreviewResult',
      ok: true,
      data,
    });
    return;
  }
  if (applyMasterMatch && request.method === 'POST') {
    const body = await readJson(request);
    if (
      body?.apiVersion !== LOCAL_API_VERSION ||
      body?.kind !== 'ApplyMasterDataRequest' ||
      typeof body.tab !== 'string' ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 1
    )
      throw new TypeError('Invalid ApplyMasterDataRequest envelope.');
    const projectId = decodeURIComponent(applyMasterMatch[1]);
    applyProjectMasterData(
      repository,
      projectId,
      body.tab,
      body.expectedRevision,
    );
    const record = repository.get(projectId);
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'WorkspaceRecord',
      ok: true,
      data: record,
    });
    return;
  }
  const masterMatch = url.pathname.match(/^\/api\/local\/masterdata\/([^/]+)$/);
  if (masterMatch) {
    const tab = decodeURIComponent(masterMatch[1]);
    let record;
    if (request.method === 'GET') {
      const options = Object.fromEntries(url.searchParams);
      if (
        Object.keys(options).some(
          (key) => !['id', 'query', 'limit', 'offset'].includes(key),
        )
      )
        throw new TypeError('Unsupported master-data query parameter.');
      record = repository.globalMasterData.get(tab, options);
    } else if (request.method === 'PUT') {
      const body = await readJson(request);
      if (
        body?.apiVersion !== LOCAL_API_VERSION ||
        body?.kind !== 'GlobalMasterDataUpdateRequest' ||
        !Number.isSafeInteger(body.expectedRevision) ||
        body.expectedRevision < 1
      )
        throw new TypeError('Invalid GlobalMasterDataUpdateRequest envelope.');
      record = repository.globalMasterData.update(
        tab,
        body.changes,
        body.expectedRevision,
      );
    } else {
      respond(405, {
        apiVersion: LOCAL_API_VERSION,
        kind: 'LocalError',
        ok: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
      });
      return;
    }
    respond(
      200,
      {
        apiVersion: LOCAL_API_VERSION,
        kind: 'GlobalMasterDataRecord',
        ok: true,
        data: record,
      },
      { ETag: `"${record.revision}"` },
    );
    return;
  }
  if (url.pathname === '/api/local/reminders' && request.method === 'GET') {
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'LocalReminderList',
      ok: true,
      data: reminders.scan(),
    });
    return;
  }
  if (url.pathname === '/api/local/reminders' && request.method === 'PUT') {
    const body = await readJson(request);
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'LocalReminderList',
      ok: true,
      data: { items: reminders.acknowledge(body.id, body.fingerprint) },
    });
    return;
  }
  const match = url.pathname.match(/^\/api\/local\/workspaces\/([^/]+)$/);
  if (!match) {
    respond(404, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'LocalError',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
    return;
  }
  const projectId = decodeURIComponent(match[1]);
  if (request.method === 'DELETE') {
    const body = await readJson(request);
    if (
      body?.apiVersion !== LOCAL_API_VERSION ||
      body?.kind !== 'ProjectDeleteRequest' ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 1
    )
      throw new TypeError('Invalid ProjectDeleteRequest envelope.');
    const deleted = repository.setDeleted(projectId, body.expectedRevision);
    scanReminders();
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'ProjectDeleted',
      ok: true,
      data: deleted,
    });
    return;
  }
  if (request.method === 'GET') {
    const record = repository.get(projectId);
    if (!record) {
      respond(repository.isDeleted(projectId) ? 410 : 404, {
        apiVersion: LOCAL_API_VERSION,
        kind: 'LocalError',
        ok: false,
        error: {
          code: 'WORKSPACE_NOT_FOUND',
          message: repository.isDeleted(projectId)
            ? 'Project was deleted. Restore it explicitly to reopen.'
            : 'Workspace not found.',
        },
      });
      return;
    }
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'WorkspaceRecord',
      ok: true,
      data: record,
    });
    return;
  }
  if (request.method === 'PUT') {
    const body = await readJson(request);
    if (
      body?.apiVersion !== LOCAL_API_VERSION ||
      body?.kind !== 'WorkspaceSaveRequest' ||
      !Object.hasOwn(body, 'expectedRevision')
    ) {
      throw new TypeError('Invalid WorkspaceSaveRequest envelope.');
    }
    const saved = repository.save(
      projectId,
      body.workspace,
      body.expectedRevision,
    );
    respond(
      200,
      {
        apiVersion: LOCAL_API_VERSION,
        kind: 'WorkspaceRecord',
        ok: true,
        data: saved,
      },
      { ETag: `"${saved.revision}"` },
    );
    return;
  }
  respond(405, {
    apiVersion: LOCAL_API_VERSION,
    kind: 'LocalError',
    ok: false,
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
  });
};

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    const conflict =
      error instanceof RepositoryConflictError ||
      error instanceof GlobalMasterDataConflictError;
    const origin = request.headers.origin;
    send(
      response,
      error instanceof ProjectFileError
        ? error.status
        : conflict
          ? 409
          : error instanceof RepositoryNotFoundError
            ? error.deleted
              ? 410
              : 404
            : error instanceof RangeError
              ? 413
              : 400,
      {
        apiVersion: LOCAL_API_VERSION,
        kind: 'LocalError',
        ok: false,
        error: {
          code:
            error instanceof ProjectFileError
              ? error.code
              : conflict
                ? 'REVISION_CONFLICT'
                : 'INVALID_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid request.',
          ...(conflict ? { currentRevision: error.currentRevision } : {}),
        },
      },
      origin && ALLOWED_ORIGINS.has(origin)
        ? { 'Access-Control-Allow-Origin': origin }
        : {},
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(
    `[local-api] http://127.0.0.1:${PORT} · ${DATABASE_PATH}\n`,
  );
});

const shutdown = () => {
  server.close(() => {
    clearInterval(reminderTimer);
    reminders.close();
    repository.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
