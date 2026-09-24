/** Shared pricing rules used by the quote page and project portfolio. */

import { roundMoney } from '../cost/domain.ts';
import type { ManualQuoteLine, QuoteLineMode } from './excel-template-types.ts';
import { calculateManualQuoteLines } from './quote-lines.ts';
import { allocateQuotePercentages } from './percentage-allocation.ts';
import { allocateLinePricing } from './line-pricing.ts';
import { targetPriceAfterShareRounding } from './target-price.ts';
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
  /** Legacy persisted field retained for compatibility; new quotations ignore it. */
  gstPercent: number;
  /** Project-owned rate snapshot; global catalogue updates are explicitly applied. */
  profitShareRates?: ProfitShareRate[];
  profitShareMasterDataRevision?: number;
  /** Omitted retains the historical single-total quotation. */
  lineMode?: QuoteLineMode;
  /** Project-owned customer prices; unused modes retain these edits for later use. */
  manualLines?: ManualQuoteLine[];
  /** Optional manual-line target before overall discount; absent preserves historical pricing. */
  manualTargetPrice?: number;
  /** Independent line GP is explicit; historical project-GP allocation and saved manual prices retain their own rules. */
  manualPricingBasis?: 'gp' | 'line-gp';
  /** Original grouping retained while independently priced lines use the shared manual output path. */
  lineSourceMode?: QuoteLineMode;
};

export const initialPricingSettings: PricingSettings = {
  targetGrossMargin: 50,
  discount: 0,
  gstPercent: 0,
};

export type PricingResult = ReturnType<typeof calculatePricing>;

/** Blocks customer output when entered commercial terms cannot be honoured. */
export const validatePricingSettings = (
  settings: PricingSettings,
  totalCost: number,
  allocation?: BuCostAllocation,
): string[] => calculatePricing(totalCost, settings, allocation).errors;

/**
 * Revenue is apportioned by final BU cost weights. Profit share is charged on
 * discounted quotation revenue. Legacy tax settings never affect new prices.
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
  const manualPricing = settings.lineMode === 'manual';
  const gpManualPricing = manualPricing && settings.manualPricingBasis === 'gp';
  const independentLinePricing =
    manualPricing && settings.manualPricingBasis === 'line-gp';
  const usesGpTarget = !manualPricing || gpManualPricing;
  if (
    settings.manualPricingBasis !== undefined &&
    !['gp', 'line-gp'].includes(settings.manualPricingBasis)
  )
    errors.push('Select a supported manual pricing basis.');
  if (
    settings.lineMode !== undefined &&
    !['single', 'scope', 'item', 'manual'].includes(settings.lineMode)
  )
    errors.push('Select a supported quotation detail mode.');
  if (
    settings.lineSourceMode !== undefined &&
    !['single', 'scope', 'item', 'manual'].includes(settings.lineSourceMode)
  )
    errors.push('Select a supported quotation line source.');
  if (!Number.isFinite(totalCost) || totalCost < 0 || totalCost > 1e12)
    errors.push(
      'Total cost must be a finite non-negative amount within the supported range.',
    );
  if (
    usesGpTarget &&
    (!Number.isFinite(settings.targetGrossMargin) ||
      settings.targetGrossMargin < 0 ||
      settings.targetGrossMargin > 95)
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
  const targetGrossMargin = Number.isFinite(settings.targetGrossMargin)
    ? Math.min(95, Math.max(0, settings.targetGrossMargin))
    : 0;
  const discount =
    Number.isFinite(settings.discount) && settings.discount <= 1e12
      ? roundMoney(Math.max(0, settings.discount))
      : 0;
  const weightedProfitShareRate = basis.weightedProfitShareRate;
  const denominator = 1 - (targetGrossMargin + weightedProfitShareRate) / 100;
  if (usesGpTarget && denominator <= 0)
    errors.push(
      'Target sales GP plus weighted profit-share rate must be less than 100%. / 目标销售毛利与加权分成率之和须小于 100%。',
    );
  // New manual allocations follow the same GP target as generated quotes, including BU share rounding.
  // Recalculate detached effective lines here so cost/GP changes stay consistent in the UI and API exports.
  const gpTarget = targetPriceAfterShareRounding(
    cost,
    targetGrossMargin,
    weightedProfitShareRate,
    denominator,
  );
  const percentageAllocation = gpManualPricing
    ? allocateQuotePercentages(settings.manualLines ?? [], gpTarget)
    : undefined;
  if (percentageAllocation) errors.push(...percentageAllocation.errors);
  // Independent line prices own their GP; the project total is their sum, never an additional target.
  const lineAllocation = independentLinePricing
    ? allocateLinePricing(
        settings.manualLines ?? [],
        cost,
        weightedProfitShareRate,
      )
    : undefined;
  if (lineAllocation) errors.push(...lineAllocation.errors);
  const effectiveLines = lineAllocation?.lines ?? percentageAllocation?.lines;
  const manual = manualPricing
    ? calculateManualQuoteLines(effectiveLines ?? settings.manualLines)
    : undefined;
  if (manual) errors.push(...manual.errors);
  // A saved target is a customer-output constraint, never permission to silently reprice saved lines.
  if (
    manual &&
    !gpManualPricing &&
    !independentLinePricing &&
    settings.manualTargetPrice !== undefined
  ) {
    const target = settings.manualTargetPrice;
    if (
      !Number.isFinite(target) ||
      target < 0 ||
      target > 1e12 ||
      roundMoney(target) !== target
    )
      errors.push(
        'Target total must be a non-negative amount with at most two decimals.',
      );
    else if (roundMoney(manual.total) !== target)
      errors.push(
        'Quotation lines must match the target total before discount. Adjust their proportions or fixed prices.',
      );
  }
  const rawListPrice = gpManualPricing ? gpTarget : (manual?.total ?? gpTarget);
  const listPrice =
    Number.isFinite(rawListPrice) && rawListPrice <= 1e12
      ? roundMoney(rawListPrice)
      : 0;
  if (!Number.isFinite(rawListPrice) || rawListPrice > 1e12)
    errors.push('Calculated target price exceeds the supported range.');
  const quoteBeforeTax = roundMoney(Math.max(0, listPrice - discount));
  // Retain result keys consumed by stored contracts without applying obsolete tax settings.
  // Existing quotation history is an immutable snapshot and is never recalculated here.
  const gstPercent = 0;
  const gstAmount = 0;
  const quoteAfterTax = quoteBeforeTax;
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
    ...(effectiveLines ? { allocatedManualLines: effectiveLines } : {}),
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
