/** Parse pasted Excel rows without requiring history, SLA, site or remarks. */
import { readBulkTable } from '../cost/bulk-table-reader.ts';
import { newMaintenanceLine } from './component-pricing.ts';
import type { BoqLine } from './domain.ts';

export function parseMaintenanceBulk(text: string): {
  rows: BoqLine[];
  errors: string[];
} {
  const parsed = readBulkTable(text),
    errors = [...parsed.issues];
  const rows: BoqLine[] = [];
  const source = parsed.rows;
  const hasHeader = /^(model|设备型号|型号)$/i.test(source[0]?.cells[0] ?? '');
  for (const entry of source.slice(hasHeader ? 1 : 0)) {
    const [
      model = '',
      ct = '',
      spms = '',
      qty = '',
      duration = '',
      remark = '',
    ] = entry.cells;
    const values = [ct, spms, qty, duration].map((value) =>
      value.trim() === '' ? 0 : Number(value.replace(/,/g, '')),
    );
    if (
      entry.cells.length > 6 ||
      values.some((value) => !Number.isFinite(value) || value < 0) ||
      values[0] > 1e10 ||
      values[1] > 1e10 ||
      !Number.isInteger(values[2]) ||
      values[2] > 1e6 ||
      values[3] > 100 ||
      values
        .slice(0, 2)
        .some(
          (value) => Math.abs(value * 100 - Math.round(value * 100)) > 1e-6,
        ) ||
      model.length > 500 ||
      remark.length > 10000
    ) {
      errors.push(
        `Row ${entry.sourceRow}: check CT / SPMS (2 decimals), QTY (integer), Duration (0–100 years), and the six columns.`,
      );
      continue;
    }
    rows.push({
      ...newMaintenanceLine(0),
      model,
      ct: values[0],
      spms: values[1],
      quantity: values[2],
      durationYears: values[3],
      remark,
    });
  }
  if (!source.length) errors.push('Paste at least one row.');
  return { rows: errors.length ? [] : rows, errors };
}
