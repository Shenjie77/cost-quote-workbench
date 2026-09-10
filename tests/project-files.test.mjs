import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { MAX_PROJECT_FILE_BYTES } from '../server/project-files.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
const create = (repo, id = 'P-ARCHIVE') =>
  repo.save(
    id,
    createBlankWorkspace(
      projectRecord(id, 'Document Project', 'Fixture'),
      'input_preparation',
    ),
    null,
  );
const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'archive-tests-'));
  const database = path.join(directory, 'workspace.sqlite');
  const repository = openWorkspaceRepository(database);
  return {
    directory,
    database,
    repository,
    close: () => {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
};
const binary = Buffer.from([0, 255, 1, 0, 128, 47, 0, 10]);

test('new project creates stable category folders; new root only affects future projects', () => {
  const f = fixture();
  try {
    const initialSettings = f.repository.files.getSettings();
    assert.equal(initialSettings.revision, 1);
    create(f.repository);
    const first = f.repository.files.list('P-ARCHIVE');
    assert.match(
      path.basename(first.projectPath),
      /P-ARCHIVE--Document-Project/,
    );
    assert.deepEqual(readdirSync(first.projectPath).sort(), [
      'cost',
      'quotation',
      'workflow',
    ]);
    const settings = f.repository.files.updateSettings(
      { rootPath: path.join(f.directory, 'new-root') },
      1,
    );
    assert.equal(settings.revision, 2);
    assert.equal(f.repository.get('P-ARCHIVE').revision, 1);
    assert.equal(
      f.repository.files.list('P-ARCHIVE').projectPath,
      first.projectPath,
    );
    create(f.repository, 'P-NEXT');
    assert.equal(f.repository.files.list('P-NEXT').rootPath, settings.rootPath);
    assert.equal(
      f.repository.files.list('P-ARCHIVE').rootPath,
      initialSettings.rootPath,
    );
    assert.throws(
      () =>
        f.repository.files.updateSettings(
          { rootPath: path.join(f.directory, 'conflict') },
          1,
        ),
      (e) => e.status === 409,
    );
    assert.equal(existsSync(path.join(f.directory, 'conflict')), false);
  } finally {
    f.close();
  }
});

test('binary workflow uploads preserve bytes and duplicates, isolate versions and projects, do not mutate costs', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    create(f.repository, 'P-OTHER');
    const nodeCode = saved.workspace.processSteps[0].code;
    const input = {
      originalName: 'Review 评审.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      category: 'workflow',
      nodeCode,
      versionCode: 'V1',
      buffer: binary,
    };
    const first = f.repository.files.add('P-ARCHIVE', input);
    const second = f.repository.files.add('P-ARCHIVE', input);
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.relativePath, second.relativePath);
    assert.equal(first.nodeName, saved.workspace.processSteps[0].name);
    assert.equal(
      first.sha256,
      createHash('sha256').update(binary).digest('hex'),
    );
    assert.deepEqual(
      f.repository.files.read('P-ARCHIVE', first.id).buffer,
      binary,
    );
    assert.equal(
      f.repository.files.list('P-ARCHIVE', { nodeCode, versionCode: 'V1' })
        .files.length,
      2,
    );
    assert.equal(
      f.repository.files.list('P-ARCHIVE', { versionCode: 'V2' }).files.length,
      0,
    );
    assert.throws(
      () => f.repository.files.read('P-OTHER', first.id),
      (e) => e.status === 404,
    );
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', { ...input, nodeCode: 'WRONG' }),
      /does not belong/,
    );
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', { ...input, versionCode: 'V999' }),
      /does not exist/,
    );
    assert.deepEqual(f.repository.get('P-ARCHIVE'), saved);
  } finally {
    f.close();
  }
});

test('requestId retries return one immutable record and conflicting bytes or targets are rejected', () => {
  const f = fixture();
  try {
    create(f.repository);
    const input = {
      originalName: 'TD.xlsx',
      category: 'source',
      versionCode: 'V1',
      requestId: 'upload-123',
      buffer: binary,
    };
    const record = f.repository.files.add('P-ARCHIVE', input);
    assert.deepEqual(f.repository.files.add('P-ARCHIVE', input), record);
    for (const patch of [
      { buffer: Buffer.from('changed') },
      { category: 'cost' },
      { originalName: 'other.xlsx' },
    ])
      assert.throws(
        () => f.repository.files.add('P-ARCHIVE', { ...input, ...patch }),
        (e) => e.status === 409,
      );
    assert.equal(f.repository.files.list('P-ARCHIVE').files.length, 1);
  } finally {
    f.close();
  }
});

