/** Explicit transitions into GP-based line allocation; loading historical prices never invokes these writes. */
import type { PricingSettings } from './domain.ts';
import type { ManualQuoteLine } from './excel-template-types.ts';
import { allocateQuotePercentages } from './percentage-allocation.ts';

/** Convert legacy relative weights only when the user chooses a new GP/percentage allocation. */
export function gpAllocationLines(
  settings: PricingSettings,
  lines = settings.manualLines ?? [],
): ManualQuoteLine[] {
  if (settings.manualPricingBasis === 'gp') return lines;
  return lines.map(
    ({ allocationWeight: _weight, allocationFixed: _fixed, ...line }) => ({
      ...line,
      allocationFixed: false,
    }),
  );
}

/** Use the original GP target, retaining editable inputs on an allocation error and discarding obsolete target overrides. */
export function applyGpAllocation(
  settings: PricingSettings,
  targetPrice: number,
  lines = gpAllocationLines(settings),
): PricingSettings {
  const { manualTargetPrice: _legacyTarget, ...current } = settings;
  const allocation = allocateQuotePercentages(lines, targetPrice);
  return {
    ...current,
    lineMode: 'manual',
    manualPricingBasis: 'gp',
    manualLines: allocation.lines,
  };
}
