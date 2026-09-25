/** Internal line pricing grid; customer workbooks receive only commercial line fields. */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { assignQuoteScopes } from './scope-allocation';
import { QuoteScopeDialog } from './quote-scope-dialog';
import { QuoteDescriptionDialog } from './quote-description-dialog';
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
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { roundMoney } from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';
import type { PricingSettings } from './domain';
import type {
  ManualQuoteLine,
  QuoteLine,
  QuoteLineMode,
} from './excel-template-types';
import {
  buildQuoteLines,
  calculateManualQuoteLines,
  MAX_QUOTE_LINES,
  quoteScopeCosts,
} from './quote-lines';
import { allocateQuotePercentages } from './percentage-allocation';
import { allocateLinePricing, lineCostAmounts } from './line-pricing';
import { QuoteNumberInput } from './quote-number-input';

const MODES: Array<{ value: QuoteLineMode; label: string }> = [
  { value: 'single', label: 'Single line · 单行总价' },
  { value: 'scope', label: 'By Scope · 按 Scope 汇总' },
  { value: 'item', label: 'By cost item · 按成本条目' },
  { value: 'manual', label: 'Custom lines · 自定义明细' },
];

/** Calculate each line's sales GP using the same weighted BU share as the complete quote. */
function salesGp(cost: number, amount: number, share: number): number {
  const shareAmount = roundMoney((amount * share) / 100);
  const profit = roundMoney(amount - cost - shareAmount);
  return amount > 0 ? (profit / amount) * 100 : 0;
}

