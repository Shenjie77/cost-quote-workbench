import type { ICellData } from '@univerjs/core';
import {
  tableWorkbook,
  type CalculationDocument,
} from '../calculation/workbook.ts';
export type EntryColumn = {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'list';
  description?: string;
  required?: boolean;
  options?: string[];
};
export type EntrySheet = { id: string; name: string; columns: EntryColumn[] };
export type EntryIssue = {
  sheet: string;
  row: number;
  column?: number;
  message: string;
};
export type EntryRows = {
  row: number;
  values: Record<string, string | number | boolean>;
  cells: (string | number | boolean)[];
}[];
export function entryWorkbook(sheets: EntrySheet[]): CalculationDocument {
  const workbook = tableWorkbook('Bulk Entry', []);
  workbook.sheetOrder = [];
  workbook.sheets = {};
  for (const spec of sheets) {
    const sheet = tableWorkbook(spec.name, [spec.columns.map((c) => c.label)])
      .sheets!.calculation;
    workbook.sheetOrder.push(spec.id);
    workbook.sheets[spec.id] = {
      ...sheet,
      id: spec.id,
      name: spec.name.slice(0, 31),
      rowCount: 1002,
      columnCount: Math.max(spec.columns.length, 12),
      columnData: Object.fromEntries(
        spec.columns.map((c, i) => [
          i,
          { w: /description|scope|item/i.test(c.key) ? 300 : 140 },
        ]),
      ),
    };
  }
  return { workbook, basis: 'bulk-entry-v1' };
}
export function readEntrySheet(
  document: CalculationDocument,
  spec: EntrySheet,
): { rows: EntryRows; issues: EntryIssue[] } {
  const rows: EntryRows = [],
    issues: EntryIssue[] = [];
  const sheet = document.workbook.sheets?.[spec.id];
  const fail = (row: number, column: number | undefined, message: string) =>
    issues.push({ sheet: spec.id, row, column, message });
  if (!sheet) {
    fail(
      1,
      undefined,
      'The input sheet is missing. Start a new batch to restore the format.',
    );
    return { rows, issues };
  }
  for (const [i, col] of spec.columns.entries())
    if (
      sheet.cellData?.[0]?.[i]?.v !== col.label ||
      sheet.cellData?.[0]?.[i]?.f
    )
      fail(1, i + 1, `Keep the fixed header: ${col.label}.`);
  const data = (sheet.cellData ?? {}) as Record<
    number,
    Record<number, ICellData>
  >;
  for (const [key, cells] of Object.entries(data)) {
    const r = Number(key);
    if (!r) continue;
    const nonempty = Object.values(cells).some(
      (c) => c?.f || (c?.v !== undefined && c.v !== null && c.v !== ''),
    );
    if (!nonempty) continue;
    if (r > 1000) {
      fail(r + 1, undefined, 'Use at most 1,000 input rows.');
      continue;
    }
    const values: Record<string, string | number | boolean> = {},
      list: (string | number | boolean)[] = [];
    for (const [c, cell] of Object.entries(cells))
      if (
        Number(c) >= spec.columns.length &&
        (cell?.f || (cell?.v !== undefined && cell.v !== null && cell.v !== ''))
      )
        fail(r + 1, Number(c) + 1, 'Paste only into the defined columns.');
    for (const [c, col] of spec.columns.entries()) {
      const cell: ICellData | undefined = cells[c];
      let value = cell?.v ?? '';
      if (cell?.f || cell?.t === 4) {
        fail(
          r + 1,
          c + 1,
          'Paste values only; formulas and spreadsheet errors cannot be imported.',
        );
        value = '';
      }
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        fail(r + 1, c + 1, 'Enter plain text or a number.');
        value = '';
      }
      if (
        (col.kind === 'text' || col.kind === 'date' || col.kind === 'list') &&
        typeof value !== 'string'
      ) {
        // Codes typed as numbers have already lost their leading zeroes; require a deliberate text paste.
        fail(
          r + 1,
          c + 1,
          `${col.label}: enter text (use an apostrophe for numeric codes).`,
        );
      }
      if (col.required && String(value).trim() === '')
        fail(r + 1, c + 1, `${col.label} is required.`);
      values[col.key] = value;
      list.push(value);
    }
    rows.push({ row: r + 1, values, cells: list });
  }
  rows.sort((a, b) => a.row - b.row);
  return { rows, issues };
}
/** Preserve multiline Excel cells and their original row positions for existing parsers. */
export function entryTsv(spec: EntrySheet, rows: EntryRows) {
  const quote = (v: string | number | boolean) =>
    '"' + String(v).replaceAll('"', '""') + '"';
  const last = rows.at(-1)?.row ?? 1;
  const byRow = new Map(rows.map((r) => [r.row, r.cells]));
  return Array.from({ length: last }, (_, i) =>
    (i === 0
      ? spec.columns.map((c) => c.label)
      : (byRow.get(i + 1) ?? spec.columns.map(() => ''))
    )
      .map(quote)
      .join('\t'),
  ).join('\n');
}
