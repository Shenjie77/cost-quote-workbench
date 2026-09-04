/**
 * Excel export boundary for the cost workspace.
 *
 * The exporter accepts one immutable, serializable snapshot instead of React
 * state. Web, CLI, and future database adapters can therefore generate the
 * same workbook without duplicating business calculations.
 *
 * Workbook contract v2 intentionally fixes nine worksheet names and uses
 * stable technical IDs alongside human-readable labels. Agent Skills should
 * address sheets and columns by these names rather than by visual position.
 */

import {
  YEAR_BUCKETS,
  buildCostStatementRows,
  getActualYears,
  getHQTravelSummary,
  getLabourRateFactors,
  roundMoney,
  roundQuantity,
  totalRowMandays,
  totalRowSites,
  yearRowMandays,
  type YearBucket,
} from './domain.ts';
import {
  COST_WORKBOOK_CONTRACT_VERSION,
  type CostExportSnapshot,
} from './contracts.ts';
import { validateCostExportSnapshot } from './validation.ts';

export {
  COST_EXPORT_SCHEMA_VERSION,
  COST_WORKBOOK_CONTRACT_VERSION,
  type CostExportSnapshot,
} from './contracts.ts';
export {
  validateCostExportSnapshot,
  type CostExportIssue,
} from './validation.ts';

const HEADER_ROW = 4;
const FIRST_DATA_ROW = HEADER_ROW + 1;
const NON_RESOURCE_ID = '__NON_RESOURCE__';
const UNMAPPED_GRADE_ID = '__UNMAPPED_GRADE__';
const TOTAL_WITH_RISK_KEY = '__TOTAL_WITH_RISK__';

const COLORS = {
  navy: 'FF173A52',
  teal: 'FF2E6F77',
  paleTeal: 'FFE3F0EF',
  paleAmber: 'FFFFF3D6',
  paleRed: 'FFFCE8E6',
  border: 'FFD8D5CD',
  text: 'FF18232D',
  muted: 'FF667078',
  white: 'FFFFFFFF',
  red: 'FF9F3E3B',
} as const;

const CURRENCY_FORMAT = '"S$" #,##0.00;[Red]-"S$" #,##0.00;-';
const QUANTITY_FORMAT = '#,##0.0000';
const INTEGER_FORMAT = '#,##0';
const PERCENT_FORMAT = '0.0%';

type ColumnDefinition<Key extends string = string> = {
  key: Key;
  header: string;
  width: number;
  numFmt?: string;
};

type TableLayout<Key extends string = string> = {
  sheet: import('exceljs').Worksheet;
  columns: ReadonlyMap<Key, number>;
  firstDataRow: number;
  lastDataRow: number;
};

type SummarySheetHandle = TableLayout<string> & {
  totalRow: number;
  groups: SummaryGroup[];
  costKey: 'salesCost' | 'labourCost';
};

type StatementSheetHandle = TableLayout<string> & {
  rowsByKey: ReadonlyMap<string, number>;
  amountsByKey: ReadonlyMap<string, number>;
};

type ExportDetailRow = {
  id: string;
  sourceKind: 'COST_INPUT' | 'HQ_TRAVEL' | 'STATEMENT_MANUAL';
  costLayer: 'SALES' | 'RISK';
  statementCode: string;
  scope: string;
  bu: string;
  resourceTypeId: string;
  resourceCode: string;
  resourceName: string;
  resourceCategory: string;
  gradeId: string;
  gradeCode: string;
  gradeName: string;
  rateUnit: string;
  hqTravel: boolean | null;
  mdPerSite: number;
  years: Array<{
    bucket: YearBucket;
    sites: number;
    mandays: number;
    cost: number;
  }>;
  directCost: number;
  totalSites: number;
  totalMandays: number;
  totalCost: number;
  currency: string;
  allocationStatus: 'ALLOCATED' | 'UNALLOCATED';
  sourceNote: string;
};

type DetailColumnKey =
  | 'lineId'
  | 'sourceKind'
  | 'costLayer'
  | 'statementCode'
  | 'scope'
  | 'bu'
  | 'resourceTypeId'
  | 'resourceCode'
  | 'resourceName'
  | 'resourceCategory'
  | 'gradeId'
  | 'gradeCode'
  | 'gradeName'
  | 'rateUnit'
  | 'hqTravel'
  | 'mdPerSite'
  | `year.${YearBucket}.sites`
  | `year.${YearBucket}.mandays`
  | `year.${YearBucket}.cost`
  | 'totalSites'
  | 'totalMandays'
  | 'directCost'
  | 'totalCost'
  | 'currency'
  | 'allocationStatus'
  | 'sourceNote';

type SummaryGroup = {
  key: string;
  label: string;
  sites: number;
  mandays: number;
  cost: number;
  allocationStatus: 'ALLOCATED' | 'UNALLOCATED';
  resourceTypeId?: string;
  resourceCode?: string;
  resourceName?: string;
  resourceCategory?: string;
  gradeId?: string;
  gradeCode?: string;
  gradeName?: string;
  gradePool?: string;
  gradeLevel?: string;
  mappingStatus?: 'MAPPED' | 'UNMAPPED';
  sortOrder?: number;
};

const detailYearKey = (
  bucket: YearBucket,
  measure: 'sites' | 'mandays' | 'cost',
) => `year.${bucket}.${measure}` as DetailColumnKey;

/**
 * Column metadata is the only source of physical positions in Cost Detail.
 * Adding or moving a business column cannot silently shift formulas or number
 * formats because all references are resolved from the stable `key` values.
 */
const DETAIL_COLUMNS: readonly ColumnDefinition<DetailColumnKey>[] = [
  { key: 'lineId', header: 'Line ID', width: 19 },
  { key: 'sourceKind', header: 'Source Kind', width: 20 },
  { key: 'costLayer', header: 'Cost Layer', width: 14 },
  { key: 'statementCode', header: 'Statement Code', width: 17 },
  { key: 'scope', header: 'Scope', width: 30 },
  { key: 'bu', header: 'BU', width: 24 },
  { key: 'resourceTypeId', header: 'RE Type ID', width: 20 },
  { key: 'resourceCode', header: 'RE Code', width: 16 },
  { key: 'resourceName', header: 'RE Type Name', width: 28 },
  { key: 'resourceCategory', header: 'RE Category', width: 17 },
  { key: 'gradeId', header: 'RE Level ID', width: 20 },
  { key: 'gradeCode', header: 'RE Level Code', width: 16 },
  { key: 'gradeName', header: 'RE Level Name', width: 24 },
  { key: 'rateUnit', header: 'Rate Unit', width: 12 },
  { key: 'hqTravel', header: 'HQ Travel', width: 12 },
  {
    key: 'mdPerSite',
    header: 'MD / Site',
    width: 13,
    numFmt: QUANTITY_FORMAT,
  },
  ...YEAR_BUCKETS.flatMap((bucket): ColumnDefinition<DetailColumnKey>[] => [
    {
      key: detailYearKey(bucket, 'sites'),
      header: `${bucket} Sites`,
      width: 12,
      numFmt: INTEGER_FORMAT,
    },
    {
      key: detailYearKey(bucket, 'mandays'),
      header: `${bucket} MD`,
      width: 13,
      numFmt: QUANTITY_FORMAT,
    },
    {
      key: detailYearKey(bucket, 'cost'),
      header: `${bucket} Cost`,
      width: 15,
      numFmt: CURRENCY_FORMAT,
    },
  ]),
  {
    key: 'totalSites',
    header: 'Total Sites',
    width: 13,
    numFmt: INTEGER_FORMAT,
  },
  {
    key: 'totalMandays',
    header: 'Total MD',
    width: 14,
    numFmt: QUANTITY_FORMAT,
  },
  {
    key: 'directCost',
    header: 'Direct Cost',
    width: 16,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'totalCost',
    header: 'Total Cost',
    width: 16,
    numFmt: CURRENCY_FORMAT,
  },
  { key: 'currency', header: 'Currency', width: 11 },
  {
    key: 'allocationStatus',
    header: 'Allocation Status',
    width: 18,
  },
  { key: 'sourceNote', header: 'Source Note', width: 34 },
];

