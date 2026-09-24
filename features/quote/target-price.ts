/** Shared GP-to-price conversion keeps legacy totals and independent line prices on the same rounding rules. */
import { roundMoney } from '../cost/domain.ts';

/**
 * Profit-share deductions round upward to cents. Correct the algebraic price
 * until the requested GP is met, then use a bounded rounding allowance rather
 * than searching indefinitely when the margin and share nearly reach 100%.
 */
export function targetPriceAfterShareRounding(
  cost: number,
  targetPercent: number,
  sharePercent: number,
  denominator = 1 - (targetPercent + sharePercent) / 100,
): number {
  let price = denominator > 0 ? roundMoney(cost / denominator) : 0;
  if (
    !cost ||
    !sharePercent ||
    denominator <= 0 ||
    !Number.isFinite(price) ||
    price > 1e12
  )
    return price;
  const target = targetPercent / 100;
  const share = sharePercent / 100;
  const meetsTarget = (candidate: number) => {
    const profit = roundMoney(candidate - cost - roundMoney(candidate * share));
    const tolerance = Math.max(1e-10, Number.EPSILON * candidate * 4);
    return profit + tolerance >= candidate * target;
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    if (meetsTarget(price)) return price;
    const currentShare = roundMoney(price * share);
    price = Math.max(
      roundMoney(price + 0.01),
      roundMoney((cost + currentShare) / (1 - target)),
    );
    if (!Number.isFinite(price) || price > 1e12) return price;
  }
  return meetsTarget(price) ? price : roundMoney((cost + 0.01) / denominator);
}
