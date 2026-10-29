/** Customer-facing line construction and manual pricing validation. */
import type { CostExportSnapshot } from '../cost/contracts.ts';
import {
  getY1Year,
  getCostStatementValues,
  getHQTravelSummary,
  getOtherServiceCost,
  getOtherServiceCostBase,
  roundMoney,
  totalRowCost,
} from '../cost/domain.ts';
import { calculateSubcontractCost } from '../cost/subcontract-domain.ts';
import { UNASSIGNED_PERSONNEL_GROUP } from '../cost/personnel-table-layout.ts';
import { categoryKey } from './quotation-groups.ts';
import { allocateMoneyByWeights } from './profit-share.ts';
import type {
  ManualQuoteLine,
  QuoteLine,
  QuoteLineMode,
} from './excel-template-types.ts';

export const MAX_QUOTE_LINES = 1000;
const MAX_QUOTE_AMOUNT = 1e12;

/** Four-decimal quantities/prices accommodate fractional services without float noise. */
function hasSupportedPrecision(value: number): boolean {
  return (
    Math.abs(value * 10000 - Math.round(value * 10000)) <=
    Math.max(1e-7, Number.EPSILON * Math.abs(value * 10000) * 4)
  );
}

/** Validates user-entered commercial lines before arithmetic or customer output. */
export function validateManualQuoteLines(
  lines: ManualQuoteLine[] | undefined,
): string[] {
  if (!Array.isArray(lines) || !lines.length)
    return ['Add at least one quotation line.'];
  if (lines.length > MAX_QUOTE_LINES)
    return [`Quotation supports at most ${MAX_QUOTE_LINES} lines.`];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const prefix = `Quotation line ${index + 1}: `;
    if (!line || typeof line !== 'object') {
      errors.push(`${prefix}enter a valid line.`);
      continue;
    }
    if (
      typeof line.id !== 'string' ||
      !line.id.trim() ||
      line.id.length > 200 ||
      ids.has(line.id)
    )
      errors.push(`${prefix}line IDs must be present and unique.`);
    ids.add(line.id);
    if (
      typeof line.description !== 'string' ||
      !line.description.trim() ||
      line.description.length > 4000
    )
      errors.push(`${prefix}description is required (up to 4,000 characters).`);
    if (
      typeof line.unit !== 'string' ||
      !line.unit.trim() ||
      line.unit.length > 40
    )
      errors.push(`${prefix}unit is required (up to 40 characters).`);
    if (
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      line.quantity > 1e6 ||
      !hasSupportedPrecision(line.quantity)
    )
      errors.push(
        `${prefix}quantity must be greater than zero, at most 1,000,000, with up to four decimals.`,
      );
    if (
      !Number.isFinite(line.unitPrice) ||
      line.unitPrice < 0 ||
      line.unitPrice > MAX_QUOTE_AMOUNT ||
      !hasSupportedPrecision(line.unitPrice)
    )
      errors.push(
        `${prefix}unit price must be non-negative, at most 1,000,000,000,000, with up to four decimals.`,
      );
    if (
      line.allocationWeight !== undefined &&
      (!Number.isFinite(line.allocationWeight) ||
        line.allocationWeight < 0 ||
        line.allocationWeight > 1e6)
    )
      errors.push(
        `${prefix}allocation weight must be a number between 0 and 1,000,000.`,
      );
    if (
      line.costWeight !== undefined &&
      (!Number.isFinite(line.costWeight) ||
        line.costWeight < 0 ||
        line.costWeight > MAX_QUOTE_AMOUNT)
    )
      errors.push(
        `${prefix}cost weight must be a number between 0 and 1,000,000,000,000.`,
      );
    if (
      line.targetGrossMargin !== undefined &&
      (!Number.isFinite(line.targetGrossMargin) ||
        line.targetGrossMargin < 0 ||
        line.targetGrossMargin > 95)
    )
      errors.push(`${prefix}target GP must be between 0 and 95%.`);
    if (line.priceFixed !== undefined && typeof line.priceFixed !== 'boolean')
      errors.push(`${prefix}fixed price must be true or false.`);
    if (
      line.allocationFixed !== undefined &&
      typeof line.allocationFixed !== 'boolean'
    )
      errors.push(`${prefix}fixed percentage must be true or false.`);
    if (
      line.allocationFixed === true &&
      (line.allocationWeight === undefined ||
        !Number.isFinite(line.allocationWeight) ||
        line.allocationWeight < 0 ||
        line.allocationWeight > 100)
    )
      errors.push(
        `${prefix}a fixed percentage must be a number between 0 and 100.`,
      );
    if (line.priceFixed === true && line.allocationFixed === true)
      errors.push(
        `${prefix}fix either the percentage or the unit price, not both.`,
      );
    for (const field of ['category', 'section'] as const) {
      if (
        line[field] !== undefined &&
        (typeof line[field] !== 'string' ||
          !line[field]!.trim() ||
          line[field]!.length > 120)
      )
        errors.push(`${prefix}${field} must contain 1–120 characters.`);
    }
    if (
      line.inclusion !== undefined &&
      !['mandatory', 'optional'].includes(line.inclusion)
    )
      errors.push(`${prefix}invalid inclusion.`);
    const amount = line.quantity * line.unitPrice;
    if (!Number.isFinite(amount) || amount > MAX_QUOTE_AMOUNT)
      errors.push(`${prefix}amount exceeds the supported range.`);
  }
  return errors;
}