test('archive additions retain historical nodes and support completed, held and locked project documents', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const node = saved.workspace.processSteps[0];
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'review.pdf',
      category: 'workflow',
      nodeCode: node.code,
      versionCode: 'V1',
      buffer: binary,
    });
    // Model a previously completed/locked round without exercising unrelated workflow mutation APIs.
    const workspace = structuredClone(saved.workspace);
    workspace.processSteps[0].state = 'completed';
    workspace.costVersions[0].state = 'Confirmed';
    workspace.workflowHold = {
      heldAt: new Date().toISOString(),
      reason: 'fixture',
    };
    const db = new DatabaseSync(f.database);
    db.prepare(
      'UPDATE workspace_snapshots SET payload_json = ? WHERE project_id = ?',
    ).run(JSON.stringify(workspace), 'P-ARCHIVE');
    const added = f.repository.files.add('P-ARCHIVE', {
      originalName: 'evidence.pdf',
      category: 'workflow',
      nodeCode: node.code,
      versionCode: 'V1',
      buffer: binary,
    });
    workspace.processSteps = workspace.processSteps.filter(
      (step) => step.code !== node.code,
    );
    db.prepare(
      'UPDATE workspace_snapshots SET payload_json = ? WHERE project_id = ?',
    ).run(JSON.stringify(workspace), 'P-ARCHIVE');
    db.close();
    assert.deepEqual(
      f.repository.files.read('P-ARCHIVE', record.id).buffer,
      binary,
    );
    assert.equal(
      f.repository.files.list('P-ARCHIVE', { nodeCode: node.code }).files
        .length,
      2,
    );
    assert.equal(
      f.repository.files.read('P-ARCHIVE', added.id).record.nodeName,
      node.name,
    );
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', {
          originalName: 'late.pdf',
          category: 'workflow',
          nodeCode: node.code,
          buffer: binary,
        }),
      /does not belong/,
    );
    f.repository.setDeleted('P-ARCHIVE', 1, true);
    assert.deepEqual(
      f.repository.files.read('P-ARCHIVE', record.id).buffer,
      binary,
    );
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', {
          originalName: 'new.pdf',
          buffer: binary,
        }),
      /deleted/,
    );
  } finally {
    f.close();
  }
});

test('invalid names, oversized files, replaced directories and symlink files are rejected', () => {
  const f = fixture();
  try {
    create(f.repository);
    for (const originalName of [
      '../secret',
      'C:\\secret',
      '/tmp/secret',
      '.',
      '..',
      'x\nheader',
    ])
      assert.throws(
        () =>
          f.repository.files.add('P-ARCHIVE', { originalName, buffer: binary }),
        (e) => e.status === 400,
      );
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', {
          originalName: 'large.bin',
          buffer: Buffer.alloc(MAX_PROJECT_FILE_BYTES + 1),
        }),
      (e) => e.status === 413,
    );
    const listing = f.repository.files.list('P-ARCHIVE');
    const outside = path.join(f.directory, 'outside');
    mkdirSync(outside);
    const general = path.join(listing.projectPath, 'workflow');
    rmSync(general, { recursive: true });
    symlinkSync(outside, general);
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', {
          originalName: 'no.bin',
          buffer: binary,
        }),
      (e) => e.status === 409,
    );
    assert.deepEqual(readdirSync(outside), []);
    rmSync(general);
    mkdirSync(general);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'safe.bin',
      buffer: binary,
    });
    const absolute = path.join(listing.projectPath, record.relativePath);
    const target = path.join(outside, 'target.bin');
    writeFileSync(target, binary);
    rmSync(absolute);
    symlinkSync(target, absolute);
    assert.throws(
      () => f.repository.files.read('P-ARCHIVE', record.id),
      (e) => e.status === 409,
    );
    assert.deepEqual(readFileSync(target), binary);
  } finally {
    f.close();
  }
});

