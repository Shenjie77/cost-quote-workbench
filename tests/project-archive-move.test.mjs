import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stageArchiveMove } from '../server/project-archive-move.mjs';

const setup = (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'archive-move-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Original project');
  const destination = path.join(root, 'Renamed project');
  mkdirSync(path.join(source, 'workflow', 'Design review'), {
    recursive: true,
  });
  mkdirSync(path.join(source, 'cost'));
  mkdirSync(path.join(source, 'quotation'));
  writeFileSync(
    path.join(source, 'workflow', 'Design review', 'evidence.pdf'),
    Buffer.from('%PDF\u0000document'),
  );
  writeFileSync(
    path.join(source, 'unindexed-notes.txt'),
    'User file not present in SQLite',
  );
  return { root, source, destination };
};

test('archive move stages every file and empty directory, retaining source until cleanup', (t) => {
  const { source, destination } = setup(t);
  const staged = stageArchiveMove(source, destination);
  assert.equal(existsSync(source), true);
  assert.deepEqual(readdirSync(destination), readdirSync(source));
  assert.equal(
    readFileSync(path.join(destination, 'unindexed-notes.txt'), 'utf8'),
    'User file not present in SQLite',
  );
  assert.deepEqual(
    readFileSync(
      path.join(destination, 'workflow', 'Design review', 'evidence.pdf'),
    ),
    readFileSync(
      path.join(source, 'workflow', 'Design review', 'evidence.pdf'),
    ),
  );
  assert.deepEqual(staged.cleanup(), { sourceRemoved: true });
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(destination), true);
  assert.deepEqual(staged.cleanup(), { sourceRemoved: true });
  assert.deepEqual(staged.rollback(), { destinationRemoved: false });
  assert.equal(existsSync(destination), true);
});

test('transaction rollback deletes only its staged copy and remains idempotent', (t) => {
  const { source, destination } = setup(t);
  const staged = stageArchiveMove(source, destination);
  assert.deepEqual(staged.rollback(), { destinationRemoved: true });
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(source), true);
  assert.deepEqual(staged.rollback(), { destinationRemoved: true });
  assert.deepEqual(staged.cleanup(), { sourceRemoved: false });
});

test('cleanup preserves the original tree when files are added or edited after staging', (t) => {
  const { source, destination } = setup(t);
  const staged = stageArchiveMove(source, destination);
  writeFileSync(path.join(source, 'unindexed-notes.txt'), 'Changed after copy');
  writeFileSync(path.join(source, 'new-user-file.txt'), 'Keep me');
  assert.deepEqual(staged.cleanup(), { sourceRemoved: false });
  assert.equal(
    readFileSync(path.join(source, 'new-user-file.txt'), 'utf8'),
    'Keep me',
  );
  assert.equal(
    readFileSync(path.join(source, 'unindexed-notes.txt'), 'utf8'),
    'Changed after copy',
  );
  assert.equal(
    readFileSync(path.join(destination, 'unindexed-notes.txt'), 'utf8'),
    'User file not present in SQLite',
  );
  assert.deepEqual(staged.rollback(), { destinationRemoved: false });
  assert.equal(existsSync(destination), true);
});

test('cleanup and rollback preserve data when the destination changes', (t) => {
  const { source, destination } = setup(t);
  const staged = stageArchiveMove(source, destination);
  writeFileSync(
    path.join(destination, 'unindexed-notes.txt'),
    'New destination content',
  );
  assert.deepEqual(staged.cleanup(), { sourceRemoved: false });
  assert.deepEqual(staged.rollback(), { destinationRemoved: false });
  assert.equal(existsSync(source), true);
  assert.equal(
    readFileSync(path.join(destination, 'unindexed-notes.txt'), 'utf8'),
    'New destination content',
  );
});

test('rollback never removes a replacement directory at the staged path', (t) => {
  const { source, destination } = setup(t);
  const staged = stageArchiveMove(source, destination);
  renameSync(destination, `${destination}.saved`);
  mkdirSync(destination);
  writeFileSync(path.join(destination, 'other-user-file.txt'), 'Do not remove');
  assert.deepEqual(staged.rollback(), { destinationRemoved: false });
  assert.deepEqual(staged.cleanup(), { sourceRemoved: false });
  assert.equal(existsSync(source), true);
  assert.equal(
    readFileSync(path.join(destination, 'other-user-file.txt'), 'utf8'),
    'Do not remove',
  );
});

test('overlapping folders, existing targets, relative paths and dangling symlinks are rejected', (t) => {
  const { root, source, destination } = setup(t);
  for (const target of [source, path.join(source, 'nested'), root])
    assert.throws(() => stageArchiveMove(source, target), /separate folders/);
  assert.throws(() => stageArchiveMove('relative', destination), /absolute/);
  mkdirSync(destination);
  writeFileSync(path.join(destination, 'keep.txt'), 'Preserve existing');
  assert.throws(
    () => stageArchiveMove(source, destination),
    (error) => error.code === 'ARCHIVE_MOVE_EXISTS',
  );
  assert.equal(
    readFileSync(path.join(destination, 'keep.txt'), 'utf8'),
    'Preserve existing',
  );
  const dangling = path.join(root, 'dangling');
  symlinkSync(path.join(root, 'missing'), dangling);
  assert.throws(
    () => stageArchiveMove(source, dangling),
    (error) => error.code === 'ARCHIVE_MOVE_EXISTS',
  );
  assert.equal(existsSync(source), true);
});

test('source or descendant symlinks are rejected without creating a copy', (t) => {
  const { root, source, destination } = setup(t);
  const linked = path.join(root, 'linked source');
  symlinkSync(source, linked);
  assert.throws(() => stageArchiveMove(linked, destination), /symbolic link/);
  symlinkSync(path.join(root, 'missing'), path.join(source, 'bad-link'));
  assert.throws(() => stageArchiveMove(source, destination), /symbolic link/);
  assert.equal(existsSync(destination), false);
});

test('a destination parent symlink cannot redirect the staged copy', (t) => {
  const { root, source } = setup(t);
  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  const linked = path.join(root, 'linked-parent');
  symlinkSync(outside, linked);
  assert.throws(
    () => stageArchiveMove(source, path.join(linked, 'copy')),
    /symbolic link/,
  );
  assert.deepEqual(readdirSync(outside), []);
});
