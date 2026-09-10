import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { createProject } from '../server/workspace-resources.mjs';
import {
  routeProjectFiles,
  readProjectFileBody,
} from '../server/project-files-api.mjs';
import { MAX_PROJECT_FILE_BYTES } from '../server/project-files.mjs';

const fixture = (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'project-file-api-'));
  const repository = openWorkspaceRepository(
    path.join(directory, 'workbench.sqlite'),
  );
  t.after(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
  createProject(repository, {
    id: 'FILES-API',
    name: 'File API project',
    client: 'Test',
  });
  return { repository, directory };
};
const call = async (
  repository,
  pathname,
  {
    method = 'GET',
    bytes = Buffer.alloc(0),
    json,
    headers = {},
    openFolder,
  } = {},
) => {
  const request = Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]);
  request.method = method;
  request.headers = headers;
  const result = {};
  const handled = await routeProjectFiles({
    request,
    response: {
      writeHead: (status, responseHeaders) =>
        Object.assign(result, { status, headers: responseHeaders }),
      end: (buffer) => {
        result.buffer = buffer;
      },
    },
    url: new URL(pathname, 'http://localhost'),
    repository,
    respond: (status, body) => Object.assign(result, { status, body }),
    readJson: async () => json,
    origin: 'http://localhost:3000',
    ...(openFolder ? { openFolder } : {}),
  });
  return { ...result, handled };
};

const folderAction = {
  apiVersion: 'cost-workbench/local-v1',
  kind: 'ArchiveFolderOpenRequest',
};
const deletionAction = {
  apiVersion: 'cost-workbench/local-v1',
  kind: 'ProjectFileDeleteRequest',
};

