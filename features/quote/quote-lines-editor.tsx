/** Compact quotation controls for target allocation, fixed prices and customer-facing details. */
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
import { calculateManualQuoteLines, MAX_QUOTE_LINES } from './quote-lines';
import { allocateQuotePercentages } from './percentage-allocation';
import { applyGpAllocation, gpAllocationLines } from './manual-pricing';
import { QuoteNumberInput } from './quote-number-input';

const MODES: Array<{ value: QuoteLineMode; label: string }> = [
  { value: 'single', label: 'Single line · 单行总价' },
  { value: 'scope', label: 'By Scope · 按 Scope 汇总' },
  { value: 'item', label: 'By cost item · 按成本条目' },
  { value: 'manual', label: 'Line allocation · 逐条定价' },
];

/** Removes calculated fields when copying generated lines into editable customer prices. */
function editableLines(lines: QuoteLine[]): ManualQuoteLine[] {
  return lines.map(({ amount: _amount, ...line }) => ({ ...line }));
}

/** Keeps percentage, price and locking controls inside one editable quotation grid. */
export function QuoteLinesEditor({
  pricing,
  setPricing,
  lines,
  gpTargetPrice,
  allocatedLines,
  disabled,
  embedded = false,
}: {
  pricing: PricingSettings;
  setPricing: React.Dispatch<React.SetStateAction<PricingSettings>>;
  lines: QuoteLine[];
  gpTargetPrice: number;
  allocatedLines?: ManualQuoteLine[];
  disabled: boolean;
  embedded?: boolean;
}) {
  const mode = pricing.lineMode ?? 'single';
  const manual = mode === 'manual';
  const gpBased = pricing.manualPricingBasis === 'gp';
  const effectiveLines = allocatedLines ?? pricing.manualLines ?? [];
  const currentTotal = calculateManualQuoteLines(effectiveLines).total;
  const difference =
    (Math.round(gpTargetPrice * 100) - Math.round(currentTotal * 100)) / 100;
  const allocationErrors =
    manual && gpBased
      ? allocateQuotePercentages(effectiveLines, gpTargetPrice).errors
      : [];
  const metadata = new Map(effectiveLines.map((line) => [line.id, line]));

  /** Display saved legacy amounts as percentages without altering their values on page load. */
  const percentage = (line: QuoteLine) =>
    gpBased
      ? (metadata.get(line.id)?.allocationWeight ?? 0)
      : currentTotal > 0
        ? (line.amount / currentTotal) * 100
        : 0;

  /** Selecting manual pricing explicitly switches to the original GP target and equal unlocked shares. */
  const selectMode = (nextMode: QuoteLineMode) => {
    if (disabled) return;
    setPricing((current) => {
      if (nextMode !== 'manual') return { ...current, lineMode: nextMode };
      const source = current.manualLines?.length
        ? current.manualLines
        : editableLines(lines);
      if (source.length > MAX_QUOTE_LINES) return current;
      return applyGpAllocation(
        current,
        gpTargetPrice,
        gpAllocationLines(current, source),
      );
    });
  };

  /** Text-only edits preserve legacy commercial prices; numerical edits activate the GP allocation rules. */
  const updateLine = (
    id: string,
    patch: Partial<ManualQuoteLine>,
    allocate = true,
  ) => {
    if (disabled) return;
    setPricing((current) => {
      const source = allocate
        ? gpAllocationLines(current, effectiveLines)
        : (current.manualLines ?? []);
      const nextLines = source.map((line) =>
        line.id === id ? { ...line, ...patch } : line,
      );
      return allocate || current.manualPricingBasis === 'gp'
        ? applyGpAllocation(current, gpTargetPrice, nextLines)
        : { ...current, manualLines: nextLines };
    });
  };

  /** Adding a draft gives it an equal share once its required description has been supplied. */
  const addLine = () => {
    if (disabled) return;
    setPricing((current) => {
      if ((current.manualLines?.length ?? 0) >= MAX_QUOTE_LINES) return current;
      return applyGpAllocation(current, gpTargetPrice, [
        ...gpAllocationLines(current, effectiveLines),
        {
          id: `quote-line-${globalThis.crypto.randomUUID()}`,
          description: '',
          quantity: 1,
          unit: 'lot',
          unitPrice: 0,
          allocationFixed: false,
          priceFixed: false,
        },
      ]);
    });
  };

  /** Removing a line redistributes only the residual share; all remaining locks keep their meaning. */
  const removeLine = (id: string) => {
    if (disabled) return;
    setPricing((current) =>
      applyGpAllocation(
        current,
        gpTargetPrice,
        gpAllocationLines(current, effectiveLines).filter(
          (line) => line.id !== id,
        ),
      ),
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
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {mode === 'single'
          ? 'One service-price line; overall discount and GST are shown separately. · 整单服务总价显示一行，折扣及税额单独列出。'
          : manual
            ? 'The target follows GP above. Editing a percentage or unit price locks that value; unlocked rows equally share the remainder. · 总价沿用上方 GP；修改比例或单价会锁定该值，其余未锁定行均分剩余比例。'
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
      {manual && !gpBased && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          Saved prices retained. Editing GP or line allocations applies GP
          pricing. · 已保存单价保留，修改 GP 或分配后采用新规则。
        </p>
      )}
      <div className="max-h-[320px] overflow-auto">
        <Table
          className={`${manual ? 'min-w-[840px]' : 'min-w-[620px]'} [&_th]:border-r [&_th]:border-border/60 [&_th:last-child]:border-r-0 [&_td]:border-r [&_td]:border-border [&_td:last-child]:border-r-0 [&_td]:p-1.5 text-xs`}
        >
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-24 text-right">Quantity</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              {manual && (
                <TableHead className="w-24 text-right">Share 比例 %</TableHead>
              )}
              <TableHead className="w-32 text-right">Unit price</TableHead>
              {manual && (
                <TableHead className="w-14 text-center">Lock 锁定</TableHead>
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
                        updateLine(
                          line.id,
                          { description: event.target.value },
                          false,
                        )
                      }
                      className="h-8 min-w-44 rounded-none border-transparent bg-transparent shadow-none focus-visible:border-ring"
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
                        updateLine(line.id, { unit: event.target.value }, false)
                      }
                      className="h-8 rounded-none border-transparent bg-transparent shadow-none focus-visible:border-ring"
                    />
                  ) : (
                    line.unit
                  )}
                </TableCell>
                {manual && (
                  <TableCell className="text-right">
                    <QuoteNumberInput
                      key={`weight-${percentage(line)}`}
                      label={`Line ${index + 1} allocation percentage`}
                      commitUnchanged
                      value={percentage(line)}
                      max={100}
                      disabled={disabled}
                      onCommit={(allocationWeight) =>
                        updateLine(line.id, {
                          allocationWeight,
                          allocationFixed: true,
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
                      commitUnchanged
                      value={line.unitPrice}
                      disabled={disabled}
                      onCommit={(unitPrice) =>
                        updateLine(line.id, {
                          unitPrice,
                          priceFixed: true,
                          allocationFixed: false,
                        })
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
                      aria-label={`Lock allocation for line ${index + 1}`}
                      title={
                        metadata.get(line.id)?.priceFixed
                          ? 'Unit price locked · 单价已锁定'
                          : 'Percentage lock · 比例锁定'
                      }
                      checked={
                        metadata.get(line.id)?.priceFixed === true ||
                        metadata.get(line.id)?.allocationFixed === true
                      }
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, {
                          priceFixed: false,
                          allocationFixed: event.target.checked,
                          allocationWeight: percentage(line),
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
        {manual && gpBased && (
          <div
            className="sticky bottom-0 flex flex-wrap justify-end gap-5 border-t bg-muted px-3 py-2 text-xs financial-numeral"
            aria-live="polite"
          >
            <span>
              Allocated 合计 <strong>{formatSgd(currentTotal)}</strong>
            </span>
            <span
              className={
                difference ? 'text-destructive' : 'text-muted-foreground'
              }
            >
              {difference
                ? `Remaining 差额 ${formatSgd(difference)}`
                : 'Matched · 已达目标'}
            </span>
          </div>
        )}
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
