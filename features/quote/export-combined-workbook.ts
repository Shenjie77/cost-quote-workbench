import { excelMoneyFormula as money } from '../../lib/excel-money.ts';
import type { MaintenanceWorkspace } from '../maintenance/domain.ts';
import { emptyMaintenance } from '../maintenance/domain.ts';
import { writeMaintenanceTable } from '../maintenance/workbook-table.ts';
import { unmergeWorkbook } from '../../lib/unmerged-workbook.ts';
import type { PersonnelTableLayout } from '../cost/personnel-table-layout.ts';
import type { PersonnelExportReferences } from '../cost/export-simple-workbook.ts';
/** Internal quotation review workbook with live links to the complete Simple Cost statement. */
import type { Worksheet } from 'exceljs';
import type { CostExportSnapshot } from '../cost/contracts.ts';
import {
  buildSimpleCostWorkbook,
  getSimpleCostWorkbookFileName,
} from '../cost/export-simple-workbook.ts';
import { roundMoney } from '../cost/domain.ts';
import { calculateBuCostAllocation } from './profit-share.ts';
import { calculatePricing, type PricingSettings } from './domain.ts';
import { buildQuoteLines, validateQuoteLines } from './quote-lines.ts';
import { lineCostAmounts } from './line-pricing.ts';
import { groupFor } from './quotation-groups.ts';
import { assertValidQuotePricing } from './export-validation.ts';
import {
  getAvailableSimpleCostSheets,
  type SimpleCostSheetId,
} from '../cost/simple-export-sheets.ts';

export type CombinedQuoteWorkbookInput = {
  costSnapshot: CostExportSnapshot;
  pricing: PricingSettings;
  maintenance?: MaintenanceWorkspace;
  selectedSheets?: readonly SimpleCostSheetId[];
  personnelLayout?: PersonnelTableLayout;
};

const FIRST_LINE = 9;
const MONEY = '"S$" #,##0.00;[Red]-"S$" #,##0.00';

/** Store a real formula with a cached value for readers that do not recalculate workbooks. */
function formula(
  sheet: Worksheet,
  address: string,
  expression: string,
  result = 0,
) {
  sheet.getCell(address).value = { formula: expression, result };
}

/** Build a bounded, acyclic GP calculation matching the domain’s rounding and four-decimal unit prices. */
function addGpFormulas(
  calc: Worksheet,
  row: number,
  values: { cost: number; gp: number; share: number; quantity: number },
) {
  const q = `'Quotation Details'!`;
  const cost = `${q}E${row}`,
    gp = `${q}H${row}`,
    share = `${q}$E$5`,
    qty = `${q}C${row}`;
  const meets = (price: string) =>
    `${money(`${price}-${cost}-${money(`${price}*${share}`)}`)}+MAX(1E-10,2.220446049250313E-16*${price}*4)>=${price}*${gp}`;
  const denominator = 1 - values.gp - values.share;
  let price = denominator > 0 ? roundMoney(values.cost / denominator) : 0;
  const needsCorrection =
    values.share > 0 && values.cost > 0 && denominator > 0;
  const meetsTarget = (candidate: number) =>
    roundMoney(candidate - values.cost - roundMoney(candidate * values.share)) +
      Math.max(1e-10, Number.EPSILON * candidate * 4) >=
    candidate * values.gp;
  formula(calc, `F${row}`, `1-${gp}-${share}`, denominator);
  formula(
    calc,
    `G${row}`,
    `IF(F${row}>0,${money(`${cost}/F${row}`)},0)`,
    price,
  );
  for (let column = 8; column <= 15; column++) {
    const current = calc.getCell(row, column).address;
    const previous = calc.getCell(row, column - 1).address;
    if (needsCorrection && !meetsTarget(price))
      price = Math.max(
        roundMoney(price + 0.01),
        roundMoney(
          (values.cost + roundMoney(price * values.share)) / (1 - values.gp),
        ),
      );
    formula(
      calc,
      current,
      `IF(OR(${share}=0,${cost}=0,F${row}<=0),${previous},IF(${meets(previous)},${previous},MAX(${money(`${previous}+0.01`)},${money(`(${cost}+${money(`${previous}*${share}`)})/(1-${gp})`)})))`,
      price,
    );
  }
  if (needsCorrection && !meetsTarget(price))
    price = roundMoney((values.cost + 0.01) / denominator);
  formula(
    calc,
    `P${row}`,
    `IF(OR(${share}=0,${cost}=0,F${row}<=0),O${row},IF(${meets(`O${row}`)},O${row},${money(`(${cost}+0.01)/F${row}`)}))`,
    price,
  );
  const unitPrice =
    values.quantity > 0
      ? Math.trunc(
          (Math.round(price * 100) * 1000000) /
            Math.round(values.quantity * 10000),
        ) / 10000
      : 0;
  formula(
    calc,
    `Q${row}`,
    `IF(${qty}>0,ROUNDDOWN(ROUND(P${row}*100,0)*1000000/ROUND(${qty}*10000,0),0)/10000,0)`,
    unitPrice,
  );
  formula(
    calc,
    `R${row}`,
    money(`Q${row}*${qty}`),
    roundMoney(unitPrice * values.quantity),
  );
  formula(
    calc,
    `S${row}`,
    `IF(AND(${share}>0,${cost}>0,F${row}>0),${money(`(${cost}+0.01)/F${row}`)},P${row})`,
    needsCorrection ? roundMoney((values.cost + 0.01) / denominator) : price,
  );
}

