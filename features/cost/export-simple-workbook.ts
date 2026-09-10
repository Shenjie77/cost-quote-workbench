import { addSubcontractWorkbookSheets } from './export-subcontract-workbook.ts';
/** Page-shaped, read-only cost reports built from one detached cost snapshot. */

import type { CostExportSnapshot } from './contracts.ts';
import {
  YEAR_BUCKETS,
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  buildSubcontractScopeSummary,
  getCostSummaryStatementCode,
  getActualYears,
  getHQTravelSummary,
  getLabourRateFactors,
  roundMoney,
  roundQuantity,
  totalRowCost,
  totalRowMandays,
  totalRowSites,
  yearRowMandays,
  type CostInputRow,
  type CostDimension,
} from './domain.ts';
import {
  getPersonnelColumnSpec,
  type PersonnelColumnId,
} from './personnel-columns.ts';
import {
  getPersonnelAnnualColumn,
  getPersonnelAnnualColumnLabel,
  getPersonnelHeaderSegments,
  groupPersonnelRows,
  resolvePersonnelTableColumns,
  UNASSIGNED_PERSONNEL_GROUP,
  type PersonnelTableLayout,
} from './personnel-table-layout.ts';
import { isLegacySubcontractRow } from './personnel-cost-rows.ts';
import { getCostWorkbookFileName } from './export-workbook.ts';
import { validateCostExportSnapshot } from './validation.ts';

type Workbook = import('exceljs').Workbook;
type Worksheet = import('exceljs').Worksheet;
const setRowValues = (
  row: import('exceljs').Row,
  values: import('exceljs').CellValue[],
) => {
  values.forEach((value, index) => {
    row.getCell(index + 1).value = value;
  });
};

const COLORS = {
  ink: 'FF173A52',
  muted: 'FF667078',
  header: 'FFE9E6DE',
  secondary: 'FFF2F0EA',
  subtotal: 'FFE3F0EF',
  section: 'FFEFE0D1',
  risk: 'FFF4E5D9',
  total: 'FF17437A',
  white: 'FFFFFFFF',
  border: 'FFD8D5CD',
};
const PALETTE = ['FF173A52', 'FF2E6F77', 'FFA86432', 'FF81918B', 'FF657E98'];
const MONEY = '"S$" #,##0.00;[Red]-"S$" #,##0.00;"S$" 0.00';
const STATEMENT_MONEY = '"S$" #,##0.00;[Red]-"S$" #,##0.00;"-"';
const QUANTITY = '#,##0.####';
const quantityFormat = (value: number) =>
  Number.isInteger(value) ? '#,##0' : QUANTITY;
const isDetailMoneyColumn = (column: number) =>
  column === 7 || (column >= 10 && (column - 10) % 3 === 0);
const HEADER_ROW = 4;
const textSegments = new Intl.Segmenter('en', { granularity: 'grapheme' });
const textRowHeight = (values: Array<[string, number]>, minimum: number) =>
  Math.min(
    409,
    Math.max(
      minimum,
      ...values.map(([text, width]) => {
        const lines = text
          .split('\n')
          .reduce(
            (sum, line) =>
              sum +
              Math.max(
                1,
                Math.ceil(
                  Array.from(textSegments.segment(line)).reduce(
                    (length, character) =>
                      length + (character.segment.charCodeAt(0) > 255 ? 2 : 1),
                    0,
                  ) /
                    (width - 4),
                ),
              ),
            0,
          );
        return lines * 15 + 8;
      }),
    ),
  );

const styleRow = (
  sheet: Worksheet,
  rowIndex: number,
  columnCount: number,
  { fill = COLORS.white, bold = false, whiteText = false, height = 32 } = {},
) => {
  const row = sheet.getRow(rowIndex);
  row.height = height;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = {
      name: 'Arial',
      size: 10,
      bold,
      color: { argb: whiteText ? COLORS.white : COLORS.ink },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'hair', color: { argb: COLORS.border } },
    };
  }
  return row;
};

