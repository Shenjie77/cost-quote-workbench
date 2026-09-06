#!/usr/bin/env node

/** Minimal same-device JSON API for the SQLite workbench repository. */

import { openReminderService } from './reminder-service.mjs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_API_VERSION,
  RepositoryConflictError,
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
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
  if (request.method === 'GET' && url.pathname === '/api/local/workspaces') {
    respond(200, {
      apiVersion: LOCAL_API_VERSION,
      kind: 'WorkspaceList',
      ok: true,
      data: repository.list(),
    });
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
  if (request.method === 'GET') {
    const record = repository.get(projectId);
    if (!record) {
      respond(404, {
        apiVersion: LOCAL_API_VERSION,
        kind: 'LocalError',
        ok: false,
        error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' },
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
    const conflict = error instanceof RepositoryConflictError;
    const origin = request.headers.origin;
    send(
      response,
      conflict ? 409 : error instanceof RangeError ? 413 : 400,
      {
        apiVersion: LOCAL_API_VERSION,
        kind: 'LocalError',
        ok: false,
        error: {
          code: conflict ? 'REVISION_CONFLICT' : 'INVALID_REQUEST',
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
