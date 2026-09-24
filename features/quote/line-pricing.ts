/** Independent quotation-line pricing keeps cost shares separate from selling-price shares. */
import { roundMoney } from '../cost/domain.ts';
import type { ManualQuoteLine } from './excel-template-types.ts';
import { allocateMoneyByWeights } from './profit-share.ts';
import {
  calculateManualQuoteLines,
  validateManualQuoteLines,
} from './quote-lines.ts';
import { allocateQuoteTarget } from './target-allocation.ts';
import { targetPriceAfterShareRounding } from './target-price.ts';

const MAX_AMOUNT = 1e12;

/** Legacy rows capture their original amount once; repricing must never change their cost basis. */
function costWeights(lines: ManualQuoteLine[]): number[] {
  return lines.map((line) => {
    const value =
      line?.costWeight ?? roundMoney(line?.quantity * line?.unitPrice);
    return Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT
      ? value
      : 0;
  });
}

/** Allocate the complete cost statement, including risk, to cents; empty cost weights share it equally. */
export function lineCostAmounts(
  lines: ManualQuoteLine[],
  totalCost: number,
): number[] {
  if (!Array.isArray(lines)) return [];
  const weights = costWeights(lines);
  return allocateMoneyByWeights(
    totalCost,
    weights.some((weight) => weight > 0) ? weights : weights.map(() => 1),
  );
}

/** A single line may round upward to a representable four-decimal price without borrowing another line's value. */
function gpUnitPrice(
  line: ManualQuoteLine,
  cost: number,
  gp: number,
  share: number,
): number | undefined {
  const denominator = 1 - (gp + share) / 100;
  const target = targetPriceAfterShareRounding(cost, gp, share, denominator);
  if (!Number.isFinite(target) || target > MAX_AMOUNT) return undefined;
  const allocation = allocateQuoteTarget(
    [
      {
        ...line,
        unitPrice: 0,
        allocationWeight: 1,
        allocationFixed: false,
        priceFixed: false,
      },
    ],
    target,
  );
  if (!allocation.errors.length) return allocation.lines[0].unitPrice;
  // A coarse quantity can skip the target cent. One cent covers the rounded share deduction at the higher price.
  const safeAmount =
    share > 0 && cost > 0 ? roundMoney((cost + 0.01) / denominator) : target;
  const unitPrice = Math.ceil((safeAmount / line.quantity) * 10_000) / 10_000;
  const amount = roundMoney(line.quantity * unitPrice);
  const profit = roundMoney(amount - cost - roundMoney((amount * share) / 100));
  const tolerance = Math.max(1e-10, Number.EPSILON * amount * 4);
  return Number.isFinite(unitPrice) &&
    unitPrice <= MAX_AMOUNT &&
    amount <= MAX_AMOUNT &&
    profit + tolerance >= (amount * gp) / 100
    ? unitPrice
    : undefined;
}

/**
 * Reprice only rows with an explicit target GP and no price lock. Other rows retain
 * their saved unit prices, including historical loss-making prices. Any invalid
 * candidate returns the original lines atomically; customer output stays blocked.
 */
export function allocateLinePricing(
  lines: ManualQuoteLine[],
  totalCost: number,
  weightedProfitShareRate: number,
  defaultTargetGp = 50,
): { lines: ManualQuoteLine[]; total: number; errors: string[] } {
  const original = calculateManualQuoteLines(lines);
  const errors: string[] = [];
  const fail = () => ({ lines, total: original.total, errors });
  if (!Number.isFinite(totalCost) || totalCost < 0 || totalCost > MAX_AMOUNT)
    errors.push(
      'Total cost must be a finite non-negative amount within the supported range.',
    );
  if (
    !Number.isFinite(weightedProfitShareRate) ||
    weightedProfitShareRate < 0 ||
    weightedProfitShareRate > 100
  )
    errors.push('Weighted profit-share rate must be between 0 and 100%.');
  if (
    !Number.isFinite(defaultTargetGp) ||
    defaultTargetGp < 0 ||
    defaultTargetGp > 95
  )
    errors.push('Default target GP must be between 0 and 95%.');
  // A GP-priced row's cached amount is replaced; all input fields and fixed amounts remain validated.
  const validationLines = Array.isArray(lines)
    ? lines.map((line) =>
        line?.targetGrossMargin !== undefined && !line.priceFixed
          ? { ...line, unitPrice: 0 }
          : line,
      )
    : lines;
  errors.push(...validateManualQuoteLines(validationLines));
  if (Array.isArray(lines)) {
    const cachedPriceErrors = validateManualQuoteLines(
      lines.map((line) =>
        line?.targetGrossMargin !== undefined && !line.priceFixed
          ? { ...line, quantity: 1 }
          : line,
      ),
    );
    for (const error of cachedPriceErrors)
      if (!errors.includes(error)) errors.push(error);
  }
  if (errors.length) return fail();
  const weights = costWeights(lines);
  const costs = lineCostAmounts(lines, totalCost);
  const candidate = lines.map((line, index) => ({
    ...line,
    costWeight: weights[index],
  }));
  for (const [index, line] of candidate.entries()) {
    if (line.targetGrossMargin === undefined || line.priceFixed) continue;
    const gp = line.targetGrossMargin;
    if (gp + weightedProfitShareRate >= 100) {
      errors.push(
        `Quotation line ${index + 1}: target GP plus weighted profit-share rate must be less than 100%.`,
      );
      continue;
    }
    const unitPrice = gpUnitPrice(
      line,
      costs[index],
      gp,
      weightedProfitShareRate,
    );
    if (unitPrice === undefined) {
      errors.push(
        `Quotation line ${index + 1}: target GP cannot be represented with this quantity and a supported four-decimal unit price.`,
      );
      continue;
    }
    candidate[index] = { ...line, unitPrice };
  }
  if (errors.length) return fail();
  const calculated = calculateManualQuoteLines(candidate);
  errors.push(...calculated.errors);
  return errors.length
    ? fail()
    : { lines: candidate, total: calculated.total, errors };
}
