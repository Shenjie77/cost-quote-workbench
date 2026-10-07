import type { Dispatch, SetStateAction } from 'react';
import type { PricingSettings } from './domain';
import type { QuoteLine } from './excel-template-types';
import {
  allocateQuotationDiscount,
  type DiscountAllocation,
} from './discount-allocation';
import { formatSgd } from '@/lib/formatters';

const cell =
  'h-8 w-full min-w-0 border-0 bg-transparent px-3 text-xs focus-visible:outline-2 focus-visible:outline-ring';
export function DiscountAllocationEditor({
  pricing,
  setPricing,
  lines,
  disabled,
}: {
  pricing: PricingSettings;
  setPricing: Dispatch<SetStateAction<PricingSettings>>;
  lines: QuoteLine[];
  disabled?: boolean;
}) {
  const allocation = allocateQuotationDiscount(
    lines,
    pricing.discount,
    pricing.discountAllocation,
  );
  return (
    <section className="border-t text-xs" aria-label="Discount allocation">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3">
        <label htmlFor="discount-placement" className="font-medium">
          Apply discount
        </label>
        <select
          id="discount-placement"
          disabled={disabled}
          className={cell.replace('w-full', 'w-44')}
          value={allocation.mode}
          onChange={(e) =>
            setPricing((p) => ({
              ...p,
              discountAllocation: {
                mode: e.target.value as DiscountAllocation['mode'],
              },
            }))
          }
        >
          <option value="total">Once at Grand Total</option>
          <option value="section">By Section</option>
          <option value="category">By Category</option>
        </select>
        {allocation.mode !== 'total' && (
          <button
            type="button"
            disabled={disabled}
            className="h-8 px-2 text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            onClick={() =>
              setPricing((p) => ({
                ...p,
                discountAllocation: { mode: allocation.mode },
              }))
            }
          >
            Reset to price proportions
          </button>
        )}
      </div>
      {allocation.mode !== 'total' && (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[620px] table-fixed text-left text-xs"
            aria-label="Discount shares"
          >
            <thead className="bg-primary text-white">
              <tr>
                {[
                  'Section / Category',
                  'Before discount',
                  'Discount share (%)',
                  'Discount',
                  'After discount',
                ].map((label) => (
                  <th
                    key={label}
                    className="border-r border-white/20 px-3 py-2 font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {allocation.rows.map((row) => {
                const name =
                  row.section ||
                  (row.inclusion === 'mandatory' ? 'Mandatory' : 'Optional');
                return (
                  <tr key={row.key}>
                    <th className="border-r px-3 py-1 font-normal">
                      {name}
                      {row.category ? ` / ${row.category}` : ''}
                    </th>
                    <td className="financial-numeral border-r px-3 text-right">
                      {formatSgd(row.gross)}
                    </td>
                    <td className="border-r bg-blue-50/30">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        disabled={disabled}
                        aria-label={`Discount share ${name}${row.category ? ` / ${row.category}` : ''}`}
                        className={`${cell} financial-numeral text-right text-blue-700`}
                        placeholder={`${row.percentage.toFixed(2)}% Auto`}
                        value={
                          pricing.discountAllocation?.shares?.find(
                            (s) => s.key === row.key,
                          )?.percentage ?? ''
                        }
                        onChange={(e) => {
                          const raw = e.target.value;
                          setPricing((p) => ({
                            ...p,
                            discountAllocation: {
                              mode: allocation.mode,
                              shares: [
                                ...(p.discountAllocation?.shares ?? []).filter(
                                  (s) => s.key !== row.key,
                                ),
                                ...(raw === ''
                                  ? []
                                  : [
                                      { key: row.key, percentage: Number(raw) },
                                    ]),
                              ],
                            },
                          }));
                        }}
                      />
                    </td>
                    <td className="financial-numeral border-r px-3 text-right">
                      {formatSgd(row.discount)}
                    </td>
                    <td className="financial-numeral bg-accent/40 px-3 text-right font-semibold">
                      {formatSgd(row.net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-3 py-2 text-muted-foreground">
        {allocation.mode === 'total'
          ? 'Deduct once from all sections combined.'
          : 'Blank shares follow prices and split the remaining percentage. All Section and Category net amounts are included in Grand Total.'}
      </p>
      {allocation.errors.map((error) => (
        <p role="alert" key={error} className="px-3 pb-2 text-destructive">
          {error}
        </p>
      ))}
    </section>
  );
}
