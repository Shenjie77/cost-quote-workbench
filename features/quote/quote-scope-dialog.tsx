import { Surface, Text } from '@/components/ui/presentation';
import { CheckInput } from '@/components/ui/check-input';
/** Select live Scope shares and a separate Risk Cost share for one quotation line. */
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatSgd } from '@/lib/formatters';
import { allocateScopeRisk, type ScopeAllocation } from './scope-allocation';

/** Draft percentages remain local until Apply; reopening restores the persisted source allocation rules. */
export function QuoteScopeDialog({
  lineNumber,
  amount,
  scopes,
  selectedKeys,
  allocations,
  riskAmount = 0,
  riskScopeShares,
  disabled,
  onSave,
}: {
  lineNumber: number;
  amount: number;
  scopes: Array<{ key: string; description: string; amount: number }>;
  selectedKeys: string[];
  allocations?: ScopeAllocation[];
  riskAmount?: number;
  riskScopeShares?: ScopeAllocation[];
  disabled: boolean;
  onSave: (
    keys: string[],
    percentages?: Record<string, number>,
    riskShares?: ScopeAllocation[],
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [riskDrafts, setRiskDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  /** Snapshot current selections without writing commercial data when opening or cancelling. */
  const changeOpen = (next: boolean) => {
    if (next) {
      setSelected(allocations?.map((item) => item.key) ?? selectedKeys);
      setPercentages(
        Object.fromEntries(
          (
            allocations ?? selectedKeys.map((key) => ({ key, percentage: 100 }))
          ).map((item) => [item.key, item.percentage.toFixed(2)]),
        ),
      );
      setRiskDrafts(
        Object.fromEntries(
          (riskScopeShares ?? []).map((item) => [
            item.key,
            item.percentage.toFixed(2),
          ]),
        ),
      );
      setSearch('');
    }
    setOpen(next);
  };
  const visible = scopes.filter((scope) =>
    scope.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const valid = (text: string) =>
    text.trim() !== '' &&
    Number.isFinite(Number(text)) &&
    Number(text) >= 0 &&
    Number(text) <= 100;
  // Only edited shares are fixed; untouched Scopes track the current cost weights.
  const riskShares = Object.entries(riskDrafts)
    .filter(([, text]) => text.trim() !== '')
    .map(([key, text]) => {
      const original = riskScopeShares?.find(
        (item) => item.key === key,
      )?.percentage;
      return {
        key,
        percentage:
          original !== undefined && text === original.toFixed(2)
            ? original
            : Number(text),
      };
    });
  const riskAllocation = allocateScopeRisk(scopes, riskAmount, riskShares);
  const invalid =
    selected.some((key) => !valid(percentages[key] ?? '100')) ||
    Object.values(riskDrafts).some((text) => text !== '' && !valid(text)) ||
    riskAllocation.errors.length > 0;
  const total = riskAllocation.scopes
    .filter((scope) => selected.includes(scope.key))
    .reduce(
      (sum, scope) =>
        sum +
        ((scope.amount + scope.riskAmount) *
          Number(percentages[scope.key] ?? 100)) /
          100,
      0,
    );
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <span className="inline-flex items-center justify-end gap-1">
        <span className="select-text cursor-text">{formatSgd(amount)}</span>
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              disabled={disabled}
              className="w-8 shrink-0"
            />
          }
          aria-label={`Select cost scopes for line ${lineNumber}`}
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </DialogTrigger>
      </span>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Line {lineNumber} cost scopes / 成本 Scope</DialogTitle>
          <DialogDescription>
            Cost Share 默认 100%。Risk Share 为项目风险在各 Scope
            间的分配，默认按成本
            Weight，未勾选也可调整，所有报价行共用。留空恢复自动分配。勾选后，成本和对应风险按
            Cost Share 计入本行，并随成本变化重算。
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search cost scopes"
          placeholder="Search Scope / 搜索 Scope"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSelected([
                ...new Set([...selected, ...visible.map((scope) => scope.key)]),
              ])
            }
          >
            Select visible / 全选搜索结果
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelected([])}>
            Clear / 清空
          </Button>
        </div>
        <Surface
          as="div"
          variant="list"
          className="max-h-[42vh] overflow-y-auto"
        >
          <Surface
            as="div"
            variant="inset"
            textRole="body-small"
            className="grid grid-cols-[minmax(100px,1fr)_90px_80px_80px_90px] gap-2"
          >
            <span>Scope</span>
            <span>Cost</span>
            <span>Cost Share %</span>
            <span>Risk Share %</span>
            <span>Cost + Risk</span>
          </Surface>
          {visible.map((scope) => (
            <Surface
              key={scope.key}
              as="div"
              variant="body"
              textRole="body-small"
              className="grid grid-cols-[minmax(100px,1fr)_90px_80px_80px_90px] items-center gap-2"
            >
              <label className="flex min-w-0 items-start gap-2">
                <CheckInput
                  type="checkbox"
                  aria-label={`Include scope ${scope.description}`}
                  checked={selected.includes(scope.key)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, scope.key]
                        : current.filter((key) => key !== scope.key),
                    )
                  }
                />
                <span className="break-words">{scope.description}</span>
              </label>
              <span className="financial-numeral">
                {formatSgd(scope.amount)}
              </span>
              <Input
                aria-label={`Scope percentage ${scope.description}`}
                type="text"
                inputMode="decimal"
                disabled={!selected.includes(scope.key)}
                value={percentages[scope.key] ?? '100.00'}
                onChange={(event) =>
                  setPercentages((current) => ({
                    ...current,
                    [scope.key]: event.target.value,
                  }))
                }
                onBlur={() => {
                  const value = percentages[scope.key];
                  if (value && valid(value))
                    setPercentages((current) => ({
                      ...current,
                      [scope.key]: Number(value).toFixed(2),
                    }));
                }}
                className="text-right"
              />
              <Input
                aria-label={`Risk percentage ${scope.description}`}
                type="text"
                inputMode="decimal"
                disabled={disabled}
                value={
                  riskDrafts[scope.key] ??
                  (
                    riskAllocation.scopes.find((item) => item.key === scope.key)
                      ?.riskPercentage ?? 0
                  ).toFixed(2)
                }
                onChange={(event) =>
                  setRiskDrafts((current) => ({
                    ...current,
                    [scope.key]: event.target.value,
                  }))
                }
                onBlur={() => {
                  const value = riskDrafts[scope.key];
                  if (value && valid(value))
                    setRiskDrafts((current) => ({
                      ...current,
                      [scope.key]: Number(value).toFixed(2),
                    }));
                }}
                title="Project-wide Risk share; clear to restore automatic cost weight"
                className="text-right"
              />
              <span className="financial-numeral">
                {formatSgd(
                  selected.includes(scope.key) &&
                    valid(percentages[scope.key] ?? '100')
                    ? ((scope.amount +
                        (riskAllocation.scopes.find(
                          (item) => item.key === scope.key,
                        )?.riskAmount ?? 0)) *
                        Number(percentages[scope.key] ?? 100)) /
                        100
                    : 0,
                )}
              </span>
            </Surface>
          ))}
        </Surface>
        <Surface
          as="div"
          textRole="body-main"
          className="flex items-center justify-between"
        >
          <span>
            Risk Cost {formatSgd(riskAmount)} - 100% across all Scopes
          </span>
          <Button variant="ghost" size="sm" onClick={() => setRiskDrafts({})}>
            Reset Risk to Weight
          </Button>
        </Surface>
        <Text as="p" textRole="body-main" className="text-right">
          {selected.length} selected · {invalid ? '—' : formatSgd(total)}
        </Text>
        {invalid && (
          <Text role="alert" as="p" tone="danger" textRole="body-main">
            {riskAllocation.errors[0] ??
              'Enter a percentage from 0 to 100 / 比例必须为 0–100。'}
          </Text>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={disabled || invalid}
            onClick={() => {
              if (disabled || invalid) return;
              onSave(
                selected,
                Object.fromEntries(
                  selected.map((key) => {
                    const original = allocations?.find(
                      (item) => item.key === key,
                    )?.percentage;
                    const text = percentages[key] ?? '100';
                    return [
                      key,
                      original !== undefined && text === original.toFixed(2)
                        ? original
                        : Number(text),
                    ];
                  }),
                ),
                riskShares,
              );
              setOpen(false);
            }}
          >
            Apply scopes / 应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
