/** Allocate a GP-derived total while retaining explicit percentage and unit-price locks. */
import { roundMoney } from '../cost/domain.ts';
import type { ManualQuoteLine } from './excel-template-types.ts';
import { allocateMoneyByWeights } from './profit-share.ts';
import {
  calculateManualQuoteLines,
  validateManualQuoteLines,
} from './quote-lines.ts';
import {
  allocateQuoteTarget,
  type QuoteTargetAllocation,
} from './target-allocation.ts';

/** All comparisons use the same upward-rounded cents as customer quotation output. */
function amountCents(line: ManualQuoteLine): number {
  return Math.round(roundMoney(line.quantity * line.unitPrice) * 100);
}

/** Convert a locked percentage amount without allowing its rounding residue to move another locked amount. */
function pricePercentageLine(
  line: ManualQuoteLine,
  amount: number,
): ManualQuoteLine | null {
  const allocation = allocateQuoteTarget(
    [
      {
        ...line,
        allocationWeight: 1,
        allocationFixed: false,
        priceFixed: false,
      },
    ],
    amount,
  );
  return allocation.errors.length
    ? null
    : { ...line, unitPrice: allocation.lines[0].unitPrice };
}

/** Return a complete exact candidate, or the original array and clear errors without partially changing prices. */
export function allocateQuotePercentages(
  lines: ManualQuoteLine[],
  target: number,
): QuoteTargetAllocation {
  const original = calculateManualQuoteLines(lines);
  const validTarget =
    typeof target === 'number' &&
    Number.isFinite(target) &&
    target >= 0 &&
    target <= 1e12 &&
    roundMoney(target) === target;
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
  // Unlocked prices are cached calculations. Validate their quantity and price separately so a quantity edit
  // can reprice an old over-limit product, while fixed prices still undergo the complete amount validation.
  const validationLines = (Array.isArray(lines) ? lines : []).map((line) =>
    line && typeof line === 'object' && !line.priceFixed
      ? { ...line, unitPrice: 0 }
      : line,
  );
  const priceValidationLines = (Array.isArray(lines) ? lines : []).map(
    (line) =>
      line && typeof line === 'object' && !line.priceFixed
        ? { ...line, quantity: 1 }
        : line,
  );
  const errors = [
    ...new Set([
      ...validateManualQuoteLines(validationLines),
      ...validateManualQuoteLines(priceValidationLines),
    ]),
  ];
  if (errors.length) return fail(errors);
  for (const [index, line] of lines.entries()) {
    if (
      line &&
      line.allocationWeight !== undefined &&
      (!Number.isFinite(line.allocationWeight) ||
        line.allocationWeight < 0 ||
        line.allocationWeight > 100)
    )
      errors.push(
        `Quotation line ${index + 1}: percentage must be between 0 and 100.`,
      );
  }
  if (errors.length) return fail(errors);
  const targetCents = Math.round(target * 100);
  const priceIndices = lines.flatMap((line, index) =>
    line.priceFixed === true ? [index] : [],
  );
  const percentageIndices = lines.flatMap((line, index) =>
    line.allocationFixed === true ? [index] : [],
  );
  const unlockedIndices = lines.flatMap((line, index) =>
    !line.priceFixed && !line.allocationFixed ? [index] : [],
  );
  const priceFixedCents = priceIndices.reduce(
    (sum, index) => sum + amountCents(lines[index]),
    0,
  );
  if (priceFixedCents > targetCents)
    return fail([
      'Fixed unit prices exceed the target total. Lower a fixed price or unlock a line.',
    ]);
  const availableCents = targetCents - priceFixedCents;
  const availablePercentage = targetCents
    ? (availableCents / targetCents) * 100
    : 100;
  const fixedPercentage = percentageIndices.reduce(
    (sum, index) => sum + lines[index].allocationWeight!,
    0,
  );
  // Only tolerate floating-point addition noise, not a user-entered over-allocation.
  const percentageTolerance =
    Number.EPSILON * Math.max(1, availablePercentage, fixedPercentage) * 16;
  if (fixedPercentage - availablePercentage > percentageTolerance)
    return fail([
      'Fixed percentages and fixed prices exceed 100% of the target. Lower a percentage or unlock a line.',
    ]);
  const remainingPercentage = Math.max(
    0,
    availablePercentage - fixedPercentage,
  );
  if (
    !unlockedIndices.length &&
    availableCents > 0 &&
    remainingPercentage > percentageTolerance
  )
    return fail([
      'There is remaining target value but every line is fixed. Unlock a line or increase the fixed percentages.',
    ]);

  // Only replace an unusable cached amount inside the detached candidate; failures still return original rows.
  const candidate = lines.map((line) => ({
    ...line,
    unitPrice:
      !line.priceFixed && line.quantity * line.unitPrice > 1e12
        ? 0
        : line.unitPrice,
  }));
  for (const index of priceIndices) {
    candidate[index] = {
      ...candidate[index],
      allocationWeight: targetCents
        ? (amountCents(candidate[index]) / targetCents) * 100
        : 0,
    };
  }
  // One remainder group protects locked-percentage cents; its amount is split equally among unlocked lines below.
  const groupWeights = [
    ...percentageIndices.map((index) => lines[index].allocationWeight!),
    ...(unlockedIndices.length ? [remainingPercentage] : []),
  ];
  const groupAmounts = allocateMoneyByWeights(
    availableCents / 100,
    groupWeights,
  );
  for (const [position, index] of percentageIndices.entries()) {
    const priced = pricePercentageLine(
      candidate[index],
      groupAmounts[position],
    );
    if (!priced)
      return fail([
        `Quotation line ${index + 1}: its fixed percentage cannot be represented with this quantity and a four-decimal unit price. Adjust the percentage or quantity.`,
      ]);
    candidate[index] = priced;
  }
  if (unlockedIndices.length) {
    const unlockedAmount = groupAmounts[percentageIndices.length];
    // Equal relative weights are temporary; persisted values remain full percentages of the target.
    const unlocked = allocateQuoteTarget(
      unlockedIndices.map((index) => ({
        ...candidate[index],
        allocationWeight: 1,
        allocationFixed: false,
        priceFixed: false,
      })),
      unlockedAmount,
    );
    if (unlocked.errors.length)
      return fail([
        'The remaining target cannot be split across unlocked lines with these quantities and four-decimal unit prices. Adjust their quantities or unlock another line.',
      ]);
    for (const [position, index] of unlockedIndices.entries()) {
      candidate[index] = {
        ...candidate[index],
        unitPrice: unlocked.lines[position].unitPrice,
        allocationWeight: remainingPercentage / unlockedIndices.length,
      };
    }
  }
  const calculated = calculateManualQuoteLines(candidate);
  if (calculated.errors.length) return fail(calculated.errors);
  if (Math.round(calculated.total * 100) !== targetCents)
    return fail([
      'Line amounts do not match the target. Unlock a line or adjust the fixed percentages.',
    ]);
  return {
    lines: candidate,
    total: calculated.total,
    difference: 0,
    errors: [],
  };
}
