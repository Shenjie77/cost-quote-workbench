/** Independent, revision-checked calculation notebooks in the existing local database. */
import { DatabaseSync } from 'node:sqlite';
import { RepositoryConflictError } from './workspace-repository.mjs';

export function openCalculationDraftStore(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS calculation_drafts (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
      document_json TEXT NOT NULL CHECK(json_valid(document_json)),
      updated_at TEXT NOT NULL
    )`);
  const validId = (id) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 1000)
      throw new TypeError('Invalid calculation draft identifier.');
  };
  const get = (id) => {
    validId(id);
    const row = db
      .prepare('SELECT * FROM calculation_drafts WHERE id = ?')
      .get(id);
    return row
      ? {
          id,
          revision: row.revision,
          document: JSON.parse(row.document_json),
          updatedAt: row.updated_at,
        }
      : null;
  };
  return {
    get,
    save(id, document, expectedRevision) {
      validId(id);
      if (
        expectedRevision !== null &&
        (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      )
        throw new TypeError('A valid expectedRevision is required.');
      const book = document?.workbook;
      if (
        !book ||
        typeof book !== 'object' ||
        !Array.isArray(book.sheetOrder) ||
        !book.sheetOrder.length ||
        book.sheetOrder.length > 100 ||
        !book.sheets ||
        book.sheetOrder.some(
          (key) => typeof key !== 'string' || !Object.hasOwn(book.sheets, key),
        ) ||
        (document.basis !== undefined && typeof document.basis !== 'string')
      )
        throw new TypeError(
          'Select a calculation workbook with valid worksheets.',
        );
      const json = JSON.stringify(document);
      if (Buffer.byteLength(json) > 6 * 1024 * 1024)
        throw new RangeError(
          'Calculation draft exceeds 6 MiB. Download a backup and reduce its size.',
        );
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = get(id);
        if ((previous?.revision ?? null) !== expectedRevision)
          throw new RepositoryConflictError(
            'This calculation draft changed in another window. Download your backup before reloading.',
            previous?.revision ?? null,
          );
        const revision = (previous?.revision ?? 0) + 1;
        const updatedAt = new Date().toISOString();
        db.prepare(`INSERT INTO calculation_drafts VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document_json = excluded.document_json, updated_at = excluded.updated_at`).run(
          id,
          revision,
          json,
          updatedAt,
        );
        db.exec('COMMIT');
        return { id, revision, document, updatedAt };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}

export async function routeCalculationDrafts({
  request,
  url,
  store,
  respond,
  readJson,
}) {
  const match = url.pathname.match(
    /^\/api\/local\/calculation-drafts\/([^/]+)$/,
  );
  if (!match) return false;
  const id = decodeURIComponent(match[1]);
  let data;
  if (request.method === 'GET') data = store.get(id);
  else if (request.method === 'PUT') {
    const body = await readJson(request);
    data = store.save(id, body.document, body.expectedRevision);
  } else {
    respond(405, { ok: false, error: { message: 'Method not allowed.' } });
    return true;
  }
  respond(200, { ok: true, data });
  return true;
}
