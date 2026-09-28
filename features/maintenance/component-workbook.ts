/** Export an immutable annual maintenance archive using the same grid as quotation exports. */
import type { MaintenanceArchive } from './domain.ts';
import { writeMaintenanceTable } from './workbook-table.ts';

export async function buildComponentWorkbook(archive: MaintenanceArchive) {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Maintenance Quote Draft');
  sheet.columns = [6, 36, 24, 14, 14, 16, 10, 18, 10, 20, 16, 28].map(
    (width) => ({ width }),
  );
  sheet.addRow(['Maintenance quotation draft']);
  sheet.addRow(['Customer', archive.client]);
  sheet.addRow(['Prepared', archive.createdAt]);
  const summary = writeMaintenanceTable(sheet, 4, {
    pricingMode: 'components',
    startYear: archive.startYear,
    coverageMonths: archive.coverageMonths,
    boq: archive.lines.map((line) => line.boq),
    archives: [],
  });
  sheet.views = [{ state: 'frozen', ySplit: 5 }];
  const annual = book.addWorksheet('Annual Summary');
  annual.columns = [{ width: 20 }, { width: 24 }];
  annual.addRow(['Year', 'Maintenance total']);
  summary.annual.forEach((item) => annual.addRow([item.year, item.total]));
  annual.getColumn(2).numFmt = '#,##0.00';
  book.calcProperties.fullCalcOnLoad = true;
  return new Uint8Array(await book.xlsx.writeBuffer());
}
