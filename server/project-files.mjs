/** Durable project archives. File metadata and settings are independent of cost snapshots. */
import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeArchiveFolderPath } from './archive-folder-path.mjs';
import { syncArchiveDirectory } from './archive-filesystem.mjs';
import { stageArchiveMove } from './project-archive-move.mjs';
import {
  createProjectFileRemoval,
  ProjectFileRemovalError,
} from './project-file-removal.mjs';

export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
export const PROJECT_FILE_CATEGORIES = [
  'general',
  'workflow',
  'cost',
  'quote',
  'cpq',
  'maintenance',
  'source',
  'backup',
];
export class ProjectFileError extends Error {
  constructor(message, status = 400, code = 'FILE_VALIDATION') {
    super(message);
    this.name = 'ProjectFileError';
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status, code) => {
  throw new ProjectFileError(message, status, code);
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const text = (value, label, max = 180) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    fail(
      `${label} must be non-empty text, at most ${max} characters, without control characters.`,
    );
  return value.trim();
};
const safeSegment = (value, max = 65) =>
  String(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, max) || 'item';
/** Preserve read-only source access; Windows needs write access to flush copied bytes. */
const hashRegularFile = (filename, { flushWrites = false } = {}) => {
  const descriptor = openSync(
    filename,
    (flushWrites && process.platform === 'win32'
      ? constants.O_RDWR
      : constants.O_RDONLY) | constants.O_NOFOLLOW,
  );
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile())
      fail(
        'An archive entry is not a regular file.',
        409,
        'ARCHIVE_PATH_CHANGED',
      );
    const digest = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let count;
    while ((count = readSync(descriptor, chunk, 0, chunk.length, null)) !== 0)
      digest.update(chunk.subarray(0, count));
    const after = fstatSync(descriptor);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      fail('An archive file changed during migration.', 409, 'FILE_INTEGRITY');
    if (flushWrites) fsyncSync(descriptor);
    return digest.digest('hex');
  } finally {
    closeSync(descriptor);
  }
};
const readableNodeFolder = (value) => {
  let name = String(value || 'Workflow Node')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  name = Array.from(name)
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('');
  while (Buffer.byteLength(name) > 150)
    name = Array.from(name).slice(0, -1).join('');
  return name || 'Workflow Node';
};
/** Keep disabled workflow steps associated in metadata while storing their files in workflow/. */
const physicalParts = (
  category,
  versionCode,
  nodeName,
  createNodeFolder = true,
) => {
  if (category === 'workflow')
    return createNodeFolder
      ? ['workflow', readableNodeFolder(nodeName)]
      : ['workflow'];
  const base = ['cost', 'source'].includes(category)
    ? 'cost'
    : ['quote', 'cpq', 'maintenance'].includes(category)
      ? 'quotation'
      : 'workflow';
  return base !== 'workflow' && versionCode
    ? [base, safeSegment(versionCode)]
    : [base];
};
const normalizedFilename = (value) => {
  const name = text(value, 'originalName', 240);
  if (
    name === '.' ||
    name === '..' ||
    /[\\/]/.test(name) ||
    path.basename(name) !== name
  )
    fail('originalName must be a filename without folders.');
  return name;
};
const ioError = (error) => {
  if (error instanceof ProjectFileError) throw error;
  if (error instanceof ProjectFileRemovalError)
    fail(error.message, error.status, error.code);
  fail(
    `The archive folder could not be accessed (${error.code || 'filesystem error'}). Check its location and permissions.`,
    500,
    'ARCHIVE_IO',
  );
};
/** Normalize user input once; stored archive paths and CAS baselines stay literal. */
const requestedFolderPath = (value, label) => {
  try {
    return normalizeArchiveFolderPath(text(value, label, 4096));
  } catch (error) {
    if (error instanceof ProjectFileError) throw error;
    fail(error.message, 400, 'ARCHIVE_PATH_INVALID');
  }
};
// Canonicalize user-selected ancestor aliases (e.g. macOS /tmp) once, but never
// accept a symbolic link as the archive root or any project/file descendant.
const prepareRoot = (requested) => {
  const root = text(requested, 'rootPath', 4096);
  if (!path.isAbsolute(root)) fail('rootPath must be an absolute folder path.');
  const resolved = path.resolve(root);
  try {
    if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink())
      fail('The archive root cannot be a symbolic link.');
    mkdirSync(resolved, { recursive: true });
    if (!lstatSync(resolved).isDirectory())
      fail('The archive root must be a folder.');
    const canonical = realpathSync(resolved);
    const probe = path.join(canonical, `.archive-write-check-${randomUUID()}`);
    let descriptor;
    try {
      descriptor = openSync(
        probe,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        unlinkSync(probe);
      }
    }
    return canonical;
  } catch (error) {
    return ioError(error);
  }
};
const assertRoot = (root) => {
  const stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(root) !== root
  )
    fail(
      'The archive root changed or is a symbolic link.',
      409,
      'ARCHIVE_PATH_CHANGED',
    );
};
const within = (root, relative) => {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative
      .split(/[\\/]/)
      .some((part) => !part || part === '.' || part === '..')
  )
    fail('Invalid archive path.', 400, 'FILE_VALIDATION');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`))
    fail('Archive path is outside the project folder.');
  return absolute;
};
const checkedDirectory = (root, relative, create = false) => {
  assertRoot(root);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = within(current, segment);
    if (create && !existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(current) !== current
    )
      fail(
        'An archive folder was replaced or is a symbolic link.',
        409,
        'ARCHIVE_PATH_CHANGED',
      );
  }
  return current;
};
const mapRecord = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.project_id,
        originalName: row.original_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        createdAt: row.created_at,
        category: row.category,
        ...(row.node_code
          ? { nodeCode: row.node_code, nodeName: row.node_name }
          : {}),
        ...(row.version_code ? { versionCode: row.version_code } : {}),
        relativePath: row.relative_path,
      }
    : null;

export const makeProjectFileStore = (db, databasePath) => {
  const temporaryRoot =
    databasePath === ':memory:'
      ? mkdtempSync(path.join(tmpdir(), 'workbench-project-files-'))
      : null;
  const defaultRootPath = temporaryRoot
    ? realpathSync(temporaryRoot)
    : path.join(
        realpathSync(path.dirname(path.resolve(databasePath))),
        'project-files',
      );
  db.prepare(
    `INSERT OR IGNORE INTO project_file_settings (id, root_path, revision) VALUES (1, ?, 1)`,
  ).run(defaultRootPath);
  const project = (id, allowDeleted = false) => {
    text(id, 'projectId');
    const row = db
      .prepare(
        `SELECT p.id, p.name, d.deleted_at FROM projects p LEFT JOIN deleted_projects d ON d.project_id = p.id WHERE p.id = ?`,
      )
      .get(id);
    if (!row || (!allowDeleted && row.deleted_at))
      fail(
        row?.deleted_at
          ? 'Project was deleted. Restore it before adding files.'
          : 'Project not found.',
        404,
        'PROJECT_NOT_FOUND',
      );
    return row;
  };
  const mapping = (id) =>
    db.prepare('SELECT * FROM project_file_roots WHERE project_id = ?').get(id);
  const location = (row) => ({
    projectId: row.project_id,
    rootPath: row.root_path,
    projectPath: within(row.root_path, row.project_folder),
  });
  const getSettings = () => {
    const row = db
      .prepare(
        'SELECT root_path, revision FROM project_file_settings WHERE id = 1',
      )
      .get();
    return { rootPath: row.root_path, defaultRootPath, revision: row.revision };
  };
  const getWorkspace = (id) =>
    JSON.parse(
      db
        .prepare(
          'SELECT payload_json FROM workspace_snapshots WHERE project_id = ?',
        )
        .get(id).payload_json,
    );
  const nodeLabels = (workspace) => {
    const labels = new Map();
    for (const round of [
      workspace,
      ...Object.values(workspace.versionWorkflows || {}),
    ])
      for (const node of round?.processSteps || [])
        if (!labels.has(node.code))
          labels.set(node.code, node.name || node.nameZh || node.code);
    return labels;
  };
  /** Record the initial definitions once; historical projects retain every already-known folder. */
  const saveFolderPolicy = (id, workspace, honorDefinitions) => {
    const policy = new Map();
    for (const round of [
      workspace,
      ...Object.values(workspace.versionWorkflows || {}),
    ])
      for (const step of round?.processSteps || [])
        if (!policy.has(step.code))
          policy.set(
            step.code,
            honorDefinitions ? step.createFolder !== false : true,
          );
    db.prepare(
      'INSERT INTO project_file_folder_policies (project_id, policy_json) VALUES (?, ?)',
    ).run(id, JSON.stringify(Object.fromEntries(policy)));
  };
  /** Add metadata for legacy archives without changing their existing files or directory choices. */
  const folderPolicy = (archive) => {
    let saved = db
      .prepare(
        'SELECT policy_json FROM project_file_folder_policies WHERE project_id = ?',
      )
      .get(archive.project_id);
    if (!saved) {
      const oldFolders = db
        .prepare(
          'SELECT node_code FROM project_file_node_folders WHERE project_id = ?',
        )
        .all(archive.project_id);
      // An empty legacy mapping is also a snapshot: do not invent folders from today's template.
      db.prepare(
        'INSERT INTO project_file_folder_policies (project_id, policy_json) VALUES (?, ?)',
      ).run(
        archive.project_id,
        JSON.stringify(
          Object.fromEntries(oldFolders.map((row) => [row.node_code, true])),
        ),
      );
      saved = db
        .prepare(
          'SELECT policy_json FROM project_file_folder_policies WHERE project_id = ?',
        )
        .get(archive.project_id);
    }
    return JSON.parse(saved.policy_json);
  };
  /** An absent step was added after project creation and must not provision a new directory. */
  const hasNodeFolder = (archive, nodeCode) =>
    folderPolicy(archive)[nodeCode] === true;
  const verifyFile = (archive, relative, sha256, size) => {
    checkedDirectory(
      archive.root_path,
      path.join(archive.project_folder, path.dirname(relative)),
    );
    const absolute = within(location(archive).projectPath, relative);
    let fd;
    try {
      fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size !== size ||
        stat.size > MAX_PROJECT_FILE_BYTES
      )
        fail('The archived file size changed.', 409, 'FILE_INTEGRITY');
      const bytes = readFileSync(fd);
      if (hash(bytes) !== sha256)
        fail('The archived file content changed.', 409, 'FILE_INTEGRITY');
      return bytes;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const fileRemoval = createProjectFileRemoval({
    db,
    location,
    verifyFile,
    within,
  });
  const trimEmpty = (archive, relative) => {
    const protectedFolders = new Set([
      'workflow',
      'cost',
      'quotation',
      ...db
        .prepare(
          'SELECT folder_name FROM project_file_node_folders WHERE project_id = ?',
        )
        .all(archive.project_id)
        .map((row) => path.join('workflow', row.folder_name)),
    ]);
    const pruneFinderOnlyDirectory = (folder) => {
      if (protectedFolders.has(folder)) return false;
      const absolute = checkedDirectory(
        archive.root_path,
        path.join(archive.project_folder, folder),
      );
      for (const entry of readdirSync(absolute)) {
        const child = path.join(folder, entry);
        const stat = lstatSync(within(location(archive).projectPath, child));
        if (stat.isDirectory() && !stat.isSymbolicLink())
          pruneFinderOnlyDirectory(child);
      }
      const remaining = readdirSync(absolute);
      if (remaining.some((name) => name !== '.DS_Store')) return false;
      if (remaining.length) {
        const metadata = path.join(folder, '.DS_Store');
        const filename = within(location(archive).projectPath, metadata);
        const stat = lstatSync(filename);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          db
            .prepare(
              'SELECT 1 FROM project_files WHERE project_id = ? AND relative_path = ?',
            )
            .get(archive.project_id, metadata) ||
          db
            .prepare(
              'SELECT 1 FROM project_file_moves WHERE project_id = ? AND (source_path = ? OR target_path = ?)',
            )
            .get(archive.project_id, metadata, metadata)
        )
          return false;
        // Finder metadata is disposable only after the containing directory has
        // no business files or protected descendants. Never follow metadata links.
        unlinkSync(filename);
      }
      rmdirSync(absolute);
      return true;
    };
    let cursor = relative;
    while (cursor && cursor !== '.' && !protectedFolders.has(cursor)) {
      try {
        if (!pruneFinderOnlyDirectory(cursor)) break;
      } catch (error) {
        if (error.code !== 'ENOENT') break;
      }
      cursor = path.dirname(cursor);
    }
  };
  const finishMoves = (archive) => {
    for (const move of db
      .prepare('SELECT * FROM project_file_moves WHERE project_id = ?')
      .all(archive.project_id)) {
      // The target is already fsynced and indexed. Never remove an altered source
      // or the sole surviving copy after an interrupted external filesystem move.
      try {
        verifyFile(archive, move.target_path, move.sha256, move.size_bytes);
        const source = within(location(archive).projectPath, move.source_path);
        if (existsSync(source)) {
          verifyFile(archive, move.source_path, move.sha256, move.size_bytes);
          if (
            !db
              .prepare(
                'SELECT 1 FROM project_files WHERE project_id = ? AND relative_path = ?',
              )
              .get(archive.project_id, move.source_path)
          )
            unlinkSync(source);
        }
        db.prepare('DELETE FROM project_file_moves WHERE id = ?').run(move.id);
        trimEmpty(archive, path.dirname(move.source_path));
      } catch {
        /* Keep the journal and original copy for recovery on a later access. */
      }
    }
  };
  const relocateLooseLegacyFiles = (archive, renamedFolders = []) => {
    const pendingSources = new Set(
      db
        .prepare(
          'SELECT source_path FROM project_file_moves WHERE project_id = ?',
        )
        .all(archive.project_id)
        .map((row) => row.source_path),
    );
    const indexed = new Set(
      db
        .prepare('SELECT relative_path FROM project_files WHERE project_id = ?')
        .all(archive.project_id)
        .map((row) => row.relative_path),
    );
    // Staged deletions are owned by recovery; layout migration must never rename their copies.
    for (const row of db
      .prepare('SELECT * FROM project_files WHERE project_id = ?')
      .all(archive.project_id))
      pendingSources.add(fileRemoval.stagedRelative(row));
    for (const row of db
      .prepare(
        'SELECT staged_path FROM project_file_deletions WHERE project_id = ?',
      )
      .all(archive.project_id))
      pendingSources.add(row.staged_path);
    const base = location(archive).projectPath;
    const visit = (relative, targetRelative) => {
      const source = within(base, relative);
      let stat;
      try {
        stat = lstatSync(source);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        checkedDirectory(
          archive.root_path,
          path.join(archive.project_folder, relative),
        );
        for (const child of readdirSync(source))
          visit(path.join(relative, child), path.join(targetRelative, child));
        trimEmpty(archive, relative);
      } else if (
        stat.isFile() &&
        path.basename(relative) !== '.DS_Store' &&
        !pendingSources.has(relative) &&
        !indexed.has(relative)
      ) {
        checkedDirectory(
          archive.root_path,
          path.join(archive.project_folder, path.dirname(relative)),
        );
        checkedDirectory(
          archive.root_path,
          path.join(archive.project_folder, path.dirname(targetRelative)),
          true,
        );
        let destination = within(base, targetRelative);
        if (existsSync(destination))
          destination = within(
            base,
            path.join(
              path.dirname(targetRelative),
              `${randomUUID()}--${path.basename(targetRelative)}`,
            ),
          );
        // COPYFILE_EXCL preserves any pre-existing file. Verify both copies before
        // removing the old name; non-indexed user files remain non-indexed.
        copyFileSync(source, destination, constants.COPYFILE_EXCL);
        if (
          hashRegularFile(source) ===
          hashRegularFile(destination, { flushWrites: true })
        ) {
          syncArchiveDirectory(path.dirname(destination));
          unlinkSync(source);
        }
      }
    };
    for (const category of [
      'general',
      'quote',
      'cpq',
      'maintenance',
      'source',
      'backup',
    ]) {
      const absolute = within(base, category);
      if (!existsSync(absolute)) continue;
      try {
        visit(category, physicalParts(category)[0]);
      } catch {
        /* Preserve unindexed content that cannot be moved safely. */
      }
    }
    const labels = nodeLabels(getWorkspace(archive.project_id));
    const nodeFolders = new Set([...labels.values()].map(readableNodeFolder));
    const workflow = within(base, 'workflow');
    for (const oldVersion of readdirSync(workflow)) {
      if (!/^V[1-9][0-9]*$/.test(oldVersion) || nodeFolders.has(oldVersion))
        continue;
      const relativeVersion = path.join('workflow', oldVersion);
      try {
        checkedDirectory(
          archive.root_path,
          path.join(archive.project_folder, relativeVersion),
        );
        for (const oldNode of readdirSync(within(base, relativeVersion))) {
          const code = oldNode.replace(/--[a-f0-9]{10}$/, '');
          const label = labels.get(code);
          if (label)
            visit(
              path.join(relativeVersion, oldNode),
              hasNodeFolder(archive, code)
                ? path.join('workflow', readableNodeFolder(label))
                : 'workflow',
            );
        }
        trimEmpty(archive, relativeVersion);
      } catch {
        /* Unrecognized user-created folders are preserved. */
      }
    }
    for (const [oldFolder, newFolder] of renamedFolders) {
      if (!existsSync(within(base, oldFolder))) continue;
      try {
        visit(oldFolder, newFolder);
      } catch {
        /* Never delete unsafe or inaccessible user content. */
      }
    }
  };
  const syncLayoutInTransaction = (archive, workspace) => {
    checkedDirectory(archive.root_path, archive.project_folder);
    fileRemoval.recover(archive, { withinTransaction: true });
    const labels = nodeLabels(workspace);
    const policy = folderPolicy(archive);
    const oldFolders = [];
    for (const base of ['workflow', 'cost', 'quotation'])
      checkedDirectory(
        archive.root_path,
        path.join(archive.project_folder, base),
        true,
      );
    for (const [code, name] of labels) {
      if (policy[code] !== true) continue;
      const folder = readableNodeFolder(name);
      checkedDirectory(
        archive.root_path,
        path.join(archive.project_folder, 'workflow', folder),
        true,
      );
      const old = db
        .prepare(
          'SELECT folder_name FROM project_file_node_folders WHERE project_id = ? AND node_code = ?',
        )
        .get(archive.project_id, code);
      if (old && old.folder_name !== folder)
        oldFolders.push([
          path.join('workflow', old.folder_name),
          path.join('workflow', folder),
        ]);
      db.prepare(
        'INSERT INTO project_file_node_folders (project_id, node_code, folder_name) VALUES (?, ?, ?) ON CONFLICT(project_id,node_code) DO UPDATE SET folder_name = excluded.folder_name',
      ).run(archive.project_id, code, folder);
    }
    const createdCopies = [];
    try {
      for (const row of db
        .prepare('SELECT * FROM project_files WHERE project_id = ?')
        .all(archive.project_id)) {
        const parts = physicalParts(
          row.category,
          row.version_code,
          labels.get(row.node_code) || row.node_name || row.node_code,
          policy[row.node_code] === true,
        );
        let target = path.join(...parts, path.basename(row.relative_path));
        if (target === row.relative_path) continue;
        const bytes = verifyFile(
          archive,
          row.relative_path,
          row.sha256,
          row.size_bytes,
        );
        checkedDirectory(
          archive.root_path,
          path.join(archive.project_folder, ...parts),
          true,
        );
        let absolute = within(location(archive).projectPath, target);
        if (existsSync(absolute)) {
          try {
            verifyFile(archive, target, row.sha256, row.size_bytes);
            // A matching copy may come from an interrupted move; flush it before retiring the source.
            if (hashRegularFile(absolute, { flushWrites: true }) !== row.sha256)
              fail('The existing archive copy changed during verification.');
          } catch {
            target = path.join(
              ...parts,
              `${randomUUID()}--${path.basename(row.relative_path)}`,
            );
            absolute = within(location(archive).projectPath, target);
          }
        }
        if (!existsSync(absolute)) {
          const fd = openSync(
            absolute,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o600,
          );
          createdCopies.push(absolute);
          try {
            writeFileSync(fd, bytes);
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
        verifyFile(archive, target, row.sha256, row.size_bytes);
        syncArchiveDirectory(path.dirname(absolute));
        db.prepare(
          'INSERT INTO project_file_moves (id, project_id, source_path, target_path, sha256, size_bytes) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          randomUUID(),
          archive.project_id,
          row.relative_path,
          target,
          row.sha256,
          row.size_bytes,
        );
        db.prepare(
          'UPDATE project_files SET relative_path = ? WHERE id = ?',
        ).run(target, row.id);
      }
      return {
        rollback: () => {
          for (const file of createdCopies) {
            try {
              unlinkSync(file);
            } catch {
              /* Preserve partial copies if cleanup is unavailable. */
            }
          }
        },
        afterCommit: () => {
          finishMoves(archive);
          for (const [folder] of oldFolders) trimEmpty(archive, folder);
          relocateLooseLegacyFiles(archive, oldFolders);
        },
      };
    } catch (error) {
      for (const file of createdCopies) {
        try {
          unlinkSync(file);
        } catch {
          /* Original paths stay authoritative on rollback. */
        }
      }
      throw error;
    }
  };
  const syncProject = (id) => {
    project(id, true);
    const archive = mapping(id);
    if (!archive) return ensureProject(id);
    db.exec('BEGIN IMMEDIATE');
    let result;
    try {
      result = syncLayoutInTransaction(archive, getWorkspace(id));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      result?.rollback();
      return ioError(error);
    }
    result.afterCommit();
    return location(archive);
  };
  const ensureInTransaction = (id, honorDefinitions = false) => {
    const info = project(id);
    const previous = mapping(id);
    if (previous) {
      const sync = syncLayoutInTransaction(previous, getWorkspace(id));
      return { archive: location(previous), ...sync };
    }
    const root = prepareRoot(getSettings().rootPath);
    const projectFolder = `${safeSegment(id)}--${safeSegment(info.name, 45)}--${randomUUID()}`;
    const projectPath = within(root, projectFolder);
    let created = false;
    try {
      assertRoot(root);
      mkdirSync(projectPath);
      created = true;

      db.prepare(
        'INSERT INTO project_file_roots (project_id, root_path, project_folder, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, root, projectFolder, new Date().toISOString());
      saveFolderPolicy(id, getWorkspace(id), honorDefinitions);
      const sync = syncLayoutInTransaction(mapping(id), getWorkspace(id));
      return {
        archive: { projectId: id, rootPath: root, projectPath },
        afterCommit: sync.afterCommit,
        rollback: () => rmSync(projectPath, { recursive: true, force: true }),
      };
    } catch (error) {
      if (created) rmSync(projectPath, { recursive: true, force: true });
      return ioError(error);
    }
  };
  const ensureProject = (id) => {
    db.exec('BEGIN IMMEDIATE');
    let rollback;
    try {
      const result = ensureInTransaction(id);
      rollback = result.rollback;
      db.exec('COMMIT');
      result.afterCommit?.();
      return result.archive;
    } catch (error) {
      db.exec('ROLLBACK');
      rollback?.();
      return ioError(error);
    }
  };
  const readRecord = (id, fileId) => {
    project(id, true);
    text(fileId, 'fileId', 100);
    const row = db
      .prepare('SELECT * FROM project_files WHERE id = ? AND project_id = ?')
      .get(fileId, id);
    if (!row) fail('Project file not found.', 404, 'FILE_NOT_FOUND');
    return row;
  };
  const store = {
    getSettings,
    /** Resolve only the saved root; callers cannot ask the API to open arbitrary paths. */
    rootFolder() {
      const root = getSettings().rootPath;
      try {
        assertRoot(root);
        return root;
      } catch (error) {
        return ioError(error);
      }
    },
    /** Follow the current archive mapping and, for a document, its recorded physical parent. */
    folder(id, fileId) {
      project(id, true);
      if (fileId) readRecord(id, fileId);
      try {
        const archive = mapping(id);
        if (!archive)
          fail(
            'Project archive folder is not available.',
            404,
            'ARCHIVE_NOT_FOUND',
          );
        if (fileId) {
          const row = readRecord(id, fileId);
          return checkedDirectory(
            archive.root_path,
            path.join(archive.project_folder, path.dirname(row.relative_path)),
          );
        }
        return checkedDirectory(archive.root_path, archive.project_folder);
      } catch (error) {
        return ioError(error);
      }
    },
    /** Delete an owned document independently of cost/workflow state, with a durable retry receipt. */
    remove(id, fileId) {
      project(id);
      text(fileId, 'fileId', 100);
      const deleted = db
        .prepare(
          'SELECT 1 FROM project_file_deletions WHERE project_id = ? AND file_id = ?',
        )
        .get(id, fileId);
      if (deleted) {
        try {
          fileRemoval.recover(mapping(id));
          return { id: fileId, deleted: true };
        } catch (error) {
          return ioError(error);
        }
      }
      readRecord(id, fileId);
      try {
        syncProject(id);
        fileRemoval.remove(mapping(id), readRecord(id, fileId));
        return { id: fileId, deleted: true };
      } catch (error) {
        return ioError(error);
      }
    },
    updateSettings(input, expectedRevision) {
      const requested = requestedFolderPath(input?.rootPath, 'rootPath');
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = getSettings();
        if (
          !Number.isInteger(expectedRevision) ||
          expectedRevision !== current.revision
        )
          fail(
            'Archive settings changed. Reload and try again.',
            409,
            'ARCHIVE_CONFLICT',
          );
        const rootPath = prepareRoot(requested);
        if (rootPath !== current.rootPath)
          db.prepare(
            'UPDATE project_file_settings SET root_path = ?, revision = revision + 1 WHERE id = 1',
          ).run(rootPath);
        db.exec('COMMIT');
        return getSettings();
      } catch (error) {
        db.exec('ROLLBACK');
        return ioError(error);
      }
    },
    ensureProject,
    syncProject,
    moveProject(id, input) {
      project(id);
      const expected = text(
        input?.expectedProjectPath,
        'expectedProjectPath',
        4096,
      );
      const requested = requestedFolderPath(input?.projectPath, 'projectPath');
      if (!path.isAbsolute(expected))
        fail(
          'The current project folder path must be absolute. Reload before moving it.',
        );
      const current = mapping(id);
      if (!current || location(current).projectPath !== expected)
        fail(
          'The project folder changed. Reload before moving it.',
          409,
          'ARCHIVE_CONFLICT',
        );
      let existingParent = path.dirname(path.resolve(requested));
      const missingParents = [];
      while (!existsSync(existingParent)) {
        const parent = path.dirname(existingParent);
        // Missing drive/UNC roots resolve to themselves; stop before the walk can loop.
        if (parent === existingParent)
          fail(
            'The destination drive or share is unavailable: ' +
              existingParent +
              '. Check that it is connected and accessible to the workbench.',
            400,
            'ARCHIVE_DESTINATION_UNAVAILABLE',
          );
        missingParents.unshift(path.basename(existingParent));
        existingParent = parent;
      }
      const destinationInput = path.join(
        realpathSync(existingParent),
        ...missingParents,
        path.basename(path.resolve(requested)),
      );
      if (destinationInput === expected) return location(current);
      const nested = (parent, child) =>
        child === parent || child.startsWith(`${parent}${path.sep}`);
      if (
        nested(expected, destinationInput) ||
        nested(destinationInput, expected)
      )
        fail(
          'The destination must be a separate project folder, without nesting.',
        );
      syncProject(id);
      db.exec('BEGIN IMMEDIATE');
      let staged;
      let result;
      try {
        project(id);
        const archive = mapping(id);
        if (location(archive).projectPath !== expected)
          fail(
            'The project folder changed. Reload before moving it.',
            409,
            'ARCHIVE_CONFLICT',
          );
        const rootPath = prepareRoot(path.dirname(destinationInput));
        const folder = path.basename(destinationInput);
        const destination = within(rootPath, folder);
        staged = stageArchiveMove(expected, destination);
        db.prepare(
          'UPDATE project_file_roots SET root_path = ?, project_folder = ? WHERE project_id = ?',
        ).run(rootPath, folder, id);
        result = { projectId: id, rootPath, projectPath: destination };
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        staged?.rollback();
        if (error.code?.startsWith('ARCHIVE_MOVE_'))
          fail(
            error.message,
            error.code === 'ARCHIVE_MOVE_IO'
              ? 500
              : error.code === 'ARCHIVE_MOVE_INVALID'
                ? 400
                : 409,
            error.code,
          );
        return ioError(error);
      }
      staged.cleanup();
      return result;
    },
    // Repository.save calls this only inside its new-project transaction.
    ensureProjectInTransaction: (id) => ensureInTransaction(id, true),
    list(id, filters = {}) {
      project(id, true);
      let archive = mapping(id);
      if (!archive) {
        ensureProject(id);
        archive = mapping(id);
      } else if (existsSync(location(archive).projectPath)) syncProject(id);
      const conditions = ['project_id = ?'];
      const values = [id];
      for (const [property, column] of [
        ['nodeCode', 'node_code'],
        ['versionCode', 'version_code'],
        ['category', 'category'],
      ]) {
        if (filters[property] !== undefined && filters[property] !== '') {
          text(filters[property], property);
          if (
            property === 'category' &&
            !PROJECT_FILE_CATEGORIES.includes(filters[property])
          )
            fail('Unknown file category.');
          conditions.push(`${column} = ?`);
          values.push(filters[property]);
        }
      }
      return {
        ...location(archive),
        ...(filters.category === 'workflow' && filters.nodeCode
          ? {
              uploadFolder: path.join(
                ...physicalParts(
                  'workflow',
                  filters.versionCode,
                  nodeLabels(getWorkspace(id)).get(filters.nodeCode) ||
                    filters.nodeCode,
                  hasNodeFolder(archive, filters.nodeCode),
                ),
              ),
            }
          : {}),
        files: db
          .prepare(
            `SELECT * FROM project_files WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC`,
          )
          .all(...values)
          .map(mapRecord),
      };
    },
    add(id, input) {
      project(id);
      if (!input || typeof input !== 'object') fail('File input is required.');
      if (
        !Buffer.isBuffer(input.buffer) &&
        !(input.buffer instanceof Uint8Array)
      )
        fail('File bytes are required.');
      if (input.buffer.byteLength > MAX_PROJECT_FILE_BYTES)
        fail('Each file must be 50 MiB or smaller.', 413, 'FILE_TOO_LARGE');
      const buffer = Buffer.from(input.buffer);
      const originalName = normalizedFilename(input.originalName);
      const mimeType = input.mimeType
        ? text(input.mimeType, 'mimeType', 200)
        : 'application/octet-stream';
      const category = input.category || 'general';
      if (!PROJECT_FILE_CATEGORIES.includes(category))
        fail('Unknown file category.');
      const nodeCode = input.nodeCode ? text(input.nodeCode, 'nodeCode') : '';
      const explicitVersion = input.versionCode
        ? text(input.versionCode, 'versionCode', 80)
        : '';
      const requestId = input.requestId
        ? text(input.requestId, 'requestId', 120)
        : null;
      if (requestId && !/^[A-Za-z0-9._:-]+$/.test(requestId))
        fail('requestId contains unsupported characters.');
      const sha256 = hash(buffer);
      db.exec('BEGIN IMMEDIATE');
      let rollbackProject, createdFile;
      try {
        project(id);
        const workspace = JSON.parse(
          db
            .prepare(
              'SELECT payload_json FROM workspace_snapshots WHERE project_id = ?',
            )
            .get(id).payload_json,
        );
        const versionCode =
          explicitVersion ||
          (category === 'workflow'
            ? workspace.workflowVersion || workspace.activeVersion
            : '');
        const fingerprint = hash(
          JSON.stringify({
            originalName,
            mimeType,
            category,
            nodeCode,
            versionCode,
            sha256,
          }),
        );
        if (requestId) {
          if (
            db
              .prepare(
                'SELECT 1 FROM project_file_deletions WHERE project_id = ? AND request_id = ?',
              )
              .get(id, requestId)
          )
            fail(
              'This upload was deleted. Select the file again to create a new upload.',
              409,
              'FILE_DELETED',
            );
          const existing = db
            .prepare(
              'SELECT * FROM project_files WHERE project_id = ? AND request_id = ?',
            )
            .get(id, requestId);
          if (existing) {
            if (existing.request_fingerprint !== fingerprint)
              fail(
                'This upload requestId was already used for a different file or destination.',
                409,
                'ARCHIVE_CONFLICT',
              );
            db.exec('COMMIT');
            return mapRecord(existing);
          }
        }
        if (
          versionCode &&
          !workspace.costVersions.some(
            (version) => version.code === versionCode,
          )
        )
          fail('The selected cost version does not exist.');
        let nodeName = '';
        if (category === 'workflow') {
          if (!nodeCode) fail('Workflow files require a nodeCode.');
          const round =
            versionCode ===
            (workspace.workflowVersion || workspace.activeVersion)
              ? workspace
              : workspace.versionWorkflows?.[versionCode];
          const node = round?.processSteps?.find(
            (step) => step.code === nodeCode,
          );
          if (!node)
            fail(
              'The selected workflow node does not belong to this cost version.',
            );
          nodeName = node.name || node.nameZh || nodeCode;
        } else if (nodeCode) fail('nodeCode is only valid for workflow files.');
        const result = ensureInTransaction(id);
        rollbackProject = result.rollback;
        const archived = mapping(id);
        const parts = physicalParts(
          category,
          versionCode,
          nodeName,
          hasNodeFolder(archived, nodeCode),
        );
        const directoryRelative = path.join(archived.project_folder, ...parts);
        checkedDirectory(archived.root_path, directoryRelative, true);
        const fileId = randomUUID();
        const relativePath = path.join(
          ...parts,
          `${fileId}--${safeSegment(originalName, 130)}`,
        );
        const absolute = within(result.archive.projectPath, relativePath);
        const fd = openSync(
          absolute,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        createdFile = absolute;
        try {
          checkedDirectory(archived.root_path, directoryRelative);
          if (realpathSync(absolute) !== absolute)
            fail('The archive file path changed.', 409, 'ARCHIVE_PATH_CHANGED');
          writeFileSync(fd, buffer);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const createdAt = new Date().toISOString();
        db.prepare(
          `INSERT INTO project_files (id, project_id, original_name, mime_type, size_bytes, sha256, created_at, category, node_code, node_name, version_code, relative_path, request_id, request_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          fileId,
          id,
          originalName,
          mimeType,
          buffer.length,
          sha256,
          createdAt,
          category,
          nodeCode || null,
          nodeName || null,
          versionCode || null,
          relativePath,
          requestId,
          fingerprint,
        );
        db.exec('COMMIT');
        result.afterCommit?.();
        return mapRecord(readRecord(id, fileId));
      } catch (error) {
        db.exec('ROLLBACK');
        if (createdFile) {
          try {
            unlinkSync(createdFile);
          } catch {
            /* An incomplete archive is never registered. */
          }
        }
        rollbackProject?.();
        return ioError(error);
      }
    },
    read(id, fileId) {
      readRecord(id, fileId);
      if (existsSync(location(mapping(id)).projectPath)) syncProject(id);
      const row = readRecord(id, fileId);
      const archived = mapping(id);
      let fd;
      try {
        const directory = path.join(
          archived.project_folder,
          path.dirname(row.relative_path),
        );
        checkedDirectory(archived.root_path, directory);
        const absolute = within(
          within(archived.root_path, archived.project_folder),
          row.relative_path,
        );
        fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        checkedDirectory(archived.root_path, directory);
        if (realpathSync(absolute) !== absolute)
          fail('The archive file path changed.', 409, 'ARCHIVE_PATH_CHANGED');
        const stat = fstatSync(fd);
        if (
          !stat.isFile() ||
          stat.size !== row.size_bytes ||
          stat.size > MAX_PROJECT_FILE_BYTES
        )
          fail('The archived file size changed.', 409, 'FILE_INTEGRITY');
        const buffer = readFileSync(fd);
        if (hash(buffer) !== row.sha256)
          fail('The archived file content changed.', 409, 'FILE_INTEGRITY');
        return { record: mapRecord(row), buffer };
      } catch (error) {
        if (error.code === 'ELOOP')
          fail(
            'The archive file is a symbolic link.',
            409,
            'ARCHIVE_PATH_CHANGED',
          );
        if (error.code === 'ENOENT')
          fail(
            'The archived file is missing from disk. Restore the project folder from backup.',
            404,
            'FILE_CONTENT_MISSING',
          );
        return ioError(error);
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    },
    close() {
      if (temporaryRoot)
        rmSync(temporaryRoot, { recursive: true, force: true });
    },
  };
  return store;
};
