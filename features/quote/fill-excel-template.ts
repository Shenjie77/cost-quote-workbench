import { structuredBodyRows } from './structured-body.ts';
import { regionMatches } from './quotation-groups.ts';
/** Fills an immutable customer XLSX copy using one repeatable quotation row. */

import type {
  Cell,
  CellValue,
  ConditionalFormattingOptions,
  Row,
  RowModel,
  RowBreak,
  Style,
  Workbook,
  Worksheet,
} from 'exceljs';
import type JSZip from 'jszip';
import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import type {
  QuoteExcelAsset,
  QuoteExcelField,
  QuoteLine,
} from './excel-template-types.ts';
import {
  MAX_QUOTE_TEMPLATE_ROW,
  validateQuoteExcelMapping,
} from './excel-template-mapping.ts';
import { validateQuoteLines } from './quote-lines.ts';
import { assertValidQuotePricing } from './export-validation.ts';
import { isRetiredQuoteAssumption } from './types.ts';
import { renderTemplateText, templateDate } from './template-text.ts';
import { customerDocument } from './customer-document.ts';

const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_EXCEL_ROW = 1_048_576;
const MAX_MODEL_CELLS = 200_000;

type Reference = { column: string; row: number; fixedRow: boolean };
type RowSnapshot = {
  number: number;
  height: number | undefined;
  style: Partial<Style>;
  hidden: boolean;
  outlineLevel: number;
  cells: Array<{
    column: number;
    value: CellValue;
    style: Partial<Style>;
    note: Cell['note'] | undefined;
  }>;
};

/** ExcelJS exposes these documented model features without corresponding worksheet declarations. */
type WorksheetFeatures = Worksheet & {
  rowBreaks: RowBreak[];
  conditionalFormattings: ConditionalFormattingOptions[];
};

/** Reads an A1 address while preserving absolute markers for formula copying. */
function parseReference(address: string): Reference {
  const match = /^(\$?[A-Z]{1,3})(\$?)([1-9]\d*)$/i.exec(address);
  if (!match) throw new Error(`Unsupported Excel cell address: ${address}.`);
  return {
    column: match[1],
    fixedRow: match[2] === '$',
    row: Number(match[3]),
  };
}

/** Changes only the row portion of a valid A1 address. */
function withRow(address: string, row: number): string {
  if (row < 1 || row > MAX_EXCEL_ROW)
    throw new Error('Quotation rows exceed the Excel worksheet limit.');
  const reference = parseReference(address);
  return `${reference.column}${reference.fixedRow ? '$' : ''}${row}`;
}

/** Bounds ranges that ExcelJS expands into one in-memory object per cell. */
function rangeCellCount(range: string): number {
  const [start, end = start] = range.split('!').at(-1)!.split(':');
  const first = parseReference(start);
  const last = parseReference(end);
  if (first.row > MAX_QUOTE_TEMPLATE_ROW || last.row > MAX_QUOTE_TEMPLATE_ROW)
    throw new Error(
      'The XLSX template supports at most 20,000 rows per worksheet. Remove unused rows and range references below the template.',
    );
  /** Converts column letters to their bounded worksheet ordinal. */
  const columnNumber = (column: string) =>
    column
      .replace('$', '')
      .toUpperCase()
      .split('')
      .reduce(
        (number, character) => number * 26 + character.charCodeAt(0) - 64,
        0,
      );
  return (
    (Math.abs(last.row - first.row) + 1) *
    (Math.abs(columnNumber(last.column) - columnNumber(first.column)) + 1)
  );
}

/** Removes string literals before looking for unsupported formula syntax. */
function formulaCode(formula: string): string {
  return formula.replace(/"(?:[^"]|"")*"/g, '""');
}

/** Rejects reference constructs whose meaning cannot be safely moved as A1 cells. */
function assertSupportedFormula(formula: string): void {
  const code = formulaCode(formula);
  if (
    /\[|\]|\b(?:INDIRECT|OFFSET)\s*\(|(?:^|[^A-Z0-9_])\$?\d+:\$?\d+|(?:'[^']*'|[A-Z0-9_]+):(?:'[^']*'|[A-Z0-9_]+)!/i.test(
      code,
    )
  ) {
    throw new Error(
      'This XLSX uses structured, external, 3D, whole-row, INDIRECT, or OFFSET references. Save a template copy using ordinary A1 cell formulas.',
    );
  }
}

/** Decodes a quoted worksheet name; doubled apostrophes are Excel escapes. */
function sheetNameOf(qualifier: string | undefined, fallback: string): string {
  if (!qualifier) return fallback;
  return qualifier.startsWith("'")
    ? qualifier.slice(1, -1).replace(/''/g, "'")
    : qualifier;
}

/** Moves A1 references after insertion, then applies normal relative-row copying. */
function moveFormula(
  formula: string,
  sourceSheet: string,
  changedSheet: string,
  detailRow: number,
  addedRows: number,
  copyOffset = 0,
  expandDetailRange = true,
): string {
  assertSupportedFormula(formula);
  // Excel often writes a one-line subtotal as SUM(F5), rather than SUM(F5:F5).
  // Make that explicit range grow with the lines, while copied detail formulas stay local.
  const aggregate =
    /"(?:[^"]|"")*"|\b(SUM|AVERAGE|COUNT|COUNTA|MIN|MAX)\s*\(\s*((?:('(?:[^']|'')+'|[A-Z_\u0080-\uFFFF][A-Z0-9_.\u0080-\uFFFF]*)!)?)(\$?[A-Z]{1,3}\$?[1-9]\d*)\s*\)/gi;
  const withDetailTotals =
    expandDetailRange && addedRows
      ? formula.replace(
          aggregate,
          (
            match,
            name: string | undefined,
            qualified: string,
            referencedSheet: string | undefined,
            address: string,
          ) => {
            if (
              !name ||
              parseReference(address).row !== detailRow ||
              sheetNameOf(referencedSheet, sourceSheet).toLocaleLowerCase() !==
                changedSheet.toLocaleLowerCase()
            )
              return match;
            return `${name}(${qualified}${address}:${address})`;
          },
        )
      : formula;
  // Match string literals first so quotation text containing A1 is never rewritten.
  const token =
    /"(?:[^"]|"")*"|(?<![A-Z0-9_.])(?:(('(?:[^']|'')+'|[A-Z_\u0080-\uFFFF][A-Z0-9_.\u0080-\uFFFF]*)!))?(\$?[A-Z]{1,3}\$?[1-9]\d{0,6})(?::(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}))?(?![A-Z0-9_.(])/gi;
  return withDetailTotals.replace(
    token,
    (
      match,
      qualified: string | undefined,
      name: string | undefined,
      start: string | undefined,
      end: string | undefined,
    ) => {
      if (match.startsWith('"') || !start) return match;
      const affected =
        sheetNameOf(name, sourceSheet).toLocaleLowerCase() ===
        changedSheet.toLocaleLowerCase();
      /** Moves structural references regardless of $, and copied references only when relative. */
      const shift = (address: string, isRangeEnd: boolean) => {
        const reference = parseReference(address);
        let row = reference.row;
        if (
          affected &&
          (row > detailRow ||
            (isRangeEnd && expandDetailRange && row === detailRow))
        )
          row += addedRows;
        if (!reference.fixedRow) row += copyOffset;
        return withRow(address, row);
      };
      return `${qualified ?? ''}${shift(start, false)}${end ? `:${shift(end, true)}` : ''}`;
    },
  );
}

