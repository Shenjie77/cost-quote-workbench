/** Compact quantity entry with deliberate, cancellable item-detail editing. */
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BusinessUnitSelect } from '@/features/master-data/business-unit-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { YEAR_BUCKETS, roundMoney } from '../domain';
import {
  validateSubcontractCost,
  type SubcontractCostLine,
  type SubcontractSiteLine,
} from '../subcontract-domain';

type ItemLine = SubcontractCostLine | SubcontractSiteLine;
const wholeUnits = (unit: string) => unit.trim().toLowerCase() === 'pcs';
const money = (amount: number) =>
  amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const cellInput =
  'h-8 rounded-md border-border/70 bg-white px-2 text-xs shadow-none';
const yearLabel = (years: (number | null)[], index: number) =>
  `${YEAR_BUCKETS[index]}${years[index] ? ` · ${years[index]}` : ''}`;
const annualCost = (line: SubcontractCostLine, index: number) =>
  roundMoney((line.unitPrice ?? 0) * line.quantities[index]);

/** Include allocation values so metadata editing cannot restore stale quantities. */
const itemFingerprint = (line: ItemLine) =>
  JSON.stringify([
    line.id,
    line.catalogItemId ?? null,
    line.code,
    line.description,
    line.bu,
    line.unit,
    line.unitPrice,
    line.currency,
    'quantities' in line
      ? ['project', ...line.quantities]
      : ['site', line.quantityPerSite],
  ]);
export const createSubcontractItemEdit = (line: ItemLine) => ({
  baseline: itemFingerprint(line),
  draft: structuredClone(line),
});

/** A remote update must be reviewed before replacing a saved line from this editor. */
export function saveSubcontractItemEdit({
  line,
  baseline,
  draft,
  onSave,
  announce,
}: {
  line: ItemLine;
  baseline: string;
  draft: ItemLine;
  onSave: (line: ItemLine) => void | boolean;
  announce: (message: string) => void;
}) {
  if (itemFingerprint(line) !== baseline) {
    announce(
      'This item has changed. Reload the latest item before saving your edits.',
    );
    return false;
  }
  return onSave(structuredClone(draft)) !== false;
}

export function SubcontractNumberInput({
  value,
  label,
  onChange,
  locked = false,
  integer = false,
  price = false,
  announce,
}: {
  value: number | null;
  label: string;
  onChange: (value: number | null) => void;
  locked?: boolean;
  integer?: boolean;
  price?: boolean;
  announce: (message: string) => void;
}) {
  return (
    <Input
      className={`${cellInput} w-full min-w-20 text-right tabular-nums`}
      aria-label={label}
      type="number"
      value={value ?? ''}
      min={0}
      max={price ? 1e12 : 1e6}
      step={integer ? 1 : 'any'}
      placeholder={price ? 'Not priced' : '0'}
      disabled={locked}
      onChange={(event) => {
        if (locked) return;
        const next =
          event.target.value === ''
            ? price
              ? null
              : 0
            : Number(event.target.value);
        if (
          next !== null &&
          (!Number.isFinite(next) ||
            next < 0 ||
            next > (price ? 1e12 : 1e6) ||
            (integer && !Number.isInteger(next)))
        ) {
          announce(
            integer
              ? 'Enter a whole number between 0 and 1,000,000.'
              : `Enter a number between 0 and ${price ? '1,000,000,000,000' : '1,000,000'}.`,
          );
          return;
        }
        onChange(next);
      }}
    />
  );
}