const addSheet = (
  workbook: Workbook,
  snapshot: CostExportSnapshot,
  name: string,
  title: string,
  columnCount: number,
  headerRows = 1,
) => {
  const sheet = workbook.addWorksheet(name);
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = {
    name: 'Arial',
    size: 16,
    bold: true,
    color: { argb: COLORS.ink },
  };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell('A2').value =
    `${snapshot.project.name} · ${snapshot.project.client} · ${snapshot.costVersion.code} (${snapshot.costVersion.status}) · ${snapshot.exportedAt.slice(0, 10)}`;
  sheet.getCell('A2').font = {
    name: 'Arial',
    size: 10,
    color: { argb: COLORS.muted },
  };
  sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(2).height = 34;
  sheet.getRow(3).height = 8;
  sheet.views = [
    {
      showGridLines: false,
      state: 'frozen',
      ySplit: HEADER_ROW + headerRows - 1,
    },
  ];
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `1:${HEADER_ROW + headerRows - 1}`,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.3,
      bottom: 0.3,
      header: 0.1,
      footer: 0.1,
    },
  };
  return sheet;
};

/** Cost Input's business columns and two-tier Y1–Y5 header, without controls. */
const addDetail = (workbook: Workbook, snapshot: CostExportSnapshot) => {
  const columns = 7 + YEAR_BUCKETS.length * 3;
  const sheet = addSheet(
    workbook,
    snapshot,
    'Cost Detail',
    'Cost Detail / 成本详表',
    columns,
    2,
  );
  const headers = [
    'Scope / 服务范围',
    'BU / 业务部',
    'RE Type / 资源类型',
    'MD / Site\n单站人天',
    'Total Sites\n总站点数',
    'Total MD\n总人天',
    'Total Cost\n总成本',
  ];
  styleRow(sheet, HEADER_ROW, columns, {
    fill: COLORS.header,
    bold: true,
    height: 36,
  });
  styleRow(sheet, HEADER_ROW + 1, columns, {
    fill: COLORS.secondary,
    bold: true,
    height: 30,
  });
  headers.forEach((header, index) => {
    sheet.mergeCells(HEADER_ROW, index + 1, HEADER_ROW + 1, index + 1);
    sheet.getCell(HEADER_ROW, index + 1).value = header;
  });
  const actualYears = getActualYears(snapshot.rateSettings);
  const factors = getLabourRateFactors(snapshot.rateSettings);
  YEAR_BUCKETS.forEach((bucket, index) => {
    const firstColumn = 8 + index * 3;
    sheet.mergeCells(HEADER_ROW, firstColumn, HEADER_ROW, firstColumn + 2);
    sheet.getCell(HEADER_ROW, firstColumn).value =
      `${bucket} · ${actualYears[index] ?? 'Set dates'} · ${factors[index].toFixed(4)}×`;
    sheet.getCell(HEADER_ROW, firstColumn).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    ['Sites / 站点数', 'Mandays / 人天', 'Cost / 成本'].forEach(
      (header, offset) => {
        sheet.getCell(HEADER_ROW + 1, firstColumn + offset).value = header;
      },
    );
  });
  [32, 24, 30, 14, 14, 16, 19].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  YEAR_BUCKETS.forEach((_, index) => {
    [14, 16, 19].forEach((width, offset) => {
      sheet.getColumn(8 + index * 3 + offset).width = width;
    });
  });
  for (let column = 4; column <= columns; column += 1) {
    sheet.getColumn(column).numFmt =
      column === 7 || (column >= 10 && (column - 10) % 3 === 0)
        ? MONEY
        : QUANTITY;
  }
  snapshot.costRows.forEach((input, index) => {
    const rowNumber = HEADER_ROW + 2 + index;
    const resource = snapshot.resourceTypes.find(
      (item) => item.id === input.reTypeId,
    );
    const row = styleRow(sheet, rowNumber, columns, {
      height: textRowHeight(
        [
          [input.scope, 32],
          [input.bu, 24],
          [resource?.name ?? '', 30],
        ],
        36,
      ),
    });
    setRowValues(row, [
      input.scope,
      input.bu,
      resource?.name ?? '',
      input.mdPerSite,
      totalRowSites(input),
      totalRowMandays(input),
      totalRowCost(input),
      ...input.years.flatMap((year, yearIndex) => [
        Number(year.sites),
        yearRowMandays(input, yearIndex),
        roundMoney(Number(year.cost)),
      ]),
    ]);
    for (let column = 4; column <= columns; column += 1) {
      if (!isDetailMoneyColumn(column))
        row.getCell(column).numFmt = quantityFormat(
          Number(row.getCell(column).value),
        );
      row.getCell(column).alignment = {
        horizontal: 'right',
        vertical: 'middle',
      };
    }
  });
  const totals = styleRow(
    sheet,
    HEADER_ROW + 2 + snapshot.costRows.length,
    columns,
    {
      fill: COLORS.header,
      bold: true,
      height: 34,
    },
  );
  const sum = (values: number[]) =>
    roundQuantity(values.reduce((total, value) => total + value, 0));
  setRowValues(totals, [
    'Total / 合计',
    'All input lines / 全部成本行',
    null,
    null,
    sum(snapshot.costRows.map(totalRowSites)),
    sum(snapshot.costRows.map(totalRowMandays)),
    roundMoney(
      snapshot.costRows.reduce((total, row) => total + totalRowCost(row), 0),
    ),
    ...YEAR_BUCKETS.flatMap((_, index) => [
      sum(snapshot.costRows.map((row) => Number(row.years[index].sites))),
      sum(snapshot.costRows.map((row) => yearRowMandays(row, index))),
      roundMoney(
        snapshot.costRows.reduce(
          (total, row) => total + roundMoney(Number(row.years[index].cost)),
          0,
        ),
      ),
    ]),
  ]);
  for (let column = 4; column <= columns; column += 1) {
    if (!isDetailMoneyColumn(column))
      totals.getCell(column).numFmt = quantityFormat(
        Number(totals.getCell(column).value),
      );
    totals.getCell(column).alignment = {
      horizontal: 'right',
      vertical: 'middle',
    };
  }
  sheet.views = [
    { showGridLines: false, state: 'frozen', xSplit: 3, ySplit: 5 },
  ];
  // Excel's A3 paper code is supported by the writer but omitted from its enum.
  sheet.pageSetup.paperSize = 8 as import('exceljs').PaperSize;
};