/** Build a complete internal workbook; input objects and ordinary customer exports remain untouched. */
export async function buildCombinedQuoteWorkbook(
  input: CombinedQuoteWorkbookInput,
) {
  const {
    costSnapshot: snapshot,
    pricing,
    selectedSheets,
    personnelLayout,
    maintenance: maintenanceInput,
  } = structuredClone(input);
  const available = getAvailableSimpleCostSheets(snapshot, personnelLayout);
  const selected = new Set<SimpleCostSheetId>(
    selectedSheets ?? available.map((sheet) => sheet.id),
  );
  selected.add('Cost Statement');
  const allocation = calculateBuCostAllocation(snapshot);
  const result = calculatePricing(
    allocation.totalCost,
    pricing,
    allocation,
    snapshot,
  );
  assertValidQuotePricing(result);
  const lines = buildQuoteLines(
    snapshot,
    pricing.lineMode,
    result.listPrice,
    result.allocatedManualLines ?? pricing.manualLines,
  );
  const errors = validateQuoteLines(lines, result.listPrice);
  if (errors.length) throw new Error(errors.join(' '));
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Quotation Details', {
    views: [{ state: 'frozen', ySplit: 8, xSplit: 2, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
  });
  const personnelReferences: PersonnelExportReferences | undefined =
    personnelLayout ? new Map() : undefined;
  await buildSimpleCostWorkbook(
    snapshot,
    personnelLayout,
    [...selected],
    workbook,
    personnelReferences,
  );
  const statement = {
    reference: `'Cost Statement'!B${workbook.getWorksheet('Cost Statement')!.rowCount}`,
  };
  // Open on the internal quote, followed by its complete Simple Cost source sheets.
  workbook.views = [
    {
      x: 0,
      y: 0,
      width: 14000,
      height: 10000,
      visibility: 'visible',
      activeTab: workbook.worksheets.indexOf(sheet),
      firstSheet: 0,
    },
  ];
  const calc = workbook.addWorksheet('Pricing Calculations', {
    state: 'hidden',
  });
  const last = FIRST_LINE + lines.length - 1;
  const totalRow = last + 1;
  const metadata = result.allocatedManualLines ?? pricing.manualLines ?? [];
  const sourceCosts = buildQuoteLines(
    snapshot,
    pricing.lineMode,
    result.cost,
    metadata,
  );
  const internalLines = lines.map((line, index) => ({
    ...line,
    ...(pricing.lineMode === 'manual' ? metadata[index] : {}),
    costWeight:
      pricing.lineMode === 'manual'
        ? (metadata[index]?.costWeight ?? line.amount)
        : sourceCosts[index].amount,
  }));
  const costs = lineCostAmounts(internalLines, result.cost);
  let weights = internalLines.map((line) => line.costWeight);
  if (!weights.some((weight) => weight > 0)) weights = weights.map(() => 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const normalizedWeights = weights.map((weight) => weight / weightTotal);
  const normalizedWeightTotal = normalizedWeights.reduce(
    (sum, weight) => sum + weight,
    0,
  );
  // Remove sub-cent binary noise before ranking remainders across spreadsheet engines.
  const rawCostCents = normalizedWeights.map((weight) =>
    Number(
      (
        (weight / normalizedWeightTotal) *
        Math.round(result.cost * 100)
      ).toFixed(8),
    ),
  );
  const costRemainders = rawCostCents.map((cents) => cents - Math.floor(cents));
  sheet.mergeCells('A1:M1');
  sheet.getCell('A1').value = 'Quotation Details + Simple Cost · Internal';
  sheet.mergeCells('A2:M2');
  sheet.getCell('A2').value =
    `${snapshot.project.name} · ${snapshot.project.client} · ${snapshot.costVersion.code} (${snapshot.costVersion.status})`;
  sheet.mergeCells('A3:M3');
  sheet.getCell('A3').value =
    'Blue cells are inputs. Cost links to Cost Statement; weights are normalized. Target GP prices recalculate; Saved price retains your unit price.';
  for (const [range, label] of [
    ['C4:D4', 'Total Cost'],
    ['E4:F4', 'BU Share'],
    ['G4:H4', 'Discount'],
    ['I4:J4', 'Quote Total'],
    ['K4:M4', 'Actual GP'],
  ]) {
    sheet.mergeCells(range);
    sheet.getCell(range.split(':')[0]).value = label;
  }
  for (const range of ['C5:D5', 'E5:F5', 'G5:H5', 'I5:J5', 'K5:M5'])
    sheet.mergeCells(range);
  formula(sheet, 'C5', statement.reference, result.cost);
  sheet.getCell('E5').value = result.weightedProfitShareRate / 100;
  sheet.getCell('G5').value = result.discount;
  formula(sheet, 'I5', money(`J${totalRow}-G5`), result.quoteBeforeTax);
  formula(
    sheet,
    'K5',
    `IF(I5>0,${money(`I5-C5-${money('I5*E5')}`)}/I5,0)`,
    result.grossMarginPercent / 100,
  );
  sheet.mergeCells('A6:M6');
  sheet.getCell('A6').value =
    'Edit blue quantity inputs in Cost Detail / Subcon Detail, or manual accounts in Cost Statement. Costs, summaries and quotation prices recalculate. BU share is the captured weighted rate.';
  sheet.getRow(8).values = [
    '#',
    'Description',
    'Quantity',
    'Unit',
    'Cost',
    'Weight',
    'Quote share',
    'Target GP',
    'Price / Unit',
    'Amount',
    'Actual GP',
    'Price basis',
    'Saved price input',
    'Remark (internal)',
    'Category',
  ];
  calc.getRow(8).values = [
    'Line',
    'Raw cost cents',
    'Whole cents',
    'Remainder',
    'Remainder rank',
    'GP denominator',
    'Initial price',
    'GP correction 1',
    'GP correction 2',
    'GP correction 3',
    'GP correction 4',
    'GP correction 5',
    'GP correction 6',
    'GP correction 7',
    'GP correction 8',
    'Target amount',
    'Unit price below target',
    'Rounded amount',
    'Coarse quantity amount',
  ];
  lines.forEach((line, index) => {
    const row = FIRST_LINE + index;
    const saved = internalLines[index];
    const gpMode =
      pricing.lineMode === 'manual'
        ? pricing.manualPricingBasis === 'line-gp' &&
          saved.targetGrossMargin !== undefined &&
          !saved.priceFixed
        : lines.length === 1;
    const actualGp =
      line.amount > 0
        ? roundMoney(
            line.amount -
              costs[index] -
              roundMoney((line.amount * result.weightedProfitShareRate) / 100),
          ) / line.amount
        : 0;
    const gp = gpMode
      ? (saved.targetGrossMargin ?? pricing.targetGrossMargin) / 100
      : actualGp;
    sheet.getRow(row).values = [
      index + 1,
      line.description,
      line.quantity,
      line.unit,
      null,
      weights[index] / weightTotal,
      null,
      gp,
      null,
      null,
      null,
      gpMode ? 'Target GP' : 'Saved price',
      line.unitPrice,
      pricing.lineRemarks?.[line.id] ?? '',
      groupFor(saved, pricing.lineGroups).category,
    ];
    formula(
      calc,
      `B${row}`,
      `ROUND(IF(SUM('Quotation Details'!$F$${FIRST_LINE}:$F$${last})>0,'Quotation Details'!F${row}/SUM('Quotation Details'!$F$${FIRST_LINE}:$F$${last}),1/${lines.length})*ROUND('Quotation Details'!$C$5*100,0),8)`,
      rawCostCents[index],
    );
    formula(calc, `C${row}`, `INT(B${row})`, Math.floor(rawCostCents[index]));
    formula(calc, `D${row}`, `B${row}-C${row}`, costRemainders[index]);
    formula(
      calc,
      `E${row}`,
      `COUNTIF($D$${FIRST_LINE}:$D$${last},">"&D${row})+COUNTIF($D$${FIRST_LINE}:D${row},D${row})`,
      costRemainders.filter(
        (remainder, position) =>
          remainder > costRemainders[index] ||
          (remainder === costRemainders[index] && position <= index),
      ).length,
    );
    formula(
      sheet,
      `E${row}`,
      `('Pricing Calculations'!C${row}+IF('Pricing Calculations'!E${row}<=ROUND($C$5*100,0)-SUM('Pricing Calculations'!$C$${FIRST_LINE}:$C$${last}),1,0))/100`,
      costs[index],
    );
    addGpFormulas(calc, row, {
      cost: costs[index],
      gp,
      share: result.weightedProfitShareRate / 100,
      quantity: line.quantity,
    });
    formula(
      sheet,
      `I${row}`,
      `IF(L${row}="Saved price",M${row},IF(OR(C${row}<=0,'Pricing Calculations'!F${row}<=0),NA(),IF('Pricing Calculations'!R${row}='Pricing Calculations'!P${row},'Pricing Calculations'!Q${row},ROUNDUP('Pricing Calculations'!S${row}/C${row}*10000,0)/10000)))`,
      line.unitPrice,
    );
    formula(sheet, `J${row}`, money(`C${row}*I${row}`), line.amount);
    formula(
      sheet,
      `G${row}`,
      `IF($J$${totalRow}>0,J${row}/$J$${totalRow},0)`,
      result.listPrice > 0 ? line.amount / result.listPrice : 0,
    );
    formula(
      sheet,
      `K${row}`,
      `IF(J${row}>0,${money(`J${row}-E${row}-${money(`J${row}*$E$5`)}`)}/J${row},0)`,
      actualGp,
    );
    sheet.getCell(`L${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"Target GP,Saved price"'],
      showErrorMessage: true,
      error: 'Select Target GP or Saved price.',
    };
    for (const [column, minimum, maximum] of [
      ['C', 0.0001, 1000000],
      ['M', 0, 1e12],
    ] as const)
      sheet.getCell(`${column}${row}`).dataValidation = {
        type: 'decimal',
        operator: 'between',
        formulae: [minimum, maximum],
        showErrorMessage: true,
      };
    for (const column of ['F', 'H'])
      sheet.getCell(`${column}${row}`).dataValidation = {
        type: 'decimal',
        operator: 'between',
        formulae: [0, column === 'H' ? 0.95 : 1],
        showErrorMessage: true,
      };
  });
  sheet.getCell(`B${totalRow}`).value = 'Total';
  for (const [column, value] of [
    ['E', result.cost],
    ['J', result.listPrice],
    ['F', 1],
    ['G', result.listPrice > 0 ? 1 : 0],
  ] as const)
    formula(
      sheet,
      `${column}${totalRow}`,
      `SUM(${column}${FIRST_LINE}:${column}${last})`,
      value,
    );
  const widths = [6, 44, 12, 10, 18, 12, 12, 12, 18, 18, 12, 16, 18, 44, 26];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.eachRow((row, number) => {
    row.height =
      number === 3 || number === 6
        ? 34
        : number >= FIRST_LINE && number <= last
          ? 42
          : 28;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF173A52' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (number >= 8)
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFD8D5CD' } },
          right: { style: 'hair', color: { argb: 'FFD8D5CD' } },
        };
      if (number === 8 || number === totalRow) {
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
    });
  });
  for (const column of ['E', 'I', 'J', 'M'])
    sheet.getColumn(column).numFmt = MONEY;
  sheet.getColumn('I').numFmt = '"S$" #,##0.0000';
  sheet.getColumn('M').numFmt = '"S$" #,##0.0000';
  sheet.getColumn('C').numFmt = '0.####';
  for (const column of ['F', 'G', 'H', 'K'])
    sheet.getColumn(column).numFmt = '0.00%';
  for (const cell of ['C5', 'G5', 'I5']) sheet.getCell(cell).numFmt = MONEY;
  sheet.getCell('E5').numFmt = '0.00%';
  sheet.getCell('K5').numFmt = '0.00%';
  for (const cell of ['E5', 'G5'])
    sheet.getCell(cell).font = {
      name: 'Arial',
      size: 10,
      color: { argb: 'FF1565C0' },
    };
  for (let row = FIRST_LINE; row <= last; row++)
    for (const column of ['B', 'C', 'D', 'F', 'H', 'L', 'M'])
      sheet.getCell(`${column}${row}`).font = {
        name: 'Arial',
        size: 10,
        color: { argb: 'FF1565C0' },
      };
  sheet.getCell('A1').font = {
    name: 'Arial',
    bold: true,
    size: 17,
    color: { argb: 'FF173A52' },
  };
  sheet.autoFilter = `A8:O${last}`;
  sheet.pageSetup.printArea = `A1:O${totalRow}`;
  unmergeWorkbook(workbook);
  const maintenance = writeMaintenanceTable(
    sheet,
    totalRow + 3,
    maintenanceInput ?? emptyMaintenance(),
  );
  sheet.getCell('M4').value = 'Quote Total with Maintenance';
  formula(
    sheet,
    'M5',
    `ROUND(I5+J${maintenance.totalRow},2)`,
    roundMoney(result.quoteBeforeTax + maintenance.total),
  );
  sheet.getCell('M4').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getCell('M4').font = {
    name: 'Arial',
    size: 10,
    bold: true,
    color: { argb: 'FF173A52' },
  };
  sheet.getCell('M5').font = {
    name: 'Arial',
    size: 10,
    bold: true,
    color: { argb: 'FF173A52' },
  };
  sheet.getCell('B7').value = 'Quotation Lines';
  sheet.getCell('M5').numFmt = MONEY;
  sheet.getRow(4).height = 44;
  sheet.pageSetup.printArea = `A1:O${maintenance.totalRow}`;
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}

/** Serialize the detached internal workbook for browser downloads or integrations. */
export async function buildCombinedQuoteWorkbookBytes(
  input: CombinedQuoteWorkbookInput,
) {
  const workbook = await buildCombinedQuoteWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : Uint8Array.from(buffer as unknown as ArrayLike<number>);
}

/** Archive as an internal cost file only; do not create a customer quotation history record. */
export async function downloadCombinedQuoteWorkbook(
  input: CombinedQuoteWorkbookInput,
) {
  const captured = structuredClone(input);
  captured.costSnapshot.exportedAt = new Date().toISOString();
  const bytes = await buildCombinedQuoteWorkbookBytes(captured);
  const fileName = getSimpleCostWorkbookFileName(captured.costSnapshot).replace(
    /^Cost_Simple_/,
    'simple_cost_review_',
  );
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const { archiveProjectFile } = await import('../projects/project-files.ts');
  await archiveProjectFile(captured.costSnapshot.project.id, blob, {
    originalName: fileName,
    category: 'cost',
    versionCode: captured.costSnapshot.costVersion.code,
  });
  return { fileName, sizeBytes: bytes.byteLength };
}