/** Converts a one-based column index to an Excel A1 column label. */
const excelColumn = (columnNumber: number) => {
  let value = columnNumber;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

/** Escapes worksheet names for use in Excel formulas. */
const quoteSheetName = (name: string) => `'${name.replaceAll("'", "''")}'`;

/** Escapes a literal string for use as a formula argument. */
const quoteFormulaText = (value: string) => `"${value.replaceAll('"', '""')}"`;

const buildColumnMap = <Key extends string>(
  definitions: readonly ColumnDefinition<Key>[],
) =>
  new Map<Key, number>(
    definitions.map((definition, index) => [definition.key, index + 1]),
  );

const requireColumn = <Key extends string>(
  columns: ReadonlyMap<Key, number>,
  key: Key,
) => {
  const column = columns.get(key);
  if (column === undefined) {
    throw new Error(`Workbook column is not registered: ${key}`);
  }
  return column;
};

const localCellReference = (column: number, row: number) =>
  `$${excelColumn(column)}${row}`;

const absoluteCellReference = (
  sheet: import('exceljs').Worksheet,
  column: number,
  row: number,
) => `${quoteSheetName(sheet.name)}!$${excelColumn(column)}$${row}`;

const absoluteRangeReference = <Key extends string>(
  layout: TableLayout<Key>,
  key: Key,
) => {
  const column = excelColumn(requireColumn(layout.columns, key));
  return `${quoteSheetName(layout.sheet.name)}!$${column}$${layout.firstDataRow}:$${column}$${layout.lastDataRow}`;
};

const localRangeReference = (
  column: number,
  firstRow: number,
  lastRow: number,
) => `$${excelColumn(column)}$${firstRow}:$${excelColumn(column)}$${lastRow}`;

/** Mirrors `roundMoney` inside generated formulas. */
const moneyFormula = (expression: string) =>
  `ROUNDUP(ROUND(${expression},10),2)`;

const setFormula = (
  cell: import('exceljs').Cell,
  formula: string,
  result: number | string | boolean,
) => {
  cell.value = { formula, result };
};

const setCellByKey = <Key extends string>(
  row: import('exceljs').Row,
  columns: ReadonlyMap<Key, number>,
  key: Key,
  value: import('exceljs').CellValue,
) => {
  row.getCell(requireColumn(columns, key)).value = value;
};

const setFormulaByKey = <Key extends string>(
  row: import('exceljs').Row,
  columns: ReadonlyMap<Key, number>,
  key: Key,
  formula: string,
  result: number | string | boolean,
) => setFormula(row.getCell(requireColumn(columns, key)), formula, result);

/** Adds the common compact title block used by every worksheet. */
const addSheetTitle = (
  sheet: import('exceljs').Worksheet,
  title: string,
  subtitle: string,
) => {
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = {
    name: 'Arial',
    size: 15,
    bold: true,
    color: { argb: COLORS.navy },
  };
  sheet.getCell('A2').value = subtitle;
  sheet.getCell('A2').font = {
    name: 'Arial',
    size: 9,
    italic: true,
    color: { argb: COLORS.muted },
  };
  sheet.getRow(3).height = 6;
};

/** Applies a consistent, readable finance-table header. */
const styleHeaderRow = (row: import('exceljs').Row) => {
  row.height = 26;
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.navy },
    };
    cell.font = {
      name: 'Arial',
      size: 9,
      bold: true,
      color: { argb: COLORS.white },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      right: { style: 'thin', color: { argb: 'FF738797' } },
      bottom: { style: 'thin', color: { argb: COLORS.navy } },
    };
  });
};

/** Styles populated body rows without adding a distracting full-cell grid. */
const styleBodyRows = (
  sheet: import('exceljs').Worksheet,
  firstRow: number,
  lastRow: number,
  lastColumn: number,
) => {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 21;
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = row.getCell(column);
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.text } };
      cell.alignment = { vertical: 'middle' };
      cell.border = {
        bottom: { style: 'hair', color: { argb: COLORS.border } },
      };
    }
  }
};

/** Emphasizes only populated table cells, avoiding a huge printable area. */
const styleTableRow = (
  row: import('exceljs').Row,
  lastColumn: number,
  fillArgb: string,
  font: Partial<import('exceljs').Font>,
) => {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = row.getCell(column);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fillArgb },
    };
    cell.font = font;
  }
};

/** Registers headers, widths, and number formats from one keyed definition. */
const configureTableColumns = <Key extends string>(
  sheet: import('exceljs').Worksheet,
  definitions: readonly ColumnDefinition<Key>[],
) => {
  const columns = buildColumnMap(definitions);
  sheet.getRow(HEADER_ROW).values = definitions.map(
    (definition) => definition.header,
  );
  styleHeaderRow(sheet.getRow(HEADER_ROW));
  definitions.forEach((definition) => {
    const column = sheet.getColumn(requireColumn(columns, definition.key));
    column.width = definition.width;
    if (definition.numFmt) column.numFmt = definition.numFmt;
  });
  sheet.autoFilter = {
    from: `A${HEADER_ROW}`,
    to: `${excelColumn(definitions.length)}${HEADER_ROW}`,
  };
  return columns;
};

/**
 * Normalizes source and generated costs into one auditable detail stream.
 * Every monetary leaf passes through `roundMoney`; zero-value generated rows
 * are omitted so the workbook contains only meaningful synthetic entries.
 */
const buildDetailRows = (snapshot: CostExportSnapshot): ExportDetailRow[] => {
  const rows: ExportDetailRow[] = snapshot.costRows.map((row) => {
    const resource = snapshot.resourceTypes.find(
      (item) => item.id === row.reTypeId,
    );
    const statementCode =
      resource?.category === 'internal'
        ? '2.3.1.1'
        : resource?.category === 'subcontract'
          ? '2.3.2'
          : 'UNMAPPED';
    const years = YEAR_BUCKETS.map((bucket, yearIndex) => {
      const allocation =
        row.years.find((item) => item.bucket === bucket) ??
        row.years[yearIndex];
      return {
        bucket,
        sites: Number(allocation?.sites || 0),
        mandays: yearRowMandays(row, yearIndex),
        cost: roundMoney(Number(allocation?.cost || 0)),
      };
    });
    return {
      id: row.id,
      sourceKind: 'COST_INPUT',
      costLayer: 'SALES',
      statementCode,
      scope: row.scope || 'UNSPECIFIED',
      bu: row.bu || 'UNSPECIFIED',
      resourceTypeId: resource?.id || row.reTypeId || 'UNMAPPED',
      resourceCode: resource?.code || 'UNMAPPED',
      resourceName: resource?.name || 'Unmapped Resource Type',
      resourceCategory: resource?.category || 'unmapped',
      gradeId:
        resource?.category === 'internal'
          ? resource?.id || UNMAPPED_GRADE_ID
          : '',
      gradeCode:
        resource?.code || (resource?.category === 'internal' ? 'UNMAPPED' : ''),
      gradeName:
        resource?.name ||
        (resource?.category === 'internal' ? 'RE Type required' : ''),
      rateUnit: resource?.category === 'internal' ? 'MD' : '',
      hqTravel: resource?.hqTravel ?? null,
      mdPerSite: Number(row.mdPerSite || 0),
      years,
      directCost: 0,
      totalSites: totalRowSites(row),
      totalMandays: totalRowMandays(row),
      totalCost: roundMoney(
        years.reduce((sum, allocation) => sum + allocation.cost, 0),
      ),
      currency: snapshot.project.currency,
      allocationStatus: 'ALLOCATED',
      sourceNote: 'Cost Input',
    };
  });

  const emptyYears = () =>
    YEAR_BUCKETS.map((bucket) => ({
      bucket,
      sites: 0,
      mandays: 0,
      cost: 0,
    }));
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const travelCost = roundMoney(travel.totalCost);
  if (travelCost > 0) {
    rows.push({
      id: 'AUTO-HQ-TRAVEL',
      sourceKind: 'HQ_TRAVEL',
      costLayer: 'SALES',
      statementCode: '2.3.1.3',
      scope: 'UNALLOCATED',
      bu: 'UNALLOCATED',
      resourceTypeId: NON_RESOURCE_ID,
      resourceCode: 'NON_RESOURCE',
      resourceName: 'HQ Travel',
      resourceCategory: 'travel',
      gradeId: '',
      gradeCode: '',
      gradeName: '',
      rateUnit: '',
      hqTravel: null,
      mdPerSite: 0,
      years: emptyYears(),
      directCost: travelCost,
      totalSites: 0,
      totalMandays: 0,
      totalCost: travelCost,
      currency: snapshot.project.currency,
      allocationStatus: 'UNALLOCATED',
      sourceNote: 'HQ Travel calculation',
    });
  }

  const manualRows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travelCost,
    snapshot.manualCosts,
  ).filter(
    (row) =>
      row.mode === 'manual' &&
      row.manualKey !== undefined &&
      roundMoney(row.amount) > 0,
  );
  manualRows.forEach((statementRow) => {
    const amount = roundMoney(statementRow.amount);
    rows.push({
      id: `MANUAL-${statementRow.code.replaceAll('.', '-')}`,
      sourceKind: 'STATEMENT_MANUAL',
      costLayer: statementRow.code === '15' ? 'RISK' : 'SALES',
      statementCode: statementRow.code,
      scope: 'UNALLOCATED',
      bu: 'UNALLOCATED',
      resourceTypeId: NON_RESOURCE_ID,
      resourceCode: 'NON_RESOURCE',
      resourceName: statementRow.en,
      resourceCategory: 'manual-statement',
      gradeId: '',
      gradeCode: '',
      gradeName: '',
      rateUnit: '',
      hqTravel: null,
      mdPerSite: 0,
      years: emptyYears(),
      directCost: amount,
      totalSites: 0,
      totalMandays: 0,
      totalCost: amount,
      currency: snapshot.project.currency,
      allocationStatus: 'UNALLOCATED',
      sourceNote: statementRow.source,
    });
  });
  return rows;
};

