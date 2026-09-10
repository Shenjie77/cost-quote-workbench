/** Compact quote detail controls; generated lines remain separate from manual sale prices. */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatSgd } from '@/lib/formatters';
import type { PricingSettings } from './domain';
import type {
  ManualQuoteLine,
  QuoteLine,
  QuoteLineMode,
} from './excel-template-types';
import { MAX_QUOTE_LINES } from './quote-lines';

const MODES: Array<{ value: QuoteLineMode; label: string }> = [
  { value: 'single', label: 'Single line · 单行总价' },
  { value: 'scope', label: 'By Scope · 按 Scope 汇总' },
  { value: 'item', label: 'By cost item · 按成本条目' },
  { value: 'manual', label: 'Manual prices · 逐条定价' },
];

/** Removes calculated fields when copying generated lines into editable customer prices. */
function editableLines(lines: QuoteLine[]): ManualQuoteLine[] {
  return lines.map(({ amount: _amount, ...line }) => ({ ...line }));
}

/** Keeps mode selection and line operations adjacent to the data they affect. */
export function QuoteLinesEditor({
  pricing,
  setPricing,
  lines,
  disabled,
  embedded = false,
}: {
  pricing: PricingSettings;
  setPricing: React.Dispatch<React.SetStateAction<PricingSettings>>;
  lines: QuoteLine[];
  disabled: boolean;
  embedded?: boolean;
}) {
  const mode = pricing.lineMode ?? 'single';
  const manual = mode === 'manual';

  /** Entering manual mode seeds current visible amounts once and preserves earlier edits. */
  const selectMode = (nextMode: QuoteLineMode) =>
    setPricing((current) =>
      nextMode === 'manual' &&
      !current.manualLines?.length &&
      lines.length > MAX_QUOTE_LINES
        ? current
        : {
            ...current,
            lineMode: nextMode,
            ...(nextMode === 'manual' && !current.manualLines?.length
              ? { manualLines: editableLines(lines) }
              : {}),
          },
    );

  /** Patches one commercial input without changing cost scope or master data. */
  const updateLine = (id: string, patch: Partial<ManualQuoteLine>) =>
    setPricing((current) => ({
      ...current,
      manualLines: (current.manualLines ?? []).map((line) =>
        line.id === id ? { ...line, ...patch } : line,
      ),
    }));

  /** Adds a local draft with an explicit unit and a zero selling price. */
  const addLine = () =>
    setPricing((current) => ({
      ...current,
      manualLines: [
        ...(current.manualLines ?? []),
        {
          id: `quote-line-${globalThis.crypto.randomUUID()}`,
          description: '',
          quantity: 1,
          unit: 'lot',
          unitPrice: 0,
        },
      ],
    }));

  /** Removes only the chosen manual quotation entry. */
  const removeLine = (id: string) =>
    setPricing((current) => ({
      ...current,
      manualLines: (current.manualLines ?? []).filter((line) => line.id !== id),
    }));

  return (
    <section
      className={embedded ? 'border-y' : 'wb-panel'}
      aria-label="Quotation details"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="mr-auto text-sm font-semibold">
          Quotation details{' '}
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            报价明细
          </span>
        </h2>
        <Select
          value={mode}
          onValueChange={(value) => selectMode(value as QuoteLineMode)}
          disabled={disabled}
        >
          <SelectTrigger
            aria-label="Quotation detail mode"
            className="h-8 w-[230px]"
          >
            <SelectValue>
              {MODES.find((entry) => entry.value === mode)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MODES.map((entry) => (
              <SelectItem
                key={entry.value}
                value={entry.value}
                disabled={
                  entry.value === 'manual' &&
                  !pricing.manualLines?.length &&
                  lines.length > MAX_QUOTE_LINES
                }
              >
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {manual && (
          <Button
            variant="outline"
            size="sm"
            onClick={addLine}
            disabled={disabled || lines.length >= MAX_QUOTE_LINES}
          >
            <Plus /> Add line
          </Button>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </span>
      </div>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {mode === 'single'
          ? 'One service-price line; overall discount and GST are shown separately. · 整单服务总价显示一行，折扣及税额单独列出。'
          : manual
            ? 'Quantity × unit price sets the service price. Overall discount and GST are applied afterwards. · 数量 × 单价汇总为服务报价，再计算整单折扣与税额。'
            : 'The current service price is allocated by cost weight. Each Scope/item is quoted as one lot, including its share of project risk. · 按成本权重分配现有总报价（含风险），每个 Scope/条目作为一项服务；可切换逐条定价编辑数量及单价。'}
      </p>
      <div className="max-h-[320px] overflow-auto">
        <Table className="min-w-[620px]">
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-24 text-right">Quantity</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-32 text-right">Unit price</TableHead>
              <TableHead className="w-32 text-right">Amount</TableHead>
              {manual && (
                <TableHead className="w-10">
                  <span className="sr-only">Remove</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={line.id}>
                <TableCell className="text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell>
                  {manual ? (
                    <Input
                      aria-label={`Line ${index + 1} description`}
                      value={line.description}
                      maxLength={4000}
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, { description: event.target.value })
                      }
                      className="h-8 min-w-44"
                    />
                  ) : (
                    <span className="whitespace-pre-wrap break-words">
                      {line.description}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right financial-numeral">
                  {manual ? (
                    <Input
                      aria-label={`Line ${index + 1} quantity`}
                      type="number"
                      min="0.0001"
                      max="1000000"
                      step="0.0001"
                      value={line.quantity}
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, {
                          quantity: Number(event.target.value),
                        })
                      }
                      className="h-8 text-right"
                    />
                  ) : (
                    line.quantity
                  )}
                </TableCell>
                <TableCell>
                  {manual ? (
                    <Input
                      aria-label={`Line ${index + 1} unit`}
                      value={line.unit}
                      maxLength={40}
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, { unit: event.target.value })
                      }
                      className="h-8"
                    />
                  ) : (
                    line.unit
                  )}
                </TableCell>
                <TableCell className="text-right financial-numeral">
                  {manual ? (
                    <Input
                      aria-label={`Line ${index + 1} unit price`}
                      type="number"
                      min="0"
                      max="1000000000000"
                      step="0.0001"
                      value={line.unitPrice}
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, {
                          unitPrice: Number(event.target.value),
                        })
                      }
                      className="h-8 text-right"
                    />
                  ) : (
                    formatSgd(line.unitPrice)
                  )}
                </TableCell>
                <TableCell className="text-right financial-numeral">
                  {formatSgd(line.amount)}
                </TableCell>
                {manual && (
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove quotation line ${index + 1}`}
                      disabled={disabled}
                      onClick={() => removeLine(line.id)}
                      className="h-7 w-7"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!lines.length && (
          <p className="p-3 text-xs text-muted-foreground">
            Add a quotation line to set its description, quantity and selling
            price.
          </p>
        )}
      </div>
    </section>
  );
}
