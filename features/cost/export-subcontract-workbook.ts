/** Readable BOQ and site-deployment sheets shared by both cost exports. */
import type { CostExportSnapshot } from './contracts.ts';
import { YEAR_BUCKETS, getActualYears, roundQuantity } from './domain.ts';
import {
  calculateSubcontractCost,
  subcontractCostDetails,
} from './subcontract-domain.ts';

export function addSubcontractWorkbookSheets(
  workbook: import('exceljs').Workbook,
  snapshot: CostExportSnapshot,
) {
  const details = subcontractCostDetails(snapshot.subcontractCost);
  if (!details.length) return;
  const years = getActualYears(snapshot.rateSettings);
  const sheet = workbook.addWorksheet('Subcon Detail');
  sheet.addRow([
    `${snapshot.project.name} · ${snapshot.costVersion.code} · Subcontract BOQ / 分包明细`,
  ]);
  sheet.addRow([
    'Version unit prices in SGD; costs feed 2.3.2 / 本版本单价，自动汇总至 2.3.2',
  ]);
  sheet.addRow([]);
  sheet.addRow([
    'Site Type / 站型',
    'Item / 条目',
    'BU',
    'Unit',
    'Unit Price / 单价',
    'Qty / Site',
    'Total Qty',
    'Total Cost',
    ...YEAR_BUCKETS.flatMap((bucket, index) => [
      `${bucket} ${years[index] ?? ''} Qty`,
      `${bucket} Cost`,
    ]),
  ]);
  details.forEach((line) => {
    sheet.addRow([
      line.siteType || 'Project total',
      line.description,
      line.bu,
      line.unit,
      line.unitPrice,
      line.quantityPerSite,
      roundQuantity(line.quantities.reduce((sum, value) => sum + value, 0)),
      line.total,
      ...line.years.flatMap((value, index) => [line.quantities[index], value]),
    ]);
  });
  const totals = calculateSubcontractCost(snapshot.subcontractCost);
  sheet.addRow([
    'Total / 合计',
    '',
    '',
    '',
    '',
    '',
    '',
    totals.total,
    ...totals.years.flatMap((value) => [null, value]),
  ]);
  style(
    sheet,
    [24, 46, 22, 12, 20, 16, 18, 22, ...YEAR_BUCKETS.flatMap(() => [18, 22])],
    [5, 8, ...YEAR_BUCKETS.map((_, index) => 10 + index * 2)],
  );
  if (
    snapshot.subcontractCost?.mode === 'site-types' &&
    snapshot.subcontractCost.siteTypes.length
  ) {
    const sites = workbook.addWorksheet('Subcon Site Types');
    sites.addRow([
      `${snapshot.project.name} · ${snapshot.costVersion.code} · Annual Site Deployment / 年度站型计划`,
    ]);
    sites.addRow([
      'Each site cost is the sum of its BOQ; project shared items are listed in Subcon Detail.',
    ]);
    sites.addRow([]);
    sites.addRow([
      'Site Type / 站型',
      'Cost / Site',
      'Total Cost',
      ...YEAR_BUCKETS.flatMap((bucket, index) => [
        `${bucket} ${years[index] ?? ''} Sites`,
        `${bucket} Cost`,
      ]),
    ]);
    snapshot.subcontractCost.siteTypes.forEach((site, index) => {
      const result = totals.siteTypes[index];
      sites.addRow([
        site.name,
        result.unitCost,
        result.total,
        ...result.years.flatMap((value, year) => [site.sites[year], value]),
      ]);
    });
    style(
      sites,
      [30, 22, 22, ...YEAR_BUCKETS.flatMap(() => [18, 22])],
      [2, 3, ...YEAR_BUCKETS.map((_, index) => 5 + index * 2)],
    );
  }
}

function style(
  sheet: import('exceljs').Worksheet,
  widths: number[],
  monetary: number[],
) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (let column = 1; column <= widths.length; column += 1)
    sheet.getColumn(column).numFmt = monetary.includes(column)
      ? '"S$" #,##0.00'
      : '#,##0.####';
  sheet.mergeCells(1, 1, 1, widths.length);
  sheet.mergeCells(2, 1, 2, widths.length);
  sheet.getRow(1).font = {
    name: 'Arial',
    size: 15,
    bold: true,
    color: { argb: 'FF173A52' },
  };
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 28;
  sheet.getRow(4).height = 34;
  sheet.getRow(4).eachCell((cell) => {
    cell.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF173A52' },
    };
  });
  sheet.eachRow((row) => {
    row.alignment = { wrapText: true, vertical: 'middle' };
    if (row.number > 4) row.height = 36;
  });
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: sheet.rowCount, column: widths.length },
  };
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:4',
  };
}
