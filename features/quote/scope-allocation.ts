/** Resolve durable Scope percentages against current costs; manual weights remain an explicit override. */
import type { ManualQuoteLine } from './excel-template-types.ts';
import { roundMoney } from '../cost/domain.ts';
import { allocateMoneyByWeights } from './profit-share.ts';
import { quoteScopeCosts, type QuoteCostSource } from './quote-lines.ts';

export type ScopeAllocation = { key: string; percentage: number };
export const AUTO_REMAINDER_ID = 'quote-unassigned-costs';

/** Legacy selections represent 100% of a Scope and upgrade without losing their references. */
export const savedScopeAllocations = (
  line: ManualQuoteLine,
): ScopeAllocation[] | undefined =>
  line.costScopeAllocations ??
  line.costScopeKeys?.map((key) => ({ key, percentage: 100 }));

/** Reserve explicit source shares, then distribute the exact remainder by the unbound rows' weights. */
export function resolveQuoteScopeCosts(
  lines: ManualQuoteLine[],
  scopes: Array<{ key: string; amount: number }>,
  totalCost: number,
  risk: number,
) {
  const next = lines.map((line) => ({ ...line }));
  const errors: string[] = [];
  const base = next.map(() => 0);
  for (const line of next) {
    const allocations = savedScopeAllocations(line) ?? [];
    if (
      new Set(allocations.map((item) => item.key)).size !==
        allocations.length ||
      allocations.some(
        (item) =>
          !Number.isFinite(item.percentage) ||
          item.percentage < 0 ||
          item.percentage > 100,
      )
    )
      errors.push(`Invalid Scope allocations: ${line.description}`);
  }
  const manual = next.flatMap((line, index) =>
    savedScopeAllocations(line) === undefined ? [index] : [],
  );
  let unassigned = 0;
  for (const scope of scopes) {
    const shares = next.map(
      (line) =>
        savedScopeAllocations(line)?.find((item) => item.key === scope.key)
          ?.percentage ?? 0,
    );
    const sum = shares.reduce((a, b) => a + b, 0);
    if (
      shares.some(
        (value) => !Number.isFinite(value) || value < 0 || value > 100,
      ) ||
      sum > 100 + 1e-8
    ) {
      errors.push(`Scope allocation exceeds 100%: ${scope.key}`);
      continue;
    }
    const amounts = allocateMoneyByWeights(scope.amount, [
      ...shares,
      Math.max(0, 100 - sum),
    ]);
    base.forEach((_, index) => {
      base[index] = roundMoney(base[index] + amounts[index]);
    });
    unassigned = roundMoney(unassigned + amounts[next.length]);
  }
  /** Add one stable fallback row only when no existing manual row can receive the remaining cost. */
  const ensureRemainder = () => {
    let index = next.findIndex(
      (line) =>
        line.id.startsWith(AUTO_REMAINDER_ID) &&
        savedScopeAllocations(line) === undefined &&
        line.riskAllocationPercent === undefined,
    );
    if (index < 0) {
      index = next.length;
      next.push({
        id: next.some((line) => line.id === AUTO_REMAINDER_ID)
          ? `${AUTO_REMAINDER_ID}-${next.length}`
          : AUTO_REMAINDER_ID,
        description: 'Other scopes',
        quantity: 1,
        unit: 'lot',
        unitPrice: 0,
        costWeight: 0,
        targetGrossMargin: 50,
      });
      base.push(0);
    }
    return index;
  };
  if (unassigned > 0) {
    const targets = manual.length ? manual : [ensureRemainder()];
    const weights = targets.map(
      (index) => next[index].unboundCostWeight ?? next[index].costWeight ?? 0,
    );
    const amounts = allocateMoneyByWeights(
      unassigned,
      weights.some((w) => w > 0) ? weights : weights.map(() => 1),
    );
    targets.forEach((index, i) => {
      base[index] = roundMoney(base[index] + amounts[i]);
    });
  }
  const explicitRiskCount = next.length;
  const riskShares = next.map((line) => line.riskAllocationPercent ?? 0);
  const riskSum = riskShares.reduce((a, b) => a + b, 0);
  if (
    riskShares.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 100,
    ) ||
    riskSum > 100 + 1e-8
  )
    errors.push('Risk allocation exceeds 100%.');
  else {
    const amounts = allocateMoneyByWeights(risk, [
      ...riskShares,
      Math.max(0, 100 - riskSum),
    ]);
    const remaining = amounts[next.length];
    const targets = next.flatMap((line, index) =>
      line.riskAllocationPercent === undefined ? [index] : [],
    );
    if (remaining > 0 && !targets.length) targets.push(ensureRemainder());
    const weights = targets.map((index) => base[index]);
    const automatic = allocateMoneyByWeights(
      remaining,
      weights.some((w) => w > 0) ? weights : weights.map(() => 1),
    );
    base.forEach((_, index) => {
      base[index] = roundMoney(
        base[index] + (index < explicitRiskCount ? amounts[index] : 0),
      );
    });
    targets.forEach((index, i) => {
      base[index] = roundMoney(base[index] + automatic[i]);
    });
  }
  next.forEach((line, index) => {
    if (savedScopeAllocations(line) === undefined)
      line.unboundCostWeight ??= line.costWeight ?? 0;
    line.costWeight = base[index];
  });
  if (next.length > 1000)
    errors.push('Scope allocation requires more than 1000 quotation lines.');
  if (Math.abs(base.reduce((a, b) => a + b, 0) - totalCost) > 0.01)
    errors.push('Scope allocation does not reconcile to project cost.');
  return { lines: next, errors };
}

