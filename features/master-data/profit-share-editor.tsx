import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  validateProfitShareRates,
  type ProfitShareRate,
} from '@/features/quote/profit-share';

/** Rates are global defaults. Changing these rows never changes an applied quote. */
export function ProfitShareEditor({
  items,
  setItems,
  query,
}: {
  items: ProfitShareRate[];
  setItems: React.Dispatch<React.SetStateAction<ProfitShareRate[]>>;
  query: string;
}) {
  /** Patch one stable record; editing its company code does not rename the BU. */
  const update = (id: string, patch: Partial<ProfitShareRate>) =>
    setItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  const rows = items.filter((row) =>
    [row.bu, row.buCode || '']
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const errors = validateProfitShareRates(items);
  return (
    <>
      <div className="wb-toolbar justify-between border-b text-xs">
        <div>
          <p className="font-medium">BU Profit Share Rates</p>
          <p className="mt-1 text-muted-foreground">
            Share is deducted from the pre-tax selling price. Existing
            quotations retain their applied rates.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            setItems((current) => [
              ...current,
              {
                id: `profit-share-${crypto.randomUUID()}`,
                bu: '',
                buCode: '',
                ratePercent: 0,
                active: true,
              },
            ])
          }
        >
          <Plus /> Add BU
        </Button>
      </div>
      <div className="wb-table-scroll">
        <Table className="min-w-[580px] text-xs">
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>BU</TableHead>
              <TableHead className="w-48">BU Code</TableHead>
              <TableHead className="w-48 text-right">
                Profit Share Rate (%)
              </TableHead>
              <TableHead className="w-24 text-center">Active</TableHead>
              <TableHead className="w-20 text-center">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Input
                    className="h-8 text-xs"
                    aria-label={`${row.bu || 'New BU'} business unit`}
                    value={row.bu}
                    placeholder="Enter the BU used in cost inputs"
                    maxLength={200}
                    onChange={(event) =>
                      update(row.id, { bu: event.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 text-xs"
                    aria-label={`${row.bu || 'New BU'} BU code`}
                    value={row.buCode || ''}
                    placeholder="Company code (optional)"
                    maxLength={200}
                    onChange={(event) =>
                      update(row.id, { buCode: event.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="financial-numeral h-8 text-right text-xs"
                    aria-label={`${row.bu || 'New BU'} profit share rate`}
                    value={row.ratePercent}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    onChange={(event) =>
                      update(row.id, {
                        ratePercent: Number(event.target.value),
                      })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`${row.bu || 'New BU'} active`}
                    checked={row.active}
                    onChange={(event) =>
                      update(row.id, { active: event.target.checked })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${row.bu || 'new BU'} profit share rate`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the profit share rate for ${row.bu || 'this BU'}? Existing quotation snapshots will be retained.`,
                        )
                      )
                        setItems((current) =>
                          current.filter((item) => item.id !== row.id),
                        );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  {items.length
                    ? 'No matching BU.'
                    : 'No profit share rates configured. Add a BU and its rate, then save this tab.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {!!errors.length && (
        <div
          role="alert"
          className="border-t bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        BU Code is for manual comparison with company records only. Cost inputs
        and profit sharing continue to use BU names. Unconfigured or inactive
        BUs use 0% and are flagged in Pricing Parameters. Apply updated rates
        explicitly from the quotation page.
      </p>
    </>
  );
}