const personnelMoneyColumn = (id: PersonnelColumnId) =>
  id === 'totalCost' || getPersonnelAnnualColumn(id)?.field === 'cost';
const personnelTextColumn = (id: PersonnelColumnId) =>
  ['groupName', 'scope', 'bu', 'reType'].includes(id);
const personnelColumnWidth = (id: PersonnelColumnId) =>
  id === 'scope'
    ? 36
    : id === 'groupName'
      ? 26
      : id === 'reType'
        ? 28
        : id === 'bu'
          ? 22
          : personnelMoneyColumn(id)
            ? 20
            : 16;

function personnelValue(
  input: CostInputRow,
  id: PersonnelColumnId,
  snapshot: CostExportSnapshot,
): import('exceljs').CellValue {
  if (id === 'groupName') return input.groupName?.trim() || '';
  if (id === 'scope' || id === 'bu') return input[id];
  if (id === 'reType')
    return (
      snapshot.resourceTypes.find((item) => item.id === input.reTypeId)?.name ||
      ''
    );
  if (id === 'mdPerSite')
    return input.inputMode === 'mandays' ? '—' : input.mdPerSite;
  if (id === 'totalSites') return totalRowSites(input);
  if (id === 'totalMd') return totalRowMandays(input);
  if (id === 'totalCost') return totalRowCost(input);
  const annual = getPersonnelAnnualColumn(id);
  if (!annual) return null;
  if (annual.field === 'sites')
    return input.inputMode === 'mandays'
      ? '—'
      : Number(input.years[annual.index].sites);
  if (annual.field === 'mandays') return yearRowMandays(input, annual.index);
  return roundMoney(Number(input.years[annual.index].cost));
}

function personnelTotal(rows: CostInputRow[], id: PersonnelColumnId) {
  const annual = getPersonnelAnnualColumn(id);
  if (id === 'totalSites')
    return roundQuantity(
      rows.reduce((sum, row) => sum + totalRowSites(row), 0),
    );
  if (id === 'totalMd')
    return roundQuantity(
      rows.reduce((sum, row) => sum + totalRowMandays(row), 0),
    );
  if (id === 'totalCost')
    return roundMoney(rows.reduce((sum, row) => sum + totalRowCost(row), 0));
  if (annual) {
    const value = rows.reduce(
      (sum, row) =>
        sum +
        (annual.field === 'mandays'
          ? yearRowMandays(row, annual.index)
          : Number(row.years[annual.index][annual.field])),
      0,
    );
    return annual.field === 'cost' ? roundMoney(value) : roundQuantity(value);
  }
  return null;
}

