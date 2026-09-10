/** Crash-recoverable document deletion with an exclusive copy before source removal. */
import {
  constants,
  closeSync,
  copyFileSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { syncArchiveDirectory } from './archive-filesystem.mjs';

/** Preserve structured deletion failures for the local file API. */
export class ProjectFileRemovalError extends Error {
  constructor(message, status = 500, code = 'FILE_DELETE_FAILED') {
    super(message);
    this.name = 'ProjectFileRemovalError';
    this.status = status;
    this.code = code;
  }
}

/** Read link metadata without treating dangling links as missing paths. */
function entryAt(filename) {
  try {
    return lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Exclude access time because reading and hashing must not invalidate an identity check. */
function sameFile(left, right) {
  return (
    left &&
    right &&
    ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(
      (field) => left[field] === right[field],
    )
  );
}

/** Use a deterministic name so an uncommitted deletion can be recovered from the original row. */
function stagedRelative(row) {
  if (!/^[a-z\d_-]+$/i.test(row.id || ''))
    throw new ProjectFileRemovalError(
      'The document ID cannot identify a safe recovery file.',
      400,
      'FILE_VALIDATION',
    );
  return path.join(path.dirname(row.relative_path), `.deleted-${row.id}`);
}

/**
 * The store supplies its existing containment and content verification functions.
 * remove owns its transaction; recover can reuse an archive layout transaction.
 * Tombstones remain after physical cleanup to make retries and upload IDs stable.
 */
export function createProjectFileRemoval({ db, location, verifyFile, within }) {
  /** Recheck the mapping under the write lock before touching a possibly stale archive copy. */
  const verifyArchiveMapping = (archive) => {
    const current = db
      .prepare(
        'SELECT root_path, project_folder FROM project_file_roots WHERE project_id = ?',
      )
      .get(archive.project_id);
    if (
      !current ||
      current.root_path !== archive.root_path ||
      current.project_folder !== archive.project_folder
    )
      throw new ProjectFileRemovalError(
        'The project folder changed. Reload the archive before retrying.',
        409,
        'ARCHIVE_CONFLICT',
      );
  };

  /** Resolve only project-relative paths through the store's established boundary. */
  const absolutePath = (archive, relative) =>
    within(location(archive).projectPath, relative);

  /** Ensure a parent cannot redirect an exclusive copy through a directory link. */
  const checkedParent = (filename) => {
    const parent = path.dirname(filename);
    const entry = lstatSync(parent);
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      realpathSync(parent) !== path.resolve(parent)
    )
      throw new ProjectFileRemovalError(
        'The document folder changed or contains a symbolic link.',
        409,
        'ARCHIVE_PATH_CHANGED',
      );
    return parent;
  };

  /** Verify bytes and stable file identity before destructive operations. */
  const verifiedEntry = (archive, relative, row, expected) => {
    const filename = absolutePath(archive, relative);
    checkedParent(filename);
    const before = lstatSync(filename);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (expected && !sameFile(before, expected))
    )
      throw new ProjectFileRemovalError(
        'The document changed during deletion; its files were preserved.',
        409,
        'FILE_INTEGRITY',
      );
    verifyFile(archive, relative, row.sha256, row.size_bytes);
    const after = lstatSync(filename);
    if (!sameFile(before, after))
      throw new ProjectFileRemovalError(
        'The document changed during deletion; its files were preserved.',
        409,
        'FILE_INTEGRITY',
      );
    return after;
  };

  /** Flush a verified survivor before removing its only backup, including resumed copies. */
  const flushVerified = (archive, relative, row) => {
    const target = absolutePath(archive, relative);
    const parent = checkedParent(target);
    const copied = verifiedEntry(archive, relative, row);
    const fd = openSync(
      target,
      (process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY) |
        (constants.O_NOFOLLOW || 0),
    );
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    verifiedEntry(archive, relative, row, copied);
    syncArchiveDirectory(parent);
    return copied;
  };

  /** Copy exclusively and flush verified destination bytes before either source can disappear. */
  const copyVerified = (archive, sourceRelative, targetRelative, row) => {
    const source = absolutePath(archive, sourceRelative);
    const target = absolutePath(archive, targetRelative);
    verifiedEntry(archive, sourceRelative, row);
    checkedParent(target);
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    return flushVerified(archive, targetRelative, row);
  };

  /** Remove only the verified document currently occupying this exact path. */
  const removeVerified = (archive, relative, row, expected) => {
    verifiedEntry(archive, relative, row, expected);
    const filename = absolutePath(archive, relative);
    unlinkSync(filename);
    syncArchiveDirectory(path.dirname(filename));
  };

  /** Restore an interrupted uncommitted deletion without overwriting a later file. */
  const restoreOriginal = (archive, row) => {
    const staged = stagedRelative(row);
    if (!entryAt(absolutePath(archive, staged))) return false;
    verifiedEntry(archive, staged, row);
    if (!entryAt(absolutePath(archive, row.relative_path)))
      copyVerified(archive, staged, row.relative_path, row);
    // If another file now occupies the original name, preserve both copies on mismatch.
    flushVerified(archive, row.relative_path, row);
    removeVerified(archive, staged, row);
    return true;
  };

  /** Clean committed recovery copies only; a subsequently reused original path is never touched. */
  const cleanDeleted = (archive, receipt) => {
    const row = {
      id: receipt.file_id,
      relative_path: receipt.relative_path,
      sha256: receipt.sha256,
      size_bytes: receipt.size_bytes,
    };
    if (receipt.staged_path !== stagedRelative(row))
      throw new ProjectFileRemovalError(
        'The deletion recovery path does not match its document.',
        409,
        'FILE_INTEGRITY',
      );
    if (!entryAt(absolutePath(archive, receipt.staged_path))) return false;
    removeVerified(archive, receipt.staged_path, row);
    return true;
  };

  /** Recover uncertain files while the caller holds the archive database write lock. */
  const recoverLocked = (archive) => {
    verifyArchiveMapping(archive);
    const result = { restored: [], cleaned: [], pending: [] };
    for (const row of db
      .prepare('SELECT * FROM project_files WHERE project_id = ?')
      .all(archive.project_id)) {
      try {
        if (restoreOriginal(archive, row)) result.restored.push(row.id);
      } catch {
        result.pending.push(row.id);
      }
    }
    for (const receipt of db
      .prepare('SELECT * FROM project_file_deletions WHERE project_id = ?')
      .all(archive.project_id)) {
      try {
        // A live record remains authoritative if inconsistent external database changes exist.
        if (
          db
            .prepare('SELECT 1 FROM project_files WHERE id = ?')
            .get(receipt.file_id)
        )
          continue;
        if (cleanDeleted(archive, receipt))
          result.cleaned.push(receipt.file_id);
      } catch {
        result.pending.push(receipt.file_id);
      }
    }
    return result;
  };

  /** Acquire the deletion lock unless the caller already owns the surrounding archive transaction. */
  const recover = (archive, { withinTransaction = false } = {}) => {
    if (withinTransaction) return recoverLocked(archive);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = recoverLocked(archive);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  /** Delete one indexed document atomically; physical cleanup can resume after commit. */
  const remove = (archive, row) => {
    if (row.project_id !== archive.project_id)
      throw new ProjectFileRemovalError(
        'Document not found in this project.',
        404,
        'FILE_NOT_FOUND',
      );
    const staged = stagedRelative(row);
    let transaction = false;
    let stageCreated = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      transaction = true;
      verifyArchiveMapping(archive);
      // Another process may have completed the same deletion before this lock was acquired.
      const previous = db
        .prepare(
          'SELECT * FROM project_file_deletions WHERE file_id = ? AND project_id = ?',
        )
        .get(row.id, archive.project_id);
      if (previous) {
        try {
          cleanDeleted(archive, previous);
        } catch {
          /* Recovery retries cleanup on the next archive access. */
        }
        db.exec('COMMIT');
        transaction = false;
        return { id: row.id, deleted: true };
      }
      const current = db
        .prepare('SELECT * FROM project_files WHERE id = ? AND project_id = ?')
        .get(row.id, archive.project_id);
      if (
        !current ||
        ['relative_path', 'sha256', 'size_bytes'].some(
          (field) => current[field] !== row[field],
        )
      )
        throw new ProjectFileRemovalError(
          'The document changed. Reload the file list before deleting it.',
          409,
          'FILE_DELETE_CONFLICT',
        );
      if (entryAt(absolutePath(archive, staged)))
        throw new ProjectFileRemovalError(
          'A recovery file already exists for this document. Reload the archive before retrying.',
          409,
          'FILE_DELETE_RECOVERY_REQUIRED',
        );
      const source = verifiedEntry(archive, row.relative_path, row);
      db.prepare(
        'INSERT INTO project_file_deletions (file_id, project_id, relative_path, staged_path, sha256, size_bytes, request_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        row.id,
        archive.project_id,
        row.relative_path,
        staged,
        row.sha256,
        row.size_bytes,
        current.request_id || null,
        new Date().toISOString(),
      );
      const copy = copyVerified(archive, row.relative_path, staged, row);
      stageCreated = true;
      verifiedEntry(archive, staged, row, copy);
      removeVerified(archive, row.relative_path, row, source);
      const deleted = db
        .prepare('DELETE FROM project_files WHERE id = ? AND project_id = ?')
        .run(row.id, archive.project_id);
      if (deleted.changes !== 1)
        throw new ProjectFileRemovalError(
          'The document record could not be deleted. Its original file will be restored.',
          409,
          'FILE_DELETE_CONFLICT',
        );
      db.exec('COMMIT');
      transaction = false;
    } catch (cause) {
      if (transaction) {
        try {
          db.exec('ROLLBACK');
        } catch {
          throw new ProjectFileRemovalError(
            'The deletion transaction could not be rolled back. Its recovery files were preserved; reopen the archive before retrying.',
            500,
            'FILE_DELETE_RECOVERY_REQUIRED',
          );
        }
      }
      let recoveryFailed = false;
      if (stageCreated) {
        try {
          restoreOriginal(archive, row);
        } catch {
          recoveryFailed = true;
        }
      }
      if (recoveryFailed)
        throw new ProjectFileRemovalError(
          'The document could not be deleted. Its recovery copy was preserved; reload the archive to retry recovery.',
          409,
          'FILE_DELETE_RECOVERY_REQUIRED',
        );
      if (cause instanceof ProjectFileRemovalError) throw cause;
      throw new ProjectFileRemovalError(
        `The document could not be deleted (${cause.code || 'filesystem or database error'}). Its original or recovery copy was preserved.`,
      );
    }
    try {
      cleanDeleted(archive, {
        file_id: row.id,
        relative_path: row.relative_path,
        staged_path: staged,
        sha256: row.sha256,
        size_bytes: row.size_bytes,
      });
    } catch {
      /* The committed receipt makes delayed physical cleanup safe and repeatable. */
    }
    return { id: row.id, deleted: true };
  };

  return { remove, recover, stagedRelative };
}
