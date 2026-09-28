/** Export the annual grid from an immutable archive; formulas keep derived prices transparent. */
import type { MaintenanceArchive } from './domain.ts';
import { calculateComponentMaintenance } from './component-pricing.ts';

export async function buildComponentWorkbook(archive: MaintenanceArchive) {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Maintenance Quote Draft');
  sheet.columns = [28, 16, 16, 18, 10, 18, 20, 28].map((width) => ({ width }));
  sheet.addRow(['Maintenance quotation draft']);
  sheet.addRow(['Customer', archive.client]);
  sheet.addRow(['Start year', archive.startYear]);
  sheet.addRow(['Prepared', archive.createdAt]);
  sheet.addRow([
    'Model',
    'CT / year',
    'SPMS / year',
    'UnitPrice / year',
    'QTY',
    'Duration / years',
    'Total',
    'Remark',
  ]);
  for (const line of archive.lines) {
    const row = sheet.addRow([
      line.boq.model,
      line.boq.ct ?? line.boq.unitAnnualQuote,
      line.boq.spms ?? 0,
      null,
      line.boq.quantity,
      line.boq.durationYears ?? archive.coverageMonths / 12,
      null,
      line.boq.remark ?? line.boq.basis,
    ]);
    const i = row.number;
    row.getCell(4).value = {
      formula: `ROUNDUP(B${i}+C${i},2)`,
      result: (line.boq.ct ?? line.boq.unitAnnualQuote) + (line.boq.spms ?? 0),
    };
    row.getCell(7).value = {
      formula: `ROUNDUP(D${i}*E${i}*F${i},2)`,
      result: line.quote,
    };
  }
  sheet.addRow([
    'Total',
    '',
    '',
    '',
    '',
    '',
    archive.lines.length
      ? { formula: `SUM(G6:G${sheet.rowCount})`, result: archive.quote }
      : 0,
  ]);
  [2, 3, 4, 7].forEach((column) => {
    sheet.getColumn(column).numFmt = '#,##0.00';
  });
  sheet.getRow(5).font = { bold: true };
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: 5 }];
  const annual = book.addWorksheet('Annual Summary');
  annual.columns = [{ width: 20 }, { width: 24 }];
  annual.addRow(['Year', 'Maintenance total']);
  const summary = calculateComponentMaintenance({
    pricingMode: 'components',
    startYear: archive.startYear,
    coverageMonths: archive.coverageMonths,
    boq: archive.lines.map((line) => line.boq),
    archives: [],
  });
  summary.annual.forEach((item) => annual.addRow([item.year, item.total]));
  annual.getColumn(2).numFmt = '#,##0.00';
  return new Uint8Array(await book.xlsx.writeBuffer());
}