test('unusable archive root prevents project creation without a database record', () => {
  const f = fixture();
  try {
    const requested = path.join(f.directory, 'chosen');
    f.repository.files.updateSettings({ rootPath: requested }, 1);
    rmSync(requested, { recursive: true });
    writeFileSync(requested, 'not a directory');
    assert.throws(
      () => create(f.repository),
      (e) => e.code === 'ARCHIVE_IO',
    );
    assert.equal(f.repository.get('P-ARCHIVE'), null);
    assert.equal(f.repository.headers().length, 0);
    assert.equal(readFileSync(requested, 'utf8'), 'not a directory');
  } finally {
    f.close();
  }
});

test('database registration failure removes partial files and leaves existing archive content intact', () => {
  const f = fixture();
  try {
    create(f.repository);
    const listing = f.repository.files.list('P-ARCHIVE');
    const db = new DatabaseSync(f.database);
    db.exec(
      "CREATE TRIGGER reject_project_file BEFORE INSERT ON project_files BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
    );
    assert.throws(
      () =>
        f.repository.files.add('P-ARCHIVE', {
          originalName: 'failed.bin',
          buffer: binary,
        }),
      /archive folder could not be accessed/,
    );
    assert.equal(f.repository.files.list('P-ARCHIVE').files.length, 0);
    assert.deepEqual(
      readdirSync(path.join(listing.projectPath, 'workflow')).filter((name) =>
        name.endsWith('.bin'),
      ),
      [],
    );
    db.exec('DROP TRIGGER reject_project_file');
    db.close();
    assert.ok(
      f.repository.files.add('P-ARCHIVE', {
        originalName: 'succeed.bin',
        buffer: binary,
      }).id,
    );
  } finally {
    f.close();
  }
});

test('archive schema is additive and reopening never rewrites workspace snapshots', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'stored.bin',
      buffer: binary,
    });
    const settings = f.repository.files.getSettings();
    const archive = f.repository.files.list('P-ARCHIVE');
    f.repository.close();
    const db = new DatabaseSync(f.database);
    db.exec(
      'DROP TABLE project_files; DROP TABLE project_file_node_folders; DROP TABLE project_file_moves; DROP TABLE project_file_roots; DROP TABLE project_file_settings;',
    );
    const before = db.prepare('SELECT * FROM workspace_snapshots').get();
    db.close();
    const reopened = openWorkspaceRepository(f.database);
    const inspect = new DatabaseSync(f.database);
    assert.deepEqual(
      inspect.prepare('SELECT * FROM workspace_snapshots').get(),
      before,
    );
    assert.equal(
      inspect
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      8,
    );
    inspect.close();
    assert.deepEqual(reopened.get('P-ARCHIVE'), saved);
    // An old database lacking archive tables lazily provisions an archive folder.
    assert.ok(
      existsSync(reopened.files.ensureProject('P-ARCHIVE').projectPath),
    );
    assert.deepEqual(reopened.files.getSettings(), settings);
    reopened.close();
    assert.ok(existsSync(path.join(archive.projectPath, record.relativePath)));
  } finally {
    try {
      f.close();
    } catch {
      rmSync(f.directory, { recursive: true, force: true });
    }
  }
});

test('archived contents and configured settings survive closing and reopening the repository', () => {
  const f = fixture();
  try {
    f.repository.files.updateSettings(
      { rootPath: path.join(f.directory, 'custom') },
      1,
    );
    create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'persist.bin',
      buffer: binary,
    });
    const before = f.repository.files.list('P-ARCHIVE');
    f.repository.close();
    const reopened = openWorkspaceRepository(f.database);
    assert.deepEqual(reopened.files.list('P-ARCHIVE'), before);
    assert.deepEqual(
      reopened.files.read('P-ARCHIVE', record.id).buffer,
      binary,
    );
    assert.equal(reopened.files.getSettings().revision, 2);
    reopened.close();
  } finally {
    try {
      f.close();
    } catch {
      rmSync(f.directory, { recursive: true, force: true });
    }
  }
});

