/** Shared pricing rules used by the quote page and project portfolio. */

import { roundMoney } from '../cost/domain.ts';

export type PricingSettings = {
  /** Target gross margin expressed as a percentage from 0 through 95. */
  targetGrossMargin: number;
  /** Commercial discount deducted after the target-margin list price. */
  discount: number;
  /** Tax shown separately from the pre-tax quotation. */
  gstPercent: number;
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
): string[] => {
  const errors: string[] = [];
  if (
    !Number.isFinite(settings.targetGrossMargin) ||
    settings.targetGrossMargin < 0 ||
    settings.targetGrossMargin > 95
  )
    errors.push(
      'Target gross margin must be between 0 and 95%. / 目标毛利须为 0–95%。',
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
  if (!errors.length) {
    const result = calculatePricing(totalCost, settings);
    if (result.discount > result.listPrice)
      errors.push('Discount exceeds the list price. / 折扣不能超过报价。');
    if (result.quoteAfterTax > 1e12 || result.grossMarginPercent < -100000)
      errors.push(
        'Calculated quote exceeds the supported range. / 报价计算结果超出范围。',
      );
  }
  return errors;
};

/**
 * Converts a cost baseline into a quote. Values are normalized with the same
 * upward-to-cent money rule as the cost engine so every screen reconciles.
 */
export const calculatePricing = (
  totalCost: number,
  settings: PricingSettings,
) => {
  const cost = roundMoney(Math.max(0, Number(totalCost) || 0));
  const targetGrossMargin = Math.min(
    95,
    Math.max(0, Number(settings.targetGrossMargin) || 0),
  );
  const discount = roundMoney(Math.max(0, Number(settings.discount) || 0));
  const gstPercent = Math.max(0, Number(settings.gstPercent) || 0);
  const listPrice = roundMoney(cost / (1 - targetGrossMargin / 100));
  const quoteBeforeTax = roundMoney(Math.max(0, listPrice - discount));
  const gstAmount = roundMoney(quoteBeforeTax * (gstPercent / 100));
  const quoteAfterTax = roundMoney(quoteBeforeTax + gstAmount);
  const grossMarginPercent =
    quoteBeforeTax > 0 ? ((quoteBeforeTax - cost) / quoteBeforeTax) * 100 : 0;
  return {
    cost,
    listPrice,
    discount,
    quoteBeforeTax,
    gstPercent,
    gstAmount,
    quoteAfterTax,
    grossMarginPercent,
  };
};