/** Updates a worksheet-local range used by print areas, filters, and formatting. */
function moveRange(
  range: string,
  sheetName: string,
  detailRow: number,
  addedRows: number,
): string {
  // A singleton validation/format range on the pattern applies to every output line.
  const expanded = range.replace(
    /(?<![A-Z0-9_$:])(\$?[A-Z]{1,3}\$?[1-9]\d*)(?![A-Z0-9_$:])/gi,
    (address) =>
      parseReference(address).row === detailRow
        ? `${address}:${address}`
        : address,
  );
  return moveFormula(expanded, sheetName, sheetName, detailRow, addedRows);
}

/** Checks the ZIP before parsing so unsupported workbook objects are never silently discarded. */
async function inspectArchive(bytes: Uint8Array): Promise<JSZip> {
  if (!bytes.byteLength || bytes.byteLength > MAX_COMPRESSED_BYTES)
    throw new Error(
      'The XLSX template must be a non-empty file no larger than 10 MiB.',
    );
  const JSZip = (await import('jszip')).default;
  let archive;
  try {
    archive = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('This file is not a readable .xlsx workbook.');
  }
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  // JSZip exposes ZIP directory sizes before inflation; cap those before any XML load.
  const expandedSize = entries.reduce(
    (size, entry) =>
      size +
      ((entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0),
    0,
  );
  if (expandedSize > MAX_EXPANDED_BYTES || entries.length > 2_000)
    throw new Error(
      'The expanded XLSX template exceeds the supported size (50 MiB).',
    );
  if (!archive.file('xl/workbook.xml'))
    throw new Error('This file is not an Excel .xlsx workbook.');
  if (
    entries.some((entry) =>
      /^xl\/(?:charts|pivot|slicer|externalLinks|embeddings|activeX|ctrlProps|queryTables|connections|vbaProject|threadedComments|richData)|^_xmlsignatures\//i.test(
        entry.name,
      ),
    )
  ) {
    throw new Error(
      'This XLSX contains charts, pivot tables, external data, macros, embedded objects, or digital signatures. Save a plain quotation-template copy without these objects.',
    );
  }
  // ExcelJS supports pictures but drops DrawingML shapes and chart frames.
  const drawingEntries = entries.filter((entry) =>
    /^xl\/drawings\/[^/]+\.xml$/i.test(entry.name),
  );
  for (const entry of drawingEntries) {
    if (
      /<(?:\w+:)?(?:sp|cxnSp|graphicFrame|grpSp)\b/.test(
        await entry.async('string'),
      )
    )
      throw new Error(
        'This XLSX contains drawing shapes or text boxes. Replace them with cell text or pictures in the template copy.',
      );
  }
  // Tiny ZIPs can declare enormous merge/validation rectangles; bound them before ExcelJS expands them.
  let modelCells = 0;
  for (const entry of entries.filter((file) =>
    /^xl\/worksheets\/[^/]+\.xml$/i.test(file.name),
  )) {
    const xml = await entry.async('string');
    const dimension = /<dimension\b[^>]*ref="([^"]+)"/.exec(xml)?.[1];
    if (dimension) rangeCellCount(dimension);
    modelCells += [...xml.matchAll(/<c\b/g)].length;
    for (const match of xml.matchAll(
      /<(?:mergeCell|dataValidation)\b[^>]*\b(?:ref|sqref)="([^"]+)"/g,
    )) {
      for (const range of match[1].split(/\s+/))
        modelCells += rangeCellCount(range);
    }
    if (modelCells > MAX_MODEL_CELLS)
      throw new Error(
        'The XLSX template expands to too many cells. Limit formatted, merged, and validated template ranges to 200,000 cells.',
      );
  }
  // Formula-defined names and sheet-local names do not round-trip through ExcelJS.
  const workbookXml = await archive.file('xl/workbook.xml')!.async('string');
  for (const match of workbookXml.matchAll(
    /<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g,
  )) {
    if (
      /name="_xlnm\.(?:Print_Area|Print_Titles|_FilterDatabase)"/.test(match[1])
    )
      continue;
    const address = match[2].replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    if (
      /localSheetId=/.test(match[1]) ||
      !/^(?:'[^']*(?:''[^']*)*'|[^!=,+()]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.test(
        address,
      )
    ) {
      throw new Error(
        'This XLSX contains a formula-based or sheet-local defined name. Use ordinary workbook-level cell ranges in the template copy.',
      );
    }
    modelCells += rangeCellCount(address);
    if (modelCells > MAX_MODEL_CELLS)
      throw new Error(
        'The XLSX template defines too many cells. Limit named ranges to the used quotation area.',
      );
  }
  return archive;
}

/** Decodes XML attributes used for workbook relationships and numeric page breaks. */
function xmlAttributes(element: string): Record<string, string> {
  return Object.fromEntries(
    [...element.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    ]),
  );
}