const sumDetailCost = (
  rows: ExportDetailRow[],
  predicate: (row: ExportDetailRow) => boolean,
) =>
  roundMoney(
    rows.reduce((sum, row) => (predicate(row) ? sum + row.totalCost : sum), 0),
  );

const sumIfsFormula = (
  detail: TableLayout<DetailColumnKey>,
  sumKey: DetailColumnKey,
  criteria: ReadonlyArray<readonly [DetailColumnKey, string]>,
) =>
  `SUMIFS(${absoluteRangeReference(detail, sumKey)},${criteria
    .flatMap(([key, value]) => [absoluteRangeReference(detail, key), value])
    .join(',')})`;

/** Writes the compact metadata and validation landing sheet. */
const addReadmeSheet = (
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
  detailRows: ExportDetailRow[],
  issues: ReturnType<typeof validateCostExportSnapshot>,
  statementAmounts: ReadonlyMap<string, number>,
) => {
  const sheet = workbook.addWorksheet('00_Readme');
  sheet.views = [{ showGridLines: false }];
  addSheetTitle(
    sheet,
    'Cost Workbook',
    'Internal working file generated from the local Cost & Quote Workbench.',
  );
  sheet.getRow(HEADER_ROW).values = ['Field', 'Value'];
  styleHeaderRow(sheet.getRow(HEADER_ROW));

  const metadata: Array<{
    field: string;
    value: string | number;
    money?: boolean;
  }> = [
    { field: 'Project ID', value: snapshot.project.id },
    { field: 'Project', value: snapshot.project.name },
    { field: 'Client', value: snapshot.project.client },
    { field: 'Cost Version', value: snapshot.costVersion.code },
    { field: 'Version Status', value: snapshot.costVersion.status },
    { field: 'Currency', value: snapshot.project.currency },
    { field: 'Exported At', value: snapshot.exportedAt },
    { field: 'Data Schema Version', value: snapshot.schemaVersion },
    {
      field: 'Workbook Contract Version',
      value: COST_WORKBOOK_CONTRACT_VERSION,
    },
    {
      field: 'Cost Input Total',
      value: sumDetailCost(
        detailRows,
        (row) => row.sourceKind === 'COST_INPUT',
      ),
      money: true,
    },
    {
      field: 'HQ Travel',
      value: sumDetailCost(detailRows, (row) => row.sourceKind === 'HQ_TRAVEL'),
      money: true,
    },
    {
      field: 'Manual Sales Cost',
      value: sumDetailCost(
        detailRows,
        (row) =>
          row.sourceKind === 'STATEMENT_MANUAL' && row.costLayer === 'SALES',
      ),
      money: true,
    },
    {
      field: 'Risk Contingency',
      value: statementAmounts.get('15') ?? 0,
      money: true,
    },
    {
      field: 'Sales Cost',
      value: statementAmounts.get('2') ?? 0,
      money: true,
    },
    {
      field: 'Total Cost with Risk',
      value: statementAmounts.get(TOTAL_WITH_RISK_KEY) ?? 0,
      money: true,
    },
  ];
  const moneyRows = new Set<number>();
  metadata.forEach((item) => {
    const row = sheet.addRow([item.field, item.value]);
    if (item.money) moneyRows.add(row.number);
  });

  const issueHeaderRow = sheet.lastRow!.number + 2;
  sheet.getRow(issueHeaderRow).values = [
    'Validation',
    'Code',
    'Path',
    'Message',
  ];
  if (issues.length === 0) {
    sheet.addRow(['None', '', '', 'No validation issues.']);
  } else {
    issues.forEach((issue) =>
      sheet.addRow([
        issue.severity.toUpperCase(),
        issue.code,
        issue.path,
        issue.message,
      ]),
    );
  }

  styleBodyRows(sheet, FIRST_DATA_ROW, sheet.lastRow!.number, 4);
  styleHeaderRow(sheet.getRow(issueHeaderRow));
  moneyRows.forEach((rowNumber) => {
    sheet.getCell(rowNumber, 2).numFmt = CURRENCY_FORMAT;
  });
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 38;
  sheet.getColumn(3).width = 34;
  sheet.getColumn(4).width = 88;
  return sheet;
};

/** Adds the formula-backed single-source Cost Detail worksheet. */
const addDetailSheet = (
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
  detailRows: ExportDetailRow[],
): TableLayout<DetailColumnKey> => {
  const sheet = workbook.addWorksheet('01_Cost_Detail');
  sheet.views = [
    { showGridLines: false, state: 'frozen', xSplit: 6, ySplit: HEADER_ROW },
  ];
  addSheetTitle(
    sheet,
    'Cost Detail',
    `${snapshot.project.id} · Cost ${snapshot.costVersion.code} · Delivery buckets Y1–Y5`,
  );
  const columns = configureTableColumns(sheet, DETAIL_COLUMNS);

  detailRows.forEach((detailRow) => {
    const row = sheet.addRow([]);
    setCellByKey(row, columns, 'lineId', detailRow.id);
    setCellByKey(row, columns, 'sourceKind', detailRow.sourceKind);
    setCellByKey(row, columns, 'costLayer', detailRow.costLayer);
    setCellByKey(row, columns, 'statementCode', detailRow.statementCode);
    setCellByKey(row, columns, 'scope', detailRow.scope);
    setCellByKey(row, columns, 'bu', detailRow.bu);
    setCellByKey(row, columns, 'resourceTypeId', detailRow.resourceTypeId);
    setCellByKey(row, columns, 'resourceCode', detailRow.resourceCode);
    setCellByKey(row, columns, 'resourceName', detailRow.resourceName);
    setCellByKey(row, columns, 'resourceCategory', detailRow.resourceCategory);
    setCellByKey(row, columns, 'gradeId', detailRow.gradeId);
    setCellByKey(row, columns, 'gradeCode', detailRow.gradeCode);
    setCellByKey(row, columns, 'gradeName', detailRow.gradeName);
    setCellByKey(row, columns, 'rateUnit', detailRow.rateUnit || null);
    setCellByKey(
      row,
      columns,
      'hqTravel',
      detailRow.hqTravel === null ? null : detailRow.hqTravel ? 'Yes' : 'No',
    );
    setCellByKey(row, columns, 'mdPerSite', detailRow.mdPerSite);

    detailRow.years.forEach((year) => {
      const sitesColumn = requireColumn(
        columns,
        detailYearKey(year.bucket, 'sites'),
      );
      setCellByKey(
        row,
        columns,
        detailYearKey(year.bucket, 'sites'),
        year.sites,
      );
      setFormulaByKey(
        row,
        columns,
        detailYearKey(year.bucket, 'mandays'),
        `ROUND(${localCellReference(sitesColumn, row.number)}*${localCellReference(requireColumn(columns, 'mdPerSite'), row.number)},4)`,
        year.mandays,
      );
      setCellByKey(row, columns, detailYearKey(year.bucket, 'cost'), year.cost);
    });

    const siteCells = YEAR_BUCKETS.map((bucket) =>
      localCellReference(
        requireColumn(columns, detailYearKey(bucket, 'sites')),
        row.number,
      ),
    );
    const mandayCells = YEAR_BUCKETS.map((bucket) =>
      localCellReference(
        requireColumn(columns, detailYearKey(bucket, 'mandays')),
        row.number,
      ),
    );
    const costCells = YEAR_BUCKETS.map((bucket) =>
      localCellReference(
        requireColumn(columns, detailYearKey(bucket, 'cost')),
        row.number,
      ),
    );
    setFormulaByKey(
      row,
      columns,
      'totalSites',
      `SUM(${siteCells.join(',')})`,
      detailRow.totalSites,
    );
    setFormulaByKey(
      row,
      columns,
      'totalMandays',
      `ROUND(SUM(${mandayCells.join(',')}),4)`,
      detailRow.totalMandays,
    );
    setCellByKey(row, columns, 'directCost', detailRow.directCost);
    const allCostCells = [
      ...costCells,
      localCellReference(requireColumn(columns, 'directCost'), row.number),
    ];
    setFormulaByKey(
      row,
      columns,
      'totalCost',
      moneyFormula(`SUM(${allCostCells.join(',')})`),
      detailRow.totalCost,
    );
    setCellByKey(row, columns, 'currency', detailRow.currency);
    setCellByKey(row, columns, 'allocationStatus', detailRow.allocationStatus);
    setCellByKey(row, columns, 'sourceNote', detailRow.sourceNote);
  });

  const lastDataRow = sheet.lastRow?.number ?? HEADER_ROW;
  styleBodyRows(sheet, FIRST_DATA_ROW, lastDataRow, DETAIL_COLUMNS.length);
  return { sheet, columns, firstDataRow: FIRST_DATA_ROW, lastDataRow };
};

