/** Explicit cost refresh preserves unambiguous quotation intent without guessing split/merge mappings. */
import type { PricingSettings } from './domain.ts';
import type { ManualQuoteLine, QuoteLine } from './excel-template-types.ts';
import { categoryKey } from './quotation-groups.ts';
import type { ScopeAllocation } from './scope-allocation.ts';

/** Explicit refresh retires vanished sources and keeps retained Risk shares usable after a merge. */
export function refreshScopeRiskShares(
  shares: ScopeAllocation[] | undefined,
  scopes: Array<{ key: string }>,
): ScopeAllocation[] | undefined {
  if (shares === undefined) return undefined;
  const active = shares.filter((share) =>
    scopes.some((scope) => scope.key === share.key),
  );
  const total = active.reduce((sum, share) => sum + share.percentage, 0);
  if (active.length === scopes.length && total < 100 - 1e-8)
    return total > 0
      ? active.map((share) => ({
          ...share,
          percentage: (share.percentage * 100) / total,
        }))
      : [];
  return active.map((share) => ({ ...share }));
}

const descriptionKey = (line: Pick<QuoteLine, 'description'>) =>
  categoryKey(line.description);
const matchingKey = (line: Pick<QuoteLine, 'description' | 'category'>) =>
  JSON.stringify([
    descriptionKey(line),
    categoryKey(line.category || 'Professional Service'),
  ]);

export function refreshCostQuoteLines(
  previous: ManualQuoteLine[],
  generated: QuoteLine[],
  pricing: Pick<PricingSettings, 'lineGroups' | 'lineRemarks'>,
) {
  const matches = new Map<number, number>();
  const used = new Set<number>();
  for (const keyOf of [matchingKey, descriptionKey]) {
    for (const [index, line] of generated.entries()) {
      if (matches.has(index)) continue;
      const key = keyOf(line);
      const old = previous.flatMap((candidate, oldIndex) =>
        !used.has(oldIndex) && keyOf(candidate) === key ? [oldIndex] : [],
      );
      const fresh = generated.filter(
        (candidate, newIndex) =>
          !matches.has(newIndex) && keyOf(candidate) === key,
      );
      if (old.length === 1 && fresh.length === 1) {
        matches.set(index, old[0]);
        used.add(old[0]);
      }
    }
  }
  const oldIds = new Set([...previous, ...generated].map((line) => line.id));
  const lineGroups = Object.fromEntries(
    Object.entries(pricing.lineGroups ?? {}).filter(([id]) => !oldIds.has(id)),
  );
  const lineRemarks = Object.fromEntries(
    Object.entries(pricing.lineRemarks ?? {}).filter(([id]) => !oldIds.has(id)),
  );
  const lines = generated.map(
    ({ amount, ...source }, index): ManualQuoteLine => {
      const oldIndex = matches.get(index);
      const old = oldIndex === undefined ? undefined : previous[oldIndex];
      if (!old)
        return {
          ...source,
          costWeight: amount,
          targetGrossMargin: 45,
          priceFixed: false,
          allocationFixed: false,
        };
      if (pricing.lineGroups?.[old.id])
        lineGroups[source.id] = structuredClone(pricing.lineGroups[old.id]);
      if (pricing.lineRemarks?.[old.id] !== undefined)
        lineRemarks[source.id] = pricing.lineRemarks[old.id];
      return {
        ...source,
        quantity: old.quantity,
        unit: old.unit,
        unitPrice: old.unitPrice,
        ...(old.targetGrossMargin !== undefined
          ? { targetGrossMargin: old.targetGrossMargin }
          : {}),
        ...(old.section ? { section: old.section } : {}),
        ...(old.inclusion ? { inclusion: old.inclusion } : {}),
        priceFixed: old.priceFixed,
        allocationFixed: old.allocationFixed,
        allocationWeight: old.allocationWeight,
        costWeight: amount,
      };
    },
  );
  return {
    lines,
    lineGroups,
    lineRemarks,
    matched: matches.size,
    newCount: generated.length - matches.size,
    removedCount: previous.length - used.size,
  };
}
