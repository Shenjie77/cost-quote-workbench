/** CPQ output is an internal configuration record, never a customer quotation. */
import type { CpqArchive } from './domain.ts';
import { getCostStatementValues, getHQTravelSummary } from '../cost/domain.ts';
import { subcontractCostDetails } from '../cost/subcontract-domain.ts';
export async function buildCpqWorkbook(archive: CpqArchive) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CPQ Configuration');
  sheet.addRow([
    'Proposal',
    archive.proposalNumber,
    'Cost version',
    archive.costVersion,
  ]);
  sheet.addRow(['Brief', archive.draft.brief]);
  sheet.addRow(['Target basis', archive.draft.targetBasis]);
  sheet.addRow(['Allocation basis', archive.draft.allocationBasis]);
  sheet.addRow([
    'Confirmed by',
    archive.draft.confirmation?.by,
    'Confirmed at',
    archive.draft.confirmation?.at,
  ]);
  sheet.addRow([
    'Code',
    'Scope',
    'Unit',
    'Unit cost',
    'Quantity',
    'Cost',
    'Fixed',
    'Catalog revision',
    'Reason',
  ]);
  archive.result.lines.forEach((line) =>
    sheet.addRow([
      line.item.code,
      line.item.scope,
      line.item.unit,
      line.item.unitCost,
      line.quantity,
      line.amount,
      line.locked ? 'Yes' : 'No',
      line.item.revision,
      line.reason,
    ]),
  );
  sheet.addRow(['Target', archive.result.targetCost]);
  sheet.addRow(['Total', archive.result.totalCost]);
  sheet.addRow(['Difference', archive.result.difference]);
  sheet.addRow([
    'Rounding',
    archive.draft.rounding,
    'Search complete',
    archive.result.searchComplete,
  ]);
  const baseline = workbook.addWorksheet('Cost Baseline');
  baseline.addRow([
    'Version',
    archive.costVersion,
    'Archived at',
    archive.createdAt,
  ]);
  baseline.addRow([
    'Scope',
    'BU',
    'RE Type',
    'Y1 cost',
    'Y2 cost',
    'Y3 cost',
    'Y4 cost',
    'Y5 cost',
  ]);
  archive.costBaseline.costRows.forEach((line) =>
    baseline.addRow([
      line.scope,
      line.bu,
      line.reTypeId,
      ...line.years.map((year) => year.cost),
    ]),
  );
  baseline.addRow([]);
  baseline.addRow(['Manual cost / 手工成本', 'Amount']);
  Object.entries(archive.costBaseline.manualCosts).forEach(([key, amount]) =>
    baseline.addRow([key, amount]),
  );
  const rates = archive.costBaseline.resourceTypes || [];
  const travel = getHQTravelSummary(
    archive.costBaseline.costRows,
    rates,
    archive.costBaseline.travelSettings,
  );
  const totals = getCostStatementValues(
    archive.costBaseline.costRows,
    rates,
    travel.totalCost,
    archive.costBaseline.manualCosts,
    archive.costBaseline.subcontractCost,
  );
  baseline.addRow(['HQ travel', travel.totalCost]);
  if (subcontractCostDetails(archive.costBaseline.subcontractCost).length) {
    const subcontract = workbook.addWorksheet('Subcon Baseline');
    subcontract.addRow([
      'Item',
      'BU',
      'Site Type',
      'Unit',
      'Unit Price SGD',
      'Y1 Cost',
      'Y2 Cost',
      'Y3 Cost',
      'Y4 Cost',
      'Y5 Cost',
      'Total SGD',
    ]);
    for (const line of subcontractCostDetails(
      archive.costBaseline.subcontractCost,
    ))
      subcontract.addRow([
        line.description,
        line.bu,
        line.siteType,
        line.unit,
        line.unitPrice,
        ...line.years,
        line.total,
      ]);
    subcontract.columns.forEach((column, index) => {
      column.width = index === 0 ? 45 : 18;
    });
    subcontract.views = [{ state: 'frozen', ySplit: 1 }];
  }
  baseline.addRow(['Cost including risk', totals.totalWithRisk]);
  const parameters = workbook.addWorksheet('Rates and Assumptions');
  parameters.addRow([
    'Code',
    'Scope / Rate name',
    'MD rate',
    'Days per month',
    'Hours per day',
  ]);
  rates.forEach((rate) =>
    parameters.addRow([
      rate.code,
      rate.name,
      rate.mandayRate,
      rate.mandaysPerMonth,
      rate.hoursPerManday,
    ]),
  );
  parameters.addRow([
    'Rate settings',
    JSON.stringify(archive.costBaseline.rateSettings),
  ]);
  parameters.addRow([
    'Travel settings',
    JSON.stringify(archive.costBaseline.travelSettings),
  ]);
  for (const ws of workbook.worksheets) {
    ws.columns.forEach((column, index) => {
      column.width = index === 1 ? 56 : 22;
    });
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        cell.alignment = { wrapText: true, vertical: 'top' };
        if (typeof cell.value === 'number') cell.numFmt = '#,##0.00##';
      }),
    );
    ws.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  }
  return workbook.xlsx.writeBuffer();
}
export async function downloadCpqArchive(archive: CpqArchive) {
  const bytes = await buildCpqWorkbook(archive);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${archive.id}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
