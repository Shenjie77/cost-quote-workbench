/** Exercise Windows filesystem constraints against temporary archives on any host. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { createProject } from '../server/workspace-resources.mjs';

/** Keep every archive and database fixture outside the user's real project data. */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'archive-platform-'));
  const repository = openWorkspaceRepository(
    path.join(root, 'workspace.sqlite'),
  );
  t.after(() => {
    repository.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  createProject(repository, {
    id: 'WINDOWS-PATH',
    name: 'Test Project',
    client: 'Test',
  });
  return { root, repository };
}

test('an unavailable destination root fails promptly and preserves the project archive', (t) => {
  const { root, repository } = fixture(t);
  const original = repository.files.list('WINDOWS-PATH');
  const before = repository.get('WINDOWS-PATH');
  const destination = path.join(root, 'Unavailable drive', 'Test Project');
  // Both a Windows drive root and a POSIX filesystem root have themselves as parent.
  const ancestors = new Set();
  let cursor = path.dirname(destination);
  while (!ancestors.has(cursor)) {
    ancestors.add(cursor);
    cursor = path.dirname(cursor);
  }
  const exists = fs.existsSync;
  let unavailableChecks = 0;
  const mockExists = t.mock.method(fs, 'existsSync', (candidate) => {
    if (!ancestors.has(candidate)) return exists(candidate);
    assert.ok(
      ++unavailableChecks <= ancestors.size,
      'must not loop at the root',
    );
    return false;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        repository.files.moveProject('WINDOWS-PATH', {
          projectPath: destination,
          expectedProjectPath: original.projectPath,
        }),
      (error) => error.code === 'ARCHIVE_DESTINATION_UNAVAILABLE',
    );
  } finally {
    mockExists.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(repository.get('WINDOWS-PATH'), before);
  assert.equal(
    repository.files.list('WINDOWS-PATH').projectPath,
    original.projectPath,
  );
  assert.equal(fs.existsSync(destination), false);
});

test('legacy file relocation flushes its writable copy instead of a read-only source', (t) => {
  const { repository } = fixture(t);
  const original = repository.files.list('WINDOWS-PATH');
  const source = path.join(original.projectPath, 'general', 'notes.txt');
  const destination = path.join(original.projectPath, 'workflow', 'notes.txt');
  fs.mkdirSync(path.dirname(source));
  fs.writeFileSync(source, 'Keep the original evidence');
  const open = fs.openSync;
  const sync = fs.fsyncSync;
  const opened = new Map();
  const flushed = [];
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const mocks = [
    t.mock.method(fs, 'openSync', (filename, flags, ...rest) => {
      const fd = open(filename, flags, ...rest);
      opened.set(fd, { filename, flags });
      return fd;
    }),
    t.mock.method(fs, 'fsyncSync', (fd) => {
      const entry = opened.get(fd);
      // Windows FlushFileBuffers needs write access; ordinary reads must not call it.
      if (entry && fs.fstatSync(fd).isFile()) {
        if (!(entry.flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)))
          throw Object.assign(new Error('read-only fsync is not supported'), {
            code: 'EPERM',
          });
        flushed.push(entry.filename);
      }
      return sync(fd);
    }),
  ];
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  syncBuiltinESMExports();
  try {
    repository.files.syncProject('WINDOWS-PATH');
  } finally {
    mocks.forEach((mock) => mock.mock.restore());
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', platform);
  }
  assert.equal(
    fs.readFileSync(destination, 'utf8'),
    'Keep the original evidence',
  );
  assert.equal(
    fs.existsSync(source),
    false,
    'verified legacy source is retired after copy',
  );
  assert.ok(
    flushed.includes(destination),
    'destination bytes must be flushed before source removal',
  );
});

test(
  'POSIX relocation retains support for read-only legacy files',
  { skip: process.platform === 'win32' },
  (t) => {
    const { repository } = fixture(t);
    const original = repository.files.list('WINDOWS-PATH');
    const source = path.join(original.projectPath, 'general', 'read-only.txt');
    const destination = path.join(
      original.projectPath,
      'workflow',
      'read-only.txt',
    );
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, 'Read-only original', { mode: 0o444 });
    const open = fs.openSync;
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const mockOpen = t.mock.method(
      fs,
      'openSync',
      (filename, flags, ...rest) => {
        if (
          [source, destination].includes(filename) &&
          flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)
        )
          throw Object.assign(new Error('Read-only file'), { code: 'EACCES' });
        return open(filename, flags, ...rest);
      },
    );
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    syncBuiltinESMExports();
    try {
      repository.files.syncProject('WINDOWS-PATH');
    } finally {
      mockOpen.mock.restore();
      syncBuiltinESMExports();
      Object.defineProperty(process, 'platform', platform);
    }
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'Read-only original');
  },
);

test('resuming an indexed layout move flushes an existing verified copy before removing its source', (t) => {
  const { root, repository } = fixture(t);
  const record = repository.files.add('WINDOWS-PATH', {
    originalName: 'resume.txt',
    buffer: Buffer.from('Interrupted copy'),
  });
  const original = repository.files.list('WINDOWS-PATH');
  const destination = path.join(original.projectPath, record.relativePath);
  const oldRelative = path.join('general', path.basename(record.relativePath));
  const source = path.join(original.projectPath, oldRelative);
  fs.mkdirSync(path.dirname(source));
  fs.copyFileSync(destination, source);
  // Represent a crash after creating the target copy but before moving the saved index.
  const database = new DatabaseSync(path.join(root, 'workspace.sqlite'));
  try {
    database
      .prepare('UPDATE project_files SET relative_path = ? WHERE id = ?')
      .run(oldRelative, record.id);
  } finally {
    database.close();
  }
  const open = fs.openSync;
  const sync = fs.fsyncSync;
  const files = new Map();
  const flushed = [];
  const mocks = [
    t.mock.method(fs, 'openSync', (filename, flags, ...rest) => {
      const fd = open(filename, flags, ...rest);
      files.set(fd, filename);
      return fd;
    }),
    t.mock.method(fs, 'fsyncSync', (fd) => {
      if (fs.fstatSync(fd).isFile()) {
        flushed.push(files.get(fd));
        assert.equal(
          fs.existsSync(source),
          true,
          'source must exist until target flush succeeds',
        );
      }
      return sync(fd);
    }),
  ];
  syncBuiltinESMExports();
  try {
    repository.files.syncProject('WINDOWS-PATH');
  } finally {
    mocks.forEach((mock) => mock.mock.restore());
    syncBuiltinESMExports();
  }
  assert.ok(flushed.includes(destination));
  assert.equal(fs.existsSync(source), false);
  assert.equal(
    repository.files.read('WINDOWS-PATH', record.id).buffer.toString(),
    'Interrupted copy',
  );
});
