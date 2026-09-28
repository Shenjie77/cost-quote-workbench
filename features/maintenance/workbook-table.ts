import { excelMoneyFormula } from '../../lib/excel-money.ts';
/** A shared, unmerged maintenance schedule for quotation and standalone exports. */
import type { Worksheet } from 'exceljs';
import type { MaintenanceWorkspace } from './domain.ts';
import {
  calculateComponentMaintenance,
  maintenanceGridDraft,
} from './component-pricing.ts';
import { roundMoney } from '../cost/domain.ts';

/** Write editable inputs and formula-linked annual / full-term prices without altering the source draft. */
export function writeMaintenanceTable(
  sheet: Worksheet,
  startRow: number,
  source: MaintenanceWorkspace,
) {
  const data = maintenanceGridDraft(source);
  const result = calculateComponentMaintenance(data);
  const header = startRow + 1;
  const first = header + 1;
  sheet.getCell(`B${startRow}`).value = 'Maintenance';
  sheet.getCell(`L${startRow}`).value = `Start year: ${data.startYear}`;
  sheet.getRow(header).values = [
    '#',
    'Desc.',
    'Model',
    'CT',
    'SPMS',
    'U/P',
    'QTY',
    'Yearly',
    'Dur.',
    'Total',
    'Hist.',
    'Rmk.',
  ];
  // A blank editable row is retained when the project has no maintenance equipment yet.
  const count = Math.max(1, data.boq.length);
  for (let index = 0; index < count; index++) {
    const item = data.boq[index];
    const n = first + index;
    const ct = item?.ct ?? 0,
      spms = item?.spms ?? 0,
      qty = item?.quantity ?? 0;
    const unit = roundMoney(ct + spms),
      yearly = roundMoney(unit * qty);
    const row = sheet.getRow(n);
    row.values = [
      index + 1,
      item?.description || null,
      item?.model || null,
      ct,
      spms,
      null,
      qty,
      null,
      item?.durationYears ?? 0,
      null,
      null,
      item?.remark || null,
    ];
    row.getCell(6).value = { formula: `ROUND(D${n}+E${n},2)`, result: unit };
    row.getCell(8).value = { formula: `ROUND(F${n}*G${n},2)`, result: yearly };
    row.getCell(10).value = {
      formula: excelMoneyFormula(`H${n}*I${n}`),
      result: result.lines[index]?.quote ?? 0,
    };
    for (const col of [2, 3, 4, 5, 7, 9, 12])
      row.getCell(col).font = {
        name: 'Arial',
        size: 10,
        color: { argb: 'FF1565C0' },
      };
    row.height = 30;
  }
  const last = first + count - 1,
    totalRow = last + 1;
  sheet.getCell(`B${totalRow}`).value = 'Maintenance Total';
  sheet.getCell(`H${totalRow}`).value = {
    formula: `SUM(H${first}:H${last})`,
    result: roundMoney(
      data.boq.reduce(
        (sum, item) =>
          sum + roundMoney((item.ct! + item.spms!) * item.quantity),
        0,
      ),
    ),
  };
  sheet.getCell(`J${totalRow}`).value = {
    formula: `SUM(J${first}:J${last})`,
    result: result.quote,
  };
  for (let n = header; n <= totalRow; n++) {
    const row = sheet.getRow(n);
    for (let c = 1; c <= 12; c++) {
      const cell = row.getCell(c);
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD8D5CD' } },
        right: { style: 'hair', color: { argb: 'FFD8D5CD' } },
      };
      cell.numFmt = [4, 5, 6, 8, 10].includes(c)
        ? '#,##0.00'
        : c === 7
          ? '0'
          : c === 9
            ? '0.00'
            : 'General';
      if (n === header || n === totalRow) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF173A52' },
        };
        cell.font = {
          name: 'Arial',
          size: 10,
          bold: true,
          color: { argb: 'FFFFFFFF' },
        };
      }
    }
  }
  sheet.getRow(header).height = 28;
  return { totalRow, first, last, total: result.quote, annual: result.annual };
}