/** Invalid drafts retain finite previews; validation still blocks their export. */
export function calculateManualQuoteLines(
  lines: ManualQuoteLine[] | undefined,
): { lines: QuoteLine[]; total: number; errors: string[] } {
  const errors = validateManualQuoteLines(lines);
  const output = (Array.isArray(lines) ? lines : [])
    .filter((line) => line && typeof line === 'object')
    .slice(0, MAX_QUOTE_LINES)
    .map((line) => {
      const rawAmount = line.quantity * line.unitPrice;
      const amount =
        Number.isFinite(rawAmount) &&
        rawAmount >= 0 &&
        rawAmount <= MAX_QUOTE_AMOUNT
          ? roundMoney(rawAmount)
          : 0;
      // Whitelist customer fields so allocation controls never reach workbooks or history snapshots.
      return {
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        amount,
        ...(typeof line.category === 'string' && line.category.trim()
          ? { category: line.category.trim() }
          : {}),
        ...(typeof line.section === 'string' && line.section.trim()
          ? { section: line.section.trim() }
          : {}),
        ...(line.inclusion === 'mandatory' || line.inclusion === 'optional'
          ? { inclusion: line.inclusion }
          : {}),
      };
    });
  const total = roundMoney(output.reduce((sum, line) => sum + line.amount, 0));
  if (total > MAX_QUOTE_AMOUNT)
    errors.push('Quotation line total exceeds the supported range.');
  return {
    lines: output,
    total: total <= MAX_QUOTE_AMOUNT ? total : 0,
    errors,
  };
}

export type QuoteCostSource = Pick<
  CostExportSnapshot,
  | 'costRows'
  | 'resourceTypes'
  | 'travelSettings'
  | 'manualCosts'
  | 'subcontractCost'
  | 'rateSettings'
> & { project?: { name: string } };

type WeightedLine = {
  id: string;
  description: string;
  weight: number;
  category?: string;
};
const commercialCategory = (value?: string) => value?.trim() || undefined;
const categorySuffix = (value?: string) =>
  value ? `:category:${categoryKey(value)}` : '';
const scopeReference = (line: WeightedLine) =>
  line.id.startsWith('subcontract:')
    ? line.id
    : line.category
      ? `scope-category:${JSON.stringify([line.description.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en'), categoryKey(line.category)])}`
      : `scope:${line.description.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en')}`;

/** Preserve explicit category boundaries even when Scope or Group labels match. */
function mergeWeighted(
  lines: WeightedLine[],
  key: (line: WeightedLine) => string,
) {
  const groups = new Map<string, WeightedLine>();
  for (const line of lines) {
    const id = key(line);
    const previous = groups.get(id);
    if (previous) previous.weight = roundMoney(previous.weight + line.weight);
    else groups.set(id, { ...line, id });
  }
  return [...groups.values()];
}