/** Restores manual page breaks that ExcelJS reads but omits from its worksheet model. */
async function restorePageBreaks(
  archive: JSZip,
  workbook: Workbook,
): Promise<void> {
  const relations = await archive
    .file('xl/_rels/workbook.xml.rels')
    ?.async('string');
  const workbookXml = await archive.file('xl/workbook.xml')!.async('string');
  const targets = new Map(
    [...(relations?.matchAll(/<Relationship\b[^>]*\/>/g) ?? [])].map(
      (match) => {
        const attrs = xmlAttributes(match[0]);
        return [attrs.Id, attrs.Target];
      },
    ),
  );
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/>/g)) {
    const attrs = xmlAttributes(match[0]);
    const target = targets.get(attrs['r:id']);
    const sheet = workbook.getWorksheet(attrs.name) as
      | WorksheetFeatures
      | undefined;
    if (!target || !sheet) continue;
    const parts: string[] = [];
    for (const part of (target.startsWith('/')
      ? target.slice(1)
      : `xl/${target}`
    ).split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    const xml = await archive.file(parts.join('/'))?.async('string');
    const breaks = /<rowBreaks\b[^>]*>([\s\S]*?)<\/rowBreaks>/.exec(
      xml ?? '',
    )?.[1];
    sheet.rowBreaks = [...(breaks?.matchAll(/<brk\b[^>]*\/>/g) ?? [])].map(
      (entry) => {
        const values = xmlAttributes(entry[0]);
        return {
          id: Number(values.id),
          min: Number(values.min ?? 0),
          max: Number(values.max ?? 16383),
          man: Number(values.man ?? 1),
        };
      },
    );
  }
}

/** Loads a validated local workbook without retaining the caller's byte array. */
async function loadTemplate(bytes: Uint8Array): Promise<Workbook> {
  const archive = await inspectArchive(bytes);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new Error(
      'The XLSX workbook cannot be read. Open and save it as .xlsx in Excel, then upload it again.',
    );
  }
  if (!workbook.worksheets.length)
    throw new Error('The XLSX template does not contain any worksheets.');
  if (
    workbook.worksheets.some((sheet) => sheet.rowCount > MAX_QUOTE_TEMPLATE_ROW)
  )
    throw new Error(
      'The XLSX template supports at most 20,000 rows per worksheet. Remove unused rows below the template.',
    );
  await restorePageBreaks(archive, workbook);
  // Expand shared formulas before moving rows; array/spill formulas cannot be repeated safely.
  const formulas: Array<{
    sheet: Worksheet;
    address: string;
    formula: string;
  }> = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type !== ExcelJS.ValueType.Formula) return;
        const value = cell.value as { shareType?: string; ref?: string };
        if (
          value.shareType === 'array' ||
          (value.ref && value.shareType !== 'shared')
        )
          throw new Error(
            'Array or spill formulas are not supported in quotation templates. Use ordinary row formulas.',
          );
        assertSupportedFormula(cell.formula);
        formulas.push({ sheet, address: cell.address, formula: cell.formula });
      }),
    );
  });
  formulas.forEach(({ sheet, address, formula }) => {
    sheet.getCell(address).value = { formula };
  });
  return workbook;
}

/** Returns safe sheet names/dimensions and fails early for unsupported XLSX features. */
export async function inspectQuoteExcelWorkbook(
  buffer: Uint8Array | ArrayBuffer,
): Promise<QuoteExcelAsset['sheets']> {
  const workbook = await loadTemplate(
    new Uint8Array(buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer),
  );
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
  }));
}

/** Captures values and formatting, keeping cells independent when the row is repeated. */
function snapshotRow(row: Row): RowSnapshot {
  const cells: RowSnapshot['cells'] = [];
  (row.model?.cells ?? []).forEach((saved) => {
    // Visit stored cells only; a distant formatted column must not materialize every gap.
    // Runtime cell models contain A1 strings; ExcelJS's declaration incorrectly uses Address.
    const cell = row.worksheet.getCell(saved.address as unknown as string);
    cells.push({
      column: Number(cell.col),
      value:
        cell.isMerged && cell.master.address !== cell.address
          ? null
          : structuredClone(cell.value),
      style: structuredClone(cell.style),
      note: structuredClone(cell.note),
    });
  });
  return {
    number: row.number,
    height: row.height,
    style: structuredClone(row.model?.style ?? {}),
    hidden: row.hidden,
    outlineLevel: row.outlineLevel ?? 0,
    cells,
  };
}

/** Restores one snapshot at its output row and rewrites its formula dependencies. */
function restoreRow(
  sheet: Worksheet,
  snapshot: RowSnapshot,
  targetRow: number,
  detailRow: number,
  addedRows: number,
  copyOffset = 0,
): void {
  const row = sheet.getRow(targetRow);
  row.values = [];
  if (snapshot.height === undefined) delete (row as { height?: number }).height;
  else row.height = snapshot.height;
  (row as Row & { style: Partial<Style> }).style = structuredClone(
    snapshot.style,
  );
  row.hidden = snapshot.hidden;
  row.outlineLevel = snapshot.outlineLevel;
  for (const saved of snapshot.cells) {
    const cell = row.getCell(saved.column);
    const value = structuredClone(saved.value);
    // Detail formulas copy relative references; footer formulas expand the detail range.
    cell.value =
      value &&
      typeof value === 'object' &&
      'formula' in value &&
      typeof value.formula === 'string'
        ? {
            formula: moveFormula(
              value.formula,
              sheet.name,
              sheet.name,
              detailRow,
              addedRows,
              copyOffset,
              snapshot.number !== detailRow,
            ),
          }
        : value;
    cell.style = structuredClone(saved.style);
    if (saved.note !== undefined)
      cell.note = structuredClone(saved.note) as typeof cell.note;
  }
}