test('open-folder routes resolve saved roots and document parents after archive relocation', async (t) => {
  const { repository, directory } = fixture(t);
  const original = repository.files.list('FILES-API');
  const document = repository.files.add('FILES-API', {
    originalName: 'scope.txt',
    buffer: Buffer.from('Scope evidence'),
  });
  const snapshot = repository.get('FILES-API');
  const moved = repository.files.moveProject('FILES-API', {
    expectedProjectPath: original.projectPath,
    projectPath: path.join(directory, 'Moved project'),
  });
  const opened = [];
  for (const endpoint of [
    '/api/local/archive-settings/open-folder',
    '/api/local/projects/FILES-API/files/open-folder',
    `/api/local/projects/FILES-API/files/${document.id}/open-folder`,
  ]) {
    const result = await call(repository, endpoint, {
      method: 'POST',
      json: folderAction,
      openFolder: async (folder) => opened.push(folder),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { opened: true });
  }
  assert.deepEqual(opened, [
    repository.files.getSettings().rootPath,
    moved.projectPath,
    path.join(moved.projectPath, 'workflow'),
  ]);
  assert.deepEqual(repository.get('FILES-API'), snapshot);
});

test('folder actions reject arbitrary paths and foreign document IDs and surface launcher failures', async (t) => {
  const { repository } = fixture(t);
  createProject(repository, { id: 'OTHER', name: 'Other', client: 'Test' });
  const file = repository.files.add('FILES-API', {
    originalName: 'owned.txt',
    buffer: Buffer.from('Owned'),
  });
  const openFolder = async () =>
    assert.fail('An invalid request must not launch a folder');
  const endpoint = '/api/local/projects/FILES-API/files/open-folder';
  await assert.rejects(
    call(repository, endpoint, {
      method: 'POST',
      json: { ...folderAction, path: '/unowned' },
      openFolder,
    }),
    /Invalid ArchiveFolderOpenRequest/,
  );
  await assert.rejects(
    call(repository, `/api/local/projects/OTHER/files/${file.id}/open-folder`, {
      method: 'POST',
      json: folderAction,
      openFolder,
    }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    call(repository, endpoint + '?path=/unowned', {
      method: 'POST',
      json: folderAction,
      openFolder,
    }),
    /Invalid file query/,
  );
  await assert.rejects(
    call(repository, endpoint, { method: 'GET', openFolder }),
    (error) => error.status === 405,
  );
  await assert.rejects(
    call(repository, endpoint, {
      method: 'POST',
      json: folderAction,
      openFolder: async () => {
        throw Object.assign(new Error('Desktop unavailable'), {
          code: 'ARCHIVE_OPEN_FAILED',
          status: 503,
        });
      },
    }),
    (error) => error.code === 'ARCHIVE_OPEN_FAILED' && error.status === 503,
  );
});

test('document deletion is project-bound and idempotent without changing project snapshots or other files', async (t) => {
  const { repository } = fixture(t);
  createProject(repository, { id: 'OTHER', name: 'Other', client: 'Test' });
  const archive = repository.files.list('FILES-API');
  const file = repository.files.add('FILES-API', {
    originalName: 'remove.txt',
    buffer: Buffer.from('Remove'),
    requestId: 'deleted-upload',
  });
  const retained = repository.files.add('FILES-API', {
    originalName: 'keep.txt',
    buffer: Buffer.from('Keep'),
  });
  const before = repository.get('FILES-API');
  const endpoint = `/api/local/projects/FILES-API/files/${file.id}`;
  await assert.rejects(
    call(repository, `/api/local/projects/OTHER/files/${file.id}`, {
      method: 'DELETE',
      json: deletionAction,
    }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    call(repository, endpoint, {
      method: 'DELETE',
      json: { ...deletionAction, path: file.relativePath },
    }),
    /Invalid ProjectFileDeleteRequest/,
  );
  assert.equal(
    existsSync(path.join(archive.projectPath, file.relativePath)),
    true,
  );
  for (let retry = 0; retry < 2; retry++) {
    const result = await call(repository, endpoint, {
      method: 'DELETE',
      json: deletionAction,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { id: file.id, deleted: true });
  }
  assert.equal(
    existsSync(path.join(archive.projectPath, file.relativePath)),
    false,
  );
  assert.deepEqual(
    repository.files.list('FILES-API').files.map((record) => record.id),
    [retained.id],
  );
  assert.equal(
    repository.files.read('FILES-API', retained.id).buffer.toString(),
    'Keep',
  );
  await assert.rejects(
    call(repository, endpoint + '/content'),
    (error) => error.status === 404,
  );
  assert.throws(
    () =>
      repository.files.add('FILES-API', {
        originalName: 'remove.txt',
        buffer: Buffer.from('Remove'),
        requestId: 'deleted-upload',
      }),
    (error) => error.code === 'FILE_DELETED',
  );
  assert.deepEqual(repository.get('FILES-API'), before);
});

test('project folder API moves existing attachments with independent path CAS and preserves download links', async (t) => {
  const { repository, directory } = fixture(t);
  const original = repository.files.list('FILES-API');
  const projectBefore = repository.get('FILES-API');
  const file = repository.files.add('FILES-API', {
    originalName: 'scope.pdf',
    buffer: Buffer.from('scope evidence'),
  });
  const destination = path.join(directory, 'New location', 'Customer Project');
  const json = {
    apiVersion: 'cost-workbench/local-v1',
    kind: 'ProjectArchiveMoveRequest',
    projectPath: `"${destination}"`,
    expectedProjectPath: original.projectPath,
  };
  const endpoint = '/api/local/projects/FILES-API/files/location';
  const moved = await call(repository, endpoint, { method: 'PUT', json });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.kind, 'ProjectArchiveLocation');
  assert.equal(moved.body.data.projectPath, realpathSync(destination));
  const download = await call(
    repository,
    `/api/local/projects/FILES-API/files/${file.id}/content`,
  );
  assert.equal(download.buffer.toString(), 'scope evidence');
  assert.deepEqual(repository.get('FILES-API'), projectBefore);
  await assert.rejects(
    call(repository, endpoint, {
      method: 'PUT',
      json: { ...json, projectPath: path.join(directory, 'Another location') },
    }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    call(repository, endpoint, { method: 'GET' }),
    (error) => error.status === 405,
  );
  await assert.rejects(
    call(repository, endpoint, {
      method: 'PUT',
      json: { ...json, expectedProjectPath: undefined },
    }),
    /Invalid ProjectArchiveMoveRequest/,
  );
});

test('file API archives exact raw bytes, lists the node round, and downloads only by project-bound file ID', async (t) => {
  const { repository } = fixture(t);
  const before = repository.get('FILES-API');
  const nodeCode = before.workspace.processSteps[0].code;
  const bytes = Buffer.from([0, 255, 0, 13, 10, 42, 200, 81, 199]);
  const query = new URLSearchParams({
    originalName: '评审 文件.pdf',
    category: 'workflow',
    mimeType: 'application/pdf',
    nodeCode,
    versionCode: 'V1',
    requestId: 'api-retry',
  });
  const uploaded = await call(
    repository,
    `/api/local/projects/FILES-API/files?${query}`,
    {
      method: 'POST',
      bytes,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
      },
    },
  );
  assert.equal(uploaded.status, 201);
  const record = uploaded.body.data;
  assert.equal(record.originalName, '评审 文件.pdf');
  const repeated = await call(
    repository,
    `/api/local/projects/FILES-API/files?${query}`,
    {
      method: 'POST',
      bytes,
      headers: { 'content-type': 'application/octet-stream' },
    },
  );
  assert.equal(repeated.body.data.id, record.id);
  const list = await call(
    repository,
    `/api/local/projects/FILES-API/files?nodeCode=${encodeURIComponent(nodeCode)}&versionCode=V1`,
  );
  assert.deepEqual(
    list.body.data.files.map((file) => file.id),
    [record.id],
  );
  const downloaded = await call(
    repository,
    `/api/local/projects/FILES-API/files/${record.id}/content`,
  );
  assert.deepEqual(downloaded.buffer, bytes);
  assert.equal(downloaded.headers['Content-Type'], 'application/octet-stream');
  assert.match(downloaded.headers['Content-Disposition'], /^attachment;/);
  assert.ok(
    downloaded.headers['Content-Disposition'].includes(
      encodeURIComponent(record.originalName),
    ),
  );
  assert.equal(downloaded.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(
    downloaded.headers['Access-Control-Allow-Origin'],
    'http://localhost:3000',
  );
  assert.deepEqual(
    repository.get('FILES-API'),
    before,
    'document upload must not alter workflow, cost or revision',
  );
  createProject(repository, { id: 'OTHER', name: 'Other', client: 'Test' });
  await assert.rejects(
    call(repository, `/api/local/projects/OTHER/files/${record.id}/content`),
    (error) => error.status === 404,
  );
});

test('archive settings API validates envelopes and uses an independent revision', async (t) => {
  const { repository, directory } = fixture(t);
  const before = repository.get('FILES-API');
  const settings = (await call(repository, '/api/local/archive-settings')).body
    .data;
  const json = {
    apiVersion: 'cost-workbench/local-v1',
    kind: 'ArchiveSettingsUpdateRequest',
    rootPath: path.join(directory, 'chosen root'),
    expectedRevision: settings.revision,
  };
  const saved = await call(repository, '/api/local/archive-settings', {
    method: 'PUT',
    json,
  });
  assert.equal(saved.body.data.revision, settings.revision + 1);
  await assert.rejects(
    call(repository, '/api/local/archive-settings', { method: 'PUT', json }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    call(repository, '/api/local/archive-settings', {
      method: 'PUT',
      json: { ...json, expectedRevision: null },
    }),
    /Invalid ArchiveSettings/,
  );
  assert.deepEqual(repository.get('FILES-API'), before);
  assert.equal((await call(repository, '/api/local/unrelated')).handled, false);
});

test('file routes reject invalid methods, duplicate query fields, traversal names, and oversized bodies', async (t) => {
  const { repository } = fixture(t);
  await assert.rejects(
    call(
      repository,
      '/api/local/projects/FILES-API/files?nodeCode=a&nodeCode=b',
    ),
    /Invalid file query/,
  );
  await assert.rejects(
    call(repository, '/api/local/projects/FILES-API/files', {
      method: 'DELETE',
    }),
    (error) => error.status === 405,
  );
  await assert.rejects(
    call(repository, '/api/local/projects/FILES-API/files?originalName=test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    }),
    /application\/octet-stream/,
  );
  await assert.rejects(
    call(
      repository,
      '/api/local/projects/FILES-API/files?originalName=..%2Fsecret',
      {
        method: 'POST',
        bytes: Buffer.from('test'),
        headers: { 'content-type': 'application/octet-stream' },
      },
    ),
    /filename/i,
  );
  const request = Readable.from([]);
  request.headers = { 'content-length': String(MAX_PROJECT_FILE_BYTES + 1) };
  await assert.rejects(
    readProjectFileBody(request),
    (error) => error.status === 413,
  );
  assert.equal(repository.files.list('FILES-API').files.length, 0);
});
