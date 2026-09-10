/** Narrow HTTP routes for archive settings and project-owned binary files. */
import { MAX_PROJECT_FILE_BYTES, ProjectFileError } from './project-files.mjs';

const API_VERSION = 'cost-workbench/local-v1';
const queryValues = (url, allowed) => {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new TypeError(`Invalid file query parameter: ${key}`);
  }
  return Object.fromEntries(url.searchParams);
};

export async function readProjectFileBody(request) {
  const contentLength = request.headers['content-length'];
  if (
    contentLength !== undefined &&
    (!/^\d+$/.test(String(contentLength)) ||
      Number(contentLength) > MAX_PROJECT_FILE_BYTES)
  )
    throw new ProjectFileError(
      'File must be 50 MiB or smaller.',
      413,
      'FILE_TOO_LARGE',
    );
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_PROJECT_FILE_BYTES)
      throw new ProjectFileError(
        'File must be 50 MiB or smaller.',
        413,
        'FILE_TOO_LARGE',
      );
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

/** respond handles JSON/CORS; the binary response is always an attachment. */
export async function routeProjectFiles({
  request,
  response,
  url,
  repository,
  respond,
  readJson,
  origin,
}) {
  if (url.pathname === '/api/local/archive-settings') {
    let settings;
    if (request.method === 'GET') settings = repository.files.getSettings();
    else if (request.method === 'PUT') {
      const body = await readJson(request);
      if (
        body?.apiVersion !== API_VERSION ||
        body?.kind !== 'ArchiveSettingsUpdateRequest' ||
        typeof body.rootPath !== 'string' ||
        !Number.isSafeInteger(body.expectedRevision) ||
        body.expectedRevision < 1 ||
        Object.keys(body).some(
          (key) =>
            !['apiVersion', 'kind', 'rootPath', 'expectedRevision'].includes(
              key,
            ),
        )
      )
        throw new TypeError('Invalid ArchiveSettingsUpdateRequest envelope.');
      settings = repository.files.updateSettings(
        { rootPath: body.rootPath },
        body.expectedRevision,
      );
    } else
      throw new ProjectFileError(
        'Method not allowed.',
        405,
        'METHOD_NOT_ALLOWED',
      );
    respond(200, {
      apiVersion: API_VERSION,
      kind: 'ArchiveSettings',
      ok: true,
      data: settings,
    });
    return true;
  }
  const locationMatch = url.pathname.match(
    /^\/api\/local\/projects\/([^/]+)\/files\/location$/,
  );
  if (locationMatch) {
    if (request.method !== 'PUT')
      throw new ProjectFileError(
        'Method not allowed.',
        405,
        'METHOD_NOT_ALLOWED',
      );
    queryValues(url, []);
    const body = await readJson(request);
    if (
      body?.apiVersion !== API_VERSION ||
      body?.kind !== 'ProjectArchiveMoveRequest' ||
      typeof body.projectPath !== 'string' ||
      typeof body.expectedProjectPath !== 'string' ||
      Object.keys(body).some(
        (key) =>
          ![
            'apiVersion',
            'kind',
            'projectPath',
            'expectedProjectPath',
          ].includes(key),
      )
    )
      throw new TypeError('Invalid ProjectArchiveMoveRequest envelope.');
    const location = repository.files.moveProject(
      decodeURIComponent(locationMatch[1]),
      {
        projectPath: body.projectPath,
        expectedProjectPath: body.expectedProjectPath,
      },
    );
    respond(200, {
      apiVersion: API_VERSION,
      kind: 'ProjectArchiveLocation',
      ok: true,
      data: location,
    });
    return true;
  }
  const match = url.pathname.match(
    /^\/api\/local\/projects\/([^/]+)\/files(?:\/([^/]+)\/content)?$/,
  );
  if (!match) return false;
  const projectId = decodeURIComponent(match[1]);
  if (match[2]) {
    if (request.method !== 'GET')
      throw new ProjectFileError(
        'Method not allowed.',
        405,
        'METHOD_NOT_ALLOWED',
      );
    queryValues(url, []);
    const { record, buffer } = repository.files.read(
      projectId,
      decodeURIComponent(match[2]),
    );
    const encodedName = encodeURIComponent(record.originalName).replace(
      /['()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    });
    response.end(buffer);
    return true;
  }
  if (request.method === 'GET') {
    const filters = queryValues(url, ['nodeCode', 'versionCode', 'category']);
    respond(200, {
      apiVersion: API_VERSION,
      kind: 'ProjectFiles',
      ok: true,
      data: repository.files.list(projectId, filters),
    });
    return true;
  }
  if (request.method === 'POST') {
    if (
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/octet-stream'
    )
      throw new TypeError('File uploads require application/octet-stream.');
    const metadata = queryValues(url, [
      'originalName',
      'mimeType',
      'category',
      'nodeCode',
      'versionCode',
      'requestId',
    ]);
    if (!metadata.originalName) throw new TypeError('File name is required.');
    const buffer = await readProjectFileBody(request);
    const record = repository.files.add(projectId, {
      ...metadata,
      category:
        metadata.category || (metadata.nodeCode ? 'workflow' : 'general'),
      buffer,
    });
    respond(201, {
      apiVersion: API_VERSION,
      kind: 'ProjectFile',
      ok: true,
      data: record,
    });
    return true;
  }
  throw new ProjectFileError('Method not allowed.', 405, 'METHOD_NOT_ALLOWED');
}
