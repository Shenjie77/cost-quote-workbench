import { Text } from '@/components/ui/presentation';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/money';
/** One inline editing contract for every subcontract field and annual quantity. */
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BusinessUnitSelect } from '@/features/master-data/business-unit-select';

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
const money = formatMoney;
const cellInput = 'w-full';
const yearLabel = (years: (number | null)[], index: number) =>
  `${YEAR_BUCKETS[index]}${years[index] ? ` · ${years[index]}` : ''}`;
const annualCost = (line: SubcontractCostLine, index: number, factor = 1) =>
  roundMoney((line.unitPrice ?? 0) * line.quantities[index] * factor);

/** Validate the latest complete row; incomplete draft text and null prices remain supported. */
export function subcontractItemIssues(line: ItemLine) {
  if (
    wholeUnits(line.unit) &&
    ('quantities' in line ? line.quantities : [line.quantityPerSite]).some(
      (quantity) => !Number.isInteger(quantity),
    )
  )
    return [
      'PCS requires whole quantities. Adjust quantities before changing the unit to pcs.',
    ];
  return validateSubcontractCost(
    'quantities' in line
      ? { mode: 'project', lines: [line], siteTypes: [] }
      : {
          mode: 'site-types',
          lines: [],
          siteTypes: [
            {
              id: 'inline',
              name: 'Inline item',
              sites: [0, 0, 0, 0, 0],
              lines: [line],
            },
          ],
        },
    false,
  ).map((issue) => issue.message);
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
      <Trash2 className="size-4" />
    </Button>
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
  rateFactors = [1, 1, 1, 1, 1],
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
  rateFactors?: number[];
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
    if (locked) return;
    const issues = subcontractItemIssues(line);
    if (issues.length) {
      announce(issues[0]);
      return;
    }
    onChange(line);
  };
  const columnWidths = [
    96,
    180,
    140,
    90,
    64,
    100,
    ...(allYears ? [104, 104, 104, 104, 104] : [104]),
    110,
    80,
  ];
  return (
    <Table
      key={allYears ? 'all-years' : 'single-year'}
      aria-label="Item details table"
      className="table-fixed [&_td]:whitespace-normal [&_td]:break-words [&_th]:h-8"
      style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) }}
    >
      <colgroup>
        {columnWidths.map((width, index) => (
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow tone="subtotal">
          <TableHead className="min-w-24">Code</TableHead>
          <TableHead className="min-w-40">Description</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>BU</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead variant="numeric" className="min-w-24 text-right">
            Unit Price
          </TableHead>
          {allYears ? (
            YEAR_BUCKETS.map((bucket, index) => (
              <TableHead
                variant="numeric"
                key={bucket}
                className="min-w-28 text-right"
              >
                {yearLabel(actualYears, index)}
                <Text
                  as="span"
                  tone="muted"
                  textRole="body-small"
                  className="block"
                >
                  Qty / Cost
                </Text>
              </TableHead>
            ))
          ) : (
            <TableHead variant="numeric" className="min-w-20 text-right">
              {project ? `${YEAR_BUCKETS[selectedYear]} Qty` : 'Qty / Site'}
            </TableHead>
          )}
          <TableHead variant="numeric" className="min-w-24 text-right">
            {allYears
              ? 'Total'
              : project
                ? `${YEAR_BUCKETS[selectedYear]} Cost`
                : 'Cost / Site'}
          </TableHead>
          <TableHead variant="numeric" className="w-16 text-right">
            Action
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => {
          const annual = 'quantities' in line;
          const displayedYears = allYears ? [0, 1, 2, 3, 4] : [selectedYear];
          return (
            <TableRow key={line.id} className="group align-middle">
              <TableCell variant="editable">
                <Input
                  aria-label={`${line.code} code`}
                  value={line.code}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...line, code: event.target.value })
                  }
                />
              </TableCell>
              <TableCell variant="editable">
                <Textarea
                  aria-label={`${line.code} description`}
                  value={line.description}
                  rows={1}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...line, description: event.target.value })
                  }
                />
              </TableCell>
              <TableCell variant="editable">
                <Input
                  aria-label={`${line.code} category`}
                  value={line.category ?? ''}
                  maxLength={120}
                  disabled={locked}
                  placeholder="Category"
                  onChange={(event) =>
                    change({ ...line, category: event.target.value })
                  }
                />
              </TableCell>
              <TableCell variant="editable">
                <BusinessUnitSelect
                  aria-label={`${line.code} business unit`}
                  value={line.bu}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...line, bu: event.target.value })
                  }
                />
              </TableCell>
              <TableCell variant="editable">
                <Input
                  aria-label={`${line.code} unit`}
                  value={line.unit}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...line, unit: event.target.value })
                  }
                />
              </TableCell>
              <TableCell variant="editable">
                <SubcontractNumberInput
                  value={line.unitPrice}
                  label={`${line.code} unit price`}
                  price
                  locked={locked}
                  announce={announce}
                  onChange={(unitPrice) => change({ ...line, unitPrice })}
                />
              </TableCell>
              {annual ? (
                displayedYears.map((index) => (
                  <TableCell key={index}>
                    <SubcontractNumberInput
                      value={line.quantities[index]}
                      label={`${line.code} ${YEAR_BUCKETS[index]} quantity`}
                      integer={wholeUnits(line.unit)}
                      locked={locked}
                      announce={announce}
                      onChange={(quantity) =>
                        change({
                          ...line,
                          quantities: line.quantities.map((value, year) =>
                            year === index ? (quantity ?? 0) : value,
                          ) as SubcontractCostLine['quantities'],
                        })
                      }
                    />
                    {allYears && (
                      <Text
                        as="span"
                        tone="muted"
                        textRole="body-small"
                        className="mt-1 block text-right tabular-nums"
                      >
                        {line.unitPrice === null
                          ? 'Not priced'
                          : money(annualCost(line, index, rateFactors[index]))}
                      </Text>
                    )}
                  </TableCell>
                ))
              ) : (
                <TableCell>
                  <SubcontractNumberInput
                    value={line.quantityPerSite}
                    label={`${line.code} quantity per site`}
                    integer={wholeUnits(line.unit)}
                    locked={locked}
                    announce={announce}
                    onChange={(quantity) =>
                      change({ ...line, quantityPerSite: quantity ?? 0 })
                    }
                  />
                </TableCell>
              )}
              <TableCell variant="numeric" className="text-right tabular-nums">
                {line.unitPrice === null ? (
                  <Text as="span" tone="warning" textRole="body-small">
                    Not priced
                  </Text>
                ) : (
                  money(
                    annual
                      ? allYears
                        ? roundMoney(
                            line.quantities.reduce(
                              (sum, _, index) =>
                                sum +
                                annualCost(line, index, rateFactors[index]),
                              0,
                            ),
                          )
                        : annualCost(
                            line,
                            selectedYear,
                            rateFactors[selectedYear],
                          )
                      : roundMoney(line.unitPrice * line.quantityPerSite),
                  )
                )}
              </TableCell>
              <TableCell>
                <SubcontractDeleteButton
                  line={line}
                  onDelete={onDelete}
                  locked={locked}
                  deleteConfirmation={deleteConfirmation}
                />
              </TableCell>
            </TableRow>
          );
        })}
        {!lines.length && (
          <TableRow>
            <TableCell colSpan={columnWidths.length} className="text-center">
              Add items from Master Data or use Bulk Entry to begin.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
