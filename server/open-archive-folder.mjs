/** Open a verified archive directory on the local API host without invoking a shell. */
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';

/** Carry actionable launcher failures through the local API's normal error envelope. */
export class ArchiveFolderOpenError extends Error {
  constructor(message, status = 500, code = 'ARCHIVE_OPEN_FAILED') {
    super(message);
    this.name = 'ArchiveFolderOpenError';
    this.status = status;
    this.code = code;
  }
}

/** Build fixed platform commands, keeping the complete directory in one argument. */
export function archiveFolderOpenCommand(
  absoluteDirectory,
  platform = process.platform,
) {
  const nativePath = platform === 'win32' ? path.win32 : path.posix;
  if (
    typeof absoluteDirectory !== 'string' ||
    !nativePath.isAbsolute(absoluteDirectory) ||
    (platform === 'win32' &&
      !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(absoluteDirectory)) ||
    Array.from(absoluteDirectory).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new ArchiveFolderOpenError(
      'The archive folder must be an absolute directory on this computer.',
      400,
      'ARCHIVE_PATH_INVALID',
    );
  switch (platform) {
    case 'win32':
      return { command: 'explorer.exe', args: [absoluteDirectory] };
    case 'darwin':
      // Target Finder explicitly so even a directory ending in .app is browsed.
      return {
        command: '/usr/bin/open',
        args: ['-a', 'Finder', '--', absoluteDirectory],
      };
    case 'linux':
      return { command: 'xdg-open', args: [absoluteDirectory] };
    default:
      throw new ArchiveFolderOpenError(
        'Opening archive folders is supported on Windows, macOS and Linux desktop sessions.',
        501,
        'ARCHIVE_OPEN_UNSUPPORTED',
      );
  }
}

/** Describe process startup failures without exposing command text as executable input. */
function launchError(cause) {
  return new ArchiveFolderOpenError(
    `The file manager could not be started (${cause?.code || 'process error'}). Check the desktop session and file manager on the computer running the workbench.`,
  );
}

/**
 * Submit an open request for an existing directory, never creating files or folders.
 * Explorer may remain running, so Windows confirms process startup. macOS/Linux
 * launchers confirm their exit status. Success acknowledges dispatch, not visible UI.
 * Dependencies allow tests to simulate platforms and process events without opening windows.
 */
export async function openArchiveFolder(
  absoluteDirectory,
  {
    platform = process.platform,
    stat = lstatSync,
    spawnProcess = spawn,
    timeoutMs = 5000,
  } = {},
) {
  const { command, args } = archiveFolderOpenCommand(
    absoluteDirectory,
    platform,
  );
  try {
    const entry = stat(absoluteDirectory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new ArchiveFolderOpenError(
        'The archive path is not a regular directory.',
        400,
        'ARCHIVE_PATH_INVALID',
      );
  } catch (cause) {
    if (cause instanceof ArchiveFolderOpenError) throw cause;
    throw new ArchiveFolderOpenError(
      `The archive folder cannot be accessed (${cause?.code || 'filesystem error'}). Check its location and permissions.`,
      cause?.code === 'ENOENT' ? 404 : 500,
      'ARCHIVE_OPEN_UNAVAILABLE',
    );
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command, args, {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (cause) {
      reject(launchError(cause));
      return;
    }
    let settled = false;
    // Keep error listeners attached after a timeout to absorb a delayed spawn error;
    // never kill a file manager that may already have opened the requested window.
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      if (error) reject(error);
      else resolve({ opened: true });
    };
    const timer = setTimeout(
      () =>
        finish(
          new ArchiveFolderOpenError(
            'The file manager did not confirm the open request in time. Check the desktop on the computer running the workbench.',
            504,
            'ARCHIVE_OPEN_TIMEOUT',
          ),
        ),
      timeoutMs,
    );
    child.once('error', (cause) => finish(launchError(cause)));
    if (platform === 'win32') child.once('spawn', () => finish());
    child.once('exit', (code, signal) => {
      if (code === 0) finish();
      else
        finish(
          new ArchiveFolderOpenError(
            `The file manager could not open the archive folder (${signal ? `signal ${signal}` : `exit ${code}`}). Check the desktop session on the computer running the workbench.`,
          ),
        );
    });
  });
}