const buildSalesSummaryGroups = (
  detailRows: ExportDetailRow[],
  dimension: 'scope' | 'bu' | 'resourceType',
): SummaryGroup[] => {
  const groups = new Map<string, SummaryGroup>();
  detailRows
    .filter((row) => row.costLayer === 'SALES')
    .forEach((row) => {
      const isUnallocated = row.allocationStatus === 'UNALLOCATED';
      const value =
        dimension === 'scope'
          ? row.scope
          : dimension === 'bu'
            ? row.bu
            : row.resourceTypeId;
      const key = isUnallocated
        ? dimension === 'resourceType'
          ? NON_RESOURCE_ID
          : '__UNALLOCATED__'
        : `VALUE:${value}`;
      const current = groups.get(key) ?? {
        key,
        label: isUnallocated
          ? dimension === 'resourceType'
            ? 'Non-resource cost'
            : 'UNALLOCATED · Project-level'
          : dimension === 'resourceType'
            ? row.resourceName
            : value,
        sites: 0,
        mandays: 0,
        cost: 0,
        allocationStatus: isUnallocated ? 'UNALLOCATED' : 'ALLOCATED',
        resourceTypeId: isUnallocated ? NON_RESOURCE_ID : row.resourceTypeId,
        resourceCode: isUnallocated ? 'NON_RESOURCE' : row.resourceCode,
        resourceName: isUnallocated ? 'Non-resource cost' : row.resourceName,
        resourceCategory: isUnallocated ? 'non-resource' : row.resourceCategory,
      };
      current.sites += row.totalSites;
      current.mandays += row.totalMandays;
      current.cost += row.totalCost;
      groups.set(key, current);
    });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sites: roundQuantity(group.sites),
      mandays: roundQuantity(group.mandays),
      cost: roundMoney(group.cost),
    }))
    .sort(
      (a, b) =>
        Number(a.allocationStatus === 'UNALLOCATED') -
          Number(b.allocationStatus === 'UNALLOCATED') ||
        b.cost - a.cost ||
        a.label.localeCompare(b.label),
    );
};

/** Derived personnel-level summary; no independent Grade master exists. */
const buildGradeSummaryGroups = (
  detailRows: ExportDetailRow[],
  snapshot: CostExportSnapshot,
): SummaryGroup[] => {
  const groups = new Map<string, SummaryGroup>();
  detailRows
    .filter(
      (row) =>
        row.sourceKind === 'COST_INPUT' &&
        row.costLayer === 'SALES' &&
        row.resourceCategory === 'internal',
    )
    .forEach((row) => {
      const grade = snapshot.resourceTypes.find(
        (item) => item.id === row.resourceTypeId,
      );
      const key = row.resourceTypeId || UNMAPPED_GRADE_ID;
      const current =
        groups.get(key) ??
        ({
          key,
          label: grade
            ? `${grade.code} · ${grade.name}`
            : 'UNMAPPED · RE Type required',
          sites: 0,
          mandays: 0,
          cost: 0,
          allocationStatus: 'ALLOCATED',
          gradeId: key,
          gradeCode: grade?.code || 'UNMAPPED',
          gradeName: grade?.name || 'RE Type required',
          gradePool: grade?.pool || '',
          gradeLevel: grade?.level || '',
          mappingStatus: grade ? 'MAPPED' : 'UNMAPPED',
          sortOrder: snapshot.resourceTypes.findIndex(
            (item) => item.id === grade?.id,
          ),
        } satisfies SummaryGroup);
      current.sites += row.totalSites;
      current.mandays += row.totalMandays;
      current.cost += row.totalCost;
      groups.set(key, current);
    });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sites: roundQuantity(group.sites),
      mandays: roundQuantity(group.mandays),
      cost: roundMoney(group.cost),
    }))
    .sort(
      (a, b) =>
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.label.localeCompare(b.label),
    );
};

const SUMMARY_DIMENSION_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'dimension', header: 'Dimension', width: 34 },
  {
    key: 'totalSites',
    header: 'Total Sites',
    width: 14,
    numFmt: INTEGER_FORMAT,
  },
  {
    key: 'totalMandays',
    header: 'Total Mandays',
    width: 16,
    numFmt: QUANTITY_FORMAT,
  },
  {
    key: 'salesCost',
    header: 'Sales Cost',
    width: 18,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'costPerMd',
    header: 'Cost / MD',
    width: 16,
    numFmt: CURRENCY_FORMAT,
  },
  { key: 'share', header: 'Share', width: 12, numFmt: PERCENT_FORMAT },
  {
    key: 'allocationStatus',
    header: 'Allocation Status',
    width: 18,
  },
];

const SUMMARY_RESOURCE_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'resourceTypeId', header: 'RE Type ID', width: 20 },
  { key: 'resourceCode', header: 'RE Code', width: 16 },
  { key: 'resourceName', header: 'RE Type Name', width: 28 },
  { key: 'resourceCategory', header: 'Category', width: 17 },
  {
    key: 'totalSites',
    header: 'Total Sites',
    width: 14,
    numFmt: INTEGER_FORMAT,
  },
  {
    key: 'totalMandays',
    header: 'Total Mandays',
    width: 16,
    numFmt: QUANTITY_FORMAT,
  },
  {
    key: 'salesCost',
    header: 'Sales Cost',
    width: 18,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'costPerMd',
    header: 'Cost / MD',
    width: 16,
    numFmt: CURRENCY_FORMAT,
  },
  { key: 'share', header: 'Share', width: 12, numFmt: PERCENT_FORMAT },
  {
    key: 'allocationStatus',
    header: 'Allocation Status',
    width: 18,
  },
];

/** Adds Scope, BU, or Resource Type with formulas backed by Cost Detail. */
const addSalesSummarySheet = (
  workbook: import('exceljs').Workbook,
  name: '02_Summary_Scope' | '03_Summary_BU' | '04_Summary_RE_Type',
  dimension: 'scope' | 'bu' | 'resourceType',
  snapshot: CostExportSnapshot,
  detailRows: ExportDetailRow[],
  detail: TableLayout<DetailColumnKey>,
): SummarySheetHandle => {
  const sheet = workbook.addWorksheet(name);
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: HEADER_ROW }];
  addSheetTitle(
    sheet,
    name.replaceAll('_', ' '),
    `${snapshot.project.id} · Cost ${snapshot.costVersion.code} · Sales cost basis`,
  );
  const definitions =
    dimension === 'resourceType'
      ? SUMMARY_RESOURCE_COLUMNS
      : SUMMARY_DIMENSION_COLUMNS.map((column) =>
          column.key === 'dimension'
            ? {
                ...column,
                header: dimension === 'scope' ? 'Scope' : 'BU',
              }
            : column,
        );
  const columns = configureTableColumns(sheet, definitions);
  const groups = buildSalesSummaryGroups(detailRows, dimension);
  const totalRowNumber = FIRST_DATA_ROW + groups.length;
  const dimensionDetailKey: DetailColumnKey =
    dimension === 'scope'
      ? 'scope'
      : dimension === 'bu'
        ? 'bu'
        : 'resourceTypeId';
  const summaryCriteriaKey =
    dimension === 'resourceType' ? 'resourceTypeId' : 'dimension';
  const totalCost = roundMoney(
    groups.reduce((sum, group) => sum + group.cost, 0),
  );

  groups.forEach((group) => {
    const row = sheet.addRow([]);
    if (dimension === 'resourceType') {
      setCellByKey(row, columns, 'resourceTypeId', group.resourceTypeId ?? '');
      setCellByKey(row, columns, 'resourceCode', group.resourceCode ?? '');
      setCellByKey(row, columns, 'resourceName', group.resourceName ?? '');
      setCellByKey(
        row,
        columns,
        'resourceCategory',
        group.resourceCategory ?? '',
      );
    } else {
      setCellByKey(row, columns, 'dimension', group.label);
    }
    const criteria: Array<readonly [DetailColumnKey, string]> = [
      ['costLayer', quoteFormulaText('SALES')],
      ['allocationStatus', quoteFormulaText(group.allocationStatus)],
    ];
    if (group.allocationStatus === 'ALLOCATED') {
      criteria.push([
        dimensionDetailKey,
        localCellReference(
          requireColumn(columns, summaryCriteriaKey),
          row.number,
        ),
      ]);
    }
    setFormulaByKey(
      row,
      columns,
      'totalSites',
      `ROUND(${sumIfsFormula(detail, 'totalSites', criteria)},4)`,
      group.sites,
    );
    setFormulaByKey(
      row,
      columns,
      'totalMandays',
      `ROUND(${sumIfsFormula(detail, 'totalMandays', criteria)},4)`,
      group.mandays,
    );
    setFormulaByKey(
      row,
      columns,
      'salesCost',
      moneyFormula(sumIfsFormula(detail, 'totalCost', criteria)),
      group.cost,
    );
    const mandaysCell = localCellReference(
      requireColumn(columns, 'totalMandays'),
      row.number,
    );
    const costCell = localCellReference(
      requireColumn(columns, 'salesCost'),
      row.number,
    );
    const costPerMd =
      group.mandays > 0 ? roundMoney(group.cost / group.mandays) : '';
    setFormulaByKey(
      row,
      columns,
      'costPerMd',
      `IF(${mandaysCell}=0,"",${moneyFormula(`${costCell}/${mandaysCell}`)})`,
      costPerMd,
    );
    const totalCostCell = localCellReference(
      requireColumn(columns, 'salesCost'),
      totalRowNumber,
    );
    setFormulaByKey(
      row,
      columns,
      'share',
      `IF(${totalCostCell}=0,0,${costCell}/${totalCostCell})`,
      totalCost > 0 ? group.cost / totalCost : 0,
    );
    setCellByKey(row, columns, 'allocationStatus', group.allocationStatus);
  });

  const totalSites = roundQuantity(
    groups.reduce((sum, group) => sum + group.sites, 0),
  );
  const totalMandays = roundQuantity(
    groups.reduce((sum, group) => sum + group.mandays, 0),
  );
  const totalRow = sheet.addRow([]);
  setCellByKey(
    totalRow,
    columns,
    dimension === 'resourceType' ? 'resourceTypeId' : 'dimension',
    'TOTAL',
  );
  const dataLastRow = totalRow.number - 1;
  const aggregateFormula = (key: string) => {
    const column = requireColumn(columns, key);
    return dataLastRow >= FIRST_DATA_ROW
      ? `SUM(${localRangeReference(column, FIRST_DATA_ROW, dataLastRow)})`
      : '0';
  };
  setFormulaByKey(
    totalRow,
    columns,
    'totalSites',
    aggregateFormula('totalSites'),
    totalSites,
  );
  setFormulaByKey(
    totalRow,
    columns,
    'totalMandays',
    `ROUND(${aggregateFormula('totalMandays')},4)`,
    totalMandays,
  );
  setFormulaByKey(
    totalRow,
    columns,
    'salesCost',
    moneyFormula(aggregateFormula('salesCost')),
    totalCost,
  );
  const totalMandaysCell = localCellReference(
    requireColumn(columns, 'totalMandays'),
    totalRow.number,
  );
  const totalCostCell = localCellReference(
    requireColumn(columns, 'salesCost'),
    totalRow.number,
  );
  setFormulaByKey(
    totalRow,
    columns,
    'costPerMd',
    `IF(${totalMandaysCell}=0,"",${moneyFormula(`${totalCostCell}/${totalMandaysCell}`)})`,
    totalMandays > 0 ? roundMoney(totalCost / totalMandays) : '',
  );
  setFormulaByKey(
    totalRow,
    columns,
    'share',
    `IF(${totalCostCell}=0,0,1)`,
    totalCost > 0 ? 1 : 0,
  );

  styleBodyRows(sheet, FIRST_DATA_ROW, totalRow.number, definitions.length);
  styleTableRow(totalRow, definitions.length, COLORS.paleTeal, {
    name: 'Arial',
    size: 9,
    bold: true,
    color: { argb: COLORS.text },
  });
  return {
    sheet,
    columns,
    firstDataRow: FIRST_DATA_ROW,
    lastDataRow: dataLastRow,
    totalRow: totalRow.number,
    groups,
    costKey: 'salesCost',
  };
};

