/** Internal quotation review workbook with live links to the complete Simple Cost statement. */
import type { Workbook, Worksheet } from 'exceljs';
import type { CostExportSnapshot } from '../cost/contracts.ts';
import {
  buildSimpleCostWorkbook,
  getSimpleCostWorkbookFileName,
} from '../cost/export-simple-workbook.ts';
import {
  buildCostStatementRows,
  getHQTravelSummary,
  getY1Year,
  roundMoney,
} from '../cost/domain.ts';
import { calculateBuCostAllocation } from './profit-share.ts';
import { calculatePricing, type PricingSettings } from './domain.ts';
import { buildQuoteLines, validateQuoteLines } from './quote-lines.ts';
import { lineCostAmounts } from './line-pricing.ts';
import { assertValidQuotePricing } from './export-validation.ts';

export type CombinedQuoteWorkbookInput = {
  costSnapshot: CostExportSnapshot;
  pricing: PricingSettings;
};

const FIRST_LINE = 9;
const MONEY = '"S$" #,##0.00;[Red]-"S$" #,##0.00';

/** Match the application’s upward cent rounding, including near-cent floating point noise. */
const money = (expression: string) => {
  const cents = `((${expression})*100)`;
  return `IF(ABS(${cents}-ROUND(${cents},0))<MAX(0.0000001,2.220446049250313E-16*ABS(${cents})),ROUND(${cents},0)/100,-INT(-${cents})/100)`;
};

/** Store a real formula with a cached value for readers that do not recalculate workbooks. */
function formula(
  sheet: Worksheet,
  address: string,
  expression: string,
  result = 0,
) {
  sheet.getCell(address).value = { formula: expression, result };
}

/** Link captured annual cost inputs to row totals and the canonical statement hierarchy. */
function linkCostStatement(workbook: Workbook, snapshot: CostExportSnapshot) {
  const detail = workbook.getWorksheet('Cost Detail')!;
  const statement = workbook.getWorksheet('Cost Statement')!;
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  ).totalCost;
  const rows = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const cells = new Map(rows.map((row, index) => [row.code, `B${index + 5}`]));
  const categoryRefs = {
    internal: [] as string[],
    subcontract: [] as string[],
  };
  snapshot.costRows.forEach((row, index) => {
    const number = index + 6;
    const cell = detail.getCell(`G${number}`);
    formula(
      detail,
      cell.address,
      `SUM(J${number},M${number},P${number},S${number},V${number})`,
      Number(cell.value),
    );
    const category = snapshot.resourceTypes.find(
      (resource) => resource.id === row.reTypeId,
    )?.category;
    if (category) categoryRefs[category].push(`'Cost Detail'!G${number}`);
  });
  // Simple Cost annual amounts remain the editable snapshot inputs, not a second rate engine.
  const totalRow = 6 + snapshot.costRows.length;
  if (snapshot.costRows.length) {
    for (const column of ['G', 'J', 'M', 'P', 'S', 'V']) {
      const cell = detail.getCell(`${column}${totalRow}`);
      formula(
        detail,
        cell.address,
        `SUM(${column}6:${column}${totalRow - 1})`,
        Number(cell.value),
      );
    }
  }
  const subcon = workbook.getWorksheet('Subcon Detail');
  if (subcon) {
    for (let row = 5; row < subcon.rowCount; row++) {
      const cell = subcon.getCell(`I${row}`);
      formula(
        subcon,
        cell.address,
        `SUM(K${row},M${row},O${row},Q${row},S${row})`,
        Number(cell.value),
      );
    }
    const cell = subcon.getCell(`I${subcon.rowCount}`);
    formula(
      subcon,
      cell.address,
      `SUM(I5:I${subcon.rowCount - 1})`,
      Number(cell.value),
    );
    categoryRefs.subcontract.push(`'Subcon Detail'!${cell.address}`);
    for (const column of ['K', 'M', 'O', 'Q', 'S']) {
      const total = subcon.getCell(`${column}${subcon.rowCount}`);
      formula(
        subcon,
        total.address,
        `SUM(${column}5:${column}${subcon.rowCount - 1})`,
        Number(total.value),
      );
    }
  }
  const ref = (code: string) => cells.get(code)!;
  const sums: Record<string, string[]> = {
    '2': ['2.1.2', '2.2', '2.3'],
    '2.2': ['2.2.1'],
    '2.2.1': ['2.2.1.2', '2.2.1.3'],
    '2.3': ['2.3.1', '2.3.2', '2.3.3', '2.3.4'],
    '2.3.1': ['2.3.1.1', '2.3.1.2', '2.3.1.3'],
    '2.3.4': ['2.3.4.1', '2.3.4.2'],
    '': ['2', '15'],
  };
  rows.forEach((row) => {
    const parts = sums[row.code];
    if (parts)
      formula(
        statement,
        ref(row.code),
        `SUM(${parts.map(ref).join(',')})`,
        row.amount,
      );
    const category =
      row.code === '2.3.1.1'
        ? 'internal'
        : row.code === '2.3.2'
          ? 'subcontract'
          : undefined;
    if (category)
      formula(
        statement,
        ref(row.code),
        `SUM(${categoryRefs[category].join(',') || '0'})`,
        row.amount,
      );
    if (
      row.code === '2.3.4.2' &&
      snapshot.manualCosts.otherServiceRate !== undefined
    ) {
      statement.getCell('D4').value = 'EHS Rate';
      statement.getCell('E4').value = snapshot.manualCosts.otherServiceRate;
      statement.getCell('E4').numFmt = '0.00%';
      formula(
        statement,
        ref(row.code),
        money(`SUM(${['2.3.1', '2.3.2', '2.3.3'].map(ref).join(',')})*$E$4`),
        row.amount,
      );
    }
  });
  // Keep existing summary tabs identifiable as captured reports, not live calculation inputs.
  for (const sheet of workbook.worksheets.filter((sheet) =>
    sheet.name.startsWith('Summary '),
  ))
    sheet.getCell('A3').value =
      'Snapshot summary at export. Live costing: Cost Detail / Subcon Detail → Cost Statement → Quotation Details.';
  return {
    total: rows.at(-1)!.amount,
    reference: `'Cost Statement'!${ref('')}`,
  };
}

