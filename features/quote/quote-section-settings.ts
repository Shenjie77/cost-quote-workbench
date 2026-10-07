import {
  discountGroupKey,
  type DiscountAllocation,
} from './discount-allocation.ts';
import type { QuoteTemplate } from './types.ts';

/** Copy legacy template names into quote ownership once; later template changes cannot rename chapters. */
export function migrateQuoteSections<
  T extends {
    sectionNames?: { mandatory: string; optional: string };
    discountAllocation?: DiscountAllocation;
  },
>(pricing: T, template?: QuoteTemplate) {
  if (pricing.sectionNames)
    return { ...pricing, sectionNames: { ...pricing.sectionNames } };
  const sectionNames = {
    ...(template?.excel?.body?.sectionNames ?? {
      mandatory: 'Mandatory',
      optional: 'Optional',
    }),
  };
  const discountAllocation = pricing.discountAllocation;
  return {
    ...pricing,
    sectionNames,
    ...(discountAllocation
      ? {
          discountAllocation: {
            ...discountAllocation,
            ...(discountAllocation.shares
              ? {
                  shares: discountAllocation.shares.map((share) => {
                    try {
                      const parts = JSON.parse(share.key);
                      if (
                        Array.isArray(parts) &&
                        [1, 2].includes(parts.length) &&
                        ['mandatory', 'optional'].includes(parts[0]) &&
                        parts.every((s) => typeof s === 'string')
                      )
                        return {
                          ...share,
                          key: discountGroupKey(
                            parts[0],
                            parts[1],
                            sectionNames[parts[0] as 'mandatory' | 'optional'],
                          ),
                        };
                    } catch {
                      /* Stale or malformed keys remain visible to allocation validation. */
                    }
                    return { ...share };
                  }),
                }
              : {}),
          },
        }
      : {}),
  };
}