test('changed archive bytes are detected and a moved project folder is never recreated silently', () => {
  const f = fixture();
  try {
    create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'persist.bin',
      buffer: binary,
    });
    const listing = f.repository.files.list('P-ARCHIVE');
    writeFileSync(
      path.join(listing.projectPath, record.relativePath),
      Buffer.alloc(binary.length),
    );
    assert.throws(
      () => f.repository.files.read('P-ARCHIVE', record.id),
      (e) => e.code === 'FILE_INTEGRITY',
    );
    renameSync(listing.projectPath, `${listing.projectPath}-moved`);
    assert.throws(() =>
      f.repository.files.add('P-ARCHIVE', {
        originalName: 'new.bin',
        buffer: binary,
      }),
    );
    assert.equal(existsSync(listing.projectPath), false);
    assert.equal(f.repository.files.list('P-ARCHIVE').files.length, 1);
  } finally {
    f.close();
  }
});

test('invalid settings leave the configured root and its revision unchanged', () => {
  const f = fixture();
  try {
    const settings = f.repository.files.getSettings();
    const nonfolder = path.join(f.directory, 'file.txt');
    writeFileSync(nonfolder, 'original');
    const link = path.join(f.directory, 'alias');
    symlinkSync(f.directory, link);
    for (const rootPath of ['relative/folder', nonfolder, link]) {
      assert.throws(() =>
        f.repository.files.updateSettings({ rootPath }, settings.revision),
      );
      assert.deepEqual(f.repository.files.getSettings(), settings);
    }
    assert.equal(readFileSync(nonfolder, 'utf8'), 'original');
  } finally {
    f.close();
  }
});

test('failed project archive registration rolls back the new project and removes created folders', () => {
  const f = fixture();
  try {
    const rootPath = path.join(f.directory, 'chosen');
    f.repository.files.updateSettings({ rootPath }, 1);
    const db = new DatabaseSync(f.database);
    db.exec(
      "CREATE TRIGGER reject_archive BEFORE INSERT ON project_file_roots BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
    );
    assert.throws(
      () => create(f.repository),
      (e) => e.code === 'ARCHIVE_IO',
    );
    assert.equal(f.repository.get('P-ARCHIVE'), null);
    assert.deepEqual(readdirSync(rootPath), []);
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM projects').get().count,
      0,
    );
    db.close();
  } finally {
    f.close();
  }
});

const legacyPath = (record) =>
  path.join(
    record.category,
    ...(record.versionCode ? [record.versionCode] : []),
    ...(record.nodeCode
      ? [
          `${record.nodeCode}--${createHash('sha256').update(record.nodeCode).digest('hex').slice(0, 10)}`,
        ]
      : []),
    path.basename(record.relativePath),
  );
const forceLegacy = (f, archive, record) => {
  const relative = legacyPath(record);
  mkdirSync(path.dirname(path.join(archive.projectPath, relative)), {
    recursive: true,
  });
  renameSync(
    path.join(archive.projectPath, record.relativePath),
    path.join(archive.projectPath, relative),
  );
  const db = new DatabaseSync(f.database);
  db.prepare('UPDATE project_files SET relative_path = ? WHERE id = ?').run(
    relative,
    record.id,
  );
  db.close();
  return relative;
};

test('physical archive has only three folders and workflow uses readable node names without a version parent', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const node = saved.workspace.processSteps[0];
    const initial = f.repository.files.list('P-ARCHIVE');
    assert.equal(
      readdirSync(path.join(initial.projectPath, 'workflow')).length,
      saved.workspace.processSteps.length,
    );
    const files = [
      'general',
      'workflow',
      'cost',
      'quote',
      'cpq',
      'maintenance',
      'source',
      'backup',
    ].map((category) =>
      f.repository.files.add('P-ARCHIVE', {
        originalName: `${category}.bin`,
        category,
        versionCode: 'V1',
        ...(category === 'workflow' ? { nodeCode: node.code } : {}),
        buffer: binary,
      }),
    );
    for (const record of files) {
      const parts = record.relativePath.split(path.sep);
      assert.equal(
        parts[0],
        ['cost', 'source'].includes(record.category)
          ? 'cost'
          : ['quote', 'cpq', 'maintenance'].includes(record.category)
            ? 'quotation'
            : 'workflow',
      );
      if (record.category === 'workflow') {
        assert.notEqual(parts[1], 'V1');
        assert.ok(parts[1].includes(' '));
        assert.equal(parts.length, 3);
      }
      assert.equal(record.versionCode, 'V1');
    }
    assert.deepEqual(readdirSync(initial.projectPath).sort(), [
      'cost',
      'quotation',
      'workflow',
    ]);
    assert.deepEqual(f.repository.get('P-ARCHIVE'), saved);
  } finally {
    f.close();
  }
});