/** Checks that mapping targets are writable masters and a complete single-row pattern. */
function validateGeometry(sheet: Worksheet, input: QuoteWorkbookInput): void {
  const mapping = input.template.excel!;
  const addresses = [
    ...Object.values(mapping.columns).map(
      (column) => `${column}${mapping.detailRow}`,
    ),
    ...Object.values(mapping.cells),
    ...(mapping.textCells ?? []).map((cell) => cell.address),
  ];
  for (const address of addresses) {
    const cell = sheet.getCell(address!);
    if (cell.isMerged && cell.master.address !== cell.address)
      throw new Error(
        `${address} is part of a merged cell. Map its top-left cell ${cell.master.address} instead.`,
      );
  }
  for (const range of sheet.model.merges) {
    const [start, end = start] = range.split(':');
    const top = parseReference(start).row;
    const bottom = parseReference(end).row;
    if (
      top <= mapping.detailRow &&
      bottom >= mapping.detailRow &&
      top !== bottom
    )
      throw new Error(
        'The detail row contains a vertical merged cell. Use one repeatable row with horizontal merges only.',
      );
  }
  if (sheet.getTables().length)
    throw new Error(
      'The quotation sheet contains an Excel Table. Convert it to a normal range in the template copy before mapping the repeatable row.',
    );
}

/** Extends worksheet features whose row positions ExcelJS spliceRows does not adjust. */
function moveWorksheetFeatures(
  workbook: Workbook,
  sheet: Worksheet,
  detailRow: number,
  addedRows: number,
): void {
  if (!addedRows) return;
  // Print areas and footer page breaks follow inserted rows; title rows remain fixed headers.
  if (sheet.pageSetup.printArea)
    sheet.pageSetup.printArea = moveRange(
      sheet.pageSetup.printArea,
      sheet.name,
      detailRow,
      addedRows,
    );
  if (sheet.pageSetup.printTitlesRow) {
    const [top, bottom = top] = sheet.pageSetup.printTitlesRow
      .split(':')
      .map(Number);
    sheet.pageSetup.printTitlesRow = `${top > detailRow ? top + addedRows : top}:${bottom >= detailRow ? bottom + addedRows : bottom}`;
  }
  (sheet as WorksheetFeatures).rowBreaks.forEach((pageBreak) => {
    if (pageBreak.id >= detailRow) pageBreak.id += addedRows;
  });
  if (typeof sheet.autoFilter === 'string')
    sheet.autoFilter = moveRange(
      sheet.autoFilter,
      sheet.name,
      detailRow,
      addedRows,
    );
  else if (sheet.autoFilter)
    throw new Error(
      'The template uses an unsupported automatic-filter range. Save the template in Excel and upload it again.',
    );
  // Preserve picture offsets while moving zero-based anchors below the inserted rows.
  for (const image of sheet.getImages()) {
    for (const anchor of [image.range.tl, image.range.br]) {
      if (anchor && anchor.nativeRow >= detailRow)
        anchor.nativeRow += addedRows;
    }
  }
  // Named ranges are moved explicitly because spliceRows only shifts, rather than expands, them.
  workbook.definedNames.model = workbook.definedNames.model.map((name) => ({
    ...name,
    ranges: name.ranges.map((range) =>
      moveRange(range, sheet.name, detailRow, addedRows),
    ),
  }));
  workbook.eachSheet((target) => {
    // Conditional formulas on other sheets can also refer to the resized quotation sheet.
    (target as WorksheetFeatures).conditionalFormattings.forEach((format) => {
      if (target === sheet)
        format.ref = moveRange(format.ref, sheet.name, detailRow, addedRows);
      format.rules.forEach((rule) => {
        if ('formulae' in rule && rule.formulae)
          rule.formulae = rule.formulae.map((formula) =>
            typeof formula === 'string'
              ? moveFormula(
                  formula,
                  target.name,
                  sheet.name,
                  detailRow,
                  addedRows,
                  0,
                  false,
                )
              : formula,
          );
        if ('cfvo' in rule && rule.cfvo)
          rule.cfvo.forEach((point) => {
            // Formula-valued color scales use strings that ExcelJS's declarations omit.
            const threshold = point as {
              type: string;
              value?: number | string;
            };
            if (
              threshold.type === 'formula' &&
              typeof threshold.value === 'string'
            )
              threshold.value = moveFormula(
                threshold.value,
                target.name,
                sheet.name,
                detailRow,
                addedRows,
                0,
                false,
              );
          });
      });
    });
    // Data validations are stored as an address/range-to-rule map by ExcelJS.
    const validations = (
      target as unknown as {
        dataValidations: {
          model: Record<string, { formulae?: Array<string | number | Date> }>;
        };
      }
    ).dataValidations;
    validations.model = Object.fromEntries(
      Object.entries(validations.model).map(([address, validation]) => {
        const moved = structuredClone(validation);
        if (moved.formulae)
          moved.formulae = moved.formulae.map((formula) =>
            typeof formula === 'string'
              ? moveFormula(
                  formula,
                  target.name,
                  sheet.name,
                  detailRow,
                  addedRows,
                  0,
                  false,
                )
              : formula,
          );
        return [
          target === sheet
            ? moveRange(address, sheet.name, detailRow, addedRows)
            : address,
          moved,
        ];
      }),
    );
  });
}

/** Supplies only customer-facing metadata and commercial amounts to mapped cells. */
function quoteFieldValues(
  input: QuoteWorkbookInput,
): Record<string, string | number | null> {
  return {
    date: templateDate(input),
    optionalPrice: customerDocument(input).optionalAmount,
    companyName: input.template.excel?.variables?.companyName ?? '',
    companyAddress: input.template.excel?.variables?.companyAddress ?? '',
    documentStatus: input.documentStatus ?? 'Final',
    maintenancePrice:
      input.template.excel?.body || input.template.excel?.regions?.length
        ? customerDocument(input).maintenanceAmount
        : 0,
    quoteNumber:
      input.documentStatus === 'Draft' &&
      !input.quoteNumber.startsWith('DRAFT-')
        ? `DRAFT-${input.quoteNumber}`
        : input.quoteNumber,
    client: input.project.client,
    project: input.project.name,
    costVersion: input.costVersion,
    currency: input.project.currency,
    documentTitle: input.template.documentTitle,
    validityDays: input.template.validityDays,
    paymentTerms: input.template.paymentTerms,
    termsAndConditions: input.template.termsAndConditions,
    assumptions: input.assumptions
      .filter((assumption) => assumption.included)
      .map((assumption) => assumption.text)
      .join('\n'),
    servicePrice: input.pricing.listPrice,
    discount: input.pricing.discount,
    quoteBeforeTax:
      input.template.excel?.body || input.template.excel?.regions?.length
        ? customerDocument(input).total
        : input.pricing.quoteBeforeTax,
    // Existing tax mappings are deliberately cleared; both legacy total mappings receive the same final amount.
    gstPercent: null,
    gstAmount: null,
    quoteAfterTax:
      input.template.excel?.body || input.template.excel?.regions?.length
        ? customerDocument(input).total
        : input.pricing.quoteBeforeTax,
  };
}

