import type { PricingResult } from './domain.ts';

/** Customer output must never bypass unresolved pricing errors, including an unapplied manual target. */
export function assertValidQuotePricing(pricing: PricingResult): void {
  if (!pricing.valid || pricing.errors.length) {
    throw new TypeError(
      pricing.errors.length
        ? pricing.errors.join(' ')
        : 'Resolve quotation pricing errors before exporting.',
    );
  }
}