const SUMMARY_GRADE_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'gradeId', header: 'RE Type ID', width: 20 },
  { key: 'gradeCode', header: 'RE Type Code', width: 16 },
  { key: 'gradeName', header: 'RE Type Name', width: 24 },
  { key: 'gradePool', header: 'Pool', width: 12 },
  { key: 'gradeLevel', header: 'Level', width: 12 },
  {
    key: 'totalSites',
    header: 'Total Sites',
    width: 14,
    numFmt: INTEGER_FORMAT,
  },
  {
    key: 'totalMandays',
    header: 'Total Mandays',
    width: 16,
    numFmt: QUANTITY_FORMAT,
  },
  {
    key: 'labourCost',
    header: 'In-house Labour Cost',
    width: 21,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'costPerMd',
    header: 'Cost / MD',
    width: 16,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'share',
    header: 'Share of In-house Labour',
    width: 22,
    numFmt: PERCENT_FORMAT,
  },
  { key: 'mappingStatus', header: 'Mapping Status', width: 17 },
];

/** Adds a derived RE level summary, restricted to in-house labour. */
const addGradeSummarySheet = (
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
  detailRows: ExportDetailRow[],
  detail: TableLayout<DetailColumnKey>,
): SummarySheetHandle => {
  const sheet = workbook.addWorksheet('05_Summary_RE_Level');
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: HEADER_ROW }];
  addSheetTitle(
    sheet,
    '05 Summary RE Level',
    `${snapshot.project.id} · Cost ${snapshot.costVersion.code} · In-house labour only`,
  );
  const columns = configureTableColumns(sheet, SUMMARY_GRADE_COLUMNS);
  const groups = buildGradeSummaryGroups(detailRows, snapshot);
  const totalRowNumber = FIRST_DATA_ROW + groups.length;
  const totalCost = roundMoney(
    groups.reduce((sum, group) => sum + group.cost, 0),
  );

  groups.forEach((group) => {
    const row = sheet.addRow([]);
    setCellByKey(row, columns, 'gradeId', group.gradeId ?? '');
    setCellByKey(row, columns, 'gradeCode', group.gradeCode ?? '');
    setCellByKey(row, columns, 'gradeName', group.gradeName ?? '');
    setCellByKey(row, columns, 'gradePool', group.gradePool ?? '');
    setCellByKey(row, columns, 'gradeLevel', group.gradeLevel ?? '');
    const criteria: Array<readonly [DetailColumnKey, string]> = [
      ['costLayer', quoteFormulaText('SALES')],
      ['resourceCategory', quoteFormulaText('internal')],
      [
        'gradeId',
        localCellReference(requireColumn(columns, 'gradeId'), row.number),
      ],
    ];
    setFormulaByKey(
      row,
      columns,
      'totalSites',
      `ROUND(${sumIfsFormula(detail, 'totalSites', criteria)},4)`,
      group.sites,
    );
    setFormulaByKey(
      row,
      columns,
      'totalMandays',
      `ROUND(${sumIfsFormula(detail, 'totalMandays', criteria)},4)`,
      group.mandays,
    );
    setFormulaByKey(
      row,
      columns,
      'labourCost',
      moneyFormula(sumIfsFormula(detail, 'totalCost', criteria)),
      group.cost,
    );
    const mandaysCell = localCellReference(
      requireColumn(columns, 'totalMandays'),
      row.number,
    );
    const costCell = localCellReference(
      requireColumn(columns, 'labourCost'),
      row.number,
    );
    setFormulaByKey(
      row,
      columns,
      'costPerMd',
      `IF(${mandaysCell}=0,"",${moneyFormula(`${costCell}/${mandaysCell}`)})`,
      group.mandays > 0 ? roundMoney(group.cost / group.mandays) : '',
    );
    const totalCostCell = localCellReference(
      requireColumn(columns, 'labourCost'),
      totalRowNumber,
    );
    setFormulaByKey(
      row,
      columns,
      'share',
      `IF(${totalCostCell}=0,0,${costCell}/${totalCostCell})`,
      totalCost > 0 ? group.cost / totalCost : 0,
    );
    setCellByKey(
      row,
      columns,
      'mappingStatus',
      group.mappingStatus ?? 'UNMAPPED',
    );
  });

  const totalSites = roundQuantity(
    groups.reduce((sum, group) => sum + group.sites, 0),
  );
  const totalMandays = roundQuantity(
    groups.reduce((sum, group) => sum + group.mandays, 0),
  );
  const totalRow = sheet.addRow([]);
  setCellByKey(totalRow, columns, 'gradeId', 'TOTAL');
  setCellByKey(totalRow, columns, 'gradeName', 'Total In-house Labour');
  const dataLastRow = totalRow.number - 1;
  const aggregateFormula = (key: string) => {
    const column = requireColumn(columns, key);
    return dataLastRow >= FIRST_DATA_ROW
      ? `SUM(${localRangeReference(column, FIRST_DATA_ROW, dataLastRow)})`
      : '0';
  };
  setFormulaByKey(
    totalRow,
    columns,
    'totalSites',
    aggregateFormula('totalSites'),
    totalSites,
  );
  setFormulaByKey(
    totalRow,
    columns,
    'totalMandays',
    `ROUND(${aggregateFormula('totalMandays')},4)`,
    totalMandays,
  );
  setFormulaByKey(
    totalRow,
    columns,
    'labourCost',
    moneyFormula(aggregateFormula('labourCost')),
    totalCost,
  );
  const totalMandaysCell = localCellReference(
    requireColumn(columns, 'totalMandays'),
    totalRow.number,
  );
  const totalCostCell = localCellReference(
    requireColumn(columns, 'labourCost'),
    totalRow.number,
  );
  setFormulaByKey(
    totalRow,
    columns,
    'costPerMd',
    `IF(${totalMandaysCell}=0,"",${moneyFormula(`${totalCostCell}/${totalMandaysCell}`)})`,
    totalMandays > 0 ? roundMoney(totalCost / totalMandays) : '',
  );
  setFormulaByKey(
    totalRow,
    columns,
    'share',
    `IF(${totalCostCell}=0,0,1)`,
    totalCost > 0 ? 1 : 0,
  );

  styleBodyRows(
    sheet,
    FIRST_DATA_ROW,
    totalRow.number,
    SUMMARY_GRADE_COLUMNS.length,
  );
  styleTableRow(totalRow, SUMMARY_GRADE_COLUMNS.length, COLORS.paleTeal, {
    name: 'Arial',
    size: 9,
    bold: true,
    color: { argb: COLORS.text },
  });
  return {
    sheet,
    columns,
    firstDataRow: FIRST_DATA_ROW,
    lastDataRow: dataLastRow,
    totalRow: totalRow.number,
    groups,
    costKey: 'labourCost',
  };
};

