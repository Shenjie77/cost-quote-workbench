import { formatMoney } from '../../lib/money.ts';
/** Read hierarchical service exports without treating component quantities as equipment counts. */
import { importCellValue, workbookHash } from '../cost/import-workbook.ts';
import { roundMoney } from '../cost/domain.ts';
import { newMaintenanceLine } from './component-pricing.ts';
import type { BoqLine } from './domain.ts';
export type ServiceKind = 'CT' | 'SPMS';
export type ServiceQuotePart = {
  row: number;
  node: string;
  nodeInfo: string;
  originalModel?: string;
  originalQuantity?: number;
  service: ServiceKind | null;
  model: string;
  year?: number;
  quantity: number;
  unitPrice: number | null;
  lpb: number | null;
  customer: number | null;
  computed: number | null;
  issue?: string;
};
export type ServiceQuotePreview = {
  fileName: string;
  sha256: string;
  sheet: string;
  years: number[];
  parts: ServiceQuotePart[];
  issues: string[];
};
export type ServiceQuoteGroup = {
  key: string;
  model: string;
  nodeQuantity: number;
  ct: number;
  spms: number;
  rows: number[];
};
const normalize = (value: unknown) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
/** Uncached formulas and blank prices are unavailable, never silently interpreted as free maintenance. */
function number(value: unknown): number | null {
  const text = String(importCellValue(value)).trim();
  if (!text || text === '/') return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
/** Recognize service families from full descriptions as well as CT/SPMS section labels. */
const serviceOf = (text: string): ServiceKind | null =>
  /(?:^|[^a-z0-9])spms(?:$|[^a-z0-9])|spare\s+parts?\s+management\s+service/i.test(
    text,
  )
    ? 'SPMS'
    : /(?:^|[^a-z0-9])ct(?:$|[^a-z0-9])|(?:software|hardware)\s+support\s+service|basic(?:\s+support)?\s+service/i.test(
          text,
        )
      ? 'CT'
      : null;
/** The device is the middle segment of the supplied “service, model, per node per year” format. */
export function modelFromNodeInfo(info: string): string {
  // The middle field is stable; service descriptions and billing wording are not.
  const fields = info.split(/[,，]/);
  if (fields.length >= 3 && fields[1].trim()) return fields[1].trim();
  return (
    info
      .match(
        /(?:device\s*model|model|设备型号|型号)\s*[:：=]\s*([^;；\n,]+)/i,
      )?.[1]
      ?.trim() ?? ''
  );
}
/** Prefill node counts only when annual per-node detail rows agree; conflicting component quantities remain unconfirmed. */
export function inferredNodeCounts(
  parts: ServiceQuotePart[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const group of serviceQuoteGroups(parts)) {
    const matching = parts.filter((part) => group.rows.includes(part.row));
    if (
      matching.every(
        (part) =>
          part.year &&
          /per\s+node(?:\s*(?:per|[*/×·])\s*|\s+)year/i.test(part.nodeInfo) &&
          Number.isInteger(part.quantity) &&
          part.quantity > 0,
      ) &&
      new Set(matching.map((part) => part.quantity)).size === 1
    )
      counts[group.key] = matching[0].quantity;
  }
  return counts;
}
/** Inspect the selected worksheet and carry service/year context from section headings into detail rows. */
export async function inspectServiceQuote(
  bytes: Uint8Array,
  fileName: string,
  sheetName?: string,
): Promise<ServiceQuotePreview> {
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw new Error('Excel 文件不能超过 20 MB');
  const ExcelJS = (await import('exceljs')).default,
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  const sheet = sheetName
    ? book.getWorksheet(sheetName)
    : book.worksheets.find((sheet) => {
        let found = false;
        for (let row = 1; row <= Math.min(30, sheet.rowCount); row++) {
          const cells = sheet.getRow(row).values as unknown[];
          if (
            cells.some(
              (value) => normalize(importCellValue(value)) === 'nodeinfo',
            )
          )
            found = true;
        }
        return found;
      });
  if (!sheet) throw new Error('未找到含 Node Info 的报价页签');
  if (sheet.rowCount > 50000 || sheet.columnCount > 200)
    throw new Error('报价表超出支持的行列范围');
  let header = 0;
  const columns = new Map<string, number>();
  for (let row = 1; row <= Math.min(30, sheet.rowCount); row++) {
    sheet.getRow(row).eachCell((cell) => {
      if (normalize(importCellValue(cell.value)) === 'nodeinfo') header = row;
    });
    if (header) {
      sheet
        .getRow(row)
        .eachCell((cell, col) =>
          columns.set(normalize(importCellValue(cell.value)), col),
        );
      break;
    }
  }
  const required = [
    'node',
    'nodeinfo',
    'quantity',
    'lpbunitpricesgd',
    'totalamountoflpbpricesgd',
    'totalamountofcustomerpricesgd',
  ];
  const missing = required.filter((key) => !columns.has(key));
  if (missing.length) throw new Error(`缺少报价列：${missing.join(', ')}`);
  const cell = (row: number, key: string) =>
    columns.has(key)
      ? sheet.getRow(row).getCell(columns.get(key)!).value
      : null;
  const text = (row: number, key: string) =>
    String(importCellValue(cell(row, key))).trim();
  const parts: ServiceQuotePart[] = [],
    years = new Set<number>(),
    issues: string[] = [];
  // Excel outline levels encode ancestry independently of labels, visible/collapsed state, and row numbers.
  const populatedRows: number[] = [];
  for (let row = header + 1; row <= sheet.rowCount; row++)
    if (sheet.getRow(row).hasValues) populatedRows.push(row);
  const outlined = populatedRows.some(
    (row) => (sheet.getRow(row).outlineLevel ?? 0) > 0,
  );
  const nextLevels = new Map(
    populatedRows.map((row, index) => [
      row,
      index + 1 < populatedRows.length
        ? (sheet.getRow(populatedRows[index + 1]).outlineLevel ?? 0)
        : -1,
    ]),
  );
  const ancestors: {
    level: number;
    service: ServiceKind | null;
    year?: number;
    model: string;
  }[] = [];
  let service: ServiceKind | null = null,
    year: number | undefined,
    model = '';
  for (let row = header + 1; row <= sheet.rowCount; row++) {
    if (!sheet.getRow(row).hasValues) continue;
    const level = sheet.getRow(row).outlineLevel ?? 0;
    const hasChildren = outlined && (nextLevels.get(row) ?? -1) > level;
    if (outlined) {
      while (ancestors.length && ancestors.at(-1)!.level >= level)
        ancestors.pop();
      const parent = ancestors.at(-1);
      service = parent?.service ?? null;
      year = parent?.year;
      model = parent?.model ?? '';
    }
    const rememberParent = () => {
      if (hasChildren) ancestors.push({ level, service, year, model });
    };
    const node = text(row, 'node'),
      info = text(row, 'nodeinfo');
    // Aggregate rows can carry quantities and amounts; ignore them before inheriting context or validating prices.
    const totalLabel =
      /^(?:(?:grand\s*|sub[\s-]*)?total(?:\s+(?:row|amount|price))?|合计|总计|小计)\s*[:：]?$/i;
    if (
      [node, info, text(row, 'model')].some((label) => totalLabel.test(label))
    )
      continue;
    const quantity = number(cell(row, 'quantity'));
    // A-column subquotation headings define the parent service, regardless of order or row number.
    // Reset inherited context even for repeated or unrecognized sections to prevent cross-section leakage.
    if (/sub[\s_\-–—]*quotation/i.test(node)) {
      // Exporters may concatenate the heading and type, or put its value in the adjacent metadata cell.
      const heading = node.replace(
        /sub[\s_\-–—]*quotation[\s_\-–—]*(?:name)?/i,
        ' ',
      );
      service =
        serviceOf(heading) ?? serviceOf(text(row, 'model')) ?? serviceOf(info);
      year = undefined;
      model = '';
      rememberParent();
      continue;
    }
    if (/^quotation\b/i.test(node)) {
      service = null;
      year = undefined;
      model = '';
      rememberParent();
      continue;
    }
    // Real exports use named outline parents (e.g. CT Router-2027), not literal placeholder headings.
    // Numeric item codes never set a service or a year, even when prices are missing.
    const isHeading =
      hasChildren ||
      (quantity === null &&
        (!/^\d+$/.test(node) || /^(19|20)\d{2}$/.test(node)));
    if (isHeading) {
      const namedService = serviceOf(node);
      if (namedService) service = namedService;
    }
    // Years belong to A-column phase/item headings, never to equipment descriptions or leaf item codes.
    const yearMatch = isHeading ? node.match(/\b(20\d{2}|19\d{2})\b/) : null;
    if (yearMatch) {
      year = Number(yearMatch[1]);
      years.add(year);
    }
    const explicit = modelFromNodeInfo(info);
    const modelColumn = text(row, 'model');
    if (hasChildren || quantity === null) {
      if (explicit) model = explicit;
      else if (modelColumn && modelColumn !== '/') model = modelColumn;
      rememberParent();
      continue;
    }
    // Parent totals have no unit price and are not counted again. Empty price rows remain visible as errors.
    if (/^(?:grand\s*total|sub\s*total|total|合计|总计)$/i.test(node)) continue;
    const unitPrice = number(cell(row, 'lpbunitpricesgd')),
      lpb = number(cell(row, 'totalamountoflpbpricesgd')),
      customer = number(cell(row, 'totalamountofcustomerpricesgd'));
    const computed =
      unitPrice === null ? null : roundMoney(unitPrice * quantity);
    const issue =
      unitPrice === null || lpb === null || customer === null
        ? '缺少单价或总金额，不能按 0 导入'
        : computed !== null &&
            Math.abs(computed - lpb) > quantity * 0.01 + 0.005 + 1e-8
          ? 'LPB 单价 × 数量与 LPB 总额不一致（超出两位小数舍入范围）'
          : undefined;
    parts.push({
      row,
      node,
      nodeInfo: info,
      service,
      model:
        explicit ||
        model ||
        (modelColumn && modelColumn !== '/' ? modelColumn : ''),
      year,
      quantity,
      unitPrice,
      lpb,
      customer,
      computed,
      ...(issue ? { issue } : {}),
    });
  }
  if (!parts.length) issues.push('没有识别到报价明细行');
  return {
    fileName,
    sha256: await workbookHash(bytes),
    sheet: sheet.name,
    years: [...years].sort((a, b) => a - b),
    parts,
    issues,
  };
}
/** Group only confirmed device/service assignments and sum customer amounts after discount review. */
export function serviceQuoteGroups(
  parts: ServiceQuotePart[],
): ServiceQuoteGroup[] {
  const groups = new Map<string, ServiceQuoteGroup>();
  for (const part of parts) {
    const key = part.model.trim().normalize('NFKC').toLowerCase();
    if (!key || !part.service) continue;
    const group = groups.get(key) ?? {
      key,
      model: part.model.trim(),
      nodeQuantity: 0,
      ct: 0,
      spms: 0,
      rows: [],
    };
    group[part.service === 'CT' ? 'ct' : 'spms'] += part.customer ?? 0;
    group.rows.push(part.row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    ct: roundMoney(group.ct),
    spms: roundMoney(group.spms),
  }));
}
/** Confirmed duration and actual device quantity are mandatory divisors; quantity of sub-items is never substituted. */
export function serviceQuoteLines(
  preview: ServiceQuotePreview,
  parts: ServiceQuotePart[],
  years: number,
  nodeCounts: Record<string, number>,
  discountConfirmed: boolean,
): BoqLine[] {
  if (!Number.isInteger(years) || years < 1 || years > 100)
    throw new Error('请确认 1–100 年的实际维保期限');
  if (
    preview.issues.length ||
    parts.some((part) => part.issue || !part.model.trim() || !part.service)
  )
    throw new Error('请先解决缺少金额、LPB 核对、设备型号和服务类型的问题');
  if (
    parts.some((part) => Math.abs(part.lpb! - part.customer!) > 0.011) &&
    !discountConfirmed
  )
    throw new Error('请先确认折扣差异，并采用 Customer 实际报价');
  const groups = serviceQuoteGroups(parts);
  if (!groups.length || groups.length > 1000)
    throw new Error('设备分组数量必须为 1–1000');
  return groups.map((group) => {
    const quantity = nodeCounts[group.key];
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1e6)
      throw new Error(`请确认 ${group.model} 的实际 Node 数量`);
    return {
      ...newMaintenanceLine(years),
      model: group.model,
      quantity,
      ct: roundMoney(group.ct / years / quantity),
      spms: roundMoney(group.spms / years / quantity),
      source: `${preview.fileName.slice(0, 100)} / ${preview.sheet.slice(0, 50)} / rows ${group.rows[0]}-${group.rows.at(-1)} / SHA256 ${preview.sha256}`,
      remark: groupMemberRemarks(
        parts.filter((part) => group.rows.includes(part.row)),
        years,
      ),
    };
  });
}