/** Apply saved bindings using the current source snapshot, never the previously calculated cost weights. */
export function resolveQuoteCostBindings(
  lines: ManualQuoteLine[],
  source: QuoteCostSource,
  totalCost: number,
) {
  if (
    !lines.some(
      (line) =>
        savedScopeAllocations(line) !== undefined ||
        line.riskAllocationPercent !== undefined,
    )
  )
    return { lines, errors: [] };
  const risk = Math.min(
    totalCost,
    Math.max(0, roundMoney(source.manualCosts.riskContingency || 0)),
  );
  return resolveQuoteScopeCosts(
    lines,
    quoteScopeCosts(source, roundMoney(totalCost - risk)),
    totalCost,
    risk,
  );
}

/** Set the edited row's percentages; shrink competing reservations only when necessary to keep each pool at 100%. */
export function assignQuoteScopePercentages(
  lines: ManualQuoteLine[],
  id: string,
  allocations: ScopeAllocation[] | undefined,
  riskAllocationPercent: number | undefined,
) {
  const next = lines.map((line) => ({
    ...line,
    costScopeAllocations: savedScopeAllocations(line)?.map((item) => ({
      ...item,
    })),
    costScopeKeys: undefined,
  }));
  const target = next.find((line) => line.id === id);
  if (!target) return lines;
  target.costScopeAllocations = allocations;
  target.riskAllocationPercent = riskAllocationPercent;
  for (const requested of allocations ?? []) {
    const others = next
      .filter((line) => line.id !== id)
      .flatMap(
        (line) =>
          line.costScopeAllocations?.filter(
            (item) => item.key === requested.key,
          ) ?? [],
      );
    const sum = others.reduce((total, item) => total + item.percentage, 0);
    if (sum > 100 - requested.percentage)
      others.forEach((item) => {
        item.percentage =
          (item.percentage / sum) * (100 - requested.percentage);
      });
  }
  if (riskAllocationPercent !== undefined) {
    const others = next.filter(
      (line) => line.id !== id && line.riskAllocationPercent !== undefined,
    );
    const sum = others.reduce(
      (total, line) => total + (line.riskAllocationPercent ?? 0),
      0,
    );
    if (sum > 100 - riskAllocationPercent)
      others.forEach((line) => {
        line.riskAllocationPercent =
          ((line.riskAllocationPercent ?? 0) / sum) *
          (100 - riskAllocationPercent);
      });
  }
  return next;
}

/** Compatibility entry point for all-or-nothing Scope selection. */
export function assignQuoteScopes(
  lines: ManualQuoteLine[],
  id: string,
  keys: string[],
  scopes: Array<{ key: string; amount: number }>,
  totalCost: number,
  _remainderId: string,
): ManualQuoteLine[] {
  const selected = [...new Set(keys)].filter((key) =>
    scopes.some((scope) => scope.key === key),
  );
  return resolveQuoteScopeCosts(
    assignQuoteScopePercentages(
      lines,
      id,
      selected.map((key) => ({ key, percentage: 100 })),
      undefined,
    ),
    scopes,
    totalCost,
    0,
  ).lines;
}