/** Price and GP edits change the total; quote-share edits redistribute the current total only. */
export function QuoteLinesEditor({
  pricing,
  setPricing,
  lines,
  allocatedLines,
  disabled,
  embedded = false,
  costSnapshot,
  totalCost = 0,
  weightedProfitShareRate = 0,
}: {
  pricing: PricingSettings;
  setPricing: React.Dispatch<React.SetStateAction<PricingSettings>>;
  lines: QuoteLine[];
  /** Retained for old callers; line pricing no longer uses an overall target price. */
  gpTargetPrice?: number;
  allocatedLines?: ManualQuoteLine[];
  disabled: boolean;
  embedded?: boolean;
  costSnapshot?: CostExportSnapshot;
  totalCost?: number;
  weightedProfitShareRate?: number;
}) {
  const [allocationError, setAllocationError] = useState('');
  const independent = pricing.manualPricingBasis === 'line-gp';
  const mode = independent
    ? (pricing.lineSourceMode ?? 'manual')
    : (pricing.lineMode ?? 'single');
  const editable = pricing.lineMode === 'manual';
  const effective = allocatedLines ?? pricing.manualLines ?? [];
  const metadata = new Map(effective.map((line) => [line.id, line]));
  const currentTotal = roundMoney(
    lines.reduce((sum, line) => sum + line.amount, 0),
  );
  const generatedCosts =
    costSnapshot && pricing.lineMode !== 'manual'
      ? buildQuoteLines(costSnapshot, pricing.lineMode, totalCost)
      : undefined;
  // Cost weights are captured independently of prices. Changing revenue shares never changes these weights.
  const draftLines: ManualQuoteLine[] = lines.map(
    ({ amount, ...line }, index) => ({
      ...line,
      ...(editable ? metadata.get(line.id) : {}),
      costWeight: editable
        ? (metadata.get(line.id)?.costWeight ?? amount)
        : (generatedCosts?.[index]?.amount ?? amount),
    }),
  );
  const costs = lineCostAmounts(draftLines, totalCost);
  const scopeOptions = costSnapshot
    ? quoteScopeCosts(costSnapshot, totalCost)
    : [];
  const quoteShare = (line: QuoteLine) =>
    currentTotal > 0 ? (line.amount / currentTotal) * 100 : 0;

  /** Persist internal pricing intent and detached costs; no global target can override the line total. */
  const saveLines = (
    next: ManualQuoteLine[],
    sourceMode: QuoteLineMode = mode,
  ) => {
    if (disabled) return;
    const calculated = allocateLinePricing(
      next,
      totalCost,
      weightedProfitShareRate,
    );
    setPricing((current) => {
      const { manualTargetPrice: _target, ...rest } = current;
      return {
        ...rest,
        lineMode: 'manual',
        manualPricingBasis: 'line-gp',
        lineSourceMode: sourceMode,
        manualLines: calculated.lines,
        // Preserve the outgoing custom draft even for legacy workspaces without a cache.
        customLinesDraft:
          sourceMode === 'manual'
            ? calculated.lines
            : mode === 'manual'
              ? draftLines
              : current.customLinesDraft,
      };
    });
  };

  /** Regroup cost-backed rows explicitly, starting every new row at 50% GP and matching cost/quote weights. */
  const selectMode = (nextMode: QuoteLineMode) => {
    if (disabled) return;
    if (nextMode === mode) return;
    setAllocationError('');
    if (nextMode === 'manual') {
      saveLines(pricing.customLinesDraft ?? draftLines, nextMode);
      return;
    }
    const source = costSnapshot
      ? buildQuoteLines(costSnapshot, nextMode, totalCost)
      : lines;
    if (source.length > MAX_QUOTE_LINES) return;
    saveLines(
      source.map(({ amount, ...line }) => ({
        ...line,
        costWeight: amount,
        targetGrossMargin: 50,
        priceFixed: false,
        allocationFixed: false,
      })),
      nextMode,
    );
  };

  /** Update only the selected line; the domain derives its price or GP and sums all row amounts. */
  const updateLine = (id: string, patch: Partial<ManualQuoteLine>) => {
    if (disabled) return;
    setAllocationError('');
    saveLines(
      draftLines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  };

  /** Set a custom cost percentage, preserving the other rows' relative cost shares and the complete project cost. */
  const updateCostWeight = (id: string, percentage: number) => {
    if (disabled || mode !== 'manual' || draftLines.length < 2) return;
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)
      return;
    const otherWeight = draftLines.reduce(
      (sum, line) => sum + (line.id === id ? 0 : (line.costWeight ?? 0)),
      0,
    );
    setAllocationError('');
    saveLines(
      draftLines.map((line) => ({
        ...line,
        costScopeKeys: undefined,
        costWeight:
          line.id === id
            ? percentage
            : (100 - percentage) *
              (otherWeight > 0
                ? (line.costWeight ?? 0) / otherWeight
                : 1 / (draftLines.length - 1)),
      })),
    );
  };

  /** Adjust a selling share against the current total, retaining locks and equally sharing the remainder. */
  const updateQuoteShare = (id: string, allocationWeight: number) => {
    if (disabled) return;
    const requested = draftLines.map((line) => {
      // Old manual rows used unrestricted relative weights; only explicit percentage locks retain that field.
      const normalized = line.allocationFixed
        ? line
        : {
            ...line,
            allocationWeight:
              currentTotal > 0
                ? (roundMoney(line.quantity * line.unitPrice) / currentTotal) *
                  100
                : 0,
          };
      return line.id === id
        ? {
            ...normalized,
            allocationWeight,
            allocationFixed: true,
            priceFixed: false,
          }
        : normalized;
    });
    const allocation = allocateQuotePercentages(requested, currentTotal);
    if (allocation.errors.length) {
      setAllocationError(allocation.errors[0]);
      return;
    }
    setAllocationError('');
    // These amounts now express the chosen quote shares; their displayed GP is derived, not reapplied.
    saveLines(
      allocation.lines.map(({ targetGrossMargin: _gp, ...line }) => line),
    );
  };

  /** A custom line has no source cost; entering a price must not steal cost from existing cost-backed rows. */
  const addLine = () => {
    const custom =
      mode === 'manual' ? draftLines : (pricing.customLinesDraft ?? draftLines);
    if (disabled || custom.length >= MAX_QUOTE_LINES) return;
    setAllocationError('');
    saveLines(
      [
        ...custom,
        {
          id: `quote-line-${globalThis.crypto.randomUUID()}`,
          description: '',
          quantity: 1,
          unit: 'lot',
          unitPrice: 0,
          costWeight: 0,
          targetGrossMargin: 50,
          priceFixed: false,
          allocationFixed: false,
        },
      ],
      'manual',
    );
  };

  /** Keep the project cost reconciled across remaining rows after explicitly removing a quotation item. */
  const removeLine = (id: string) => {
    if (disabled) return;
    setAllocationError('');
    saveLines(
      draftLines
        .filter((line) => line.id !== id)
        .map((line) => ({ ...line, costScopeKeys: undefined })),
      'manual',
    );
  };

  const lineErrors = independent
    ? allocateLinePricing(draftLines, totalCost, weightedProfitShareRate).errors
    : calculateManualQuoteLines(draftLines).errors;

  return (
    <section
      className={embedded ? 'border-y' : 'wb-panel'}
      aria-label="Quotation details"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="mr-auto text-sm font-semibold">
          Quotation details{' '}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
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
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={addLine}
          disabled={disabled || lines.length >= MAX_QUOTE_LINES}
        >
          <Plus /> Add line
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </span>
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Weight = cost share. Quote share starts at cost weight and can be
        adjusted. Line GP and Price determine the total; GP includes BU profit
        share, before discount.
        <span className="block">
          Weight 为成本占比，Custom lines
          可调整，其他行按原成本比例分摊余额；报价比例可调，未锁定行均分剩余比例。逐行定价后汇总总价；GP
          含分成、未扣整单折扣。点击 Custom lines 的 Cost 可按 Scope 分配；Cost
          含分摊风险。手动调整 Weight 后清除 Scope
          选择，其他行按比例分摊剩余成本。
        </span>
      </p>
      {(allocationError || lineErrors[0]) && (
        <p
          role="alert"
          className="border-t border-destructive/20 px-3 py-2 text-xs text-destructive"
        >
          {allocationError || lineErrors[0]}
        </p>
      )}
      {/* All internal pricing controls share one grid; customer previews and files omit these internal columns. */}
      <Table
        containerClassName="max-h-[360px]"
        aria-label="Quotation details grid"
        className="min-w-[1120px] text-xs [&_td]:p-1.5"
      >
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-20 text-right">Quantity</TableHead>
            <TableHead className="w-16">Unit</TableHead>
            <TableHead className="w-28 text-right">Cost</TableHead>
            <TableHead
              className="w-20 text-right"
              title="Allocated cost / total project cost"
            >
              Weight %
            </TableHead>
            <TableHead className="w-24 text-right">Quote share %</TableHead>
            <TableHead className="w-24 text-right">Target GP %</TableHead>
            <TableHead
              className="w-28 text-right"
              title="Selling price per unit"
            >
              Price / Unit
            </TableHead>
            <TableHead className="w-12 text-center">Lock</TableHead>
            <TableHead className="w-28 text-right">Amount</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, index) => {
            const saved = metadata.get(line.id);
            const actualGp = salesGp(
              costs[index] ?? 0,
              line.amount,
              weightedProfitShareRate,
            );
            const targetGp = !editable
              ? pricing.targetGrossMargin
              : independent &&
                  saved?.targetGrossMargin !== undefined &&
                  !saved.priceFixed
                ? saved.targetGrossMargin
                : actualGp;
            return (
              <TableRow key={line.id}>
                <TableCell className="text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell>
                  <div className="flex min-w-40 items-start gap-1">
                    {editable ? (
                      <Textarea
                        aria-label={`Line ${index + 1} description`}
                        value={line.description}
                        maxLength={4000}
                        disabled={disabled}
                        onChange={(event) =>
                          updateLine(line.id, {
                            description: event.target.value,
                          })
                        }
                        rows={3}
                        className="min-h-8 max-h-[calc(3lh+1rem+2px)] min-w-0 resize-none overflow-hidden rounded-none border-transparent bg-transparent py-2 leading-5 shadow-none [overflow-wrap:anywhere]"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 line-clamp-3 whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]">
                        {line.description}
                      </span>
                    )}
                    <QuoteDescriptionDialog
                      value={line.description}
                      lineNumber={index + 1}
                      editable={editable}
                      disabled={disabled}
                      onSave={(description) =>
                        updateLine(line.id, { description })
                      }
                    />
                  </div>
                </TableCell>
                <TableCell className="financial-numeral text-right">
                  {editable ? (
                    <QuoteNumberInput
                      key={`qty-${line.quantity}`}
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
                  {editable ? (
                    <Input
                      aria-label={`Line ${index + 1} unit`}
                      value={line.unit}
                      maxLength={40}
                      disabled={disabled}
                      onChange={(event) =>
                        updateLine(line.id, { unit: event.target.value })
                      }
                      className="h-8 rounded-none border-transparent bg-transparent shadow-none"
                    />
                  ) : (
                    line.unit
                  )}
                </TableCell>
                <TableCell className="financial-numeral bg-muted/30 text-right">
                  {mode === 'manual' && costSnapshot ? (
                    <QuoteScopeDialog
                      lineNumber={index + 1}
                      amount={costs[index] ?? 0}
                      scopes={scopeOptions}
                      selectedKeys={saved?.costScopeKeys ?? []}
                      disabled={disabled || totalCost <= 0}
                      onSave={(keys) => {
                        const next = assignQuoteScopes(
                          draftLines,
                          line.id,
                          keys,
                          scopeOptions,
                          totalCost,
                          `quote-line-${globalThis.crypto.randomUUID()}`,
                        );
                        if (next.length > MAX_QUOTE_LINES) {
                          setAllocationError(
                            'Too many lines; leave one row available for remaining costs.',
                          );
                          return;
                        }
                        setAllocationError('');
                        saveLines(next);
                      }}
                    />
                  ) : (
                    formatSgd(costs[index] ?? 0)
                  )}
                </TableCell>
                <TableCell className="financial-numeral bg-muted/30 text-right">
                  {mode === 'manual' ? (
                    <QuoteNumberInput
                      key={`cost-weight-${saved?.costWeight}-${costs[index]}`}
                      label={`Line ${index + 1} cost weight`}
                      percentage
                      value={
                        totalCost > 0
                          ? ((costs[index] ?? 0) / totalCost) * 100
                          : (lineCostAmounts(draftLines, 100)[index] ?? 0)
                      }
                      max={100}
                      disabled={disabled || lines.length < 2}
                      onCommit={(weight) => updateCostWeight(line.id, weight)}
                    />
                  ) : (
                    <>
                      {totalCost > 0
                        ? (((costs[index] ?? 0) / totalCost) * 100).toFixed(2)
                        : '0.00'}
                      %
                    </>
                  )}
                </TableCell>
                <TableCell>
                  <QuoteNumberInput
                    key={`share-${quoteShare(line)}`}
                    label={`Line ${index + 1} quotation percentage`}
                    percentage
                    value={quoteShare(line)}
                    max={100}
                    commitUnchanged
                    disabled={disabled}
                    onCommit={(weight) => updateQuoteShare(line.id, weight)}
                  />
                </TableCell>
                <TableCell>
                  <QuoteNumberInput
                    key={`gp-${targetGp}`}
                    label={`Line ${index + 1} target GP`}
                    percentage
                    value={targetGp}
                    max={95}
                    commitUnchanged
                    disabled={disabled}
                    onCommit={(targetGrossMargin) =>
                      updateLine(line.id, {
                        targetGrossMargin,
                        priceFixed: false,
                        allocationFixed: false,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <QuoteNumberInput
                    key={`price-${line.unitPrice}`}
                    label={`Line ${index + 1} unit price`}
                    value={line.unitPrice}
                    commitUnchanged
                    disabled={disabled}
                    onCommit={(unitPrice) =>
                      updateLine(line.id, {
                        unitPrice,
                        targetGrossMargin: undefined,
                        priceFixed: true,
                        allocationFixed: false,
                      })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`Lock allocation for line ${index + 1}`}
                    title="Preserve the locked price or quote share when adjusting quotation proportions"
                    checked={
                      saved?.priceFixed === true ||
                      saved?.allocationFixed === true
                    }
                    disabled={disabled}
                    onChange={(event) =>
                      updateLine(line.id, {
                        priceFixed: event.target.checked,
                        allocationFixed: false,
                      })
                    }
                    className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                  />
                </TableCell>
                <TableCell className="financial-numeral text-right font-medium">
                  {formatSgd(line.amount)}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove quotation line ${index + 1}`}
                    disabled={disabled}
                    onClick={() => removeLine(line.id)}
                    className="h-8 w-8"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div
        className="flex flex-wrap justify-end gap-5 border-t bg-muted px-3 py-2 text-xs financial-numeral"
        aria-live="polite"
      >
        <span>
          Total Cost <strong>{formatSgd(totalCost)}</strong>
        </span>
        <span>
          Line Total <strong>{formatSgd(currentTotal)}</strong>
        </span>
      </div>
      {!lines.length && (
        <p className="p-3 text-xs text-muted-foreground">
          Add a quotation line to set its description, quantity and selling
          price.
        </p>
      )}
    </section>
  );
}