/** Builds independent priced leaves; overhead/risk is included through total-price allocation. */
function costQuoteLeaves(
  snapshot: QuoteCostSource,
  mode: 'scope' | 'group' | 'item',
): WeightedLine[] {
  // Use captured costs exactly as pricing does; export validation rejects stale calculations.
  const rows = snapshot.costRows;
  const travel = getHQTravelSummary(
    rows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  ).totalCost;
  const statement = getCostStatementValues(
    rows,
    snapshot.resourceTypes,
    travel,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  // Customer descriptions retain entered Scope/BOQ text without resource rates or internal identifiers.
  const legacySubcon = rows.filter(
    (row) =>
      snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
        ?.category === 'subcontract',
  );
  const legacyIds = new Set(legacySubcon.map((row) => row.id));
  const personnel = rows.filter((row) => !legacyIds.has(row.id));
  const personnelLeaves = personnel.map((row) => ({
    id: `cost:${row.id}`,
    description:
      mode === 'group'
        ? row.groupName?.trim() || UNASSIGNED_PERSONNEL_GROUP
        : row.scope.trim() || 'Project services',
    category: commercialCategory(row.category),
    weight: totalRowCost(row),
  }));
  const leaves: WeightedLine[] =
    mode === 'group'
      ? mergeWeighted(personnelLeaves, (line) =>
          JSON.stringify([line.description, categoryKey(line.category ?? '')]),
        )
      : personnelLeaves;
  // Project-wide and legacy subcontract rows share one quote line; site BOQs remain grouped by stable site IDs.
  const subcontract = calculateSubcontractCost(
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  );
  const subconLabel =
    mode === 'scope'
      ? 'Subcon scope'
      : mode === 'group'
        ? 'Subcontract services'
        : 'Subcon item';
  const appendSubcontract = (
    id: string,
    description: string,
    entries: { category?: string; weight: number }[],
  ) => {
    const categories = mergeWeighted(
      entries.map((entry) => ({
        ...entry,
        category: commercialCategory(entry.category),
        id,
        description,
      })),
      (line) =>
        line.category
          ? `subcontract:category:${JSON.stringify([id, categoryKey(line.category)])}`
          : id,
    );
    leaves.push(...categories);
  };
  appendSubcontract('subcontract:project', subconLabel, [
    ...legacySubcon.map((row) => ({
      category: row.category,
      weight: totalRowCost(row),
    })),
    ...subcontract.lines.map((line) => ({
      category: snapshot.subcontractCost?.lines.find(
        (input) => input.id === line.id,
      )?.category,
      weight: line.total,
    })),
  ]);
  for (const site of subcontract.siteTypes) {
    appendSubcontract(
      `subcontract:site:${site.id}`,
      `${subconLabel} · ${site.name.trim() || 'Unnamed site type'}`,
      site.lines.map((line) => ({
        category: snapshot.subcontractCost?.siteTypes
          .find((input) => input.id === site.id)
          ?.lines.find((input) => input.id === line.id)?.category,
        weight: line.total,
      })),
    );
  }
  const manual = snapshot.manualCosts;
  const supplements: Array<[string, string, number]> = [
    ['equipment', 'Equipment supply', manual.localPurchasedEquipment],
    ['logistics', 'Inland logistics', manual.inlandLogistics],
    ['warehousing', 'Warehousing', manual.countryWarehousing],
    ['external-labour', 'Additional labour services', manual.nonInHouseLabour],
    ['settlement', 'Settlement services', manual.settlement],
    ['vehicles', 'Vehicle services', manual.carFee],
    [
      'other-services',
      'Other services',
      getOtherServiceCost(getOtherServiceCostBase(statement, manual), manual),
    ],
    ['travel', 'Travel services', travel],
  ];
  for (const [id, description, weight] of supplements)
    if (weight > 0)
      leaves.push({
        id: `service:${id}`,
        description,
        weight: roundMoney(weight),
      });
  // Zero-cost entered scopes remain available for free-of-charge work. An empty cost table still emits one line.
  return leaves.length
    ? leaves
    : [
        {
          id: 'service:project',
          description: snapshot.project?.name || 'Project services',
          weight: 1,
        },
      ];
}

/** Allocates the existing service price by Scope, personnel Group, or cost item, preserving cents. */
export function buildQuoteLines(
  snapshot: CostExportSnapshot,
  mode: QuoteLineMode | undefined,
  listPrice: number,
  manualLines?: ManualQuoteLine[],
): QuoteLine[] {
  if (mode === 'manual') return calculateManualQuoteLines(manualLines).lines;
  const single = !mode || mode === 'single';
  const categorized =
    snapshot.costRows.some((row) => commercialCategory(row.category)) ||
    snapshot.subcontractCost?.lines.some((line) =>
      commercialCategory(line.category),
    ) ||
    (snapshot.subcontractCost?.mode === 'site-types' &&
      snapshot.subcontractCost.siteTypes.some((site) =>
        site.lines.some((line) => commercialCategory(line.category)),
      ));
  if (single && !categorized)
    return [
      {
        id: 'service:project',
        description: snapshot.project?.name || 'Project services',
        quantity: 1,
        unit: 'lot',
        unitPrice: listPrice,
        amount: listPrice,
      },
    ];
  let leaves = costQuoteLeaves(
    snapshot,
    single ? 'item' : (mode as 'scope' | 'group' | 'item'),
  );
  if (single) {
    leaves = mergeWeighted(
      leaves.map((line) => ({
        ...line,
        category: line.category || 'Professional Service',
      })),
      (line) => `service:category:${categoryKey(line.category!)}`,
    );
    leaves = leaves.map((line) => ({
      ...line,
      description: snapshot.project?.name || 'Project services',
    }));
  } else if (mode === 'scope') {
    leaves = mergeWeighted(
      leaves.map((line) => ({
        ...line,
        description: line.description.replace(/\s+/g, ' ').trim(),
      })),
      scopeReference,
    );
  }
  const hasPositiveWeight = leaves.some((line) => line.weight > 0);
  const amounts = allocateMoneyByWeights(
    listPrice,
    leaves.map((line) => (hasPositiveWeight ? line.weight : 1)),
  );
  return leaves.map((line, index) => ({
    id: single
      ? line.id
      : `quote-item-${index + 1}${categorySuffix(line.category)}`,
    ...(line.category ? { category: line.category } : {}),
    description: line.description,
    quantity: 1,
    unit: 'lot',
    unitPrice: amounts[index],
    amount: amounts[index],
  }));
}

/** Customer output must reconcile to the service price before overall discount. */
export function validateQuoteLines(
  lines: QuoteLine[],
  listPrice: number,
): string[] {
  const errors = validateManualQuoteLines(lines);
  for (const [index, line] of lines.entries()) {
    if (
      !Number.isFinite(line.amount) ||
      line.amount < 0 ||
      line.amount > MAX_QUOTE_AMOUNT ||
      line.amount !== roundMoney(line.amount) ||
      roundMoney(line.quantity * line.unitPrice) !== line.amount
    )
      errors.push(
        `Quotation line ${index + 1}: amount must equal quantity × unit price, rounded to cents.`,
      );
  }
  if (
    roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)) !==
    roundMoney(listPrice)
  )
    errors.push(
      'Quotation line amounts must equal the service price before discount.',
    );
  return errors;
}

/** Stable Scope references reconciled to the supplied cost pool; callers exclude Risk for independent allocation. */
export function quoteScopeCosts(snapshot: QuoteCostSource, totalCost: number) {
  const groups = new Map<
    string,
    { key: string; description: string; weight: number; category?: string }
  >();
  for (const leaf of costQuoteLeaves(snapshot, 'scope')) {
    const description = leaf.description.replace(/\s+/g, ' ').trim();
    const key = scopeReference(leaf);
    const previous = groups.get(key);
    if (previous) previous.weight = roundMoney(previous.weight + leaf.weight);
    else
      groups.set(key, {
        key,
        description,
        weight: leaf.weight,
        ...(leaf.category ? { category: leaf.category } : {}),
      });
  }
  const scopes = [...groups.values()];
  const positive = scopes.some((scope) => scope.weight > 0);
  const amounts = allocateMoneyByWeights(
    totalCost,
    scopes.map((scope) => (positive ? scope.weight : 1)),
  );
  return scopes.map((scope, index) => ({
    key: scope.key,
    description: scope.description,
    ...(scope.category ? { category: scope.category } : {}),
    amount: amounts[index],
  }));
}
