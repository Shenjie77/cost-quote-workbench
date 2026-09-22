/** Compact quotation controls for target allocation, fixed prices and customer-facing details. */
import { Plus, RotateCw, Trash2 } from 'lucide-react';
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
import { calculateManualQuoteLines, MAX_QUOTE_LINES } from './quote-lines';
import { allocateQuoteTarget } from './target-allocation';
import { QuoteNumberInput } from './quote-number-input';

const MODES: Array<{ value: QuoteLineMode; label: string }> = [
  { value: 'single', label: 'Single line · 单行总价' },
  { value: 'scope', label: 'By Scope · 按 Scope 汇总' },
  { value: 'item', label: 'By cost item · 按成本条目' },
  { value: 'manual', label: 'Target pricing · 逐条定价' },
];

/** Removes calculated fields when copying generated lines into editable customer prices. */
function editableLines(lines: QuoteLine[]): ManualQuoteLine[] {
  return lines.map(({ amount: _amount, ...line }) => ({ ...line }));
}

/** Seed relative weights once so repeated target changes do not compound rounding into the proportions. */
function withAllocationWeights(lines: ManualQuoteLine[]): ManualQuoteLine[] {
  if (
    !lines.length ||
    lines.every((line) => line.allocationWeight !== undefined)
  )
    return lines;
  const { lines: calculated, total } = calculateManualQuoteLines(lines);
  const hasWeights = lines.some((line) => line.allocationWeight !== undefined);
  const weights = lines.map(
    (line, index) =>
      line.allocationWeight ??
      (hasWeights
        ? calculated[index].amount
        : total > 0
          ? (calculated[index].amount / total) * 100
          : 1),
  );
  // Mixed legacy/API rows use amount-based implicit weights; scale all together only to fit the saved range.
  const scale = Math.max(1, Math.max(...weights) / 1e6);
  return lines.map((line, index) => ({
    ...line,
    allocationWeight: weights[index] / scale,
  }));
}

