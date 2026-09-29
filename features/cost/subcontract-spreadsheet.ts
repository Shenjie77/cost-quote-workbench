/** Workbook adapter. Only validated prices and quantities can enter formal costs. */
import type { ICellData } from '@univerjs/core';
import {
  tableWorkbook,
  type CalculationDocument,
} from '../calculation/workbook.ts';
import type {
  SubcontractCostLine,
  SubcontractSiteLine,
} from './subcontract-domain.ts';
export type EntryLine = SubcontractCostLine | SubcontractSiteLine;
export const subcontractBasis = (
  lines: EntryLine[],
  project: boolean,
  factors: number[],
) => JSON.stringify({ lines, project, factors });
const headers = (project: boolean) => [
  'Line ID',
  'Code',
  'Description',
  'Unit',
  'Unit price',
  ...(project
    ? [
        'Y1 quantity',
        'Y2 quantity',
        'Y3 quantity',
        'Y4 quantity',
        'Y5 quantity',
      ]
    : ['Quantity / site']),
  'Base amount',
];

export function subcontractWorkbook(
  lines: EntryLine[],
  project: boolean,
  factors: number[],
  name: string,
): CalculationDocument {
  const rows: Array<Array<string | number | null | ICellData>> = [
    headers(project),
  ];
  lines.forEach((line, index) => {
    const r = index + 2;
    rows.push([
      line.id,
      line.code,
      line.description,
      line.unit,
      line.unitPrice,
      ...(project
        ? (line as SubcontractCostLine).quantities
        : [(line as SubcontractSiteLine).quantityPerSite]),
      {
        f: project
          ? `=ROUNDUP(E${r}*SUM(F${r}:J${r}),2)`
          : `=ROUNDUP(E${r}*F${r},2)`,
      },
    ]);
  });
  const workbook = tableWorkbook(name.slice(0, 31), rows);
  workbook.sheets!.calculation.columnData = {
    0: { hd: 1 },
    1: { w: 140 },
    2: { w: 340 },
    3: { w: 80 },
    4: { w: 115 },
  };
  return { workbook, basis: subcontractBasis(lines, project, factors) };
}

/** Reject layout changes and stale data atomically, rather than applying a partial paste. */
export function readSubcontractWorkbook(
  document: CalculationDocument,
  lines: EntryLine[],
  project: boolean,
  factors: number[],
): EntryLine[] {
  if (document.basis !== subcontractBasis(lines, project, factors))
    throw new Error(
      'Cost inputs or annual rates changed. Download your draft, then use Reload from costs before applying.',
    );
  const cells = document.workbook.sheets?.calculation?.cellData;
  if (!cells)
    throw new Error(
      'The original cost worksheet is missing. Reload from costs.',
    );
  const heading = headers(project);
  heading.forEach((label, c) => {
    if (cells[0]?.[c]?.v !== label || cells[0]?.[c]?.f)
      throw new Error(
        'Keep the cost worksheet headers unchanged. Use extra sheets for working calculations.',
      );
  });
  const expected = new Map(lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const number = (
    cell: ICellData | undefined,
    label: string,
    nullable = false,
  ): number | null => {
    if (cell?.f && (cell.t === 4 || typeof cell.v !== 'number'))
      throw new Error(`${label}: formula must produce a valid number.`);
    const value = cell?.v;
    if (value === undefined || value === null || value === '')
      return nullable ? null : 0;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1_000_000_000_000
    )
      throw new Error(
        `${label}: enter a non-negative number, not text or an error.`,
      );
    return value;
  };
  const changes = new Map<string, EntryLine>();
  for (let r = 1; r <= lines.length; r++) {
    const row = cells[r];
    const id = row?.[0]?.v;
    const source = typeof id === 'string' ? expected.get(id) : undefined;
    if (!source || seen.has(source.id))
      throw new Error(
        'Cost rows were inserted, removed, or duplicated. Manage items through the catalog or Item details, then reload.',
      );
    seen.add(source.id);
    [source.id, source.code, source.description, source.unit].forEach(
      (value, c) => {
        if (row[c]?.v !== value || row[c]?.f)
          throw new Error(
            `Keep item identifiers unchanged (${source.code}). Use Item details to edit descriptions or units.`,
          );
      },
    );
    const price = number(row[4], `${source.code} unit price`, true);
    const quantities = Array.from(
      { length: project ? 5 : 1 },
      (_, i) => number(row[5 + i], `${source.code} quantity`) as number,
    );
    if (
      source.unit.toLowerCase() === 'pcs' &&
      quantities.some((value) => !Number.isInteger(value))
    )
      throw new Error(
        `${source.code}: quantities in pcs must be whole numbers.`,
      );
    changes.set(source.id, {
      ...source,
      unitPrice: price,
      ...(project ? { quantities } : { quantityPerSite: quantities[0] }),
    });
  }
  for (const [r, row] of Object.entries(cells)) {
    if (Number(r) <= lines.length) continue;
    if (
      Object.entries(row as Record<number, ICellData>).some(
        ([c, cell]) =>
          Number(c) < heading.length &&
          cell &&
          (cell.f ||
            (cell.v !== undefined && cell.v !== null && cell.v !== '')),
      )
    )
      throw new Error(
        'Extra cost rows cannot be applied. Add items from the catalog; use extra sheets for calculations.',
      );
  }
  return lines.map((line) => changes.get(line.id)!);
}
