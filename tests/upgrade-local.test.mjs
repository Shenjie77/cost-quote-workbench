import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  inspectDatabase,
  prepareUpgrade,
  verifyUpgrade,
} from '../scripts/upgrade-local.mjs';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'upgrade-test-')),
    database = path.join(root, 'workbench.sqlite'),
    archive = path.join(root, 'external', 'P1');
  await mkdir(archive, { recursive: true });
  await writeFile(
    path.join(archive, 'quote.xlsx'),
    'example archived workbook',
  );
  await writeFile(path.join(root, '.env.local'), 'EXAMPLE_SETTING=kept');
  const db = new DatabaseSync(database);
  db.exec(
    'CREATE TABLE workspace_snapshots (project_id TEXT, revision INTEGER, payload_json TEXT); CREATE TABLE project_file_roots (project_id TEXT, root_path TEXT, project_folder TEXT)',
  );
  db.prepare('INSERT INTO workspace_snapshots VALUES (?, ?, ?)').run(
    'P1',
    7,
    JSON.stringify({
      costVersions: [{ code: 'V1', state: 'Confirmed', cost: 123.45 }],
      quoteHistory: [{ price: 345.67 }],
    }),
  );
  db.prepare('INSERT INTO project_file_roots VALUES (?, ?, ?)').run(
    'P1',
    path.dirname(archive),
    'P1',
  );
  db.close();
  return { root, database, archive };
}
test('upgrade snapshot preserves current/history payloads, custom archive and local configuration without database mutation', async () => {
  const f = await fixture();
  try {
    const before = inspectDatabase(f.database);
    const result = await prepareUpgrade({
      projectRoot: f.root,
      database: f.database,
      fromCommit: 'abcdef1234567',
    });
    assert.deepEqual(inspectDatabase(f.database), before);
    const manifest = JSON.parse(await readFile(result.manifest, 'utf8'));
    assert.equal(manifest.fromCommit, 'abcdef1234567');
    assert.equal(
      await readFile(
        path.join(
          path.dirname(result.manifest),
          manifest.archives[0].backup,
          'quote.xlsx',
        ),
        'utf8',
      ),
      'example archived workbook',
    );
    assert.equal(
      await readFile(
        path.join(path.dirname(result.manifest), 'configuration', '.env.local'),
        'utf8',
      ),
      'EXAMPLE_SETTING=kept',
    );
    assert.equal((await verifyUpgrade(result.manifest)).ok, true);
    const db = new DatabaseSync(f.database);
    db.exec('UPDATE workspace_snapshots SET revision=8');
    db.close();
    await writeFile(path.join(f.archive, 'quote.xlsx'), 'changed');
    await writeFile(path.join(f.root, '.env.local'), 'changed');
    const check = await verifyUpgrade(result.manifest);
    assert.equal(check.ok, false);
    assert.deepEqual(check.changedTables, ['workspace_snapshots']);
    assert.deepEqual(check.changedArchives, ['P1']);
    assert.deepEqual(check.changedConfiguration, ['.env.local']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test('archive traversal and symlinks block readiness instead of reporting a complete backup', async () => {
  const f = await fixture();
  try {
    await symlink(
      path.join(f.root, '.env.local'),
      path.join(f.archive, 'linked'),
    );
    await assert.rejects(
      prepareUpgrade({ projectRoot: f.root, database: f.database }),
      /symbolic link/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
