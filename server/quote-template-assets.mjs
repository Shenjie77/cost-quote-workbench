/** Immutable workbook assets share the local SQLite backup with template mappings. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { ProjectFileError } from './project-files.mjs';
import { inspectQuoteExcelWorkbook } from '../features/quote/fill-excel-template.ts';

export const MAX_QUOTE_TEMPLATE_BYTES = 10 * 1024 * 1024;
const API_VERSION = 'cost-workbench/local-v1';
const MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Reject filesystem paths and unsupported Excel containers at the upload boundary. */
function validFileName(value) {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    !/^[^/\\]+\.xlsx$/i.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32) ||
    !value.trim()
  )
    throw new TypeError('Select an .xlsx file with a plain file name.');
  return value;
}

/** Reads a bounded binary request even when Content-Length is absent or incorrect. */
async function readTemplateBody(request) {
  const length = request.headers['content-length'];
  if (
    length !== undefined &&
    (!/^\d+$/.test(String(length)) || Number(length) > MAX_QUOTE_TEMPLATE_BYTES)
  )
    throw new RangeError('Excel template must be 10 MiB or smaller.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_QUOTE_TEMPLATE_BYTES)
      throw new RangeError('Excel template must be 10 MiB or smaller.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

/** Creates a content-addressed store; replacing a mapping never alters historical bytes. */
export function openQuoteTemplateStore(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS quote_template_assets (
      asset_id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      inventory_json TEXT NOT NULL,
      workbook BLOB NOT NULL,
      created_at TEXT NOT NULL
    );`);

  /** Resolves only a SHA-256 identifier; callers cannot select an arbitrary local file. */
  const get = (assetId) => {
    if (!/^[a-f0-9]{64}$/.test(assetId))
      throw new TypeError('Invalid Excel template identifier.');
    const row = db
      .prepare('SELECT * FROM quote_template_assets WHERE asset_id = ?')
      .get(assetId);
    if (!row)
      throw new ProjectFileError(
        'Excel template file is unavailable on this installation. Upload the original .xlsx again in Quote Templates.',
        404,
        'QUOTE_TEMPLATE_NOT_FOUND',
      );
    return row;
  };

  return {
    /** Validates before storing and deduplicates repeat uploads without overwriting the source. */
    async upload(fileName, bytes) {
      validFileName(fileName);
      if (!bytes.length || bytes.length > MAX_QUOTE_TEMPLATE_BYTES)
        throw new RangeError(
          'Excel template must contain data and be 10 MiB or smaller.',
        );
      const sheets = await inspectQuoteExcelWorkbook(bytes);
      const assetId = createHash('sha256').update(bytes).digest('hex');
      db.prepare(`INSERT OR IGNORE INTO quote_template_assets
        (asset_id, file_name, inventory_json, workbook, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        assetId,
        fileName,
        JSON.stringify(sheets),
        bytes,
        new Date().toISOString(),
      );
      return { assetId, fileName, sheets };
    },
    /** Returns safe sheet metadata without placing workbook bytes in project snapshots. */
    inspect(assetId) {
      const row = get(assetId);
      return {
        assetId,
        fileName: row.file_name,
        sheets: JSON.parse(row.inventory_json),
      };
    },
    /** Returns the untouched original workbook for client-side filling or local downloading. */
    read(assetId) {
      return Buffer.from(get(assetId).workbook);
    },
    /** Releases the independent connection during API shutdown and isolated tests. */
    close() {
      db.close();
    },
  };
}

/** Upload and download routes stay behind the local API's existing origin restriction. */
export async function routeQuoteTemplateAssets({
  request,
  response,
  url,
  store,
  respond,
  origin,
}) {
  const base = '/api/local/quote-template-assets';
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`))
    return false;
  const suffix = url.pathname.slice(base.length);
  const allowedQuery = !suffix && request.method === 'POST' ? ['fileName'] : [];
  for (const key of url.searchParams.keys()) {
    if (
      !allowedQuery.includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      throw new TypeError(`Invalid Excel template query parameter: ${key}`);
  }
  if (!suffix && request.method === 'POST') {
    const fileName = validFileName(url.searchParams.get('fileName'));
    const data = await store.upload(fileName, await readTemplateBody(request));
    respond(201, {
      apiVersion: API_VERSION,
      kind: 'QuoteExcelAsset',
      ok: true,
      data,
    });
    return true;
  }
  const match = suffix.match(/^\/([a-f0-9]{64})(\/content)?$/);
  if (match && request.method === 'GET') {
    if (match[2]) {
      const bytes = store.read(match[1]);
      response.writeHead(200, {
        'Content-Type': MIME,
        'Content-Length': bytes.length,
        'Content-Disposition': 'attachment; filename="quotation-template.xlsx"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      });
      response.end(bytes);
    } else {
      respond(200, {
        apiVersion: API_VERSION,
        kind: 'QuoteExcelAsset',
        ok: true,
        data: store.inspect(match[1]),
      });
    }
    return true;
  }
  throw new ProjectFileError(
    'Invalid Excel template request.',
    405,
    'METHOD_NOT_ALLOWED',
  );
}
