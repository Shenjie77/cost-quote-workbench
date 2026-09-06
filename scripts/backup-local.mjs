#!/usr/bin/env node
/**
 * Produces a consistent local SQLite backup, including committed WAL contents.
 * Uses SQLite's backup API instead of copying a potentially active database.
 * The unique output lives under ignored data/backups; it never leaves the PC.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(
  process.env.COST_WORKBENCH_DB || path.join(root, 'data/workbench.sqlite'),
);
const directory = path.join(path.dirname(source), 'backups');
mkdirSync(directory, { recursive: true });
const destination = path.join(
  directory,
  `workbench-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`,
);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA integrity_check').get();
    if (check.integrity_check !== 'ok')
      throw new Error('Backup integrity check failed.');
  } finally {
    copy.close();
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, source, path: destination })}\n`,
  );
} finally {
  db.close();
}