test('legacy indexed files migrate once with stable IDs, captured metadata, exact bytes and no cost revision changes', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const node = saved.workspace.processSteps[0];
    const archive = f.repository.files.list('P-ARCHIVE');
    const records = [
      'general',
      'workflow',
      'quote',
      'source',
      'backup',
      'cpq',
      'maintenance',
    ].map((category) =>
      f.repository.files.add('P-ARCHIVE', {
        originalName: `${category}.bin`,
        category,
        versionCode: 'V1',
        ...(category === 'workflow' ? { nodeCode: node.code } : {}),
        buffer: binary,
      }),
    );
    const oldPaths = records.map((record) => forceLegacy(f, archive, record));
    // Unindexed files are retained and moved without overwriting a colliding target.
    mkdirSync(path.join(archive.projectPath, 'source'), { recursive: true });
    writeFileSync(
      path.join(archive.projectPath, 'source', 'manual.txt'),
      'source user file',
    );
    writeFileSync(
      path.join(archive.projectPath, 'cost', 'manual.txt'),
      'existing user file',
    );
    const migrated = f.repository.files.list('P-ARCHIVE').files;
    assert.deepEqual(readdirSync(archive.projectPath).sort(), [
      'cost',
      'quotation',
      'workflow',
    ]);
    for (const record of records) {
      const current = migrated.find((value) => value.id === record.id);
      assert.deepEqual(
        { ...current, relativePath: record.relativePath },
        record,
      );
      assert.deepEqual(
        f.repository.files.read('P-ARCHIVE', record.id).buffer,
        binary,
      );
    }
    for (const old of oldPaths)
      assert.equal(existsSync(path.join(archive.projectPath, old)), false);
    assert.equal(
      readFileSync(
        path.join(archive.projectPath, 'cost', 'manual.txt'),
        'utf8',
      ),
      'existing user file',
    );
    const rescued = readdirSync(path.join(archive.projectPath, 'cost')).find(
      (name) => name.endsWith('--manual.txt'),
    );
    assert.equal(
      readFileSync(path.join(archive.projectPath, 'cost', rescued), 'utf8'),
      'source user file',
    );
    assert.deepEqual(f.repository.get('P-ARCHIVE'), saved);
    assert.deepEqual(f.repository.files.list('P-ARCHIVE').files, migrated);
  } finally {
    f.close();
  }
});

test('node renames and additions synchronize readable folders while retaining captured file metadata and loose documents', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const node = saved.workspace.processSteps[0];
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'review.pdf',
      category: 'workflow',
      nodeCode: node.code,
      versionCode: 'V1',
      buffer: binary,
    });
    const archive = f.repository.files.list('P-ARCHIVE');
    const oldFolder = path.dirname(record.relativePath);
    writeFileSync(
      path.join(archive.projectPath, oldFolder, 'manual.txt'),
      'manual evidence',
    );
    const workspace = structuredClone(saved.workspace);
    workspace.processSteps[0].name = 'DRB Review & Approval';
    workspace.processSteps.push({
      ...node,
      code: 'NEW_NODE',
      name: 'New Legal Review',
    });
    const db = new DatabaseSync(f.database);
    db.prepare(
      'UPDATE workspace_snapshots SET payload_json = ? WHERE project_id = ?',
    ).run(JSON.stringify(workspace), 'P-ARCHIVE');
    db.close();
    const current = f.repository.files.list('P-ARCHIVE').files[0];
    assert.equal(
      path.dirname(current.relativePath),
      path.join('workflow', 'DRB Review & Approval'),
    );
    assert.equal(current.nodeName, record.nodeName);
    assert.equal(existsSync(path.join(archive.projectPath, oldFolder)), false);
    assert.equal(
      readFileSync(
        path.join(
          archive.projectPath,
          'workflow',
          'DRB Review & Approval',
          'manual.txt',
        ),
        'utf8',
      ),
      'manual evidence',
    );
    assert.ok(
      existsSync(
        path.join(archive.projectPath, 'workflow', 'New Legal Review'),
      ),
    );
    assert.equal(f.repository.get('P-ARCHIVE').revision, 1);
  } finally {
    f.close();
  }
});