/** Stateless form keeps all proposed values outside the saved cost version. */
export function SubcontractItemForm({
  draft,
  onDraftChange,
  onSave,
  onClose,
  locked = false,
  announce,
}: {
  draft: ItemLine;
  onDraftChange: (line: ItemLine) => void;
  onSave: (line: ItemLine) => void | boolean;
  onClose: () => void;
  locked?: boolean;
  announce: (message: string) => void;
}) {
  const update = (next: ItemLine) => {
    if (!locked) onDraftChange(next);
  };
  const save = () => {
    if (locked) return;
    if (
      wholeUnits(draft.unit) &&
      ('quantities' in draft ? draft.quantities : [draft.quantityPerSite]).some(
        (quantity) => !Number.isInteger(quantity),
      )
    ) {
      announce(
        'PCS requires whole quantities. Adjust the quantities before changing this item to pcs.',
      );
      return;
    }
    const issues = validateSubcontractCost(
      'quantities' in draft
        ? { mode: 'project', lines: [draft], siteTypes: [] }
        : {
            mode: 'site-types',
            lines: [],
            siteTypes: [
              {
                id: 'item-review',
                name: 'Item review',
                sites: [0, 0, 0, 0, 0],
                lines: [draft],
              },
            ],
          },
      false,
    );
    if (issues.length) {
      announce(issues[0].message);
      return;
    }
    if (onSave(structuredClone(draft)) !== false) onClose();
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="grid gap-1.5 text-xs font-medium">
        Item description
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
          aria-label="Item description"
          value={draft.description}
          disabled={locked}
          placeholder="Describe the work included in this item"
          onChange={(event) =>
            update({ ...draft, description: event.target.value })
          }
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-xs font-medium">
          Code
          <Input
            aria-label="Item code"
            className="bg-white font-normal"
            value={draft.code}
            disabled={locked}
            onChange={(event) => update({ ...draft, code: event.target.value })}
          />
        </label>
        <label
          htmlFor={`subcontract-item-bu-${draft.id}`}
          className="grid gap-1.5 text-xs font-medium"
        >
          Business unit
          <BusinessUnitSelect
            id={`subcontract-item-bu-${draft.id}`}
            aria-label="Item business unit"
            className="bg-white font-normal"
            value={draft.bu}
            disabled={locked}
            onChange={(event) => update({ ...draft, bu: event.target.value })}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Unit
          <Input
            aria-label="Item unit"
            className="bg-white font-normal"
            value={draft.unit}
            disabled={locked}
            placeholder="pcs, m, job…"
            onChange={(event) => update({ ...draft, unit: event.target.value })}
          />
        </label>
        <div className="grid gap-1.5 text-xs font-medium">
          <span>Unit price · SGD</span>
          <SubcontractNumberInput
            value={draft.unitPrice}
            label="Item unit price"
            price
            locked={locked}
            announce={announce}
            onChange={(unitPrice) => update({ ...draft, unitPrice })}
          />
        </div>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        PCS uses whole quantities. Other units can use decimals. A blank price
        remains unpriced; enter 0 for a free item.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={locked}>
          Save Item
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SubcontractItemDialog({
  line,
  onSave,
  onClose,
  title = 'Edit Item',
  locked = false,
  announce,
}: {
  line: ItemLine;
  onSave: (line: ItemLine) => void | boolean;
  onClose: () => void;
  title?: string;
  locked?: boolean;
  announce: (message: string) => void;
}) {
  const [edit, setEdit] = useState(() => createSubcontractItemEdit(line));
  const stale = itemFingerprint(line) !== edit.baseline;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Item details and price for this cost version.
          </DialogDescription>
        </DialogHeader>
        {stale && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <p>
              This item changed while you were editing. Your draft is still
              here. Reloading replaces these unsaved edits with the latest
              values.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEdit(createSubcontractItemEdit(line))}
            >
              Reload Latest
            </Button>
          </div>
        )}
        <SubcontractItemForm
          draft={edit.draft}
          onDraftChange={(draft) =>
            setEdit((current) => ({ ...current, draft }))
          }
          onSave={(draft) =>
            saveSubcontractItemEdit({
              line,
              baseline: edit.baseline,
              draft,
              onSave,
              announce,
            })
          }
          onClose={onClose}
          locked={locked}
          announce={announce}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SubcontractDeleteButton({
  line,
  locked = false,
  onDelete,
  deleteConfirmation,
}: {
  line: ItemLine;
  locked?: boolean;
  onDelete: (id: string) => void;
  deleteConfirmation?: (line: ItemLine) => string;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="size-7 text-muted-foreground hover:text-destructive"
      disabled={locked}
      aria-label={`Delete ${line.code}`}
      title="Remove item"
      onClick={() => {
        if (
          !locked &&
          window.confirm(
            deleteConfirmation?.(line) ??
              `Remove ${line.description || line.code || 'this item'} from this cost version?`,
          )
        )
          onDelete(line.id);
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

function SubcontractItemActions({
  line,
  onChange,
  onDelete,
  locked,
  announce,
  deleteConfirmation,
}: {
  line: ItemLine;
  onChange: (line: ItemLine) => void;
  onDelete: (id: string) => void;
  locked: boolean;
  announce: (message: string) => void;
  deleteConfirmation?: (line: ItemLine) => string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="flex justify-end gap-0.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-7 text-muted-foreground"
          disabled={locked}
          aria-label={`Edit ${line.code}`}
          title="Edit item details"
          onClick={() => {
            if (!locked) setEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
        <SubcontractDeleteButton
          line={line}
          locked={locked}
          onDelete={onDelete}
          deleteConfirmation={deleteConfirmation}
        />
      </div>
      {editing && (
        <SubcontractItemDialog
          line={line}
          locked={locked}
          announce={announce}
          onSave={(next) => {
            if (!locked) onChange(next);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

export function SubcontractLinesTable({
  lines,
  actualYears,
  onChange,
  onDelete,
  locked = false,
  project = false,
  announce,
  yearIndex = 0,
  deleteConfirmation,
}: {
  lines: ItemLine[];
  actualYears: (number | null)[];
  onChange: (line: ItemLine) => void;
  onDelete: (id: string) => void;
  locked?: boolean;
  project?: boolean;
  announce: (message: string) => void;
  yearIndex?: number | 'all';
  deleteConfirmation?: (line: ItemLine) => string;
}) {
  const allYears = project && yearIndex === 'all';
  const selectedYear =
    typeof yearIndex === 'number' &&
    Number.isInteger(yearIndex) &&
    yearIndex >= 0 &&
    yearIndex < 5
      ? yearIndex
      : 0;
  const change = (line: ItemLine) => {
    if (!locked) onChange(line);
  };
  const itemClass = allYears
    ? 'sticky left-0 z-10 min-w-56 bg-card'
    : 'w-full min-w-40';
  return (
    <Table
      className={allYears ? 'min-w-[1000px] text-xs' : 'min-w-[520px] text-xs'}
    >
      <TableHeader>
        <TableRow className="bg-muted/35 hover:bg-muted/35">
          <TableHead className={`${itemClass} ${allYears ? 'bg-muted' : ''}`}>
            Item
          </TableHead>
          <TableHead className="min-w-24 text-right">Unit Price</TableHead>
          {allYears ? (
            YEAR_BUCKETS.map((bucket, index) => (
              <TableHead key={bucket} className="min-w-28 text-right">
                {yearLabel(actualYears, index)}
                <span className="block text-[10px] font-normal text-muted-foreground">
                  Qty / Cost
                </span>
              </TableHead>
            ))
          ) : (
            <TableHead className="min-w-20 text-right">
              {project ? `${YEAR_BUCKETS[selectedYear]} Qty` : 'Qty / Site'}
            </TableHead>
          )}
          <TableHead className="min-w-24 text-right">
            {allYears
              ? 'Total'
              : project
                ? `${YEAR_BUCKETS[selectedYear]} Cost`
                : 'Cost / Site'}
          </TableHead>
          <TableHead className="w-16 text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => {
          const annual = 'quantities' in line;
          const displayedYears = allYears ? [0, 1, 2, 3, 4] : [selectedYear];
          return (
            <TableRow key={line.id} className="group align-middle">
              <TableCell className={`${itemClass} whitespace-normal py-3`}>
                <p className="max-w-xl whitespace-normal break-words text-[12px] font-medium leading-4">
                  {line.description || 'Untitled item'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 text-muted-foreground">
                  <span className="min-w-0 max-w-full break-all font-mono">
                    {line.code || 'No code'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{line.bu || 'No BU'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{line.unit || 'No unit'}</span>
                </div>
              </TableCell>
              <TableCell className="px-2">
                <SubcontractNumberInput
                  value={line.unitPrice}
                  label={`${line.code} unit price`}
                  price
                  locked={locked}
                  onChange={(unitPrice) => change({ ...line, unitPrice })}
                  announce={announce}
                />
              </TableCell>
              {annual ? (
                displayedYears.map((index) => (
                  <TableCell key={index} className="px-2">
                    <SubcontractNumberInput
                      value={line.quantities[index]}
                      label={`${line.code} ${YEAR_BUCKETS[index]} quantity`}
                      integer={wholeUnits(line.unit)}
                      locked={locked}
                      onChange={(next) =>
                        change({
                          ...line,
                          quantities: line.quantities.map((entry, position) =>
                            position === index ? (next ?? 0) : entry,
                          ),
                        })
                      }
                      announce={announce}
                    />
                    {allYears && (
                      <span className="mt-1 block text-right text-[10px] tabular-nums text-muted-foreground">
                        {line.unitPrice === null
                          ? 'Not priced'
                          : money(annualCost(line, index))}
                      </span>
                    )}
                  </TableCell>
                ))
              ) : (
                <TableCell className="px-2">
                  <SubcontractNumberInput
                    value={line.quantityPerSite}
                    label={`${line.code} quantity per site`}
                    integer={wholeUnits(line.unit)}
                    locked={locked}
                    onChange={(next) =>
                      change({ ...line, quantityPerSite: next ?? 0 })
                    }
                    announce={announce}
                  />
                </TableCell>
              )}
              <TableCell className="text-right font-semibold tabular-nums">
                {line.unitPrice === null ? (
                  <span className="text-[11px] font-medium text-amber-800">
                    Not priced
                  </span>
                ) : (
                  money(
                    annual
                      ? allYears
                        ? roundMoney(
                            line.quantities.reduce(
                              (sum, _, index) => sum + annualCost(line, index),
                              0,
                            ),
                          )
                        : annualCost(line, selectedYear)
                      : roundMoney(line.unitPrice * line.quantityPerSite),
                  )
                )}
              </TableCell>
              <TableCell className="px-1">
                <SubcontractItemActions
                  line={line}
                  onChange={change}
                  onDelete={onDelete}
                  locked={locked}
                  announce={announce}
                  deleteConfirmation={deleteConfirmation}
                />
              </TableCell>
            </TableRow>
          );
        })}
        {!lines.length && (
          <TableRow>
            <TableCell
              colSpan={allYears ? 9 : 5}
              className="py-8 text-center text-xs text-muted-foreground"
            >
              Add a catalog item or create a manual item to begin.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
