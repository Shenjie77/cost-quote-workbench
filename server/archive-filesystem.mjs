/** Platform-specific durability for archive directory metadata. */
import { constants, closeSync, fsyncSync, openSync } from 'node:fs';

/**
 * Flush directory metadata on POSIX after archive content has been written.
 * Windows fsync uses FlushFileBuffers, which requires a writable file handle;
 * it cannot flush the read-only directory handle used for POSIX durability.
 * Callers must still flush written files and verify content on every platform.
 */
export function syncArchiveDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(
    directory,
    constants.O_RDONLY |
      (constants.O_DIRECTORY || 0) |
      (constants.O_NOFOLLOW || 0),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
