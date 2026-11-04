#!/usr/bin/env node
/** Read-only upgrade checks and recovery snapshots; never starts migrations or rewrites customer data. */
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
  lstat,
  realpath,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function quoteIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}
export function inspectDatabase(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const checks = db.prepare('PRAGMA integrity_check').all();
    if (checks.some((row) => row.integrity_check !== 'ok'))
      throw new Error('SQLite integrity check failed.');
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const fingerprints = {};
    for (const { name } of tables) {
      // Order-independent fingerprints include history, revisions and configuration, not only current totals.
      const hashes = db
        .prepare(`SELECT * FROM ${quoteIdentifier(name)}`)
        .all()
        .map((row) => digest(JSON.stringify(row)))
        .sort();
      fingerprints[name] = {
        rows: hashes.length,
        sha256: digest(hashes.join('\n')),
      };
    }
    const archives = tables.some((t) => t.name === 'project_file_roots')
      ? db
          .prepare(
            'SELECT project_id, root_path, project_folder FROM project_file_roots ORDER BY project_id',
          )
          .all()
      : [];
    return { fingerprints, archives };
  } finally {
    db.close();
  }
}
async function walkFiles(directory, base = directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        'Archive contains a symbolic link; back up its target explicitly before upgrading.',
      );
    if (entry.isDirectory()) files.push(...(await walkFiles(file, base)));
    else if (entry.isFile())
      files.push({
        relativePath: path.relative(base, file),
        sha256: await fileHash(file),
      });
    else throw new Error('Archive contains an unsupported file type.');
  }
  return files;
}
async function archivePath(record) {
  const parent = path.resolve(record.root_path);
  const target = path.resolve(parent, record.project_folder);
  if (target === parent || !target.startsWith(parent + path.sep))
    throw new Error('Invalid project archive path.');
  const parentReal = await realpath(parent);
  const targetReal = await realpath(target);
  if (
    !targetReal.startsWith(parentReal + path.sep) ||
    (await lstat(target)).isSymbolicLink()
  )
    throw new Error('Project archive resolves outside its configured root.');
  return targetReal;
}
export async function prepareUpgrade({
  projectRoot = root,
  database,
  outputRoot,
  fromCommit,
}) {
  const source = path.resolve(database);
  const directory = path.join(
    outputRoot || path.join(path.dirname(source), 'backups'),
    `upgrade-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, path.join(directory, 'workbench.sqlite'));
  } finally {
    db.close();
  }
  const baseline = inspectDatabase(path.join(directory, 'workbench.sqlite'));
  const archives = [];
  for (const [index, record] of baseline.archives.entries()) {
    const original = await archivePath(record);
    if (directory === original || directory.startsWith(original + path.sep))
      throw new Error('Backup directory cannot be inside a project archive.');
    const files = await walkFiles(original);
    const target = path.join(directory, 'archives', String(index));
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const file of files) {
      const destination = path.join(target, file.relativePath);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(path.join(original, file.relativePath), destination);
      if (
        (await fileHash(destination)) !== file.sha256 ||
        (await fileHash(path.join(original, file.relativePath))) !== file.sha256
      )
        throw new Error(
          'Archive changed during backup; stop all writers and retry.',
        );
    }
    archives.push({
      projectId: record.project_id,
      original,
      backup: path.relative(directory, target),
      files,
    });
  }
  const configuration = [];
  for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith('.env')) continue;
    if (!entry.isFile())
      throw new Error(
        'Environment configuration is not a regular file; back it up explicitly.',
      );
    const destination = path.join(directory, 'configuration', entry.name);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(path.join(projectRoot, entry.name), destination);
    configuration.push({
      name: entry.name,
      sha256: await fileHash(destination),
    });
  }
  const after = inspectDatabase(source);
  if (
    JSON.stringify(after.fingerprints) !== JSON.stringify(baseline.fingerprints)
  )
    throw new Error('Database changed during backup; stop the app and retry.');
  const head = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  })();
  const manifest = {
    format: 'cost-workbench-upgrade/v1',
    createdAt: new Date().toISOString(),
    database: source,
    projectRoot,
    fromCommit: fromCommit || head,
    preparedAtCommit: head,
    tables: baseline.fingerprints,
    archives,
    configuration,
  };
  const manifestPath = path.join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  return {
    ok: true,
    manifest: manifestPath,
    tables: Object.keys(manifest.tables).length,
    archives: archives.length,
  };
}
export async function verifyUpgrade(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.format !== 'cost-workbench-upgrade/v1')
    throw new Error('Unsupported backup manifest.');
  const current = inspectDatabase(manifest.database);
  const changedTables = [
    ...new Set([
      ...Object.keys(manifest.tables),
      ...Object.keys(current.fingerprints),
    ]),
  ].filter(
    (name) =>
      JSON.stringify(manifest.tables[name]) !==
      JSON.stringify(current.fingerprints[name]),
  );
  const changedArchives = [];
  for (const archive of manifest.archives) {
    try {
      if (
        JSON.stringify(await walkFiles(archive.original)) !==
        JSON.stringify(archive.files)
      )
        changedArchives.push(archive.projectId);
    } catch {
      changedArchives.push(archive.projectId);
    }
  }
  const changedConfiguration = [];
  for (const entry of manifest.configuration) {
    try {
      if (
        (await fileHash(path.join(manifest.projectRoot, entry.name))) !==
        entry.sha256
      )
        changedConfiguration.push(entry.name);
    } catch {
      changedConfiguration.push(entry.name);
    }
  }
  return {
    ok:
      !changedTables.length &&
      !changedArchives.length &&
      !changedConfiguration.length,
    changedTables,
    changedArchives,
    changedConfiguration,
  };
}
async function assertApiStopped() {
  const listening = await new Promise((resolve) => {
    const socket = createConnection({
      host: '127.0.0.1',
      port: Number(process.env.COST_WORKBENCH_API_PORT || 3210),
    });
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(v);
      }
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
  if (listening)
    throw new Error(
      'Stop the workbench/API before creating or verifying an upgrade snapshot.',
    );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [action, ...args] = process.argv.slice(2);
    await assertApiStopped();
    if (action === 'prepare') {
      const fromIndex = args.indexOf('--from');
      if (
        fromIndex >= 0 &&
        !/^[a-f0-9]{7,40}$/i.test(args[fromIndex + 1] || '')
      )
        throw new Error('--from requires the previous Git commit hash.');
      console.log(
        JSON.stringify(
          await prepareUpgrade({
            database:
              process.env.COST_WORKBENCH_DB ||
              path.join(root, 'data/workbench.sqlite'),
            fromCommit: fromIndex >= 0 ? args[fromIndex + 1] : undefined,
          }),
        ),
      );
    } else if (action === 'verify' && args[0]) {
      const result = await verifyUpgrade(path.resolve(args[0]));
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    } else
      throw new Error(
        'Usage: upgrade-local.mjs prepare [--from COMMIT] | verify MANIFEST',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
