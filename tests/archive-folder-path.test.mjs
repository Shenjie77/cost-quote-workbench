import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeArchiveFolderPath } from '../server/archive-folder-path.mjs';

const posix = { platform: 'darwin', homeDirectory: '/Users/example' };
const windows = { platform: 'win32', homeDirectory: 'C:\\Users\\example' };

test('reported D drive project path retains its spaces and separators on Windows', () => {
  const destination = String.raw`D:\QuotePlatform\Test Project`;
  for (const input of [
    destination,
    '"' + destination + '"',
    'D:/QuotePlatform/Test Project',
    'file:///D:/QuotePlatform/Test%20Project',
  ])
    assert.equal(normalizeArchiveFolderPath(input, windows), destination);
});

test('pasted quotes, file URLs and home paths resolve to the intended local folder', () => {
  for (const input of [
    '/Users/example/Customer Project',
    '  "/Users/example/Customer Project"  ',
    "'/Users/example/Customer Project'",
    '“/Users/example/Customer Project”',
    'file:///Users/example/Customer%20Project',
    'file://localhost/Users/example/Customer%20Project',
    '~/Customer Project',
    '/Users/example/Customer\\ Project',
  ])
    assert.equal(
      normalizeArchiveFolderPath(input, posix),
      '/Users/example/Customer Project',
    );
  assert.equal(normalizeArchiveFolderPath('~', posix), '/Users/example');
});

test('clipboard parsing preserves Unicode, URL-sensitive names and literal quoted backslashes', () => {
  assert.equal(
    normalizeArchiveFolderPath(
      'file:///Users/example/%E5%AE%A2%E6%88%B7%20A%23B%25C',
      posix,
    ),
    '/Users/example/客户 A#B%C',
  );
  assert.equal(
    normalizeArchiveFolderPath(
      '/Users/example/Customer\\ \\(A\\)\\ \\&\\ B',
      posix,
    ),
    '/Users/example/Customer (A) & B',
  );
  assert.equal(
    normalizeArchiveFolderPath("'/Users/example/keep\\ space'", posix),
    '/Users/example/keep\\ space',
  );
  assert.equal(
    normalizeArchiveFolderPath('/Users/example/$(literal-name)', posix),
    '/Users/example/$(literal-name)',
  );
});

test('Windows paths require a Windows host and keep drive and UNC separators', () => {
  for (const input of [
    'C:\\Projects\\Customer A',
    'C:/Projects/Customer A',
    '"C:\\Projects\\Customer A"',
    'file:///C:/Projects/Customer%20A',
  ])
    assert.equal(
      normalizeArchiveFolderPath(input, windows),
      'C:\\Projects\\Customer A',
    );
  assert.equal(
    normalizeArchiveFolderPath('\\\\server\\share\\Customer A', windows),
    '\\\\server\\share\\Customer A',
  );
  assert.equal(
    normalizeArchiveFolderPath('~\\Customer A', windows),
    'C:\\Users\\example\\Customer A',
  );
  for (const input of [
    'C:\\Projects\\Customer A',
    'C:/Projects/Customer A',
    '\\\\server\\share\\Customer A',
  ])
    assert.throws(
      () => normalizeArchiveFolderPath(input, posix),
      /Windows drive or UNC path/,
    );
});

test('relative paths, malformed URLs and control characters are rejected before filesystem access', () => {
  for (const input of [
    'relative/folder',
    '$HOME/folder',
    '~other/folder',
    '"/Users/example/folder',
    'file:///Users/example/a%2Fb',
    'file:///Users/example/folder?query=1',
    'file:///Users/example/folder#fragment',
    'file:///Users/example/%00',
    'file://server/share/folder',
    'file:///C:/Projects/Customer%20A',
    '/Users/example/\nfolder',
    '/Users/example/\u007ffolder',
  ])
    assert.throws(() => normalizeArchiveFolderPath(input, posix));
  for (const input of [
    'https://example.com/folder',
    'smb://server/share/folder',
  ])
    assert.throws(
      () => normalizeArchiveFolderPath(input, posix),
      /Mount network shares/,
    );
  for (const input of [
    'C:relative',
    '\\relative-to-drive',
    '/relative-to-drive',
  ])
    assert.throws(
      () => normalizeArchiveFolderPath(input, windows),
      /full absolute folder path/,
    );
});
