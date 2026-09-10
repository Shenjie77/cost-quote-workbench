/** Shared pricing rules used by the quote page and project portfolio. */

import { roundMoney } from '../cost/domain.ts';
import {
  allocateMoneyByWeights,
  profitShareBasis,
  type BuCostAllocation,
  type ProfitShareRate,
} from './profit-share.ts';

export type PricingSettings = {
  /** Target sales GP after BU profit share, as a percentage from 0 through 95. */
  targetGrossMargin: number;
  /** Commercial discount deducted after the target-margin list price. */
  discount: number;
  /** Tax shown separately from the pre-tax quotation. */
  gstPercent: number;
  /** Project-owned rate snapshot; global catalogue updates are explicitly applied. */
  profitShareRates?: ProfitShareRate[];
  profitShareMasterDataRevision?: number;
};

export const initialPricingSettings: PricingSettings = {
  targetGrossMargin: 25,
  discount: 0,
  gstPercent: 9,
};

export type PricingResult = ReturnType<typeof calculatePricing>;

/** Blocks customer output when entered commercial terms cannot be honoured. */
export const validatePricingSettings = (
  settings: PricingSettings,
  totalCost: number,
  allocation?: BuCostAllocation,
): string[] => calculatePricing(totalCost, settings, allocation).errors;

/**
 * The share deduction also rounds upward to cents. A merely rounded algebraic
 * price can therefore undershoot the requested GP on small amounts. Try at most
 * eight cent/fixed-share corrections, then allow a full cent for share rounding
 * in the numerator. That upper bound avoids unbounded cent-by-cent searches when
 * target GP plus share is very close to 100%. Zero-share legacy prices bypass it.
 */
const targetPriceAfterShareRounding = (
  cost: number,
  targetPercent: number,
  sharePercent: number,
  denominator: number,
) => {
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
  if (meetsTarget(price)) return price;
  return roundMoney((cost + 0.01) / denominator);
};

/**
 * Revenue is apportioned by final BU cost weights. Profit share is charged on
 * discounted pre-tax revenue; tax never contributes to revenue or sales GP.
 * Invalid inputs return finite preview values plus blocking errors.
 */
export const calculatePricing = (
  totalCost: number,
  settings: PricingSettings,
  allocation?: BuCostAllocation,
) => {
  const cost =
    Number.isFinite(totalCost) && totalCost >= 0 && totalCost <= 1e12
      ? roundMoney(totalCost)
      : 0;
  const basis = profitShareBasis(cost, settings.profitShareRates, allocation);
  const errors: string[] = [...basis.errors];
  if (!Number.isFinite(totalCost) || totalCost < 0 || totalCost > 1e12)
    errors.push(
      'Total cost must be a finite non-negative amount within the supported range.',
    );
  if (
    !Number.isFinite(settings.targetGrossMargin) ||
    settings.targetGrossMargin < 0 ||
    settings.targetGrossMargin > 95
  )
    errors.push(
      'Target sales GP must be between 0 and 95%. / 目标销售毛利须为 0–95%。',
    );
  if (
    !Number.isFinite(settings.discount) ||
    settings.discount < 0 ||
    settings.discount > 1e12
  )
    errors.push('Discount is outside the allowed range. / 折扣金额无效。');
  if (
    !Number.isFinite(settings.gstPercent) ||
    settings.gstPercent < 0 ||
    settings.gstPercent > 100
  )
    errors.push('Tax rate must be between 0 and 100%. / 税率须为 0–100%。');
  const targetGrossMargin = Number.isFinite(settings.targetGrossMargin)
    ? Math.min(95, Math.max(0, settings.targetGrossMargin))
    : 0;
  const discount =
    Number.isFinite(settings.discount) && settings.discount <= 1e12
      ? roundMoney(Math.max(0, settings.discount))
      : 0;
  const gstPercent = Number.isFinite(settings.gstPercent)
    ? Math.min(100, Math.max(0, settings.gstPercent))
    : 0;
  const weightedProfitShareRate = basis.weightedProfitShareRate;
  const denominator = 1 - (targetGrossMargin + weightedProfitShareRate) / 100;
  if (denominator <= 0)
    errors.push(
      'Target sales GP plus weighted profit-share rate must be less than 100%. / 目标销售毛利与加权分成率之和须小于 100%。',
    );
  const rawListPrice = targetPriceAfterShareRounding(
    cost,
    targetGrossMargin,
    weightedProfitShareRate,
    denominator,
  );
  const listPrice =
    Number.isFinite(rawListPrice) && rawListPrice <= 1e12
      ? roundMoney(rawListPrice)
      : 0;
  if (!Number.isFinite(rawListPrice) || rawListPrice > 1e12)
    errors.push('Calculated target price exceeds the supported range.');
  const quoteBeforeTax = roundMoney(Math.max(0, listPrice - discount));
  const gstAmount = roundMoney(quoteBeforeTax * (gstPercent / 100));
  const quoteAfterTax = roundMoney(quoteBeforeTax + gstAmount);
  const profitShareAmount = roundMoney(
    (quoteBeforeTax * weightedProfitShareRate) / 100,
  );
  const salesGrossProfit = roundMoney(
    quoteBeforeTax - cost - profitShareAmount,
  );
  const grossMarginPercent =
    quoteBeforeTax > 0 ? (salesGrossProfit / quoteBeforeTax) * 100 : 0;
  const revenueShares = allocateMoneyByWeights(
    quoteBeforeTax,
    basis.breakdown.map((entry) => entry.cost),
  );
  const profitShares = allocateMoneyByWeights(
    profitShareAmount,
    basis.breakdown.map((entry) => entry.costWeight * entry.ratePercent),
  );
  const profitShareBreakdown = basis.breakdown.map((entry, index) => ({
    ...entry,
    allocatedRevenue: revenueShares[index],
    profitShareAmount: profitShares[index],
  }));
  if (discount > listPrice)
    errors.push('Discount exceeds the list price. / 折扣不能超过报价。');
  if (quoteAfterTax > 1e12 || grossMarginPercent < -100000)
    errors.push(
      'Calculated quote exceeds the supported range. / 报价计算结果超出范围。',
    );
  return {
    cost,
    listPrice,
    discount,
    quoteBeforeTax,
    gstPercent,
    gstAmount,
    quoteAfterTax,
    grossMarginPercent,
    weightedProfitShareRate,
    profitShareAmount,
    salesGrossProfit,
    profitShareBreakdown,
    missingBUs: basis.missingBUs,
    warnings: basis.warnings,
    valid: errors.length === 0,
    errors,
  };
};