test('layout migration rollback retains original path and bytes, and retry safely reuses an interrupted copy', () => {
  const f = fixture();
  try {
    create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'quote.xlsx',
      category: 'quote',
      versionCode: 'V1',
      buffer: binary,
    });
    const archive = f.repository.files.list('P-ARCHIVE');
    const legacy = forceLegacy(f, archive, record);
    const db = new DatabaseSync(f.database);
    db.exec(
      "CREATE TRIGGER reject_file_move BEFORE UPDATE OF relative_path ON project_files BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    assert.throws(() => f.repository.files.list('P-ARCHIVE'));
    assert.deepEqual(
      readFileSync(path.join(archive.projectPath, legacy)),
      binary,
    );
    assert.equal(
      existsSync(path.join(archive.projectPath, record.relativePath)),
      false,
    );
    assert.equal(
      db
        .prepare('SELECT relative_path FROM project_files WHERE id = ?')
        .get(record.id).relative_path,
      legacy,
    );
    db.exec('DROP TRIGGER reject_file_move');
    // Simulate a crash after copy but before SQLite commit.
    writeFileSync(path.join(archive.projectPath, record.relativePath), binary);
    f.repository.files.list('P-ARCHIVE');
    assert.equal(existsSync(path.join(archive.projectPath, legacy)), false);
    assert.deepEqual(
      f.repository.files.read('P-ARCHIVE', record.id).buffer,
      binary,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM project_file_moves').get()
        .count,
      0,
    );
    db.close();
  } finally {
    f.close();
  }
});

test('pending post-commit cleanup resumes safely and never removes changed or symlinked legacy content', () => {
  const f = fixture();
  try {
    create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'quote.xlsx',
      category: 'quote',
      buffer: binary,
    });
    const archive = f.repository.files.list('P-ARCHIVE');
    const legacy = path.join('quote', path.basename(record.relativePath));
    mkdirSync(path.join(archive.projectPath, 'quote'));
    writeFileSync(path.join(archive.projectPath, legacy), binary);
    const db = new DatabaseSync(f.database);
    db.prepare('INSERT INTO project_file_moves VALUES (?,?,?,?,?,?)').run(
      'move-1',
      'P-ARCHIVE',
      legacy,
      record.relativePath,
      record.sha256,
      record.sizeBytes,
    );
    f.repository.files.list('P-ARCHIVE');
    assert.equal(existsSync(path.join(archive.projectPath, legacy)), false);
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM project_file_moves').get()
        .count,
      0,
    );
    const unsafe = path.join(archive.projectPath, 'source');
    mkdirSync(unsafe);
    const outside = path.join(f.directory, 'outside.txt');
    writeFileSync(outside, 'untouched');
    symlinkSync(outside, path.join(unsafe, 'shortcut'));
    f.repository.files.list('P-ARCHIVE');
    assert.equal(readFileSync(outside, 'utf8'), 'untouched');
    assert.ok(existsSync(path.join(unsafe, 'shortcut')));
    db.close();
  } finally {
    f.close();
  }
});

test('moving a project archive preserves indexed and unindexed files without changing project or settings revisions', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'quote.xlsx',
      category: 'quote',
      versionCode: 'V1',
      buffer: binary,
    });
    const archive = f.repository.files.list('P-ARCHIVE');
    writeFileSync(
      path.join(archive.projectPath, 'cost', 'manual.txt'),
      'user maintained',
    );
    const settings = f.repository.files.getSettings();
    const destination = path.join(
      f.directory,
      'custom parent',
      'Renamed Project',
    );
    const moved = f.repository.files.moveProject('P-ARCHIVE', {
      expectedProjectPath: archive.projectPath,
      projectPath: destination,
    });
    assert.equal(moved.projectPath, realpathSync(destination));
    assert.equal(existsSync(archive.projectPath), false);
    assert.equal(
      readFileSync(path.join(destination, 'cost', 'manual.txt'), 'utf8'),
      'user maintained',
    );
    assert.deepEqual(
      f.repository.files.read('P-ARCHIVE', record.id).buffer,
      binary,
    );
    assert.deepEqual(f.repository.get('P-ARCHIVE'), saved);
    assert.deepEqual(f.repository.files.getSettings(), settings);
    assert.throws(
      () =>
        f.repository.files.moveProject('P-ARCHIVE', {
          expectedProjectPath: archive.projectPath,
          projectPath: path.join(f.directory, 'stale'),
        }),
      (e) => e.status === 409,
    );
    assert.equal(existsSync(path.join(f.directory, 'stale')), false);
    assert.equal(
      f.repository.files.list('P-ARCHIVE').projectPath,
      realpathSync(destination),
    );
  } finally {
    f.close();
  }
});