const STATEMENT_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  '2': ['2.1.2', '2.2', '2.3'],
  '2.2': ['2.2.1'],
  '2.2.1': ['2.2.1.2', '2.2.1.3'],
  '2.3': ['2.3.1', '2.3.2', '2.3.3', '2.3.4'],
  '2.3.1': ['2.3.1.1', '2.3.1.2', '2.3.1.3'],
  '2.3.4': ['2.3.4.1', '2.3.4.2'],
  [TOTAL_WITH_RISK_KEY]: ['2', '15'],
};

const statementKey = (row: ReturnType<typeof buildCostStatementRows>[number]) =>
  row.code || TOTAL_WITH_RISK_KEY;

/** Calculates cached statement results from the normalized detail stream. */
const buildStatementAmounts = (
  statementRows: ReturnType<typeof buildCostStatementRows>,
  detailRows: ExportDetailRow[],
) => {
  const amounts = new Map<string, number>();
  const resolve = (key: string): number => {
    const existing = amounts.get(key);
    if (existing !== undefined) return existing;
    const children = STATEMENT_CHILDREN[key];
    const value = children
      ? roundMoney(children.reduce((sum, child) => sum + resolve(child), 0))
      : sumDetailCost(
          detailRows,
          (detailRow) => detailRow.statementCode === key,
        );
    amounts.set(key, value);
    return value;
  };
  statementRows.forEach((row) => resolve(statementKey(row)));
  return amounts;
};

const STATEMENT_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'code', header: 'Code', width: 14 },
  { key: 'reportItem', header: 'Report Item', width: 39 },
  { key: 'reportItemZh', header: '报表项', width: 34 },
  { key: 'source', header: 'Source', width: 46 },
  { key: 'inputMode', header: 'Input Mode', width: 14 },
  {
    key: 'amount',
    header: 'Cost (SGD)',
    width: 19,
    numFmt: CURRENCY_FORMAT,
  },
];

/** Adds formula-backed cost statement rows while preserving report hierarchy. */
const addStatementSheet = (
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
  statementRows: ReturnType<typeof buildCostStatementRows>,
  statementAmounts: ReadonlyMap<string, number>,
  detail: TableLayout<DetailColumnKey>,
): StatementSheetHandle => {
  const sheet = workbook.addWorksheet('06_Cost_Statement');
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: HEADER_ROW }];
  addSheetTitle(
    sheet,
    'Cost Statement',
    `${snapshot.project.id} · Cost ${snapshot.costVersion.code} · ${snapshot.project.currency}`,
  );
  const columns = configureTableColumns(sheet, STATEMENT_COLUMNS);
  const rowsByKey = new Map<string, number>();

  statementRows.forEach((statementRow) => {
    const row = sheet.addRow([]);
    const key = statementKey(statementRow);
    rowsByKey.set(key, row.number);
    setCellByKey(row, columns, 'code', statementRow.code || null);
    setCellByKey(
      row,
      columns,
      'reportItem',
      `${'  '.repeat(statementRow.level)}${statementRow.en}`,
    );
    setCellByKey(
      row,
      columns,
      'reportItemZh',
      `${'  '.repeat(statementRow.level)}${statementRow.zh}`,
    );
    setCellByKey(row, columns, 'source', statementRow.source);
    setCellByKey(
      row,
      columns,
      'inputMode',
      statementRow.mode === 'manual' ? 'MANUAL' : 'AUTO',
    );
  });

  statementRows.forEach((statementRow) => {
    const key = statementKey(statementRow);
    const rowNumber = rowsByKey.get(key)!;
    const amount = statementAmounts.get(key) ?? 0;
    const children = STATEMENT_CHILDREN[key];
    const formula = children
      ? moneyFormula(
          `SUM(${children
            .map((child) =>
              localCellReference(
                requireColumn(columns, 'amount'),
                rowsByKey.get(child)!,
              ),
            )
            .join(',')})`,
        )
      : moneyFormula(
          sumIfsFormula(detail, 'totalCost', [
            [
              'statementCode',
              localCellReference(requireColumn(columns, 'code'), rowNumber),
            ],
          ]),
        );
    setFormulaByKey(
      sheet.getRow(rowNumber),
      columns,
      'amount',
      formula,
      amount,
    );
  });

  const lastDataRow = sheet.lastRow!.number;
  styleBodyRows(sheet, FIRST_DATA_ROW, lastDataRow, STATEMENT_COLUMNS.length);
  statementRows.forEach((statementRow) => {
    const row = sheet.getRow(rowsByKey.get(statementKey(statementRow))!);
    if (statementRow.mode === 'section' || statementRow.mode === 'subtotal') {
      styleTableRow(row, STATEMENT_COLUMNS.length, COLORS.paleTeal, {
        name: 'Arial',
        size: 9,
        bold: true,
        color: { argb: COLORS.text },
      });
    } else if (statementRow.mode === 'manual') {
      row.getCell(requireColumn(columns, 'amount')).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLORS.paleAmber },
      };
    } else if (statementRow.mode === 'grand-total') {
      styleTableRow(row, STATEMENT_COLUMNS.length, COLORS.navy, {
        name: 'Arial',
        size: 9,
        bold: true,
        color: { argb: COLORS.white },
      });
    }
  });
  return {
    sheet,
    columns,
    firstDataRow: FIRST_DATA_ROW,
    lastDataRow,
    rowsByKey,
    amountsByKey: statementAmounts,
  };
};

const RECONCILIATION_COLUMNS: readonly ColumnDefinition[] = [
  { key: 'checkId', header: 'Check ID', width: 12 },
  { key: 'name', header: 'Reconciliation', width: 38 },
  { key: 'leftSource', header: 'Left Source', width: 34 },
  {
    key: 'leftAmount',
    header: 'Left Amount',
    width: 18,
    numFmt: CURRENCY_FORMAT,
  },
  { key: 'rightSource', header: 'Right Source', width: 34 },
  {
    key: 'rightAmount',
    header: 'Right Amount',
    width: 18,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'difference',
    header: 'Difference',
    width: 16,
    numFmt: CURRENCY_FORMAT,
  },
  {
    key: 'tolerance',
    header: 'Tolerance',
    width: 14,
    numFmt: CURRENCY_FORMAT,
  },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'note', header: 'Note', width: 46 },
];

type FormulaOperand = { formula: string; result: number };
type ReconciliationCheck = {
  id: string;
  name: string;
  leftSource: string;
  left: FormulaOperand;
  rightSource: string;
  right: FormulaOperand;
  note: string;
};

const summaryTotalOperand = (summary: SummarySheetHandle): FormulaOperand => ({
  formula: absoluteCellReference(
    summary.sheet,
    requireColumn(summary.columns, summary.costKey),
    summary.totalRow,
  ),
  result: roundMoney(
    summary.groups.reduce((sum, group) => sum + group.cost, 0),
  ),
});

const summaryUnallocatedOperand = (
  summary: SummarySheetHandle,
): FormulaOperand => {
  const result = roundMoney(
    summary.groups
      .filter((group) => group.allocationStatus === 'UNALLOCATED')
      .reduce((sum, group) => sum + group.cost, 0),
  );
  if (summary.lastDataRow < summary.firstDataRow) {
    return { formula: '0', result };
  }
  return {
    formula: moneyFormula(
      `SUMIFS(${absoluteRangeReference(summary, summary.costKey)},${absoluteRangeReference(summary, 'allocationStatus')},${quoteFormulaText('UNALLOCATED')})`,
    ),
    result,
  };
};

const statementOperand = (
  statement: StatementSheetHandle,
  key: string,
): FormulaOperand => ({
  formula: absoluteCellReference(
    statement.sheet,
    requireColumn(statement.columns, 'amount'),
    statement.rowsByKey.get(key)!,
  ),
  result: roundMoney(statement.amountsByKey.get(key) ?? 0),
});