/** Apply a target atomically; an invalid draft remains editable and is blocked by quote output validation. */
function rebalancePricing(pricing: PricingSettings): PricingSettings {
  if (pricing.manualTargetPrice === undefined) return pricing;
  const candidate = withAllocationWeights(pricing.manualLines ?? []);
  const allocation = allocateQuoteTarget(candidate, pricing.manualTargetPrice);
  return { ...pricing, manualLines: allocation.lines };
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
  const manualLines = pricing.manualLines ?? [];
  const currentTotal = manual
    ? calculateManualQuoteLines(manualLines).total
    : lines.reduce((sum, line) => sum + line.amount, 0);
  const target = pricing.manualTargetPrice;
  const difference =
    target === undefined
      ? 0
      : (Math.round(target * 100) - Math.round(currentTotal * 100)) / 100;
  const allocationErrors =
    manual && target !== undefined
      ? allocateQuoteTarget(manualLines, target).errors
      : [];
  const displayWeights = withAllocationWeights(manualLines);
  const metadata = new Map(displayWeights.map((line) => [line.id, line]));

  /** Entering manual mode seeds current visible amounts once and preserves earlier edits. */
  const selectMode = (nextMode: QuoteLineMode) => {
    if (disabled) return;
    setPricing((current) => {
      if (nextMode !== 'manual' || current.manualLines?.length)
        return { ...current, lineMode: nextMode };
      if (lines.length > MAX_QUOTE_LINES) return current;
      const seeded = withAllocationWeights(editableLines(lines));
      return {
        ...current,
        lineMode: nextMode,
        manualLines: seeded,
        manualTargetPrice: calculateManualQuoteLines(seeded).total,
      };
    });
  };

  /** Explicitly activating a target keeps legacy quotations unchanged until the user opts in. */
  const setTarget = (value: number) => {
    if (disabled) return;
    setPricing((current) =>
      rebalancePricing({ ...current, manualTargetPrice: value }),
    );
  };

  /** Patches one commercial input without changing cost scope or master data. */
  const updateLine = (id: string, patch: Partial<ManualQuoteLine>) => {
    if (disabled) return;
    setPricing((current) =>
      rebalancePricing({
        ...current,
        manualLines: (patch.allocationWeight !== undefined
          ? withAllocationWeights(current.manualLines ?? [])
          : (current.manualLines ?? [])
        ).map((line) => (line.id === id ? { ...line, ...patch } : line)),
      }),
    );
  };

  /** Adds a local draft with an explicit unit and a zero selling price. */
  const addLine = () => {
    if (disabled) return;
    setPricing((current) =>
      (current.manualLines?.length ?? 0) >= MAX_QUOTE_LINES
        ? current
        : {
            ...current,
            manualLines: [
              ...withAllocationWeights(current.manualLines ?? []),
              {
                id: `quote-line-${globalThis.crypto.randomUUID()}`,
                description: '',
                quantity: 1,
                unit: 'lot',
                unitPrice: 0,
                allocationWeight: 1,
              },
            ],
          },
    );
  };

  /** Removes only the chosen manual quotation entry. */
  const removeLine = (id: string) => {
    if (disabled) return;
    setPricing((current) =>
      rebalancePricing({
        ...current,
        manualLines: (current.manualLines ?? []).filter(
          (line) => line.id !== id,
        ),
      }),
    );
  };

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
      {manual && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <span>
              Target total{' '}
              <span className="font-normal text-muted-foreground">
                折扣及税前
              </span>
            </span>
            <QuoteNumberInput
              key={`target-${target ?? currentTotal}`}
              label="Target total before discount and tax"
              value={target ?? currentTotal}
              decimals={2}
              disabled={disabled}
              onCommit={setTarget}
              className="h-8 w-36 text-right"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !lines.length}
              onClick={() => setTarget(target ?? currentTotal)}
            >
              <RotateCw className="size-3.5" /> Rebalance · 按比例分配
            </Button>
          </div>
          <div
            className="ml-auto flex flex-wrap items-center gap-4 text-xs tabular-nums"
            aria-live="polite"
          >
            <span className="text-muted-foreground">
              Allocated{' '}
              <strong className="ml-1 font-semibold text-foreground">
                {formatSgd(currentTotal)}
              </strong>
            </span>
            <span
              className={
                difference
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground'
              }
            >
              {target === undefined
                ? 'Target not set · 尚未设置目标'
                : difference
                  ? `Remaining · 差额 ${formatSgd(difference)}`
                  : 'Matched · 已达目标'}
            </span>
          </div>
        </div>
      )}
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {mode === 'single'
          ? 'One service-price line; overall discount and GST are shown separately. · 整单服务总价显示一行，折扣及税额单独列出。'
          : manual
            ? 'Set a target, then adjust relative ratios (e.g. 2:1). Editing a unit price fixes that line; the remaining target is shared by unlocked lines. · 设置目标后按比例分配；修改单价会固定该行，其余条目自动分配剩余金额。'
            : 'The current service price is allocated by cost weight. Each Scope/item is quoted as one lot, including its share of project risk. · 按成本权重分配现有总报价（含风险），每个 Scope/条目作为一项服务；可切换逐条定价编辑数量及单价。'}
      </p>
      {!!allocationErrors.length && (
        <p
          role="alert"
          className="border-t border-destructive/20 px-3 py-2 text-xs text-destructive"
        >
          {allocationErrors[0]}
        </p>
      )}
      <div className="max-h-[320px] overflow-auto">
        <Table className={manual ? 'min-w-[780px]' : 'min-w-[620px]'}>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-24 text-right">Quantity</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              {manual && (
                <TableHead className="w-24 text-right">Ratio 比例</TableHead>
              )}
              <TableHead className="w-32 text-right">Unit price</TableHead>
              {manual && (
                <TableHead className="w-14 text-center">Fixed</TableHead>
              )}
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
                    <QuoteNumberInput
                      key={`quantity-${line.quantity}`}
                      label={`Line ${index + 1} quantity`}
                      min={0.0001}
                      max={1000000}
                      value={line.quantity}
                      disabled={disabled}
                      onCommit={(quantity) => updateLine(line.id, { quantity })}
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
                {manual && (
                  <TableCell className="text-right">
                    <QuoteNumberInput
                      key={`weight-${metadata.get(line.id)?.allocationWeight ?? 0}`}
                      label={`Line ${index + 1} allocation ratio`}
                      value={metadata.get(line.id)?.allocationWeight ?? 0}
                      max={1e6}
                      disabled={
                        disabled || metadata.get(line.id)?.priceFixed === true
                      }
                      onCommit={(allocationWeight) =>
                        updateLine(line.id, {
                          allocationWeight,
                          priceFixed: false,
                        })
                      }
                    />
                  </TableCell>
                )}
                <TableCell className="text-right financial-numeral">
                  {manual ? (
                    <QuoteNumberInput
                      key={`price-${line.unitPrice}`}
                      label={`Line ${index + 1} unit price`}
                      value={line.unitPrice}
                      disabled={disabled}
                      onCommit={(unitPrice) =>
                        updateLine(line.id, { unitPrice, priceFixed: true })
                      }
                    />
                  ) : (
                    formatSgd(line.unitPrice)
                  )}
                </TableCell>
                {manual && (
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`Fix price for line ${index + 1}`}
                      title="Keep this unit price when the target or other lines change"
                      checked={metadata.get(line.id)?.priceFixed === true}
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, {
                          priceFixed: event.target.checked,
                        })
                      }
                      className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                    />
                  </TableCell>
                )}
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
