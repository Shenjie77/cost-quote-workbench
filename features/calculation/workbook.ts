import type { IWorkbookData, ICellData } from '@univerjs/core';

export type CalculationDocument = {
  workbook: Partial<IWorkbookData>;
  basis?: string;
};
export type CalculationRecord = {
  id: string;
  revision: number;
  document: CalculationDocument;
  updatedAt: string;
};

/** Values remain typed: codes and leading zeroes must never become numbers. */
export function tableWorkbook(
  name: string,
  rows: Array<Array<string | number | null | ICellData>>,
): Partial<IWorkbookData> {
  const cellData: Record<number, Record<number, ICellData>> = {};
  rows.forEach((row, r) => {
    cellData[r] = {};
    row.forEach((value, c) => {
      cellData[r][c] =
        typeof value === 'object' && value !== null
          ? value
          : { v: value, t: typeof value === 'number' ? 2 : 1 };
      if (r === 0)
        cellData[r][c].s = {
          bg: { rgb: '#183c51' },
          cl: { rgb: '#ffffff' },
          bl: 1,
        };
    });
  });
  return {
    id: 'calculation-workbook',
    name,
    appVersion: '1.0.3',
    locale: 'enUS' as IWorkbookData['locale'],
    sheetOrder: ['calculation'],
    sheets: {
      calculation: {
        id: 'calculation',
        name,
        rowCount: Math.max(200, rows.length + 30),
        columnCount: 26,
        defaultColumnWidth: 120,
        defaultRowHeight: 26,
        cellData,
        columnData: { 0: { w: 180 }, 1: { w: 260 } },
        freeze: { startRow: 1, startColumn: -1, xSplit: 0, ySplit: 1 },
      },
    },
  };
}

export function initialScratchpad(): CalculationDocument {
  const workbook = tableWorkbook('Scratchpad', [
    ['Description', 'Quantity', 'Unit price', 'Amount'],
  ]);
  const examples = tableWorkbook('Formula examples', [
    ['Category', 'Quantity', 'Unit price', 'Amount'],
    ['Installation', 2, 200, { f: '=B2*C2' }],
    ['Materials', 4, 80, { f: '=B3*C3' }],
    ['Installation', 3, 150, { f: '=B4*C4' }],
    ['Total', null, null, { f: '=SUM(D2:D4)' }],
    [
      'Installation total',
      null,
      null,
      { f: '=SUMIF(A2:A4,"Installation",D2:D4)' },
    ],
    ['Quantity × price', null, null, { f: '=SUMPRODUCT(B2:B4,C2:C4)' }],
    ['Example data only. Edit Scratchpad for your own calculations.'],
  ]).sheets!.calculation;
  workbook.sheets!.examples = { ...examples, id: 'examples' };
  workbook.sheetOrder!.push('examples');
  return { workbook };
}

const endpoint = (id: string) =>
  `http://127.0.0.1:3210/api/local/calculation-drafts/${encodeURIComponent(id)}`;
export async function loadCalculation(
  id: string,
): Promise<CalculationRecord | null> {
  const response = await fetch(endpoint(id));
  const result = (await response.json()) as {
    ok: boolean;
    data: CalculationRecord;
    error?: { message?: string };
  };
  if (!response.ok || !result.ok)
    throw new Error(
      result.error?.message || 'Unable to load calculation draft.',
    );
  return result.data;
}
export async function saveCalculation(
  id: string,
  document: CalculationDocument,
  expectedRevision: number | null,
): Promise<CalculationRecord> {
  const response = await fetch(endpoint(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document, expectedRevision }),
  });
  const result = (await response.json()) as {
    ok: boolean;
    data: CalculationRecord;
    error?: { message?: string };
  };
  if (!response.ok || !result.ok)
    throw new Error(
      result.error?.message || 'Unable to save calculation draft.',
    );
  return result.data;
}
