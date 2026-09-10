/** BU allocation and governed profit-share rates, shared by UI, API and CLI. */
import {
  getCostStatementValues,
  getHQTravelSummary,
  roundMoney,
  totalRowCost,
  totalRowMandays,
  type CostInputRow,
  type ManualCostInputs,
  type ResourceType,
  type TravelSettings,
} from '../cost/domain.ts';
import {
  subcontractCostDetails,
  type SubcontractCost,
} from '../cost/subcontract-domain.ts';

export type ProfitShareRate = {
  id: string;
  bu: string;
  /** Human-maintained company code only; BU matching and record identity never use it. */
  buCode?: string;
  ratePercent: number;
  active: boolean;
};

/** Matching ignores case and repeated whitespace, but retains entered BU labels. */
export const normalizeBu = (value: string) =>
  typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toUpperCase()
    : '';

const labelBu = (value: string) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const unassignedLabels = new Set([
  '',
  'UNASSIGNED',
  'UNASSIGNED BU',
  'UNALLOCATED',
  'UNALLOCATED BU',
  'UNSPECIFIED',
  'UNSPECIFIED BU',
  'SELECT BU',
  '-',
  '—',
]);
const compareKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finiteMoney = (value: number) =>
  Number.isFinite(value) ? roundMoney(Math.max(0, value)) : 0;

/** Validate governed names/rates and optional company metadata without treating codes as keys. */
export function validateProfitShareRates(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['Profit-share rates must be a list.'];
  const errors: string[] = [];
  const ids = new Set<string>();
  const bus = new Set<string>();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`Profit-share row ${index + 1} is invalid.`);
      return;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const bu = normalizeBu(entry.bu);
    if (!id || ids.has(id))
      errors.push(`Profit-share row ${index + 1} requires a unique ID.`);
    if (!bu || bu.length > 200 || bus.has(bu))
      errors.push(
        `Profit-share row ${index + 1} requires a unique BU (max 200 characters).`,
      );
    // Optional company codes may be duplicated; they are display metadata, not keys.
    if (
      entry.buCode !== undefined &&
      (typeof entry.buCode !== 'string' || entry.buCode.length > 200)
    )
      errors.push(
        `BU code for ${labelBu(entry.bu) || `row ${index + 1}`} must be text of at most 200 characters.`,
      );
    if (
      typeof entry.ratePercent !== 'number' ||
      !Number.isFinite(entry.ratePercent) ||
      entry.ratePercent < 0 ||
      entry.ratePercent > 100
    )
      errors.push(
        `Profit-share rate for ${labelBu(entry.bu) || `row ${index + 1}`} must be between 0 and 100%.`,
      );
    if (typeof entry.active !== 'boolean')
      errors.push(`Profit-share row ${index + 1} requires an active flag.`);
    ids.add(id);
    bus.add(bu);
  });
  return errors;
}

export type BuCostAllocationEntry = {
  bu: string;
  cost: number;
  directCost: number;
  /** Statement costs without a BU assigned to this BU. */
  unassignedCost: number;
};
export type BuCostAllocation = {
  totalCost: number;
  entries: BuCostAllocationEntry[];
  largestBu: string | null;
  unassignedCost: number;
  warnings: string[];
};
export type ProfitShareCostSnapshot = {
  costRows: CostInputRow[];
  resourceTypes: ResourceType[];
  travelSettings: TravelSettings;
  manualCosts: ManualCostInputs;
  subcontractCost?: SubcontractCost;
};