/** Adds explicit arithmetic checks, including legitimate unallocated costs. */
const addReconciliationSheet = (
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
  detailRows: ExportDetailRow[],
  detail: TableLayout<DetailColumnKey>,
  scope: SummarySheetHandle,
  bu: SummarySheetHandle,
  resourceType: SummarySheetHandle,
  grade: SummarySheetHandle,
  statement: StatementSheetHandle,
) => {
  const sheet = workbook.addWorksheet('07_Reconciliation');
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: HEADER_ROW }];
  addSheetTitle(
    sheet,
    'Reconciliation',
    `${snapshot.project.id} · Cost ${snapshot.costVersion.code} · Tolerance S$0.01`,
  );
  const columns = configureTableColumns(sheet, RECONCILIATION_COLUMNS);

  const detailSales = sumDetailCost(
    detailRows,
    (row) => row.costLayer === 'SALES',
  );
  const detailRisk = sumDetailCost(
    detailRows,
    (row) => row.costLayer === 'RISK',
  );
  const detailAll = roundMoney(detailSales + detailRisk);
  const unallocatedSales = sumDetailCost(
    detailRows,
    (row) =>
      row.costLayer === 'SALES' && row.allocationStatus === 'UNALLOCATED',
  );
  const detailSalesOperand: FormulaOperand = {
    formula: moneyFormula(
      sumIfsFormula(detail, 'totalCost', [
        ['costLayer', quoteFormulaText('SALES')],
      ]),
    ),
    result: detailSales,
  };
  const detailRiskOperand: FormulaOperand = {
    formula: moneyFormula(
      sumIfsFormula(detail, 'totalCost', [
        ['costLayer', quoteFormulaText('RISK')],
      ]),
    ),
    result: detailRisk,
  };
  const detailAllOperand: FormulaOperand = {
    formula: moneyFormula(
      `SUM(${absoluteRangeReference(detail, 'totalCost')})`,
    ),
    result: detailAll,
  };
  const detailUnallocatedOperand: FormulaOperand = {
    formula: moneyFormula(
      sumIfsFormula(detail, 'totalCost', [
        ['costLayer', quoteFormulaText('SALES')],
        ['allocationStatus', quoteFormulaText('UNALLOCATED')],
      ]),
    ),
    result: unallocatedSales,
  };
  const statementSales = statementOperand(statement, '2');
  const statementRisk = statementOperand(statement, '15');
  const statementTotal = statementOperand(statement, TOTAL_WITH_RISK_KEY);
  const statementSalesPlusRisk: FormulaOperand = {
    formula: moneyFormula(
      `SUM(${statementSales.formula},${statementRisk.formula})`,
    ),
    result: roundMoney(statementSales.result + statementRisk.result),
  };

  const checks: ReconciliationCheck[] = [
    {
      id: 'R01',
      name: 'Detail SALES vs Statement Sales Cost',
      leftSource: '01_Cost_Detail · SALES',
      left: detailSalesOperand,
      rightSource: '06_Cost_Statement · 2',
      right: statementSales,
      note: 'All Scope/BU/RE summaries use the Sales Cost basis.',
    },
    {
      id: 'R02',
      name: 'Scope Summary vs Statement Sales Cost',
      leftSource: '02_Summary_Scope · TOTAL',
      left: summaryTotalOperand(scope),
      rightSource: '06_Cost_Statement · 2',
      right: statementSales,
      note: 'Includes an explicit project-level UNALLOCATED row when required.',
    },
    {
      id: 'R03',
      name: 'BU Summary vs Statement Sales Cost',
      leftSource: '03_Summary_BU · TOTAL',
      left: summaryTotalOperand(bu),
      rightSource: '06_Cost_Statement · 2',
      right: statementSales,
      note: 'Includes an explicit project-level UNALLOCATED row when required.',
    },
    {
      id: 'R04',
      name: 'RE Type Summary vs Statement Sales Cost',
      leftSource: '04_Summary_RE_Type · TOTAL',
      left: summaryTotalOperand(resourceType),
      rightSource: '06_Cost_Statement · 2',
      right: statementSales,
      note: 'Project-level amounts are grouped under NON_RESOURCE.',
    },
    {
      id: 'R05',
      name: 'RE Level Summary vs In-house Labour',
      leftSource: '05_Summary_RE_Level · TOTAL',
      left: summaryTotalOperand(grade),
      rightSource: '06_Cost_Statement · 2.3.1.1',
      right: statementOperand(statement, '2.3.1.1'),
      note: 'RE Level intentionally excludes subcontract, travel, and manual cost.',
    },
    {
      id: 'R06',
      name: 'Detail RISK vs Statement Risk',
      leftSource: '01_Cost_Detail · RISK',
      left: detailRiskOperand,
      rightSource: '06_Cost_Statement · 15',
      right: statementRisk,
      note: 'Risk never enters Sales Cost dimension summaries.',
    },
    {
      id: 'R07',
      name: 'Detail total vs Total Cost with Risk',
      leftSource: '01_Cost_Detail · ALL',
      left: detailAllOperand,
      rightSource: '06_Cost_Statement · TOTAL',
      right: statementTotal,
      note: 'Sales and risk are both included.',
    },
    {
      id: 'R08',
      name: 'Statement Sales + Risk vs Grand Total',
      leftSource: '06_Cost_Statement · 2 + 15',
      left: statementSalesPlusRisk,
      rightSource: '06_Cost_Statement · TOTAL',
      right: statementTotal,
      note: 'Checks the top-level statement equation.',
    },
    {
      id: 'R09',
      name: 'Scope unallocated disclosure',
      leftSource: '02_Summary_Scope · UNALLOCATED',
      left: summaryUnallocatedOperand(scope),
      rightSource: '01_Cost_Detail · UNALLOCATED SALES',
      right: detailUnallocatedOperand,
      note: 'A non-zero amount is legitimate; only a mismatch fails.',
    },
    {
      id: 'R10',
      name: 'BU unallocated disclosure',
      leftSource: '03_Summary_BU · UNALLOCATED',
      left: summaryUnallocatedOperand(bu),
      rightSource: '01_Cost_Detail · UNALLOCATED SALES',
      right: detailUnallocatedOperand,
      note: 'A non-zero amount is legitimate; only a mismatch fails.',
    },
    {
      id: 'R11',
      name: 'RE Type non-resource disclosure',
      leftSource: '04_Summary_RE_Type · NON_RESOURCE',
      left: summaryUnallocatedOperand(resourceType),
      rightSource: '01_Cost_Detail · UNALLOCATED SALES',
      right: detailUnallocatedOperand,
      note: 'A non-zero amount is legitimate; only a mismatch fails.',
    },
  ];

  checks.forEach((check) => {
    const row = sheet.addRow([]);
    setCellByKey(row, columns, 'checkId', check.id);
    setCellByKey(row, columns, 'name', check.name);
    setCellByKey(row, columns, 'leftSource', check.leftSource);
    setFormulaByKey(
      row,
      columns,
      'leftAmount',
      check.left.formula,
      check.left.result,
    );
    setCellByKey(row, columns, 'rightSource', check.rightSource);
    setFormulaByKey(
      row,
      columns,
      'rightAmount',
      check.right.formula,
      check.right.result,
    );
    const difference = Number(
      (check.left.result - check.right.result).toFixed(2),
    );
    const differenceCell = localCellReference(
      requireColumn(columns, 'difference'),
      row.number,
    );
    const toleranceCell = localCellReference(
      requireColumn(columns, 'tolerance'),
      row.number,
    );
    setFormulaByKey(
      row,
      columns,
      'difference',
      `ROUND(${localCellReference(requireColumn(columns, 'leftAmount'), row.number)}-${localCellReference(requireColumn(columns, 'rightAmount'), row.number)},2)`,
      difference,
    );
    setCellByKey(row, columns, 'tolerance', 0.01);
    const status = Math.abs(difference) <= 0.01 ? 'PASS' : 'FAIL';
    setFormulaByKey(
      row,
      columns,
      'status',
      `IF(ABS(${differenceCell})<=${toleranceCell},"PASS","FAIL")`,
      status,
    );
    setCellByKey(row, columns, 'note', check.note);
  });

  const lastCheckRow = sheet.lastRow!.number;
  const overallRow = sheet.addRow([]);
  setCellByKey(overallRow, columns, 'checkId', 'OVERALL');
  setCellByKey(overallRow, columns, 'name', 'Workbook reconciliation status');
  const statusRange = localRangeReference(
    requireColumn(columns, 'status'),
    FIRST_DATA_ROW,
    lastCheckRow,
  );
  const allPass = checks.every(
    (check) => Math.abs(check.left.result - check.right.result) <= 0.01,
  );
  setFormulaByKey(
    overallRow,
    columns,
    'status',
    `IF(COUNTIF(${statusRange},"FAIL")>0,"FAIL","PASS")`,
    allPass ? 'PASS' : 'FAIL',
  );

  styleBodyRows(
    sheet,
    FIRST_DATA_ROW,
    overallRow.number,
    RECONCILIATION_COLUMNS.length,
  );
  checks.forEach((_check, index) => {
    const row = sheet.getRow(FIRST_DATA_ROW + index);
    const statusCell = row.getCell(requireColumn(columns, 'status'));
    statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
    const statusValue =
      statusCell.value &&
      typeof statusCell.value === 'object' &&
      'result' in statusCell.value
        ? statusCell.value.result
        : undefined;
    statusCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: statusValue === 'PASS' ? COLORS.paleTeal : COLORS.paleRed,
      },
    };
  });
  styleTableRow(
    overallRow,
    RECONCILIATION_COLUMNS.length,
    allPass ? COLORS.teal : COLORS.red,
    {
      name: 'Arial',
      size: 9,
      bold: true,
      color: { argb: COLORS.white },
    },
  );
  sheet.autoFilter = {
    from: `A${HEADER_ROW}`,
    to: `${excelColumn(RECONCILIATION_COLUMNS.length)}${lastCheckRow}`,
  };
  return sheet;
};