/** Validates immutable customer lines and their exact reconciliation to the service price. */
function quoteLines(input: QuoteWorkbookInput): QuoteLine[] {
  const lines = input.lines ?? [
    {
      id: 'service',
      description: input.project.name,
      quantity: 1,
      unit: 'lot',
      unitPrice: input.pricing.listPrice,
      amount: input.pricing.listPrice,
    },
  ];
  const errors = validateQuoteLines(lines, input.pricing.listPrice);
  if (errors.length) throw new Error(errors.join(' '));
  return lines;
}

type RegionEdit = { start: number; end: number; count: number };

/** Replace an original row interval, preserving qualified references and quoted text. */
function regionFormula(
  formula: string,
  sourceSheet: string,
  changedSheet: string,
  edit: RegionEdit,
): string {
  const delta = edit.count - (edit.end - edit.start + 1);
  if (!delta) return formula;
  // A one-row aggregate still means the whole repeated detail interval.
  if (edit.start === edit.end && edit.count > 0) {
    formula = formula.replace(
      /"(?:[^"]|"")*"|\b(SUM|AVERAGE|COUNT|COUNTA|MIN|MAX)\s*\(\s*((?:('(?:[^']|'')+'|[A-Z_\u0080-\uFFFF][A-Z0-9_.\u0080-\uFFFF]*)!)?)(\$?[A-Z]{1,3}\$?[1-9]\d*)\s*\)/gi,
      (match, fn, qualified, name, address) =>
        fn &&
        parseReference(address).row === edit.start &&
        sheetNameOf(name, sourceSheet).toLowerCase() ===
          changedSheet.toLowerCase()
          ? `${fn}(${qualified}${address}:${address})`
          : match,
    );
  }
  const token =
    /"(?:[^"]|"")*"|(?<![A-Z0-9_.])(?:(('(?:[^']|'')+'|[A-Z_\u0080-\uFFFF][A-Z0-9_.\u0080-\uFFFF]*)!))?(\$?[A-Z]{1,3}\$?[1-9]\d{0,6})(?::(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}))?(?![A-Z0-9_.(])/gi;
  return formula.replace(token, (match, qualified, name, start, end) => {
    if (
      match.startsWith('"') ||
      !start ||
      sheetNameOf(name, sourceSheet).toLowerCase() !==
        changedSheet.toLowerCase()
    )
      return match;
    const a = parseReference(start).row,
      b = parseReference(end ?? start).row;
    if (!edit.count && a >= edit.start && b <= edit.end) return '0';
    if (
      edit.count &&
      ((a >= edit.start && a <= edit.end && (!end || a !== edit.start)) ||
        (end && b >= edit.start && b <= edit.end && b !== edit.end))
    )
      throw new Error(
        'A formula refers to individual sample items in a resized module. Use SUM over the full sample detail range for module totals.',
      );
    const shift = (address: string, isEnd: boolean) => {
      const row = parseReference(address).row;
      return withRow(
        address,
        row < edit.start
          ? row
          : row > edit.end
            ? row + delta
            : isEnd
              ? edit.start + edit.count - 1
              : edit.start,
      );
    };
    return `${qualified ?? ''}${shift(start, false)}${end ? `:${shift(end, true)}` : ''}`;
  });
}

