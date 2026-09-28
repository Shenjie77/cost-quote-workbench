'use client';
/** Dense equipment grid: source prices stay editable, calculated fields and history remain read-only. */
import { useState, type PointerEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MaintenancePriceRecord } from '../master-data/domain';
import { maintenanceCandidates, type BoqLine } from './domain';

const labels = [
  'Model',
  'Desc.',
  'CT',
  'SPMS',
  'U/P',
  'QTY',
  'Yearly',
  'Dur.',
  'Total',
  'Hist.',
  'Rmk.',
  '',
];
/** Full labels remain available on hover so abbreviations retain their meaning. */
const columnTitles = [
  'Equipment model / 设备型号',
  'Description / 描述',
  'CT',
  'SPMS',
  'Unit price / 年度单价',
  'Quantity / 数量',
  'Yearly price / 每年总价（年度单价 × 数量）',
  'Duration / 维保年数',
  'Total / 总价',
  'History / 历史价格',
  'Remark / 备注',
  'Actions / 操作',
];
const defaultWidths = [180, 220, 90, 90, 100, 65, 110, 65, 120, 90, 180, 42];
const money = (amount: number) =>
  amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Allow temporary empty numeric drafts; committing an empty optional value stores zero. */
function NumberCell({
  value,
  label,
  max,
  integer = false,
  onCommit,
  disabled,
}: {
  value: number;
  label: string;
  max: number;
  integer?: boolean;
  onCommit: (value: number) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(value || '')),
    [error, setError] = useState(false);
  const commit = () => {
    if (disabled || draft === String(value || '')) return;
    const next = Number(draft);
    const valid =
      Number.isFinite(next) &&
      next >= 0 &&
      next <= max &&
      (!integer || Number.isInteger(next)) &&
      Math.abs(next * 100 - Math.round(next * 100)) < 1e-6;
    setError(!valid);
    if (valid) onCommit(next);
  };
  return (
    <Input
      aria-label={label}
      aria-invalid={error}
      title={
        error ? 'Enter a non-negative value; at most 2 decimals.' : undefined
      }
      disabled={disabled}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        setError(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(String(value || ''));
          setError(false);
        }
      }}
      className="h-full min-h-8 rounded-none border-transparent bg-transparent px-2 text-right text-xs shadow-none"
    />
  );
}

/** Pointer capture supports dragging; arrow keys provide an equivalent keyboard resize operation. */
function ResizeHandle({
  label,
  axis,
  value,
  onChange,
}: {
  label: string;
  axis: 'x' | 'y';
  value: number;
  onChange: (value: number) => void;
}) {
  const [drag, setDrag] = useState<{ start: number; value: number } | null>(
    null,
  );
  const coordinate = (event: PointerEvent<HTMLSpanElement>) =>
    axis === 'x' ? event.clientX : event.clientY;
  return (
    <span
      // Interactive resize handles use the adjustable separator pattern, not a decorative rule.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={axis === 'x' ? 60 : 32}
      aria-valuemax={axis === 'x' ? 600 : 240}
      className={
        axis === 'x'
          ? 'absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20'
          : 'absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-row-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20'
      }
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ start: coordinate(event), value });
      }}
      onPointerMove={(event) => {
        if (drag)
          onChange(
            Math.max(
              axis === 'x' ? 60 : 32,
              Math.min(
                axis === 'x' ? 600 : 240,
                drag.value + coordinate(event) - drag.start,
              ),
            ),
          );
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(event) => {
        if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          onChange(
            Math.max(
              axis === 'x' ? 60 : 32,
              Math.min(
                axis === 'x' ? 600 : 240,
                value + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -8 : 8),
              ),
            ),
          );
        }
      }}
    />
  );
}

