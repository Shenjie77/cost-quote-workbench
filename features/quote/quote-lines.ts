/** Customer-facing line construction and manual pricing validation. */
import type { CostExportSnapshot } from '../cost/contracts.ts';
import {
  getCostStatementValues,
  getHQTravelSummary,
  getOtherServiceCost,
  roundMoney,
  totalRowCost,
} from '../cost/domain.ts';
import { subcontractCostDetails } from '../cost/subcontract-domain.ts';
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
      return { ...line, amount };
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

type WeightedLine = { id: string; description: string; weight: number };

/** Builds independent priced leaves; overhead/risk is included through total-price allocation. */
function costQuoteLeaves(snapshot: CostExportSnapshot): WeightedLine[] {
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
  );
  // Customer descriptions retain entered Scope/BOQ text without resource rates or internal identifiers.
  const leaves: WeightedLine[] = rows.map((row) => ({
    id: `cost:${row.id}`,
    description: row.scope.trim() || 'Project services',
    weight: totalRowCost(row),
  }));
  leaves.push(
    ...subcontractCostDetails(snapshot.subcontractCost).map((line) => ({
      id: `subcontract:${line.id}`,
      description: line.description.trim() || 'Project services',
      weight: line.total,
    })),
  );
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
      getOtherServiceCost(statement.labour, manual),
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
          description: snapshot.project.name || 'Project services',
          weight: 1,
        },
      ];
}

/** Allocates the existing service price to Scope groups or individual cost entries, preserving cents. */
export function buildQuoteLines(
  snapshot: CostExportSnapshot,
  mode: QuoteLineMode | undefined,
  listPrice: number,
  manualLines?: ManualQuoteLine[],
): QuoteLine[] {
  if (mode === 'manual') return calculateManualQuoteLines(manualLines).lines;
  if (!mode || mode === 'single')
    return [
      {
        id: 'service:project',
        description: snapshot.project.name || 'Project services',
        quantity: 1,
        unit: 'lot',
        unitPrice: listPrice,
        amount: listPrice,
      },
    ];
  let leaves = costQuoteLeaves(snapshot);
  if (mode === 'scope') {
    const groups = new Map<string, WeightedLine>();
    for (const line of leaves) {
      const description = line.description.replace(/\s+/g, ' ').trim();
      const key = description.toLocaleLowerCase('en');
      const group = groups.get(key);
      if (group) group.weight = roundMoney(group.weight + line.weight);
      else groups.set(key, { ...line, description });
    }
    leaves = [...groups.values()];
  }
  const hasPositiveWeight = leaves.some((line) => line.weight > 0);
  const amounts = allocateMoneyByWeights(
    listPrice,
    leaves.map((line) => (hasPositiveWeight ? line.weight : 1)),
  );
  return leaves.map((line, index) => ({
    id: `quote-item-${index + 1}`,
    description: line.description,
    quantity: 1,
    unit: 'lot',
    unitPrice: amounts[index],
    amount: amounts[index],
  }));
}

/** Customer output must reconcile to the service price before overall discount and tax. */
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
      'Quotation line amounts must equal the service price before discount and tax.',
    );
  return errors;
}
