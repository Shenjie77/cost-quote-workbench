/**
 * Presentation-only number formatting shared by workbench views.
 *
 * Monetary values are always rendered with grouping separators and exactly two
 * decimal places. Calculations remain numeric and are rounded by domain
 * functions before reaching this display boundary.
 */

import { roundMoney } from '@/features/cost/domain';

const sgdNumber = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/** Formats a finite value as an English-first SGD amount. */
export function formatSgd(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `S$ ${sgdNumber.format(roundMoney(safeValue))}`;
}
