/**
 * Shared maintenance import gate for browser, repository and CLI. Validation is
 * all-or-nothing: no caller should merge records before this function succeeds.
 */
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import schema from '../../schemas/maintenance-price.schema.json' with { type: 'json' };
import { isValidIsoDate } from '../cost/validation.ts';
import type { MaintenancePriceRecord } from './domain.ts';

// Ajv compiles with Function(). Delay compilation until a browser import or a
// Node repository/CLI request; Worker SSR must import this module without
// dynamic code generation.
let validateShape: ValidateFunction | undefined;

/** Rejects unknown fields, invalid numbers/dates and duplicate import IDs. */
export function assertMaintenanceImport(value: unknown): asserts value is {
  schemaVersion: '1.0.0';
  records: MaintenancePriceRecord[];
} {
  validateShape ??= new Ajv2020({ allErrors: true, strict: true }).compile(
    schema,
  );
  if (!validateShape(value)) {
    const first = validateShape.errors?.[0];
    throw new TypeError(
      `${first?.instancePath || '/'}: ${first?.message || 'Invalid maintenance data'}`,
    );
  }
  const { records } = value as { records: MaintenancePriceRecord[] };
  const ids = new Set<string>();
  records.forEach((record, index) => {
    const location = `/records/${index}`;
    if (ids.has(record.id)) throw new TypeError(`${location}/id: duplicate ID`);
    ids.add(record.id);
    if (!isValidIsoDate(record.quoteDate))
      throw new TypeError(`${location}/quoteDate: invalid calendar date`);
    for (const key of [
      'client',
      'service',
      'productModel',
      'serviceLevel',
      'site',
      'source',
    ] as const) {
      if (!record[key].trim())
        throw new TypeError(`${location}/${key}: required text`);
    }
  });
}

/** Accepts plain decimals or well-formed thousands separators, never blanks/NaN. */
export function parseImportNumber(value: unknown, field: string): number {
  const text = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))
    throw new TypeError(`${field}: enter a non-negative number`);
  const result = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(result))
    throw new TypeError(`${field}: number is too large`);
  return result;
}
