/** Fixed-format Master Data workbooks: source rows stay separate from their field guide. */
import type { Cell, CellValue, Workbook, Worksheet } from 'exceljs';
import type JSZip from 'jszip';
import { bulkTabSpec, type BulkColumn } from './bulk-import-model.ts';
import type { GlobalMasterDataTab } from './global-types.ts';

const DATA_SHEET = 'Data';
const METADATA_SHEET = '_MasterData';
const FORMAT_MARKER = 'cost-workbench.master-data';
const FORMAT_VERSION = 1;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_DATA_ROWS = 10_000;
const MAX_COLUMNS = 128;
const MAX_MODEL_CELLS = 1_000_000;
const INPUT_COLOR = 'FF1D4ED8';

/** Parsed row numbers refer to Excel, so preview errors lead back to the right cell. */
export type BulkWorkbookRow = {
  row: number;
  values: Record<string, unknown>;
};

/** Resolves an Excel column label without asking ExcelJS to allocate a large cell range. */
function columnNumber(label: string): number {
  return label
    .toUpperCase()
    .split('')
    .reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

/** Bounds sheet dimensions and validation rectangles before the workbook parser expands them. */
function rangeSize(range: string): number {
  const match =
    /^\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/i.exec(
      range,
    );
  if (!match) throw new TypeError(`Unsupported worksheet range: ${range}`);
  const firstColumn = columnNumber(match[1]);
  const lastColumn = columnNumber(match[3] ?? match[1]);
  const firstRow = Number(match[2]);
  const lastRow = Number(match[4] ?? match[2]);
  if (
    firstColumn > lastColumn ||
    firstRow > lastRow ||
    lastColumn > MAX_COLUMNS ||
    lastRow > MAX_DATA_ROWS + 1
  ) {
    throw new TypeError(
      `Workbook range ${range} exceeds the limit of ${MAX_DATA_ROWS} data rows and ${MAX_COLUMNS} columns.`,
    );
  }
  return (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1);
}

/** Rejects oversized/non-XLSX archives and XML structures that could expand excessively in memory. */
async function inspectArchive(bytes: Uint8Array): Promise<void> {
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) {
    throw new TypeError(
      'Select a non-empty .xlsx workbook no larger than 20 MB.',
    );
  }
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  ) {
    throw new TypeError('This file is not a readable .xlsx workbook.');
  }
  const Zip = (await import('jszip')).default;
  let archive: JSZip;
  try {
    archive = await Zip.loadAsync(bytes);
  } catch {
    throw new TypeError('This file is not a readable .xlsx workbook.');
  }
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  let expandedBytes = 0;
  // JSZip exposes directory sizes before decompression; enforce the total before reading XML.
  for (const entry of entries) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || (size ?? -1) < 0) {
      throw new TypeError('The workbook archive has invalid entry sizes.');
    }
    expandedBytes += size!;
  }
  if (expandedBytes > MAX_EXPANDED_BYTES || entries.length > 1_000) {
    throw new TypeError(
      'The expanded workbook exceeds the supported size (50 MB).',
    );
  }
  const contentTypes = await archive
    .file('[Content_Types].xml')
    ?.async('string');
  if (
    !archive.file('xl/workbook.xml') ||
    !contentTypes?.includes(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    ) ||
    entries.some((entry) => /(?:^|\/)vbaProject\.bin$/i.test(entry.name))
  ) {
    throw new TypeError(
      'Use a standard .xlsx workbook downloaded from this tab.',
    );
  }
  const sheets = entries.filter((entry) =>
    /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name),
  );
  if (sheets.length > 16)
    throw new TypeError('The import workbook contains too many worksheets.');
  let modelCells = 0;
  for (const entry of sheets) {
    const xml = await entry.async('string');
    // Import tables never contain merged cells. Reject them rather than silently duplicate values.
    if (/<(?:\w+:)?mergeCell\b/.test(xml)) {
      throw new TypeError(
        'Merged cells are not supported in Master Data import workbooks.',
      );
    }
    for (const match of xml.matchAll(
      /<(?:\w+:)?(?:dimension|c)\b[^>]*\b(?:ref|r)\s*=\s*(["'])(.*?)\1/g,
    )) {
      rangeSize(match[2]);
    }
    for (const match of xml.matchAll(
      /<(?:\w+:)?row\b[^>]*\br\s*=\s*(["'])(.*?)\1/g,
    )) {
      rangeSize(`A${match[2]}`);
    }
    for (const match of xml.matchAll(
      /<(?:\w+:)?col\b[^>]*\bmax\s*=\s*(["'])(.*?)\1/g,
    )) {
      const lastColumn = Number(match[2]);
      if (
        !Number.isInteger(lastColumn) ||
        lastColumn < 1 ||
        lastColumn > MAX_COLUMNS
      ) {
        throw new TypeError(
          `Workbook column styles exceed the limit of ${MAX_COLUMNS} columns.`,
        );
      }
    }
    modelCells += [...xml.matchAll(/<(?:\w+:)?c\b/g)].length;
    for (const match of xml.matchAll(
      /<(?:\w+:)?dataValidation\b[^>]*\bsqref\s*=\s*(["'])(.*?)\1/g,
    )) {
      for (const range of match[2].trim().split(/\s+/))
        modelCells += rangeSize(range);
    }
    if (modelCells > MAX_MODEL_CELLS) {
      throw new TypeError(
        'The workbook contains too many cells or validation ranges.',
      );
    }
  }
}

/** Gives both the exact Excel location and a readable field name in validation failures. */
function cellError(
  cell: Cell,
  message: string,
  column?: BulkColumn,
): TypeError {
  return new TypeError(
    `${cell.worksheet.name}!${cell.address}${column ? ` (${column.label})` : ''}: ${message}`,
  );
}

/** Reads literal cell content only; formula caches, hyperlinks and Excel errors are never trusted. */
function literalCellValue(
  cell: Cell,
): string | number | boolean | Date | undefined {
  const value = cell.value;
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'object' || value instanceof Date) return value;
  if ('formula' in value || 'sharedFormula' in value) {
    throw cellError(
      cell,
      'Formulas are not accepted. Paste their values before importing.',
    );
  }
  if ('error' in value) throw cellError(cell, `Excel error ${value.error}.`);
  if ('richText' in value)
    return value.richText.map((part) => part.text).join('');
  throw cellError(cell, 'Use a plain text, number, date or boolean cell.');
}

/** Checks actual calendar dates, including leap days, without local-time or date-serial guesses. */
function isoDate(value: string | Date, cell: Cell, column: BulkColumn): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw cellError(cell, 'Invalid date.', column);
    value = value.toISOString().slice(0, 10);
  }
  const text = value.trim();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw cellError(cell, 'Use a valid date in YYYY-MM-DD format.', column);
  }
  return text;
}

/** Converts one input cell according to the same field specification used by the preview model. */
function readField(cell: Cell, column: BulkColumn): unknown {
  const raw = literalCellValue(cell);
  if (raw === undefined || (typeof raw === 'string' && !raw.trim()))
    return undefined;
  if (column.kind === 'date') {
    if (typeof raw !== 'string' && !(raw instanceof Date)) {
      throw cellError(
        cell,
        'Use a date cell or YYYY-MM-DD text; numeric date serials are not accepted.',
        column,
      );
    }
    return isoDate(raw, cell, column);
  }
  if (raw instanceof Date)
    throw cellError(cell, 'A date is not valid for this field.', column);
  if (column.kind === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const text = String(raw).trim().toLowerCase();
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
    throw cellError(cell, 'Use TRUE or FALSE.', column);
  }
  if (column.kind === 'number' || column.kind === 'integer') {
    const text = String(raw).trim();
    if (
      typeof raw === 'boolean' ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    ) {
      throw cellError(
        cell,
        'Use a numeric value without currency symbols or separators.',
        column,
      );
    }
    const number = Number(text);
    if (
      !Number.isFinite(number) ||
      (column.kind === 'integer' && !Number.isSafeInteger(number))
    ) {
      throw cellError(
        cell,
        column.kind === 'integer'
          ? 'Use a safe whole number.'
          : 'Use a finite number.',
        column,
      );
    }
    return number;
  }
  if (column.kind === 'list') {
    if (typeof raw !== 'string')
      throw cellError(
        cell,
        'Use one item per line, or a JSON text array.',
        column,
      );
    if (raw.trim().startsWith('[')) {
      let list: unknown;
      try {
        list = JSON.parse(raw);
      } catch {
        throw cellError(cell, 'The JSON list is invalid.', column);
      }
      if (
        !Array.isArray(list) ||
        list.some((item) => typeof item !== 'string')
      ) {
        throw cellError(
          cell,
          'The JSON list must contain only text values.',
          column,
        );
      }
      return list;
    }
    return raw
      .split(/[\r\n;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  // Text IDs are read from their stored text, never from a number format that could change identity.
  return String(raw);
}

/** Serializes only literal scalar values; list delimiters inside an item use JSON for lossless export. */
function exportField(value: unknown, column: BulkColumn): CellValue {
  if (value === undefined || value === null) return null;
  if (column.kind === 'list' && Array.isArray(value)) {
    const strings = value.map(String);
    return strings.length === 0 ||
      strings.some((item) => /[\r\n;]/.test(item)) ||
      strings[0]?.trim().startsWith('[')
      ? JSON.stringify(strings)
      : strings.join('\n');
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return value;
  throw new TypeError(
    `Cannot export ${column.label}: expected a flattened literal value.`,
  );
}

/** Adds compact table styling without creating thousands of empty data rows. */
function styleTable(sheet: Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).height = 26;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF334155' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

/** Records the tab and format version outside editable rows so a different catalog cannot be imported accidentally. */
function addMetadata(workbook: Workbook, tab: GlobalMasterDataTab): void {
  const metadata = workbook.addWorksheet(METADATA_SHEET, {
    state: 'veryHidden',
  });
  metadata.addRows([
    [FORMAT_MARKER],
    ['version', FORMAT_VERSION],
    ['tab', tab],
  ]);
}

/** Creates an empty template, or fills its Data sheet with already-flattened catalog records. */
export async function createBulkImportWorkbook(
  tab: GlobalMasterDataTab,
  items: Record<string, unknown>[] = [],
): Promise<Uint8Array> {
  if (items.length > MAX_DATA_ROWS)
    throw new TypeError(`Export supports at most ${MAX_DATA_ROWS} records.`);
  const spec = bulkTabSpec(tab);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost & Quote Workbench';
  const sheet = workbook.addWorksheet(DATA_SHEET);
  sheet.columns = spec.columns.map((column) => ({
    key: column.key,
    header: column.key,
    width: Math.max(16, Math.min(42, column.key.length + 5)),
    style: {
      font: { name: 'Calibri', size: 11, color: { argb: INPUT_COLOR } },
      alignment: { vertical: 'top', wrapText: true },
      numFmt:
        column.kind === 'number'
          ? '0.########'
          : column.kind === 'integer'
            ? '0'
            : column.kind === 'date'
              ? 'yyyy-mm-dd'
              : '@',
    },
  }));
  for (const item of items)
    sheet.addRow(
      spec.columns.map((column) => exportField(item[column.key], column)),
    );
  for (const [index, column] of spec.columns.entries()) {
    const options =
      column.kind === 'boolean' ? ['TRUE', 'FALSE'] : column.options;
    if (!options?.length) continue;
    // Excel's inline validation list has a 255-character limit. All supported enums fit it.
    const formula = `"${options.join(',')}"`;
    if (
      formula.length > 255 ||
      options.some((option) => /[,"\r\n]/.test(option))
    )
      continue;
    const label = sheet.getColumn(index + 1).letter;
    const validations = sheet as Worksheet & {
      dataValidations: { add: (range: string, rule: unknown) => void };
    };
    validations.dataValidations.add(`${label}2:${label}${MAX_DATA_ROWS + 1}`, {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorTitle: 'Invalid value',
      error: `Choose one of: ${options.join(', ')}`,
    });
  }
  styleTable(sheet);
  const guide = workbook.addWorksheet('Guide');
  guide.columns = [
    { header: 'Field key', key: 'key', width: 26 },
    { header: 'Label', key: 'label', width: 28 },
    { header: 'Type', key: 'kind', width: 14 },
    { header: 'Required for new row', key: 'required', width: 22 },
    { header: 'Allowed values', key: 'options', width: 36 },
    { header: 'Example (not imported)', key: 'example', width: 34 },
    { header: 'Description / usage', key: 'description', width: 90 },
  ];
  for (const column of spec.columns) {
    guide.addRow({
      ...column,
      required: column.required ? 'Yes' : 'No',
      options: column.options?.join('\n') ?? '',
    });
  }
  guide.addRows([
    [],
    [
      'Template',
      spec.label,
      '',
      '',
      '',
      '',
      'Fill Data starting at row 2. Guide examples are never imported. Keep every field key and the hidden format sheet; columns may be reordered.',
    ],
    [
      'Updates',
      '',
      '',
      '',
      '',
      '',
      'Rows match their existing ID/code. Blank optional cells preserve existing values. Use [] to explicitly clear a list. Review the import preview before applying changes.',
    ],
    [
      'Lists',
      '',
      '',
      '',
      '',
      '',
      'One item per line (Alt+Enter in Excel), semicolon-separated text, or a JSON string array. Use a JSON array when a single item contains a line break or semicolon.',
    ],
    [
      'Values',
      '',
      '',
      '',
      '',
      '',
      'Dates: YYYY-MM-DD or Excel date cells. Booleans: TRUE/FALSE. Numeric fields: numbers without separators. Keep identifiers as text to retain leading zeros. Formulas are not imported; paste values first.',
    ],
    [
      'Limits',
      '',
      '',
      '',
      '',
      '',
      `Up to ${MAX_DATA_ROWS} data rows and 20 MB per .xlsx workbook. Only the Data worksheet is imported.`,
    ],
  ]);
  guide.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
  styleTable(guide);
  addMetadata(workbook, tab);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Parses a tab-specific workbook without changing any catalog; the caller validates and previews all returned rows. */
export async function readBulkImportWorkbook(
  tab: GlobalMasterDataTab,
  bytes: Uint8Array,
): Promise<BulkWorkbookRow[]> {
  await inspectArchive(bytes);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as never);
  } catch {
    throw new TypeError(
      'This .xlsx workbook could not be read. Download a fresh template from this tab.',
    );
  }
  const metadata = workbook.getWorksheet(METADATA_SHEET);
  if (
    !metadata ||
    literalCellValue(metadata.getCell('A1')) !== FORMAT_MARKER ||
    literalCellValue(metadata.getCell('B2')) !== FORMAT_VERSION
  ) {
    throw new TypeError(
      'The Master Data template format/version is missing or unsupported. Download a fresh template from this tab.',
    );
  }
  if (literalCellValue(metadata.getCell('B3')) !== tab) {
    throw new TypeError(
      `This workbook belongs to a different Master Data tab. Download the ${bulkTabSpec(tab).label} template.`,
    );
  }
  const sheet = workbook.getWorksheet(DATA_SHEET);
  if (!sheet)
    throw new TypeError(
      'The workbook must contain its original Data worksheet.',
    );
  if (sheet.rowCount > MAX_DATA_ROWS + 1 || sheet.columnCount > MAX_COLUMNS) {
    throw new TypeError(
      `The Data worksheet exceeds ${MAX_DATA_ROWS} rows or ${MAX_COLUMNS} columns.`,
    );
  }
  const spec = bulkTabSpec(tab);
  const fields = new Map(spec.columns.map((column) => [column.key, column]));
  const headers = new Map<number, BulkColumn>();
  const seen = new Set<string>();
  for (let index = 1; index <= sheet.columnCount; index += 1) {
    const cell = sheet.getCell(1, index);
    const value = literalCellValue(cell);
    if (value === undefined) {
      // Completely empty trailing columns are harmless; data below an unnamed header is not.
      if (
        sheet
          .getColumn(index)
          .values.some(
            (entry) => entry !== null && entry !== undefined && entry !== '',
          )
      ) {
        throw cellError(cell, 'A field key is required for this column.');
      }
      continue;
    }
    const key = String(value).trim();
    const column = fields.get(key);
    if (!column)
      throw cellError(
        cell,
        `Unknown field key "${key}". Use this tab's downloaded template.`,
      );
    if (seen.has(key)) throw cellError(cell, `Duplicate field key "${key}".`);
    seen.add(key);
    headers.set(index, column);
  }
  const missing = spec.columns.filter((column) => !seen.has(column.key));
  if (missing.length)
    throw new TypeError(
      `Data row 1 is missing field keys: ${missing.map((column) => column.key).join(', ')}.`,
    );
  const rows: BulkWorkbookRow[] = [];
  for (let number = 2; number <= sheet.rowCount; number += 1) {
    const values: Record<string, unknown> = {};
    for (const [index, column] of headers) {
      const value = readField(sheet.getCell(number, index), column);
      if (value !== undefined) values[column.key] = value;
    }
    if (Object.keys(values).length) rows.push({ row: number, values });
  }
  return rows;
}