/** Largest-remainder cents keep breakdowns equal to their rounded monetary total. */
export function allocateMoneyByWeights(
  total: number,
  weights: number[],
): number[] {
  const safeWeights = weights.map((weight) =>
    Number.isFinite(weight) ? Math.max(0, weight) : 0,
  );
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (!weightSum || !Number.isFinite(weightSum)) return weights.map(() => 0);
  const cents = Math.round(finiteMoney(total) * 100);
  const raw = safeWeights.map((weight) => (weight / weightSum) * cents);
  const shares = raw.map(Math.floor);
  const order = raw
    .map((amount, index) => ({ index, remainder: amount - shares[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = cents - shares.reduce((sum, share) => sum + share, 0);
  for (let i = 0; i < remaining; i++) shares[order[i % order.length].index]++;
  return shares.map((share) => share / 100);
}

/**
 * Uses the final Cost Statement baseline, including risk, exactly once. Personnel
 * and structured subcontract lines retain their BU. HQ allowance follows each
 * HQ row's months, and airfare follows HQ mandays. Every remaining statement
 * cost (EHS, risk, logistics, blank-BU rows, etc.) goes to the largest direct BU.
 * Experimental travel rows are not part of the governed statement and are not
 * added here. Stored annual costs are used without refreshing historical rates.
 */
export function calculateBuCostAllocation(
  snapshot: ProfitShareCostSnapshot,
): BuCostAllocation {
  const {
    costRows,
    resourceTypes,
    travelSettings,
    manualCosts,
    subcontractCost,
  } = snapshot;
  const travel = getHQTravelSummary(costRows, resourceTypes, travelSettings);
  const statement = getCostStatementValues(
    costRows,
    resourceTypes,
    travel.totalCost,
    manualCosts,
    subcontractCost,
  );
  const totalCost = finiteMoney(statement.totalWithRisk);
  const groups = new Map<string, { bu: string; cost: number }>();
  const add = (bu: string, amount: number) => {
    const key = normalizeBu(bu);
    if (unassignedLabels.has(key) || !Number.isFinite(amount) || amount <= 0)
      return;
    const label = labelBu(bu);
    const previous = groups.get(key);
    groups.set(key, {
      bu: previous && compareKey(previous.bu, label) < 0 ? previous.bu : label,
      cost: roundMoney((previous?.cost ?? 0) + amount),
    });
  };
  for (const row of costRows) {
    const resource = resourceTypes.find((item) => item.id === row.reTypeId);
    if (
      resource?.category === 'internal' ||
      resource?.category === 'subcontract'
    )
      add(row.bu, totalRowCost(row));
  }
  for (const line of subcontractCostDetails(subcontractCost))
    add(line.bu, line.total);
  if (travel.totalCost > 0) {
    const travelWeights = new Map<string, { bu: string; weight: number }>();
    for (const row of travel.hqRows) {
      const resource = resourceTypes.find((item) => item.id === row.reTypeId);
      const mandays = totalRowMandays(row);
      const months =
        mandays / Math.max(Number(resource?.mandaysPerMonth || 21.75), 0.01);
      const weight =
        months * finiteMoney(travelSettings.monthlyAllowance) +
        (travel.hqMandays > 0
          ? (travel.airfareCost * mandays) / travel.hqMandays
          : 0);
      const key = normalizeBu(row.bu);
      const previous = travelWeights.get(key);
      travelWeights.set(key, {
        bu: previous?.bu ?? row.bu,
        weight: (previous?.weight ?? 0) + weight,
      });
    }
    const buckets = [...travelWeights]
      .sort(([a], [b]) => compareKey(a, b))
      .map(([, entry]) => entry);
    const amounts = allocateMoneyByWeights(
      travel.totalCost,
      buckets.map((entry) => entry.weight),
    );
    buckets.forEach((entry, index) => add(entry.bu, amounts[index]));
  }
  const ordered = [...groups.entries()].sort(
    ([a, x], [b, y]) => y.cost - x.cost || compareKey(a, b),
  );
  const directCost = roundMoney(
    ordered.reduce((sum, [, entry]) => sum + entry.cost, 0),
  );
  const unassignedCost = finiteMoney(totalCost - directCost);
  const largestBu = ordered[0]?.[1].bu ?? null;
  const warnings: string[] = [];
  if (!Number.isFinite(statement.totalWithRisk) || directCost > totalCost)
    warnings.push(
      'Cost allocation does not reconcile with the final Cost Statement; check cost inputs.',
    );
  if (!largestBu && totalCost > 0)
    warnings.push(
      'No cost has a BU. Unassigned costs use 0% profit share until a BU is provided.',
    );
  const entries = ordered.map(([, entry], index) => ({
    bu: entry.bu,
    cost: roundMoney(entry.cost + (index === 0 ? unassignedCost : 0)),
    directCost: entry.cost,
    unassignedCost: index === 0 ? unassignedCost : 0,
  }));
  if (!entries.length && totalCost > 0)
    entries.push({
      bu: 'Unassigned',
      cost: totalCost,
      directCost: 0,
      unassignedCost: totalCost,
    });
  return { totalCost, entries, largestBu, unassignedCost, warnings };
}

export type ProfitShareBreakdown = BuCostAllocationEntry & {
  costWeight: number;
  ratePercent: number;
  configured: boolean;
  allocatedRevenue: number;
  profitShareAmount: number;
};

/** No matching active rate means an explicit, visible zero-rate assumption. */
export function profitShareBasis(
  totalCost: number,
  rates: ProfitShareRate[] | undefined,
  allocation?: BuCostAllocation,
) {
  const cost = finiteMoney(totalCost);
  const errors = validateProfitShareRates(rates);
  const warnings = [...(allocation?.warnings ?? [])];
  const rawEntries =
    allocation?.entries ??
    (cost > 0
      ? [{ bu: 'Unassigned', cost, directCost: 0, unassignedCost: cost }]
      : []);
  const validEntries = rawEntries.every(
    (entry) =>
      typeof entry.bu === 'string' &&
      [entry.cost, entry.directCost, entry.unassignedCost].every(
        (amount) => Number.isFinite(amount) && amount >= 0,
      ),
  );
  const entries = validEntries ? rawEntries : [];
  const allocatedCost = roundMoney(
    entries.reduce((sum, entry) => sum + entry.cost, 0),
  );
  if (
    !validEntries ||
    Math.abs(allocatedCost - cost) > 0.005 ||
    (allocation &&
      (!Number.isFinite(allocation.totalCost) ||
        Math.abs(allocation.totalCost - cost) > 0.005))
  )
    errors.push('BU allocation must match the final Cost Statement total.');
  const rateMap = new Map<string, ProfitShareRate>();
  if (!errors.length && Array.isArray(rates))
    for (const rate of rates)
      if (rate.active) rateMap.set(normalizeBu(rate.bu), rate);
  const missingBUs: string[] = [];
  const breakdown: ProfitShareBreakdown[] = entries.map((entry) => {
    const key = normalizeBu(entry.bu);
    const rate = unassignedLabels.has(key) ? undefined : rateMap.get(key);
    if (!rate && !unassignedLabels.has(key) && entry.cost > 0)
      missingBUs.push(entry.bu);
    return {
      ...entry,
      costWeight: cost > 0 ? entry.cost / cost : 0,
      ratePercent: rate?.ratePercent ?? 0,
      configured: !!rate,
      allocatedRevenue: 0,
      profitShareAmount: 0,
    };
  });
  if (missingBUs.length)
    warnings.push(
      `No active profit-share rate for ${missingBUs.join(', ')}; 0% is used.`,
    );
  if (!allocation && cost > 0 && (rates?.length ?? 0) > 0)
    warnings.push('No BU cost allocation was supplied; profit share is 0%.');
  return {
    weightedProfitShareRate: breakdown.reduce(
      (sum, entry) => sum + entry.costWeight * entry.ratePercent,
      0,
    ),
    breakdown,
    missingBUs,
    warnings,
    errors,
  };
}