/** Adds Y1–Y5 mapping, travel settings, and both resource master snapshots. */
const addAssumptionsSheet = (
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
) => {
  const sheet = workbook.addWorksheet('08_Assumptions');
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: HEADER_ROW }];
  addSheetTitle(
    sheet,
    'Delivery and Cost Assumptions',
    'Snapshot used by this export; annual cost values remain user-entered.',
  );
  sheet.getRow(HEADER_ROW).values = ['Section', 'Item', 'Value', 'Unit / Note'];
  styleHeaderRow(sheet.getRow(HEADER_ROW));
  const actualYears = getActualYears(snapshot.rateSettings);
  const factors = getLabourRateFactors(snapshot.rateSettings);
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const moneyRows = new Set<number>();
  const assumptionRows: Array<{
    values: [string, string, string | number, string];
    money?: boolean;
  }> = [
    {
      values: [
        'Project',
        'Quote as of',
        snapshot.rateSettings.quoteAsOf,
        'YYYY-MM-DD',
      ],
    },
    {
      values: [
        'Project',
        'TD start',
        snapshot.rateSettings.tdStart,
        'YYYY-MM-DD',
      ],
    },
    {
      values: ['Project', 'TD end', snapshot.rateSettings.tdEnd, 'YYYY-MM-DD'],
    },
    {
      values: [
        'Project',
        'Base year',
        snapshot.rateSettings.baseYear,
        'Calendar year',
      ],
    },
    ...actualYears.map((year, index) => ({
      values: [
        'Year',
        YEAR_BUCKETS[index],
        year ?? 'Not mapped',
        `Uplift ${snapshot.rateSettings.annualUplifts[index] ?? snapshot.rateSettings.defaultUplift}% · Factor ${factors[index].toFixed(4)}x`,
      ] as [string, string, string | number, string],
    })),
    {
      values: [
        'HQ Travel',
        'Monthly allowance',
        roundMoney(snapshot.travelSettings.monthlyAllowance),
        'SGD / month',
      ],
      money: true,
    },
    {
      values: [
        'HQ Travel',
        'Airfare per trip',
        roundMoney(snapshot.travelSettings.airfarePerTrip),
        'SGD / trip',
      ],
      money: true,
    },
    {
      values: [
        'HQ Travel',
        'Trips',
        snapshot.travelSettings.trips,
        'User input',
      ],
    },
    {
      values: ['HQ Travel', 'HQ mandays', travel.hqMandays, 'Calculated'],
    },
    {
      values: ['HQ Travel', 'Months', travel.months, 'HQ MD ÷ MD/month'],
    },
    {
      values: [
        'HQ Travel',
        'Total travel',
        roundMoney(travel.totalCost),
        'Calculated',
      ],
      money: true,
    },
  ];
  assumptionRows.forEach((item) => {
    const row = sheet.addRow(item.values);
    if (item.money) moneyRows.add(row.number);
  });
  const assumptionsLastRow = sheet.lastRow!.number;

  const resourceHeaderRow = assumptionsLastRow + 2;
  sheet.getRow(resourceHeaderRow).values = [
    'Resource Type ID',
    'Code',
    'Name',
    'Category',
    'Pool',
    'Level',
    'MD Rate',
    'MD / Month',
    'Hour / MD',
    'HQ Travel',
    'Active',
  ];
  styleHeaderRow(sheet.getRow(resourceHeaderRow));
  snapshot.resourceTypes.forEach((resource) =>
    sheet.addRow([
      resource.id,
      resource.code,
      resource.name,
      resource.category,
      resource.pool ?? '',
      resource.level ?? '',
      resource.mandayRate,
      resource.mandaysPerMonth,
      resource.hoursPerManday,
      resource.hqTravel ? 'Yes' : 'No',
      resource.active ? 'Yes' : 'No',
    ]),
  );
  const resourceLastRow = sheet.lastRow!.number;

  styleBodyRows(sheet, FIRST_DATA_ROW, assumptionsLastRow, 4);
  if (resourceLastRow > resourceHeaderRow) {
    styleBodyRows(sheet, resourceHeaderRow + 1, resourceLastRow, 11);
  }
  moneyRows.forEach((rowNumber) => {
    sheet.getCell(rowNumber, 3).numFmt = CURRENCY_FORMAT;
  });
  sheet.getColumn(7).numFmt = QUANTITY_FORMAT;
  sheet.getColumn(1).width = 23;
  sheet.getColumn(2).width = 21;
  sheet.getColumn(3).width = 31;
  sheet.getColumn(4).width = 42;
  for (let column = 5; column <= 11; column += 1) {
    sheet.getColumn(column).width = 18;
  }
  return sheet;
};

/** Builds the complete nine-sheet internal-team workbook. */
export const buildCostWorkbook = async (snapshot: CostExportSnapshot) => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost & Quote Workbench';
  workbook.created = new Date(snapshot.exportedAt);
  workbook.modified = new Date(snapshot.exportedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.properties.date1904 = false;

  const issues = validateCostExportSnapshot(snapshot);
  const detailRows = buildDetailRows(snapshot);
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const statementRows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    roundMoney(travel.totalCost),
    snapshot.manualCosts,
  );
  const statementAmounts = buildStatementAmounts(statementRows, detailRows);

  addReadmeSheet(workbook, snapshot, detailRows, issues, statementAmounts);
  const detail = addDetailSheet(workbook, snapshot, detailRows);
  const scope = addSalesSummarySheet(
    workbook,
    '02_Summary_Scope',
    'scope',
    snapshot,
    detailRows,
    detail,
  );
  const bu = addSalesSummarySheet(
    workbook,
    '03_Summary_BU',
    'bu',
    snapshot,
    detailRows,
    detail,
  );
  const resourceType = addSalesSummarySheet(
    workbook,
    '04_Summary_RE_Type',
    'resourceType',
    snapshot,
    detailRows,
    detail,
  );
  const grade = addGradeSummarySheet(workbook, snapshot, detailRows, detail);
  const statement = addStatementSheet(
    workbook,
    snapshot,
    statementRows,
    statementAmounts,
    detail,
  );
  addReconciliationSheet(
    workbook,
    snapshot,
    detailRows,
    detail,
    scope,
    bu,
    resourceType,
    grade,
    statement,
  );
  addAssumptionsSheet(workbook, snapshot);
  return workbook;
};

/** Serializes a workbook for CLI output or browser download. */
export const buildCostWorkbookBytes = async (snapshot: CostExportSnapshot) => {
  const blockingIssues = validateCostExportSnapshot(snapshot).filter(
    (issue) => issue.severity === 'error',
  );
  if (blockingIssues.length > 0) {
    const error = new Error(
      `Cost export blocked by ${blockingIssues.length} validation error(s).`,
    );
    Object.assign(error, { issues: blockingIssues });
    throw error;
  }
  const workbook = await buildCostWorkbook(snapshot);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : Uint8Array.from(buffer as unknown as ArrayLike<number>);
};

/** Creates a filesystem-safe deterministic filename for the browser export. */
export const getCostWorkbookFileName = (snapshot: CostExportSnapshot) => {
  const safeProject = snapshot.project.id.replace(/[^A-Za-z0-9_-]/g, '_');
  const safeVersion = snapshot.costVersion.code.replace(/[^A-Za-z0-9_-]/g, '_');
  const date = snapshot.exportedAt.slice(0, 10);
  return `Cost_${safeProject}_${safeVersion}_${date}.xlsx`;
};

/**
 * Browser-only adapter. The anchor is attached for browser compatibility and
 * removed synchronously; URL revocation waits until the click has dispatched.
 */
export const downloadCostWorkbook = async (snapshot: CostExportSnapshot) => {
  const bytes = await buildCostWorkbookBytes(snapshot);
  const blobBytes = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([blobBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const fileName = getCostWorkbookFileName(snapshot);
  try {
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return { fileName, sizeBytes: bytes.byteLength };
};
