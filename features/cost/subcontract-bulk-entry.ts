/** Resolve Master Data items and stage quantities before appending one reviewed batch. */
import type { SubcontractItem } from '../master-data/types.ts';
import { YEAR_BUCKETS, roundMoney } from './domain.ts';
import { BULK_TABLE_LIMITS, readBulkTable } from './bulk-table-reader.ts';
import {
  calculateSubcontractCost,
  validateSubcontractCost,
  type SubcontractCost,
  type SubcontractCostLine,
  type SubcontractSiteLine,
} from './subcontract-domain.ts';

export { BULK_TABLE_LIMITS as SUBCONTRACT_BULK_LIMITS };
export type SubcontractBulkTarget =
  | { kind: 'project' }
  | { kind: 'site'; id: string };
export type SubcontractBulkLine = SubcontractCostLine | SubcontractSiteLine;
export type SubcontractBulkColumn =
  | 'item'
  | 'code'
  | 'description'
  | 'bu'
  | 'unit'
  | 'unitPrice'
  | 'currency'
  | 'quantity'
  | 'quantityPerSite'
  | 'ignore'
  | 'unmapped'
  | `quantity:${number}`;
export type SubcontractBulkOptions = {
  defaultYear: number;
  mapping: Record<number, SubcontractBulkColumn>;
};
export type SubcontractBulkBasis = {
  value: SubcontractCost;
  target: SubcontractBulkTarget;
  catalog: SubcontractItem[];
  actualYears: (number | null)[];
};
export type SubcontractBulkPreview = {
  lines: SubcontractBulkLine[];
  entries: {
    sourceRow: number;
    line?: SubcontractBulkLine;
    issues: string[];
  }[];
  columns: { header: string; target: SubcontractBulkColumn }[];
  issues: string[];
  notices: string[];
  canConfirm: boolean;
  basisFingerprint: string;
  totalCost: number;
};
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()（）*`]+/g, '');
const aliases: Record<string, SubcontractBulkColumn> = {};
for (const [target, names] of Object.entries({
  item: ['item', 'code or description', 'code/description', '编码或描述'],
  code: [
    'code',
    'code number',
    'codenumber',
    'item code',
    'item code number',
    '编码',
    '条目编码',
  ],
  description: [
    'description',
    'scope',
    'item description',
    '描述',
    '条目',
    '工作范围',
  ],
  bu: ['bu', 'business unit', '部门', '业务单元'],
  unit: ['unit', 'uom', '单位'],
  unitPrice: ['unit price', 'price', 'unit price SGD', '单价'],
  currency: ['currency', '币种'],
  quantity: ['quantity', 'qty', '数量'],
  quantityPerSite: [
    'quantity per site',
    'qty per site',
    'quantity/site',
    'qty/site',
    '每站数量',
  ],
  ignore: [
    'total',
    'subtotal',
    'cost',
    'amount',
    'total cost',
    '总价',
    '金额',
    '成本',
  ],
}))
  for (const name of names)
    aliases[normalize(name)] = target as SubcontractBulkColumn;

/** Normalize lookup text without collapsing distinct item codes or their leading zeroes. */
const catalogKey = (value: string) =>
  value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const masterFields = new Set(['bu', 'unit', 'unitPrice', 'currency']);

/**
 * Resolve one active master item. Codes are exact identities; descriptions may
 * use a unique phrase. Ambiguous matches must be clarified with a code.
 */
function findMasterItem(
  catalog: SubcontractItem[],
  code: string,
  description: string,
  identifier: string,
): { item?: SubcontractItem; issue?: string } {
  const active = catalog.filter((item) => item.active);
  const byDescription = (text: string) => {
    const key = catalogKey(text);
    const exact = active.filter((item) => catalogKey(item.item) === key);
    return exact.length
      ? exact
      : active.filter((item) => catalogKey(item.item).includes(key));
  };
  const byIdentifier = (text: string) => {
    // Known inactive codes must fail closed, never become a partial description of another item.
    const codes = catalog.filter(
      (item) => catalogKey(item.code) === catalogKey(text),
    );
    return codes.length
      ? codes.filter((item) => item.active)
      : byDescription(text);
  };
  let matches: SubcontractItem[];
  const query = code || description || identifier;
  if (!query)
    return { issue: 'Enter a Master Data code or description and a quantity.' };
  if (code)
    matches = active.filter(
      (item) => catalogKey(item.code) === catalogKey(code),
    );
  else if (description) matches = byDescription(description);
  else matches = byIdentifier(identifier);
  if (!matches.length)
    return {
      issue: `“${query}” was not found in active Master Data → Subcontract. Add or enable the item there, then reopen Bulk Entry.`,
    };
  if (matches.length > 1)
    return {
      issue: `“${query}” matches multiple Master Data items: ${matches
        .slice(0, 5)
        .map((item) => `${item.code} (${item.item})`)
        .join('; ')}. Enter a unique code.`,
    };
  const item = matches[0];
  // A supplied second identifier may narrow intent, but never rename the adopted master item.
  if (
    code &&
    description &&
    !byDescription(description).some((match) => match.id === item.id)
  )
    return {
      issue: `Code “${code}” and description do not refer to the same Master Data item (${item.item}). Use one matching code or description.`,
    };
  if (
    (code || description) &&
    identifier &&
    !byIdentifier(identifier).some((match) => match.id === item.id)
  )
    return {
      issue: `Item “${identifier}” conflicts with the supplied code or description. Use identifiers for the same Master Data item.`,
    };
  return { item };
}

/** Include saved BOQs, rates, delivery years, target and catalog snapshots in stale-preview checks. */
export function subcontractBulkBasisFingerprint(
  basis: SubcontractBulkBasis,
): string {
  return JSON.stringify([
    basis.value,
    basis.target,
    basis.actualYears,
    basis.catalog,
  ]);
}

/** Input edits invalidate review even when the existing BOQ did not change. */
export function subcontractBulkInputKey(
  text: string,
  options: SubcontractBulkOptions,
  basis: SubcontractBulkBasis,
): string {
  return JSON.stringify([
    text,
    options,
    subcontractBulkBasisFingerprint(basis),
  ]);
}

/** Append only to the selected existing BOQ; quantities are retained and source data stays immutable. */
export function appendSubcontractBulkLines(
  value: SubcontractCost,
  lines: SubcontractBulkLine[],
  target: SubcontractBulkTarget,
): SubcontractCost {
  if (target.kind === 'project') {
    if (lines.some((line) => !('quantities' in line)))
      throw new Error('Project BOQs require annual quantities.');
    return {
      ...value,
      lines: [
        ...value.lines,
        ...structuredClone(lines as SubcontractCostLine[]),
      ],
    };
  }
  if (
    value.mode !== 'site-types' ||
    !value.siteTypes.some((site) => site.id === target.id)
  )
    throw new Error(
      'This site BOQ is no longer available. Select its site type and open Bulk Entry again.',
    );
  if (lines.some((line) => !('quantityPerSite' in line)))
    throw new Error('Site BOQs require quantities per site.');
  return {
    ...value,
    siteTypes: value.siteTypes.map((site) =>
      site.id === target.id
        ? {
            ...site,
            lines: [
              ...site.lines,
              ...structuredClone(lines as SubcontractSiteLine[]),
            ],
          }
        : site,
    ),
  };
}

/** Calendar headings map only to the displayed project years; unknown columns require deliberate mapping. */
function detectColumn(
  header: string,
  actualYears: (number | null)[],
): SubcontractBulkColumn {
  const alias = aliases[normalize(header)];
  if (alias) return alias;
  const match =
    /^(?:y\s*([1-5])|((?:19|20|21|22)\d{2}))(?:\s*(?:qty|quantity|数量))?$/i.exec(
      header.trim(),
    );
  if (!match) return 'unmapped';
  const index = match[1]
    ? Number(match[1]) - 1
    : actualYears.indexOf(Number(match[2]));
  return index < 0 ? 'unmapped' : `quantity:${index}`;
}

/** Accept conventional thousands grouping while refusing formulas, negative values and nonfinite numbers. */
function readAmount(text: string, maximum: number): number | null {
  const normalized = text.normalize('NFKC').trim();
  const cleaned = /^\+?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)
    ? normalized.replaceAll(',', '')
    : normalized;
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 && amount <= maximum
    ? amount
    : null;
}

/** Copyable starter tables stay separate from the user's pasted content. */
export function subcontractBulkTemplate(
  target: SubcontractBulkTarget,
  allYears = false,
  identifier: 'code' | 'description' = 'code',
): string {
  const quantityHeaders =
    target.kind === 'site'
      ? ['Qty / Site']
      : allYears
        ? YEAR_BUCKETS
        : ['Quantity'];
  const values = quantityHeaders.map((_, index) => (index === 0 ? '2' : '0'));
  return [
    [identifier === 'code' ? 'Code' : 'Description', ...quantityHeaders],
    [identifier === 'code' ? 'SC-001' : 'Cable installation', ...values],
  ]
    .map((row) => row.join('\t'))
    .join('\n');
}

/** Parse all rows locally and calculate against the existing version without mutating it. */
export function parseSubcontractBulkEntry(
  text: string,
  options: SubcontractBulkOptions,
  basis: SubcontractBulkBasis,
): SubcontractBulkPreview {
  const preview: SubcontractBulkPreview = {
    lines: [],
    entries: [],
    columns: [],
    issues: [],
    notices: [],
    canConfirm: false,
    basisFingerprint: subcontractBulkBasisFingerprint(basis),
    totalCost: 0,
  };
  if (
    !Number.isInteger(options.defaultYear) ||
    options.defaultYear < 0 ||
    options.defaultYear > 4
  ) {
    preview.issues.push('Choose a quantity year between Y1 and Y5.');
    return preview;
  }
  const matrix = readBulkTable(text);
  preview.issues.push(...matrix.issues);
  preview.notices.push(...matrix.notices);
  if (preview.issues.length) return preview;
  // Two-column pastes may omit headers; both identifiers are resolved against the same master.
  const first = matrix.rows[0];
  const headerless =
    first?.cells.length === 2 &&
    ((readAmount(first.cells[1], 1e6) !== null &&
      !!findMasterItem(basis.catalog, '', '', first.cells[0]).item) ||
      first.cells.every(
        (cell) => detectColumn(cell, basis.actualYears) === 'unmapped',
      ));
  const header = headerless
    ? { sourceRow: 0, cells: ['Code or Description', 'Quantity'] }
    : first;
  const records = headerless ? matrix.rows : matrix.rows.slice(1);
  if (!header || !records.length) {
    preview.issues.push('Paste a header and at least one subcontract item.');
    return preview;
  }
  if (
    records.length > BULK_TABLE_LIMITS.rows ||
    header.cells.length > BULK_TABLE_LIMITS.columns
  ) {
    preview.issues.push('Use at most 1,000 rows and 40 columns per batch.');
    return preview;
  }
  const seen = new Set<string>();
  preview.columns = header.cells.map((label, index) => {
    const target =
      options.mapping[index] ?? detectColumn(label, basis.actualYears);
    const allowed =
      [
        'code',
        'item',
        'description',
        'bu',
        'unit',
        'unitPrice',
        'currency',
        'quantity',
        'quantityPerSite',
        'ignore',
        'unmapped',
      ].includes(target) || /^quantity:[0-4]$/.test(target);
    if (!allowed)
      preview.issues.push(`Column ${index + 1}: invalid field mapping.`);
    if (
      target === 'unmapped' &&
      records.some((record) => record.cells[index]?.trim())
    )
      preview.issues.push(
        `Map column “${label || index + 1}” or choose Ignore.`,
      );
    const canonical =
      target === 'quantity'
        ? basis.target.kind === 'site'
          ? 'quantityPerSite'
          : `quantity:${options.defaultYear}`
        : target;
    if (!['ignore', 'unmapped'].includes(target)) {
      if (seen.has(canonical))
        preview.issues.push(`Duplicate field or year: “${label}”.`);
      seen.add(canonical);
    }
    if (target === 'ignore')
      preview.notices.push(
        `Column “${label}” ignored; costs are recalculated from unit prices and quantities.`,
      );
    if (masterFields.has(target))
      preview.notices.push(
        `Column “${label}” ignored; ${label} is supplied by Master Data.`,
      );
    return {
      header: label || `Column ${index + 1}`,
      target: masterFields.has(target) ? 'ignore' : target,
    };
  });
  const quantityColumns = preview.columns
    .map((column, index) => ({ ...column, index }))
    .filter(
      ({ target }) =>
        target === 'quantity' ||
        target === 'quantityPerSite' ||
        /^quantity:[0-4]$/.test(target),
    );
  if (!quantityColumns.length)
    preview.issues.push(
      'Map a Quantity column, annual Y1–Y5 quantities, or Qty / Site.',
    );
  if (
    !preview.columns.some(({ target }) =>
      ['code', 'description', 'item'].includes(target),
    )
  )
    preview.issues.push('Map a Master Data Code or Description column.');
  if (
    basis.target.kind === 'site' &&
    quantityColumns.some(({ target }) => target.startsWith('quantity:'))
  )
    preview.issues.push(
      'Site BOQs use Qty / Site. Annual site counts remain in Annual Site Deployments.',
    );
  if (
    basis.target.kind === 'project' &&
    quantityColumns.some(({ target }) => target === 'quantityPerSite')
  )
    preview.issues.push('Project BOQs use annual quantities, not Qty / Site.');
  for (const record of records) {
    const issues: string[] = [];
    const field = (target: SubcontractBulkColumn) => {
      const index = preview.columns.findIndex(
        (column) => column.target === target,
      );
      return index < 0 ? '' : record.cells[index]?.trim() || '';
    };
    if (record.cells.slice(header.cells.length).some((cell) => cell.trim()))
      issues.push('This row has extra cells beyond the header.');
    const match = findMasterItem(
      basis.catalog,
      field('code'),
      field('description'),
      field('item'),
    );
    if (match.issue) issues.push(match.issue);
    const catalog = match.item;
    // The master is the only source of business attributes; pasted values cannot create or override them.
    const code = catalog?.code ?? (field('code') || field('item'));
    const description = catalog?.item ?? field('description');
    const bu = catalog?.bu || '';
    const unit = catalog?.unit || '';
    const currency = (catalog?.currency || '').trim().toUpperCase();
    const unitPrice = catalog?.unitPrice ?? null;
    if (catalog) {
      for (const [name, value] of [
        ['Code', code],
        ['Description', description],
        ['BU', bu],
        ['Unit', unit],
      ])
        if (!value.trim())
          issues.push(
            `Master Data ${name} is missing. Complete the item in Master Data → Subcontract and reopen Bulk Entry.`,
          );
      if (currency !== 'SGD')
        issues.push(
          'Master Data price must be in SGD. Maintain its converted price and currency in Master Data → Subcontract.',
        );
      if (
        unitPrice !== null &&
        (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1e12)
      )
        issues.push(
          'Correct this item’s invalid price in Master Data → Subcontract.',
        );
    }
    const quantities = [0, 0, 0, 0, 0];
    let quantityPerSite = 0;
    let hasQuantity = false;
    for (const column of quantityColumns) {
      const raw = record.cells[column.index]?.trim() || '';
      if (raw) hasQuantity = true;
      const amount = raw ? readAmount(raw, 1e6) : 0;
      if (
        amount === null ||
        (unit.toLowerCase() === 'pcs' && !Number.isInteger(amount))
      )
        issues.push(
          `${column.header}: enter ${unit.toLowerCase() === 'pcs' ? 'a whole number' : 'a number'} from 0 to 1,000,000.`,
        );
      if (basis.target.kind === 'site') quantityPerSite = amount ?? 0;
      else {
        const index =
          column.target === 'quantity'
            ? options.defaultYear
            : Number(column.target.split(':')[1]);
        if (Number.isInteger(index) && index >= 0 && index < 5)
          quantities[index] = amount ?? 0;
      }
    }
    if (!hasQuantity)
      issues.push('Enter at least one quantity; zero is allowed.');
    const base = {
      id: `SUBCON-BULK-PREVIEW-${record.sourceRow}`,
      ...(catalog ? { catalogItemId: catalog.id } : {}),
      code,
      description,
      bu,
      unit,
      unitPrice,
      currency: 'SGD' as const,
    };
    const line: SubcontractBulkLine =
      basis.target.kind === 'project'
        ? { ...base, quantities }
        : { ...base, quantityPerSite };
    if (!issues.length) {
      preview.lines.push(line);
      if (unitPrice === null)
        preview.notices.push(
          `Row ${record.sourceRow}: Master Data price remains blank. Maintain the price in Master Data before adopting a priced item; this draft remains unpriced.`,
        );
    }
    preview.entries.push({ sourceRow: record.sourceRow, line, issues });
  }
  // Validate combined totals, including annual adjustments and existing lines, before allowing the append.
  try {
    const next = appendSubcontractBulkLines(
      basis.value,
      preview.lines,
      basis.target,
    );
    preview.issues.push(
      ...validateSubcontractCost(next, false, basis.actualYears[0]).map(
        (issue) => issue.message,
      ),
    );
    preview.totalCost = roundMoney(
      calculateSubcontractCost(next, basis.actualYears[0]).total -
        calculateSubcontractCost(basis.value, basis.actualYears[0]).total,
    );
  } catch (error) {
    preview.issues.push(
      error instanceof Error ? error.message : 'Unable to validate this BOQ.',
    );
  }
  preview.canConfirm =
    !preview.issues.length &&
    !!preview.entries.length &&
    preview.entries.every((entry) => !entry.issues.length);
  return preview;
}

/** Recheck the exact reviewed input and current version before supplying fresh persisted identities. */
export function confirmSubcontractBulkPreview({
  preview,
  currentKey,
  previewKey,
  basis,
  locked,
  onConfirm,
  announce,
}: {
  preview: SubcontractBulkPreview | null;
  currentKey: string;
  previewKey?: string;
  basis: SubcontractBulkBasis;
  locked?: boolean;
  onConfirm: (lines: SubcontractBulkLine[], fingerprint: string) => boolean;
  announce: (message: string) => void;
}): boolean {
  if (locked) return false;
  if (
    !preview ||
    currentKey !== previewKey ||
    preview.basisFingerprint !== subcontractBulkBasisFingerprint(basis)
  ) {
    announce(
      'The input, catalog or cost version changed. Generate a new preview before confirming.',
    );
    return false;
  }
  if (!preview.canConfirm) {
    announce('Resolve all preview errors before confirming this batch.');
    return false;
  }
  const lines = preview.lines.map((line) => ({
    ...structuredClone(line),
    id: `SC-${crypto.randomUUID()}`,
  }));
  return onConfirm(lines, preview.basisFingerprint);
}
