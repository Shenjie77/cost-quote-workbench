import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createProjectFileRemoval } from '../server/project-file-removal.mjs';

/** Use real temporary files and SQLite; reopening discards any uncommitted transaction. */
function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), 'file-removal-')),
  );
  const database = path.join(root, 'test.sqlite');
  let db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE project_file_roots (project_id TEXT PRIMARY KEY, root_path TEXT NOT NULL, project_folder TEXT NOT NULL);
    CREATE TABLE project_files (id TEXT PRIMARY KEY, project_id TEXT, relative_path TEXT, sha256 TEXT, size_bytes INTEGER, request_id TEXT);
    CREATE TABLE project_file_deletions (file_id TEXT PRIMARY KEY, project_id TEXT, relative_path TEXT, staged_path TEXT, sha256 TEXT, size_bytes INTEGER, request_id TEXT, deleted_at TEXT);
  `);
  const archive = {
    project_id: 'PROJECT-A',
    root_path: root,
    project_folder: 'archive',
    projectPath: path.join(root, 'archive'),
  };
  db.prepare('INSERT INTO project_file_roots VALUES (?, ?, ?)').run(
    archive.project_id,
    archive.root_path,
    archive.project_folder,
  );
  fs.mkdirSync(path.join(archive.projectPath, 'workflow'), { recursive: true });
  const within = (base, relative) => {
    const result = path.resolve(base, relative);
    assert.ok(result.startsWith(`${base}${path.sep}`));
    return result;
  };
  const verifyFile = (record, relative, sha, size) => {
    const buffer = fs.readFileSync(within(record.projectPath, relative));
    assert.equal(buffer.length, size, 'size changed');
    assert.equal(
      createHash('sha256').update(buffer).digest('hex'),
      sha,
      'content changed',
    );
    return buffer;
  };
  const removal = () =>
    createProjectFileRemoval({
      db,
      location: (record) => ({ projectPath: record.projectPath }),
      within,
      verifyFile,
    });
  const content = Buffer.from('Original document\u0000with binary evidence');
  const row = {
    id: 'document-1',
    project_id: archive.project_id,
    relative_path: path.join('workflow', 'evidence.bin'),
    sha256: createHash('sha256').update(content).digest('hex'),
    size_bytes: content.length,
    request_id: 'upload-once',
  };
  db.prepare('INSERT INTO project_files VALUES (?, ?, ?, ?, ?, ?)').run(
    row.id,
    row.project_id,
    row.relative_path,
    row.sha256,
    row.size_bytes,
    row.request_id,
  );
  const original = within(archive.projectPath, row.relative_path);
  const staged = within(archive.projectPath, removal().stagedRelative(row));
  fs.writeFileSync(original, content);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    database,
    archive,
    row,
    original,
    staged,
    content,
    removal,
    get db() {
      return db;
    },
    reopen() {
      db.close();
      db = new DatabaseSync(database);
    },
  };
}

/** Model a crash after staging but before committing; SQLite restores the live row on reopen. */
function interruptedDeletion(f) {
  f.db.exec('BEGIN IMMEDIATE');
  f.db
    .prepare(
      'INSERT INTO project_file_deletions VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      f.row.id,
      f.row.project_id,
      f.row.relative_path,
      f.removal().stagedRelative(f.row),
      f.row.sha256,
      f.row.size_bytes,
      f.row.request_id,
      new Date().toISOString(),
    );
  fs.copyFileSync(f.original, f.staged, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(f.original);
  f.db.prepare('DELETE FROM project_files WHERE id = ?').run(f.row.id);
  f.reopen();
}

/** Temporarily replace a filesystem primitive while keeping named ESM imports in sync. */
function mockFilesystem(t, name, implementation) {
  const mock = t.mock.method(fs, name, implementation);
  syncBuiltinESMExports();
  const restore = () => {
    mock.mock.restore();
    syncBuiltinESMExports();
  };
  t.after(restore);
  return restore;
}

test('document removal deletes bytes and metadata once while retaining an upload tombstone', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.removal().remove(f.archive, f.row), {
    id: f.row.id,
    deleted: true,
  });
  assert.equal(fs.existsSync(f.original), false);
  assert.equal(fs.existsSync(f.staged), false);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    0,
  );
  const receipt = f.db.prepare('SELECT * FROM project_file_deletions').get();
  assert.equal(receipt.request_id, 'upload-once');
  assert.equal(receipt.sha256, f.row.sha256);
  assert.ok(receipt.deleted_at);
  assert.deepEqual(f.removal().remove(f.archive, f.row), {
    id: f.row.id,
    deleted: true,
  });
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_file_deletions').get().n,
    1,
  );
});

test('database deletion failure rolls back metadata and restores exact document bytes', (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER reject_delete BEFORE DELETE ON project_files BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
  );
  assert.throws(
    () => f.removal().remove(f.archive, f.row),
    (error) => error.code === 'FILE_DELETE_FAILED',
  );
  assert.deepEqual(fs.readFileSync(f.original), f.content);
  assert.equal(fs.existsSync(f.staged), false);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    1,
  );
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_file_deletions').get().n,
    0,
  );
});

test('source unlink failure keeps the live document and its metadata available', (t) => {
  const f = fixture(t);
  const unlink = fs.unlinkSync;
  const restore = mockFilesystem(t, 'unlinkSync', (filename) => {
    if (filename === f.original)
      throw Object.assign(new Error('locked document'), { code: 'EACCES' });
    return unlink(filename);
  });
  assert.throws(() => f.removal().remove(f.archive, f.row));
  restore();
  assert.deepEqual(fs.readFileSync(f.original), f.content);
  assert.equal(fs.existsSync(f.staged), false);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    1,
  );
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_file_deletions').get().n,
    0,
  );
});

test('committed cleanup retries after restart and never removes a later original-path replacement', (t) => {
  const f = fixture(t);
  const unlink = fs.unlinkSync;
  const restore = mockFilesystem(t, 'unlinkSync', (filename) => {
    if (filename === f.staged)
      throw Object.assign(new Error('locked recovery file'), {
        code: 'EACCES',
      });
    return unlink(filename);
  });
  assert.deepEqual(f.removal().remove(f.archive, f.row), {
    id: f.row.id,
    deleted: true,
  });
  restore();
  assert.deepEqual(fs.readFileSync(f.staged), f.content);
  fs.writeFileSync(f.original, 'A new user file');
  f.reopen();
  assert.deepEqual(f.removal().recover(f.archive).cleaned, [f.row.id]);
  assert.equal(fs.existsSync(f.staged), false);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'A new user file');
  assert.deepEqual(f.removal().remove(f.archive, f.row), {
    id: f.row.id,
    deleted: true,
  });
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'A new user file');
});

test('a pre-commit interruption restores the missing document from its verified recovery copy', (t) => {
  const f = fixture(t);
  interruptedDeletion(f);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_file_deletions').get().n,
    0,
  );
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    1,
  );
  assert.deepEqual(f.removal().recover(f.archive).restored, [f.row.id]);
  assert.deepEqual(fs.readFileSync(f.original), f.content);
  assert.equal(fs.existsSync(f.staged), false);
  assert.deepEqual(f.removal().recover(f.archive), {
    restored: [],
    cleaned: [],
    pending: [],
  });
});

test('recovery preserves both copies when a new file occupies an uncommitted original path', (t) => {
  const f = fixture(t);
  interruptedDeletion(f);
  fs.writeFileSync(f.original, 'New user-owned content');
  assert.deepEqual(f.removal().recover(f.archive).pending, [f.row.id]);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'New user-owned content');
  assert.deepEqual(fs.readFileSync(f.staged), f.content);
});

test('occupied recovery names, dangling links and cross-project requests never overwrite files', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.staged, 'Unrelated data');
  assert.throws(
    () => f.removal().remove(f.archive, f.row),
    (error) => error.code === 'FILE_DELETE_RECOVERY_REQUIRED',
  );
  assert.equal(fs.readFileSync(f.staged, 'utf8'), 'Unrelated data');
  fs.unlinkSync(f.staged);
  fs.symlinkSync(path.join(path.dirname(f.staged), 'missing'), f.staged);
  assert.throws(
    () => f.removal().remove(f.archive, f.row),
    (error) => error.code === 'FILE_DELETE_RECOVERY_REQUIRED',
  );
  assert.ok(fs.lstatSync(f.staged).isSymbolicLink());
  assert.throws(
    () => f.removal().remove({ ...f.archive, project_id: 'OTHER' }, f.row),
    (error) => error.code === 'FILE_NOT_FOUND',
  );
  assert.deepEqual(fs.readFileSync(f.original), f.content);
});

test('content changes during staging retain the changed source and original recovery evidence', (t) => {
  const f = fixture(t);
  const copy = fs.copyFileSync;
  const restore = mockFilesystem(
    t,
    'copyFileSync',
    (source, destination, flags) => {
      copy(source, destination, flags);
      if (source === f.original)
        fs.writeFileSync(f.original, 'Edited during deletion');
    },
  );
  assert.throws(
    () => f.removal().remove(f.archive, f.row),
    (error) => error.code === 'FILE_DELETE_RECOVERY_REQUIRED',
  );
  restore();
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'Edited during deletion');
  assert.deepEqual(fs.readFileSync(f.staged), f.content);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    1,
  );
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_file_deletions').get().n,
    0,
  );
});

test('an incomplete staged copy never causes the source or its metadata to be deleted', (t) => {
  const f = fixture(t);
  const restore = mockFilesystem(t, 'copyFileSync', (_source, target) => {
    fs.writeFileSync(target, 'partial', { flag: 'wx' });
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  assert.throws(() => f.removal().remove(f.archive, f.row));
  restore();
  assert.deepEqual(fs.readFileSync(f.original), f.content);
  assert.equal(fs.readFileSync(f.staged, 'utf8'), 'partial');
  assert.deepEqual(f.removal().recover(f.archive).pending, [f.row.id]);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    1,
  );
});

test('an existing restored survivor is flushed before its last recovery copy is removed', (t) => {
  const f = fixture(t);
  interruptedDeletion(f);
  fs.copyFileSync(f.staged, f.original, fs.constants.COPYFILE_EXCL);
  let flushed = false;
  const sync = fs.fsyncSync;
  const unlink = fs.unlinkSync;
  const restoreSync = mockFilesystem(t, 'fsyncSync', (fd) => {
    if (fs.fstatSync(fd).isFile()) flushed = true;
    return sync(fd);
  });
  const restoreUnlink = mockFilesystem(t, 'unlinkSync', (filename) => {
    if (filename === f.staged)
      assert.ok(
        flushed,
        'surviving file must be durable before removing its backup',
      );
    return unlink(filename);
  });
  assert.deepEqual(f.removal().recover(f.archive).restored, [f.row.id]);
  restoreUnlink();
  restoreSync();
  assert.deepEqual(fs.readFileSync(f.original), f.content);
  assert.equal(fs.existsSync(f.staged), false);
});

test('recovery waits for an ongoing deletion transaction instead of reviving its staged document', (t) => {
  const f = fixture(t);
  const other = new DatabaseSync(f.database);
  f.db.exec('PRAGMA busy_timeout = 1');
  try {
    other.exec('BEGIN IMMEDIATE');
    fs.copyFileSync(f.original, f.staged, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(f.original);
    assert.throws(() => f.removal().recover(f.archive), /locked/);
    assert.equal(fs.existsSync(f.original), false);
    assert.deepEqual(fs.readFileSync(f.staged), f.content);
    other.exec('ROLLBACK');
    assert.deepEqual(f.removal().recover(f.archive).restored, [f.row.id]);
    assert.deepEqual(fs.readFileSync(f.original), f.content);
  } finally {
    other.close();
  }
});

test('recovery inside an existing transaction leaves its uncommitted changes under caller control', (t) => {
  const f = fixture(t);
  interruptedDeletion(f);
  const observer = new DatabaseSync(f.database);
  try {
    f.db.exec('BEGIN IMMEDIATE');
    f.db
      .prepare('UPDATE project_files SET request_id = ? WHERE id = ?')
      .run('caller-uncommitted', f.row.id);
    assert.deepEqual(
      f.removal().recover(f.archive, { withinTransaction: true }),
      { restored: [f.row.id], cleaned: [], pending: [] },
    );
    assert.equal(
      observer.prepare('SELECT request_id FROM project_files').get().request_id,
      f.row.request_id,
      'recovery must not commit changes owned by its caller',
    );
    f.db.exec('ROLLBACK');
    assert.equal(
      f.db.prepare('SELECT request_id FROM project_files').get().request_id,
      f.row.request_id,
    );
    assert.deepEqual(fs.readFileSync(f.original), f.content);
    assert.equal(fs.existsSync(f.staged), false);
  } finally {
    observer.close();
  }
});

test('deletion and recovery reject stale archive mappings before changing old or relocated copies', (t) => {
  const f = fixture(t);
  const movedDirectory = path.join(f.archive.root_path, 'moved-archive');
  const movedFile = path.join(movedDirectory, f.row.relative_path);
  fs.mkdirSync(path.dirname(movedFile), { recursive: true });
  fs.copyFileSync(f.original, movedFile, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(f.original, f.staged, fs.constants.COPYFILE_EXCL);
  const other = new DatabaseSync(f.database);
  try {
    other
      .prepare(
        'UPDATE project_file_roots SET project_folder = ? WHERE project_id = ?',
      )
      .run('moved-archive', f.archive.project_id);
  } finally {
    other.close();
  }
  const isStaleArchive = (error) =>
    error.status === 409 && error.code === 'ARCHIVE_CONFLICT';
  assert.throws(() => f.removal().remove(f.archive, f.row), isStaleArchive);
  assert.throws(() => f.removal().recover(f.archive), isStaleArchive);
  f.db.exec('BEGIN IMMEDIATE');
  f.db
    .prepare('UPDATE project_files SET request_id = ? WHERE id = ?')
    .run('caller-uncommitted', f.row.id);
  assert.throws(
    () => f.removal().recover(f.archive, { withinTransaction: true }),
    isStaleArchive,
  );
  assert.equal(
    f.db.prepare('SELECT request_id FROM project_files').get().request_id,
    'caller-uncommitted',
    'failed recovery must not roll back changes owned by its caller',
  );
  f.db.exec('ROLLBACK');
  assert.deepEqual(fs.readFileSync(f.original), f.content);
  assert.deepEqual(fs.readFileSync(f.staged), f.content);
  assert.deepEqual(fs.readFileSync(movedFile), f.content);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_files').get().n,
    1,
  );
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM project_file_deletions').get().n,
    0,
  );
});
