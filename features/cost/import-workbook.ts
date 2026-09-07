/** Workbook inspection and all-or-nothing TD/PM import with source provenance. */
import { contentKey } from '../cpq/domain.ts';
import { validDate } from '../ssr/domain.ts';
import {
  YEAR_BUCKETS,
  recalculateCostRows,
  type CostInputRow,
  type RateSettings,
  type ResourceType,
  type YearBucket,
} from './domain.ts';
export type CostImportMapping = {
  sheet: string;
  headerRow: number;
  endRow?: number;
  excludeRows?: number[];
  role: 'TD' | 'PM';
  mode: 'sites' | 'mandays';
  year: YearBucket;
  columns: {
    scope: number;
    bu: number;
    resource: number;
    mandays: number;
    sites: number;
    mdPerSite: number;
    cost: number;
  };
  defaultBu: string;
  defaultResource: string;
};
export type ImportPreview = {
  rows: CostInputRow[];
  issues: string[];
  sha256: string;
  sheet: string;
  mappingKey: string;
  contextKey: string;
};
export async function workbookHash(bytes: Uint8Array) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
async function load(bytes: Uint8Array) {
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw new TypeError('Workbook exceeds 20 MB');
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  return workbook;
}
export function importCellValue(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'object') {
    const cell = value as {
      formula?: string;
      sharedFormula?: string;
      result?: unknown;
      text?: string;
      richText?: { text: string }[];
    };
    if (cell.formula || cell.sharedFormula) {
      if (cell.result === undefined || cell.result === null)
        throw new TypeError(
          'Formula has no cached result; recalculate in Excel / 公式无缓存结果，请在Excel重算保存',
        );
      return importCellValue(cell.result);
    }
    if (cell.richText) return cell.richText.map((v) => v.text).join('');
    if (typeof cell.text === 'string') return cell.text;
  }
  throw new TypeError('Unsupported cell value / 无法识别的单元格值');
}
const number = (value: unknown, field: string) => {
  const v = importCellValue(value);
  if (
    typeof v === 'string' &&
    !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v.trim())
  )
    throw new TypeError(
      `${field}: expected non-negative number / 需要非负数值`,
    );
  const n = typeof v === 'number' ? v : Number(v.replaceAll(',', ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e12)
    throw new TypeError(`${field}: invalid number`);
  return n;
};
export async function inspectCostWorkbook(bytes: Uint8Array, headerRow = 1) {
  if (!Number.isInteger(headerRow) || headerRow < 1)
    throw new TypeError('Invalid header row');
  const workbook = await load(bytes);
  return {
    sha256: await workbookHash(bytes),
    sheets: workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rowCount,
      columns: Array.from(
        { length: Math.min(sheet.columnCount, 200) },
        (_, i) => ({
          column: i + 1,
          header: String(
            importCellValue(sheet.getCell(headerRow, i + 1).value),
          ),
        }),
      ),
    })),
  };
}
export async function previewCostImport(
  bytes: Uint8Array,
  fileName: string,
  mapping: CostImportMapping,
  resources: ResourceType[],
  rates: RateSettings,
): Promise<ImportPreview> {
  if (
    !YEAR_BUCKETS.includes(mapping.year) ||
    !Number.isInteger(mapping.headerRow) ||
    mapping.headerRow < 1 ||
    !['TD', 'PM'].includes(mapping.role) ||
    !['sites', 'mandays'].includes(mapping.mode)
  )
    throw new TypeError('Invalid import mapping');
  for (const col of Object.values(mapping.columns))
    if (!Number.isInteger(col) || col < 0 || col > 200)
      throw new TypeError('Invalid column mapping');
  if (!mapping.columns.scope)
    throw new TypeError('Map the Scope column / 请映射Scope列');
  if (
    fileName.length > 500 ||
    mapping.sheet.length > 100 ||
    mapping.defaultBu.length > 200 ||
    mapping.defaultResource.length > 100
  )
    throw new TypeError('Source filename or mapping text is too long');
  if (!validDate(rates.tdStart))
    throw new TypeError(
      'Set a valid TD start date to identify Y1 / 请先填写有效TD开始日期',
    );
  if (
    mapping.endRow !== undefined &&
    (!Number.isInteger(mapping.endRow) ||
      mapping.endRow <= mapping.headerRow ||
      mapping.endRow > 20000)
  )
    throw new TypeError('Invalid last data row');
  if (
    mapping.excludeRows?.some(
      (r) => !Number.isInteger(r) || r <= mapping.headerRow || r > 20000,
    )
  )
    throw new TypeError('Invalid excluded row');
  const workbook = await load(bytes),
    sheet = workbook.getWorksheet(mapping.sheet);
  if (!sheet || sheet.rowCount > 20000)
    throw new TypeError('Select an existing worksheet with up to 20,000 rows');
  const sha256 = await workbookHash(bytes),
    mappingKey = JSON.stringify(mapping),
    batch = await workbookHash(new TextEncoder().encode(sha256 + mappingKey));
  const rows: CostInputRow[] = [],
    issues: string[] = [],
    importedAt = new Date().toISOString();
  for (
    let rowNumber = mapping.headerRow + 1;
    rowNumber <= Math.min(sheet.rowCount, mapping.endRow || sheet.rowCount);
    rowNumber++
  ) {
    if (mapping.excludeRows?.includes(rowNumber)) continue;
    const sourceRow = sheet.getRow(rowNumber);
    if (
      !Object.values(mapping.columns)
        .filter(Boolean)
        .some(
          (col) =>
            sourceRow.getCell(col).value !== null &&
            sourceRow.getCell(col).value !== '',
        )
    )
      continue;
    try {
      const raw = (key: keyof CostImportMapping['columns']) =>
        mapping.columns[key]
          ? sourceRow.getCell(mapping.columns[key]).value
          : null;
      const text = (key: keyof CostImportMapping['columns']) =>
        String(importCellValue(raw(key))).trim();
      const scope = text('scope'),
        bu = text('bu') || mapping.defaultBu;
      if (
        /^(?:grand\s*total|sub\s*total|total|总计|合计|小计)\s*[:：]?$/iu.test(
          scope,
        )
      )
        throw new TypeError(
          'Summary row detected; exclude it explicitly / 请在排除行中填写此合计行号',
        );
      if (scope.length > 500 || bu.length > 200)
        throw new TypeError('Scope max 500 characters; BU max 200');
      const resourceKey = text('resource') || mapping.defaultResource;
      const resource = resources.find(
        (r) => r.id === resourceKey || r.code === resourceKey,
      );
      if (!scope || !bu || !resource?.active)
        throw new TypeError(
          'Scope, BU and an active RE Type code/ID are required',
        );
      const internal = resource.category === 'internal';
      const sites =
        mapping.mode === 'sites' ? number(raw('sites'), 'Sites') : 0;
      const mdPerSite =
        mapping.mode === 'sites' ? number(raw('mdPerSite'), 'MD/Site') : 0;
      const mandays =
        mapping.mode === 'mandays' && (internal || mapping.columns.mandays)
          ? number(raw('mandays'), 'Mandays')
          : 0;
      if (
        !Number.isInteger(sites) ||
        sites > 1e6 ||
        mdPerSite > 1e6 ||
        mandays > 1e6 ||
        (internal &&
          (mapping.mode === 'mandays'
            ? mandays <= 0
            : sites <= 0 || mdPerSite <= 0))
      )
        throw new TypeError('Invalid effort quantity / 人天或站点数量无效');
      const cost = internal ? 0 : number(raw('cost'), 'Subcontract cost');
      const input: CostInputRow = {
        id: `import-${batch.slice(0, 24)}-${rowNumber}`,
        inputMode: mapping.mode,
        scope,
        bu,
        reTypeId: resource.id,
        mdPerSite,
        years: YEAR_BUCKETS.map((bucket) => ({
          bucket,
          sites: bucket === mapping.year ? sites : 0,
          cost: bucket === mapping.year ? cost : 0,
          ...(mapping.mode === 'mandays'
            ? { mandays: bucket === mapping.year ? mandays : 0 }
            : {}),
        })),
        source: {
          fileName,
          sha256,
          sheet: mapping.sheet,
          row: rowNumber,
          mappingKey,
          role: mapping.role,
          importedAt,
        },
      };
      if (internal && !rates.tdStart)
        throw new TypeError(
          'Set TD start date before allocating effort / 请先填写TD开始日期',
        );
      const computed = recalculateCostRows([input], resources, rates)[0];
      if (computed.years.some((y) => !Number.isFinite(y.cost) || y.cost > 1e12))
        throw new TypeError('Calculated cost exceeds supported range');
      if (
        internal &&
        mapping.columns.cost &&
        raw('cost') !== null &&
        raw('cost') !== ''
      ) {
        const supplied = number(raw('cost'), 'Source cost'),
          calculated = computed.years.reduce((sum, year) => sum + year.cost, 0);
        if (Math.abs(supplied - calculated) > 0.01)
          throw new TypeError(
            `Source cost ${supplied} differs from governed cost ${calculated}; correct mapping/rate or leave cost unmapped for TD / 原表成本与费率计算不一致${rates.localArpAllowanceEnabled && (resource.pool === 'LOCAL' || resource.pool === 'ARP') ? '；当前年度成本包含 Local/ARP 3%，原表若仅为基础成本，请只映射人天、不映射成本列' : ''}`,
          );
      }
      computed.source!.importedValues = JSON.stringify({
        scope: computed.scope,
        bu: computed.bu,
        reTypeId: computed.reTypeId,
        inputMode: computed.inputMode,
        mdPerSite: computed.mdPerSite,
        years: computed.years,
      });
      rows.push(computed);
    } catch (error) {
      issues.push(
        `${mapping.sheet} row ${rowNumber}: ${error instanceof Error ? error.message : 'Invalid row'}`,
      );
    }
  }
  if (!rows.length && !issues.length)
    issues.push('No data rows found / 没有可导入的数据行');
  if (mappingKey.length > 10000)
    throw new TypeError('Mapping exceeds supported size');
  return {
    rows,
    issues,
    sha256,
    sheet: mapping.sheet,
    mappingKey,
    contextKey: contentKey({ resources, rates }),
  };
}
export function applyCostImport(
  current: CostInputRow[],
  preview: ImportPreview,
  context?: { resources: ResourceType[]; rates: RateSettings },
) {
  if (context && preview.contextKey !== contentKey(context))
    throw new TypeError(
      'Rates or resources changed; preview again / 费率或资源已变化，请重新预览',
    );
  if (preview.issues.length) throw new TypeError(preview.issues.join('\n'));
  const ids = new Set(current.map((row) => row.id));
  if (
    preview.rows.some(
      (row) =>
        ids.has(row.id) ||
        current.some(
          (existing) =>
            existing.source?.sha256 === row.source?.sha256 &&
            existing.source?.sheet === row.source?.sheet &&
            existing.source?.row === row.source?.row &&
            existing.years.some(
              (y, i) =>
                (y.sites > 0 || (y.mandays || 0) > 0 || y.cost > 0) &&
                (row.years[i].sites > 0 ||
                  (row.years[i].mandays || 0) > 0 ||
                  row.years[i].cost > 0),
            ),
        ),
    )
  )
    throw new TypeError(
      'Source rows already imported in this version / 此版本已导入这些源行',
    );
  return [...current, ...structuredClone(preview.rows)];
}