/** Build a bounded, acyclic GP calculation matching the domain’s rounding and four-decimal unit prices. */
function addGpFormulas(calc: Worksheet, row: number) {
  const q = `'Quotation Details'!`;
  const cost = `${q}E${row}`,
    gp = `${q}H${row}`,
    share = `${q}$E$5`,
    qty = `${q}C${row}`;
  const meets = (price: string) =>
    `${money(`${price}-${cost}-${money(`${price}*${share}`)}`)}+MAX(1E-10,2.220446049250313E-16*${price}*4)>=${price}*${gp}`;
  formula(calc, `F${row}`, `1-${gp}-${share}`);
  formula(calc, `G${row}`, `IF(F${row}>0,${money(`${cost}/F${row}`)},0)`);
  for (let column = 8; column <= 15; column++) {
    const current = calc.getCell(row, column).address;
    const previous = calc.getCell(row, column - 1).address;
    formula(
      calc,
      current,
      `IF(OR(${share}=0,${cost}=0,F${row}<=0),${previous},IF(${meets(previous)},${previous},MAX(${money(`${previous}+0.01`)},${money(`(${cost}+${money(`${previous}*${share}`)})/(1-${gp})`)})))`,
    );
  }
  formula(
    calc,
    `P${row}`,
    `IF(OR(${share}=0,${cost}=0,F${row}<=0),O${row},IF(${meets(`O${row}`)},O${row},${money(`(${cost}+0.01)/F${row}`)}))`,
  );
  formula(
    calc,
    `Q${row}`,
    `IF(${qty}>0,ROUNDDOWN(ROUND(P${row}*100,0)*1000000/ROUND(${qty}*10000,0),0)/10000,0)`,
  );
  formula(calc, `R${row}`, money(`Q${row}*${qty}`));
  formula(
    calc,
    `S${row}`,
    `IF(AND(${share}>0,${cost}>0,F${row}>0),${money(`(${cost}+0.01)/F${row}`)},P${row})`,
  );
}

/** Build a complete internal workbook; input objects and ordinary customer exports remain untouched. */
export async function buildCombinedQuoteWorkbook(
  input: CombinedQuoteWorkbookInput,
) {
  const { costSnapshot: snapshot, pricing } = structuredClone(input);
  const allocation = calculateBuCostAllocation(snapshot);
  const result = calculatePricing(allocation.totalCost, pricing, allocation);
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
  await buildSimpleCostWorkbook(snapshot, undefined, undefined, workbook);
  const statement = linkCostStatement(workbook, snapshot);
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
    'Annual cost values are captured inputs. Edit them in Cost Detail / Subcon Detail, or manual accounts in Cost Statement. Summary tabs remain export snapshots. BU share is the captured weighted rate.';
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
    ];
    formula(
      calc,
      `B${row}`,
      `IF(SUM('Quotation Details'!$F$${FIRST_LINE}:$F$${last})>0,'Quotation Details'!F${row}/SUM('Quotation Details'!$F$${FIRST_LINE}:$F$${last}),1/${lines.length})*ROUND('Quotation Details'!$C$5*100,0)`,
    );
    formula(calc, `C${row}`, `INT(B${row})`);
    formula(calc, `D${row}`, `B${row}-C${row}`);
    formula(
      calc,
      `E${row}`,
      `COUNTIF($D$${FIRST_LINE}:$D$${last},">"&D${row})+COUNTIF($D$${FIRST_LINE}:D${row},D${row})`,
    );
    formula(
      sheet,
      `E${row}`,
      `('Pricing Calculations'!C${row}+IF('Pricing Calculations'!E${row}<=ROUND($C$5*100,0)-SUM('Pricing Calculations'!$C$${FIRST_LINE}:$C$${last}),1,0))/100`,
      costs[index],
    );
    addGpFormulas(calc, row);
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
  const widths = [6, 44, 12, 10, 18, 12, 12, 12, 18, 18, 12, 16, 18];
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
  sheet.autoFilter = `A8:M${last}`;
  sheet.pageSetup.printArea = `A1:M${totalRow}`;
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

/** Archive as an internal cost file, then download; do not create a customer quotation history record. */
export async function downloadCombinedQuoteWorkbook(
  input: CombinedQuoteWorkbookInput,
) {
  const captured = structuredClone(input);
  const bytes = await buildCombinedQuoteWorkbookBytes(captured);
  const fileName = getSimpleCostWorkbookFileName(captured.costSnapshot).replace(
    /^Cost_Simple_/,
    'Quotation_Simple_Cost_',
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
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { fileName, sizeBytes: bytes.byteLength };
}
