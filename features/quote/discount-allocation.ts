import type { QuoteLine } from './excel-template-types.ts';
import { categoryKey, groupFor } from './quotation-groups.ts';
import { allocateMoneyByWeights } from './profit-share.ts';
import { roundMoney } from '../cost/domain.ts';

export type DiscountAllocation = {
  mode: 'total' | 'section' | 'category';
  /** Explicit shares; omitted groups share the remaining percentage by price. */
  shares?: { key: string; percentage: number }[];
};
export const discountGroupKey = (
  inclusion: string,
  category?: string,
  section?: string,
) => {
  const parts = [inclusion];
  if (section && categoryKey(section) !== inclusion)
    parts.push(`section:${categoryKey(section)}`);
  if (category !== undefined) parts.push(categoryKey(category));
  return JSON.stringify(parts);
};

/** Stable keys are independent of user-facing section titles. Amounts reconcile in cents. */
export function allocateQuotationDiscount(
  lines: readonly QuoteLine[],
  discount: number,
  settings?: DiscountAllocation,
) {
  const mode = settings?.mode ?? 'total';
  const errors: string[] = [];
  if (!Number.isFinite(discount) || discount < 0 || discount > 1e12)
    errors.push('Discount must be a valid amount from 0 to 1,000,000,000,000.');
  if (lines.some((line) => !Number.isFinite(line.amount) || line.amount < 0))
    errors.push('Discount allocation requires valid non-negative prices.');
  const buckets: {
    key: string;
    inclusion: 'mandatory' | 'optional';
    section?: string;
    category?: string;
    gross: number;
  }[] = [];
  for (const line of lines) {
    const group = groupFor(line);
    const category = mode === 'category' ? group.category : undefined;
    const key = discountGroupKey(group.inclusion, category, group.section);
    let bucket = buckets.find((row) => row.key === key);
    if (!bucket) {
      bucket = {
        key,
        inclusion: group.inclusion,
        section: group.section,
        category,
        gross: 0,
      };
      buckets.push(bucket);
    }
    bucket.gross = roundMoney(bucket.gross + line.amount);
  }
  const shares = mode === 'total' ? [] : (settings?.shares ?? []);
  if (!['total', 'section', 'category'].includes(mode))
    errors.push('Choose a valid discount allocation mode.');
  if (
    shares.some(
      (share) =>
        !Number.isFinite(share.percentage) ||
        share.percentage < 0 ||
        share.percentage > 100,
    ) ||
    new Set(shares.map((s) => s.key)).size !== shares.length
  )
    errors.push('Discount shares must be unique percentages from 0 to 100.');
  if (shares.some((share) => !buckets.some((b) => b.key === share.key)))
    errors.push(
      'Discount groups changed. Reset to price proportions or update the allocation.',
    );
  const fixed = buckets.map(
    (b) => shares.find((s) => s.key === b.key)?.percentage,
  );
  const fixedTotal = fixed.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const remainder = buckets.reduce(
    (sum, b, i) => sum + (fixed[i] === undefined ? b.gross : 0),
    0,
  );
  if (
    fixedTotal > 100 + 0.000001 ||
    (remainder === 0 && discount > 0 && Math.abs(fixedTotal - 100) > 0.000001)
  )
    errors.push(
      'Discount allocation must total 100%. Leave a share blank to allocate the remainder by price.',
    );
  const percentages = buckets.map(
    (b, i) =>
      fixed[i] ??
      (remainder > 0
        ? (Math.max(0, 100 - fixedTotal) * b.gross) / remainder
        : 0),
  );
  const amounts = allocateMoneyByWeights(discount, percentages);
  const rows = buckets.map((b, i) => ({
    ...b,
    percentage: percentages[i],
    fixed: fixed[i] !== undefined,
    discount: amounts[i],
    net: roundMoney(b.gross - amounts[i]),
  }));
  if (rows.some((r) => r.net < 0) || (discount > 0 && !rows.length))
    errors.push(
      'Allocated discount exceeds a group price. Adjust the discount or its shares.',
    );
  const gross = (inclusion: string) =>
    roundMoney(
      lines
        .filter((l) => groupFor(l).inclusion === inclusion)
        .reduce((s, l) => s + l.amount, 0),
    );
  const allocated = (inclusion: string) =>
    roundMoney(
      rows
        .filter((r) => r.inclusion === inclusion)
        .reduce((s, r) => s + r.discount, 0),
    );
  return {
    mode,
    rows,
    errors,
    mandatoryGross: gross('mandatory'),
    optionalGross: gross('optional'),
    mandatoryDiscount: allocated('mandatory'),
    optionalDiscount: allocated('optional'),
    mandatoryNet: roundMoney(gross('mandatory') - allocated('mandatory')),
    optionalNet: roundMoney(gross('optional') - allocated('optional')),
  };
}
