/** Copy-first archive relocation. The caller commits the DB mapping before cleanup. */
import { createHash } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { syncArchiveDirectory } from './archive-filesystem.mjs';

const fail = (message, code = 'ARCHIVE_MOVE_INVALID') => {
  const error = new Error(message);
  error.code = code;
  throw error;
};
const identity = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  size: stat.size,
  mtimeMs: stat.mtimeMs,
  ctimeMs: stat.ctimeMs,
});
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};
const checkedDirectory = (directory) => {
  const resolved = path.resolve(directory);
  const stat = lstatSync(resolved);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(resolved) !== resolved
  )
    fail(
      `Archive path is not a regular directory or contains a symbolic link: ${resolved}`,
    );
  return stat;
};
const openRegularFile = (file, expected) => {
  const descriptor = openSync(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  const stat = fstatSync(descriptor);
  if (!stat.isFile() || !sameIdentity(stat, expected)) {
    closeSync(descriptor);
    fail(
      `Archive file changed while it was being read: ${file}`,
      'ARCHIVE_MOVE_CHANGED',
    );
  }
  return descriptor;
};
const readHash = (file, stat, destination) => {
  const descriptor = openRegularFile(file, stat);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let output;
  try {
    if (destination)
      output = openSync(
        destination,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
    let bytes;
    while (
      (bytes = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0
    ) {
      hash.update(buffer.subarray(0, bytes));
      if (output !== undefined) {
        let written = 0;
        while (written < bytes) {
          const count = writeSync(output, buffer, written, bytes - written);
          if (count === 0)
            fail(
              'Archive destination stopped accepting data.',
              'ARCHIVE_MOVE_IO',
            );
          written += count;
        }
      }
    }
    if (!equal(identity(fstatSync(descriptor)), identity(stat)))
      fail(
        `Archive file changed during copying: ${file}`,
        'ARCHIVE_MOVE_CHANGED',
      );
    if (output !== undefined) fsyncSync(output);
    return hash.digest('hex');
  } finally {
    if (output !== undefined) closeSync(output);
    closeSync(descriptor);
  }
};
const snapshot = (root) => {
  const entries = [];
  const visit = (relative) => {
    const absolute = path.join(root, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      fail(
        `Archive contains an unsupported file or symbolic link: ${absolute}`,
      );
    if (stat.isDirectory()) {
      checkedDirectory(absolute);
      entries.push({ relative, type: 'directory', ...identity(stat) });
      for (const name of readdirSync(absolute).sort())
        visit(path.join(relative, name));
    } else
      entries.push({
        relative,
        type: 'file',
        ...identity(stat),
        sha256: readHash(absolute, stat),
      });
  };
  visit('');
  return entries;
};
const contentSnapshot = (entries) =>
  entries.map(({ relative, type, size, sha256 }) => ({
    relative,
    type,
    ...(type === 'file' ? { size, sha256 } : {}),
  }));
const matches = (root, expected) => {
  try {
    return equal(snapshot(root), expected);
  } catch {
    return false;
  }
};
/** Remove only verified owned entries. Never recurse through unrecognized files. */
const removeVerified = (root, expected) => {
  if (!matches(root, expected)) return false;
  try {
    for (const entry of [...expected].reverse()) {
      const absolute = path.join(root, entry.relative);
      const stat = lstatSync(absolute);
      if (!sameIdentity(stat, entry) || stat.isSymbolicLink()) return false;
      if (entry.type === 'file') {
        if (
          !equal(identity(stat), identity(entry)) ||
          readHash(absolute, stat) !== entry.sha256
        )
          return false;
        unlinkSync(absolute);
      } else {
        if (!stat.isDirectory() || readdirSync(absolute).length !== 0)
          return false;
        rmdirSync(absolute);
      }
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Stage a verified copy at a new exclusive destination, including unindexed files.
 * rollback() removes only an unchanged staged copy. cleanup() preserves the source
 * whenever either copy has changed since staging. Both operations are idempotent.
 */
export function stageArchiveMove(sourceAbsolute, destAbsolute) {
  if (
    typeof sourceAbsolute !== 'string' ||
    typeof destAbsolute !== 'string' ||
    !path.isAbsolute(sourceAbsolute) ||
    !path.isAbsolute(destAbsolute)
  )
    fail('Archive move requires absolute source and destination paths.');
  const source = path.resolve(sourceAbsolute);
  const destination = path.resolve(destAbsolute);
  if (isWithin(source, destination) || isWithin(destination, source))
    fail('Source and destination must be separate folders, without nesting.');
  checkedDirectory(source);
  checkedDirectory(path.dirname(destination));
  // lstat also catches dangling symlinks that existsSync would miss.
  try {
    lstatSync(destination);
    fail(
      `Destination already exists; choose a new folder: ${destination}`,
      'ARCHIVE_MOVE_EXISTS',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const original = snapshot(source);
  let staged;
  let destinationIdentity;
  try {
    mkdirSync(destination, { mode: 0o700 });
    destinationIdentity = identity(lstatSync(destination));
    for (const entry of original) {
      if (entry.relative === '') continue;
      const target = path.join(destination, entry.relative);
      if (entry.type === 'directory') mkdirSync(target, { mode: 0o700 });
      else {
        const current = lstatSync(path.join(source, entry.relative));
        if (!equal(identity(current), identity(entry)))
          fail(
            `Archive source changed before copying: ${entry.relative}`,
            'ARCHIVE_MOVE_CHANGED',
          );
        const copiedHash = readHash(
          path.join(source, entry.relative),
          current,
          target,
        );
        if (copiedHash !== entry.sha256)
          fail(
            `Archive source changed while copying: ${entry.relative}`,
            'ARCHIVE_MOVE_CHANGED',
          );
      }
    }
    staged = snapshot(destination);
    if (
      !sameIdentity(staged[0], destinationIdentity) ||
      !matches(source, original) ||
      !equal(contentSnapshot(original), contentSnapshot(staged))
    )
      fail(
        'Archive changed during copying. The original folder was preserved.',
        'ARCHIVE_MOVE_CHANGED',
      );
    for (const entry of [...staged].reverse())
      if (entry.type === 'directory')
        syncArchiveDirectory(path.join(destination, entry.relative));
    syncArchiveDirectory(path.dirname(destination));
  } catch (error) {
    // A failed stage may include another process's changes. Preserve that copy
    // for inspection; rollback is available only after a fully verified stage.
    if (error.code === 'EEXIST')
      fail(
        `Destination already exists; choose a new folder: ${destination}`,
        'ARCHIVE_MOVE_EXISTS',
      );
    if (!error.code?.startsWith('ARCHIVE_MOVE_'))
      fail(
        `Unable to copy archive (${error.code || error.message}). Source preserved at ${source}; inspect any incomplete destination at ${destination}.`,
        'ARCHIVE_MOVE_IO',
      );
    throw error;
  }
  let destinationRemoved = false;
  let sourceRemoved = false;
  let cleanupStarted = false;
  return {
    rollback() {
      if (cleanupStarted) return { destinationRemoved: false };
      if (destinationRemoved) return { destinationRemoved: true };
      destinationRemoved = removeVerified(destination, staged);
      return { destinationRemoved };
    },
    cleanup() {
      cleanupStarted = true;
      if (sourceRemoved) return { sourceRemoved: true };
      if (destinationRemoved || !matches(destination, staged))
        return { sourceRemoved: false };
      sourceRemoved = removeVerified(source, original);
      return { sourceRemoved };
    },
  };
}