/** Rebuild the entire body from semantic rows; no sample heading, number or total survives. */
async function fillStructuredBody(
  workbook: Workbook,
  sheet: Worksheet,
  input: QuoteWorkbookInput,
) {
  quoteLines(input);
  const mapping = input.template.excel!,
    body = mapping.body!,
    values = quoteFieldValues(input);
  const plan = structuredBodyRows(input, body, values);
  const edit: RegionEdit = {
    start: body.startRow,
    end: body.endRow,
    count: plan.length,
  };
  const delta = plan.length - (body.endRow - body.startRow + 1);
  if (
    sheet.rowCount + delta > MAX_EXCEL_ROW ||
    plan.length * Math.max(1, sheet.columnCount) > MAX_MODEL_CELLS
  )
    throw new Error(
      'The generated quotation body exceeds the supported workbook size.',
    );
  const overlaps = (range: string) => {
    const rows = [...range.matchAll(/\$?[A-Z]{1,3}\$?([1-9]\d*)/g)].map((m) =>
      Number(m[1]),
    );
    return (
      rows.length &&
      Math.min(...rows) <= edit.end &&
      Math.max(...rows) >= edit.start
    );
  };
  const validations = (
    sheet as unknown as { dataValidations: { model: Record<string, unknown> } }
  ).dataValidations.model;
  if (
    sheet.getTables().length ||
    Object.keys(validations).some(overlaps) ||
    (sheet as WorksheetFeatures).conditionalFormattings.some((f) =>
      overlaps(f.ref),
    )
  )
    throw new Error(
      'Use plain styled rows for the quotation body; move Excel Tables, validation and conditional formatting outside it.',
    );
  for (const image of sheet.getImages()) {
    const top = image.range.tl.nativeRow,
      bottom = image.range.br?.nativeRow ?? top;
    if (top < edit.end && bottom >= edit.start - 1)
      throw new Error(
        'Place template pictures outside the generated quotation body.',
      );
  }
  const merges = [...sheet.model.merges];
  const patterns = Object.fromEntries(
    Object.entries(body.styles).map(([role, row]) => [
      role,
      snapshotRow(sheet.getRow(row)),
    ]),
  );
  for (const range of merges) {
    const [a, b = a] = range.split(':');
    if (overlaps(range) && parseReference(a).row !== parseReference(b).row)
      throw new Error(
        'Use horizontal merges only inside the generated quotation body.',
      );
  }
  const mappedCells = new Set([
    ...Object.values(mapping.cells),
    ...(mapping.textCells ?? []).map((c) => c.address),
  ]);
  // A sum over the whole generated body would double-count subtotals. Require an explicit total placeholder instead.
  const refersToBody = (formula: string, sourceSheet: string) => {
    const token =
      /"(?:[^"]|"")*"|(?<![A-Z0-9_.])(?:(('(?:[^']|'')+'|[A-Z_\u0080-\uFFFF][A-Z0-9_.\u0080-\uFFFF]*)!))?(\$?[A-Z]{1,3}\$?[1-9]\d{0,6})(?::(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}))?(?![A-Z0-9_.(])/gi;
    return [...formula.matchAll(token)].some(
      (m) =>
        !m[0].startsWith('"') &&
        m[3] &&
        sheetNameOf(m[2], sourceSheet).toLowerCase() ===
          sheet.name.toLowerCase() &&
        overlaps(`${m[3]}:${m[4] ?? m[3]}`),
    );
  };
  workbook.eachSheet((target) =>
    target.eachRow((row) =>
      row.eachCell((cell) => {
        if (
          target === sheet &&
          ((row.number >= edit.start && row.number <= edit.end) ||
            mappedCells.has(cell.address))
        )
          return;
        if (cell.formula && refersToBody(cell.formula, target.name))
          throw new Error(
            `Formula ${target.name}!${cell.address} refers to the replaced quotation body. Use a total placeholder outside the body instead.`,
          );
      }),
    ),
  );
  for (const name of workbook.definedNames.model) {
    if (name.ranges.some((range) => refersToBody(range, sheet.name)))
      throw new Error(
        `Named range ${name.name} refers to the replaced quotation body. Use cell placeholders outside the body instead.`,
      );
  }
  const rows = (sheet.model as unknown as { rows: RowModel[] }).rows.map((r) =>
    snapshotRow(sheet.getRow(r.number)),
  );
  const originalRowCount = sheet.rowCount;
  merges.forEach((range) => sheet.unMergeCells(range));
  for (const old of rows) {
    const row = sheet.getRow(old.number);
    row.values = [];
    (row as Row & { style: Partial<Style> }).style = {};
    delete (row as { height?: number }).height;
    row.hidden = false;
    row.outlineLevel = 0;
  }
  for (const old of rows) {
    if (old.number >= edit.start && old.number <= edit.end) continue;
    const target = old.number > edit.end ? old.number + delta : old.number;
    // Values/formulas are restored explicitly after structural movement.
    restoreRow(
      sheet,
      { ...old, cells: old.cells.map((c) => ({ ...c, value: null })) },
      target,
      edit.end,
      0,
    );
    for (const saved of old.cells) {
      const address = sheet.getCell(old.number, saved.column).address;
      const value = saved.value;
      sheet.getCell(target, saved.column).value = mappedCells.has(address)
        ? null
        : value && typeof value === 'object' && 'formula' in value
          ? {
              formula: regionFormula(
                String(value.formula),
                sheet.name,
                sheet.name,
                edit,
              ),
            }
          : value;
    }
  }
  if (delta < 0) sheet.spliceRows(originalRowCount + delta + 1, -delta);
  for (const range of merges)
    if (!overlaps(range))
      sheet.mergeCells(regionFormula(range, sheet.name, sheet.name, edit));
  for (const [index, row] of plan.entries()) {
    const target = edit.start + index,
      pattern = patterns[row.role];
    restoreRow(
      sheet,
      {
        ...pattern,
        hidden: false,
        cells: pattern.cells.map((c) => ({
          ...c,
          value: null,
          note: undefined,
        })),
      },
      target,
      edit.end,
      0,
    );
    for (const range of merges) {
      const [a, b = a] = range.split(':');
      if (parseReference(a).row === pattern.number)
        sheet.mergeCells(`${withRow(a, target)}:${withRow(b, target)}`);
    }
    const description = sheet.getCell(
      `${mapping.columns.description}${target}`,
    ).master;
    const number = mapping.columns.number
      ? sheet.getCell(`${mapping.columns.number}${target}`).master
      : undefined;
    if (row.line) {
      const addresses = Object.values(mapping.columns).map(
        (col) => sheet.getCell(`${col}${target}`).master.address,
      );
      if (new Set(addresses).size !== addresses.length)
        throw new Error(
          'Detail fields cannot share a merged cell. Check the detail style row and column mappings.',
        );
      for (const [field, col] of Object.entries(mapping.columns))
        sheet.getCell(`${col}${target}`).master.value =
          { ...row.line, number: row.number }[field as keyof QuoteLine] ??
          row.number;
    } else {
      description.value =
        (!number || number.address === description.address) && row.number
          ? `${row.number} ${row.description}`
          : row.description;
      if (number && number.address !== description.address && row.number)
        number.value = row.number;
    }
    if (row.amount !== undefined) {
      const amount = sheet.getCell(`${mapping.columns.amount}${target}`).master;
      if (amount.address === description.address)
        throw new Error(
          'Amount and description must use separate cells in subtotal and total styles.',
        );
      const amountAddress = (index: number) =>
        sheet.getCell(`${mapping.columns.amount}${edit.start + index}`).master
          .address;
      const formula = row.sum
        ? `ROUND(SUM(${row.sum.map(amountAddress).join(',')})${row.subtract === undefined ? '' : `-${amountAddress(row.subtract)}`},2)`
        : undefined;
      amount.value = formula ? { formula, result: row.amount } : row.amount;
    }
  }
  workbook.eachSheet((target) => {
    if (target === sheet) return;
    target.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.formula)
          cell.value = {
            formula: regionFormula(cell.formula, target.name, sheet.name, edit),
          };
      }),
    );
  });
  moveWorksheetFeatures(workbook, sheet, edit.end, delta);
  for (const [field, address] of Object.entries(mapping.cells))
    sheet.getCell(
      regionFormula(address!, sheet.name, sheet.name, edit),
    ).master.value = values[field];
  for (const cell of mapping.textCells ?? [])
    sheet.getCell(
      regionFormula(cell.address, sheet.name, sheet.name, edit),
    ).master.value = renderTemplateText(cell.content, values);
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook.xlsx.writeBuffer();
}