/** The browser's current personnel view, with the same grouping and visible column order. */
function addPersonnelDetail(
  workbook: Workbook,
  snapshot: CostExportSnapshot,
  layout: PersonnelTableLayout,
  columns: PersonnelColumnId[],
) {
  const rows = snapshot.costRows.filter(
    (row) => !isLegacySubcontractRow(row, snapshot.resourceTypes),
  );
  const segments = getPersonnelHeaderSegments(columns);
  const hasAnnual = columns.some((id) => getPersonnelAnnualColumn(id));
  const headerRows = hasAnnual ? 2 : 1;
  const sheet = addSheet(
    workbook,
    snapshot,
    'Cost Detail',
    'Cost Detail',
    columns.length,
    headerRows,
  );
  const actualYears = getActualYears(snapshot.rateSettings);
  sheet.mergeCells(3, 1, 3, columns.length);
  const viewNote = `Cost view: ${layout.grouped ? 'Grouped' : 'Ungrouped'} · ${layout.yearIndex === 'all' ? 'All years' : `${YEAR_BUCKETS[layout.yearIndex]} · ${actualYears[layout.yearIndex] ?? 'Set dates'}`}. Total columns, summaries and Cost Statement cover all years.`;
  sheet.getCell('A3').value = viewNote;
  sheet.getCell('A3').font = {
    name: 'Arial',
    size: 9,
    color: { argb: COLORS.muted },
  };
  sheet.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(3).height = textRowHeight(
    [
      [
        viewNote,
        columns.reduce((sum, id) => sum + personnelColumnWidth(id), 0),
      ],
    ],
    28,
  );
  styleRow(sheet, HEADER_ROW, columns.length, {
    fill: COLORS.header,
    bold: true,
    height: 34,
  });
  if (hasAnnual)
    styleRow(sheet, HEADER_ROW + 1, columns.length, {
      fill: COLORS.secondary,
      bold: true,
      height: 28,
    });
  let firstColumn = 1;
  for (const segment of segments) {
    if (segment.index === undefined) {
      if (hasAnnual)
        sheet.mergeCells(HEADER_ROW, firstColumn, HEADER_ROW + 1, firstColumn);
      sheet.getCell(HEADER_ROW, firstColumn).value = getPersonnelColumnSpec(
        segment.ids[0],
      ).label;
    } else {
      if (segment.ids.length > 1)
        sheet.mergeCells(
          HEADER_ROW,
          firstColumn,
          HEADER_ROW,
          firstColumn + segment.ids.length - 1,
        );
      sheet.getCell(HEADER_ROW, firstColumn).value =
        `${YEAR_BUCKETS[segment.index]} · ${actualYears[segment.index] ?? 'Set dates'}`;
      sheet.getCell(HEADER_ROW, firstColumn).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      segment.ids.forEach((id, offset) => {
        const field = getPersonnelAnnualColumn(id)!.field;
        sheet.getCell(HEADER_ROW + 1, firstColumn + offset).value =
          getPersonnelAnnualColumnLabel(field);
      });
    }
    firstColumn += segment.ids.length;
  }
  columns.forEach((id, index) => {
    sheet.getColumn(index + 1).width = personnelColumnWidth(id);
    if (!personnelTextColumn(id))
      sheet.getColumn(index + 1).numFmt = personnelMoneyColumn(id)
        ? MONEY
        : QUANTITY;
  });
  let rowNumber = HEADER_ROW + headerRows;
  const writeInput = (input: CostInputRow) => {
    const values = columns.map((id) => personnelValue(input, id, snapshot));
    const row = styleRow(sheet, rowNumber++, columns.length, {
      height: textRowHeight(
        values.flatMap((value, index) =>
          typeof value === 'string'
            ? [
                [value, personnelColumnWidth(columns[index])] as [
                  string,
                  number,
                ],
              ]
            : [],
        ),
        32,
      ),
    });
    setRowValues(row, values);
    columns.forEach((id, index) => {
      const cell = row.getCell(index + 1);
      if (!personnelTextColumn(id)) {
        if (typeof cell.value === 'number' && !personnelMoneyColumn(id))
          cell.numFmt = quantityFormat(cell.value);
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  };
  if (layout.grouped) {
    for (const group of groupPersonnelRows(rows)) {
      const title = group.groupName || UNASSIGNED_PERSONNEL_GROUP;
      const groupRow = styleRow(sheet, rowNumber++, columns.length, {
        fill: COLORS.subtotal,
        bold: true,
        height: textRowHeight(
          [
            [
              title,
              columns.reduce((sum, id) => sum + personnelColumnWidth(id), 0),
            ],
          ],
          28,
        ),
      });
      sheet.mergeCells(groupRow.number, 1, groupRow.number, columns.length);
      groupRow.getCell(1).value =
        `${title} · ${group.rows.length} ${group.rows.length === 1 ? 'row' : 'rows'}`;
      group.rows.forEach(writeInput);
    }
  } else rows.forEach(writeInput);
  const totals = styleRow(sheet, rowNumber, columns.length, {
    fill: COLORS.header,
    bold: true,
    height: 34,
  });
  const textColumn = columns.find(
    (id) => personnelTextColumn(id) || id === 'mdPerSite',
  );
  columns.forEach((id, index) => {
    const value = personnelTotal(rows, id);
    const cell = totals.getCell(index + 1);
    cell.value =
      value === null && id === textColumn
        ? `Visible Total · ${rows.length} rows`
        : value;
    if (typeof value === 'number') {
      cell.numFmt = personnelMoneyColumn(id) ? MONEY : quantityFormat(value);
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  });
  sheet.views = [
    {
      showGridLines: false,
      state: 'frozen',
      ...(columns[0] === 'scope' ? { xSplit: 1 } : {}),
      ySplit: HEADER_ROW + headerRows - 1,
    },
  ];
  sheet.pageSetup.paperSize = 8 as import('exceljs').PaperSize;
}

/** Legacy package amounts are retained separately when exporting the personnel-only view. */
function addLegacySubcontractDetail(
  workbook: Workbook,
  snapshot: CostExportSnapshot,
) {
  const rows = snapshot.costRows.filter((row) =>
    isLegacySubcontractRow(row, snapshot.resourceTypes),
  );
  if (!rows.length) return;
  const columns = 4 + YEAR_BUCKETS.length;
  const sheet = addSheet(
    workbook,
    snapshot,
    'Legacy Subcon',
    'Legacy Subcontract Cost',
    columns,
  );
  setRowValues(
    styleRow(sheet, HEADER_ROW, columns, { fill: COLORS.header, bold: true }),
    [
      'Scope',
      'BU',
      'RE Type',
      'Total Cost',
      ...YEAR_BUCKETS.map((bucket) => `${bucket} Cost (SGD)`),
    ],
  );
  [36, 24, 28, 20, ...YEAR_BUCKETS.map(() => 20)].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  rows.forEach((input, index) => {
    const row = styleRow(sheet, HEADER_ROW + 1 + index, columns);
    setRowValues(row, [
      input.scope,
      input.bu,
      snapshot.resourceTypes.find((resource) => resource.id === input.reTypeId)
        ?.name || '',
      totalRowCost(input),
      ...input.years.map((year) => roundMoney(Number(year.cost))),
    ]);
  });
  setRowValues(
    styleRow(sheet, HEADER_ROW + 1 + rows.length, columns, {
      fill: COLORS.header,
      bold: true,
    }),
    [
      'Total',
      null,
      null,
      roundMoney(rows.reduce((sum, row) => sum + totalRowCost(row), 0)),
      ...YEAR_BUCKETS.map((_, index) =>
        roundMoney(
          rows.reduce((sum, row) => sum + Number(row.years[index].cost), 0),
        ),
      ),
    ],
  );
  for (let column = 4; column <= columns; column++)
    sheet.getColumn(column).numFmt = MONEY;
}

/** Same columns, descending order, labels and color bars as BreakdownTable. */
const addBreakdown = (
  workbook: Workbook,
  snapshot: CostExportSnapshot,
  dimension: CostDimension,
  name: string,
  title: string,
  travelCost: number,
  subcontractOnly = false,
) => {
  const sheet = addSheet(workbook, snapshot, name, title, 5);
  sheet.mergeCells(3, 1, 3, 5);
  sheet.getCell('A3').value = subcontractOnly
    ? 'Cost Statement 2.3.2 · Subcontract BOQ and preserved legacy packages · All years'
    : 'Total Cost with Risk · All years · Project-level costs reference Cost Statement accounts';
  sheet.getCell('A3').font = {
    name: 'Arial',
    size: 9,
    color: { argb: COLORS.muted },
  };
  sheet.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(3).height = 28;
  const header = styleRow(sheet, HEADER_ROW, 5, {
    fill: COLORS.secondary,
    bold: true,
    height: 34,
  });
  setRowValues(header, [
    'Dimension / 维度',
    'Cost Distribution / 成本分布',
    'Mandays / 人天',
    'Cost / 成本',
    'Share / 占比',
  ]);
  [44, 34, 22, 23, 15].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getColumn(2).numFmt = ';;;';
  sheet.getColumn(3).numFmt = `${QUANTITY}" MD"`;
  sheet.getColumn(4).numFmt = MONEY;
  sheet.getColumn(5).numFmt = '0.0%';
  const statementRows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travelCost,
    snapshot.manualCosts,
    snapshot.subcontractCost,
  );
  const items = subcontractOnly
    ? buildSubcontractScopeSummary(
        snapshot.costRows,
        snapshot.resourceTypes,
        snapshot.subcontractCost,
      )
    : buildReconciledCostDimensionSummary(
        snapshot.costRows,
        dimension,
        snapshot.resourceTypes,
        travelCost,
        snapshot.manualCosts,
        snapshot.subcontractCost,
        { includeRisk: true },
      );
  const totalMandays = items.reduce((sum, item) => sum + item.mandays, 0);
  const maxCost = Math.max(1, ...items.map((item) => item.cost));
  items.forEach((item, index) => {
    const rowNumber = HEADER_ROW + 1 + index;
    const labelZh = statementRows.find(
      (row) => row.code === getCostSummaryStatementCode(item.key),
    )?.zh;
    const label = labelZh ? `${item.label} / ${labelZh}` : item.label;
    const row = styleRow(sheet, rowNumber, 5, {
      height: textRowHeight([[label, 44]], 42),
    });
    setRowValues(row, [
      label,
      item.cost,
      item.mandays,
      item.cost,
      item.shareRatio,
    ]);
    const mdShare =
      totalMandays > 0
        ? ((item.mandays / totalMandays) * 100).toFixed(1)
        : '0.0';
    row.getCell(3).numFmt =
      `${quantityFormat(item.mandays)}" MD (${mdShare}%)"`;
    for (let column = 3; column <= 5; column += 1)
      row.getCell(column).alignment = {
        horizontal: 'right',
        vertical: 'middle',
        wrapText: true,
      };
    // ExcelJS serializes bar color; its public rule type omits that property.
    const bar: import('exceljs').DataBarRuleType & { color: { argb: string } } =
      {
        type: 'dataBar',
        priority: index + 1,
        gradient: false,
        showValue: false,
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: maxCost },
        ],
        color: { argb: PALETTE[index % PALETTE.length] },
      };
    sheet.addConditionalFormatting({ ref: `B${rowNumber}`, rules: [bar] });
  });
  const total = styleRow(sheet, HEADER_ROW + 1 + items.length, 5, {
    fill: COLORS.subtotal,
    bold: true,
  });
  setRowValues(total, [
    subcontractOnly
      ? '2.3.2 · Subcontract Cost / 合作成本'
      : 'Total Cost with Risk / 含风险总成本',
    null,
    roundQuantity(totalMandays),
    roundMoney(items.reduce((sum, item) => sum + item.cost, 0)),
    items.some((item) => item.cost > 0) ? 1 : 0,
  ]);
  total.getCell(3).numFmt = `${quantityFormat(totalMandays)}" MD"`;
  for (let column = 3; column <= 5; column += 1)
    total.getCell(column).alignment = {
      horizontal: 'right',
      vertical: 'middle',
    };
};

const addStatement = (
  workbook: Workbook,
  snapshot: CostExportSnapshot,
  travelCost: number,
) => {
  const sheet = addSheet(
    workbook,
    snapshot,
    'Cost Statement',
    'Cost Statement / 成本报表',
    2,
  );
  sheet.getColumn(1).width = 100;
  sheet.getColumn(2).width = 25;
  sheet.getColumn(2).numFmt = STATEMENT_MONEY;
  const header = styleRow(sheet, HEADER_ROW, 2, {
    fill: COLORS.total,
    whiteText: true,
    bold: true,
    height: 36,
  });
  setRowValues(header, ['Report Item (SGD) / 报表项', 'Cost (SGD) / 成本']);
  const rows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travelCost,
    snapshot.manualCosts,
    snapshot.subcontractCost,
  );
  rows.forEach((item, index) => {
    const fill =
      item.mode === 'grand-total'
        ? COLORS.total
        : item.mode === 'section'
          ? COLORS.section
          : item.code === '15'
            ? COLORS.risk
            : item.mode === 'subtotal'
              ? COLORS.subtotal
              : COLORS.white;
    const row = styleRow(sheet, HEADER_ROW + 1 + index, 2, {
      fill,
      whiteText: item.mode === 'grand-total',
      bold: ['grand-total', 'section', 'subtotal'].includes(item.mode),
      height: 38,
    });
    setRowValues(row, [
      `${item.code ? `${item.code}  ` : ''}${item.en} / ${item.zh}`,
      item.amount,
    ]);
    row.getCell(1).alignment = {
      indent: item.level,
      wrapText: true,
      vertical: 'middle',
    };
    row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
  });
};

