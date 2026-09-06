/** BOQ quantities and independently selected maintenance price references. */
import { roundMoney } from '../cost/domain.ts';
import { contentKey } from '../cpq/domain.ts';
import { importCellValue, workbookHash } from '../cost/import-workbook.ts';
import {
  unitAnnualMaintenanceCost,
  unitAnnualMaintenanceQuote,
  type MaintenancePriceRecord,
} from '../master-data/domain.ts';
export type BoqLine = {
  originalQuantity?: number;
  originalModel?: string;
  id: string;
  model: string;
  quantity: number;
  serviceLevel: string;
  site: string;
  referenceId: string;
  unitAnnualQuote: number;
  basis: string;
  source: string;
};
export type MaintenanceQuoteLine = {
  boq: BoqLine;
  reference: MaintenancePriceRecord;
  annualReferenceQuote: number;
  annualReferenceCost: number;
  cost: number;
  quote: number;
};
export type MaintenanceArchive = {
  id: string;
  createdAt: string;
  client: string;
  coverageMonths: number;
  lines: MaintenanceQuoteLine[];
  cost: number;
  quote: number;
};
export type MaintenanceWorkspace = {
  coverageMonths: number;
  boq: BoqLine[];
  archives: MaintenanceArchive[];
};
export const emptyMaintenance = (): MaintenanceWorkspace => ({
  coverageMonths: 12,
  boq: [],
  archives: [],
});
const normalized = (s: string) => s.normalize('NFKC').trim().toLowerCase();
export function maintenanceCandidates(
  records: MaintenancePriceRecord[],
  model: string,
) {
  return records
    .filter(
      (r) =>
        normalized(r.productModel) === normalized(model) &&
        unitAnnualMaintenanceQuote(r) !== null,
    )
    .map((r) => ({
      record: r,
      unitAnnualQuote: unitAnnualMaintenanceQuote(r)!,
      unitAnnualCost: unitAnnualMaintenanceCost(r),
    }));
}
export function calculateMaintenance(
  data: MaintenanceWorkspace,
  records: MaintenancePriceRecord[],
) {
  if (
    !Number.isInteger(data.coverageMonths) ||
    data.coverageMonths <= 0 ||
    data.coverageMonths > 1200 ||
    !data.boq.length
  )
    throw new TypeError('请填写BOQ与有效维保月数');
  if (new Set(data.boq.map((r) => r.id)).size !== data.boq.length)
    throw new TypeError('Duplicate BOQ row IDs');
  const lines = data.boq.map((boq) => {
    if (
      !boq.id.trim() ||
      !boq.model.trim() ||
      !Number.isInteger(boq.quantity) ||
      boq.quantity <= 0 ||
      boq.quantity > 1e6 ||
      !Number.isFinite(boq.unitAnnualQuote) ||
      boq.unitAnnualQuote < 0 ||
      boq.unitAnnualQuote > 1e10 ||
      !boq.basis.trim() ||
      !boq.source.trim() ||
      Math.abs(
        boq.unitAnnualQuote * 100 - Math.round(boq.unitAnnualQuote * 100),
      ) > 0.000001 ||
      !boq.serviceLevel.trim()
    )
      throw new TypeError(
        '每行需要设备型号、实际数量、SLA、精确到分的单台年价、设备数量来源及选价依据',
      );
    const ref = maintenanceCandidates(records, boq.model).find(
      (r) => r.record.id === boq.referenceId,
    );
    if (!ref || ref.unitAnnualCost === null)
      throw new TypeError(`${boq.model}: 请选择同型号的有效历史记录`);
    const cost = roundMoney(
        (ref.unitAnnualCost * boq.quantity * data.coverageMonths) / 12,
      ),
      quote = roundMoney(
        (boq.unitAnnualQuote * boq.quantity * data.coverageMonths) / 12,
      );
    if (cost > 1e12 || quote > 1e12)
      throw new TypeError('Maintenance amount exceeds supported range');
    return {
      boq: structuredClone(boq),
      reference: structuredClone(ref.record),
      annualReferenceCost: ref.unitAnnualCost,
      annualReferenceQuote: ref.unitAnnualQuote,
      cost,
      quote,
    };
  });
  const cost = roundMoney(lines.reduce((n, r) => n + r.cost, 0)),
    quote = roundMoney(lines.reduce((n, r) => n + r.quote, 0));
  if (
    cost > 1e12 ||
    quote > 1e12 ||
    !Number.isSafeInteger(Math.round(cost * 100)) ||
    !Number.isSafeInteger(Math.round(quote * 100))
  )
    throw new TypeError('Maintenance total exceeds supported range');
  return { lines, cost, quote };
}
export function archiveMaintenance(
  data: MaintenanceWorkspace,
  records: MaintenancePriceRecord[],
  client: string,
): MaintenanceWorkspace {
  if (!client.trim()) throw new TypeError('Client required');
  const result = calculateMaintenance(data, records);
  if (
    data.archives.some(
      (a) =>
        a.client === client &&
        a.coverageMonths === data.coverageMonths &&
        contentKey(a.lines) === contentKey(result.lines),
    )
  )
    throw new TypeError('此维保配置已归档');
  return {
    ...data,
    archives: [
      ...data.archives,
      {
        id: `maintenance-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        client,
        coverageMonths: data.coverageMonths,
        ...result,
      },
    ],
  };
}
export function assertMaintenanceWorkspace(data: MaintenanceWorkspace) {
  if (new Set(data.archives.map((a) => a.id)).size !== data.archives.length)
    throw new TypeError('Duplicate maintenance archive IDs');
  for (const a of data.archives) {
    const refs = [
      ...new Map(a.lines.map((l) => [l.reference.id, l.reference])).values(),
    ];
    const result = calculateMaintenance(
      {
        coverageMonths: a.coverageMonths,
        boq: a.lines.map((l) => l.boq),
        archives: [],
      },
      refs,
    );
    if (
      contentKey(result) !==
      contentKey({ lines: a.lines, cost: a.cost, quote: a.quote })
    )
      throw new TypeError(
        'Maintenance archive totals or reference snapshots differ',
      );
  }
}
export async function importBoq(
  bytes: Uint8Array,
  fileName: string,
  mapping: {
    sheet: string;
    headerRow: number;
    modelColumn: number;
    quantityColumn: number;
    excludeRows?: number[];
  },
) {
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw new TypeError('BOQ exceeds 20 MB');
  if (
    !Number.isInteger(mapping.headerRow) ||
    mapping.headerRow < 1 ||
    ![mapping.modelColumn, mapping.quantityColumn].every(
      (c) => Number.isInteger(c) && c > 0 && c <= 200,
    )
  )
    throw new TypeError('Invalid BOQ column mapping');
  const ExcelJS = (await import('exceljs')).default,
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const sheet = wb.getWorksheet(mapping.sheet);
  if (!sheet || sheet.rowCount > 20000)
    throw new TypeError('请选择有效工作表（最多20,000行）');
  const sha = await workbookHash(bytes),
    rows: BoqLine[] = [];
  for (let i = mapping.headerRow + 1; i <= sheet.rowCount; i++) {
    if (mapping.excludeRows?.includes(i)) continue;
    const model = String(
        importCellValue(sheet.getCell(i, mapping.modelColumn).value),
      ).trim(),
      raw = importCellValue(sheet.getCell(i, mapping.quantityColumn).value);
    if (!model && raw === '') continue;
    if (
      !model ||
      model.length > 500 ||
      /^(?:total|subtotal|grand total|合计|总计|小计)$/iu.test(model)
    )
      throw new TypeError(`第${i}行需排除合计或修正型号`);
    const quantity =
      typeof raw === 'number'
        ? raw
        : /^\d+$/.test(raw.trim())
          ? Number(raw)
          : NaN;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1e6)
      throw new TypeError(`第${i}行设备数量必须是正整数`);
    rows.push({
      originalQuantity: quantity,
      originalModel: model,
      id: `boq-${sha.slice(0, 16)}-${mapping.sheet}-${i}`,
      model,
      quantity,
      serviceLevel: '',
      site: '',
      referenceId: '',
      unitAnnualQuote: 0,
      basis: '',
      source: `${fileName} / ${mapping.sheet} / ${i} / SHA256 ${sha}`,
    });
  }
  if (!rows.length) throw new TypeError('No BOQ rows found');
  return rows;
}
export async function buildMaintenanceWorkbook(archive: MaintenanceArchive) {
  assertMaintenanceWorkspace({
    coverageMonths: archive.coverageMonths,
    boq: [],
    archives: [archive],
  });
  const ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Maintenance Quote Draft');
  sheet.columns = [
    { width: 28 },
    { width: 12 },
    { width: 30 },
    { width: 25 },
    { width: 12 },
    { width: 20 },
    { width: 20 },
  ];
  sheet.addRow(['Maintenance quotation draft']);
  sheet.addRow(['Customer', archive.client]);
  sheet.addRow(['Reference', archive.id]);
  sheet.addRow(['Prepared', archive.createdAt]);
  sheet.addRow([
    'Model',
    'Quantity',
    'SLA',
    'Site',
    'Months',
    'Unit annual price SGD',
    'Amount SGD',
  ]);
  for (const line of archive.lines) {
    const row = sheet.addRow([
      line.boq.model,
      line.boq.quantity,
      line.boq.serviceLevel,
      line.boq.site,
      archive.coverageMonths,
      line.boq.unitAnnualQuote,
      line.quote,
    ]);
    row.getCell(7).value = {
      formula: `ROUNDUP(B${row.number}*E${row.number}/12*F${row.number},2)`,
      result: line.quote,
    };
  }
  const last = sheet.rowCount;
  sheet.addRow([
    'Total before tax',
    '',
    '',
    '',
    '',
    '',
    { formula: `SUM(G6:G${last})`, result: archive.quote },
  ]);
  sheet.addRow([
    'Commercial terms',
    'Draft excludes tax and final T&C; use the approved quotation workflow for customer issue.',
  ]);
  sheet.getColumn(6).numFmt = '#,##0.00';
  sheet.getColumn(7).numFmt = '#,##0.00';
  sheet.getRow(5).font = { bold: true };
  sheet.eachRow((r) => {
    r.alignment = { wrapText: true, vertical: 'top' };
  });
  sheet.views = [{ state: 'frozen', ySplit: 5 }];
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export function appendBoq(current: BoqLine[], rows: BoqLine[]) {
  if (current.length + rows.length > 1000)
    throw new TypeError('单个维保配置最多1,000行，请分项目或批次处理');
  if (
    rows.some((r) =>
      current.some((old) => old.id === r.id || old.source === r.source),
    )
  )
    throw new TypeError('这些BOQ行已经导入');
  return [...current, ...structuredClone(rows)];
}