test('project move rejects occupied or nested destinations and rolls back a failed mapping commit', () => {
  const f = fixture();
  try {
    create(f.repository);
    const record = f.repository.files.add('P-ARCHIVE', {
      originalName: 'evidence.bin',
      buffer: binary,
    });
    const archive = f.repository.files.list('P-ARCHIVE');
    const occupied = path.join(f.directory, 'occupied');
    mkdirSync(occupied);
    for (const destination of [
      occupied,
      path.join(archive.projectPath, 'child'),
    ])
      assert.throws(() =>
        f.repository.files.moveProject('P-ARCHIVE', {
          expectedProjectPath: archive.projectPath,
          projectPath: destination,
        }),
      );
    const db = new DatabaseSync(f.database);
    db.exec(
      "CREATE TRIGGER reject_archive_move BEFORE UPDATE ON project_file_roots BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    const destination = path.join(f.directory, 'failed destination');
    assert.throws(() =>
      f.repository.files.moveProject('P-ARCHIVE', {
        expectedProjectPath: archive.projectPath,
        projectPath: destination,
      }),
    );
    assert.equal(existsSync(destination), false);
    assert.equal(
      f.repository.files.list('P-ARCHIVE').projectPath,
      archive.projectPath,
    );
    assert.deepEqual(
      f.repository.files.read('P-ARCHIVE', record.id).buffer,
      binary,
    );
    db.close();
  } finally {
    f.close();
  }
});

test('legacy Finder-only version folders are pruned without removing real files or current node folders', () => {
  const f = fixture();
  try {
    const saved = create(f.repository);
    const workspace = structuredClone(saved.workspace);
    workspace.processSteps[0].name = 'V3';
    const db = new DatabaseSync(f.database);
    db.prepare(
      'UPDATE workspace_snapshots SET payload_json = ? WHERE project_id = ?',
    ).run(JSON.stringify(workspace), 'P-ARCHIVE');
    db.close();
    const archive = f.repository.files.list('P-ARCHIVE');
    const workflow = path.join(archive.projectPath, 'workflow');
    const obsolete = path.join(workflow, 'V1');
    mkdirSync(path.join(obsolete, 'node', 'empty'), { recursive: true });
    writeFileSync(path.join(obsolete, '.DS_Store'), 'Finder');
    writeFileSync(path.join(obsolete, 'node', '.DS_Store'), 'Finder');
    const retained = path.join(workflow, 'V2', 'unrecognized node');
    mkdirSync(retained, { recursive: true });
    writeFileSync(path.join(workflow, 'V2', '.DS_Store'), 'Finder');
    writeFileSync(path.join(retained, '.DS_Store'), 'Finder');
    writeFileSync(
      path.join(retained, 'manual.txt'),
      'important unindexed document',
    );
    writeFileSync(
      path.join(workflow, 'V3', '.DS_Store'),
      'current node Finder',
    );
    const linked = path.join(workflow, 'V4');
    mkdirSync(linked);
    const outside = path.join(f.directory, 'outside.txt');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, path.join(linked, '.DS_Store'));
    f.repository.files.syncProject('P-ARCHIVE');
    assert.equal(existsSync(obsolete), false);
    assert.equal(
      readFileSync(path.join(retained, 'manual.txt'), 'utf8'),
      'important unindexed document',
    );
    assert.equal(
      readFileSync(path.join(retained, '.DS_Store'), 'utf8'),
      'Finder',
    );
    assert.equal(
      readFileSync(path.join(workflow, 'V2', '.DS_Store'), 'utf8'),
      'Finder',
    );
    assert.equal(
      readFileSync(path.join(workflow, 'V3', '.DS_Store'), 'utf8'),
      'current node Finder',
    );
    assert.equal(readFileSync(outside, 'utf8'), 'outside');
    assert.ok(existsSync(path.join(linked, '.DS_Store')));
    assert.equal(f.repository.get('P-ARCHIVE').revision, saved.revision);
  } finally {
    f.close();
  }
});