/** Reassign selected source rows to a platform without changing service types, amounts, or evidence. */
export function mergeServiceQuoteItems(
  parts: ServiceQuotePart[],
  selectedRows: number[],
  model: string,
  quantity: number,
  nodeCounts: Record<string, number> = inferredNodeCounts(parts),
): { parts: ServiceQuotePart[]; key: string; quantity: number } {
  const name = model.trim();
  if (!name || name.length > 500)
    throw new Error('请填写平台名称（最多 500 字）');
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1e6)
    throw new Error('请填写合并后的实际平台数量（正整数）');
  const selected = new Set(selectedRows);
  if (
    selected.size < 2 ||
    [...selected].some((row) => !parts.some((part) => part.row === row))
  )
    throw new Error('请选择至少两个有效明细进行合并');
  return {
    parts: parts.map((part) =>
      selected.has(part.row) ||
      part.model.trim().normalize('NFKC').toLowerCase() ===
        name.normalize('NFKC').toLowerCase()
        ? {
            ...part,
            originalModel: part.originalModel ?? part.model,
            originalQuantity:
              part.originalQuantity ??
              nodeCounts[part.model.trim().normalize('NFKC').toLowerCase()],
            model: name,
          }
        : part,
    ),
    key: name.normalize('NFKC').toLowerCase(),
    quantity,
  };
}

/** Preserve original member quantities and annual customer unit prices, independently of platform quantity. */
export function groupMemberRemarks(
  parts: ServiceQuotePart[],
  years: number,
): string {
  const members = new Map<
    string,
    {
      name: string;
      service: ServiceKind | null;
      quantity?: number;
      total: number;
    }
  >();
  for (const part of parts) {
    if (!part.originalModel) continue;
    const key = `${part.service}:${part.originalModel.normalize('NFKC').toLowerCase()}`;
    const member = members.get(key) ?? {
      name: part.originalModel,
      service: part.service,
      quantity: part.originalQuantity,
      total: 0,
    };
    member.total += part.customer ?? 0;
    members.set(key, member);
  }
  const remark = [...members.values()]
    .map(
      (member) =>
        `${member.service}: ${member.name}, qty: ${member.quantity ?? '待确认'}, u/p: ${member.quantity && years > 0 ? formatMoney(roundMoney(member.total / years / member.quantity)) : '待确认'}`,
    )
    .join('\n');
  if (remark.length > 10000)
    throw new Error('组合备注超过 10000 字，请拆分为较小的组合');
  return remark;
}