/** Same-model history is an optional comparison and never writes pricing or requires reference selection. */
function HistoryCell({
  model,
  records,
}: {
  model: string;
  records: MaintenancePriceRecord[];
}) {
  const matches = model.trim() ? maintenanceCandidates(records, model) : [];
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" className="h-7 text-xs" />}
      >
        {matches.length ? `History (${matches.length})` : 'History —'}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{model || 'Unnamed model'} · 历史价格</DialogTitle>
          <DialogDescription>
            同型号的单台年度价格对比，仅供参考，不影响本次 CT / SPMS。
          </DialogDescription>
        </DialogHeader>
        {matches.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {['Client', 'Date', 'SLA', 'Annual Price', 'Source'].map(
                  (label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map(({ record, unitAnnualQuote }) => (
                <TableRow key={record.id}>
                  <TableCell>{record.client}</TableCell>
                  <TableCell>{record.quoteDate}</TableCell>
                  <TableCell>{record.serviceLevel}</TableCell>
                  <TableCell>{money(unitAnnualQuote)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {record.source}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            暂无相同型号的历史价格。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MaintenanceGrid({
  rows,
  totals,
  records,
  onPatch,
  onDelete,
  disabled,
}: {
  rows: BoqLine[];
  totals: Map<string, number>;
  records: MaintenancePriceRecord[];
  onPatch: (id: string, patch: Partial<BoqLine>) => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}) {
  const [widths, setWidths] = useState(defaultWidths),
    [heights, setHeights] = useState<Record<string, number>>({});
  return (
    <Table
      aria-label="Maintenance equipment grid"
      className="table-fixed border-collapse text-xs [&_td]:border [&_td]:p-0 [&_th]:border"
      style={{ width: widths.reduce((a, b) => a + b, 0) }}
    >
      <colgroup>
        {widths.map((width, index) => (
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {labels.map((label, index) => (
            <TableHead
              key={index}
              title={columnTitles[index]}
              className="relative h-8 px-2 text-xs"
            >
              {label}
              <ResizeHandle
                label={`Resize ${label || 'actions'} column`}
                axis="x"
                value={widths[index]}
                onChange={(width) =>
                  setWidths((current) =>
                    current.map((value, i) => (i === index ? width : value)),
                  )
                }
              />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {!rows.length ? (
          <TableRow>
            <TableCell colSpan={12}>
              <p className="p-4 text-muted-foreground">
                添加设备或批量粘贴 Excel 数据。History 和 Remark 可留空。
              </p>
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => (
            <TableRow key={row.id} style={{ height: heights[row.id] ?? 32 }}>
              <TableCell>
                <Input
                  aria-label={`Model row ${index + 1}`}
                  disabled={disabled}
                  value={row.model}
                  maxLength={500}
                  onChange={(e) => onPatch(row.id, { model: e.target.value })}
                  className="h-full min-h-8 rounded-none border-transparent bg-transparent px-2 text-xs font-medium shadow-none"
                />
              </TableCell>
              <TableCell>
                <textarea
                  aria-label={`Description row ${index + 1}`}
                  disabled={disabled}
                  value={row.description ?? ''}
                  maxLength={10000}
                  onChange={(event) =>
                    onPatch(row.id, { description: event.target.value })
                  }
                  className="block h-full min-h-8 w-full resize-none bg-transparent px-2 py-1 text-xs"
                  style={{ height: (heights[row.id] ?? 32) - 2 }}
                />
              </TableCell>
              {(['ct', 'spms'] as const).map((field) => (
                <TableCell key={field}>
                  <NumberCell
                    key={`${row.id}-${field}-${row[field]}`}
                    value={row[field] ?? 0}
                    label={`${field.toUpperCase()} row ${index + 1}`}
                    max={1e10}
                    disabled={disabled}
                    onCommit={(value) => onPatch(row.id, { [field]: value })}
                  />
                </TableCell>
              ))}
              <TableCell className="financial-numeral bg-muted/30 text-right">
                <span className="px-2">
                  {money((row.ct ?? 0) + (row.spms ?? 0))}
                </span>
              </TableCell>
              <TableCell>
                <NumberCell
                  key={`qty-${row.quantity}`}
                  value={row.quantity}
                  label={`QTY row ${index + 1}`}
                  max={1e6}
                  integer
                  disabled={disabled}
                  onCommit={(quantity) => onPatch(row.id, { quantity })}
                />
              </TableCell>
              <TableCell className="financial-numeral bg-muted/30 text-right">
                <span className="px-2">
                  {money(((row.ct ?? 0) + (row.spms ?? 0)) * row.quantity)}
                </span>
              </TableCell>
              <TableCell>
                <NumberCell
                  key={`duration-${row.durationYears}`}
                  value={row.durationYears ?? 0}
                  label={`Duration years row ${index + 1}`}
                  max={100}
                  disabled={disabled}
                  onCommit={(durationYears) =>
                    onPatch(row.id, { durationYears })
                  }
                />
              </TableCell>
              <TableCell className="financial-numeral bg-muted/30 text-right">
                <span className="px-2">{money(totals.get(row.id) ?? 0)}</span>
              </TableCell>
              <TableCell>
                <HistoryCell model={row.model} records={records} />
              </TableCell>
              <TableCell>
                <textarea
                  aria-label={`Remark row ${index + 1}`}
                  disabled={disabled}
                  maxLength={10000}
                  value={row.remark ?? ''}
                  onChange={(e) => onPatch(row.id, { remark: e.target.value })}
                  className="block h-full min-h-8 w-full resize-none bg-transparent px-2 py-1 text-xs"
                  style={{ height: (heights[row.id] ?? 32) - 2 }}
                />
              </TableCell>
              <TableCell className="relative text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Delete maintenance row ${index + 1}`}
                  className="h-7 w-8 p-0"
                  onClick={() => onDelete(row.id)}
                >
                  <Trash2 className="size-3" />
                </Button>
                <ResizeHandle
                  label={`Resize row ${index + 1}`}
                  axis="y"
                  value={heights[row.id] ?? 32}
                  onChange={(height) =>
                    setHeights((current) => ({ ...current, [row.id]: height }))
                  }
                />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
