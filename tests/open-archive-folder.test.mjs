import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  archiveFolderOpenCommand,
  openArchiveFolder,
} from '../server/open-archive-folder.mjs';

/** Represent an existing regular directory without touching the user's filesystem. */
const directoryStat = () => ({
  isDirectory: () => true,
  isSymbolicLink: () => false,
});

/** Simulate launcher events and capture arguments; this fixture never spawns a real process. */
function launcher(events = []) {
  const child = new EventEmitter();
  child.unrefCount = 0;
  child.unref = () => {
    child.unrefCount += 1;
  };
  child.kill = () => {
    throw new Error('A file manager must never be killed.');
  };
  const calls = [];
  const spawnProcess = (...args) => {
    calls.push(args);
    queueMicrotask(() => {
      for (const event of events) child.emit(...event);
    });
    return child;
  };
  return { child, calls, spawnProcess };
}

test('platform launchers keep spaces and special characters in one literal folder argument', () => {
  const windowsPath = String.raw`D:\QuotePlatform\Test Project & (客户), 100%`;
  assert.deepEqual(archiveFolderOpenCommand(windowsPath, 'win32'), {
    command: 'explorer.exe',
    args: [windowsPath],
  });
  const posixPath = '/Users/example/Client $(literal); & "quotes".app';
  assert.deepEqual(archiveFolderOpenCommand(posixPath, 'darwin'), {
    command: '/usr/bin/open',
    args: ['-a', 'Finder', '--', posixPath],
  });
  assert.deepEqual(archiveFolderOpenCommand(posixPath, 'linux'), {
    command: 'xdg-open',
    args: [posixPath],
  });
});

test('relative paths, URLs, drive-relative paths and control characters cannot become launch commands', () => {
  for (const [folder, platform] of [
    ['relative/folder', 'linux'],
    ['file:///tmp/folder', 'darwin'],
    ['https://example.com', 'linux'],
    ['C:relative', 'win32'],
    ['\\relative', 'win32'],
    ['/tmp/folder\u0000', 'linux'],
  ])
    assert.throws(
      () => archiveFolderOpenCommand(folder, platform),
      (error) => error.code === 'ARCHIVE_PATH_INVALID',
    );
  assert.throws(
    () => archiveFolderOpenCommand('/tmp/folder', 'freebsd'),
    (error) =>
      error.code === 'ARCHIVE_OPEN_UNSUPPORTED' && error.status === 501,
  );
});

test('Windows confirms Explorer startup without waiting for a long-lived window process', async () => {
  const process = launcher([['spawn']]);
  const folder = String.raw`D:\QuotePlatform\Test Project`;
  assert.deepEqual(
    await openArchiveFolder(folder, {
      platform: 'win32',
      stat: directoryStat,
      spawnProcess: process.spawnProcess,
    }),
    { opened: true },
  );
  assert.deepEqual(process.calls, [
    [
      'explorer.exe',
      [folder],
      { shell: false, detached: true, stdio: 'ignore', windowsHide: true },
    ],
  ]);
  assert.equal(process.child.unrefCount, 1);
  process.child.emit('exit', 1, null);
  assert.equal(
    process.child.unrefCount,
    1,
    'later Explorer events must not settle twice',
  );
});

test('macOS and Linux wait for successful launcher exit rather than reporting spawn as success', async () => {
  for (const platform of ['darwin', 'linux']) {
    const process = launcher([['spawn']]);
    let settled = false;
    const pending = openArchiveFolder('/tmp/Customer Project', {
      platform,
      stat: directoryStat,
      spawnProcess: process.spawnProcess,
    }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    process.child.emit('exit', 0, null);
    assert.deepEqual(await pending, { opened: true });
    assert.equal(process.child.unrefCount, 1);
  }
});

test('missing launchers and synchronous spawn failures reject promptly', async () => {
  const missing = Object.assign(new Error('not installed'), { code: 'ENOENT' });
  for (const spawnProcess of [
    launcher([
      ['error', missing],
      ['exit', -2, null],
    ]).spawnProcess,
    () => {
      throw missing;
    },
  ])
    await assert.rejects(
      openArchiveFolder('/tmp/folder', {
        platform: 'linux',
        stat: directoryStat,
        spawnProcess,
      }),
      (error) =>
        error.code === 'ARCHIVE_OPEN_FAILED' && /ENOENT/.test(error.message),
    );
});

test('launcher exit failures, including absent GUI sessions, do not report success', async () => {
  for (const event of [
    ['exit', 4, null],
    ['exit', null, 'SIGTERM'],
  ]) {
    const process = launcher([['spawn'], event]);
    await assert.rejects(
      openArchiveFolder('/tmp/folder', {
        platform: 'linux',
        stat: directoryStat,
        spawnProcess: process.spawnProcess,
      }),
      (error) => error.code === 'ARCHIVE_OPEN_FAILED',
    );
    assert.equal(process.child.unrefCount, 1);
  }
});

test('missing paths, ordinary files and symlinks fail before a launcher can run', async () => {
  const process = launcher([['spawn']]);
  for (const stat of [
    () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    () => ({ isDirectory: () => false, isSymbolicLink: () => false }),
    () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
  ])
    await assert.rejects(
      openArchiveFolder('/tmp/folder', {
        platform: 'linux',
        stat,
        spawnProcess: process.spawnProcess,
      }),
      (error) =>
        ['ARCHIVE_OPEN_UNAVAILABLE', 'ARCHIVE_PATH_INVALID'].includes(
          error.code,
        ),
    );
  assert.deepEqual(process.calls, []);
});

test('a stalled launcher times out without killing it and handles a delayed error safely', async () => {
  const process = launcher();
  await assert.rejects(
    openArchiveFolder('/tmp/folder', {
      platform: 'linux',
      stat: directoryStat,
      spawnProcess: process.spawnProcess,
      timeoutMs: 10,
    }),
    (error) => error.code === 'ARCHIVE_OPEN_TIMEOUT' && error.status === 504,
  );
  assert.equal(process.child.unrefCount, 1);
  assert.doesNotThrow(() =>
    process.child.emit(
      'error',
      Object.assign(new Error('delayed failure'), { code: 'ENOENT' }),
    ),
  );
  assert.equal(process.child.unrefCount, 1);
});
