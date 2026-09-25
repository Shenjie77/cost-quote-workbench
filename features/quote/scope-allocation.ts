/** Reconcile explicit scope selections with manual relative weights without counting any scope twice. */
import type { ManualQuoteLine } from './excel-template-types.ts';
import { lineCostAmounts } from './line-pricing.ts';
import { roundMoney } from '../cost/domain.ts';

/** Move selected scopes to the target and distribute unassigned cost across rows using manual weights. */
export function assignQuoteScopes(
  lines: ManualQuoteLine[],
  id: string,
  keys: string[],
  scopes: Array<{ key: string; amount: number }>,
  totalCost: number,
  remainderId: string,
): ManualQuoteLine[] {
  const scopeAmounts = new Map(
    scopes.map((scope) => [scope.key, scope.amount]),
  );
  const selected = [...new Set(keys)].filter((key) => scopeAmounts.has(key));
  const next = lines.map((line) => ({
    ...line,
    costScopeKeys:
      line.id === id
        ? selected
        : line.costScopeKeys?.filter(
            (key) => !selected.includes(key) && scopeAmounts.has(key),
          ),
  }));
  if (!next.some((line) => line.id === id)) return lines;
  // Explicit scope rows reserve their amounts first; manual rows share only the remainder.
  let reserved = 0;
  for (const line of next)
    if (line.costScopeKeys !== undefined) {
      line.costWeight = roundMoney(
        line.costScopeKeys.reduce(
          (sum, key) => sum + (scopeAmounts.get(key) ?? 0),
          0,
        ),
      );
      reserved += line.costWeight;
    }
  const remaining = Math.max(0, roundMoney(totalCost - reserved));
  const manual = next.filter((line) => line.costScopeKeys === undefined);
  const amounts = lineCostAmounts(manual, remaining);
  manual.forEach((line, index) => {
    line.costWeight = amounts[index];
  });
  // Keep the project total intact when all existing rows have explicit scope assignments.
  if (!manual.length && remaining > 0)
    next.push({
      id: remainderId,
      description: 'Other scopes',
      quantity: 1,
      unit: 'lot',
      unitPrice: 0,
      costWeight: remaining,
      costScopeKeys: undefined,
      targetGrossMargin: 50,
      priceFixed: false,
      allocationFixed: false,
    });
  return next;
}
