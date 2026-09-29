/**
 * Presentation-only number formatting shared by workbench views.
 *
 * Monetary values are always rendered with grouping separators and exactly two
 * decimal places. Calculations remain numeric and are rounded by domain
 * functions before reaching this display boundary.
 */

import { roundMoney } from '@/features/cost/domain';

import { formatMoney } from './money';

/** Formats a finite value as an English-first SGD amount. */
export function formatSgd(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `S$ ${formatMoney(roundMoney(safeValue))}`;
}
