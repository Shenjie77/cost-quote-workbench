import { Surface } from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import type { Dispatch, SetStateAction } from 'react';
import type { PricingSettings } from './domain';
import type { QuoteLine } from './excel-template-types';
import {
  allocateQuotationDiscount,
  type DiscountAllocation,
} from './discount-allocation';
import { formatSgd } from '@/lib/formatters';

const cell = 'h-8 w-full min-w-0';
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
    <Surface
      as="section"
      variant="footer"
      textRole="body-small"
      aria-label="Discount allocation"
    >
      <Surface
        as="div"
        variant="item"
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor="discount-placement">Apply discount</label>
        <SelectField
          id="discount-placement"
          disabled={disabled}
          className={cell.replace('w-full', 'w-44')}
          value={allocation.mode}
          onChange={(e) =>
            !disabled &&
            setPricing((p) => ({
              ...p,
              discountAllocation: {
                ...p.discountAllocation,
                mode: e.target.value as DiscountAllocation['mode'],
                shares: undefined,
              },
            }))
          }
        >
          <option value="total">Once at Grand Total</option>
          <option value="section">By Section</option>
          <option value="category">By Category</option>
        </SelectField>
        {allocation.mode === 'total' && (
          <Surface
            as="div"
            variant="item"
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor="discount-description">Discount description</label>
            <Input
              id="discount-description"
              value={pricing.discountDescription ?? ''}
              maxLength={1000}
              disabled={disabled}
              placeholder="Leave blank to use template wording"
              className="min-w-48 flex-1"
              onChange={(e) =>
                !disabled &&
                setPricing((p) => ({
                  ...p,
                  discountDescription: e.target.value,
                }))
              }
            />
          </Surface>
        )}
        {allocation.mode !== 'total' && (
          <Button
            variant="ghost"
            type="button"
            disabled={disabled}
            onClick={() =>
              !disabled &&
              setPricing((p) => ({
                ...p,
                discountAllocation: {
                  ...p.discountAllocation,
                  mode: allocation.mode,
                  shares: undefined,
                },
              }))
            }
          >
            Reset to price proportions
          </Button>
        )}
      </Surface>
      {allocation.mode !== 'total' && (
        <div className="overflow-x-auto">
          <Table
            className="w-full min-w-[880px] table-fixed text-left"
            aria-label="Discount shares"
          >
            <TableHeader>
              <TableRow>
                {[
                  'Section / Category',
                  'Before discount',
                  'Discount share (%)',
                  'Discount',
                  'After discount',
                  'Discount description',
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocation.rows.map((row) => {
                const name =
                  row.section ||
                  (row.inclusion === 'mandatory' ? 'Mandatory' : 'Optional');
                return (
                  <TableRow key={row.key}>
                    <TableHead variant="label" scope="row">
                      {name}
                      {row.category ? ` / ${row.category}` : ''}
                    </TableHead>
                    <TableCell
                      variant="numeric"
                      className="financial-numeral text-right"
                    >
                      {formatSgd(row.gross)}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        disabled={disabled}
                        aria-label={`Discount share ${name}${row.category ? ` / ${row.category}` : ''}`}
                        className={`${cell} financial-numeral text-right`}
                        placeholder={`${row.percentage.toFixed(2)}% Auto`}
                        value={
                          pricing.discountAllocation?.shares?.find(
                            (s) => s.key === row.key,
                          )?.percentage ?? ''
                        }
                        onChange={(e) => {
                          if (disabled) return;
                          const raw = e.target.value;
                          setPricing((p) => ({
                            ...p,
                            discountAllocation: {
                              ...p.discountAllocation,
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
                    </TableCell>
                    <TableCell
                      variant="numeric"
                      className="financial-numeral text-right"
                    >
                      {formatSgd(row.discount)}
                    </TableCell>
                    <TableCell
                      variant="numeric"
                      className="financial-numeral text-right"
                    >
                      {formatSgd(row.net)}
                    </TableCell>
                    <TableCell variant="editable">
                      <Input
                        aria-label={`Discount description ${name}${row.category ? ` / ${row.category}` : ''}`}
                        value={
                          row.description ?? pricing.discountDescription ?? ''
                        }
                        maxLength={1000}
                        disabled={disabled}
                        placeholder="Use template wording"
                        className="w-full min-w-0"
                        onChange={(e) => {
                          if (disabled) return;
                          const description = e.target.value;
                          setPricing((p) => ({
                            ...p,
                            discountAllocation: {
                              ...p.discountAllocation,
                              mode: allocation.mode,
                              descriptions: {
                                ...p.discountAllocation?.descriptions,
                                [row.key]: description,
                              },
                            },
                          }));
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Surface as="p" variant="body" tone="muted">
        {allocation.mode === 'total'
          ? 'Deduct once from all sections combined.'
          : 'Blank shares follow prices and split the remaining percentage. All Section and Category net amounts are included in Grand Total.'}
      </Surface>
      {allocation.errors.map((error) => (
        <Surface role="alert" key={error} as="p" variant="body" tone="danger">
          {error}
        </Surface>
      ))}
    </Surface>
  );
}
