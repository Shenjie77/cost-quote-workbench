/** Transactional target-price allocation with fixed lines and customer-compatible precision. */
import { roundMoney } from '../cost/domain.ts';
import type { ManualQuoteLine } from './excel-template-types.ts';
import { allocateMoneyByWeights } from './profit-share.ts';
import {
  calculateManualQuoteLines,
  validateManualQuoteLines,
} from './quote-lines.ts';

const MAX_QUOTE_AMOUNT = 1e12;
const MAX_PRICE_UNITS = BigInt('10000000000000000');
export type QuoteTargetAllocation = {
  lines: ManualQuoteLine[];
  total: number;
  /** Target minus the recomputed line total; zero means exact reconciliation. */
  difference: number;
  errors: string[];
};
type PriceCandidate = { unitPrice: number; cents: number };

/** Existing money rounding is upward; integer cents keep reconciliation independent of float summation. */
function lineCents(
  line: Pick<ManualQuoteLine, 'quantity' | 'unitPrice'>,
): number {
  return Math.round(roundMoney(line.quantity * line.unitPrice) * 100);
}

/** Select the highest four-decimal price whose rounded amount does not exceed the requested cents. */
function priceAtOrBelow(quantity: number, cents: number): PriceCandidate {
  if (cents <= 0) return { unitPrice: 0, cents: 0 };
  const quantityUnits = BigInt(Math.round(quantity * 10_000));
  const desiredUnits = (BigInt(cents) * BigInt(1_000_000)) / quantityUnits;
  let priceUnits =
    desiredUnits > MAX_PRICE_UNITS ? MAX_PRICE_UNITS : desiredUnits;
  // Numbers near the maximum price can round by a few integer price ticks during conversion.
  for (
    let attempt = 0;
    attempt < 8 && priceUnits >= 0;
    attempt++, priceUnits--
  ) {
    const unitPrice = Number(priceUnits) / 10_000;
    const actualCents = lineCents({ quantity, unitPrice });
    if (actualCents <= cents) return { unitPrice, cents: actualCents };
  }
  return { unitPrice: 0, cents: 0 };
}

/** Complete a precise total using unlocked positive-weight rows, without changing fixed or zero-weight lines. */
function reconcileRemainder(
  lines: ManualQuoteLine[],
  indices: number[],
  remainingCents: number,
): boolean {
  let remainder = remainingCents;
  // Prefer the finest quantity increments; common unit/fractional quantities can absorb every cent.
  const ordered = [...indices].sort(
    (a, b) => lines[a].quantity - lines[b].quantity || a - b,
  );
  for (const index of ordered) {
    if (!remainder) return true;
    const current = lineCents(lines[index]);
    const candidate = priceAtOrBelow(
      lines[index].quantity,
      current + remainder,
    );
    const increase = candidate.cents - current;
    if (increase > 0) {
      lines[index] = { ...lines[index], unitPrice: candidate.unitPrice };
      remainder -= increase;
    }
  }
  if (!remainder) return true;
  // Coarser quantities may need a small exchange between two lines (for example 600 × price and 1,000 × price).
  // Bound the local search so even a 1,000-line quotation remains responsive; never accept an inexact result.
  const candidates = ordered.slice(0, 8);
  for (const first of candidates) {
    for (const second of candidates) {
      if (first === second) continue;
      const currentFirst = lineCents(lines[first]);
      const currentSecond = lineCents(lines[second]);
      let firstCents = currentFirst;
      for (let step = 0; step < 32 && firstCents > 0; step++) {
        const reduced = priceAtOrBelow(lines[first].quantity, firstCents - 1);
        firstCents = reduced.cents;
        const desiredSecond =
          currentSecond + currentFirst - firstCents + remainder;
        const increased = priceAtOrBelow(lines[second].quantity, desiredSecond);
        if (increased.cents === desiredSecond) {
          lines[first] = { ...lines[first], unitPrice: reduced.unitPrice };
          lines[second] = { ...lines[second], unitPrice: increased.unitPrice };
          return true;
        }
      }
    }
  }
  return false;
}

/** Allocate a reviewed target or return the original lines untouched with actionable errors. */
export function allocateQuoteTarget(
  lines: ManualQuoteLine[],
  target: number,
): QuoteTargetAllocation {
  const original = calculateManualQuoteLines(lines);
  const validTarget =
    typeof target === 'number' &&
    Number.isFinite(target) &&
    target >= 0 &&
    target <= MAX_QUOTE_AMOUNT &&
    target === roundMoney(target);
  const fail = (errors: string[]): QuoteTargetAllocation => ({
    lines,
    total: original.total,
    difference: validTarget
      ? (Math.round(target * 100) - Math.round(original.total * 100)) / 100
      : 0,
    errors,
  });
  if (!validTarget)
    return fail([
      'Enter a target total from 0 to 1,000,000,000,000 with at most two decimals.',
    ]);
  const errors = validateManualQuoteLines(lines);
  if (errors.length) return fail(errors);
  const targetCents = Math.round(target * 100);
  const fixedCents = lines
    .filter((line) => line.priceFixed === true)
    .reduce((sum, line) => sum + lineCents(line), 0);
  if (fixedCents > targetCents)
    return fail([
      'Fixed line prices already exceed the target. Lower a fixed price or increase the target.',
    ]);
  const adjustable = lines.flatMap((line, index) =>
    line.priceFixed === true ? [] : [index],
  );
  if (!adjustable.length)
    return fixedCents === targetCents
      ? {
          lines: lines.map((line) => ({ ...line })),
          total: target,
          difference: 0,
          errors: [],
        }
      : fail([
          'All line prices are fixed. Unlock a line or set the target to their current total.',
        ]);
  let weights = adjustable.map(
    (index) => lines[index].allocationWeight ?? lineCents(lines[index]) / 100,
  );
  if (weights.every((weight) => weight === 0)) {
    if (adjustable.some((index) => lines[index].allocationWeight !== undefined))
      return fail([
        'Set a positive allocation weight for at least one unlocked line.',
      ]);
    weights = weights.map(() => 1);
  }
  const amounts = allocateMoneyByWeights(
    (targetCents - fixedCents) / 100,
    weights,
  );
  const candidate = lines.map((line) => ({ ...line }));
  for (const [position, index] of adjustable.entries()) {
    const desiredCents = Math.round(amounts[position] * 100);
    // Keep an existing valid price when it already yields the desired cents; upward rounding has a price interval.
    if (lineCents(candidate[index]) === desiredCents) continue;
    const price = priceAtOrBelow(candidate[index].quantity, desiredCents);
    candidate[index] = { ...candidate[index], unitPrice: price.unitPrice };
  }
  const subtotalCents = candidate.reduce(
    (sum, line) => sum + lineCents(line),
    0,
  );
  const positiveIndices = adjustable.filter((_, index) => weights[index] > 0);
  if (
    !reconcileRemainder(candidate, positiveIndices, targetCents - subtotalCents)
  )
    return fail([
      'This target cannot be reconciled with these quantities and four-decimal unit prices. Adjust the target, quantities or allocation weights.',
    ]);
  const calculated = calculateManualQuoteLines(candidate);
  if (calculated.errors.length) return fail(calculated.errors);
  if (Math.round(calculated.total * 100) !== targetCents)
    return fail([
      'The calculated line amounts do not exactly match the target. Adjust the target, quantities or allocation weights.',
    ]);
  return {
    lines: candidate,
    total: calculated.total,
    difference: 0,
    errors: [],
  };
}