/** Values are fixed to this version's snapshot, using the page's shared calculations. */
export const buildSimpleCostWorkbookBytes = async (
  input: CostExportSnapshot,
  requestedLayout?: PersonnelTableLayout,
) => {
  // Detach before the first asynchronous boundary, even for direct CLI callers.
  const snapshot = structuredClone(input);
  const layout =
    requestedLayout === undefined
      ? undefined
      : structuredClone(requestedLayout);
  const columns = layout
    ? resolvePersonnelTableColumns(layout.columns, layout.yearIndex).filter(
        (id) => id !== 'check' && id !== 'action',
      )
    : undefined;
  if (columns && !columns.length)
    throw new Error(
      'Select at least one visible business column before exporting the personnel view.',
    );
  const blockingIssues = validateCostExportSnapshot(snapshot).filter(
    (issue) => issue.severity === 'error',
  );
  if (blockingIssues.length) {
    const error = new Error(
      `Cost export blocked by ${blockingIssues.length} validation error(s).`,
    );
    Object.assign(error, { issues: blockingIssues });
    throw error;
  }
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost & Quote Workbench';
  workbook.created = new Date(snapshot.exportedAt);
  workbook.modified = new Date(snapshot.exportedAt);
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  if (layout && columns) {
    addPersonnelDetail(workbook, snapshot, layout, columns);
    addLegacySubcontractDetail(workbook, snapshot);
  } else addDetail(workbook, snapshot);
  addSubcontractWorkbookSheets(workbook, snapshot);
  addBreakdown(
    workbook,
    snapshot,
    'scope',
    'Summary Scope',
    'Scope / 服务范围汇总',
    travel.totalCost,
  );
  addBreakdown(
    workbook,
    snapshot,
    'bu',
    'Summary BU',
    'BU / 业务部汇总',
    travel.totalCost,
  );
  addBreakdown(
    workbook,
    snapshot,
    'resourceType',
    'Summary RE Type',
    'RE Type & Level / 资源类型与级别汇总',
    travel.totalCost,
  );
  addBreakdown(
    workbook,
    snapshot,
    'scope',
    'Summary Subcon',
    'Subcontract Cost / 合作成本汇总',
    travel.totalCost,
    true,
  );
  addStatement(workbook, snapshot, travel.totalCost);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : Uint8Array.from(buffer as unknown as ArrayLike<number>);
};

export const getSimpleCostWorkbookFileName = (snapshot: CostExportSnapshot) =>
  getCostWorkbookFileName(snapshot).replace(/^Cost_/, 'Cost_Simple_');

/** Browser download adapter; neither exporting nor opening a report updates costs. */
export const downloadSimpleCostWorkbook = async (
  input: CostExportSnapshot,
  requestedLayout?: PersonnelTableLayout,
) => {
  const snapshot = structuredClone(input);
  const layout =
    requestedLayout === undefined
      ? undefined
      : structuredClone(requestedLayout);
  const bytes = await buildSimpleCostWorkbookBytes(snapshot, layout);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fileName = getSimpleCostWorkbookFileName(snapshot);
  const { archiveProjectFile } = await import('../projects/project-files.ts');
  await archiveProjectFile(snapshot.project.id, blob, {
    originalName: fileName,
    category: 'cost',
    versionCode: snapshot.costVersion.code,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
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
