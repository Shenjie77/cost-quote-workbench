/** Named layout presets share the same SQLite database and backups as uploaded workbooks. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { ProjectFileError } from './project-files.mjs';
import { validateQuoteExcelMapping } from '../features/quote/excel-template-mapping.ts';
const schema = JSON.parse(
  readFileSync(
    new URL('../schemas/workspace-state.schema.json', import.meta.url),
    'utf8',
  ),
);
const validate = new Ajv2020({ strict: false }).compile({
  $ref: '#/$defs/quoteExcelTemplate',
  $defs: schema.$defs,
});
const conflict = () =>
  new ProjectFileError(
    'This layout changed or its name already exists. Reload layouts before saving.',
    409,
    'LAYOUT_CONFLICT',
  );
export function makeQuoteLayoutStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS quote_layout_presets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL, mapping_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  const decode = (row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    mapping: JSON.parse(row.mapping_json),
  });
  return {
    list: () =>
      db
        .prepare('SELECT * FROM quote_layout_presets ORDER BY name_key')
        .all()
        .map(decode),
    save(input) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (k) => !['id', 'name', 'mapping', 'expectedRevision'].includes(k),
        )
      )
        throw new TypeError('Invalid layout request.');
      const name = input.name?.trim();
      if (typeof name !== 'string' || !name || name.length > 120)
        throw new TypeError('Enter a layout name (1–120 characters).');
      if (
        !input.mapping ||
        Object.hasOwn(input.mapping, 'assetId') ||
        Object.hasOwn(input.mapping, 'fileName')
      )
        throw new TypeError('A saved layout contains configuration only.');
      const mapping = {
        ...input.mapping,
        assetId: '0'.repeat(64),
        fileName: 'layout.xlsx',
      };
      if (!validate(mapping))
        throw new TypeError('Invalid structured layout configuration.');
      if (!mapping.body) throw new TypeError('Save a structured layout first.');
      const errors = validateQuoteExcelMapping(mapping);
      if (errors.length) throw new TypeError(errors.join(' '));
      const nameKey = name.toLowerCase();
      db.exec('BEGIN IMMEDIATE');
      try {
        const sameName = db
          .prepare('SELECT id FROM quote_layout_presets WHERE name_key=?')
          .get(nameKey);
        let id = input.id,
          revision = 1;
        if (id !== undefined) {
          if (
            typeof id !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(id) ||
            !Number.isInteger(input.expectedRevision)
          )
            throw new TypeError('Invalid layout revision.');
          const saved = db
            .prepare('SELECT revision FROM quote_layout_presets WHERE id=?')
            .get(id);
          if (
            !saved ||
            saved.revision !== input.expectedRevision ||
            (sameName && sameName.id !== id)
          )
            throw conflict();
          revision = saved.revision + 1;
        } else {
          if (input.expectedRevision !== undefined)
            throw new TypeError('New layouts have no expected revision.');
          if (sameName) throw conflict();
          if (
            db
              .prepare('SELECT COUNT(*) AS count FROM quote_layout_presets')
              .get().count >= 200
          )
            throw new RangeError('At most 200 saved layouts are supported.');
          id = randomUUID();
        }
        db.prepare(`INSERT INTO quote_layout_presets (id,name,name_key,revision,mapping_json,updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key,revision=excluded.revision,mapping_json=excluded.mapping_json,updated_at=excluded.updated_at`).run(
          id,
          name,
          nameKey,
          revision,
          JSON.stringify(input.mapping),
          new Date().toISOString(),
        );
        db.exec('COMMIT');
        return {
          id,
          name,
          revision,
          mapping: JSON.parse(JSON.stringify(input.mapping)),
        };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