async function fillModuleRegions(
  workbook: Workbook,
  sheet: Worksheet,
  input: QuoteWorkbookInput,
) {
  quoteLines(input);
  const mapping = input.template.excel!;
  const document = customerDocument(input);
  for (const line of document.allLines) {
    const matches = mapping.regions!.filter((r) => regionMatches(r, line));
    if (matches.length !== 1)
      throw new Error(
        'Map each quotation group exactly once before exporting: ' +
          line.category +
          ' / ' +
          line.inclusion +
          (line.id.startsWith('maintenance:') ? ' (maintenance)' : ''),
      );
  }
  const edits: RegionEdit[] = [];
  // Bottom-up edits keep original coordinates valid for every remaining module.
  for (const region of [...mapping.regions!].sort(
    (a, b) => b.startRow - a.startRow,
  )) {
    const lines = document.allLines.filter((line) =>
      regionMatches(region, line),
    );
    const edit: RegionEdit = lines.length
      ? {
          start: region.detailRow,
          end: region.detailEndRow,
          count: lines.length,
        }
      : { start: region.startRow, end: region.endRow, count: 0 };
    const delta = edit.count - (edit.end - edit.start + 1);
    if (sheet.rowCount + delta > MAX_EXCEL_ROW)
      throw new Error('Quotation rows exceed the worksheet limit.');
    // Reject features with their own range semantics in the replaced area instead of silently damaging them.
    const overlaps = (range: string) => {
      const refs = [...range.matchAll(/\$?[A-Z]{1,3}\$?([1-9]\d*)/g)].map((m) =>
        Number(m[1]),
      );
      return (
        refs.length > 0 &&
        Math.min(...refs) <= edit.end &&
        Math.max(...refs) >= edit.start
      );
    };
    const validations = (
      sheet as unknown as {
        dataValidations: { model: Record<string, unknown> };
      }
    ).dataValidations.model;
    if (
      sheet.getTables().length ||
      Object.keys(validations).some(overlaps) ||
      (sheet as WorksheetFeatures).conditionalFormattings.some((f) =>
        overlaps(f.ref),
      )
    )
      throw new Error(
        'Use plain styled cells in dynamic module regions; remove Excel Tables, validation and conditional formatting from those rows.',
      );
    for (const image of sheet.getImages())
      if (
        [image.range.tl, image.range.br].some(
          (a) => a && a.nativeRow >= edit.start - 1 && a.nativeRow < edit.end,
        )
      )
        throw new Error('Place template pictures outside dynamic module rows.');
    const rows = (sheet.model as unknown as { rows: RowModel[] }).rows.map(
      (r) => snapshotRow(sheet.getRow(r.number)),
    );
    const originalRowCount = sheet.rowCount;
    const pattern = snapshotRow(sheet.getRow(region.detailRow));
    const merges = [...sheet.model.merges];
    for (const range of merges) {
      const [a, b = a] = range.split(':');
      const top = parseReference(a).row,
        bottom = parseReference(b).row;
      if (top <= edit.end && bottom >= edit.start && top !== bottom)
        throw new Error(
          'Dynamic detail rows cannot intersect vertical merged cells.',
        );
    }
    // Mapped detail cells must be writable masters in the row copied as the pattern.
    for (const column of Object.values(mapping.columns)) {
      const cell = sheet.getCell(`${column}${region.detailRow}`);
      if (cell.isMerged && cell.master.address !== cell.address)
        throw new Error(
          `Map the merged-cell master ${cell.master.address} instead of ${cell.address}.`,
        );
    }
    merges.forEach((range) => sheet.unMergeCells(range));
    for (const old of rows) {
      const row = sheet.getRow(old.number);
      row.values = [];
      (row as Row & { style: Partial<Style> }).style = {};
      delete (row as { height?: number }).height;
      row.hidden = false;
      row.outlineLevel = 0;
    }
    for (const old of rows) {
      if (old.number >= edit.start && old.number <= edit.end) continue;
      const target = old.number > edit.end ? old.number + delta : old.number;
      restoreRow(sheet, old, target, edit.end, 0);
      for (const saved of old.cells)
        if (
          saved.value &&
          typeof saved.value === 'object' &&
          'formula' in saved.value
        )
          sheet.getCell(target, saved.column).value = {
            formula: regionFormula(
              String(saved.value.formula),
              sheet.name,
              sheet.name,
              edit,
            ),
          };
    }
    for (const [index, line] of lines.entries()) {
      const target = edit.start + index;
      restoreRow(sheet, pattern, target, edit.end, 0);
      // Clear sample wording/formulas; all business values come from the selected module.
      sheet.getRow(target).eachCell((cell) => {
        cell.value = null;
      });
      const values = { ...line, number: index + 1 };
      for (const [field, column] of Object.entries(mapping.columns))
        sheet.getCell(`${column}${target}`).value =
          values[field as keyof typeof values];
    }
    if (delta < 0) sheet.spliceRows(originalRowCount + delta + 1, -delta);
    for (const range of merges) {
      const [a, b = a] = range.split(':');
      const top = parseReference(a).row;
      if (top >= edit.start && top <= edit.end) {
        if (top === region.detailRow)
          for (let i = 0; i < lines.length; i++)
            sheet.mergeCells(
              `${withRow(a, edit.start + i)}:${withRow(b, edit.start + i)}`,
            );
      } else
        sheet.mergeCells(regionFormula(range, sheet.name, sheet.name, edit));
    }
    workbook.eachSheet((target) => {
      if (target === sheet) return;
      target.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.formula)
            cell.value = {
              formula: regionFormula(
                cell.formula,
                target.name,
                sheet.name,
                edit,
              ),
            };
        }),
      );
    });
    moveWorksheetFeatures(workbook, sheet, edit.end, delta);
    edits.push(edit);
  }
  const targetAddress = (original: string) =>
    edits.reduce(
      (address, edit) => regionFormula(address, sheet.name, sheet.name, edit),
      original,
    );
  const values = quoteFieldValues(input);
  for (const [field, address] of Object.entries(mapping.cells)) {
    const target = targetAddress(address!);
    if (target === '0') continue;
    const cell = sheet.getCell(target);
    if (cell.isMerged && cell.master.address !== cell.address)
      throw new Error(`Map the merged-cell master for ${address}.`);
    cell.value = values[field];
  }
  for (const text of mapping.textCells ?? []) {
    const target = targetAddress(text.address);
    if (target === '0') continue;
    const cell = sheet.getCell(target);
    if (cell.isMerged && cell.master.address !== cell.address)
      throw new Error(`Map the merged-cell master for ${text.address}.`);
    cell.value = renderTemplateText(text.content, values);
  }
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook.xlsx.writeBuffer();
}

