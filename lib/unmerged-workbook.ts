/** Preserve all source values and formula addresses while making exported ranges independently editable. */
import type { Workbook } from 'exceljs';
export function unmergeWorkbook(workbook: Workbook) {
  for (const sheet of workbook.worksheets) {
    for (const range of sheet.model.merges ?? []) {
      const address = range.split(':')[0];
      const value = sheet.getCell(address).value;
      sheet.unMergeCells(range);
      const cell = sheet.getCell(address);
      cell.value = value;
      // Long headings can flow through the now-independent blank cells instead of wrapping in a narrow column.
      cell.alignment = { ...cell.alignment, wrapText: false };
    }
  }
}
