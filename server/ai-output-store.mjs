import { DatabaseSync } from 'node:sqlite';
import {
  defaultScene,
  validateScene,
  validateOutput,
} from './ai-output-domain.mjs';
import { RepositoryConflictError } from './workspace-repository.mjs';

export function openAiOutputStore(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS ai_output_scenes (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document_json TEXT NOT NULL CHECK(json_valid(document_json)));
    CREATE TABLE IF NOT EXISTS ai_output_runs (id TEXT PRIMARY KEY, document_json TEXT NOT NULL CHECK(json_valid(document_json)));`);
  db.prepare('INSERT OR IGNORE INTO ai_output_scenes VALUES (?, 1, ?)').run(
    defaultScene.id,
    JSON.stringify(defaultScene),
  );
  const scene = (id) => {
    const row = db
      .prepare('SELECT * FROM ai_output_scenes WHERE id = ?')
      .get(id);
    if (!row) throw new TypeError('Scene does not exist.');
    return { scene: JSON.parse(row.document_json), revision: row.revision };
  };
  const run = (id) => {
    const row = db
      .prepare('SELECT document_json FROM ai_output_runs WHERE id = ?')
      .get(id);
    if (!row) throw new TypeError('Draft does not exist.');
    return JSON.parse(row.document_json);
  };
  const writeRun = (data) =>
    db
      .prepare('INSERT INTO ai_output_runs VALUES (?, ?)')
      .run(data.id, JSON.stringify(data));
  return {
    scenes: () =>
      db
        .prepare('SELECT * FROM ai_output_scenes ORDER BY id')
        .all()
        .map((r) => ({
          scene: JSON.parse(r.document_json),
          revision: r.revision,
        })),
    scene,
    run,
    writeRun,
    saveScene(value, expectedRevision) {
      validateScene(value);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db
          .prepare('SELECT revision FROM ai_output_scenes WHERE id = ?')
          .get(value.id);
        if ((existing?.revision ?? null) !== expectedRevision)
          throw new RepositoryConflictError(
            'Scene changed. Reload configuration before saving.',
            existing?.revision ?? null,
          );
        const revision = (existing?.revision ?? 0) + 1;
        db.prepare(
          `INSERT INTO ai_output_scenes VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document_json = excluded.document_json`,
        ).run(value.id, revision, JSON.stringify(value));
        db.exec('COMMIT');
        return { scene: value, revision };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    recent: () =>
      db
        .prepare(
          'SELECT document_json FROM ai_output_runs ORDER BY rowid DESC LIMIT 20',
        )
        .all()
        .map((r) => JSON.parse(r.document_json)),
    confirm(id, final, note) {
      const data = run(id);
      if (data.status !== 'draft')
        throw new RepositoryConflictError(
          'Only an unconfirmed draft can be confirmed.',
          null,
        );
      if (typeof note !== 'string' || note.length > 2000)
        throw new TypeError('Final feedback must be at most 2000 characters.');
      validateOutput(final, data.scene, data.snapshot, true);
      const updated = {
        ...data,
        status: 'confirmed',
        final,
        finalNote: note,
        confirmedAt: new Date().toISOString(),
      };
      db.prepare(
        'UPDATE ai_output_runs SET document_json = ? WHERE id = ?',
      ).run(JSON.stringify(updated), id);
      return updated;
    },
    // Iterator keeps export memory bounded. Each line is a full auditable feedback record.
    *exportLines() {
      for (const row of db
        .prepare('SELECT document_json FROM ai_output_runs ORDER BY rowid')
        .iterate())
        yield `${JSON.stringify({ schemaVersion: 1, task: 'daily-digest', trainingAutomatic: false, ...JSON.parse(row.document_json) })}\n`;
    },
    close: () => db.close(),
  };
}