/** Fills a new XLSX copy, repeats detail formatting, and keeps the original asset unchanged. */
export async function fillQuoteExcelTemplate(
  buffer: Uint8Array | ArrayBuffer,
  source: QuoteWorkbookInput,
) {
  const input = structuredClone(source);
  // Retire only the old system clause; customer-authored terms and saved snapshots remain untouched.
  input.assumptions = input.assumptions.filter(
    (row) => !isRetiredQuoteAssumption(row),
  );
  assertValidQuotePricing(input.pricing);
  const bytes = new Uint8Array(
    buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer,
  );
  if (!input.template.excel)
    throw new Error('No customer XLSX template is configured.');
  const workbook = await loadTemplate(bytes);
  const mapping = input.template.excel;
  const errors = validateQuoteExcelMapping(
    mapping,
    workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
    })),
  );
  if (errors.length) throw new Error(errors.join(' '));
  const sheet = workbook.getWorksheet(mapping.sheetName)!;
  if (mapping.body) return fillStructuredBody(workbook, sheet, input);
  if (mapping.regions?.length) return fillModuleRegions(workbook, sheet, input);
  if (
    customerDocument(input).allLines.some(
      (line) =>
        line.inclusion === 'optional' ||
        !['Professional Service', 'Maintenance'].includes(line.category ?? ''),
    )
  )
    throw new Error(
      'Configure dynamic module regions to export custom categories or Optional items.',
    );
  validateGeometry(sheet, input);
  const lines = quoteLines(input);
  const addedRows = lines.length - 1;
  if (sheet.rowCount + addedRows > MAX_EXCEL_ROW)
    throw new Error('Quotation rows exceed the Excel worksheet limit.');
  // Model rows include formatted empty rows but exclude unallocated sparse gaps.
  const rowModels = (sheet.model as unknown as { rows: RowModel[] }).rows;
  const rows = rowModels.map((row) => snapshotRow(sheet.getRow(row.number)));
  const detail =
    rows.find((row) => row.number === mapping.detailRow) ??
    snapshotRow(sheet.getRow(mapping.detailRow));
  const merges = [...sheet.model.merges];
  // Remove merges before moving data; ExcelJS documents merged-cell splices as unpredictable.
  merges.forEach((range) => sheet.unMergeCells(range));
  // Clear source rows before restoring shifted snapshots so sparse footer content cannot linger.
  rows.forEach((snapshot) => {
    const row = sheet.getRow(snapshot.number);
    row.values = [];
    delete (row as { height?: number }).height;
    (row as Row & { style: Partial<Style> }).style = {};
    row.hidden = false;
    row.outlineLevel = 0;
  });
  rows.forEach((row) =>
    restoreRow(
      sheet,
      row,
      row.number > mapping.detailRow ? row.number + addedRows : row.number,
      mapping.detailRow,
      addedRows,
    ),
  );
  lines.forEach((_, index) =>
    restoreRow(
      sheet,
      detail,
      mapping.detailRow + index,
      mapping.detailRow,
      addedRows,
      index,
    ),
  );
  // Recreate horizontal line merges per detail row and shift all footer merges intact.
  for (const range of merges) {
    const [start, end = start] = range.split(':');
    const top = parseReference(start).row;
    if (top === mapping.detailRow)
      lines.forEach((_, index) =>
        sheet.mergeCells(
          `${withRow(start, top + index)}:${withRow(end, top + index)}`,
        ),
      );
    else
      sheet.mergeCells(
        moveFormula(
          range,
          sheet.name,
          sheet.name,
          mapping.detailRow,
          addedRows,
        ),
      );
  }
  // Other sheets retain their layout while formulas referring to the quotation follow inserted rows.
  workbook.eachSheet((target) => {
    if (target === sheet) return;
    target.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.formula)
          cell.value = {
            formula: moveFormula(
              cell.formula,
              target.name,
              sheet.name,
              mapping.detailRow,
              addedRows,
            ),
          };
      }),
    );
  });
  moveWorksheetFeatures(workbook, sheet, mapping.detailRow, addedRows);
  // Explicit mapped amounts prevent exposure of cost fields or reliance on stale formula caches.
  lines.forEach((line, index) => {
    const values = { ...line, number: index + 1 };
    Object.entries(mapping.columns).forEach(([field, column]) => {
      sheet.getCell(`${column}${mapping.detailRow + index}`).value =
        values[field as keyof typeof values];
    });
  });
  const values = quoteFieldValues(input);
  Object.entries(mapping.cells).forEach(([field, address]) => {
    const target = moveFormula(
      address!,
      sheet.name,
      sheet.name,
      mapping.detailRow,
      addedRows,
    );
    const cell = sheet.getCell(target);
    // Null clears a mapped legacy tax value or formula without touching unmapped customer content.
    cell.value = values[field as QuoteExcelField];
  });
  for (const cell of mapping.textCells ?? []) {
    const address = moveFormula(
      cell.address,
      sheet.name,
      sheet.name,
      mapping.detailRow,
      addedRows,
    );
    sheet.getCell(address).value = renderTemplateText(cell.content, values);
  }
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook.xlsx.writeBuffer();
}
