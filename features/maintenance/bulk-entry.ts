import { roundMoney } from '../cost/domain.ts';
/** Parse pasted Excel rows without requiring history, SLA, site or remarks. */
import { readBulkTable } from '../cost/bulk-table-reader.ts';
import { newMaintenanceLine } from './component-pricing.ts';
import type { BoqLine } from './domain.ts';

export function parseMaintenanceBulk(
  text: string,
  current: BoqLine[] = [],
): {
  rows: BoqLine[];
  errors: string[];
} {
  const parsed = readBulkTable(text),
    errors = [...parsed.issues];
  const rows: BoqLine[] = [];
  const usedIds = new Set<string>();
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
      description = '',
      rowId = '',
    ] = entry.cells;
    const values = [ct, spms, qty, duration].map((value) =>
      value.trim() === '' ? 0 : Number(value.replace(/,/g, '')),
    );
    if (
      entry.cells.length > 8 ||
      values.some((value) => !Number.isFinite(value) || value < 0) ||
      values[0] > 1e10 ||
      values[1] > 1e10 ||
      !Number.isInteger(values[2]) ||
      values[2] > 1e6 ||
      values[3] > 100 ||
      model.length > 500 ||
      remark.length > 10000 ||
      description.length > 10000
    ) {
      errors.push(
        `Row ${entry.sourceRow}: check CT / SPMS (2 decimals), QTY (integer), Duration (0–100 years), and the input columns.`,
      );
      continue;
    }
    let existing = rowId ? current.find((row) => row.id === rowId) : undefined;
    if (rowId && !existing) {
      errors.push(
        `Row ${entry.sourceRow}: Row ID no longer exists. Reload current rows or clear the ID.`,
      );
      continue;
    }
    // Seven-column pastes can update a unique model. An explicit blank eighth ID adds a new row.
    if (!rowId && entry.cells.length < 8 && model.trim()) {
      const matches = current.filter(
        (row) =>
          row.model.trim().toLocaleLowerCase() ===
          model.trim().toLocaleLowerCase(),
      );
      if (matches.length > 1) {
        errors.push(
          `Row ${entry.sourceRow}: model occurs more than once. Keep the intended Row ID.`,
        );
        continue;
      }
      existing = matches[0];
    }
    if (existing && usedIds.has(existing.id)) {
      errors.push(`Row ${entry.sourceRow}: Row ID occurs more than once.`);
      continue;
    }
    if (existing) usedIds.add(existing.id);
    rows.push({
      ...(existing ?? newMaintenanceLine(0)),
      model,
      ct: roundMoney(values[0]),
      spms: roundMoney(values[1]),
      quantity: values[2],
      durationYears: values[3],
      remark,
      ...(description || existing?.description !== undefined
        ? { description }
        : {}),
    });
  }
  if (!source.length) errors.push('Paste at least one row.');
  return { rows: errors.length ? [] : rows, errors };
}

/** Seed literal TSV with stable IDs; source/history metadata remains outside the editable fields. */
export function maintenanceBulkText(rows: BoqLine[]): string {
  const cell = (value: string | number | undefined) =>
    '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return [
    [
      'Model',
      'CT',
      'SPMS',
      'QTY',
      'Duration',
      'Remark',
      'Description',
      'Row ID',
    ],
    ...rows.map((row) => [
      row.model,
      row.ct ?? row.unitAnnualQuote,
      row.spms ?? 0,
      row.quantity,
      row.durationYears ?? 0,
      row.remark ?? row.basis,
      row.description,
      row.id,
    ]),
  ]
    .map((row) => row.map(cell).join('\t'))
    .join('\n');
}

/** Updating a batch never removes a row that was omitted from the table. */
export function mergeMaintenanceBulkRows(
  current: BoqLine[],
  edits: BoqLine[],
): BoqLine[] {
  const pending = new Map<string, BoqLine>();
  for (const row of edits) {
    if (pending.has(row.id))
      throw new TypeError('Duplicate maintenance Row ID.');
    pending.set(row.id, structuredClone(row));
  }
  const rows = current.map((row) => {
    const edit = pending.get(row.id);
    pending.delete(row.id);
    return edit ? { ...row, ...edit } : row;
  });
  rows.push(...pending.values());
  if (rows.length > 1000) throw new TypeError('单个维保配置最多1,000行');
  return rows;
}
